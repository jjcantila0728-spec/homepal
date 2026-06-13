import Stripe from 'stripe';
import { query } from './db';
import type { SessionUser } from './session';

// ---------------------------------------------------------------------------
// Lazy Stripe client. NEVER instantiate at import time — `next build`'s
// page-data collection imports route modules, and a missing key at import
// time would crash the build. We only touch process.env when actually called.
// ---------------------------------------------------------------------------
let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
  _stripe = new Stripe(key, { apiVersion: '2024-12-18.acacia' });
  return _stripe;
}

export type PlanId = 'free' | 'pro';

export interface PlanConfig {
  id: PlanId;
  name: string;
  tagline: string;
  /** Display price in USD per month. */
  price: number;
  /** Stripe Price id — only set for paid plans (read lazily). */
  priceId?: () => string | undefined;
  features: string[];
  cta: string;
}

export const PLANS: Record<PlanId, PlanConfig> = {
  free: {
    id: 'free',
    name: 'Free',
    tagline: 'The core family hub, forever free.',
    price: 0,
    features: [
      'Shared calendar & schedule',
      'Household finance tracking',
      'Chores & shopping lists',
      'Up to 4 family members',
      'Dashboard & notifications',
    ],
    cta: 'Get started',
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    tagline: 'Unlock the connected smart home.',
    price: 9,
    priceId: () => process.env.STRIPE_PRICE_PRO,
    features: [
      'Everything in Free',
      'Smart-home device control',
      'Automations & scenes',
      'CCTV recording & storage',
      'Voice assistant control',
      'Device discovery & pairing',
      'Unlimited family members',
    ],
    cta: 'Upgrade to Pro',
  },
};

/** Resolve the configured Pro price id, throwing only when actually needed. */
export function getProPriceId(): string {
  const id = process.env.STRIPE_PRICE_PRO;
  if (!id) throw new Error('STRIPE_PRICE_PRO is not set');
  return id;
}

/**
 * Return the Stripe customer id for a user, creating (and persisting) one on
 * first use. Persists to users.stripe_customer_id when newly created.
 */
export async function getOrCreateCustomer(user: SessionUser): Promise<string> {
  if (user.stripe_customer_id) return user.stripe_customer_id;

  const customer = await getStripe().customers.create({
    email: user.email,
    metadata: { userId: user.id },
  });

  await query('UPDATE users SET stripe_customer_id = $1 WHERE id = $2', [customer.id, user.id]);
  return customer.id;
}
