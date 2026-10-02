#!/usr/bin/env bash
# Evidence for seller-side claims on the landing page (SellerCta / FAQ): video upload, payout request path, hold timing.
# usage: BASE=http://localhost:4501 SEEDJSON=seed.json DB=postgres://... bash qa-fe7-sellerclaims.sh
B=${BASE:?}; S=${SEEDJSON:?}; E=$(jq -r .maya.email $S); D=$(jq -r .maya.dropIds.draft $S); J=$(mktemp)
curl -s -c $J -o /dev/null -H content-type:application/json -H "origin: $B" -H "x-forwarded-for: 10.77.7.7" -d "{\"email\":\"$E\",\"password\":\"Sunrise-Harbor-4821\"}" $B/api/auth/login
echo "## 1. 'sell photos and videos' (meta description, Hero, FAQ) vs upload of a real-looking MP4 (ftyp box)"
printf '\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom\x00\x00\x00\x08free' > /tmp/t.mp4
curl -s -b $J -o /tmp/r.json -w "POST /api/drops/<draft>/files (video/mp4): HTTP %{http_code}\n" -H "origin: $B" -F "file=@/tmp/t.mp4;type=video/mp4" $B/api/drops/$D/files; cat /tmp/r.json; echo
echo "## 2. payout request path for a seller ('Payouts straight to your bank', 'Ready for a payout')"
for p in /api/payouts /api/payouts/request /api/earnings/payout /dashboard/payouts; do printf "%-26s GET %s  POST %s\n" $p $(curl -s -b $J -o /dev/null -w "%{http_code}" $B$p) $(curl -s -b $J -o /dev/null -w "%{http_code}" -X POST -H "origin: $B" -H content-type:application/json -d '{}' $B$p); done
echo "## 3. what /api/earnings says about payouts"; curl -s -b $J $B/api/earnings | jq -c '{payoutEligible, minPayoutCents, holdDays, balance, lifetime:{paidOutCents:.lifetime.paidOutCents, requestedPayoutCents:.lifetime.requestedPayoutCents}}'
rm -f $J /tmp/t.mp4 /tmp/r.json
