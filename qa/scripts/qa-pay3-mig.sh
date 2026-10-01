#!/bin/bash
# Round 3 QA: migrations 008-010 upgrade path on a DB migrated through 007 and holding data. Usage: qa-pay3-mig.sh <dbname> (unveil_qa_pay*)
set -u
DB=${1:?db}; case "$DB" in unveil_qa_pay*) ;; *) echo "refusing: $DB"; exit 2;; esac
export PGPASSWORD=unveil
PSQL="psql -h localhost -U unveil -d $DB -v ON_ERROR_STOP=1 -At"
URL=postgres://unveil:unveil@localhost:5432/$DB
cd "$(dirname "$0")/../.."
$PSQL -c "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())" >/dev/null
for f in db/migrations/00[1-7]*.sql; do $PSQL -f "$f" >/dev/null 2>&1 && $PSQL -c "INSERT INTO schema_migrations(name) VALUES ('$(basename $f)')" >/dev/null || { echo "FAILED $f"; exit 1; }; done
echo "applied 001-007: $($PSQL -c 'select count(*) from schema_migrations')"
$PSQL <<'SQL' >/dev/null
INSERT INTO sellers (id,email,password_hash,display_name,verification_status,risk_flagged_at,risk_flag_reason) VALUES
 ('00000000-0000-0000-0000-0000000000a1','mig-seller@example.test','x','Mig Seller','verified', now()-interval '2 days','3 chargebacks within 90 days (threshold 3)'),
 ('00000000-0000-0000-0000-0000000000a2','mig-seller2@example.test','x','Mig Seller 2','verified', NULL, NULL);
INSERT INTO drops (id,seller_id,public_link_id,title,price_cents,status,published_at) VALUES
 ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000a1','migdrop00001','Mig drop',2000,'published',now()),
 ('00000000-0000-0000-0000-0000000000d2','00000000-0000-0000-0000-0000000000a1','migdrop00002','Mig drop 2',3000,'published',now());
INSERT INTO transactions (id,drop_id,seller_id,buyer_email,amount_cents,platform_fee_cents,processing_fee_cents,seller_net_cents,provider,status,created_at,review_reason,refund_requested_at,idempotency_key,checkout_url) VALUES
 ('00000000-0000-0000-0000-00000000b001','00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000a1','buyer@example.test',2000,400,240,1360,'mock','pending', now()-interval '1 minute',NULL,NULL,'k1','https://x/pay/mock/mocksess_1'),
 ('00000000-0000-0000-0000-00000000b002','00000000-0000-0000-0000-0000000000d2','00000000-0000-0000-0000-0000000000a1','buyer@example.test',3000,600,360,2040,'mock','pending', now()-interval '2 minutes',NULL,NULL,NULL,'https://x/pay/mock/mocksess_2'),
 ('00000000-0000-0000-0000-00000000b003','00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000a1','other@example.test',2000,400,240,1360,'mock','pending', now(),NULL,NULL,NULL,NULL),
 ('00000000-0000-0000-0000-00000000b004','00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000a1','buyer@example.test',2000,400,240,1360,'mock','failed', now()-interval '9 days','session_expired',NULL,NULL,NULL),
 ('00000000-0000-0000-0000-00000000b005','00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000a1','buyer@example.test',2000,400,240,1360,'mock','succeeded', now()-interval '10 days',NULL,NULL,NULL,NULL),
 ('00000000-0000-0000-0000-00000000b006','00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000a1','void@example.test',2000,400,240,1360,'mock','failed', now()-interval '2 days','seller_not_verified',NULL,NULL,NULL);
UPDATE transactions SET processor_ref='proc_1' WHERE id='00000000-0000-0000-0000-00000000b006';
INSERT INTO ledger_entries (posting_id,seller_id,transaction_id,entry_type,component,amount_cents,available_at) VALUES
 ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-00000000b005','sale_credit','gross',2000,now()),
 ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-00000000b005','platform_fee','platform_fee',-400,now()),
 ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-00000000b005','processing_fee','processing_fee',-240,now());
