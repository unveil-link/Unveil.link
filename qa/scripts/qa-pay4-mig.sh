#!/bin/bash
# Round 4 QA: migration 011 upgrade path on a DB migrated through 010 with data (admins with history, audit rows incl. NULL admin_id CLI rows, an
# audit row whose admin was SET-NULLed). Usage: qa-pay4-mig.sh <dbname>  (unveil_qa_pay4*)
set -u
DB=${1:?db}; case "$DB" in unveil_qa_pay4*) ;; *) echo "refusing: $DB"; exit 2;; esac
export PGPASSWORD=unveil
PSQL="psql -h localhost -U unveil -d $DB -v ON_ERROR_STOP=1 -At"
URL=postgres://unveil:unveil@localhost:5432/$DB
cd "$(dirname "$0")/../.."
$PSQL -c "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())" >/dev/null
for f in db/migrations/0[01][0-9]_*.sql; do b=$(basename $f); [ "${b:0:3}" \< "011" ] || continue; $PSQL -f "$f" >/dev/null 2>&1 && $PSQL -c "INSERT INTO schema_migrations(name) VALUES ('$b')" >/dev/null || { echo "FAILED $f"; exit 1; }; done
echo "applied 001-010: $($PSQL -c 'select count(*) from schema_migrations')"
$PSQL <<'SQL' >/dev/null
INSERT INTO admins (id,email,password_hash) VALUES
 ('00000000-0000-0000-0000-0000000000e1','hist-admin@example.test','x'),
 ('00000000-0000-0000-0000-0000000000e2','nohist-admin@example.test','x'),
 ('00000000-0000-0000-0000-0000000000e3','cli-only@example.test','x'),
 ('00000000-0000-0000-0000-0000000000e4','second-hist@example.test','x');
-- 010-era writers: actor rows (admin_id set), CLI rows (admin_id NULL, subject in target), a row orphaned by the old ON DELETE SET NULL
INSERT INTO audit_log (admin_id, action, target) VALUES
 ('00000000-0000-0000-0000-0000000000e1','admin_login','admin:00000000-0000-0000-0000-0000000000e1'),
 ('00000000-0000-0000-0000-0000000000e1','seller_flag_cleared','seller:00000000-0000-0000-0000-0000000000a1 previous_reason: x | note: ok'),
 ('00000000-0000-0000-0000-0000000000e4','admin_login','admin:00000000-0000-0000-0000-0000000000e4'),
 (NULL,'admin_created_cli','admin:00000000-0000-0000-0000-0000000000e3'),
 (NULL,'admin_password_reset_cli','admin:00000000-0000-0000-0000-0000000000e3'),
 (NULL,'admin_created_cli','admin:00000000-0000-0000-0000-0000000000dd'),   -- admin already deleted: stays NULL email
 (NULL,'payments_janitor_run','counts {}'),
 (NULL,'seller_flagged_repeat_chargebacks','seller:x 3 chargebacks');
