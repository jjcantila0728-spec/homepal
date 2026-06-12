// Natural-language voice-intent engine. Shared contract with the in-browser
// voice control: both turn a phrase like "turn on the kitchen lights" into a
// state mutation + a spoken response. This is the bridge an external assistant
// (Alexa skill, Google Action, Siri Shortcut) POSTs to at /api/voice.

const num = (s) => { const m = String(s).match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : null; };

function findRoom(state, text) {
  if (/\b(everywhere|all|whole house|the house)\b/.test(text)) return 'all';
  for (const r of state.rooms || []) {
    const name = r.name.toLowerCase().replace(/'s/g, '');
    if (text.includes(name) || text.includes(r.id)) return r.id;
  }
  return null;
}

// Apply a parsed command to `state` (mutated in place). Returns a spoken reply.
export function applyVoiceCommand(state, raw) {
  const text = String(raw || '').toLowerCase().trim();
  if (!text) return { ok: false, speech: "I didn't catch that." };

  state.lights = state.lights || [];
  state.devices = state.devices || [];
  state.rooms = state.rooms || [];
  state.scenes = state.scenes || [];
  state.shopping = state.shopping || [];
  state.alerts = state.alerts || [];
  const log = (msg, sev = 'info', type = 'voice') =>
    state.alerts.unshift({ id: ++state.nid, type, msg, time: 'Just now', sev, seen: false });

  // ---- Scenes ("good morning", "movie night", "good night" → bedtime) ----
  {
    const sceneAliases = { 'good night': 'bedtime', 'goodnight': 'bedtime', 'go to sleep': 'bedtime', 'bed time': 'bedtime', 'good morning': 'morning', 'wake up': 'morning', 'away mode': 'away', 'leaving home': 'away', 'movie night': 'movie', 'party mode': 'party' };
    let sc = state.scenes.find((s) => text.includes(s.name.toLowerCase()));
    if (!sc) for (const k in sceneAliases) { if (text.includes(k)) { sc = state.scenes.find((s) => s.id === sceneAliases[k]); if (sc) break; } }
    if (!sc && /\b(scene|mode)\b/.test(text)) sc = state.scenes.find((s) => text.includes(s.id));
    if (sc) {
      const a = sc.actions || {};
      if (a.lightsAllOff) state.lights.forEach((l) => { l.on = false; });
      if (a.lightsOn) a.lightsOn.forEach((rm) => state.lights.filter((l) => l.room === rm).forEach((l) => { l.on = true; l.brightness = 80; }));
      if (a.lightsDim) state.lights.filter((l) => l.on).forEach((l) => { l.brightness = Math.min(l.brightness, a.lightsDim); });
      if (a.devicesOn) a.devicesOn.forEach((id) => { const d = state.devices.find((x) => x.id === id); if (d) d.status = 'on'; });
      if (a.lockAll) state.devices.filter((d) => d.type === 'lock').forEach((d) => { d.status = 'locked'; d.icon = 'fa-lock'; });
      if (a.arm) state.securityArmed = true;
      if (a.thermostat && state.thermostat) { state.thermostat.target = a.thermostat; state.thermostat.on = true; }
      log(`Scene "${sc.name}" activated by voice`, 'success', 'system');
      return { ok: true, speech: `${sc.name} activated.`, action: 'scene' };
    }
  }

  // ---- Security ----
  if (/\b(arm|disarm)\b/.test(text) && /\b(security|alarm|system|house)\b/.test(text)) {
    state.securityArmed = /\barm\b/.test(text) && !/\bdisarm\b/.test(text);
    log(`Security ${state.securityArmed ? 'armed' : 'disarmed'} by voice`, state.securityArmed ? 'success' : 'warning', 'system');
    return { ok: true, speech: `Security system ${state.securityArmed ? 'armed' : 'disarmed'}.`, action: 'security' };
  }

  // ---- Locks ----
  if (/\b(lock|unlock)\b/.test(text)) {
    const lock = /\block\b/.test(text) && !/\bunlock\b/.test(text);
    let targets = state.devices.filter((d) => d.type === 'lock');
    if (!/\b(all|every|the doors)\b/.test(text)) {
      const named = targets.filter((d) => text.includes(d.name.toLowerCase()) || text.includes((d.name.split(' ')[0] || '').toLowerCase()));
      if (named.length) targets = named;
    }
    targets.forEach((d) => { d.status = lock ? 'locked' : 'unlocked'; d.icon = lock ? 'fa-lock' : 'fa-lock-open'; });
    log(`${targets.length} lock(s) ${lock ? 'locked' : 'unlocked'} by voice`, 'info', 'door');
    return { ok: true, speech: `${targets.length === 1 ? targets[0].name : targets.length + ' doors'} ${lock ? 'locked' : 'unlocked'}.`, action: 'lock' };
  }

  // ---- Thermostat ----
  if (/\b(temperature|thermostat|degrees|warmer|cooler|heat|cool|ac)\b/.test(text) && state.thermostat) {
    if (/\bwhat|how (warm|cold|hot)\b/.test(text)) {
      return { ok: true, speech: `It's ${state.thermostat.temp} degrees, set to ${state.thermostat.target}.`, action: 'query' };
    }
    const n = num(text);
    if (/\bwarmer|up|increase|raise\b/.test(text)) state.thermostat.target = Math.min(85, state.thermostat.target + (n || 2));
    else if (/\bcooler|down|decrease|lower\b/.test(text)) state.thermostat.target = Math.max(55, state.thermostat.target - (n || 2));
    else if (n != null) state.thermostat.target = Math.max(55, Math.min(85, n));
    state.thermostat.on = true;
    log(`Thermostat set to ${state.thermostat.target}° by voice`, 'info', 'climate');
    return { ok: true, speech: `Thermostat set to ${state.thermostat.target} degrees.`, action: 'thermostat' };
  }

  // ---- Lights ----
  if (/\b(light|lights|lamp)\b/.test(text)) {
    const on = /\b(on|turn on|switch on)\b/.test(text) && !/\boff\b/.test(text);
    const room = findRoom(state, text);
    let targets = state.lights;
    if (room && room !== 'all') targets = state.lights.filter((l) => l.room === room);
    else if (!/\b(all|everything|every|house)\b/.test(text) && !room) {
      const named = state.lights.filter((l) => text.includes(l.name.toLowerCase()));
      if (named.length) targets = named;
    }
    targets.forEach((l) => { l.on = on; if (on && l.brightness < 5) l.brightness = 80; });
    const where = room && room !== 'all' ? (state.rooms.find((r) => r.id === room) || {}).name : null;
    log(`${targets.length} light(s) turned ${on ? 'on' : 'off'} by voice`, 'info', 'light');
    return { ok: true, speech: `${where ? where + ' lights' : targets.length + ' lights'} turned ${on ? 'on' : 'off'}.`, action: 'light' };
  }

  // ---- Generic device by name ----
  const dev = state.devices.find((d) => text.includes(d.name.toLowerCase()));
  if (dev && /\b(on|off|start|stop|turn|switch)\b/.test(text)) {
    const on = /\b(on|start)\b/.test(text) && !/\b(off|stop)\b/.test(text);
    dev.status = on ? 'on' : 'off';
    log(`${dev.name} turned ${dev.status} by voice`, 'info', 'device');
    return { ok: true, speech: `${dev.name} turned ${on ? 'on' : 'off'}.`, action: 'device' };
  }

  // ---- Shopping list ----
  if (/\b(add|put)\b.*\b(shopping|list|cart|buy|groceries)\b/.test(text) || /^add /.test(text)) {
    const item = text.replace(/.*\badd\b/, '').replace(/\bto\b.*\b(shopping|list|cart)\b/, '').replace(/\b(shopping|list|cart|to|the|my)\b/g, '').trim();
    if (item) {
      state.shopping.push({ id: ++state.nid, name: item.replace(/\b\w/g, (c) => c.toUpperCase()), qty: '1', checked: false, addedBy: 1, cat: 'Other' });
      return { ok: true, speech: `Added ${item} to the shopping list.`, action: 'shopping' };
    }
  }

  // ---- Status report ----
  if (/\b(status|report|summary|everything|whats up|what's up|home status)\b/.test(text)) {
    const lightsOn = state.lights.filter((l) => l.on).length;
    const unlocked = state.devices.filter((d) => d.type === 'lock' && d.status !== 'locked').length;
    return {
      ok: true, action: 'query',
      speech: `${lightsOn} lights on, ${unlocked === 0 ? 'all doors locked' : unlocked + ' door' + (unlocked > 1 ? 's' : '') + ' unlocked'}, security ${state.securityArmed ? 'armed' : 'off'}, and it's ${state.thermostat ? state.thermostat.temp + ' degrees' : 'comfortable'}.`
    };
  }

  return { ok: false, speech: `Sorry, I can't do that yet. Try "turn on the lights", "lock the doors", or "good night".` };
}
