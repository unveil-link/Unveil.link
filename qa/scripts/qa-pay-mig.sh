#!/bin/bash
# Round 2 QA: migration 007 upgrade path on a DB holding 001-006 data. Usage: qa-pay-mig.sh <dbname>  (must be unveil_qa_pay*)
set -u
DB=${1:?db}; case "$DB" in unveil_qa_pay*) ;; *) echo "refusing: $DB"; exit 2;; esac
export PGPASSWORD=unveil
PSQL="psql -h localhost -U unveil -d $DB -v ON_ERROR_STOP=1 -At"
cd "$(dirname "$0")/../.."
$PSQL -c "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())" >/dev/null
for f in db/migrations/00[1-6]*.sql; do $PSQL -f "$f" >/dev/null && $PSQL -c "INSERT INTO schema_migrations(name) VALUES ('$(basename $f)')" >/dev/null || { echo "FAILED $f"; exit 1; }; done
echo "applied 001-006: $($PSQL -c 'select count(*) from schema_migrations')"
$PSQL <<'SQL' >/dev/null
INSERT INTO sellers (id,email,password_hash,display_name,verification_status) VALUES
 ('00000000-0000-0000-0000-0000000000a1','mig-seller@example.test','x','Mig Seller','verified');
INSERT INTO drops (id,seller_id,public_link_id,title,price_cents,status,published_at) VALUES
 ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000a1','migdrop00001','Mig drop',2000,'published',now()),
 ('00000000-0000-0000-0000-0000000000d2','00000000-0000-0000-0000-0000000000a1','migdrop00002','Mig drop 2',3000,'published',now());
-- 4 duplicate pendings (case-variant emails) for drop1/Buyer, 1 pending for drop2, 1 unrelated buyer pending
INSERT INTO transactions (id,drop_id,seller_id,buyer_email,amount_cents,platform_fee_cents,processing_fee_cents,seller_net_cents,provider,status,created_at) VALUES
 ('00000000-0000-0000-0000-00000000b001','00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000a1','buyer@example.test',2000,400,240,1360,'mock','pending', now()-interval '5 days'),
 ('00000000-0000-0000-0000-00000000b002','00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000a1','Buyer@Example.test',2000,400,240,1360,'mock','pending', now()-interval '3 days'),
 ('00000000-0000-0000-0000-00000000b003','00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000a1','BUYER@example.test',2000,400,240,1360,'mock','pending', now()-interval '1 minute'),
 ('00000000-0000-0000-0000-00000000b004','00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000a1','buyer@example.test',2000,400,240,1360,'mock','pending', now()-interval '1 minute'),
 ('00000000-0000-0000-0000-00000000b005','00000000-0000-0000-0000-0000000000d2','00000000-0000-0000-0000-0000000000a1','buyer@example.test',3000,600,360,2040,'mock','pending', now()-interval '2 days'),
 ('00000000-0000-0000-0000-00000000b006','00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000a1','other@example.test',2000,400,240,1360,'mock','pending', now()),
 ('00000000-0000-0000-0000-00000000b007','00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000a1','buyer@example.test',2000,400,240,1360,'mock','failed', now()-interval '9 days'),
 ('00000000-0000-0000-0000-00000000b008','00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000a1','buyer@example.test',2000,400,240,1360,'mock','succeeded', now()-interval '10 days');
INSERT INTO ledger_entries (posting_id,seller_id,transaction_id,entry_type,component,amount_cents,available_at) VALUES
 ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-00000000b008','sale_credit','gross',2000,now()),
 ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-00000000b008','platform_fee','platform_fee',-400,now()),
 ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-00000000b008','processing_fee','processing_fee',-240,now());
