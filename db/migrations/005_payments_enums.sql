-- 005: payments layer, part 1 of 2 - new enum labels only.
-- PostgreSQL cannot *use* a freshly added enum label (defaults, CHECKs, inserts, indexes) inside the transaction that
-- added it, and scripts/migrate.ts applies one file per transaction. So the labels are added here and used from 006.
ALTER TYPE transaction_status ADD VALUE IF NOT EXISTS 'pending';
ALTER TYPE transaction_status ADD VALUE IF NOT EXISTS 'failed';
-- Payout flow: requested -> approved -> paid | failed. (001's 'pending'/'processing' labels stay, unused.)
ALTER TYPE payout_status ADD VALUE IF NOT EXISTS 'requested';
ALTER TYPE payout_status ADD VALUE IF NOT EXISTS 'approved';
