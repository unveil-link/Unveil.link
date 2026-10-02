#!/usr/bin/env bash
# probes for the cases Frontend lists as still blocked. usage: BASE=http://localhost:4331 SEEDJSON=... bash qa/scripts/qa-fe6-blocked.sh
B=${BASE:?}; E=$(jq -r .maya.email ${SEEDJSON:?}); J=$(mktemp)
curl -s -c $J -o /dev/null -H content-type:application/json -H "origin: $B" -d "{\"email\":\"$E\",\"password\":\"Sunrise-Harbor-4821\"}" $B/api/auth/login
D=$(jq -r .maya.dropIds.spring $SEEDJSON)
for p in /dashboard/transactions /dashboard/sales /dashboard/payouts /dashboard/settings /dashboard/profile /settings /profile /status /api/status /api/transactions /api/payouts /api/auth/me /api/orders /receipt; do printf "GET %-24s %s\n" $p $(curl -s -b $J -o /dev/null -w "%{http_code}" $B$p); done
for m in PATCH PUT; do printf "%s /api/auth/me %s\n" $m $(curl -s -b $J -X $m -o /dev/null -w "%{http_code}" -H content-type:application/json -H "origin: $B" -d '{"displayName":"x"}' $B/api/auth/me); done
for m in PATCH PUT DELETE; do printf "%s /api/drops/<id> %s\n" $m $(curl -s -b $J -X $m -o /dev/null -w "%{http_code}" -H content-type:application/json -H "origin: $B" -d '{"title":"x"}' $B/api/drops/$D); done
echo "seller payout request endpoints:"; for p in /api/payouts /api/payouts/request /api/seller/payouts; do printf "POST %-22s %s\n" $p $(curl -s -b $J -X POST -o /dev/null -w "%{http_code}" -H content-type:application/json -H "origin: $B" -d '{"amountCents":2500}' $B$p); done
curl -s -b $J $B/api/earnings | jq -c '.recent | length, (.[0]|keys)' 
curl -s $B/dashboard -o /dev/null -w "dashboard anon %{http_code}\n"