SQL
snap() { $PSQL -c "select count(*)||'/'||coalesce(sum(amount_cents),0) from ledger_entries"; }
echo "pre ledger count/sum: $(snap)"
echo "pre txns: $($PSQL -c "select string_agg(right(id::text,3)||':'||status,' ' order by id) from transactions")"
cd /workspace/qa-pay2
echo "--- npm run migrate (upgrade 006->007)"
DATABASE_URL=postgres://unveil:unveil@localhost:5432/$DB npm run migrate 2>&1 | grep -E "applied|fail|error|up to date|nothing" 
echo "post txns: $($PSQL -c "select string_agg(right(id::text,3)||':'||status||coalesce('/'||failure_code,''),' ' order by id) from transactions")"
echo "post ledger count/sum: $(snap)"
echo "settings: $($PSQL -c "select checkout_session_ttl_minutes||','||checkout_late_success_grace_minutes||','||chargeback_flag_threshold||','||chargeback_flag_window_days from platform_settings")"
echo "indexes: $($PSQL -c "select string_agg(indexname,',') from pg_indexes where indexname in ('transactions_one_pending_uniq','transactions_idem_key_uniq','transactions_pending_created_idx','transactions_review_idx','sellers_risk_flagged_idx')")"
echo "--- re-run migrate (no-op)"
DATABASE_URL=postgres://unveil:unveil@localhost:5432/$DB npm run migrate 2>&1 | grep -E "applied|fail|error|up to date|nothing|migrat"
echo "--- 007 SQL applied manually twice more (idempotent?)"
$PSQL -f db/migrations/007_payments_hardening.sql >/dev/null && echo "2nd manual run OK" || echo "2nd manual run FAILED"
$PSQL -f db/migrations/007_payments_hardening.sql >/dev/null && echo "3rd manual run OK" || echo "3rd manual run FAILED"
echo "post2 txns: $($PSQL -c "select string_agg(right(id::text,3)||':'||status,' ' order by id) from transactions")"
echo "--- rollback: 007 in a txn then ROLLBACK leaves 006 shape?"
$PSQL <<'SQL'
BEGIN;
ALTER TABLE transactions DROP COLUMN idempotency_key, DROP COLUMN checkout_url, DROP COLUMN review_reason, DROP COLUMN refund_requested_at;
ALTER TABLE sellers DROP COLUMN risk_flagged_at, DROP COLUMN risk_flag_reason;
ALTER TABLE platform_settings DROP COLUMN checkout_session_ttl_minutes, DROP COLUMN checkout_late_success_grace_minutes, DROP COLUMN chargeback_flag_threshold, DROP COLUMN chargeback_flag_window_days;
SELECT 'down-in-txn: columns remaining=' || count(*) FROM information_schema.columns WHERE table_name='transactions' AND column_name IN ('idempotency_key','checkout_url','review_reason','refund_requested_at');
ROLLBACK;
SQL
echo "--- manual DOWN (no down migration shipped; QA-authored) then re-upgrade"
$PSQL <<'SQL' >/dev/null
DROP INDEX IF EXISTS transactions_one_pending_uniq, transactions_idem_key_uniq, transactions_pending_created_idx, transactions_review_idx, sellers_risk_flagged_idx;
ALTER TABLE transactions DROP COLUMN idempotency_key, DROP COLUMN checkout_url, DROP COLUMN review_reason, DROP COLUMN refund_requested_at;
ALTER TABLE sellers DROP COLUMN risk_flagged_at, DROP COLUMN risk_flag_reason;
ALTER TABLE platform_settings DROP COLUMN checkout_session_ttl_minutes, DROP COLUMN checkout_late_success_grace_minutes, DROP COLUMN chargeback_flag_threshold, DROP COLUMN chargeback_flag_window_days;
DELETE FROM schema_migrations WHERE name LIKE '007%';
SQL
echo "after down: ledger $(snap); txns $($PSQL -c 'select count(*) from transactions')"
DATABASE_URL=postgres://unveil:unveil@localhost:5432/$DB npm run migrate 2>&1 | grep -E "applied|fail|error"
echo "re-upgraded: ledger $(snap); status $($PSQL -c "select string_agg(right(id::text,3)||':'||status,' ' order by id) from transactions")"
echo "--- failure atomicity: break 007 mid-way in a copy -> whole migration rolls back"
$PSQL -c "DELETE FROM schema_migrations WHERE name LIKE '007%'" >/dev/null
$PSQL -c "DROP INDEX IF EXISTS transactions_one_pending_uniq, transactions_idem_key_uniq, transactions_pending_created_idx, transactions_review_idx; ALTER TABLE transactions DROP COLUMN idempotency_key, DROP COLUMN checkout_url, DROP COLUMN review_reason, DROP COLUMN refund_requested_at; ALTER TABLE sellers DROP COLUMN risk_flagged_at, DROP COLUMN risk_flag_reason; ALTER TABLE platform_settings DROP COLUMN checkout_session_ttl_minutes, DROP COLUMN checkout_late_success_grace_minutes, DROP COLUMN chargeback_flag_threshold, DROP COLUMN chargeback_flag_window_days" >/dev/null
echo "state before failing run: all 007 columns absent, 007 not recorded"
TMP=$(mktemp -d); mkdir -p $TMP/db/migrations; cp db/migrations/*.sql $TMP/db/migrations/; echo "SELECT 1/0;" >> $TMP/db/migrations/007_payments_hardening.sql; cp -r scripts $TMP/scripts; ln -s /workspace/qa-pay2/node_modules $TMP/node_modules; cp package.json $TMP/
(cd $TMP && DATABASE_URL=postgres://unveil:unveil@localhost:5432/$DB npx tsx scripts/migrate.ts 2>&1 | grep -E "applied|fail|error" | head -3)
echo "after failed 007: 007 recorded? $($PSQL -c "select count(*) from schema_migrations where name like '007%'") ; 007 columns present after failed run (0 = fully rolled back): $($PSQL -c "select count(*) from information_schema.columns where column_name in ('idempotency_key','checkout_url','review_reason','refund_requested_at','risk_flagged_at','checkout_session_ttl_minutes')")"
rm -rf $TMP
DATABASE_URL=postgres://unveil:unveil@localhost:5432/$DB npm run migrate 2>&1 | grep -E "applied|fail|error"
echo "final: $($PSQL -c "select count(*) from information_schema.columns where table_name='transactions' and column_name in ('idempotency_key','checkout_url','review_reason','refund_requested_at')") cols; ledger $(snap)"
