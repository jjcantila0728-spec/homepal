// Static lookup tables, theme maps, and procedural SVG artwork — ported verbatim
// from the legacy constants.js. The ART strings are decorative (aria-hidden) and
// rendered via dangerouslySetInnerHTML so they stay byte-identical.

export const catColors: Record<string, string> = { family: '#10B981', school: '#3B82F6', work: '#F59E0B', health: '#EF4444', social: '#8B5CF6', education: '#EC4899' };
export const statusIcons: Record<string, string> = { home: 'fa-house', school: 'fa-school', out: 'fa-car', work: 'fa-briefcase', gym: 'fa-dumbbell' };
export const expCats = ['Rent', 'Groceries', 'Utilities', 'Transport', 'Education', 'Entertainment', 'Health', 'Shopping', 'Other'];
export const incCats = ['Salary', 'Freelance', 'Bonus', 'Investment', 'Other'];
export const devTypeColors: Record<string, string> = { lock: '#EF4444', camera: '#3B82F6', sensor: '#06B6D4', media: '#8B5CF6', appliance: '#10B981', climate: '#F59E0B' };
export const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const debtMeta: Record<string, { icon: string; label: string; color: string }> = {
  credit_card: { icon: 'fa-credit-card', label: 'Credit Card', color: '#EC4899' },
  loan: { icon: 'fa-hand-holding-dollar', label: 'Loan', color: '#F59E0B' },
  mortgage: { icon: 'fa-house-chimney', label: 'Mortgage', color: '#3B82F6' },
  auto: { icon: 'fa-car', label: 'Auto Loan', color: '#8B5CF6' },
  student: { icon: 'fa-graduation-cap', label: 'Student Loan', color: '#06B6D4' },
  personal: { icon: 'fa-user', label: 'Personal', color: '#10B981' },
};

export const devTypeMeta: Record<string, { icon: string; label: string; status?: string }> = {
  light: { icon: 'fa-lightbulb', label: 'Light' },
  lock: { icon: 'fa-lock', label: 'Lock', status: 'locked' },
  camera: { icon: 'fa-video', label: 'Camera', status: 'active' },
  sensor: { icon: 'fa-satellite-dish', label: 'Sensor', status: 'active' },
  media: { icon: 'fa-tv', label: 'Media', status: 'off' },
  appliance: { icon: 'fa-plug', label: 'Appliance', status: 'off' },
  climate: { icon: 'fa-temperature-half', label: 'Climate', status: 'off' },
  thermostat: { icon: 'fa-temperature-half', label: 'Thermostat', status: 'on' },
};

export const deviceIcons = ['fa-lightbulb', 'fa-lock', 'fa-video', 'fa-satellite-dish', 'fa-tv', 'fa-volume-high', 'fa-plug', 'fa-temperature-half', 'fa-snowflake', 'fa-fire', 'fa-fan', 'fa-robot', 'fa-blender', 'fa-mug-hot', 'fa-shower', 'fa-wifi', 'fa-bell', 'fa-door-open', 'fa-tablet-screen-button', 'fa-temperature-high', 'fa-wind', 'fa-broom'];
export const roomIcons = ['fa-couch', 'fa-utensils', 'fa-bed', 'fa-bath', 'fa-warehouse', 'fa-leaf', 'fa-tv', 'fa-baby', 'fa-dumbbell', 'fa-car', 'fa-stairs', 'fa-house-chimney', 'fa-star', 'fa-gamepad'];

