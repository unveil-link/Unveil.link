#!/usr/bin/env bash
# usage: qa-pay4-run.sh <script> <logname> : run a probe against the throwaway 3817/3818 servers
cd /workspace/qa-pay4
set -a; . ./.env; set +a
export QA_BASE_URL=http://localhost:3817 NEXT_DIST_DIR=.next-qa
exec npx tsx "qa/scripts/$1" > "qa/artifacts/$2" 2>&1
