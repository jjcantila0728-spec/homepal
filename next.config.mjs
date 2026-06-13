/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Run pending DB migrations once at server boot (see lib/migrate.ts, imported by instrumentation.ts).
  experimental: {
    instrumentationHook: true,
  },
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
