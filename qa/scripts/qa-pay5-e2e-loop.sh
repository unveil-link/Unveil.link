#!/usr/bin/env bash
# usage: qa-pay5-e2e-loop.sh <n> <prefix> [wrapper...]  -- sequential e2e runs on own DB (unveil_e2e_qapay5) / port 3930
cd /workspace/qa-pay5; set -a; . ./.env; set +a
export E2E_DATABASE_URL=postgres://unveil:unveil@localhost:5432/unveil_e2e_qapay5 E2E_PORT=3930
N=$1; P=$2; shift 2
for i in $(seq 1 $N); do
  s=$(date +%s); "$@" npm run e2e > qa/artifacts/pay5-$P-$i.log 2>&1; echo "run $i exit $? $(( $(date +%s)-s ))s" >> qa/artifacts/pay5-$P-summary.txt
done
