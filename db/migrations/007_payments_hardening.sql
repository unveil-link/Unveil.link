-- 007: payments hardening after QA run 1 (additive; re-runnable). 001-006 untouched.

-- ---------------------------------------------------------------------------
-- Settings: session expiry, late-success grace, repeat-chargeback flagging (spec M5-08).
-- ---------------------------------------------------------------------------
ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS checkout_session_ttl_minutes integer NOT NULL DEFAULT 30
    CHECK (checkout_session_ttl_minutes BETWEEN 1 AND 10080),
  -- A processor-confirmed charge for a session that expired up to this long ago is still honoured (if drop/seller are valid);
  -- later than that it is booked, flagged for review and auto-refunded.
  ADD COLUMN IF NOT EXISTS checkout_late_success_grace_minutes integer NOT NULL DEFAULT 1440
    CHECK (checkout_late_success_grace_minutes BETWEEN 0 AND 43200),
  ADD COLUMN IF NOT EXISTS chargeback_flag_threshold integer NOT NULL DEFAULT 3
    CHECK (chargeback_flag_threshold >= 1),
  ADD COLUMN IF NOT EXISTS chargeback_flag_window_days integer NOT NULL DEFAULT 90
    CHECK (chargeback_flag_window_days BETWEEN 1 AND 3650);

-- ---------------------------------------------------------------------------
-- Seller risk flag (NOT verification_status: that field gates publishing/buying and is identity-verification state).
-- A flag only marks the account for admin review; it blocks nothing by itself (no auto-ban).
-- ---------------------------------------------------------------------------
ALTER TABLE sellers
  ADD COLUMN IF NOT EXISTS risk_flagged_at  timestamptz,
  ADD COLUMN IF NOT EXISTS risk_flag_reason text;
CREATE INDEX IF NOT EXISTS sellers_risk_flagged_idx ON sellers (risk_flagged_at) WHERE risk_flagged_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- transactions: checkout idempotency, stored checkout URL (for replays), review/auto-refund bookkeeping.
-- ---------------------------------------------------------------------------
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS idempotency_key     text,
  ADD COLUMN IF NOT EXISTS checkout_url        text,
  ADD COLUMN IF NOT EXISTS review_reason       text,          -- set when a charge was confirmed for a no-longer-valid checkout
  ADD COLUMN IF NOT EXISTS refund_requested_at timestamptz;   -- auto-refund asked of the provider
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_idempotency_key_len;
ALTER TABLE transactions ADD CONSTRAINT transactions_idempotency_key_len CHECK (idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 128);
-- Keys are namespaced by buyer email.
CREATE UNIQUE INDEX IF NOT EXISTS transactions_idem_key_uniq ON transactions (lower(buyer_email), idempotency_key) WHERE idempotency_key IS NOT NULL;

-- One live pending checkout per (drop, buyer): hard backstop for the advisory-lock logic in the app.
-- First retire pre-existing duplicates (keep the newest) so the index can be built on old data.
UPDATE transactions t SET status = 'failed', failure_code = 'superseded', updated_at = now()
 WHERE t.status = 'pending'
   AND EXISTS (SELECT 1 FROM transactions n
                WHERE n.status = 'pending' AND n.drop_id = t.drop_id AND lower(n.buyer_email) = lower(t.buyer_email)
                  AND (n.created_at, n.id) > (t.created_at, t.id));
CREATE UNIQUE INDEX IF NOT EXISTS transactions_one_pending_uniq ON transactions (drop_id, lower(buyer_email)) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS transactions_pending_created_idx ON transactions (created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS transactions_review_idx ON transactions (created_at) WHERE review_reason IS NOT NULL;