SQL
H0=$($PSQL -c "select md5(string_agg(id::text||coalesce(admin_id::text,'')||action||target||created_at::text, ',' order by id)) from audit_log")
echo "pre: audit rows $($PSQL -c 'select count(*) from audit_log'), hash $H0; old FK: $($PSQL -c "select confdeltype from pg_constraint where conrelid='audit_log'::regclass and contype='f'") (n=SET NULL); old delete of admin with history would null the FK"
echo "--- npm run migrate (010 -> 011)"
DATABASE_URL=$URL npm run migrate 2>&1 | grep -E "applied|fail|error|up to date|done"
echo "post: rows $($PSQL -c 'select count(*) from audit_log'); original columns hash unchanged: $([ "$($PSQL -c "select md5(string_agg(id::text||coalesce(admin_id::text,'')||action||target||created_at::text, ',' order by id)) from audit_log")" = "$H0" ] && echo YES || echo NO)"
echo "FK now: $($PSQL -c "select confdeltype from pg_constraint where conrelid='audit_log'::regclass and contype='f'") (r=RESTRICT); triggers: $($PSQL -c "select string_agg(tgname,',' order by tgname) from pg_trigger where tgrelid='audit_log'::regclass and not tgisinternal")"
echo "backfill admin_email: $($PSQL -c "select string_agg(action||'='||coalesce(admin_email,'NULL'), ' ; ' order by action, admin_email nulls last) from audit_log where action in ('admin_login','seller_flag_cleared','admin_created_cli','admin_password_reset_cli')")"
echo "system rows (janitor/chargeback) stay NULL email: $($PSQL -c "select count(*) from audit_log where action in ('payments_janitor_run','seller_flagged_repeat_chargebacks') and admin_email is null")/2; orphan CLI row (admin gone) NULL: $($PSQL -c "select count(*) from audit_log where target like '%0000dd' and admin_email is null")/1"
echo "second admin with history snapshot: $($PSQL -c "select admin_email from audit_log where admin_id='00000000-0000-0000-0000-0000000000e4'")"
echo "--- immutability on migrated rows"
for s in "UPDATE audit_log SET target='x'" "DELETE FROM audit_log" "TRUNCATE audit_log" "DELETE FROM admins WHERE id='00000000-0000-0000-0000-0000000000e1'" "DELETE FROM admins WHERE id='00000000-0000-0000-0000-0000000000e3'"; do echo "  $s -> $($PSQL -c "$s" 2>&1 | head -1 | cut -c1-110)"; done
echo "  DELETE admin with NO history -> $($PSQL -c "DELETE FROM admins WHERE id='00000000-0000-0000-0000-0000000000e2'" 2>&1 | head -1) (rows now $($PSQL -c "select count(*) from admins where id='00000000-0000-0000-0000-0000000000e2'")=0 expected)"
echo "  disable/enable audited: $($PSQL -c "update admins set disabled_at=now() where id='00000000-0000-0000-0000-0000000000e1'; update admins set disabled_at=null where id='00000000-0000-0000-0000-0000000000e1'; select string_agg(action||':'||admin_email,',' order by created_at) from audit_log where action in ('admin_disabled','admin_enabled')" | tail -1)"
echo "--- re-run migrate (no-op) + 011 SQL applied manually 2 more times (idempotent; existing rows/hash untouched)"
DATABASE_URL=$URL npm run migrate 2>&1 | grep -E "applied|fail|error|up to date"
n0=$($PSQL -c 'select count(*) from audit_log')
for i in 2 3; do $PSQL -f db/migrations/011_audit_hardening.sql >/dev/null 2>/tmp/mig4-err.txt && echo "run$i 011 OK" || echo "run$i 011 FAILED: $(head -c 200 /tmp/mig4-err.txt)"; done
echo "rows before/after manual re-runs: $n0 / $($PSQL -c 'select count(*) from audit_log'); triggers: $($PSQL -c "select count(*) from pg_trigger where tgrelid='audit_log'::regclass and not tgisinternal") (3 expected); immutability still on: $($PSQL -c "update audit_log set target='x'" 2>&1 | head -1 | cut -c1-60)"
echo "--- failed 011 rolls back atomically (SELECT 1/0 appended) on a clone at 010"
CL=${DB}_c011; psql -h localhost -U unveil -d postgres -c "DROP DATABASE IF EXISTS $CL" >/dev/null 2>&1; psql -h localhost -U unveil -d postgres -c "CREATE DATABASE $CL" >/dev/null
CP="psql -h localhost -U unveil -d $CL -v ON_ERROR_STOP=1 -At"
$CP -c "CREATE TABLE schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())" >/dev/null
for f in db/migrations/*.sql; do b=$(basename $f); [ "${b:0:3}" \< "011" ] && { $CP -f $f >/dev/null 2>&1; $CP -c "INSERT INTO schema_migrations(name) VALUES ('$b')" >/dev/null; }; done
$CP -c "INSERT INTO audit_log (action,target) VALUES ('legacy','x')" >/dev/null
TMP=$(mktemp -d); mkdir -p $TMP/db/migrations; cp db/migrations/*.sql $TMP/db/migrations/; echo "SELECT 1/0;" >> $TMP/db/migrations/011_audit_hardening.sql; cp -r scripts $TMP/scripts; ln -s /workspace/qa-pay4/node_modules $TMP/node_modules; cp package.json tsconfig.json $TMP/ 2>/dev/null
OUT=$(cd $TMP && DATABASE_URL=postgres://unveil:unveil@localhost:5432/$CL npx tsx scripts/migrate.ts 2>&1 | grep -E "applied|failed" | tr '\n' ' ')
echo "broken 011: [$OUT] recorded 011: [$($CP -c "select count(*) from schema_migrations where name like '011%'")] (0 expected); leftovers: admin_email col $($CP -c "select count(*) from information_schema.columns where table_name='audit_log' and column_name='admin_email'") buckets table $($CP -c "select count(*) from information_schema.tables where table_name='admin_login_failure_buckets'") append-only trigger $($CP -c "select count(*) from pg_trigger where tgname='audit_log_no_update'") (all 0 = rolled back); legacy row still mutable: $($CP -c "update audit_log set target='y' where action='legacy'; select target from audit_log where action='legacy'" | tail -1)"
rm -rf $TMP
echo "--- concurrent runners (advisory lock): 4 simultaneous 'npm run migrate' on a fresh DB, plus 011 while another connection holds audit_log lock"
CD=${DB}_cc; psql -h localhost -U unveil -d postgres -c "DROP DATABASE IF EXISTS $CD" -c "CREATE DATABASE $CD" >/dev/null 2>&1
for i in 1 2 3 4; do (DATABASE_URL=postgres://unveil:unveil@localhost:5432/$CD npm run migrate > /tmp/mig4-cc-$i.txt 2>&1 &) ; done; sleep 15
echo "applied lines per runner: $(for i in 1 2 3 4; do grep -c '^applied' /tmp/mig4-cc-$i.txt; done | tr '\n' ' ') (sum must be 11) errors: $(cat /tmp/mig4-cc-*.txt | grep -ciE 'fail|error') schema_migrations rows: $(psql -h localhost -U unveil -d $CD -At -c 'select count(*) from schema_migrations') triggers on audit_log: $(psql -h localhost -U unveil -d $CD -At -c "select count(*) from pg_trigger where tgrelid='audit_log'::regclass and not tgisinternal")"
psql -h localhost -U unveil -d postgres -c "DROP DATABASE $CD" -c "DROP DATABASE $CL" >/dev/null; rm -f /tmp/mig4-cc-*.txt
echo "--- QA-authored down (none ships) + re-upgrade preserves rows"
$PSQL <<'SQL' >/dev/null
DROP TRIGGER audit_log_no_update ON audit_log; DROP TRIGGER audit_log_no_truncate ON audit_log; DROP TRIGGER audit_log_fill_email ON audit_log; DROP TRIGGER admins_guard_delete ON admins; DROP TRIGGER admins_audit_disable ON admins;
DROP TABLE admin_login_failure_buckets; ALTER TABLE audit_log DROP COLUMN admin_email, DROP COLUMN ip, DROP COLUMN reason;
ALTER TABLE audit_log DROP CONSTRAINT audit_log_admin_id_fkey; ALTER TABLE audit_log ADD CONSTRAINT audit_log_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE SET NULL;
DELETE FROM schema_migrations WHERE name='011_audit_hardening.sql';
SQL
echo "after down: rows $($PSQL -c 'select count(*) from audit_log')"
DATABASE_URL=$URL npm run migrate 2>&1 | grep -E "applied|fail|error"
echo "re-upgraded: rows $($PSQL -c 'select count(*) from audit_log'), emails backfilled $($PSQL -c "select count(admin_email) from audit_log"), immutable $($PSQL -c "update audit_log set target='x'" 2>&1 | head -1 | cut -c1-50)"
