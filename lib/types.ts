// Canonical types for the household state. Kept deliberately permissive where the
// legacy data is loose, but precise enough to make the React port safe.

// A reusable "working time" preset saved on a member. Applied at scheduling
// time to fill an event's start/end without re-typing them.
export interface Shift {
  id: number;
  label: string;
  start: string; // "HH:MM"
  end: string; // "HH:MM"
}

export interface Member {
  id: number;
  name: string;
  role: 'admin' | 'member';
  status: string;
  color: string;
  init: string;
  shifts?: Shift[];
}

export interface CalEvent {
  id: number;
  title: string;
  date: string;
  time: string; // start time, "HH:MM"
  endTime?: string; // optional end time, "HH:MM"
  memberId: number;
  cat: string;
  desc?: string;
}

export interface Transaction {
  id: number;
  type: 'income' | 'expense';
  cat: string;
  amount: number;
  date: string;
  memberId: number;
  note?: string;
}

export interface Budget {
  cat: string;
  limit: number;
  spent?: number;
}

export interface Savings {
  id: number;
  name: string;
  target: number;
  current: number;
  icon: string;
  color: string;
}

export interface Recurring {
  id: number;
  name: string;
  kind: 'bill' | 'income';
  cat: string;
  amount: number;
  freq: 'monthly' | 'weekly' | 'yearly';
  next: string;
  memberId?: number;
  autopay?: boolean;
}

export interface Debt {
  id: number;
  name: string;
  kind: string;
  balance: number;
  apr: number;
  minPayment: number;
  due: string;
  limit?: number;
}

export interface Room {
  id: string;
  name: string;
  icon: string;
}

export interface SceneActions {
  lightsOn?: string[];
  lightsDim?: number;
  lightsAllOff?: boolean;
  devicesOn?: number[];
  lockAll?: boolean;
  arm?: boolean;
  thermostat?: number;
}

export interface Scene {
  id: string;
  name: string;
  icon: string;
  color: string;
  desc: string;
  actions: SceneActions;
}

export interface Light {
  id: number;
  name: string;
  room: string;
  on: boolean;
  brightness: number;
  deakoUuid?: string; // when set, this light controls a real Deako device
  source?: 'manual' | 'deako';
}

export interface Device {
  id: number;
  name: string;
  room: string;
  type: 'lock' | 'camera' | 'sensor' | 'media' | 'appliance' | 'climate';
  status: string;
  icon: string;
  brand?: string;
  camType?: string;
  stream?: string;
  ip?: string;
  model?: string;
  source?: string;
}

export interface Thermostat {
  temp: number | string;
  target: number;
  mode: string;
  on: boolean;
}

export interface EnergyItem {
  cat: string;
  pct: number;
  color: string;
}

export interface Energy {
  today: number;
  week: number;
  month: number;
  items: EnergyItem[];
}

export interface WeatherForecast {
  day: string;
  icon: string;
  hi: number;
}

export interface Weather {
  temp: number | null | string;
  cond: string;
  icon: string;
  city: string;
  hi: number | null | string;
  lo: number | null | string;
  forecast: WeatherForecast[];
}

export interface Chore {
  id: number;
  name: string;
  assignee: number;
  day: number;
  done: boolean;
  pts: number;
  icon: string;
}

export interface ShoppingItem {
  id: number;
  name: string;
  qty: string;
  checked: boolean;
  addedBy: number;
  cat: string;
}

export interface Alert {
  id: number;
  type: string;
  msg: string;
  time: string;
  sev: 'info' | 'warning' | 'success' | 'danger';
  seen: boolean;
}

// A linked external account ("connector") owned by a single member. Calendar
// connectors keep the household Schedule in sync; bank connectors keep Finance
// in sync. Each member manages only their own connections.
export type ConnectorKind = 'calendar' | 'bank';

export interface Connection {
  id: number;
  memberId: number;
  providerId: string;
  kind: ConnectorKind;
  account: string; // email for calendars, masked account for banks
  status: 'connected' | 'error';
  autoSync: boolean;
  lastSync: string; // human label, e.g. "Just now"
  synced: number; // count of items pulled in last sync (cosmetic)
}

export interface Assistants {
  alexa: boolean;
  google: boolean;
  siri: boolean;
  homekit: boolean;
  voiceName: string;
}

export type AutomationTrigger =
  | { type: 'time'; at: string }
  | { type: 'presence'; mode: 'everyone_away' | 'someone_home' }
  | { type: 'security'; armed: boolean };

export interface AutomationAction {
  kind: string;
  scene?: string;
  room?: string;
  on?: boolean;
  arm?: boolean;
}

export interface Automation {
  id: number;
  name: string;
  icon: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  actions: AutomationAction[];
  lastRun: string | null;
}

export interface CctvConfig {
  enabled?: boolean;
  storagePath?: string;
  freeSpaceFloorGB?: number;
  cameras?: unknown[];
}

export interface DeakoConfig {
  enabled?: boolean;
  gatewayIp?: string;
  lastConnectedAt?: string;
  devices?: { uuid: string; name: string; room?: string }[];
}

export interface Integrations {
  deako?: DeakoConfig;
}

// Family location, used to derive public holidays for the Schedule calendar.
export interface Location {
  country: string; // ISO-like code matching lib/holidays.ts, e.g. "PH", "US"
  region?: string; // optional sub-national region key for regional holidays
}

export interface HouseholdState {
  householdName: string;
  location?: Location;
  integrations?: Integrations;
  members: Member[];
  events: CalEvent[];
  transactions: Transaction[];
  budgets: Budget[];
  savings: Savings[];
  recurring: Recurring[];
  debts: Debt[];
  securityArmed: boolean;
  thermostat: Thermostat;
  rooms: Room[];
  scenes: Scene[];
  lights: Light[];
  devices: Device[];
  energy: Energy;
  weather: Weather;
  chores: Chore[];
  chorePoints: Record<string, number>;
  shopping: ShoppingItem[];
  alerts: Alert[];
  automations: Automation[];
  autoSeeded: boolean;
  assistants: Assistants;
  cctv?: CctvConfig;
  connectors?: Connection[];
  nid: number;
}

export type Plan = 'free' | 'pro';
