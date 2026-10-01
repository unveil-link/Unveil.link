#!/usr/bin/env bash
# 3920: main throwaway DB, webhook-rejected limiter at DEFAULT (60/min) and others raised.  3919: NON-OWNER app role (qa_app) on a separate cluster (port 5898), default admin limits raised only for IP.
cd /workspace/qa-pay5; set -a; . ./.env; set +a
export NODE_ENV=production NEXT_DIST_DIR=.next-qa MOCK_PAYMENTS_ENABLED=1
case "$1" in
 start)
  APP_URL=http://localhost:3920 RATE_LIMIT_CHECKOUT=100000/60 RATE_LIMIT_CRON=100000/60 RATE_LIMIT_ADMIN_LOGIN_IP=100000/900 setsid nohup npx next start -p 3920 > qa/artifacts/pay5-server-3920.log 2>&1 &
  DATABASE_URL=postgres://qa_app:qaapp@127.0.0.1:5898/unveil_qa_pay5_audit APP_URL=http://localhost:3919 RATE_LIMIT_CHECKOUT=100000/60 setsid nohup npx next start -p 3919 > qa/artifacts/pay5-server-3919.log 2>&1 &
  sleep 6;;
 stop) for p in 3919 3920; do pid=$(ss -ltnp "sport = :$p" | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2); [ -n "$pid" ] && kill "$pid"; done;;
esac
