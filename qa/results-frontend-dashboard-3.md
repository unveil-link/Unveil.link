# Unveil QA results — `frontend/dashboard` (PR #1) rebased on main, run 3 (combined re-test, "FE3")

- **Date:** 2026-10-01, ≈21:46–22:20 ET (restart from scratch after an interrupted first attempt; checkpoint 1 = `fe17902` (FE-07..11 verification), this file = final).
- **Branch / SHA tested:** `origin/frontend/dashboard` @ **`e4b5722306f4af37384ed82a2fb905b7dd4245cf`** on top of `origin/main` @ **`10c4e65e53c5a5578c482ceb301affd83e996520`**. QA base: `origin/qa/test-plan` was `ef09c99` at start (rebased on it; no force push).
- **Env:** Node 20.19.2, PostgreSQL 17.11, headless Google Chrome 154 (playwright-core, `--no-sandbox`). Clean detached worktree `/workspace/qa-fe3` (removed afterwards), throwaway DBs `unveil_qa_fe3` and `unveil_e2e_qafe3` (dropped), fresh secrets, `MOCK_PAYMENTS_ENABLED=1` + `PAYMENT_WEBHOOK_SECRET` in `.env` per `docs/frontend-dashboard-notes.md`. Production builds (`NEXT_DIST_DIR=.next-qa`) on :4331 (limits off, mock on), :4332 (limits off, `MOCK_PAYMENTS_ENABLED=0`), :4333 (default limits, mock on); e2e on :4330. All stopped afterwards. No other worker's ports/DBs/worktrees touched.
- **Rules followed:** no app source modified (a production build only appends `.next-qa/*` entries to `tsconfig.json` in the throw-away worktree — not committed); nothing pushed to `main`, lane branches or `frontend/dashboard`; only `qa/test-plan`, fetched+rebased, no force. No messages sent to anyone.

## Verdict
**FE-07..FE-11 are all FIXED and verified** in the combined state. **0 FAIL in 106 plan rows, 0 regressions.** The money-file diff vs main is **empty** (only a 2-line `X-Robots-Tag` rule in `next.config.ts`). Buy flow through the mock processor works end-to-end up to webhook-driven payment success and ledger credit; **receipt / unlock / download do not exist yet (FE-14, known blocker)**. 4 new findings, none blocking: **FE-14 (Medium, integration gap)**, **FE-12, FE-13, FE-15 (Low)**. M5-16 stays **BLOCKED-ON-LEGAL**.

| Item | Verdict | One-line evidence |
|---|---|---|
| **FE-07** dashboard numbers = `getEarningsSummary` | **FIXED ✔** | Maya & Ned & Sam & Jo: UI == `GET /api/earnings` == raw-ledger recompute (85 checks ×2 seeds, 0 FAIL) |
| **FE-08** negative balance | **FIXED ✔** | Ned: red "Balance owed −$46.80" card + "You owe $46.80" alert; net $0.00; netting by later sales works (caveats FE-12/FE-13) |
| **FE-09** X-Robots-Tag on legal pages | **FIXED ✔** | `noindex, nofollow` header + meta on `/terms /privacy /dmca /contact` (also with query string) |
| **FE-10** legal links | **FIXED ✔** | all 4 links on landing, login, signup, forgot, reset, buyer page, unavailable page, dashboard shell (overview/drops/new/detail, clickable at 390 px) |
| **FE-11** upload 429 message | **FIXED ✔** | human durations on new-drop banner and file-upload path ("59 minutes", "1 hour 12 minutes", "24 hours") |
| BuyPanel / mock buy flow | **OK ✔** (receipt/unlock → FE-14) | 67+18+6+16+4 checks, 0 FAIL |
| og/twitter + hostile titles | **OK ✔** | neutral generic tags, all hostile strings escaped, nothing executes |
| Seed (`seed-demo.ts`) | **OK ✔** | needs `PAYMENT_WEBHOOK_SECRET` + `MOCK_PAYMENTS_ENABLED=1`; fails with a clear 503 message when mock disabled |
| Money/pricing/ledger/payout diff vs main | **none ✔** | `fe3-money-diff-stat.txt`, `fe3-diff-dirs.txt` |

## Counts (106 plan rows)
| Milestone | PASS | PARTIAL | FAIL | BLOCKED | NOT RUN | Total |
|---|---|---|---|---|---|---|
| M1 | 10 | 0 | 0 | 4 | 0 | 14 |
| M2 | 13 | 0 | 0 | 6 | 0 | 19 |
| M3 | 11 | 1 | 0 | 7 | 1 | 20 |
| M4 | 4 | 0 | 0 | 14 | 0 | 18 |
| M5 | 3 | 0 | 0 | 17 | 0 | 20 |
| M6 | 2 | 0 | 0 | 6 | 2 | 10 |
| S2 | 3 | 0 | 0 | 2 | 0 | 5 |
| **Total** | **46** | **1** | **0** | **56** (incl. M5-16 BLOCKED-ON-LEGAL) | **3** | **106** |

Round-2 baseline (f3d9eb1): 31 PASS / 0 FAIL / 73 BLOCKED (incl. M5-16) / 2 NOT RUN. Now: **46 PASS / 1 PARTIAL / 0 FAIL / 56 BLOCKED (incl. M5-16 BLOCKED-ON-LEGAL) / 3 NOT RUN.**

