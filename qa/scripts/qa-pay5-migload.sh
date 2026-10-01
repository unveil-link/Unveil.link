#!/bin/bash
# Round 5: migration 012 under load. New app code (16da94b) on a DB at 011: admin logins in a loop on :3923 while `npm run migrate` applies 012 mid-run. Records status timeline.
set -u; cd /workspace/qa-pay5; export PGPASSWORD=unveil; DB=unveil_qa_pay5_load; URL=postgres://unveil:unveil@localhost:5432/$DB
psql -h localhost -U unveil -d postgres -qc "DROP DATABASE IF EXISTS $DB WITH (FORCE)" -c "CREATE DATABASE $DB" >/dev/null
P="psql -h localhost -U unveil -d $DB -v ON_ERROR_STOP=1 -At"; $P -c "CREATE TABLE schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())" >/dev/null
for f in db/migrations/0[01][0-9]_*.sql; do b=$(basename $f); [ "${b:0:3}" \< "012" ] || continue; $P -f $f >/dev/null && $P -c "INSERT INTO schema_migrations(name) VALUES ('$b')" >/dev/null; done
set -a; . ./.env; set +a; export DATABASE_URL=$URL
ADMIN=ml-$(date +%s)@example.test; ADMIN_PASSWORD='Qa-Admin-Passphrase-93!x' npx tsx scripts/create-admin.ts $ADMIN >/dev/null 2>&1
H0=$($P -c "select count(*) from admins")
# a pre-existing session (minted at 011, no version column)
export NODE_ENV=production NEXT_DIST_DIR=.next-qa MOCK_PAYMENTS_ENABLED=1 APP_URL=http://localhost:3923 RATE_LIMIT_ADMIN_LOGIN_IP=100000/900 LOGIN_DELAY_THRESHOLD=100
setsid nohup npx next start -p 3923 > qa/artifacts/pay5-server-3923.log 2>&1 &
sleep 7
COOKIE_JAR=/tmp/qa5-ml-jar; rm -f $COOKIE_JAR
echo "pre-migration: login with NEW code on an 011 schema:"
curl -s -o /dev/null -w "  HTTP %{http_code}\n" -c $COOKIE_JAR -H 'content-type: application/json' -H 'x-forwarded-for: 10.5.5.5' -d "{\"email\":\"$ADMIN\",\"password\":\"Qa-Admin-Passphrase-93!x\"}" localhost:3923/api/admin/login
echo "  /api/admin/me with the pre-migration cookie (if any): $(curl -s -o /dev/null -w '%{http_code}' -b $COOKIE_JAR localhost:3923/api/admin/me)"
( for i in $(seq 1 120); do curl -s -o /dev/null -w "%{http_code} " -H 'content-type: application/json' -H "x-forwarded-for: 10.5.6.$((i%250))" -d "{\"email\":\"$ADMIN\",\"password\":\"Qa-Admin-Passphrase-93!x\"}" localhost:3923/api/admin/login; sleep 0.1; done > /tmp/qa5-ml-timeline.txt ) &
sleep 3; echo "--- applying migration mid-run"; npm run migrate 2>&1 | grep -E "applied|fail|error"
wait
echo "timeline of login statuses (100 ms apart; migration applied after ~3 s): $(cat /tmp/qa5-ml-timeline.txt)"
echo "after: columns $($P -c "select count(*) from information_schema.columns where column_name='credentials_version'") (2); login: $(curl -s -o /dev/null -w '%{http_code}' -c $COOKIE_JAR -H 'content-type: application/json' -H 'x-forwarded-for: 10.5.7.7' -d "{\"email\":\"$ADMIN\",\"password\":\"Qa-Admin-Passphrase-93!x\"}" localhost:3923/api/admin/login); me: $(curl -s -o /dev/null -w '%{http_code}' -b $COOKIE_JAR localhost:3923/api/admin/me)"
pid=$(ss -ltnp "sport = :3923" | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2); [ -n "$pid" ] && kill $pid
psql -h localhost -U unveil -d postgres -qc "DROP DATABASE $DB WITH (FORCE)" >/dev/null; rm -f /tmp/qa5-ml-*
