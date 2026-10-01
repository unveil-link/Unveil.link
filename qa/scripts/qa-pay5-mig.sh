#!/bin/bash
# Round 5 QA: migration 012 (admins/admin_sessions.credentials_version + bump trigger) on a DB migrated through 011 WITH data. Usage: qa-pay5-mig.sh <unveil_qa_pay5*_db>
set -u
DB=${1:?db}; case "$DB" in unveil_qa_pay5*) ;; *) echo "refusing: $DB"; exit 2;; esac
export PGPASSWORD=unveil
PSQL="psql -h localhost -U unveil -d $DB -v ON_ERROR_STOP=1 -At"; URL=postgres://unveil:unveil@localhost:5432/$DB
cd "$(dirname "$0")/../.."
mkdb(){ psql -h localhost -U unveil -d postgres -qc "DROP DATABASE IF EXISTS $1 WITH (FORCE)" -c "CREATE DATABASE $1" >/dev/null; }
upto11(){ local P="psql -h localhost -U unveil -d $1 -v ON_ERROR_STOP=1 -At"; $P -c "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())" >/dev/null; for f in db/migrations/*.sql; do b=$(basename $f); [ "${b:0:3}" \< "012" ] || continue; $P -f "$f" >/dev/null 2>&1 && $P -c "INSERT INTO schema_migrations(name) VALUES ('$b')" >/dev/null || { echo "FAILED $f"; exit 1; }; done; }
seed(){ local P="psql -h localhost -U unveil -d $1 -v ON_ERROR_STOP=1 -At"; $P <<'SQL' >/dev/null
INSERT INTO admins (id,email,password_hash,disabled_at) VALUES
 ('00000000-0000-0000-0000-0000000000e1','enabled-hist@example.test','x',NULL),
 ('00000000-0000-0000-0000-0000000000e2','disabled-hist@example.test','x',now()),
 ('00000000-0000-0000-0000-0000000000e3','enabled-nohist@example.test','x',NULL),
 ('00000000-0000-0000-0000-0000000000e4','nopw@example.test',NULL,NULL);
INSERT INTO admin_sessions (id, admin_id, expires_at, revoked_at) VALUES
 ('00000000-0000-0000-0000-0000000005a1','00000000-0000-0000-0000-0000000000e1', now()+interval '5 hours', NULL),
 ('00000000-0000-0000-0000-0000000005a2','00000000-0000-0000-0000-0000000000e1', now()+interval '5 hours', now()),
 ('00000000-0000-0000-0000-0000000005a3','00000000-0000-0000-0000-0000000000e1', now()-interval '1 hour', NULL),
 ('00000000-0000-0000-0000-0000000005a4','00000000-0000-0000-0000-0000000000e2', now()+interval '5 hours', NULL);
INSERT INTO audit_log (admin_id, action, target) VALUES
 ('00000000-0000-0000-0000-0000000000e1','admin_login','admin:00000000-0000-0000-0000-0000000000e1'),
 ('00000000-0000-0000-0000-0000000000e2','admin_login','admin:00000000-0000-0000-0000-0000000000e2'),
 (NULL,'admin_login_failed','x'), (NULL,'payments_janitor_run','counts {}');
SQL
}
AH(){ $PSQL -c "select md5(string_agg(id::text||coalesce(admin_id::text,'')||action||target||created_at::text||coalesce(admin_email,''), ',' order by id)) from audit_log"; }
echo "=== 1. upgrade 011 -> 012 with live sessions, enabled+disabled admins, audit rows"
mkdb $DB; upto11 $DB; seed $DB
echo "pre: has column? $($PSQL -c "select count(*) from information_schema.columns where table_name in ('admins','admin_sessions') and column_name='credentials_version'") (0); sessions $($PSQL -c 'select count(*) from admin_sessions'); audit $($PSQL -c 'select count(*) from audit_log')"
H0=$(AH); ADM0=$($PSQL -c "select md5(string_agg(id::text||email||coalesce(password_hash,'')||coalesce(disabled_at::text,''),',' order by id)) from admins")
echo "--- npm run migrate"; DATABASE_URL=$URL npm run migrate 2>&1 | grep -E "applied|fail|error|up to date|done"
echo "post: columns $($PSQL -c "select string_agg(table_name,',' order by table_name) from information_schema.columns where column_name='credentials_version'") ; admins versions: $($PSQL -c "select string_agg(left(email,12)||'=v'||credentials_version, ' ' order by email) from admins") (all 1 expected)"
echo "sessions versions: $($PSQL -c "select string_agg(distinct credentials_version::text, ',') from admin_sessions") (1 expected); session rows $($PSQL -c 'select count(*) from admin_sessions') (4); audit hash unchanged: $([ "$(AH)" = "$H0" ] && echo YES || echo NO); admins data unchanged: $([ "$($PSQL -c "select md5(string_agg(id::text||email||coalesce(password_hash,'')||coalesce(disabled_at::text,''),',' order by id)) from admins")" = "$ADM0" ] && echo YES || echo NO)"
echo "NOTE: because the backfill is DEFAULT 1 on both tables, sessions created before 012 REMAIN VALID (session v1 == admin v1) - documented behaviour is 'additive'; verify through HTTP below"
echo "trigger: $($PSQL -c "select tgname||' enabled='||tgenabled::text from pg_trigger where tgrelid='admins'::regclass and not tgisinternal order by 1" | tr '\n' ' ')"
echo "bump works: $($PSQL -c "update admins set password_hash='y' where id='00000000-0000-0000-0000-0000000000e3' returning credentials_version") (2); no-op: $($PSQL -c "update admins set password_hash='y' where id='00000000-0000-0000-0000-0000000000e3' returning credentials_version") (2); disable: $($PSQL -c "update admins set disabled_at=now() where id='00000000-0000-0000-0000-0000000000e3' returning credentials_version") (3)"
echo "immutability from 011 intact: $($PSQL -c "update audit_log set target='x'" 2>&1 | head -1 | cut -c1-70); disable audit trigger still audits: $($PSQL -c "select count(*) from audit_log where action='admin_disabled'")"
echo "=== 2. idempotent: migrate again no-op; 012 applied manually 3x"
DATABASE_URL=$URL npm run migrate 2>&1 | grep -E "applied|fail|error|up to date|done"
v=$($PSQL -c "select string_agg(credentials_version::text,',' order by email) from admins")
for i in 1 2 3; do $PSQL -f db/migrations/012_admin_credentials_version.sql >/dev/null 2>/tmp/mig5-err.txt && echo "manual run$i OK" || echo "manual run$i FAILED $(head -c 200 /tmp/mig5-err.txt)"; done
echo "versions before/after manual re-runs: $v / $($PSQL -c "select string_agg(credentials_version::text,',' order by email) from admins") ; triggers on admins: $($PSQL -c "select count(*) from pg_trigger where tgrelid='admins'::regclass and tgname='admins_bump_credentials_version'") (1)"
echo "=== 3. failed 012 rolls back atomically"
CL=${DB}_c12; mkdb $CL; upto11 $CL; seed $CL; CP="psql -h localhost -U unveil -d $CL -v ON_ERROR_STOP=1 -At"
TMP=$(mktemp -d); mkdir -p $TMP/db/migrations; cp db/migrations/*.sql $TMP/db/migrations/; echo "SELECT 1/0;" >> $TMP/db/migrations/012_admin_credentials_version.sql; cp -r scripts $TMP/scripts; ln -s /workspace/qa-pay5/node_modules $TMP/node_modules; cp package.json tsconfig.json $TMP/
OUT=$(cd $TMP && DATABASE_URL=postgres://unveil:unveil@localhost:5432/$CL npx tsx scripts/migrate.ts 2>&1 | grep -E "applied|failed" | tr '\n' ' ')
echo "broken 012: [$OUT] recorded: $($CP -c "select count(*) from schema_migrations where name like '012%'") (0); leftovers: columns $($CP -c "select count(*) from information_schema.columns where column_name='credentials_version'") trigger $($CP -c "select count(*) from pg_trigger where tgname='admins_bump_credentials_version'") function $($CP -c "select count(*) from pg_proc where proname='admins_bump_credentials_version'") (all 0 = rolled back); sessions intact $($CP -c 'select count(*) from admin_sessions')"
rm -rf $TMP; psql -h localhost -U unveil -d postgres -qc "DROP DATABASE $CL WITH (FORCE)" >/dev/null
echo "=== 4. four concurrent runners on a DB at 011 with data"
CD=${DB}_cc; mkdb $CD; upto11 $CD; seed $CD
for i in 1 2 3 4; do (DATABASE_URL=postgres://unveil:unveil@localhost:5432/$CD npm run migrate > /tmp/mig5-cc-$i.txt 2>&1 &) ; done; sleep 12
echo "applied lines per runner: $(for i in 1 2 3 4; do grep -c '^applied' /tmp/mig5-cc-$i.txt; done | tr '\n' ' ') (sum must be 1); errors: $(cat /tmp/mig5-cc-*.txt | grep -ciE 'fail|error'); 012 rows: $(psql -h localhost -U unveil -d $CD -At -c "select count(*) from schema_migrations where name like '012%'"); triggers: $(psql -h localhost -U unveil -d $CD -At -c "select count(*) from pg_trigger where tgname='admins_bump_credentials_version'")"
psql -h localhost -U unveil -d postgres -qc "DROP DATABASE $CD WITH (FORCE)" >/dev/null; rm -f /tmp/mig5-cc-*.txt /tmp/mig5-err.txt
echo "=== 5. 012 while another transaction holds a row lock on admins (migration waits, then completes; no deadlock)"
CK=${DB}_lk; mkdb $CK; upto11 $CK; seed $CK
( psql -h localhost -U unveil -d $CK -qAt -c "BEGIN; SELECT * FROM admins FOR UPDATE; SELECT pg_sleep(4); COMMIT;" >/dev/null 2>&1 & ); sleep 1
S=$(date +%s); DATABASE_URL=postgres://unveil:unveil@localhost:5432/$CK npm run migrate 2>&1 | grep -E "applied 012|fail|error"; echo "waited $(( $(date +%s)-S )) s for the lock holder, then applied (ACCESS EXCLUSIVE needed by ALTER TABLE: logins block for the duration; migration itself is milliseconds)"
psql -h localhost -U unveil -d postgres -qc "DROP DATABASE $CK WITH (FORCE)" >/dev/null
