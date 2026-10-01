-- 004: backend/fixes-2 — progressive login delays (replaces the per-email lockout). Additive only.

-- Per-email failed-login state. Keyed by hashKeyPart(email) (sha256 prefix), so unknown emails
-- get a row too (no user enumeration) and no raw addresses are stored.
CREATE TABLE login_throttle (
  key              text PRIMARY KEY,
  failures         integer     NOT NULL DEFAULT 0,
  last_attempt_at  timestamptz NOT NULL DEFAULT now(),
  next_allowed_at  timestamptz NOT NULL DEFAULT now(),
  -- Hard backstop for "no permanent / long lock": whatever the application computes, the enforced
  -- delay can never exceed 1 hour (the largest value platform_settings.login_delay_cap_seconds accepts).
  CONSTRAINT login_throttle_delay_bounded CHECK (next_allowed_at <= last_attempt_at + interval '1 hour')
);
CREATE INDEX login_throttle_last_attempt_idx ON login_throttle (last_attempt_at);

-- Tunables. NULL => fall back to env (LOGIN_DELAY_*), then to the built-in default.
ALTER TABLE platform_settings
  ADD COLUMN login_delay_threshold      integer CHECK (login_delay_threshold      IS NULL OR login_delay_threshold      BETWEEN 1 AND 100),
  ADD COLUMN login_delay_base_seconds   integer CHECK (login_delay_base_seconds   IS NULL OR login_delay_base_seconds   BETWEEN 1 AND 3600),
  ADD COLUMN login_delay_cap_seconds    integer CHECK (login_delay_cap_seconds    IS NULL OR login_delay_cap_seconds    BETWEEN 1 AND 3600),
  ADD COLUMN login_delay_decay_seconds  integer CHECK (login_delay_decay_seconds  IS NULL OR login_delay_decay_seconds  BETWEEN 1 AND 86400);