/* ===== Generated SVG artwork (procedural, offline, theme-aware) ===== */
export const ART = {
  home(): string {
    let rays = '';
    for (let i = 0; i < 12; i++) {
      const a = (i * 30 * Math.PI) / 180,
        x1 = 356 + Math.cos(a) * 30,
        y1 = 78 + Math.sin(a) * 30,
        x2 = 356 + Math.cos(a) * 41,
        y2 = 78 + Math.sin(a) * 41;
      rays += '<line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '" stroke="#F59E0B" stroke-width="3" stroke-linecap="round" opacity=".7"/>';
    }
    return '<svg class="art" viewBox="0 0 440 320" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">'
      + '<defs><linearGradient id="hRoof" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#10B981"/><stop offset="1" stop-color="#0EA472"/></linearGradient>'
      + '<linearGradient id="hWall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#22304A"/><stop offset="1" stop-color="#1A2438"/></linearGradient>'
      + '<radialGradient id="hSun" cx="50%" cy="40%" r="60%"><stop offset="0" stop-color="#FDE68A"/><stop offset="1" stop-color="#F59E0B"/></radialGradient></defs>'
      + '<g class="art-spin"><circle cx="356" cy="78" r="24" fill="url(#hSun)"/>' + rays + '</g>'
      + '<ellipse cx="222" cy="300" rx="200" ry="17" fill="#10B981" opacity=".10"/>'
      + '<g class="art-float2"><rect x="70" y="212" width="11" height="60" rx="5" fill="#6B5135"/><circle cx="75" cy="200" r="34" fill="#10B981" opacity=".85"/><circle cx="52" cy="216" r="21" fill="#0EA472" opacity=".8"/><circle cx="99" cy="216" r="21" fill="#0EA472" opacity=".8"/></g>'
      + '<g class="art-float">'
      + '<rect x="150" y="150" width="172" height="126" rx="12" fill="url(#hWall)" stroke="#2D3B55"/>'
      + '<rect x="296" y="116" width="17" height="40" rx="3" fill="#22304A" stroke="#2D3B55"/>'
      + '<path d="M136 156 L236 90 L336 156 Z" fill="url(#hRoof)"/>'
      + '<rect x="174" y="186" width="44" height="44" rx="7" fill="#FBBF24" opacity=".92" class="art-pulse"/><path d="M196 186v44M174 208h44" stroke="#1A2438" stroke-width="2" opacity=".4"/>'
      + '<rect x="256" y="186" width="44" height="44" rx="7" fill="#06B6D4" opacity=".4"/><path d="M278 186v44M256 208h44" stroke="#1A2438" stroke-width="2" opacity=".4"/>'
      + '<rect x="214" y="228" width="44" height="48" rx="6" fill="#8B5CF6" opacity=".78"/><circle cx="250" cy="252" r="3" fill="#fff" opacity=".85"/>'
      + '</g>'
      + '<g class="art-float2"><circle cx="362" cy="244" r="13" fill="#F59E0B"/><rect x="351" y="258" width="22" height="36" rx="11" fill="#3B82F6"/>'
      + '<circle cx="390" cy="256" r="9" fill="#EC4899"/><rect x="381" y="267" width="18" height="27" rx="9" fill="#8B5CF6"/></g>'
      + '<path d="M118 104c4-7 14-3 11 4-2 5-11 9-11 9s-9-4-11-9c-3-7 7-11 11-4z" fill="#EC4899" opacity=".6" class="art-float"/>'
      + '<circle cx="408" cy="150" r="4" fill="#06B6D4" opacity=".6" class="art-float2"/><circle cx="96" cy="150" r="3" fill="#F59E0B" opacity=".7"/><circle cx="330" cy="60" r="3" fill="#10B981" opacity=".6"/>'
      + '</svg>';
  },
  empty(c = 'var(--accent)'): string {
    return '<svg class="art" viewBox="0 0 220 150" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">'
      + '<ellipse cx="110" cy="132" rx="72" ry="9" fill="' + c + '" opacity=".12"/>'
      + '<g class="art-float"><rect x="62" y="42" width="96" height="68" rx="13" fill="var(--surface2)" stroke="' + c + '" stroke-opacity=".45"/>'
      + '<rect x="62" y="42" width="96" height="22" rx="13" fill="' + c + '" opacity=".16"/><circle cx="78" cy="53" r="2.5" fill="' + c + '" opacity=".7"/><circle cx="88" cy="53" r="2.5" fill="' + c + '" opacity=".5"/>'
      + '<circle cx="110" cy="82" r="16" fill="none" stroke="' + c + '" stroke-width="3" stroke-dasharray="3 4.5"/><path d="M110 74v16M102 82h16" stroke="' + c + '" stroke-width="3" stroke-linecap="round"/></g>'
      + '<circle cx="48" cy="40" r="4" fill="' + c + '" opacity=".5" class="art-float2"/><circle cx="174" cy="56" r="5" fill="var(--amber)" opacity=".5" class="art-float"/><circle cx="162" cy="28" r="3" fill="var(--cyan)" opacity=".6"/>'
      + '</svg>';
  },
};

export const VIEWS = [
  { id: 'dashboard', icon: 'fa-gauge-high', label: 'Dashboard', href: '/app' },
  { id: 'schedule', icon: 'fa-calendar', label: 'Schedule', href: '/app/schedule' },
  { id: 'finance', icon: 'fa-wallet', label: 'Finance', href: '/app/finance' },
  { id: 'home', icon: 'fa-house-signal', label: 'Smart Home', href: '/app/home' },
  { id: 'tasks', icon: 'fa-list-check', label: 'Tasks', href: '/app/tasks' },
] as const;
