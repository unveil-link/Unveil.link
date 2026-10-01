#!/usr/bin/env bash
# start/stop the two QA servers (production build, loopback, mock enabled). 3817: limiters raised; 3818: default limits.
cd /workspace/qa-pay4; set -a; . ./.env; set +a
export NODE_ENV=production NEXT_DIST_DIR=.next-qa MOCK_PAYMENTS_ENABLED=1
case "$1" in
 start)
  APP_URL=http://localhost:3817 RATE_LIMIT_CHECKOUT=100000/60 RATE_LIMIT_CRON=100000/60 RATE_LIMIT_ADMIN_LOGIN_IP=100000/900 RATE_LIMIT_LOGIN_IP=100000/900 RATE_LIMIT_SIGNUP_IP=100000/3600 RATE_LIMIT_FORGOT_IP=100000/3600 RATE_LIMIT_RESET_IP=100000/3600 RATE_LIMIT_WEBHOOK_REJECTED=100000/60 RATE_LIMIT_SIGNED_URL=100000/60 RATE_LIMIT_PUBLIC_LINK=100000/60 RATE_LIMIT_DOWNLOAD=100000/60 setsid nohup npx next start -p 3817 > qa/artifacts/pay4-server-3817.log 2>&1 &
  APP_URL=http://localhost:3818 setsid nohup npx next start -p 3818 > qa/artifacts/pay4-server-3818.log 2>&1 &
  sleep 6;;
 stop) for p in 3817 3818; do pid=$(ss -ltnp "sport = :$p" | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2); [ -n "$pid" ] && kill "$pid"; done;; # only our own ports
esac
