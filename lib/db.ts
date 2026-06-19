import { Pool, type QueryResultRow } from 'pg';

// HomePal speaks Postgres everywhere. In production DATABASE_URL is a
// `postgres://` URL (Cantila / managed PG). For local dev without a server or
// credentials, point DATABASE_URL at an embedded PGlite store, e.g.
//   DATABASE_URL=pglite://./data/dev
// PGlite is Postgres compiled to WASM, so every query/migration runs unchanged.

export interface DbResult<T extends QueryResultRow = QueryResultRow> {
  rows: T[];
  rowCount: number;
}

export interface DbClient {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<DbResult<T>>;
  release(): void;
}

export interface DbPool {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<DbResult<T>>;
  connect(): Promise<DbClient>;
  on(event: 'error', cb: (err: Error) => void): void;
}

// Single shared pool across hot-reloads in dev.
const globalForDb = globalThis as unknown as { _hpPool?: DbPool };

function usePglite(connectionString: string | undefined): boolean {
  // pg if it's a real Postgres URL; otherwise fall back to embedded PGlite.
  return !connectionString || !/^postgres(ql)?:\/\//i.test(connectionString);
}

function makePgPool(connectionString: string): DbPool {
  // Only negotiate TLS when the connection explicitly asks for it. Managed
  // Postgres on the same private network (e.g. Cantila) often does NOT support
  // SSL — forcing it throws "The server does not support SSL connections" and
  // breaks every query. Opt in via an `sslmode=` query param or PGSSL=1.
  const wantSsl = /sslmode=(require|verify-ca|verify-full|prefer|no-verify)/.test(connectionString) ||
    process.env.PGSSL === '1';
  // Strip any `sslmode=` from the string: newer pg treats require/verify-ca as
  // verify-full, which rejects Supabase's pooler cert chain ("self-signed
  // certificate in certificate chain") and overrides the ssl option below.
  // We control TLS verification exclusively through the explicit ssl option.
  const cleanedConnectionString = connectionString.replace(/([?&])sslmode=[^&]*(&|$)/, (_m, pre, post) =>
    post === '&' ? pre : '',
  );
  const pool = new Pool({
    connectionString: cleanedConnectionString,
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
  return pool as unknown as DbPool;
}

function makePglitePool(connectionString: string | undefined): DbPool {
  // Resolve the on-disk data directory from `pglite://<dir>` or `file:<dir>`.
  let dataDir = './data/pglite';
  if (connectionString) {
    const dir = connectionString.replace(/^pglite:\/\//i, '').replace(/^file:(\/\/)?/i, '');
    if (dir) dataDir = dir;
  }

  // PGlite initialises asynchronously; share one instance lazily.
  let dbPromise: Promise<{
    query: (t: string, p?: unknown[]) => Promise<{ rows: unknown[]; affectedRows?: number }>;
    exec: (t: string) => Promise<Array<{ rows: unknown[] }>>;
  }> | null = null;

  async function db() {
    if (!dbPromise) {
      dbPromise = (async () => {
        const { PGlite } = await import('@electric-sql/pglite');
        const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
        // eslint-disable-next-line no-console
        console.log(`[db] using embedded PGlite at ${dataDir}`);
        return new PGlite(dataDir, { extensions: { pgcrypto } }) as never;
      })();
    }
    return dbPromise;
  }

  async function run<T extends QueryResultRow>(text: string, params?: unknown[]): Promise<DbResult<T>> {
    const d = await db();
    if (params && params.length) {
      // jsonb/json columns expect serialised values; PGlite won't auto-encode
      // plain objects/arrays, so stringify them (all object params here are jsonb).
      const encoded = params.map((v) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v));
      const res = await d.query(text, encoded);
      const rows = (res.rows ?? []) as T[];
      // pg's rowCount = rows returned (SELECT) OR rows affected (DML). PGlite
      // reports affectedRows: 0 for SELECT, so prefer the actual row count.
      return { rows, rowCount: rows.length || res.affectedRows || 0 };
    }
    // No params: may be multi-statement DDL (a whole migration file) or
    // BEGIN/COMMIT — `.exec()` handles multiple statements; `.query()` doesn't.
    const results = await d.exec(text);
    const last = results[results.length - 1];
    const rows = (last?.rows ?? []) as T[];
    return { rows, rowCount: rows.length };
  }

  return {
    query: run,
    connect: async () => ({ query: run, release: () => {} }),
    on: () => {},
  };
}

export function getPool(): DbPool {
  if (!globalForDb._hpPool) {
    const connectionString = process.env.DATABASE_URL;
    globalForDb._hpPool = usePglite(connectionString)
      ? makePglitePool(connectionString)
      : makePgPool(connectionString as string);
  }
  return globalForDb._hpPool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await getPool().query<T>(text, params);
  return res.rows;
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

// Postgres/network errors that mean "the database is unreachable or down",
// as opposed to a normal query/constraint error. Used by API routes to return
// a clean 503 instead of leaking a stack trace as a 500.
const CONNECTIVITY_CODES = new Set([
  'ENOTFOUND', // DNS can't resolve host (e.g. unreachable managed-DB host)
  'ECONNREFUSED', // nothing listening on host:port
  'ETIMEDOUT', // connection attempt timed out
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ECONNRESET',
  '57P03', // PG: cannot_connect_now (server starting up/shutting down)
  '53300', // PG: too_many_connections
  '08001', // PG: sqlclient_unable_to_establish_sqlconnection
  '08006', // PG: connection_failure
]);

export function isDbConnectivityError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return typeof code === 'string' && CONNECTIVITY_CODES.has(code);
}

// Run a function inside a transaction; rolls back on throw.
export async function tx<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
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
