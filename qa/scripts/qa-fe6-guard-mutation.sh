#!/usr/bin/env bash
# Mutation test of tests/copy-guard.test.ts: copy the sources to a scratch dir (app code in the worktree is NOT touched),
# inject one promise at a time and record whether the guard fails (CAUGHT) or still passes (BYPASS).
# usage: WT=/workspace/qa-fe6 bash qa-fe6-guard-mutation.sh
WT=${WT:?}; S=$(mktemp -d /tmp/mut.XXXX); cd $WT
mkdir -p $S && cp -r tests components lib src public vitest.config.mts tsconfig.json package.json next.config.ts $S/ 2>/dev/null; ln -s $WT/node_modules $S/node_modules
cd $S
run() { npx vitest run tests/copy-guard.test.ts >/tmp/mut.out 2>&1 && echo PASS || echo FAIL; }
base=$(run); echo "baseline (unmodified copy): guard $base"
mut() { # label file sed-expression
  local lab=$1 f=$2; shift 2; cp "$f" /tmp/mut.bak; if [ ! -f "$f" ]; then echo "SKIP  $lab (no $f)"; return; fi
  sed -i "$@" "$f"; if cmp -s "$f" /tmp/mut.bak; then echo "SKIP  $lab (sed no-op)"; cp /tmp/mut.bak "$f"; return; fi
  r=$(run); cp /tmp/mut.bak "$f"; if [ "$r" = FAIL ]; then echo "CAUGHT  $lab"; else echo "BYPASS  $lab"; fi; }
mut "M1 re-introduce the ORIGINAL AuthShell line ('Instant delivery… delivered automatically') — the line also contains DownloadIcon" components/auth/AuthShell.tsx 's/title: "One link, anywhere", body: "[^"]*"/title: "Instant delivery", body: "Share one link anywhere. Files are delivered automatically."/'
mut "M2 re-introduce 'Instant download' in TrustPoints (same line as DownloadIcon)" components/buyer/TrustPoints.tsx 's/title: "Access after payment", body: "[^"]*"/title: "Instant download", body: "Files unlock the moment you’ve paid."/'
mut "M3 BuyerTrust 'Instant download' on the DownloadIcon line" components/landing/BuyerTrust.tsx 's/title: "Access after payment", body: "[^"]*"/title: "Instant download", body: "Your files are ready the moment your payment goes through."/'
mut "M4 Hero: 'and download instantly'" components/landing/Hero.tsx 's/access to the files is shared once payment is confirmed\./and download instantly./'
mut "M5 Hero: 'We will email you a confirmation with your files' (no forbidden word)" components/landing/Hero.tsx 's/access to the files is shared once payment is confirmed\./we email you the files straight to your inbox./'
mut "M6 Hero: 'Your photos arrive in your inbox seconds after you pay' (synonyms)" components/landing/Hero.tsx 's/access to the files is shared once payment is confirmed\./your photos arrive in your inbox seconds after you pay./'
mut "M7 Hero: split word 'In'+'stant' via string concat" components/landing/Hero.tsx 's/access to the files is shared once payment is confirmed\./and get them {"In" + "stantly"}./'
mut "M8 Hero: HTML entity 'Downl&#111;ad now'" components/landing/Hero.tsx 's/access to the files is shared once payment is confirmed\./and Downl\&#111;ad now./'
mut "M9 layout.tsx site meta description: 'download instantly'" src/app/layout.tsx 's/access to the files is shared once payment is confirmed\./download instantly./'
mut "M10 Faq 'We send a receipt' (Delivery-options allowlist regex only matches the same line)" components/landing/Faq.tsx 's/Delivery options are coming soon\./Delivery options are coming soon. We email a receipt./'
mut "M11 Faq: receipt promise on a line WITHOUT the allowlisted phrase" components/landing/Faq.tsx 's/No sign-up or password\./We email you a receipt./;s/with no sign-up or password\./with a receipt by email./'
mut "M12 DownloadPanel (fully exempt file) gains 'Instant download'" components/buyer/DownloadPanel.tsx 's/> Download</> Instant download</'
mut "M13 Dashboard overview (src/app/dashboard/page.tsx allowlist: 'Becomes available right away')—add buyer promise on another line" src/app/dashboard/page.tsx 's/Takes about a minute/Buyers download instantly/'
mut "M14 hosted page copy lib/purchase-copy.ts 'delivered immediately' (has separate test)" lib/purchase-copy.ts 's/Because this is a digital product,/Because this is a digital product delivered immediately,/'
mut "M15 hosted page copy lib/purchase-copy.ts 'You will get a receipt by email.' appended" lib/purchase-copy.ts 's/once completed\./once completed. A receipt will be emailed to you./'
for f in src/server/services/password-reset.ts; do mut "M16 e-mail template (password-reset.ts, src/server not scanned): add receipt promise" $f 's/We received a request to reset your Unveil password\./Here is your receipt and download link./'; done
grep -n "reset your Unveil password" src/server -r | head -2 | cut -c1-160
mut "M17 site-wide error string in src/app/api (skipped by design)" src/app/api/checkout/route.ts 's/Provide exactly one of dropId or linkId/Your receipt will be emailed/'
mut "M18 public/manifest-like text via next.config.ts (not scanned)" next.config.ts 's/const nextConfig/\/\/ x\nconst nextConfig/'
echo "scratch: $S"; rm -rf $S
