// SQLite data layer (built-in node:sqlite — no native deps).
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildSeed } from './seed.js';
import { hashPassword } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'homepal.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS households (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    config TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE,
    pass_hash TEXT NOT NULL,
    member_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS members (
    household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    id INTEGER NOT NULL, name TEXT, role TEXT, status TEXT, color TEXT, init TEXT,
    PRIMARY KEY (household_id, id)
  );
  CREATE TABLE IF NOT EXISTS events (
    household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    id INTEGER NOT NULL, title TEXT, date TEXT, time TEXT, memberId INTEGER, cat TEXT, descr TEXT,
    PRIMARY KEY (household_id, id)
  );
  CREATE TABLE IF NOT EXISTS transactions (
    household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    id INTEGER NOT NULL, type TEXT, cat TEXT, amount REAL, date TEXT, memberId INTEGER, note TEXT,
    PRIMARY KEY (household_id, id)
  );
  CREATE TABLE IF NOT EXISTS chores (
    household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    id INTEGER NOT NULL, name TEXT, assignee INTEGER, day INTEGER, done INTEGER, pts INTEGER, icon TEXT,
    PRIMARY KEY (household_id, id)
  );
  CREATE TABLE IF NOT EXISTS shopping (
    household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    id INTEGER NOT NULL, name TEXT, qty TEXT, checked INTEGER, addedBy INTEGER, cat TEXT,
    PRIMARY KEY (household_id, id)
  );
  CREATE INDEX IF NOT EXISTS idx_events_hh ON events(household_id);
  CREATE INDEX IF NOT EXISTS idx_tx_hh ON transactions(household_id);
`);

// node:sqlite has no .transaction() helper — wrap manually.
function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch {}
    throw err;
  }
}

// ---- helpers ----
const TABLES = {
  members: ['id', 'name', 'role', 'status', 'color', 'init'],
  events: ['id', 'title', 'date', 'time', 'memberId', 'cat', 'descr'],
  transactions: ['id', 'type', 'cat', 'amount', 'date', 'memberId', 'note'],
  chores: ['id', 'name', 'assignee', 'day', 'done', 'pts', 'icon'],
  shopping: ['id', 'name', 'qty', 'checked', 'addedBy', 'cat']
};
const BOOL_COLS = { chores: ['done'], shopping: ['checked'] };

function replaceTable(table, hid, rows) {
  const cols = TABLES[table];
  const bools = BOOL_COLS[table] || [];
  db.prepare(`DELETE FROM ${table} WHERE household_id = ?`).run(hid);
  if (!Array.isArray(rows) || !rows.length) return;
  const placeholders = ['?', ...cols.map(() => '?')].join(', ');
  const stmt = db.prepare(
    `INSERT INTO ${table} (household_id, ${cols.join(', ')}) VALUES (${placeholders})`
  );
  let auto = -1;
  for (const row of rows) {
    const id = row.id != null ? row.id : auto--; // budgets-style rows have no id; synth negative
    const values = cols.map((c) => {
      if (c === 'id') return id;
      if (c === 'descr') return row.desc ?? row.descr ?? '';
      let v = row[c];
      if (bools.includes(c)) v = v ? 1 : 0;
      if (v === undefined) v = null;
      return v;
    });
    stmt.run(hid, ...values);
  }
}

function readTable(table, hid) {
  const cols = TABLES[table];
  const bools = BOOL_COLS[table] || [];
  const rows = db.prepare(`SELECT ${cols.join(', ')} FROM ${table} WHERE household_id = ? ORDER BY id`).all(hid);
  return rows.map((r) => {
    const out = {};
    for (const c of cols) {
      if (c === 'descr') { out.desc = r.descr; continue; }
      out[c] = bools.includes(c) ? r[c] === 1 : r[c];
    }
    return out;
  });
}

// ---- public API ----
export function emailExists(email) {
  return !!db.prepare('SELECT 1 FROM users WHERE email = ?').get(String(email).toLowerCase());
}

export function getUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).toLowerCase());
}

export function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

export function registerHousehold({ householdName, adminName, email, password }) {
  const seed = buildSeed(adminName);
  return tx(() => {
    const hh = db
      .prepare('INSERT INTO households (name, config) VALUES (?, ?)')
      .run(householdName || `${adminName}'s Home`, JSON.stringify(seed.config));
    const hid = Number(hh.lastInsertRowid);
    replaceTable('members', hid, seed.members);
    replaceTable('events', hid, seed.events);
    replaceTable('transactions', hid, seed.transactions);
    replaceTable('chores', hid, seed.chores);
    replaceTable('shopping', hid, seed.shopping);
    // alerts live in config so they sync as a unit with the activity log
    const cfg = { ...seed.config, alerts: seed.alerts };
    db.prepare('UPDATE households SET config = ? WHERE id = ?').run(JSON.stringify(cfg), hid);
    const user = db
      .prepare('INSERT INTO users (household_id, email, pass_hash, member_id) VALUES (?, ?, ?, ?)')
      .run(hid, String(email).toLowerCase(), hashPassword(password), 1);
    return { hid, uid: Number(user.lastInsertRowid), memberId: 1 };
  });
}

export function getState(hid) {
  const hh = db.prepare('SELECT name, config FROM households WHERE id = ?').get(hid);
  if (!hh) return null;
  const config = JSON.parse(hh.config || '{}');
  const alerts = config.alerts || [];
  delete config.alerts;
  return {
    householdName: hh.name,
    members: readTable('members', hid),
    events: readTable('events', hid),
    transactions: readTable('transactions', hid),
    chores: readTable('chores', hid),
    shopping: readTable('shopping', hid),
    alerts,
    ...config
  };
}

// Persist the full household state sent by the client (single source of truth on save).
export function putState(hid, state) {
  tx(() => {
    if (Array.isArray(state.members)) replaceTable('members', hid, state.members);
    if (Array.isArray(state.events)) replaceTable('events', hid, state.events);
    if (Array.isArray(state.transactions)) replaceTable('transactions', hid, state.transactions);
    if (Array.isArray(state.chores)) replaceTable('chores', hid, state.chores);
    if (Array.isArray(state.shopping)) replaceTable('shopping', hid, state.shopping);
    const config = {
      budgets: state.budgets, savings: state.savings, securityArmed: state.securityArmed,
      thermostat: state.thermostat, rooms: state.rooms, scenes: state.scenes,
      lights: state.lights, devices: state.devices, energy: state.energy,
      weather: state.weather, chorePoints: state.chorePoints, nid: state.nid,
      recurring: state.recurring, debts: state.debts, assistants: state.assistants,
      automations: state.automations, autoSeeded: state.autoSeeded,
      cctv: state.cctv,
      alerts: state.alerts || []
    };
    db.prepare('UPDATE households SET config = ? WHERE id = ?').run(JSON.stringify(config), hid);
    if (typeof state.householdName === 'string' && state.householdName.trim()) {
      db.prepare('UPDATE households SET name = ? WHERE id = ?').run(state.householdName.trim().slice(0, 80), hid);
    }
  });
  return true;
}

// Granular read endpoints (real REST surface over the normalized tables).
export const collection = (table, hid) => readTable(table, hid);
