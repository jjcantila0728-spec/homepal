import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';
import { query } from '@/lib/db';

export const runtime = 'nodejs';

// Machine-to-machine endpoint (no session cookie; excluded from middleware).
// Verify the signature against the RAW request body, then sync the matching
// user row by stripe_customer_id.

function periodEnd(value: number | null | undefined): Date | null {
  return typeof value === 'number' ? new Date(value * 1000) : null;
}

async function syncSubscription(sub: Stripe.Subscription): Promise<void> {
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  const active = sub.status === 'active' || sub.status === 'trialing';
  const plan = active ? 'pro' : 'free';
  await query(
    `UPDATE users
        SET plan = $1,
            subscription_status = $2,
            current_period_end = $3,
            stripe_customer_id = $4
      WHERE stripe_customer_id = $4`,
    [plan, sub.status, periodEnd(sub.current_period_end), customerId],
  );
}

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: 'STRIPE_WEBHOOK_SECRET is not set' }, { status: 500 });

  const sig = req.headers.get('stripe-signature');
  if (!sig) return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 });

  const body = await req.text(); // RAW body required for signature verification

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, sig, secret);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid signature';
    return NextResponse.json({ error: `Webhook signature verification failed: ${message}` }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
        if (session.subscription && customerId) {
          const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
          const sub = await getStripe().subscriptions.retrieve(subId);
          await syncSubscription(sub);
        } else if (customerId) {
          await query(
            `UPDATE users SET plan = 'pro', subscription_status = 'active' WHERE stripe_customer_id = $1`,
            [customerId],
          );
        }
        break;
      }
      case 'customer.subscription.updated': {
        await syncSubscription(event.data.object as Stripe.Subscription);
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
        await query(
          `UPDATE users
              SET plan = 'free',
                  subscription_status = $1,
                  current_period_end = $2
            WHERE stripe_customer_id = $3`,
          [sub.status, periodEnd(sub.current_period_end), customerId],
        );
        break;
      }
      default:
        // Unhandled event types are acknowledged so Stripe stops retrying.
        break;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Webhook handler error';
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
