/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // TEMP (debug): keep server chunks readable so production stack traces point
  // at real source instead of minified `o`/`chunks/407.js`. Remove once the
  // Cantila runtime 500 is diagnosed.
  experimental: { serverMinification: false },
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
