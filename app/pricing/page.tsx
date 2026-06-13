import Link from 'next/link';
import { getSessionUser } from '@/lib/session';
import { PLANS } from '@/lib/stripe';

export const runtime = 'nodejs';

export const metadata = {
  title: 'Pricing — HomePal',
  description: 'Start free with the core family hub. Upgrade to Pro for smart-home control, automations, CCTV, voice, and unlimited members.',
};

export default async function PricingPage() {
  const user = await getSessionUser();
  const loggedIn = !!user;
  const proHref = loggedIn ? '/app/billing' : '/register';
  const freeHref = loggedIn ? '/app' : '/register';

  return (
    <div style={{ height: '100vh', overflowY: 'auto' }}>
      <main className="relative z-10 min-h-screen flex flex-col items-center px-6 py-14">
        {/* Header */}
        <Link href="/" className="flex items-center gap-3 mb-10">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
            <i className="fa-solid fa-house-chimney text-white" />
          </div>
          <span className="text-xl font-bold tracking-tight" style={{ fontFamily: 'Space Grotesk' }}>
            HomePal
          </span>
        </Link>

        <h1 className="text-4xl sm:text-5xl font-bold text-center grad-text" style={{ fontFamily: 'Space Grotesk' }}>
          Simple, honest pricing
        </h1>
        <p className="text-[var(--muted)] max-w-xl text-center mt-4 text-base sm:text-lg">
          The core family hub is free forever. Unlock the connected smart home whenever you&apos;re ready.
        </p>

        {/* Plans */}
        <div className="grid sm:grid-cols-2 gap-5 mt-10 w-full max-w-3xl">
          {(['free', 'pro'] as const).map((id) => {
            const plan = PLANS[id];
            const isPro = id === 'pro';
            return (
              <div
                key={id}
                className="card p-7 flex flex-col"
                style={isPro ? { border: '1.5px solid var(--accent)', boxShadow: '0 8px 40px var(--accent-g)' } : undefined}
              >
                <div className="flex items-center justify-between mb-1">
                  <h2 className="text-lg font-bold" style={{ fontFamily: 'Space Grotesk' }}>
                    {plan.name}
                  </h2>
                  {isPro && (
                    <span
                      className="text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full"
                      style={{ background: 'var(--accent-g)', color: 'var(--accent)' }}
                    >
                      Most popular
                    </span>
                  )}
                </div>
                <p className="text-xs text-[var(--muted)] mb-4">{plan.tagline}</p>
                <div className="flex items-end gap-1 mb-5">
                  <span className="text-4xl font-bold" style={{ fontFamily: 'Space Grotesk' }}>
                    ${plan.price}
                  </span>
                  <span className="text-sm text-[var(--muted)] mb-1.5">/month</span>
                </div>
                <ul className="space-y-2.5 mb-6 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-sm">
                      <i
                        className="fa-solid fa-check mt-0.5 flex-shrink-0"
                        style={{ color: isPro ? 'var(--accent)' : 'var(--muted)' }}
                      />
                      <span className={isPro ? '' : 'text-[var(--fg)]'}>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  href={isPro ? proHref : freeHref}
                  className={`btn ${isPro ? 'btn-primary' : 'btn-secondary'} w-full justify-center !py-3`}
                >
                  {isPro ? plan.cta : loggedIn ? 'Go to your hub' : plan.cta}
                </Link>
              </div>
            );
          })}
        </div>

        <p className="text-xs text-[var(--muted)] mt-8 max-w-md text-center">
          Cancel anytime from the billing portal. Smart-home recording (CCTV) and device discovery
          require running HomePal on your home network.
        </p>
        <Link href="/" className="text-xs text-[var(--accent)] font-semibold mt-6">
          ← Back home
        </Link>
      </main>
    </div>
  );
}
