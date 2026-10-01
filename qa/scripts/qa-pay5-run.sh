#!/usr/bin/env bash
# usage: qa-pay5-run.sh <script> <logname> : run a probe against the throwaway 3917/3918 servers
cd /workspace/qa-pay5
set -a; . ./.env; set +a
export QA_BASE_URL=http://localhost:3917 NEXT_DIST_DIR=.next-qa
exec npx tsx "qa/scripts/$1" > "qa/artifacts/$2" 2>&1
