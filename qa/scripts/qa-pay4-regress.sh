#!/usr/bin/env bash
# Runs the whole earlier probe suite (rounds 1-3) against the 3817/3818 throwaway servers, sequentially. Logs -> qa/artifacts/pay4-old-<name>.log
cd /workspace/qa-pay4; set -a; . ./.env; set +a
export QA_BASE_URL=http://localhost:3817 NEXT_DIST_DIR=.next-qa
for n in money webhooks refunds checkout payouts races session retry prod r2a r2b r2c r2d n1 n2 n3; do
  npx tsx qa/scripts/qa-pay4-$n.ts > qa/artifacts/pay4-old-$n.log 2>&1; echo "$n exit $?" >> qa/artifacts/pay4-regress-summary.txt
done
for m in ui dblclick adminui; do node qa/scripts/qa-pay4-$m.mjs > qa/artifacts/pay4-old-$m.log 2>&1; echo "$m exit $?" >> qa/artifacts/pay4-regress-summary.txt; done
echo DONE >> qa/artifacts/pay4-regress-summary.txt
