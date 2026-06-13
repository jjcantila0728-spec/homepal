import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'HomePal — Family Hub',
  description:
    'HomePal is an all-in-one family hub: shared calendar, finances, smart-home control, chores, and shopping — all in one place.',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg', apple: '/icon.svg' },
  appleWebApp: { capable: true, title: 'HomePal', statusBarStyle: 'black-translucent' },
  openGraph: {
    type: 'website',
    title: 'HomePal — Family Hub',
    description:
      'Shared calendar, finances, smart-home control, chores, and shopping — all in one place.',
  },
  twitter: { card: 'summary' },
};

export const viewport: Viewport = {
  themeColor: '#0B1120',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Production-safe CDN stylesheets (icons + fonts). Tailwind itself is now compiled. */}
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <div className="ambient" aria-hidden="true">
          <div className="ambient-orb" style={{ width: 500, height: 500, background: 'var(--accent)', top: '10%', left: '15%' }} />
          <div className="ambient-orb" style={{ width: 400, height: 400, background: 'var(--amber)', top: '55%', right: '5%', animationDelay: '-8s' }} />
          <div className="ambient-orb" style={{ width: 350, height: 350, background: 'var(--pink)', bottom: '5%', left: '35%', animationDelay: '-15s' }} />
        </div>
        {children}
      </body>
    </html>
  );
}
