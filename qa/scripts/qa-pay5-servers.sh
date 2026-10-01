#!/usr/bin/env bash
# start/stop the two QA servers (production build, loopback, mock enabled). 3917: limiters raised; 3918: default limits.
cd /workspace/qa-pay5; set -a; . ./.env; set +a
export NODE_ENV=production NEXT_DIST_DIR=.next-qa MOCK_PAYMENTS_ENABLED=1
case "$1" in
 start)
  APP_URL=http://localhost:3917 RATE_LIMIT_CHECKOUT=100000/60 RATE_LIMIT_CRON=100000/60 RATE_LIMIT_ADMIN_LOGIN_IP=100000/900 RATE_LIMIT_LOGIN_IP=100000/900 RATE_LIMIT_SIGNUP_IP=100000/3600 RATE_LIMIT_FORGOT_IP=100000/3600 RATE_LIMIT_RESET_IP=100000/3600 RATE_LIMIT_WEBHOOK_REJECTED=100000/60 RATE_LIMIT_SIGNED_URL=100000/60 RATE_LIMIT_PUBLIC_LINK=100000/60 RATE_LIMIT_DOWNLOAD=100000/60 setsid nohup npx next start -p 3917 > qa/artifacts/pay5-server-3917.log 2>&1 &
  APP_URL=http://localhost:3918 setsid nohup npx next start -p 3918 > qa/artifacts/pay5-server-3918.log 2>&1 &
  sleep 6;;
 stop) for p in 3917 3918; do pid=$(ss -ltnp "sport = :$p" | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2); [ -n "$pid" ] && kill "$pid"; done;; # only our own ports
esac
# extra: 3921 = long first delay (threshold 3, base 30 s, cap 60) for deterministic [#13] studies; 3922 = same code but lowest limits for admin login IP default
