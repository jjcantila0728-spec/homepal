import { Pool, type PoolClient, type QueryResultRow } from 'pg';

// Single shared pool across hot-reloads in dev.
const globalForDb = globalThis as unknown as { _hpPool?: Pool };

function makePool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
  }
  // Only negotiate TLS when the connection explicitly asks for it. Managed
  // Postgres on the same private network (e.g. Cantila) often does NOT support
  // SSL — forcing it throws "The server does not support SSL connections" and
  // breaks every query. Opt in via `?sslmode=require` or PGSSL=1.
  const wantSsl = /sslmode=require/.test(connectionString) || process.env.PGSSL === '1';
  const pool = new Pool({
    connectionString,
    ssl: wantSsl ? { rejectUnauthorized: false } : undefined,
    max: 10,
  });
  // A pg Pool with no 'error' listener crashes the whole Node process when an
  // idle client errors (unhandled EventEmitter 'error'), taking every route —
  // even static pages — down. Swallow & log instead.
  pool.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error('[db] idle client error:', err.message);
  });
  return pool;
}

export function getPool(): Pool {
  if (!globalForDb._hpPool) globalForDb._hpPool = makePool();
  return globalForDb._hpPool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await getPool().query<T>(text, params as never[]);
  return res.rows;
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

// Run a function inside a transaction; rolls back on throw.
export async function tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore rollback failure */
    }
    throw err;
  } finally {
    client.release();
  }
}
