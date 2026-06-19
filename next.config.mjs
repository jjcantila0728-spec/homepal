/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // PGlite (embedded Postgres for local dev) ships WASM + extension bundles that
  // must load from node_modules, not be processed by webpack. Keep it external.
  serverExternalPackages: ['@electric-sql/pglite'],
  // Pending DB migrations run once at server boot via instrumentation.ts (on by default in Next 15).
  async headers() {
    return [
      {
        source: '/manifest.webmanifest',
        headers: [{ key: 'Content-Type', value: 'application/manifest+json' }],
      },
    ];
  },
};

export default nextConfig;
