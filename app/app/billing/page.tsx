import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import { BillingClient } from '@/components/billing/BillingClient';

export const runtime = 'nodejs';

export default async function BillingPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const plan: 'free' | 'pro' = user.plan === 'pro' ? 'pro' : 'free';
  const periodEnd = user.current_period_end ? new Date(user.current_period_end).toISOString() : null;

  return (
    <Suspense fallback={<div className="card p-6 max-w-2xl mx-auto text-sm text-[var(--muted)]">Loading billing…</div>}>
      <BillingClient plan={plan} status={user.subscription_status} periodEnd={periodEnd} />
    </Suspense>
  );
}
