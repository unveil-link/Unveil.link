#!/usr/bin/env bash
# End-to-end proof: builds + starts the app against a throwaway DB/storage dir and runs scripts/e2e.ts.
# Requires: Postgres reachable via DATABASE_URL-style creds (see .env), `npm ci` done.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; [ -f .env ] && . ./.env; set +a

PORT="${E2E_PORT:-3100}"
BASE_DB="${DATABASE_URL:?DATABASE_URL must be set (.env)}"
export E2E_DATABASE_URL="${E2E_DATABASE_URL:-$(echo "$BASE_DB" | sed -E 's#/[^/?]+(\?.*)?$#/unveil_e2e\1#')}"
export E2E_STORAGE_DIR="$PWD/.e2e/storage"
export E2E_BASE_URL="http://localhost:$PORT"
export NEXT_DIST_DIR=".next-e2e"
mkdir -p .e2e proof
rm -rf "$E2E_STORAGE_DIR"

echo "== resetting e2e database"
npx tsx scripts/e2e-setup.ts

echo "== building app"
DATABASE_URL="$E2E_DATABASE_URL" STORAGE_LOCAL_DIR="$E2E_STORAGE_DIR" APP_URL="$E2E_BASE_URL" npx next build > .e2e/build.log 2>&1 || { tail -40 .e2e/build.log; exit 1; }

echo "== starting app on :$PORT"
DATABASE_URL="$E2E_DATABASE_URL" STORAGE_DRIVER=local STORAGE_LOCAL_DIR="$E2E_STORAGE_DIR" APP_URL="$E2E_BASE_URL" \
  NODE_ENV=production npx next start -p "$PORT" > .e2e/server.log 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true; wait $SERVER_PID 2>/dev/null || true' EXIT
for i in $(seq 1 60); do
  curl -fs "$E2E_BASE_URL/api/settings" >/dev/null 2>&1 && break
  kill -0 $SERVER_PID 2>/dev/null || { echo "server died"; tail -30 .e2e/server.log; exit 1; }
  sleep 1
done

set +e
DATABASE_URL="$E2E_DATABASE_URL" STORAGE_LOCAL_DIR="$E2E_STORAGE_DIR" APP_URL="$E2E_BASE_URL" npx tsx scripts/e2e.ts
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
    echo "### platform_settings"; psql "$E2E_DATABASE_URL" -x -c "SELECT * FROM platform_settings"
  } > proof/db.txt 2>&1
  echo "== DB evidence written to proof/db.txt"
fi
exit $RC
