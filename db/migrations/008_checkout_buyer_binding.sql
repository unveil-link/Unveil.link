-- 008: bind pending checkouts to the browser that created them (QA run 2, NEW-1). Additive + re-runnable.
-- A pending checkout is only ever handed back to the SAME client: the one holding the random httpOnly buyer cookie (only its
-- SHA-256 is stored) or presenting the same Idempotency-Key. Every other client gets its own independent pending transaction,
-- so the one-pending-per-(drop, email) rule becomes one-pending-per-(drop, email, client).
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS buyer_token_hash text;
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_buyer_token_hash_fmt;
ALTER TABLE transactions ADD CONSTRAINT transactions_buyer_token_hash_fmt CHECK (buyer_token_hash IS NULL OR buyer_token_hash ~ '^[0-9a-f]{64}$');

DROP INDEX IF EXISTS transactions_one_pending_uniq;
-- Rows created before this migration have no token: coalesce keeps them mutually exclusive exactly as before.
CREATE UNIQUE INDEX IF NOT EXISTS transactions_one_pending_per_client_uniq
  ON transactions (drop_id, lower(buyer_email), COALESCE(buyer_token_hash, '')) WHERE status = 'pending';
