'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useHousehold } from '@/store/household';

interface Props {
  plan: 'free' | 'pro';
  status: string | null;
  periodEnd: string | null;
}

const PRO_FEATURES = [
  { ic: 'fa-house-signal', t: 'Smart-home device control' },
  { ic: 'fa-wand-magic-sparkles', t: 'Automations & scenes' },
  { ic: 'fa-video', t: 'CCTV recording & storage' },
  { ic: 'fa-microphone', t: 'Voice assistant control' },
  { ic: 'fa-wifi', t: 'Device discovery & pairing' },
  { ic: 'fa-users', t: 'Unlimited family members' },
];

export function BillingClient({ plan, status, periodEnd }: Props) {
  const { toast } = useHousehold();
  const router = useRouter();
  const params = useSearchParams();
  const [busy, setBusy] = useState<'checkout' | 'portal' | null>(null);

  const isPro = plan === 'pro';

  // Surface the Stripe redirect result once, then clean the URL.
  useEffect(() => {
    if (params.get('success')) {
      toast('Welcome to Pro! Your smart home is unlocked.', 'success');
      router.replace('/app/billing');
      router.refresh();
    } else if (params.get('canceled')) {
      toast('Checkout canceled — no charge was made.', 'info');
      router.replace('/app/billing');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function go(kind: 'checkout' | 'portal') {
    if (busy) return;
    setBusy(kind);
    try {
      const res = await fetch(`/api/stripe/${kind}`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error || 'Something went wrong');
      window.location.href = data.url;
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Something went wrong', 'error');
      setBusy(null);
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      {/* Current plan */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-xs text-[var(--muted)] uppercase tracking-wide mb-1">Current plan</div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-2xl font-bold" style={{ fontFamily: 'Space Grotesk' }}>
                {isPro ? 'Pro' : 'Free'}
              </h2>
              {isPro && (
                <span
                  className="text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full"
                  style={{ background: 'var(--accent-g)', color: 'var(--accent)' }}
                >
                  Active
                </span>
              )}
            </div>
          </div>
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center"
            style={{ background: 'var(--accent-g)' }}
          >
            <i className={`fa-solid ${isPro ? 'fa-crown' : 'fa-house'} text-lg`} style={{ color: 'var(--accent)' }} />
          </div>
        </div>

        {isPro ? (
          <>
            <p className="text-sm text-[var(--muted)]">
              You have full access to the connected smart home.
              {status && status !== 'active' && (
                <span className="text-[var(--amber)]"> Subscription status: {status}.</span>
              )}
              {periodEnd && <> Renews {new Date(periodEnd).toLocaleDateString()}.</>}
            </p>
            <button className="btn btn-secondary mt-5" onClick={() => go('portal')} disabled={busy !== null}>
              <i className="fa-solid fa-gear" />
              {busy === 'portal' ? 'Opening…' : 'Manage subscription'}
            </button>
          </>
        ) : (
          <p className="text-sm text-[var(--muted)]">
            You&apos;re on the free plan — the full family hub for calendar, finance, chores, and family.
            Upgrade to unlock the connected smart home.
          </p>
        )}
      </div>

      {/* Upgrade card (free only) */}
      {!isPro && (
        <div className="card p-6" style={{ border: '1.5px solid var(--accent)', boxShadow: '0 8px 40px var(--accent-g)' }}>
          <div className="flex items-end justify-between mb-4">
            <div>
              <h3 className="text-lg font-bold" style={{ fontFamily: 'Space Grotesk' }}>
                Upgrade to Pro
              </h3>
              <p className="text-xs text-[var(--muted)]">Unlock the connected smart home.</p>
            </div>
            <div className="flex items-end gap-1">
              <span className="text-3xl font-bold" style={{ fontFamily: 'Space Grotesk' }}>$9</span>
              <span className="text-sm text-[var(--muted)] mb-1">/mo</span>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-3 mb-5">
            {PRO_FEATURES.map((f) => (
              <div key={f.t} className="flex items-center gap-2.5 text-sm">
                <i className={`fa-solid ${f.ic} flex-shrink-0`} style={{ color: 'var(--accent)' }} />
                <span>{f.t}</span>
              </div>
            ))}
          </div>
          <button className="btn btn-primary w-full justify-center !py-3" onClick={() => go('checkout')} disabled={busy !== null}>
            <i className="fa-solid fa-crown" />
            {busy === 'checkout' ? 'Redirecting to checkout…' : 'Upgrade to Pro'}
          </button>
          <p className="text-[11px] text-[var(--muted)] text-center mt-3">
            Secure checkout via Stripe. Cancel anytime.
          </p>
        </div>
      )}
    </div>
  );
}
