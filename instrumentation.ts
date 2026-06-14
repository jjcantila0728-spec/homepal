// Next.js calls register() once when the server process boots.
// We use it to apply pending DB migrations so deploys are self-applying.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.DATABASE_URL) {
    const { runMigrations } = await import('./lib/migrate');
    try {
      await runMigrations();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[migrate] failed:', err);
    }
  }
}

// TEMP (debug): surface the real server-side render error. Production redacts
// error details from the client, so log the full stack here to diagnose the
// Cantila-only RSC 500. Remove once the render crash is fixed.
export async function onRequestError(
  err: unknown,
  request: { path?: string },
): Promise<void> {
  const e = err as { stack?: string; message?: string };
  // eslint-disable-next-line no-console
  console.error('[onRequestError]', request?.path, e?.stack || e?.message || err);
}
