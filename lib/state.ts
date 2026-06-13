import { queryOne, query } from './db';
import type { HouseholdState } from './seed';

// Load the authenticated user's household state (one household per user).
export async function loadState(userId: string): Promise<HouseholdState | null> {
  const row = await queryOne<{ state: HouseholdState }>(
    'SELECT state FROM households WHERE owner_user_id = $1 ORDER BY updated_at LIMIT 1',
    [userId],
  );
  return row?.state ?? null;
}

// Replace the household state wholesale (the client is the source of truth on save).
export async function saveState(userId: string, state: HouseholdState): Promise<boolean> {
  const rows = await query(
    `UPDATE households SET state = $1, updated_at = now() WHERE owner_user_id = $2 RETURNING id`,
    [state, userId],
  );
  return rows.length > 0;
}

// Pull a single collection out of the stored jsonb (read-only REST surface).
export async function collection(userId: string, key: string): Promise<unknown[]> {
  const row = await queryOne<{ items: unknown[] }>(
    `SELECT COALESCE(state -> $2, '[]'::jsonb) AS items FROM households WHERE owner_user_id = $1`,
    [userId, key],
  );
  return Array.isArray(row?.items) ? row.items : [];
}
