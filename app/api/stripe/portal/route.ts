import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { getStripe, getOrCreateCustomer } from '@/lib/stripe';

export const runtime = 'nodejs';

export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) return NextResponse.json({ error: 'NEXT_PUBLIC_APP_URL is not set' }, { status: 500 });

  try {
    const customer = await getOrCreateCustomer(user);
    const session = await getStripe().billingPortal.sessions.create({
      customer,
      return_url: `${appUrl}/app/billing`,
    });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Portal session failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
