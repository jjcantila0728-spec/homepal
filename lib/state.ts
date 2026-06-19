import { queryOne, query } from './db';
import type { HouseholdState } from './seed';

// Load the household state for the given user. Resolves the household by the
// user's household_id, so any member account (not just the owner) reaches the
// shared household.
export async function loadState(userId: string): Promise<HouseholdState | null> {
  const row = await queryOne<{ state: HouseholdState }>(
    `SELECT h.state FROM households h
     JOIN users u ON u.household_id = h.id
     WHERE u.id = $1
     LIMIT 1`,
    [userId],
  );
  return row?.state ?? null;
}

// Replace the household state wholesale (the client is the source of truth on save).
// Keyed on the user's household_id so members and the owner write the same household.
export async function saveState(userId: string, state: HouseholdState): Promise<boolean> {
  const rows = await query(
    `UPDATE households SET state = $1, updated_at = now()
     WHERE id = (SELECT household_id FROM users WHERE id = $2)
     RETURNING id`,
    [state, userId],
  );
  return rows.length > 0;
}

// Pull a single collection out of the stored jsonb (read-only REST surface).
export async function collection(userId: string, key: string): Promise<unknown[]> {
  const row = await queryOne<{ items: unknown[] }>(
    `SELECT COALESCE(h.state -> $2, '[]'::jsonb) AS items FROM households h
     JOIN users u ON u.household_id = h.id WHERE u.id = $1`,
    [userId, key],
  );
  return Array.isArray(row?.items) ? row.items : [];
}
