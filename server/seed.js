// Starter data for a freshly registered household. This is a CLEAN slate — only
// the registering admin, a few empty rooms, and functional scene presets. No
// sample family, devices, transactions, or other demo/mock content. Everything
// else the household fills in themselves through the app.

export function buildSeed(adminName) {
  const initials = (name) =>
    name.trim().split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 2) || 'ME';

  const members = [
    { id: 1, name: adminName || 'You', role: 'admin', status: 'home', color: '#10B981', init: initials(adminName || 'You') }
  ];

  const events = [];
  const transactions = [];
  const chores = [];
  const shopping = [];

  // Config-style state stored as a JSON document on the household row.
  const config = {
    budgets: [],
    savings: [],
    securityArmed: false,
    thermostat: { temp: 72, target: 72, mode: 'cool', on: false },
    // A few empty starter rooms so "Add Device" has somewhere to go.
    rooms: [
      { id: 'living', name: 'Living Room', icon: 'fa-couch' },
      { id: 'kitchen', name: 'Kitchen', icon: 'fa-utensils' },
      { id: 'bedroom', name: 'Bedroom', icon: 'fa-bed' }
    ],
    // Functional scene presets (act on whatever devices the household adds).
    scenes: [
      { id: 'morning', name: 'Good Morning', icon: 'fa-sun', color: '#F59E0B', desc: 'Lights on, warm up', actions: { lightsOn: ['living', 'kitchen'], thermostat: 72 } },
      { id: 'movie', name: 'Movie Night', icon: 'fa-film', color: '#8B5CF6', desc: 'Dim the lights', actions: { lightsDim: 20, thermostat: 70 } },
      { id: 'away', name: 'Away Mode', icon: 'fa-door-open', color: '#EF4444', desc: 'Everything off, locked', actions: { lightsAllOff: true, lockAll: true, arm: true, thermostat: 65 } },
      { id: 'bedtime', name: 'Bedtime', icon: 'fa-moon', color: '#3B82F6', desc: 'All off, doors locked', actions: { lightsAllOff: true, lockAll: true, thermostat: 66 } }
    ],
    lights: [],
    devices: [],
    energy: { today: 0, week: 0, month: 0, items: [] },
    // No weather provider wired — left empty so the UI shows a neutral state
    // instead of fabricated readings.
    weather: { temp: null, cond: '', icon: 'fa-cloud', city: '', hi: null, lo: null, forecast: [] },
    chorePoints: { 1: 0 },
    recurring: [],
    debts: [],
    // Functional starter automations so the home runs itself from day one. They
    // act on whatever scenes/devices the household adds (ids are local to this list).
    automations: [
      { id: 1, name: 'Good Night', icon: 'fa-moon', enabled: true, trigger: { type: 'time', at: '23:00' }, actions: [{ kind: 'scene', scene: 'bedtime' }], lastRun: null },
      { id: 2, name: 'Wake Up', icon: 'fa-sun', enabled: true, trigger: { type: 'time', at: '07:00' }, actions: [{ kind: 'scene', scene: 'morning' }], lastRun: null },
      { id: 3, name: 'Secure When Everyone Leaves', icon: 'fa-shield-halved', enabled: true, trigger: { type: 'presence', mode: 'everyone_away' }, actions: [{ kind: 'lightsOff' }, { kind: 'lockAll' }, { kind: 'security', arm: true }], lastRun: null },
      { id: 4, name: 'Welcome Home', icon: 'fa-house-chimney-window', enabled: true, trigger: { type: 'presence', mode: 'someone_home' }, actions: [{ kind: 'security', arm: false }, { kind: 'lights', room: 'all', on: true }], lastRun: null },
      { id: 5, name: 'Lights Out Overnight', icon: 'fa-bolt', enabled: false, trigger: { type: 'time', at: '01:00' }, actions: [{ kind: 'lightsOff' }], lastRun: null }
    ],
    autoSeeded: true,
    assistants: { alexa: false, google: false, siri: false, homekit: false, voiceName: 'HomePal' },
    nid: 100
  };

  const alerts = [];

  return { members, events, transactions, chores, shopping, alerts, config };
}
