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
