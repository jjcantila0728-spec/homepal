import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import { loadState } from '@/lib/state';
import { HouseholdProvider } from '@/store/household';
import { AppShell } from '@/components/shell/AppShell';
import type { Plan } from '@/lib/types';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const state = await loadState(user.id);
  if (!state) redirect('/login');

  const plan: Plan = user.plan === 'pro' ? 'pro' : 'free';

  return (
    <HouseholdProvider
      initialState={state}
      initialPlan={plan}
      initialUserId={user.member_id ?? undefined}
      initialIsAdmin={user.role === 'admin'}
    >
      <AppShell>{children}</AppShell>
    </HouseholdProvider>
  );
}
