import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { getStripe, getOrCreateCustomer, getProPriceId } from '@/lib/stripe';

export const runtime = 'nodejs';

export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) return NextResponse.json({ error: 'NEXT_PUBLIC_APP_URL is not set' }, { status: 500 });

  try {
    const customer = await getOrCreateCustomer(user);
    const session = await getStripe().checkout.sessions.create({
      mode: 'subscription',
      customer,
      line_items: [{ price: getProPriceId(), quantity: 1 }],
      allow_promotion_codes: true,
      success_url: `${appUrl}/app/billing?success=1`,
      cancel_url: `${appUrl}/app/billing?canceled=1`,
      metadata: { userId: user.id },
    });

    if (!session.url) {
      return NextResponse.json({ error: 'Failed to create checkout session' }, { status: 500 });
    }
    return NextResponse.json({ url: session.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Checkout failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
