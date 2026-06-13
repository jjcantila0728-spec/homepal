// Automation engine — pure functions that mutate a HouseholdState draft. Ported
// from the legacy automations.js. The rule-builder + Connect-Devices UI lives in
// the React Home view; this module is the headless engine it (and the store) call.
import type { HouseholdState, Scene, Automation, SceneActions, AutomationTrigger } from './types';

function nowHM(): string {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
function todayKey(): string {
  const d = new Date();
  return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
}

// Once-per-scheduled-minute dedupe for the time tick (client-runtime memory).
const firedKeys = new Set<string>();

export function presenceMatch(state: HouseholdState, mode: string): boolean {
  const members = state.members || [];
  if (!members.length) return false;
  const away = members.every((m) => ['out', 'work', 'school', 'gym'].includes(m.status));
  const anyHome = members.some((m) => m.status === 'home');
  if (mode === 'everyone_away') return away;
  if (mode === 'someone_home') return anyHome;
  return false;
}

// Apply a scene's action map to the draft (used by both the UI scene buttons and the engine).
export function applySceneActions(d: HouseholdState, a: SceneActions): void {
  if (a.lightsAllOff) d.lights.forEach((l) => (l.on = false));
  if (a.lightsOn) a.lightsOn.forEach((rm) => d.lights.filter((l) => l.room === rm).forEach((l) => { l.on = true; l.brightness = 80; }));
  if (a.lightsDim) d.lights.filter((l) => l.on).forEach((l) => (l.brightness = Math.min(l.brightness, a.lightsDim!)));
  if (a.devicesOn) a.devicesOn.forEach((id) => { const dev = d.devices.find((x) => x.id === id); if (dev) dev.status = 'on'; });
  if (a.lockAll) d.devices.filter((dv) => dv.type === 'lock').forEach((dv) => { dv.status = 'locked'; dv.icon = 'fa-lock'; });
  if (a.arm) d.securityArmed = true;
  if (a.thermostat) { d.thermostat.target = a.thermostat; d.thermostat.on = true; }
}

function applyAutomationActions(d: HouseholdState, auto: Automation): void {
  (auto.actions || []).forEach((ac) => {
    if (ac.kind === 'scene') {
      const sc = d.scenes.find((s) => s.id === ac.scene);
      if (sc) applySceneActions(d, sc.actions);
    } else if (ac.kind === 'lights') {
      const ls = ac.room === 'all' || !ac.room ? d.lights : d.lights.filter((l) => l.room === ac.room);
      ls.forEach((l) => { l.on = !!ac.on; if (ac.on && l.brightness < 5) l.brightness = 80; });
    } else if (ac.kind === 'lightsOff') {
      d.lights.forEach((l) => (l.on = false));
    } else if (ac.kind === 'thermostat') {
      const t = ac as { target?: number };
      d.thermostat.target = Math.max(55, Math.min(85, +(t.target ?? 70) || 70));
      d.thermostat.on = true;
    } else if (ac.kind === 'security') {
      d.securityArmed = !!ac.arm;
    } else if (ac.kind === 'lockAll') {
      d.devices.filter((dv) => dv.type === 'lock').forEach((dv) => { dv.status = 'locked'; dv.icon = 'fa-lock'; });
    }
  });
}

export function fireAutomation(d: HouseholdState, auto: Automation): void {
  applyAutomationActions(d, auto);
  auto.lastRun = 'Just now';
  d.alerts.unshift({ id: ++d.nid, type: 'automation', msg: 'Automation “' + auto.name + '” ran', time: 'Just now', sev: 'info', seen: false });
}

// Event-driven triggers (security/presence). Returns whether any rule fired.
export function runAutomations(d: HouseholdState, event: { type: string; armed?: boolean }): boolean {
  let fired = false;
  (d.automations || []).forEach((auto) => {
    if (!auto.enabled) return;
    const tg = auto.trigger as AutomationTrigger;
    if (tg.type !== event.type) return;
    if (tg.type === 'security' && !!tg.armed !== !!event.armed) return;
    if (tg.type === 'presence' && !presenceMatch(d, tg.mode)) return;
    fireAutomation(d, auto);
    fired = true;
  });
  return fired;
}

// Time-driven triggers — called once a minute. Returns whether any rule fired.
export function tickAutomations(d: HouseholdState): boolean {
  const hm = nowHM();
  const tk = todayKey();
  let fired = false;
  (d.automations || []).forEach((auto) => {
    if (!auto.enabled) return;
    const tg = auto.trigger as AutomationTrigger;
    if (tg.type !== 'time' || tg.at !== hm) return;
    const key = auto.id + ':' + tk + ' ' + hm;
    if (firedKeys.has(key)) return;
    firedKeys.add(key);
    fireAutomation(d, auto);
    fired = true;
  });
  return fired;
}

export function defaultAutomations(d: HouseholdState): Automation[] {
  return [
    { id: ++d.nid, name: 'Good Night', icon: 'fa-moon', enabled: true, trigger: { type: 'time', at: '23:00' }, actions: [{ kind: 'scene', scene: 'bedtime' }], lastRun: null },
    { id: ++d.nid, name: 'Wake Up', icon: 'fa-sun', enabled: true, trigger: { type: 'time', at: '07:00' }, actions: [{ kind: 'scene', scene: 'morning' }], lastRun: null },
    { id: ++d.nid, name: 'Secure When Everyone Leaves', icon: 'fa-shield-halved', enabled: true, trigger: { type: 'presence', mode: 'everyone_away' }, actions: [{ kind: 'lightsOff' }, { kind: 'lockAll' }, { kind: 'security', arm: true }], lastRun: null },
    { id: ++d.nid, name: 'Welcome Home', icon: 'fa-house-chimney-window', enabled: true, trigger: { type: 'presence', mode: 'someone_home' }, actions: [{ kind: 'security', arm: false }, { kind: 'lights', room: 'all', on: true }], lastRun: null },
    { id: ++d.nid, name: 'Lights Out Overnight', icon: 'fa-bolt', enabled: false, trigger: { type: 'time', at: '01:00' }, actions: [{ kind: 'lightsOff' }], lastRun: null },
  ];
}

export const TRIGGER_TEXT = (tg: AutomationTrigger): string => {
  if (!tg) return '';
  if (tg.type === 'time') return 'Every day at ' + tg.at;
  if (tg.type === 'security') return tg.armed ? 'When security is armed' : 'When security is disarmed';
  if (tg.type === 'presence') return tg.mode === 'everyone_away' ? 'When everyone leaves home' : 'When someone comes home';
  return '';
};

export function actionText(state: HouseholdState, actions: Automation['actions']): string {
  return (actions || [])
    .map((ac) => {
      if (ac.kind === 'scene') { const sc = state.scenes.find((s) => s.id === ac.scene); return 'Run “' + (sc ? sc.name : ac.scene) + '”'; }
      if (ac.kind === 'lights') return 'Turn lights ' + (ac.on ? 'on' : 'off');
      if (ac.kind === 'lightsOff') return 'All lights off';
      if (ac.kind === 'thermostat') return 'Set climate to ' + (ac as { target?: number }).target + '°';
      if (ac.kind === 'security') return ac.arm ? 'Arm security' : 'Disarm security';
      if (ac.kind === 'lockAll') return 'Lock all doors';
      return '';
    })
    .filter(Boolean)
    .join(' · ');
}

export type { Scene };
