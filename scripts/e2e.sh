#!/usr/bin/env bash
# End-to-end proof: builds + starts the app against a throwaway DB/storage dir and runs scripts/e2e.ts.
# Requires: Postgres reachable via DATABASE_URL-style creds (see .env), `npm ci` done.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; [ -f .env ] && . ./.env; set +a

# Default 3100; if something else already listens there (e.g. a stale server from an earlier run, which would make the
# suite test the WRONG code), fall back to the next free port instead of silently talking to it.
PORT="${E2E_PORT:-3100}"
if [ -z "${E2E_PORT:-}" ]; then
  while (exec 3<>/dev/tcp/127.0.0.1/"$PORT") 2>/dev/null; do PORT=$((PORT+1)); done
fi
BASE_DB="${DATABASE_URL:?DATABASE_URL must be set (.env)}"
export E2E_DATABASE_URL="${E2E_DATABASE_URL:-$(echo "$BASE_DB" | sed -E 's#/[^/?]+(\?.*)?$#/unveil_e2e\1#')}"
export E2E_STORAGE_DIR="$PWD/.e2e/storage"
export E2E_BASE_URL="http://localhost:$PORT"
export NEXT_DIST_DIR=".next-e2e"
export E2E_MAIL_DIR="$PWD/.e2e/mail"
# Payments (mock processor). The app runs as a production build on loopback, which is the ONE case MOCK_PAYMENTS_LOCAL_BUILD allows.
# Throwaway secret, generated per run (never committed).
export PAYMENT_PROVIDER=mock
export PAYMENT_WEBHOOK_SECRET="${PAYMENT_WEBHOOK_SECRET_E2E:-$(openssl rand -hex 32)}"
mkdir -p .e2e proof
rm -rf "$E2E_STORAGE_DIR" "$E2E_MAIL_DIR"

echo "== resetting e2e database"
npx tsx scripts/e2e-setup.ts

echo "== building app"
DATABASE_URL="$E2E_DATABASE_URL" STORAGE_LOCAL_DIR="$E2E_STORAGE_DIR" APP_URL="$E2E_BASE_URL" npx next build > .e2e/build.log 2>&1 || { tail -40 .e2e/build.log; exit 1; }

if (exec 3<>/dev/tcp/127.0.0.1/"$PORT") 2>/dev/null; then
  echo "port $PORT is already in use (a stale server would make the e2e run test the wrong code). Stop it or set E2E_PORT." >&2
  exit 1
fi
echo "== starting app on :$PORT"
DATABASE_URL="$E2E_DATABASE_URL" STORAGE_DRIVER=local STORAGE_LOCAL_DIR="$E2E_STORAGE_DIR" APP_URL="$E2E_BASE_URL" \
  MAIL_TRANSPORT=file MAIL_DEV_DIR="$E2E_MAIL_DIR" RATE_LIMIT_CHECKOUT="3/60" MOCK_PAYMENTS_LOCAL_BUILD=1 \
  LOGIN_DELAY_THRESHOLD=3 LOGIN_DELAY_BASE_SECONDS=1 LOGIN_DELAY_CAP_SECONDS=4 LOGIN_DELAY_DECAY_SECONDS=600 \
  NODE_ENV=production setsid npx next start -p "$PORT" > .e2e/server.log 2>&1 &
SERVER_PID=$!
# setsid => own process group; kill the whole group so no orphaned next-server keeps the port (it used to leak).
trap 'kill -- -$SERVER_PID 2>/dev/null || kill $SERVER_PID 2>/dev/null || true; wait $SERVER_PID 2>/dev/null || true' EXIT
for i in $(seq 1 60); do
  curl -fs "$E2E_BASE_URL/api/settings" >/dev/null 2>&1 && break
  kill -0 $SERVER_PID 2>/dev/null || { echo "server died"; tail -30 .e2e/server.log; exit 1; }
  sleep 1
done

set +e
DATABASE_URL="$E2E_DATABASE_URL" STORAGE_LOCAL_DIR="$E2E_STORAGE_DIR" APP_URL="$E2E_BASE_URL" MAIL_DEV_DIR="$E2E_MAIL_DIR" npx tsx scripts/e2e.ts
RC=$?
set -e

# DB evidence (tables + seller row) for proof/
if command -v psql >/dev/null; then
  {
    echo "### \\dt"; psql "$E2E_DATABASE_URL" -c '\dt'
    echo "### sellers (no secrets: password_hash shown as prefix only)"
    psql "$E2E_DATABASE_URL" -x -c "SELECT id, email, left(password_hash,7) || '…' AS password_hash_prefix, google_id, display_name, verification_status, verification_ref, legal_name, dob, payout_details, created_at FROM sellers ORDER BY created_at"
    echo "### drops"; psql "$E2E_DATABASE_URL" -c "SELECT id, seller_id, public_link_id, title, price_cents, status, attestation FROM drops ORDER BY created_at"
    echo "### drop_files"; psql "$E2E_DATABASE_URL" -c "SELECT id, drop_id, storage_key, filename, mime, size_bytes, blurred_preview_key, sort_order FROM drop_files"
    echo "### transactions"; psql "$E2E_DATABASE_URL" -c "SELECT id, status, provider, amount_cents, platform_fee_cents, processing_fee_cents, seller_net_cents, reversed_cents, failure_code FROM transactions ORDER BY created_at"
    echo "### ledger_entries"; psql "$E2E_DATABASE_URL" -c "SELECT id, transaction_id, entry_type, component, amount_cents FROM ledger_entries ORDER BY id"
    echo "### webhook_events (reconciliation log)"; psql "$E2E_DATABASE_URL" -c "SELECT provider, provider_event_id, event_type, signature_valid, outcome, outcome_detail, transaction_id, left(payload_sha256,12) AS sha FROM webhook_events ORDER BY received_at, id"
    echo "### platform_settings"; psql "$E2E_DATABASE_URL" -x -c "SELECT * FROM platform_settings"
  } > proof/db.txt 2>&1
  echo "== DB evidence written to proof/db.txt"
fi
exit $RC