### Cases whose rating changed vs round 2
- **Newly PASS (re-checked live here):** M2-03, M3-01, M3-03, M3-05, M3-06, M3-07, M3-09, M3-10, M3-11, M3-15, M3-16, M4-14, M5-07, M5-08, S2-03, S2-04.
- **BLOCKED → PARTIAL:** M3-02 (checkout up to the mock hosted page and webhook success; no unlock/receipt, no real provider).
- **M3-18** stays PASS; **M4-09** stays PASS, now ledger-based (FE-07/08).
- **NOT RUN:** M3-12 (Payments' R5 PASS, not re-run here), M6-01 (OWASP review), M6-03 (load test).
- Rows marked "Carried over from round 2" were not re-run: the branch has no backend change (empty money-file diff).

## Suite results on `frontend/dashboard` @ e4b5722
| Check | Result |
|---|---|
| `npm ci` / `npm run migrate` | OK / 001–012 applied |
| `npx tsc --noEmit` | clean (`fe3-typecheck.log`) |
| `npm run lint` | app **clean** (`eslint . --ignore-pattern "qa/**"` rc 0). Plain `npm run lint` shows 1 error + 14 warnings **only** because the repo eslint also lints these QA scripts when they sit under `qa/` in the repo tree (`fe3-lint.log`) — INFO |
| `npm run build` | OK (`fe3-build.log`) |
| `npm test` | **239/239** (`fe3-npm-test.log`) |
| `npm run e2e` | **83/83 on both runs** (`fe3-e2e-run1.log`, `fe3-e2e-run2.log`); `proof/db.txt` saved as `fe3-e2e-proof-db-run{1,2}.txt` and reverted |
| Money-file diff vs main | **none** — see below |

### Diff `origin/main..frontend/dashboard`
Only `next.config.ts` (+2 lines: X-Robots-Tag rule for `/:page(terms|privacy|dmca|contact)`) is outside components/lib/pages/tests/docs. **0 files** under `src/server`, `src/app/api`, `db/`, `package.json`, `package-lock.json`. `scripts/seed-demo.ts` +155 lines (seed only); `lib/earnings.ts` is display mapping only (no money arithmetic of its own). Also `.env.example` (ENABLE_DESIGN_PAGE note). Details: `fe3-money-diff-stat.txt`, `fe3-diff-dirs.txt`.

## Per-fix evidence

### FE-07 — dashboard numbers vs `GET /api/earnings` vs ledger — FIXED
`qa-fe3-earnings.mjs` (seed 1 and a second fresh seed: `fe3-earnings.log`, `fe3-earnings-seed2.log`, 85 OK each).
- **Maya:** 33 sales, gross **$467.00**, platform fee **$42.40**, processing **$50.88**, refunded **$35.00** (full $25 + partial $10), charged back **$8.00 + $5.00 chargeback fee**, net **$325.72**. Available **$87.64**, Pending **$28.08**, In payout **$60.00**, Paid out **$150.00** (sum = net). Reconciliation line sums to the cent and names the chargeback fee. UI == API == independent raw-ledger SQL recompute.
- **Sam / Jo:** zeros. **Isolation:** anonymous `/api/earnings` 401, anonymous `/dashboard` 307 → `/login`, `sellerId` query/header ignored.
- Payout lifecycle through the service (`fe3-payout-ui.log`): requested → approved → paid and failed (funds return) all reflected; request < $25 → `below_minimum_payout`.
- **Hold boundaries** (`fe3-boundary.log`): `available_at` +1 h / +1 s → pending; −1 s / −1 µs → available; live flip at ≈3.3 s for a +3 s entry; entries are stamped with the hold at sale time; hold 0 → available immediately; hold 1 → "1 day" grammar; a refund inside the hold reduces pending, not available. (Technique: append-only trigger `ledger_entries_no_update` disabled/re-enabled around time-shift UPDATEs in the throwaway DB only; verified re-enabled.)
- Per-drop numbers: see **FE-15**.

### FE-08 — negative balance — FIXED
Ned: red **"Balance owed −$46.80"** card + **"You owe $46.80"** alert, net $0.00, Paid out $46.80. `qa-fe3-ned-netting.*` (`fe3-ned-netting.log`): a new sale inside the hold leaves the debt visible with +$46.80 pending; with hold 0 the next sale nets it to $0 and both card and alert disappear. A $5 chargeback fee inside the hold gives "Balance owed −$5.00" while $15.60 is pending (`fe3-cbhold*.log`, `fe3-dashboard-cb-in-hold.png`) → copy issue **FE-12**; alert semantics **FE-13**.

### FE-09 — X-Robots-Tag — FIXED
`noindex, nofollow` header **and** meta on `/terms /privacy /dmca /contact`, also with query strings. `/terms/` → 308 (no header), `/TERMS` and `/terms/x` → 404. `/u/*` keeps noindex; `/sitemap.xml` 404 (`fe3-fixes.log`).

### FE-10 — legal links — FIXED
Terms/Privacy/DMCA/Contact present on landing, login, signup, forgot, reset, buyer page, unavailable page, draft link, dashboard overview/drops/new/detail; visible and clickable at 390 px; all four targets 200; still "Coming soon" with no legal claims; `/2257` 404 (M5-16 stays BLOCKED-ON-LEGAL).

### FE-11 — upload 429 message — FIXED
New-drop banner and file-upload path: Retry-After 59 → "59 seconds", 3500 → "59 minutes" (rounds up, consistent with FE-05), 4320 → "1 hour 12 minutes", 86400 → "24 hours"; 60 stays "60 seconds" as before (`fe3-fixes.log`, `fe3-reg-duration.log` 93 OK).

### og/twitter and hostile titles
`/u/<id>`: title "<drop title> · Unveil"; description "A payment link by <seller> on Unveil."; image generic `https://unveil.link/icons/icon-512.png` (200 image/png); canonical + og:url set. Draft/unpublished/unknown → generic site tags, no leak. Hostile titles and seller names (`<script>`, `</title>` injection, svg onload, RTL + zero-width chars, template strings, newlines, 120-char titles) are escaped in HTML/meta; in a real browser nothing executes on buyer page, dashboard greeting, drops list, drop detail, unpublish modal (`fe3-fixes.log`, `fe3-reg-meta.log`).

### Buy flow (mock payments)
`fe3-buy.log` (67), `fe3-buyerr.log` (18), `fe3-back.log`, `fe3-webhook.log` (6), `fe3-fees.log` (16), `fe3-journey.log`, `fe3-idem-409.log`, `fe3-leak-scan.log`.
- **Server-side validation:** email invalid / NUL / array / object / number / 255 chars → 400. `confirmOver18` missing / false / "true" / 1 / null → 400 (enforced server-side, not just UI). `dropId`+`linkId` together → 400; unknown link → 404; draft / unpublished / pending-seller drop → 404; client-sent `amountCents` ignored (price from DB). Bad JSON → 400; foreign Origin → 403. `text/plain` body accepted → 201 (INFO).
- **Idempotency:** same key replay → 201 then 200 `reused:true`, same transaction; 10 parallel requests → 1 transaction; replay after payment returns the succeeded transaction; same key with a different drop → 409 `idempotency_key_reused`; 300-char key / key with spaces → 400.
- **UI:** empty submit, bad email, unchecked 18+ send no request; double-click → 1 POST with one UUID `Idempotency-Key`, no price in body; redirect to hosted `/pay/mock/<session>` showing title, $25.00 and final-sale text. Browser Back from the hosted page leaves a usable button; a second Buy gets a new key + new session.
- **Cards:** declined → friendly message only; 4242 → webhook-driven success, exact split, 3 pending ledger lines, status endpoint `succeeded`. Decline / insufficient-funds / expired / bad-CVC / garbage cards leave 0 ledger lines and are retryable.
- **Webhook:** unsigned, bad signature, tampered body → 401 with the transaction still pending. Signed `sale.succeeded` ×3 → exactly one credit; a second event id for the same sale → still one credit. `webhook_events` trace `sale_succeeded` / `processed`.
- **Fees:** $20 → $2.00 platform / $2.40 processing / $15.60 net. $1.00, $1.01, $9.99, $49.99, $123.45, $500.00 all sum exactly. Changing `fee_percent` to 15 applies to new sales only.
- **No PAN/secret leakage:** zero PAN/CVC/secret hits in `pg_dump`, server logs, client bundle and HTML; no card-like columns.
- **`MOCK_PAYMENTS_ENABLED` off/unset:** API 503 `payments_unavailable`; UI "Couldn't start checkout — Payments are not available"; `/pay/mock`, `/api/dev/payments/*` 404; webhook 503; buyer page and dashboard still render; `seed-demo` fails with a clear 503 message.
- **Rate limit (default limits):** 10 × 201 then 429 `Retry-After: 60`; UI shows disabled button + countdown "Try again in 59s" + plain-words notice, re-enables afterwards.
- **Seller state changes after page load:** seller → `manual_review` gives a 409 friendly notice; drop unpublished gives a "Drop not found" friendly notice.
- **Journey:** seller signup → live link 1.3 s; buyer open → paid ≈0.4 s.
- **Receipt / unlock / download:** none exist → **FE-14**.

## Regression (`fe3-regress.log` 55 OK, `fe3-boundary.log` 20, `fe3-misc.log` 9, `fe3-reg-modal.log` 52, `fe3-reg-duration.log` 93, `fe3-reg-meta.log` 17)
Mobile 390/360 no overflow and Buy button ≥44 px; no originals leak (anonymous `/original` 403); 6 security headers, CSP without unsafe-eval; manifest + icons OK; ownership/IDOR on drops OK; modal focus return (FE-02) still OK; fuzzing gives no 5xx except the known framework `%zz` 500 (NEW-6); 80-request download flood → 403×60 then 429×20, second IP unaffected; throttled-4G Buy button visible ≈0.3 s, FCP ≈0.7 s; no secrets in client bundle/HTML; no adult-market wording.

## New bugs / findings
| ID | Sev | Finding | Exact repro |
|---|---|---|---|
| **FE-12** | Low (copy) | "Balance owed" card hint says "A refund, chargeback or fee came in after a payout." and the alert says "…after earlier sales had already been paid out." Both are wrong when the seller never had a payout (chargeback fee is immediately available while reversal lines inherit the sale hold, so a negative available balance appears while money is still pending). | `BASE_URL=http://localhost:<port> npx tsx qa/scripts/qa-fe3-cbhold.ts` → creates verified seller `qa-cb-*@example.com` with two $20 sales and a chargeback on the first (`chargeback_fee_cents=500`); dashboard shows "Balance owed −$5.00" with that wording while Pending $15.60 and Paid out $0. Evidence `fe3-cbhold-ui.log`, `fe3-dashboard-cb-in-hold.png`. Behaviour originates in Payments (ledger), copy is Frontend. |
| **FE-13** | Low (a11y/UX) | The negative-balance alert is `tone=warning` (orange) with `role="status"` (polite); the card is red but the alert is neither danger-toned nor `role="alert"`. | Log in as Ned, inspect `[data-testid=negative-balance]`. |
| **FE-14** | Medium (integration gap; known blocker, not a regression) | Buyer copy promises "Email (for your receipt)", "Instant download", "Files unlock the moment you've paid", but after a successful payment no receipt email is sent (0 files in dev mail dir), no unlock/download page exists (`/receipt /orders /download /api/receipts|orders|downloads` → 404) and the hosted page only offers "Back to the drop". | Buy through the UI at `/u/<id>`, pay with 4242, observe; `qa-fe3-buy.mjs` §4 shows the 404s. Owner: Backend/Payments (orders, receipts, signed URLs), then Frontend wires `DownloadPanel`. |
| **FE-15** | Low (M4-10 numbers) | Per-drop Sold/Revenue counts only `status='succeeded'` rows at full gross, so a partial refund is not deducted; three different "revenue" numbers on one account. | Maya `/dashboard/drops` vs `/dashboard`: per-drop revenues sum to $434.00 (Spring 21/$252.00, Studio 6/$150.00 incl. the $25 sale partly refunded by $10, Travel 4/$32.00); Gross card $467.00; ledger gross kept after $35 refunds + $8 chargeback = $424.00. |

### INFO
- `GET /api/earnings` sends no `Cache-Control` (main/Payments, not the branch).
- `POST /api/checkout` accepts a `text/plain` body (Origin check still blocks cross-site).
- Known framework `%zz` path 500 (NEW-6) still on `/u`, `/pay/mock`, `/dashboard/drops`.
- A pending ledger entry stays pending after the hold setting changes to 0 (stamped at sale time), so the "right away" hint can sit beside a non-zero Pending — consistent with ledger stamping.
- `backup/fe-pre-rebase-f3d9eb1` is **not on origin** (`git ls-remote` empty); the old commit f3d9eb1 is still resolvable only where it was fetched earlier.
- QA scripts fail the repo's eslint if placed inside the repo tree (they live under `qa/scripts`).
- `/api/earnings.recent` returns 20 rows but the UI does not render them.
- Only the mock processor exists; no CCBill/Segpay integration. MP4 upload probe → 415 `invalid_image` (not saved to a log file).
- A production build edits `tsconfig.json` (adds `.next-qa/*` includes) because `NEXT_DIST_DIR` is non-default — local only, not committed.

## Still open from earlier rounds
Nothing from FE-01..FE-11 remains open. FE-12..FE-15 above are new.

## Remaining BLOCKED — on whom
- **Receipt, unlock, download, signed URLs** (M2-12, M2-14..16, M3-13, M3-14, M3-20, S2-02): nothing delivered after payment (FE-14). Backend/Payments first, then Frontend wires `DownloadPanel`.
- **Real processor / sandbox** (M3-04 3DS, M3-08 live $1 charge, M3-17 Stripe/PayPal absent, M3-19 hosted fields; S2-05 trace beyond the ledger): Payments + Juice (provider account). The "no PAN/CVC stored or logged" half of M3-19 passes.
- **KYC / payout provider and payout routes/UI** (M4-01..05, M4-07, M4-08, M4-12, M4-13, M4-15, M4-16): no provider integration; no `/api/payouts*` or seller payout UI (service-level lifecycle verified OK). Payments/Backend.
- **Frontend-listed:** M4-10 (views/conversion, FE-15), M4-11 (no transaction-history page), M4-17 (no profile/settings; `PATCH|PUT /api/auth/me` 405), M6-06 (no status page).
- **Backend:** M2-10, M2-13 (drop PATCH/DELETE), M1-06 (mp4), M1-09 (resumable upload), M1-11 (video previews), M1-14.
- **Admin / moderation / compliance** (M5-01..06, M5-09..15, M5-17..19, M6-04, M6-05, M6-08..10): not implemented on this branch (Admin/Moderation lanes).
- **M5-16** (legal copy): **BLOCKED-ON-LEGAL** — unchanged; placeholders are not legal copy. Nobody was messaged.
- **Google OAuth (M1-02):** presence only; needs real credentials (Juice).

## Case-by-case results
| Case | Result | Evidence / notes |
|---|---|---|
| M4-09 | **PASS** | **Round 3 (e4b5722):** **FE-07/FE-08 FIXED & cross-checked in the combined state.** Maya: 33 sales, gross $467.00, platform $42.40, processing $50.88, refunded $35.00 (full $25 + partial $10), charged back $8.00 + $5.00 chargeback fee, net $325.72; Available $87.64, Pending $28.08, In payout $60.00, Paid out $150.00 — UI == `GET /api/earnings` == raw-ledger recompute; available+pending+in payout+paid out = net; reconciliation line sums to the cent and names the fee. Ned: Balance owed −$46.80 (red card + 'You owe $46.80' alert), Paid out $46.80, net $0.00. 85 checks ×2 seeds (`fe3-earnings.log`, `fe3-earnings-seed2.log`). Caveats FE-12/FE-13/FE-15. |
| M1-01 | **PASS** | Carried over from round 2 (f3d9eb1), not re-run (no backend change in the branch; see money-file diff). signup 201 `verification_status:pending`, cookie `HttpOnly; Secure; SameSite=lax; Max-Age=604800`, `/api/auth/me` 200, email lower-cased, bcrypt hash. Headless Chrome: /signup → `/dashboard`, badge “Pending”. |
| M1-02 | **PASS** | Carried over from round 2 (f3d9eb1), not re-run (no backend change in the branch; see money-file diff). **Presence-only (no creds, OAuth round-trip NOT tested).** Google not configured → `/login` and `/signup` render **no** Google control (0 matches) and `GET /api/auth/google` → 501 JSON. With a *fake* `GOOGLE_CLIENT_ID/SECRET` env on a second instance (:3207) the button appears on both pages as a link to `/api/auth/google`, which 307s to `accounts.google.com/o/oauth2/v2/auth?client_id=…&redirect_uri=…/api/auth/google/callback`. Real sign-in/sign-up with Google still needs real credentials (owner: Juice/coordinator). Evidence: `qa/evidence-fe1-i.log`, `qa/artifacts/frontend-dashboard/login-google-button-desktop.png`. **Round 2 (f3d9eb1):** re-run with a 2nd instance (:3234, fake `GOOGLE_CLIENT_ID/SECRET`): button present on `/login` + `/signup` as link to `/api/auth/google` → 307 `accounts.google.com`; without creds no control and API 501. Still presence-only. `qa/evidence-fe2-suite/probe-fe1-i.log`. |
| M1-03 | **PASS** | Carried over from round 2 (f3d9eb1), not re-run (no backend change in the branch; see money-file diff). dup email 409 `email_taken` (also upper-case); `short` → 400 `weak_password` (“at least 10 characters”); `password` and `12345678` now 400; `not-an-email`, `a@b`, blank name, bad JSON → 400; 1 row per email. FE regression: UI mirrors the cheap rules inline (see CHK-AUTH). |
| M1-04 | **PASS** | Carried over from round 2 (f3d9eb1), not re-run (no backend change in the branch; see money-file diff). Replay of pre-logout cookie → 401 (and `POST /api/drops` 401); other device stays 200; expired/forged sessions 401; relogin 200. Reset flow: `forgot-password` 200 identical for known/unknown; `reset-password` 200, token reuse 400, pre-reset session → 401, new pw 200. **Login throttle is now the progressive delay (fixes-2) — see ‘Progressive login delay’: PASS on every sub-check.** FE regression: forgot/reset UI flow works end to end and signs out everywhere (CHK-RESET). |
| M1-05 | **PASS** | Carried over from round 2 (f3d9eb1), not re-run (no backend change in the branch; see money-file diff). **BUG-15 CLOSED.** New-drop flow uploaded a JPG, PNG and WebP (+ a 3.7 MB JPG): each file row has a `role=progressbar` with `aria-valuenow` (0→100; intermediate values 3,6,10…97 observed under a 4 Mbit/s upload throttle); all four listed in DB with mime `image/jpeg, image/png, image/webp, image/jpeg`; editor “Add files” shows the same bars (2…31 % sampled). Client-side validation: `.txt`/`.gif` → “Unsupported type. Use JPG, PNG or WebP.”, `.mp4` → “MP4 video uploads are coming soon…”, 19 MB JPG → “Images can be up to 15 MB.”; a text file renamed `.jpg` passes client checks, server 415 → “We couldn’t read this image…” + Retry. Evidence: `qa/evidence-fe1-c.log`, `-h.log`, `-o.log`; `qa/artifacts/frontend-dashboard/newdrop-*.png`. **Round 2 (f3d9eb1):** new-drop flow progress bars (`aria-valuenow` 3…97 under throttle) and editor add-files bars (2…31 %) unchanged; client validation messages unchanged; fake `.jpg` → 415 → “We couldn’t read this image”. `probe-fe1-c/h/o.log`. |
| M1-06 | **BLOCKED** | Carried over from round 2 (f3d9eb1), not re-run (no backend change in the branch; see money-file diff). MP4 not implemented: `.mp4` (valid, ffmpeg-generated) → 415 `invalid_image`. README: video upload not built. |
| M1-07 | **PASS** | Carried over from round 2 (f3d9eb1), not re-run (no backend change in the branch; see money-file diff). Content sniffed with sharp, not MIME/extension: GIF 415 `unsupported_type`; PDF 415; EXE (`MZ…`) 415; EXE renamed .jpg w/ image/jpeg 415; PDF as .jpg 415; SVG-with-script as .jpg 415; TIFF/AVIF 415; empty 400; missing `file` field 400; non-multipart 400. Hostile filename `../../etc/<script>"x.jpg` stored as `.._.._etc_script_x.jpg`. Info: valid JPEG + appended `<?php…` bytes accepted & stored verbatim (only served as attachment+nosniff via signed URL; preview is re-encoded). |
| M1-08 | **PASS** | Carried over from round 2 (f3d9eb1), not re-run (no backend change in the branch; see money-file diff). Limits: `/api/settings` → `maxFilesPerDrop=10`, `maxTotalBytesPerDrop=2147483648`. 12 sequential → `201×10, 400, 400` (`too_many_files`). Race: 30 parallel ×3 runs → each exactly 10×201/20×400, DB rows 10, files on disk 10. Total-size cap (set to 389,404 B): sequential `201,201,201,413,413` (`drop_too_large`); 12 parallel → exactly 3 stored, total ≤ cap. 2 GiB boundary at default tested by seeding `size_bytes` (drop at 2 GiB−1000 B → next upload 413; at 2 GiB−1,000,000 B → 201); a real 2 GB upload was not performed. 16 MiB image → 413 `file_too_large`. (Spec's 500 MB/file applies to video, not implemented.) |
| M1-09 | **BLOCKED** | Carried over from round 2 (f3d9eb1), not re-run (no backend change in the branch; see money-file diff). Resumable/tus-style upload not implemented: `PATCH`/`HEAD` on upload route → 405, `/api/uploads` → 404. README: S3 presigned/streaming uploads not built. |
| M1-10 | **PASS** | Carried over from round 2 (f3d9eb1), not re-run (no backend change in the branch; see money-file diff). Text image (“CONFIDENTIAL / Name: Jane Roe / Card 4111…”) 1200×800 → preview 320×213 JPEG 1418 B (orig 65652 B); visually inspected: text/face unreadable (`qa/artifacts/blur-original.jpg` vs `blur-preview.jpg`); horizontal-gradient energy 3.7% of original; preview contains no original bytes; EXIF/GPS/ICC/XMP stripped (input with Copyright=SECRET-QA → not in preview). Draft preview: anon 404, other seller 404. |
| M1-11 | **BLOCKED** | Carried over from round 2 (f3d9eb1), not re-run (no backend change in the branch; see money-file diff). Video previews not implemented (no video upload). |
| M1-12 | **PASS** | Carried over from round 2 (f3d9eb1), not re-run (no backend change in the branch; see money-file diff). 14 guessed/traversal URLs → 404/403/308, none returned original. Disk mode 600 outside `public/`. Owner-minted signed URL: anon GET 200 byte-identical, `no-store`, attachment, nosniff, TTL 86399 s (24 h). Sig reused on other file → 403; exp extended → 403. |
| M1-13 | **PASS** | Carried over from round 2 (f3d9eb1), not re-run (no backend change in the branch; see money-file diff). Seller B vs seller A's drop/file: GET drop 404, upload 404, publish 404, unpublish 404, mint signed-url 404, draft preview 404; list endpoint doesn't leak; anon → 401. 404 body identical to nonexistent-UUID response (`{"error":"Drop not found"}`) – no enumeration oracle. Non-UUID/SQLi-ish ids → 404. |
| M1-14 | **BLOCKED** | Carried over from round 2 (f3d9eb1), not re-run (no backend change in the branch; see money-file diff). Schema verified after migrations 001–004 on main: sellers, drops, drop_files, transactions, payouts, reports, audit_log, admins, platform_settings (+ sessions, password_reset_tokens, rate_limits, login_throttle) with all spec fields. CI/CD config, hosting and HTTP→HTTPS redirect are not in the repo → cannot verify. |
| M2-01 | **PASS** | Carried over from round 2 (f3d9eb1), not re-run (no backend change in the branch; see money-file diff). POST /api/drops {title:'  Sunset set ', description, priceCents:2000} → 201 status `draft`, title trimmed, link id generated; shows in GET /api/drops. UI: create draft → redirects to /dashboard/drops/:id, shows `$20.00 draft`. Gap: cover image not implemented (`cover_url` always null; `coverUrl` field ignored, no upload endpoint). |
| M2-02 | **PASS** | Carried over from round 2 (f3d9eb1), not re-run (no backend change in the branch; see money-file diff). 99→400 `price_out_of_range`; 100→201; 50000→201; 50001→400; -500→400; 0→400; 1000.5→400; "2000"/null/"abc"/missing→400 `invalid_input`; 1e9 & MAX_SAFE→400. Narrowing `platform_settings` to 500..10000 via SQL took effect on next request without restart (100→400, 20000→400, 500→201). |
| M2-03 | **PASS** | **Round 3 (e4b5722):** Re-run: publish by pending-verification seller (Jo) → 403; checkout on that seller's draft → 404 (`fe3-misc.log`). |
| M2-04 | **PASS** | Carried over from round 2 (f3d9eb1), not re-run (no backend change in the branch; see money-file diff). `POST /publish` → `url:"/u/g-AzRC9RIg7J"` (matches `^/u/[A-Za-z0-9_-]{12}$`); `GET /u/<id>` 200; legacy `/d/<id>` → 308 `/u/<id>`; 40 new links unique/12 chars; 0 files → 400 `no_files`. |
| M2-05 | **PASS** | Carried over from round 2 (f3d9eb1), not re-run (no backend change in the branch; see money-file diff). 2/3, 0/3, missing, string `"true"` → 400, drop stays draft, attestation NULL. All true → `{at, over18, ownsRights, consentOfSubjects}` stored with `published_at`. Re-publish no longer overwrites first attestation (`attested_at` kept, `attestation_history` appended, verified in DB and e2e #10). |
| M2-06 | **PASS** | Carried over from round 2 (f3d9eb1), not re-run (no backend change in the branch; see money-file diff). 120 drops: 120 unique, 12-char base64url, 64/64 alphabet used, χ²=79.4 (df 63, 5% crit ≈82.5 — passes but higher than earlier runs 64.8/73.9; random variation, CSPRNG 72-bit per code), not sorted; 300 random + 4 sequential guesses → 404. |
| M2-07 | **PASS** | **Round 3 (e4b5722):** Buyer page in the combined state (seed Maya): blurred hero/thumbs, title, seller name, price, file summary, Buy panel; legal footer. Screenshots `fe3-buyer-390.png`, `fe3-buy-validation-desktop.png`. |
| M2-08 | **PASS** | **Round 3 (e4b5722):** No storage key / filename / `/original` in page, RSC payload or public API; anonymous `/original` 403 (`fe3-regress.log`). |
| M2-09 | **PASS** | **Round 3 (e4b5722):** `X-Robots-Tag: noindex, nofollow` + `<meta robots noindex, nofollow, nocache>` on `/u/*` (also unknown link); `robots.txt` Disallows /u/ /api/ /dashboard; `/sitemap.xml` 404. |
| M2-10 | **BLOCKED** | Carried over from round 2 (f3d9eb1), not re-run (no backend change in the branch; see money-file diff). Still blocked on **Backend**: `PATCH`/`PUT`/`DELETE /api/drops/:id` → 405 (re-probed from a logged-in browser session). The new drop editor has **no** edit fields (0 inputs/textarea besides the file picker) – Frontend correctly did not fake it. Needs `PATCH /api/drops/:id` then a Frontend edit form. |
| M2-11 | **PASS** | Carried over from round 2 (f3d9eb1), not re-run (no backend change in the branch; see money-file diff). Dashboard UI: Unpublish (confirm modal) → DB `unpublished`, `/u/<id>` 404 **with the new branded “This link isn’t available” page** (no Buy button; same page for draft / flagged / unpublished / bogus ids, all with `X-Robots-Tag: noindex`), republish through the attestation dialog → `/u/<id>` 200 again. Improvement over main (generic Next 404). Open BUG-11b unchanged at API level (the UI only offers Unpublish on published drops). `POST /api/checkout` for an unpublished link still answers 501 (stub), not 404 – re-check when checkout is real. Evidence: `qa/evidence-fe1-g.log`, `qa/artifacts/frontend-dashboard/buyer-unavailable-desktop.png`, `editor-unpublished-desktop.png`. **Round 2 (f3d9eb1):** UI unpublish → 404 branded page (same for draft/unpublished/bogus; `<title>` now “Link unavailable · Unveil”, `X-Robots-Tag: noindex`), republish → 200; modal focus returns to the trigger (FE-02). `probe-fe1-a.log`, `-g.log`. |
| M2-12 | **BLOCKED** | **Round 3 (e4b5722):** No buyer download flow exists to test (the sale succeeds, nothing is delivered). Unchanged: Payments/Backend. |
| M2-13 | **BLOCKED** | Carried over from round 2 (f3d9eb1), not re-run (no backend change in the branch; see money-file diff). Still blocked on **Backend**: `DELETE /api/drops/:id` → 405, no file-delete endpoint. No delete control exists in the UI (correct). |
| M2-14 | **BLOCKED** | **Round 3 (e4b5722):** Still absent: no `/receipt`, `/orders`, `/download`, `/api/receipts|orders|downloads` (all 404, `fe3-buy.log` §4). After a successful mock payment the buyer lands on the hosted page with only a 'Back to the drop' link. Frontend's `DownloadPanel` is presentational (only on `/design`). Owner: Backend/Payments (order + buyer-minted signed URLs), then Frontend. |
| M2-15 | **BLOCKED** | **Round 3 (e4b5722):** Signed-URL expiry carried from R2; receipt link that mints a fresh URL does not exist. |
| M2-16 | **BLOCKED** | **Round 3 (e4b5722):** No download-attempt counter / purchase concept. |
| M2-17 | **PASS** | **Round 3 (e4b5722):** Default-limits instance: 80 bad-signature requests from one IP → 403×60, 429×20; second IP still 403 (`fe3-misc.log`). |
| M2-18 | **PASS** | **Round 3 (e4b5722):** 390×844 and 360×800 (touch, DPR 2): landing, signup, login, forgot, terms, `/u/<id>`, unavailable page, dashboard, drops, new drop, and Ned's dashboard with the negative-balance alert: no horizontal scroll; Buy button ≥44 px touch target (`fe3-regress.log`; `fe3-dashboard-ned-390.png`). |
| M2-19 | **PASS** | **Round 3 (e4b5722):** Throttled 4G (9 Mbit/s, 170 ms RTT, 4× CPU, cache off), 3 runs: Buy button visible 304–325 ms, FCP 708–772 ms, load ≈0.92–0.95 s (`fe3-misc.log`). |
| M3-01 | **PASS** | **Round 3 (e4b5722):** Guest checkout, no login/account prompt: Buy → email + 18+ → redirected to the hosted card page `/pay/mock/<session>` which shows the card form (UI desktop + 390 mobile, `fe3-buy.log`; `fe3-hosted-page.png`). Real processor-hosted fields still need a real provider (M3-19). |
| M3-02 | **PARTIAL** | **Round 3 (e4b5722):** Payment → webhook-driven `succeeded` (status endpoint, 3 pending ledger lines = seller net) PASS; the 'redirect to download page immediately' half does not exist (see M2-14). |
| M3-03 | **PASS** | **Round 3 (e4b5722):** Declined / insufficient funds / expired / bad CVC / garbage card: friendly text only (no codes), no succeeded tx, 0 ledger lines, same session retryable with a good card (`fe3-fees.log`; UI check in `fe3-buy.log`). |
| M3-04 | **BLOCKED** | **Round 3 (e4b5722):** No 3-D Secure in the mock processor (5 card outcomes); needs a real sandbox. Owner: Payments. |
| M3-05 | **PASS** | **Round 3 (e4b5722):** $20.00 → platform $2.00, processing $2.40, net $15.60, integer cents; ledger sum = net (`fe3-fees.log`). |
| M3-06 | **PASS** | **Round 3 (e4b5722):** $1.00, $1.01, $9.99, $49.99, $123.45, $500.00: platform + processing + net = gross exactly; ledger sum = net. |
| M3-07 | **PASS** | **Round 3 (e4b5722):** `platform_settings.fee_percent` 10→15 via SQL: new sale platform $3.00, earlier sale unchanged $2.00, no deploy (no admin UI: M5-13). |
| M3-08 | **BLOCKED** | **Round 3 (e4b5722):** Needs a real processor account / live $1 charge. |
| M3-09 | **PASS** | **Round 3 (e4b5722):** New sale pending (7 d), 3 ledger lines available_at = created_at + 7 days; boundary now±1 s/µs flips exactly; live flip observed at ≈3.3 s for a +3 s entry; refund inside the hold reduces pending, not available (`fe3-boundary.log`, 20 checks). |
| M3-10 | **PASS** | **Round 3 (e4b5722):** Unsigned, bad-signature and tampered-body webhooks → 401, transaction stays pending (`fe3-webhook.log`, `fe3-buyerr.log` §D). |
| M3-11 | **PASS** | **Round 3 (e4b5722):** Same signed `sale.succeeded` ×3 → 200/200/200, one `sale_credit`; second event id for the same sale → still one credit. |
| M3-12 | **NOT RUN** | **Round 3 (e4b5722):** Not re-run in this FE round (Payments R5: PASS). |
| M3-13 | **BLOCKED** | **Round 3 (e4b5722):** No receipt email: dev mail dir has 0 files after 10+ purchases; yet the buyer form promises 'Email (for your receipt)' → FE-14. |
| M3-14 | **BLOCKED** | **Round 3 (e4b5722):** No receipt link / re-access page. |
| M3-15 | **PASS** | **Round 3 (e4b5722):** `confirmOver18` missing/false/`"true"`/1/null → 400 server-side (API, not just UI); UI blocks the submit and shows 'Please confirm to continue.'; `buyer_confirmed_18_at` stored (`fe3-buy.log`). |
| M3-16 | **PASS** | **Round 3 (e4b5722):** Default limits: 10 checkouts then 429 `Retry-After: 60` (4/4); UI shows disabled button with countdown 'Try again in 59s' + 'You can try again in 59 seconds.', re-enables when it ends; single buyer unaffected (`fe3-buyerr.log` §C; `fe3-buy-real429.png`). |
| M3-17 | **BLOCKED** | **Round 3 (e4b5722):** No Stripe/PayPal in src/scripts/lib/components/package.json/README (only a substring inside the common-passwords list) ✔; CCBill/Segpay not chosen/integrated (README documents the provider hook). Owner: Payments. |
| M3-18 | **PASS** | **Round 3 (e4b5722):** Re-run on the new BuyPanel: final-sale text + 18+/Terms checkbox before Buy, and again on the hosted page (`fe3-buy-validation-desktop.png`, `fe3-hosted-page.png`). |
| M3-19 | **BLOCKED** | **Round 3 (e4b5722):** Hosted fields need a real processor. The 'no card data stored/logged' half PASSES: PAN/CVC absent from `pg_dump --data-only` and from server logs after declined + approved cards; no card-like column in any table; secrets absent too (`fe3-leak-scan.log`). |
| M3-20 | **BLOCKED** | **Round 3 (e4b5722):** No download end of the flow. Scripted open-link→paid ≈0.4 s (mobile 390), human timing n/a. |
| M4-01 | **BLOCKED** | Carried over from round 2 (f3d9eb1), not re-run (no backend change in the branch; see money-file diff). Not implemented (no KYC provider, payouts, earnings dashboards, profile edit). |
| M4-02 | **BLOCKED** | Carried over from round 2 (f3d9eb1), not re-run (no backend change in the branch; see money-file diff). No provider integration; only dev stand-in `npm run verify-seller`. Verified the effect: after flipping status to `verified`, publish unlocks. |
| M4-03 | **BLOCKED** | Carried over from round 2 (f3d9eb1), not re-run (no backend change in the branch; see money-file diff). No provider webhook. Observed: `failed`/`manual_review` status keeps publish blocked (403) – see M2-03. |
| M4-04 | **BLOCKED** | Carried over from round 2 (f3d9eb1), not re-run (no backend change in the branch; see money-file diff). As M4-03. |
| M4-05 | **BLOCKED** | Carried over from round 2 (f3d9eb1), not re-run (no backend change in the branch; see money-file diff). Not implemented (no KYC provider, payouts, earnings dashboards, profile edit). |
| M4-06 | **PASS** | **Round 3 (e4b5722):** Re-run: pending seller publish 403, checkout on its draft 404, checkout when seller becomes `manual_review` after page load → 409 with friendly UI notice (`fe3-buyerr.log` §B). |
| M4-07 | **BLOCKED** | Carried over from round 2 (f3d9eb1), not re-run (no backend change in the branch; see money-file diff). Not implemented (no KYC provider, payouts, earnings dashboards, profile edit). |
| M4-08 | **BLOCKED** | Carried over from round 2 (f3d9eb1), not re-run (no backend change in the branch; see money-file diff). Not implemented (no KYC provider, payouts, earnings dashboards, profile edit). |
| M4-10 | **BLOCKED** | **Round 3 (e4b5722):** Units/revenue correct vs succeeded rows (Spring 21/$252.00, Studio 6/$150.00, Travel 4/$32.00) but views/conversion still don't exist, and per-drop Revenue disagrees with the ledger (FE-15). Frontend lists this as still open. |
| M4-11 | **BLOCKED** | **Round 3 (e4b5722):** Still no transaction-history page (`/dashboard/transactions|sales` 404, no buyer country). `GET /api/earnings.recent` (20 rows) exists but isn't rendered. Frontend lists this as still open. |
| M4-12 | **BLOCKED** | Carried over from round 2 (f3d9eb1), not re-run (no backend change in the branch; see money-file diff). Not implemented (no KYC provider, payouts, earnings dashboards, profile edit). |
| M4-13 | **BLOCKED** | **Round 3 (e4b5722):** No seller payout route/UI (`POST /api/payouts*` 404). Service rejects <$25 (`below_minimum_payout`) and the dashboard hint says 'Payouts start at $25.00' (`fe3-payout-ui.log`); Payments R5 PASS (service). |
| M4-14 | **PASS** | **Round 3 (e4b5722):** (service + dashboard) only post-hold funds are Available; entries inside the hold are Pending; eligibility flag follows min payout (`fe3-boundary.log`, `fe3-payout-ui.log`). |
| M4-15 | **BLOCKED** | **Round 3 (e4b5722):** No payout routes/screens. Through the service the dashboard follows requested→approved→paid correctly: In payout +$30, Available −$30, then Paid out +$30 (`fe3-payout-ui.log`). |
| M4-16 | **BLOCKED** | **Round 3 (e4b5722):** Failed payout returns funds and the dashboard follows (Available restored); no admin screen to see it. |
| M4-17 | **BLOCKED** | **Round 3 (e4b5722):** Still blocked: `PATCH|PUT /api/auth/me` 405, no profile/settings UI (`fe3-blocked-probes.log`). Frontend lists this as still open. |
| M4-18 | **PASS** | **Round 3 (e4b5722):** Scripted signup → verification stand-in (DB) → new drop one-step upload+publish → live link in 1.3 s (`fe3-journey.log`); well under 15 min. |
| M5-01 | **BLOCKED** | Carried over from round 2 (f3d9eb1), not re-run (no backend change in the branch; see money-file diff). Not implemented (no moderation, reports API, refunds, admin routes/UI). |
| M5-02 | **BLOCKED** | Carried over from round 2 (f3d9eb1), not re-run (no backend change in the branch; see money-file diff). Not implemented (no moderation, reports API, refunds, admin routes/UI). |
| M5-03 | **BLOCKED** | Carried over from round 2 (f3d9eb1), not re-run (no backend change in the branch; see money-file diff). Not implemented (no moderation, reports API, refunds, admin routes/UI). |
| M5-04 | **BLOCKED** | Carried over from round 2 (f3d9eb1), not re-run (no backend change in the branch; see money-file diff). Not implemented (no moderation, reports API, refunds, admin routes/UI). |
| M5-05 | **BLOCKED** | Carried over from round 2 (f3d9eb1), not re-run (no backend change in the branch; see money-file diff). Not implemented (no moderation, reports API, refunds, admin routes/UI). |
| M5-06 | **BLOCKED** | Carried over from round 2 (f3d9eb1), not re-run (no backend change in the branch; see money-file diff). Not implemented (no moderation, reports API, refunds, admin routes/UI). |
| M5-07 | **PASS** | **Round 3 (e4b5722):** Ned: refund after a full payout → Balance owed −$46.80 on the dashboard; a new sale inside the hold leaves it visible (pending +$46.80); with hold 0 the next sale nets it to $0.00 and the red card/alert disappear (`fe3-ned-netting.log`). |
| M5-08 | **PASS** | **Round 3 (e4b5722):** Chargeback webhook (+$5 fee) shown on the dashboard as 'charged back' separate from refunds, fee named in the reconciliation line; also with the chargeback inside the hold window (`fe3-cbhold.log`). Flagging/review: Payments R5. |
| M5-09 | **BLOCKED** | Carried over from round 2 (f3d9eb1), not re-run (no backend change in the branch; see money-file diff). No suspend/ban status or enforcement in schema/code. |
| M5-10 | **BLOCKED** | Carried over from round 2 (f3d9eb1), not re-run (no backend change in the branch; see money-file diff). Not implemented (no moderation, reports API, refunds, admin routes/UI). |
| M5-11 | **BLOCKED** | Carried over from round 2 (f3d9eb1), not re-run (no backend change in the branch; see money-file diff). Not implemented (no moderation, reports API, refunds, admin routes/UI). |
| M5-12 | **BLOCKED** | Carried over from round 2 (f3d9eb1), not re-run (no backend change in the branch; see money-file diff). Not implemented (no moderation, reports API, refunds, admin routes/UI). |
| M5-13 | **BLOCKED** | Carried over from round 2 (f3d9eb1), not re-run (no backend change in the branch; see money-file diff). No admin settings API/UI; settings are SQL-edited. Verified live effect of SQL edits (price bounds, file count, image size) without deploy – see M2-02, M1-08. |
| M5-14 | **BLOCKED** | Carried over from round 2 (f3d9eb1), not re-run (no backend change in the branch; see money-file diff). `audit_log` table exists but nothing writes to it; no immutability trigger. |
| M5-15 | **BLOCKED** | Carried over from round 2 (f3d9eb1), not re-run (no backend change in the branch; see money-file diff). No admin routes exist (`/admin`, `/api/admin/*` → 404); `admins` table has no auth model. Seller `PUT /api/settings` → 405. |
| M5-16 | **BLOCKED-ON-LEGAL** | **Round 3 (e4b5722):** Parked (legal copy pending), **not counted as FAIL; stays BLOCKED-ON-LEGAL.** Placeholders `/terms /privacy /dmca /contact` are still 'Coming soon' with no legal claims; FE-09 and FE-10 are fixed (X-Robots-Tag on all four; all four links on login, signup, forgot, reset, dashboard shell, buyer page, unavailable page; each link 200). `/2257` still 404. Owner: Legal. |
| M5-17 | **BLOCKED** | Carried over from round 2 (f3d9eb1), not re-run (no backend change in the branch; see money-file diff). Not implemented (no moderation, reports API, refunds, admin routes/UI). |
| M5-18 | **BLOCKED** | Carried over from round 2 (f3d9eb1), not re-run (no backend change in the branch; see money-file diff). Not implemented (no moderation, reports API, refunds, admin routes/UI). |
| M5-19 | **BLOCKED** | Carried over from round 2 (f3d9eb1), not re-run (no backend change in the branch; see money-file diff). No cookie-consent banner; only the essential session cookie is set. Frontend. |
| M5-20 | **PASS** | **Round 3 (e4b5722):** Re-scan of landing, auth, legal placeholders, buyer page, unavailable page, hosted checkout page, og/twitter tags: no adult-market wording; the 18+ confirmation text is neutral (`fe3-misc.log`). |
| M6-01 | **NOT RUN** | Carried over from round 2 (f3d9eb1), not re-run (no backend change in the branch; see money-file diff). Full OWASP review not performed. Partial probes all clean: SQL is parameterised (only constant column lists interpolated), XSS payloads escaped on public page, JWT tamper/alg=none 401, CSRF: foreign/`null`/garbage Origin → 403 JSON, IDOR clean (M1-13), decompression cap (10100×10000 → 415), no `dangerouslySetInnerHTML`, only outbound fetch is the fixed Google token URL (+ mail adapters). Open: BUG-13 (`text/plain` accepted). |
| M6-02 | **PASS** | **Round 3 (e4b5722):** All 6 security headers on `/`, `/login`, `/terms`, `/u/*`, `/api/earnings`, `/dashboard`; CSP without `unsafe-eval`; 5 secret values absent from the 27 client-bundle files and rendered HTML; mock endpoints 404/503 when the mock is disabled. |
| M6-03 | **NOT RUN** | Carried over from round 2 (f3d9eb1), not re-run (no backend change in the branch; see money-file diff). Only link page exists; load test not run (checkout/download not built). |
| M6-04 | **BLOCKED** | Carried over from round 2 (f3d9eb1), not re-run (no backend change in the branch; see money-file diff). Not implemented / out of scope for foundation (no backup/monitoring/status page/webhook queue/launch artifacts). |
| M6-05 | **BLOCKED** | Carried over from round 2 (f3d9eb1), not re-run (no backend change in the branch; see money-file diff). Not implemented / out of scope for foundation (no backup/monitoring/status page/webhook queue/launch artifacts). |
| M6-06 | **BLOCKED** | Carried over from round 2 (f3d9eb1), not re-run (no backend change in the branch; see money-file diff). No status page / incident banner exists in UI or backend (no toggle source). Blocked on **Backend/Ops** (banner flag or status feed) then **Frontend**. |
| M6-07 | **PASS** | **Round 3 (e4b5722):** Manifest valid, `/icons/icon-192.png` and `icon-512.png` 200 image/png (the og/twitter image is the 512 icon). |
| M6-08 | **BLOCKED** | Carried over from round 2 (f3d9eb1), not re-run (no backend change in the branch; see money-file diff). Not implemented / out of scope for foundation (no backup/monitoring/status page/webhook queue/launch artifacts). |
| M6-09 | **BLOCKED** | Carried over from round 2 (f3d9eb1), not re-run (no backend change in the branch; see money-file diff). Not implemented / out of scope for foundation (no backup/monitoring/status page/webhook queue/launch artifacts). |
| M6-10 | **BLOCKED** | Carried over from round 2 (f3d9eb1), not re-run (no backend change in the branch; see money-file diff). Not implemented / out of scope for foundation (no backup/monitoring/status page/webhook queue/launch artifacts). |
| S2-01 | **PASS** | **Round 3 (e4b5722):** = M4-18 (1.3 s scripted). |
| S2-02 | **BLOCKED** | **Round 3 (e4b5722):** = M3-20. |
| S2-03 | **PASS** | **Round 3 (e4b5722):** = M3-07. |
| S2-04 | **PASS** | **Round 3 (e4b5722):** = M2-03 / M4-06. |
| S2-05 | **BLOCKED** | **Round 3 (e4b5722):** Trace works up to the ledger (tx → `webhook_events` row `sale_succeeded/processed` → 3 ledger lines posted via that event → dashboard), but no receipt exists (`fe3-journey.log`). |
## Reproducing
```
git worktree add --detach /workspace/qa-fe3 e4b5722 && cd /workspace/qa-fe3 && npm ci
# .env: DATABASE_URL (throwaway), fresh secrets, PAYMENT_WEBHOOK_SECRET=…, MOCK_PAYMENTS_ENABLED=1  (docs/frontend-dashboard-notes.md)
set -a; . ./.env; set +a; unset NODE_ENV
npm run migrate && npx tsc --noEmit && npm test && npm run build   # NEXT_DIST_DIR=.next-qa for the QA servers
npx tsx scripts/seed-demo.ts            # Maya / Ned / Sam / Jo
# servers: 4331 RATE_LIMIT_ENABLED=0; 4332 RATE_LIMIT_ENABLED=0 MOCK_PAYMENTS_ENABLED=0; 4333 default limits
# scripts need env: BASE SEED(JSON) DB WT OUT IMG BASE_NOMOCK BASE_LIM MAIL_DIR SEEDJSON
node qa/scripts/qa-fe3-earnings.mjs; node qa/scripts/qa-fe3-fixes.mjs; node qa/scripts/qa-fe3-buy.mjs; …  # one per log in qa/artifacts/fe3
```
`qa-fe3-regress.mjs` expects Ned still negative: run it on a fresh seed (ned-netting nets Ned out).

## Housekeeping
Servers :4330–4333 stopped, DBs `unveil_qa_fe3` and `unveil_e2e_qafe3` dropped, worktrees `/workspace/qa-fe3` and the push worktree removed, temp files removed. Scripts in `qa/scripts/qa-fe3-*`, evidence in `qa/artifacts/fe3/` (screenshots `fe3-*.png`, logs, seeds; raw server logs not committed).
