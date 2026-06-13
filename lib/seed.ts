// Starter data for a freshly registered household — a clean slate: the registering
// admin, empty starter rooms, functional scenes + automations. Ported from the
// legacy server/seed.js, but returns the assembled whole-state object directly.

import type { HouseholdState } from './types';

export type { HouseholdState };

const initials = (name: string): string =>
  name.trim().split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 2) || 'ME';

export function buildSeedState(adminName: string, householdName?: string): HouseholdState {
  const admin = adminName || 'You';
  return {
    householdName: householdName?.trim() || `${admin}'s Home`,
    members: [
      { id: 1, name: admin, role: 'admin', status: 'home', color: '#10B981', init: initials(admin) },
    ],
    events: [],
    transactions: [],
    chores: [],
    shopping: [],
    alerts: [],
    budgets: [],
    savings: [],
    securityArmed: false,
    thermostat: { temp: 72, target: 72, mode: 'cool', on: false },
    rooms: [
      { id: 'living', name: 'Living Room', icon: 'fa-couch' },
      { id: 'kitchen', name: 'Kitchen', icon: 'fa-utensils' },
      { id: 'bedroom', name: 'Bedroom', icon: 'fa-bed' },
    ],
    scenes: [
      { id: 'morning', name: 'Good Morning', icon: 'fa-sun', color: '#F59E0B', desc: 'Lights on, warm up', actions: { lightsOn: ['living', 'kitchen'], thermostat: 72 } },
      { id: 'movie', name: 'Movie Night', icon: 'fa-film', color: '#8B5CF6', desc: 'Dim the lights', actions: { lightsDim: 20, thermostat: 70 } },
      { id: 'away', name: 'Away Mode', icon: 'fa-door-open', color: '#EF4444', desc: 'Everything off, locked', actions: { lightsAllOff: true, lockAll: true, arm: true, thermostat: 65 } },
      { id: 'bedtime', name: 'Bedtime', icon: 'fa-moon', color: '#3B82F6', desc: 'All off, doors locked', actions: { lightsAllOff: true, lockAll: true, thermostat: 66 } },
    ],
    lights: [],
    devices: [],
    energy: { today: 0, week: 0, month: 0, items: [] },
    weather: { temp: null, cond: '', icon: 'fa-cloud', city: '', hi: null, lo: null, forecast: [] },
    chorePoints: { '1': 0 },
    recurring: [],
    debts: [],
    automations: [
      { id: 1, name: 'Good Night', icon: 'fa-moon', enabled: true, trigger: { type: 'time', at: '23:00' }, actions: [{ kind: 'scene', scene: 'bedtime' }], lastRun: null },
      { id: 2, name: 'Wake Up', icon: 'fa-sun', enabled: true, trigger: { type: 'time', at: '07:00' }, actions: [{ kind: 'scene', scene: 'morning' }], lastRun: null },
      { id: 3, name: 'Secure When Everyone Leaves', icon: 'fa-shield-halved', enabled: true, trigger: { type: 'presence', mode: 'everyone_away' }, actions: [{ kind: 'lightsOff' }, { kind: 'lockAll' }, { kind: 'security', arm: true }], lastRun: null },
      { id: 4, name: 'Welcome Home', icon: 'fa-house-chimney-window', enabled: true, trigger: { type: 'presence', mode: 'someone_home' }, actions: [{ kind: 'security', arm: false }, { kind: 'lights', room: 'all', on: true }], lastRun: null },
      { id: 5, name: 'Lights Out Overnight', icon: 'fa-bolt', enabled: false, trigger: { type: 'time', at: '01:00' }, actions: [{ kind: 'lightsOff' }], lastRun: null },
    ],
    autoSeeded: true,
    assistants: { alexa: false, google: false, siri: false, homekit: false, voiceName: 'HomePal' },
    nid: 100,
  };
}
