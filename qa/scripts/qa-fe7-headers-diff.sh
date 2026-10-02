#!/usr/bin/env bash
# compare response headers (minus volatile ones) of main (A) vs polish-1 (B) on many routes. usage: A=http://localhost:4411 B=http://localhost:4401 SA=seedm.json SB=seed.json bash qa-fe7-headers-diff.sh
A=${A:?}; B=${B:?}; PW=Sunrise-Harbor-4821; OUT=${OUT:-/dev/stdout}
ck() { local base=$1 seedf=$2; local e=$(jq -r .maya.email $seedf); curl -s -c /tmp/ck.$$ -o /dev/null -H content-type:application/json -H "origin: $base" -d "{\"email\":\"$e\",\"password\":\"$PW\"}" $base/api/auth/login; echo /tmp/ck.$$; }
CA=$(ck $A $SA); cp $CA /tmp/ckA.$$; CB=$(ck $B $SB); cp $CB /tmp/ckB.$$
norm() { tr -d '\r' | grep -v -i -E '^(date|etag|content-length|x-nextjs-(cache|prerender|stale-time)|set-cookie|keep-alive|connection|x-powered-by|last-modified|vary)|^$' | tr 'A-Z' 'a-z' | sort; }
mc=$(jq -r .maya.dropIds.spring $SA); mb=$(jq -r .maya.dropIds.spring $SB); la=$(jq -r .maya.links.spring $SA); lb=$(jq -r .maya.links.spring $SB)
chunk_a=$(curl -s $A/login | grep -o '/_next/static/[^"]*\.js' | head -1); chunk_b=$(curl -s $B/login | grep -o '/_next/static/[^"]*\.js' | head -1)
n=0; diffs=0
t() { # label method pathA pathB cookieflag
  local lab=$1 m=$2 pa=$3 pb=$4 auth=$5; local ca="" cb=""; [ "$auth" = 1 ] && ca="-b /tmp/ckA.$$" && cb="-b /tmp/ckB.$$"
  local ha=$(curl -s -o /dev/null -D - -X $m $ca -H "origin: $A" -H content-type:application/json -d '{}' "$A$pa" | norm | grep -v '^http' ); local hb=$(curl -s -o /dev/null -D - -X $m $cb -H "origin: $B" -H content-type:application/json -d '{}' "$B$pb" | norm | grep -v '^http')
  local sa=$(curl -s -o /dev/null -w '%{http_code}' -X $m $ca -H "origin: $A" -H content-type:application/json -d '{}' "$A$pa"); local sb=$(curl -s -o /dev/null -w '%{http_code}' -X $m $cb -H "origin: $B" -H content-type:application/json -d '{}' "$B$pb")
  n=$((n+1)); if [ "$ha" == "$hb" ] && [ "$sa" == "$sb" ]; then echo "SAME  $m $lab ($sa)"; else diffs=$((diffs+1)); echo "DIFF  $m $lab main=$sa polish=$sb"; diff <(echo "$ha") <(echo "$hb") | grep '^[<>]' | sed 's/^</   main:   /; s/^>/   polish: /'; fi; }
for p in / /login /signup /forgot-password /reset-password /terms /privacy /dmca /contact /nope /icons/icon-512.png /manifest.webmanifest /robots.txt /favicon.ico /design /admin; do t "$p" GET $p $p 0; done
t "/u/<link>" GET /u/$la /u/$lb 0; t "/u/unknown" GET /u/zzzzzzzzzzzz /u/zzzzzzzzzzzz 0; t "/pay/mock/x" GET /pay/mock/x /pay/mock/x 0
t "chunk" GET $chunk_a $chunk_b 0
for p in /dashboard /dashboard/drops /dashboard/new; do t "$p (auth)" GET $p $p 1; done; t "/dashboard/drops/<id> (auth)" GET /dashboard/drops/$mc /dashboard/drops/$mb 1
t "/api/earnings (auth, 200)" GET /api/earnings /api/earnings 1; t "/api/earnings (anon, 401)" GET /api/earnings /api/earnings 0; t "/api/earnings POST (auth)" POST /api/earnings /api/earnings 1
for p in /api/auth/me /api/drops /api/settings /api/checkout/status /api/admin/me /api/dev/payments/pay /api/internal/cron/payments-janitor; do t "$p (auth)" GET $p $p 1; done
t "/api/public/drops/<link>" GET /api/public/drops/$la /api/public/drops/$lb 0
t "/api/checkout (POST)" POST /api/checkout /api/checkout 0; t "/api/webhooks/mock (POST unsigned)" POST /api/webhooks/mock /api/webhooks/mock 0; t "/api/auth/login (POST)" POST /api/auth/login /api/auth/login 0
t "/api/earnings/ (308)" GET /api/earnings/ /api/earnings/ 1; t "/api/earningsx" GET /api/earningsx /api/earningsx 1; t "/api/earnings/x" GET /api/earnings/x /api/earnings/x 1
echo "routes compared: $n, differing: $diffs"; rm -f /tmp/ck*.$$
