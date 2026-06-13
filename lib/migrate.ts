import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { getPool } from './db';

// Applies any db/migrations/*.sql files that haven't run yet. Idempotent and
// safe to call at every boot — already-applied files are skipped.
let ran = false;

export async function runMigrations(): Promise<void> {
  if (ran) return;
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  const dir = path.join(process.cwd(), 'db', 'migrations');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const applied = new Set(
    (await pool.query<{ name: string }>('SELECT name FROM _migrations')).rows.map((r) => r.name),
  );

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(path.join(dir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      // eslint-disable-next-line no-console
      console.log(`[migrate] applied ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
  ran = true;
}
