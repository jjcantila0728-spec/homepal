-- Member accounts: every family member gets their own login, linked to the
-- shared household and to an existing member profile, with a role. Existing
-- single-login owners are backfilled as the household admin claiming their
-- admin member profile, so no data is lost.

ALTER TABLE users ADD COLUMN IF NOT EXISTS household_id uuid REFERENCES households(id) ON DELETE CASCADE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS member_id int;
ALTER TABLE users ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'member';
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

-- Backfill existing owners -> their household, as admin, claiming the admin
-- member profile (falls back to member id 1, the seed's registering admin).
UPDATE users u
SET household_id = h.id,
    role = 'admin',
    member_id = COALESCE((
      SELECT (m->>'id')::int
      FROM jsonb_array_elements(h.state->'members') m
      WHERE m->>'role' = 'admin'
      ORDER BY (m->>'id')::int
      LIMIT 1
    ), 1)
FROM households h
WHERE h.owner_user_id = u.id AND u.household_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_household ON users (household_id);
-- One account per member profile within a household.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_household_member
  ON users (household_id, member_id) WHERE member_id IS NOT NULL;