INSERT INTO webhook_events (provider, signature_valid, outcome, payload_sha256, payload) VALUES ('mock', true, 'parked', 'abc', '{}'::jsonb);
INSERT INTO admins (email) VALUES ('legacy-admin@example.test');
INSERT INTO audit_log (admin_id, action, target) SELECT id, 'legacy_action', 'x' FROM admins;
SQL
snap() { $PSQL -c "select count(*)||'/'||coalesce(sum(amount_cents),0) from ledger_entries"; }
echo "pre: ledger $(snap); txns $($PSQL -c "select string_agg(right(id::text,3)||':'||status,' ' order by id) from transactions")"
echo "--- npm run migrate (007 -> 008,009,010)"
cd /workspace/qa-pay3
DATABASE_URL=$URL npm run migrate 2>&1 | grep -E "applied|fail|error|up to date|done"
echo "post: ledger $(snap); txns $($PSQL -c "select string_agg(right(id::text,3)||':'||status,' ' order by id) from transactions")"
echo "pending rows buyer_token_hash NULL (never handed out): $($PSQL -c "select count(*) from transactions where status='pending' and buyer_token_hash is null")"
echo "009 defaults: attempts=$($PSQL -c "select min(void_refund_attempts)||'..'||max(void_refund_attempts) from transactions") settings=$($PSQL -c "select void_refund_max_attempts||','||void_refund_backoff_minutes||','||parked_event_stale_hours from platform_settings") janitor_state_rows=$($PSQL -c "select count(*) from payments_janitor_state")"
echo "010: legacy admin row kept (password_hash NULL => cannot log in): $($PSQL -c "select email||' hash_null='||(password_hash is null) from admins where email like 'legacy%'"); audit rows kept: $($PSQL -c "select count(*) from audit_log where action='legacy_action'")"
echo "seller flag preserved: $($PSQL -c "select (risk_flagged_at is not null)::text||' reviewed_at='||coalesce(risk_reviewed_at::text,'NULL') from sellers where id='00000000-0000-0000-0000-0000000000a1'")"
echo "indexes: $($PSQL -c "select string_agg(indexname,',' order by indexname) from pg_indexes where indexname in ('transactions_one_pending_per_client_uniq','transactions_one_pending_uniq','transactions_void_refund_todo_idx','webhook_events_parked_stale_idx','admin_sessions_admin_active_idx','admin_sessions_expires_idx')")"
echo "unique per-client index enforced: $($PSQL -c "select count(*) from pg_indexes where indexname='transactions_one_pending_per_client_uniq' and indexdef like '%UNIQUE%'") ; old 007 index dropped: $($PSQL -c "select count(*)=0 from pg_indexes where indexname='transactions_one_pending_uniq'")"
echo "--- legacy pending rows stay mutually exclusive (coalesce '') : second NULL-token pending for same drop+email must violate"
$PSQL -c "INSERT INTO transactions (drop_id,seller_id,buyer_email,amount_cents,platform_fee_cents,processing_fee_cents,seller_net_cents,provider,status) VALUES ('00000000-0000-0000-0000-0000000000d2','00000000-0000-0000-0000-0000000000a1','buyer@example.test',3000,600,360,2040,'mock','pending')" 2>&1 | grep -oE "ERROR.*duplicate key.*|violates unique[^\"]*\"[a-z_]*\"" | head -1
echo "token hash CHECK: $($PSQL -c "INSERT INTO transactions (drop_id,seller_id,buyer_email,amount_cents,platform_fee_cents,processing_fee_cents,seller_net_cents,provider,status,buyer_token_hash) VALUES ('00000000-0000-0000-0000-0000000000d2','00000000-0000-0000-0000-0000000000a1','z@example.test',3000,600,360,2040,'mock','pending','not-hex')" 2>&1 | grep -oE 'violates check constraint "[a-z_]*"')"
echo "admins_email_lowercase NOT VALID accepts legacy mixed-case row, rejects new: $($PSQL -c "INSERT INTO admins (email) VALUES ('UPPER@example.test')" 2>&1 | grep -oE 'violates check constraint "[a-z_]*"')"
echo "--- re-run migrate (no-op)"
DATABASE_URL=$URL npm run migrate 2>&1 | grep -E "applied|fail|error|up to date"
echo "--- 008/009/010 SQL applied manually 2x more (idempotent?)"
for i in 2 3; do for f in db/migrations/008* db/migrations/009* db/migrations/010*; do $PSQL -f "$f" >/dev/null 2>/tmp/mig-err.txt && echo "run$i $(basename $f) OK" || { echo "run$i $(basename $f) FAILED: $(head -c 200 /tmp/mig-err.txt)"; }; done; done
echo "post2: ledger $(snap); txns $($PSQL -c "select string_agg(right(id::text,3)||':'||status,' ' order by id) from transactions")"
echo "--- failed migration atomicity: break each of 008/009/010 (append SELECT 1/0) on a rolled-back copy"
for N in 008 009 010; do
  # reset to 007 state by dropping the objects of migrations >= N is invasive; instead test on a fresh clone DB
  CLONE=${DB}_c$N; $PSQL -c "DROP DATABASE IF EXISTS $CLONE" -d postgres >/dev/null 2>&1; psql -h localhost -U unveil -d postgres -c "CREATE DATABASE $CLONE" >/dev/null
  CP="psql -h localhost -U unveil -d $CLONE -v ON_ERROR_STOP=1 -At"
  $CP -c "CREATE TABLE schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())" >/dev/null
  for f in db/migrations/*.sql; do b=$(basename $f); [ "${b:0:3}" \< "$N" ] && { $CP -f $f >/dev/null 2>&1; $CP -c "INSERT INTO schema_migrations(name) VALUES ('$b')" >/dev/null; }; done
  TMP=$(mktemp -d); mkdir -p $TMP/db/migrations; cp db/migrations/*.sql $TMP/db/migrations/; echo "SELECT 1/0;" >> $TMP/db/migrations/${N}_*.sql 2>/dev/null || echo "SELECT 1/0;" >> $(ls $TMP/db/migrations/${N}_*.sql); cp -r scripts $TMP/scripts; ln -s /workspace/qa-pay3/node_modules $TMP/node_modules; cp package.json $TMP/
  OUT=$(cd $TMP && DATABASE_URL=postgres://unveil:unveil@localhost:5432/$CLONE npx tsx scripts/migrate.ts 2>&1 | grep -E "applied|failed" | tr '\n' ' ')
  APPLIED=$($CP -c "select string_agg(name,',' order by name) from schema_migrations where name >= '$N'")
  case $N in 008) COL="select count(*) from information_schema.columns where table_name='transactions' and column_name='buyer_token_hash'";; 009) COL="select count(*) from information_schema.tables where table_name='payments_janitor_state'";; 010) COL="select count(*) from information_schema.tables where table_name='admin_sessions'";; esac
  echo "broken $N: [$OUT] recorded>=$N: [${APPLIED:-none}] leftover objects of $N (0=rolled back): $($CP -c "$COL")"
  rm -rf $TMP; psql -h localhost -U unveil -d postgres -c "DROP DATABASE $CLONE" >/dev/null
done
echo "--- rollback: no down migrations ship. QA-authored down for 008-010 then re-upgrade preserves data"
$PSQL <<'SQL' >/dev/null
DROP INDEX IF EXISTS transactions_one_pending_per_client_uniq; 
DROP TABLE IF EXISTS admin_sessions; DROP TABLE IF EXISTS payments_janitor_state;
ALTER TABLE sellers DROP COLUMN risk_reviewed_at, DROP COLUMN risk_reviewed_by, DROP COLUMN risk_review_note;
ALTER TABLE admins DROP COLUMN password_hash, DROP COLUMN disabled_at, DROP COLUMN last_login_at;
ALTER TABLE webhook_events DROP COLUMN stale_flagged_at;
ALTER TABLE platform_settings DROP COLUMN void_refund_max_attempts, DROP COLUMN void_refund_backoff_minutes, DROP COLUMN parked_event_stale_hours;
ALTER TABLE transactions DROP COLUMN void_refund_attempts, DROP COLUMN void_refund_last_error, DROP COLUMN void_refund_last_attempt_at, DROP COLUMN void_refund_next_attempt_at, DROP COLUMN buyer_token_hash;
CREATE UNIQUE INDEX transactions_one_pending_uniq ON transactions (drop_id, lower(buyer_email)) WHERE status = 'pending';
DELETE FROM schema_migrations WHERE name >= '008';
SQL
echo "after down: ledger $(snap); txns $($PSQL -c 'select count(*) from transactions')"
DATABASE_URL=$URL npm run migrate 2>&1 | grep -E "applied|fail|error"
echo "re-upgraded: ledger $(snap); txns $($PSQL -c "select string_agg(right(id::text,3)||':'||status,' ' order by id) from transactions"); flag kept: $($PSQL -c "select risk_flagged_at is not null from sellers where id='00000000-0000-0000-0000-0000000000a1'")"
echo "--- concurrent migrate runners (advisory lock): 4 simultaneous npm run migrate on a fresh DB"
CD=${DB}_cc; psql -h localhost -U unveil -d postgres -c "DROP DATABASE IF EXISTS $CD" -c "CREATE DATABASE $CD" >/dev/null 2>&1
for i in 1 2 3 4; do (DATABASE_URL=postgres://unveil:unveil@localhost:5432/$CD npm run migrate > /tmp/mig-cc-$i.txt 2>&1 &) ; done; sleep 14
echo "applied counts per runner: $(for i in 1 2 3 4; do grep -c '^applied' /tmp/mig-cc-$i.txt; done | tr '\n' ' ') errors: $(cat /tmp/mig-cc-*.txt | grep -ciE 'fail|error')  schema_migrations rows: $(psql -h localhost -U unveil -d $CD -At -c 'select count(*) from schema_migrations')"
psql -h localhost -U unveil -d postgres -c "DROP DATABASE $CD" >/dev/null; rm -f /tmp/mig-cc-*.txt
