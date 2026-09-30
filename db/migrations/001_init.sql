-- Unveil initial schema (spec section 11)
CREATE TYPE verification_status AS ENUM ('pending', 'verified', 'failed', 'manual_review');
CREATE TYPE drop_status         AS ENUM ('draft', 'published', 'unpublished', 'flagged');
CREATE TYPE transaction_status  AS ENUM ('succeeded', 'refunded', 'charged_back');
CREATE TYPE payout_status       AS ENUM ('pending', 'processing', 'paid', 'failed');
CREATE TYPE report_status       AS ENUM ('open', 'reviewing', 'actioned', 'dismissed');

CREATE TABLE sellers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email               text NOT NULL UNIQUE,
  password_hash       text,
  google_id           text UNIQUE,
  display_name        text NOT NULL,
  avatar              text,
  bio                 text,
  verification_status verification_status NOT NULL DEFAULT 'pending',
  verification_ref    text,
  legal_name          text,
  dob                 date,
  payout_details      jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sellers_email_lowercase CHECK (email = lower(email)),
  CONSTRAINT sellers_has_credential CHECK (password_hash IS NOT NULL OR google_id IS NOT NULL)
);
CREATE INDEX sellers_verification_status_idx ON sellers (verification_status);

CREATE TABLE admins (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE drops (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id      uuid NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  public_link_id text NOT NULL UNIQUE,
  title          text NOT NULL,
  description    text,
  price_cents    integer NOT NULL,
  cover_url      text,
  status         drop_status NOT NULL DEFAULT 'draft',
  attestation    jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  published_at   timestamptz,
  -- Hard platform bounds (spec: $1 - $500). Tunable narrower bounds live in platform_settings.
  CONSTRAINT drops_price_range CHECK (price_cents BETWEEN 100 AND 50000),
  CONSTRAINT drops_public_link_id_format CHECK (public_link_id ~ '^[A-Za-z0-9_-]{12}$')
);
CREATE INDEX drops_seller_idx ON drops (seller_id, created_at DESC);
CREATE INDEX drops_status_idx ON drops (status);

CREATE TABLE drop_files (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drop_id            uuid NOT NULL REFERENCES drops(id) ON DELETE CASCADE,
  storage_key        text NOT NULL UNIQUE,
  filename           text NOT NULL,
  mime               text NOT NULL,
  size_bytes         bigint NOT NULL CHECK (size_bytes > 0),
  blurred_preview_key text,
  sort_order         integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX drop_files_drop_idx ON drop_files (drop_id, sort_order);

CREATE TABLE transactions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drop_id            uuid NOT NULL REFERENCES drops(id) ON DELETE RESTRICT,
  seller_id          uuid NOT NULL REFERENCES sellers(id) ON DELETE RESTRICT,
  buyer_email        text NOT NULL,
  amount_cents       integer NOT NULL CHECK (amount_cents > 0),
  platform_fee_cents integer NOT NULL CHECK (platform_fee_cents >= 0),
  processing_fee_cents integer NOT NULL CHECK (processing_fee_cents >= 0),
  seller_net_cents   integer NOT NULL,
  processor_ref      text NOT NULL UNIQUE,
  status             transaction_status NOT NULL DEFAULT 'succeeded',
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT transactions_net_consistent
    CHECK (seller_net_cents = amount_cents - platform_fee_cents - processing_fee_cents)
);
CREATE INDEX transactions_seller_idx ON transactions (seller_id, created_at DESC);
CREATE INDEX transactions_drop_idx ON transactions (drop_id);
CREATE INDEX transactions_buyer_idx ON transactions (lower(buyer_email));

CREATE TABLE payouts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id    uuid NOT NULL REFERENCES sellers(id) ON DELETE RESTRICT,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  status       payout_status NOT NULL DEFAULT 'pending',
  provider_ref text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payouts_seller_idx ON payouts (seller_id, created_at DESC);
CREATE UNIQUE INDEX payouts_provider_ref_uniq ON payouts (provider_ref) WHERE provider_ref IS NOT NULL;

CREATE TABLE reports (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drop_id        uuid NOT NULL REFERENCES drops(id) ON DELETE CASCADE,
  reason         text NOT NULL,
  reporter_email text,
  status         report_status NOT NULL DEFAULT 'open',
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reports_drop_idx ON reports (drop_id);
CREATE INDEX reports_status_idx ON reports (status, created_at DESC);

CREATE TABLE audit_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id   uuid REFERENCES admins(id) ON DELETE SET NULL,
  action     text NOT NULL,
  target     text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_admin_idx ON audit_log (admin_id, created_at DESC);
CREATE INDEX audit_log_target_idx ON audit_log (target);
