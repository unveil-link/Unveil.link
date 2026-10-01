-- 006: payments layer, part 2 of 2 (additive/ALTER only; 001-005 untouched). Re-runnable (IF NOT EXISTS / DROP IF EXISTS).

-- ---------------------------------------------------------------------------
-- Settings: processing fee (NULL => the active provider's default / env), payout hold, minimum payout,
-- chargeback fee. Platform fee keeps living in the existing platform_settings.fee_percent (default 10).
-- ---------------------------------------------------------------------------
ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS processing_fee_percent numeric(5,2)
    CHECK (processing_fee_percent IS NULL OR (processing_fee_percent >= 0 AND processing_fee_percent <= 100)),
  ADD COLUMN IF NOT EXISTS payout_hold_days   integer NOT NULL DEFAULT 7    CHECK (payout_hold_days BETWEEN 0 AND 90),
  ADD COLUMN IF NOT EXISTS min_payout_cents   integer NOT NULL DEFAULT 2500 CHECK (min_payout_cents >= 0),   -- $25
  ADD COLUMN IF NOT EXISTS chargeback_fee_cents integer NOT NULL DEFAULT 0  CHECK (chargeback_fee_cents >= 0);

-- ---------------------------------------------------------------------------
-- transactions: extend the 001 table (no duplicate table).
-- fee_percent / processing_fee_percent snapshot the rates in force when the checkout was created; the
-- *_fee_cents columns already hold the resulting integer cents (CHECK seller_net = amount - fees stays).
-- ---------------------------------------------------------------------------
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS provider               text,
  ADD COLUMN IF NOT EXISTS provider_session_id    text,
  ADD COLUMN IF NOT EXISTS currency               char(3) NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS fee_percent            numeric(5,2),
  ADD COLUMN IF NOT EXISTS processing_fee_percent numeric(5,2),
  ADD COLUMN IF NOT EXISTS refunded_cents         integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failure_code           text,
  ADD COLUMN IF NOT EXISTS buyer_confirmed_18_at  timestamptz,
  ADD COLUMN IF NOT EXISTS succeeded_at           timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at             timestamptz NOT NULL DEFAULT now();
UPDATE transactions SET provider = 'legacy' WHERE provider IS NULL;
UPDATE transactions SET succeeded_at = created_at WHERE succeeded_at IS NULL AND status IN ('succeeded','refunded','charged_back');
ALTER TABLE transactions ALTER COLUMN provider SET NOT NULL;
-- Safer default than 001's 'succeeded': a row only becomes succeeded when a verified webhook says so.
ALTER TABLE transactions ALTER COLUMN status SET DEFAULT 'pending';
-- pending checkouts do not have a processor transaction id yet.
ALTER TABLE transactions ALTER COLUMN processor_ref DROP NOT NULL;
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_processor_ref_key;
CREATE UNIQUE INDEX IF NOT EXISTS transactions_provider_ref_uniq ON transactions (provider, processor_ref) WHERE processor_ref IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS transactions_provider_session_uniq ON transactions (provider, provider_session_id) WHERE provider_session_id IS NOT NULL;
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_refunded_range;
ALTER TABLE transactions ADD CONSTRAINT transactions_refunded_range CHECK (refunded_cents >= 0 AND refunded_cents <= amount_cents);
CREATE INDEX IF NOT EXISTS transactions_status_idx ON transactions (status);

-- ---------------------------------------------------------------------------
-- payouts: extend the 001 table. Funds are reserved by a payout_debit ledger entry when the payout is requested.
-- ---------------------------------------------------------------------------
ALTER TABLE payouts
  ADD COLUMN IF NOT EXISTS provider        text,
  ADD COLUMN IF NOT EXISTS requested_at    timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS approved_at     timestamptz,
  ADD COLUMN IF NOT EXISTS paid_at         timestamptz,
  ADD COLUMN IF NOT EXISTS failed_at       timestamptz,
  ADD COLUMN IF NOT EXISTS failure_reason  text,
  ADD COLUMN IF NOT EXISTS updated_at      timestamptz NOT NULL DEFAULT now();

ALTER TABLE payouts ALTER COLUMN status SET DEFAULT 'requested';

-- ---------------------------------------------------------------------------
-- webhook_events: reconciliation log. ONE ROW PER DELIVERY (valid, duplicate, rejected, errored).
-- Idempotency: at most one row per (provider, provider_event_id) may hold the "dedupe claim". The claim row is
-- inserted in the same DB transaction that applies the event, so concurrent deliveries serialise on the unique
-- index and a rolled-back attempt leaves no claim behind (the processor's retry is processed normally).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS webhook_events (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider                text NOT NULL,
  provider_event_id       text,                 -- NULL when rejected before the payload was trusted
  event_type              text,                 -- normalized: sale_succeeded | sale_failed | refunded | chargeback
  raw_event_type          text,                 -- provider's own label
  signature_valid         boolean NOT NULL,
  outcome                 text NOT NULL CHECK (outcome IN ('processed','duplicate','rejected','ignored','error','parked')),
  outcome_detail          text,
  dedupe_claim            boolean NOT NULL DEFAULT false,
  transaction_id          uuid REFERENCES transactions(id) ON DELETE RESTRICT,
  merchant_reference      text,                 -- our transactions.id as echoed by the provider
  provider_transaction_id text,
  related_transaction_id  text,                 -- original sale id on refund/chargeback events
  amount_cents            integer,
  normalized              jsonb,                -- the NormalizedPaymentEvent (used to re-apply parked events)
  payload_sha256          text NOT NULL,
  payload                 text,                 -- raw body (capped; rejected deliveries keep only a short prefix)
  received_at             timestamptz NOT NULL DEFAULT now(),
  processed_at            timestamptz,
  CONSTRAINT webhook_events_claim_needs_id CHECK (NOT dedupe_claim OR (provider_event_id IS NOT NULL AND event_type IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS webhook_events_claim_uniq ON webhook_events (provider, provider_event_id) WHERE dedupe_claim;
-- Second dedupe key for processors without event ids / with re-labelled events: one claim per (provider, processor
-- transaction id, normalized type). A refund/chargeback record has its own processor id, so partial refunds don't collide.
CREATE UNIQUE INDEX IF NOT EXISTS webhook_events_claim_tx_uniq ON webhook_events (provider, provider_transaction_id, event_type)
  WHERE dedupe_claim AND provider_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS webhook_events_received_idx ON webhook_events (received_at DESC);
CREATE INDEX IF NOT EXISTS webhook_events_tx_idx ON webhook_events (transaction_id);
CREATE INDEX IF NOT EXISTS webhook_events_parked_idx ON webhook_events (provider, received_at) WHERE outcome = 'parked';

-- ---------------------------------------------------------------------------
-- ledger_entries: append-only seller ledger (integer cents, signed, seller's perspective).
-- A sale posts +gross, -platform_fee, -processing_fee. Refund/chargeback reversals post -gross share and
-- +fee shares, so SUM(amount_cents) per transaction is always what the seller still nets from it.
-- available_at drives pending vs available (sale entries: succeeded_at + hold; reversals inherit the sale's value;
-- chargeback_fee / payout entries are available immediately).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ledger_entries (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  posting_id       uuid NOT NULL,
  seller_id        uuid NOT NULL REFERENCES sellers(id) ON DELETE RESTRICT,
  transaction_id   uuid REFERENCES transactions(id) ON DELETE RESTRICT,
  payout_id        uuid REFERENCES payouts(id) ON DELETE RESTRICT,
  webhook_event_id uuid REFERENCES webhook_events(id) ON DELETE RESTRICT,
  entry_type       text NOT NULL CHECK (entry_type IN
    ('sale_credit','platform_fee','processing_fee','refund_reversal','chargeback_reversal','chargeback_fee','payout_debit','payout_reversal')),
  component        text NOT NULL CHECK (component IN ('gross','platform_fee','processing_fee','chargeback_fee','payout')),
  amount_cents     integer NOT NULL CHECK (amount_cents <> 0),
  available_at     timestamptz NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  memo             text,
  CONSTRAINT ledger_entries_sign_shape CHECK (
       (entry_type = 'sale_credit'     AND component = 'gross'          AND amount_cents > 0)
    OR (entry_type = 'platform_fee'    AND component = 'platform_fee'   AND amount_cents < 0)
    OR (entry_type = 'processing_fee'  AND component = 'processing_fee' AND amount_cents < 0)
    OR (entry_type IN ('refund_reversal','chargeback_reversal')
        AND ((component = 'gross' AND amount_cents < 0) OR (component IN ('platform_fee','processing_fee') AND amount_cents > 0)))
    OR (entry_type = 'chargeback_fee'  AND component = 'chargeback_fee' AND amount_cents < 0)
    OR (entry_type = 'payout_debit'    AND component = 'payout'         AND amount_cents < 0)
    OR (entry_type = 'payout_reversal' AND component = 'payout'         AND amount_cents > 0)
  ),
  CONSTRAINT ledger_entries_ref_shape CHECK (
    (entry_type IN ('payout_debit','payout_reversal')) = (payout_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS ledger_entries_seller_idx ON ledger_entries (seller_id, available_at);
CREATE INDEX IF NOT EXISTS ledger_entries_tx_idx ON ledger_entries (transaction_id);
-- A sale can be posted once per transaction, whatever the event ids; every event posts at most once per line.
CREATE UNIQUE INDEX IF NOT EXISTS ledger_entries_sale_once ON ledger_entries (transaction_id, entry_type, component)
  WHERE entry_type IN ('sale_credit','platform_fee','processing_fee');
CREATE UNIQUE INDEX IF NOT EXISTS ledger_entries_event_once ON ledger_entries (webhook_event_id, entry_type, component)
  WHERE webhook_event_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ledger_entries_payout_once ON ledger_entries (payout_id, entry_type)
  WHERE payout_id IS NOT NULL;

CREATE OR REPLACE FUNCTION ledger_entries_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries is append-only (% blocked)', TG_OP USING ERRCODE = 'restrict_violation';
END $$;
DROP TRIGGER IF EXISTS ledger_entries_no_update ON ledger_entries;
CREATE TRIGGER ledger_entries_no_update BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_append_only();
DROP TRIGGER IF EXISTS ledger_entries_no_truncate ON ledger_entries;
CREATE TRIGGER ledger_entries_no_truncate BEFORE TRUNCATE ON ledger_entries
  FOR EACH STATEMENT EXECUTE FUNCTION ledger_entries_append_only();
