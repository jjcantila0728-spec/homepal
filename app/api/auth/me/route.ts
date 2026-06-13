import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';

export const runtime = 'nodejs';

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      plan: user.plan,
      subscriptionStatus: user.subscription_status,
      currentPeriodEnd: user.current_period_end,
    },
  });
}
