/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
