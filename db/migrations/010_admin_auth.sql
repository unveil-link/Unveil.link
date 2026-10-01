-- 010: admin authentication foundation + seller-flag review. Additive + re-runnable. 001-009 untouched.
-- Admins are a SEPARATE principal from sellers: own credentials, own session table, own cookie, own signing key derivation.
-- There is deliberately NO seeded/default admin; create one with `npm run create-admin -- <email>`.
ALTER TABLE admins
  ADD COLUMN IF NOT EXISTS password_hash  text,
  ADD COLUMN IF NOT EXISTS disabled_at    timestamptz,
  ADD COLUMN IF NOT EXISTS last_login_at  timestamptz;
ALTER TABLE admins DROP CONSTRAINT IF EXISTS admins_email_lowercase;
ALTER TABLE admins ADD CONSTRAINT admins_email_lowercase CHECK (email = lower(email)) NOT VALID; -- new rows only; legacy rows (none expected) untouched

CREATE TABLE IF NOT EXISTS admin_sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    uuid NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  user_agent  text
);
CREATE INDEX IF NOT EXISTS admin_sessions_admin_active_idx ON admin_sessions (admin_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS admin_sessions_expires_idx ON admin_sessions (expires_at);

-- "Clear flag" bookkeeping: who reviewed the seller, when, and why. (The flag itself is risk_flagged_at, set by 007.)
ALTER TABLE sellers
  ADD COLUMN IF NOT EXISTS risk_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS risk_reviewed_by uuid REFERENCES admins(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS risk_review_note text;
