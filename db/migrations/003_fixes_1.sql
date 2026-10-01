-- 003: backend/fixes-1 (additive only; 001/002 untouched)

-- ---------------------------------------------------------------------------
-- Server-side sessions (M1-04). The session JWT carries `jti` = sessions.id;
-- every authenticated request checks the row (not revoked, not expired).
-- ---------------------------------------------------------------------------
CREATE TABLE sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id   uuid NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  user_agent  text
);
CREATE INDEX sessions_seller_active_idx ON sessions (seller_id) WHERE revoked_at IS NULL;
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

-- ---------------------------------------------------------------------------
-- Password reset tokens (#12). Only the SHA-256 of the token is stored.
-- ---------------------------------------------------------------------------
CREATE TABLE password_reset_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id   uuid NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz
);
CREATE INDEX password_reset_tokens_seller_idx ON password_reset_tokens (seller_id);

-- ---------------------------------------------------------------------------
-- Rate limiter storage (#11): fixed window counter per key.
-- ---------------------------------------------------------------------------
CREATE TABLE rate_limits (
  key           text PRIMARY KEY,
  window_start  timestamptz NOT NULL DEFAULT now(),
  count         integer NOT NULL DEFAULT 0
);
CREATE INDEX rate_limits_window_idx ON rate_limits (window_start);

-- ---------------------------------------------------------------------------
-- Platform settings: spec limits (M1-08) and download link TTL (#8).
-- ---------------------------------------------------------------------------
ALTER TABLE platform_settings
  ADD COLUMN max_total_bytes_per_drop bigint NOT NULL DEFAULT 2147483648   -- 2 GiB per drop
    CHECK (max_total_bytes_per_drop > 0),
  -- NULL => fall back to env SIGNED_URL_TTL_SECONDS, then 86400 (24 h).
  ADD COLUMN download_ttl_seconds integer
    CHECK (download_ttl_seconds IS NULL OR download_ttl_seconds BETWEEN 1 AND 2592000);   -- <= 30 days
ALTER TABLE platform_settings ALTER COLUMN max_files_per_drop SET DEFAULT 10;
-- Only move the old default (20) to the spec value; a deliberately customised value is left alone.
UPDATE platform_settings SET max_files_per_drop = 10 WHERE max_files_per_drop = 20;

-- ---------------------------------------------------------------------------
-- Attestation audit trail (#10): first attestation is immutable; re-publishes append to history.
-- drops.attestation keeps its jsonb shape (incl. "at") from the FIRST publish.
-- ---------------------------------------------------------------------------
ALTER TABLE drops
  ADD COLUMN attested_at          timestamptz,                       -- first attestation, never overwritten
  ADD COLUMN last_republished_at  timestamptz,
  ADD COLUMN attestation_history  jsonb NOT NULL DEFAULT '[]'::jsonb; -- subsequent re-attestations
UPDATE drops SET attested_at = (attestation->>'at')::timestamptz WHERE attestation ? 'at';
