#!/usr/bin/env bash
# PAN/CVC/secret grep over a full pg_dump of the throwaway DB + all server/probe logs
cd /workspace/qa-pay5; set -a; . ./.env; set +a
pg_dump "$DATABASE_URL" > /tmp/qa-pay5-dump.sql; echo "dump bytes: $(wc -c < /tmp/qa-pay5-dump.sql)"
for pan in 4242424242424242 4000000000000002 4000000000009995 4000000000000069 4000000000000127 5555555555554444; do echo "PAN $pan: dump $(grep -c "$pan" /tmp/qa-pay5-dump.sql) logs $(cat qa/artifacts/pay5-server-*.log qa/artifacts/pay5-old-*.log 2>/dev/null | grep -ac "$pan")"; done
ADMPW='Qa-Admin-Passphrase-93!x'
for name in CRON_SECRET SESSION_SECRET PAYMENT_WEBHOOK_SECRET; do v=$(eval echo \$$name); echo "$name value: dump $(grep -cF "$v" /tmp/qa-pay5-dump.sql) server-logs $(cat qa/artifacts/pay5-server-*.log | grep -acF "$v")"; done
echo "admin password plaintext: dump $(grep -cF "$ADMPW" /tmp/qa-pay5-dump.sql) server-logs $(cat qa/artifacts/pay5-server-*.log | grep -acF "$ADMPW")"
echo "CVC-ish 'cvc' fields in dump: $(grep -aic '"cvc"\|"cvv"' /tmp/qa-pay5-dump.sql)"
rm -f /tmp/qa-pay5-dump.sql
