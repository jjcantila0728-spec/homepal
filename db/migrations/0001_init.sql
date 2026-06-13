-- HomePal SaaS: users + households (whole household state stored as jsonb).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email               text UNIQUE NOT NULL,
  password_hash       text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  stripe_customer_id  text,
  plan                text NOT NULL DEFAULT 'free',
  subscription_status text,
  current_period_end  timestamptz
);

CREATE TABLE IF NOT EXISTS households (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state         jsonb NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_households_owner ON households (owner_user_id);
