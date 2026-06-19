// Pure, isomorphic helpers for connector data ingestion. NO network, NO env, NO
// server-only imports — safe to use from the client store AND unit-test directly.
// The OpenAI call lives in lib/ai/extract.ts and reuses these to validate output.

import type { CalEvent, Transaction } from '@/lib/types';

// Normalized rows the model is asked to produce (before they become domain items).
export interface ShiftRow {
  date: string; // "YYYY-MM-DD"
  start: string; // "HH:MM"
  end?: string; // "HH:MM"
  title?: string;
  category?: string;
}

export interface TxnRow {
  date: string; // "YYYY-MM-DD"
  amount: number; // positive magnitude
  type: 'income' | 'expense';
  category?: string;
  description?: string;
}

const MAX_ROWS = 200;

// ---- field normalizers -------------------------------------------------------

// Coerce common date spellings to "YYYY-MM-DD", or null if unparseable.
// Two-part-then-year (e.g. 3/7/2026) is read US-style (month first).
export function normDate(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const s = input.trim();
  let y: number, mo: number, d: number;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) {
    y = +m[1]; mo = +m[2]; d = +m[3];
  } else if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) {
    mo = +m[1]; d = +m[2]; y = +m[3];
  } else {
    return null;
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1970 || y > 9999) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Coerce common time spellings to 24h "HH:MM", or null. Handles "7", "7:30",
// "7:30 AM", "7pm", "19:30".
export function normTime(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const s = input.trim().toLowerCase();
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = +m[1];
  const min = m[2] ? +m[2] : 0;
  const ap = m[3];
  if (min > 59) return null;
  if (ap) {
    if (h < 1 || h > 12) return null;
    if (ap === 'am') h = h === 12 ? 0 : h;
    else h = h === 12 ? 12 : h + 12;
  } else if (h > 23) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function asArray(raw: unknown, ...keys: string[]): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    for (const k of keys) {
      const v = (raw as Record<string, unknown>)[k];
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

function str(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t || undefined;
}

// ---- row validation ----------------------------------------------------------

// Validate the model's shift output into clean ShiftRows. Malformed rows are
// dropped (never thrown); a row needs at least a parseable date + start time.
export function parseShiftRows(raw: unknown): ShiftRow[] {
  const out: ShiftRow[] = [];
  for (const r of asArray(raw, 'shifts', 'events', 'items')) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const date = normDate(o.date ?? o.day);
    const start = normTime(o.start ?? o.startTime ?? o.time ?? o.from);
    if (!date || !start) continue;
    const end = normTime(o.end ?? o.endTime ?? o.to);
    const row: ShiftRow = { date, start };
    if (end && end > start) row.end = end;
    const title = str(o.title ?? o.name ?? o.label);
    if (title) row.title = title;
    const category = str(o.category ?? o.cat);
    if (category) row.category = category;
    out.push(row);
    if (out.length >= MAX_ROWS) break;
  }
  return out;
}

// Validate the model's transaction output into clean TxnRows. A row needs a
// parseable date + nonzero numeric amount. Type comes from an explicit field, or
// is inferred from the sign (negative => expense).
export function parseTxnRows(raw: unknown): TxnRow[] {
  const out: TxnRow[] = [];
  for (const r of asArray(raw, 'transactions', 'txns', 'items')) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const date = normDate(o.date);
    const amtRaw = typeof o.amount === 'number' ? o.amount : parseFloat(String(o.amount ?? '').replace(/[$,\s]/g, ''));
    if (!date || !Number.isFinite(amtRaw) || amtRaw === 0) continue;
    const explicit = str(o.type)?.toLowerCase();
    const type: 'income' | 'expense' =
      explicit === 'income' || explicit === 'credit' || explicit === 'deposit'
        ? 'income'
        : explicit === 'expense' || explicit === 'debit' || explicit === 'withdrawal'
          ? 'expense'
          : amtRaw < 0
            ? 'expense'
            : 'income';
    const row: TxnRow = { date, amount: Math.abs(amtRaw), type };
    const category = str(o.category ?? o.cat);
    if (category) row.category = category;
    const description = str(o.description ?? o.note ?? o.merchant ?? o.name);
    if (description) row.description = description;
    out.push(row);
    if (out.length >= MAX_ROWS) break;
  }
  return out;
}

// ---- mapping to domain items -------------------------------------------------

export interface MapOpts {
  connectionId: number;
  memberId: number;
  idStart: number; // ids are assigned idStart+1, idStart+2, … (caller advances nid)
}

export function mapToEvents(rows: ShiftRow[], opts: MapOpts): CalEvent[] {
  return rows.map((r, i) => ({
    id: opts.idStart + i + 1,
    title: r.title || 'Work shift',
    date: r.date,
    time: r.start,
    endTime: r.end,
    memberId: opts.memberId,
    cat: (r.category || 'work').toLowerCase(),
    source: 'connector' as const,
    connectionId: opts.connectionId,
  }));
}

export function mapToTxns(rows: TxnRow[], opts: MapOpts): Transaction[] {
  return rows.map((r, i) => ({
    id: opts.idStart + i + 1,
    type: r.type,
    cat: r.category || (r.type === 'income' ? 'Salary' : 'Other'),
    amount: r.amount,
    date: r.date,
    memberId: opts.memberId,
    note: r.description || (r.type === 'income' ? 'Income' : 'Purchase'),
    source: 'connector' as const,
    connectionId: opts.connectionId,
  }));
}
