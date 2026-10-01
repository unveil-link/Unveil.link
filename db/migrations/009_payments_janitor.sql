-- 009: payments janitor (scheduled cleanup). Additive + re-runnable. 001-008 untouched.

-- Void-refund retry bookkeeping (cap attempts, exponential backoff, keep the last provider error).
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS void_refund_attempts        integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS void_refund_last_error      text,
  ADD COLUMN IF NOT EXISTS void_refund_last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS void_refund_next_attempt_at timestamptz;
CREATE INDEX IF NOT EXISTS transactions_void_refund_todo_idx ON transactions (created_at)
  WHERE review_reason IS NOT NULL AND refund_requested_at IS NULL;

-- Parked webhook events whose sale never arrived: flagged (never deleted) once they are older than the threshold.
ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS stale_flagged_at timestamptz;
CREATE INDEX IF NOT EXISTS webhook_events_parked_stale_idx ON webhook_events (received_at)
  WHERE outcome = 'parked' AND stale_flagged_at IS NULL;

ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS void_refund_max_attempts integer NOT NULL DEFAULT 5
    CHECK (void_refund_max_attempts BETWEEN 1 AND 50),
  -- delay before retry n (1-based) = base * 2^(n-1) minutes, capped at 24 h
  ADD COLUMN IF NOT EXISTS void_refund_backoff_minutes integer NOT NULL DEFAULT 5
    CHECK (void_refund_backoff_minutes BETWEEN 1 AND 1440),
  ADD COLUMN IF NOT EXISTS parked_event_stale_hours integer NOT NULL DEFAULT 72
    CHECK (parked_event_stale_hours BETWEEN 1 AND 8760);

-- Heartbeat of the janitor (single row): when it last ran and what it did.
CREATE TABLE IF NOT EXISTS payments_janitor_state (
  id          integer PRIMARY KEY CHECK (id = 1),
  last_run_at timestamptz,
  last_counts jsonb,
  runs        bigint NOT NULL DEFAULT 0
);
INSERT INTO payments_janitor_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
