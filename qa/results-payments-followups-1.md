# Unveil QA results — `payments/followups`, run 1 (follow-ups: NEW-1 fix, janitor, admin foundation)

- **Date:** 2026-10-01 12:08–12:50 ET
- **Branch tested:** `origin/payments/followups` @ **`5716360c4d75a609bb3a854858ab72ff9c87e86f`** ("e2e: don't read a response body twice"), 22 commits on top of `main`.
- **main:** `origin/main` @ **`ac62c23e26902963214f2ed456fe31e490a69ae4`** ("Merge pull request #2 from unveil-link/payments/abstraction"). **main already contains `payments/abstraction` (a83c40f)** — confirmed with `git merge-base --is-ancestor`; `payments/followups` is a straight descendant of main (merge-base == main).
- **Money-math claim verified:** `git diff origin/main origin/payments/followups -- src/server/payments/{money,pricing,ledger,payouts}.ts` is **empty** (0 lines). The only edit in `webhooks.ts` is the one-line `AND created_at > COALESCE((SELECT risk_reviewed_at …),'-infinity')` predicate in the chargeback-flag *count* (no posting code); `refunds.ts` changes are confined to `voidCharge`/`retryVoidRefunds` bookkeeping + the pure backoff helper (`requestRefund` untouched); `earnings.ts` only adds a label. Matches PAYMENTS-NOTES.
- **Env:** clean detached worktree `/workspace/qa-pay3`; Node 20.19.2, PostgreSQL 17; `npm ci`; throwaway DBs `unveil_qa_pay3` (main), `unveil_qa_pay3_up` (+ transient `_c008/_c009/_c010/_cc` clones) for migrations, `unveil_e2e_qapay3` (e2e). Servers: 3717 (checkout/cron/admin-login limiters raised), 3718 (default limits), 3720–3722 (janitor 503/32-char secret servers), 3740–3749 (production-mode probes), e2e on 3730; all `NODE_ENV=production next start`, `MOCK_PAYMENTS_ENABLED=1`, loopback `APP_URL`, random `CRON_SECRET`. No other worker's DB/port/process touched; app source not modified (worktree diff is only `tsconfig.json`/`proof/db.txt` side effects of the build/e2e).
- **Re-run:** `. qa/scripts/qa-pay3-env.sh && QA_BASE_URL=http://localhost:3717 npx tsx qa/scripts/qa-pay3-<n1|n2|n3|money|webhooks|refunds|checkout|payouts|races|session|retry|prod|r2a|r2b|r2c|r2d>.ts`, `node qa/scripts/qa-pay3-ui.mjs|qa-pay3-dblclick.mjs|qa-pay3-adminui.mjs …`, `qa/scripts/qa-pay3-mig.sh unveil_qa_pay3_<x>`. Scripts refuse to run unless `DATABASE_URL` is a `unveil_qa_pay*` DB. Evidence: `qa/artifacts/pay3-*` (round 1/2 evidence untouched).
- **New round-3 probe scripts:** `qa-pay3-n1.ts` (NEW-1 fix, 22 probes), `qa-pay3-n2.ts` (janitor, 19), `qa-pay3-n3.ts` (admin + re-flag, 24), `qa-pay3-adminui.mjs` (real-browser admin, 13), `qa-pay3-mig.sh` (migrations 008–010), plus the whole earlier suite (re-pointed to 37xx, assertions updated for the declared changes).

## Headline
- **NEW-1 fix: FIXED** (privacy oracle gone, price supersede works). **Janitor: works as specified** (auth order, limiter, advisory lock, backoff/cap, overlap with webhooks). **Admin foundation: solid isolation/session/CSRF/XSS results; audited clear-flag works; re-flag behaviour matches the notes.**
- **No MEDIUM/HIGH bugs. 2 new LOW** (NEW-2: NUL byte in clear-flag note → 500; NEW-3: `audit_log` is not tamper-proof at DB level, so M5-14 "log not editable" is only partially met) and several INFO/deployment notes.
- Totals: **plan cases PASS 19 / FAIL 0 / PARTIAL 2 / BLOCKED 18 (39 rows)**; **322 probes: 317 PASS / 1 FAIL (= NEW-2, `ADM-NOTE-1`) / 3 BLOCKED (buyer-UI download/hosted-field items) / 1 NOTE (expected 401/404 console lines)** — see appendix. Baseline: typecheck/lint clean, `npm test` 175/175, `npm run e2e` 75/76 twice (only the `[#13]` login-delay check; see below).

## Baseline suite (5716360)
| Check | Expected | Result |
|---|---|---|
| `npm ci` | clean | OK, 0 vulnerabilities |
| `npm run migrate` | 001–010 | **applied 001–010** |
| typecheck (after `next typegen`) | clean | **clean** (run on the clean tree; my own `qa/scripts` carry `// @ts-nocheck`) |
| lint | clean | **0 errors / 0 warnings** on the clean tree |
| `npm test` | 175 | **175/175** (10 files; `pay3-npm-test.log`) |
| `npm run e2e` | 76 | run 1: **75/76**; rerun: **75/76**. Both times the only failing check is the known `[#13]` "exactly 3 evaluated" login-delay check (saw **4** both times; `pay3-e2e.log`, `pay3-e2e-run2.log`). All 14 `[pay#…]`, `[fu2]` and `[fu3]` checks pass in both runs. Per instruction I reran once. INFO: the flake did not clear on the rerun this time (it did in rounds 1–2); unrelated to payments (login throttle is a main/backend area). |

## Item verdicts

### 1. NEW-1 fix — pending sessions bound to the creating client: **FIXED**
Original repro re-run (`N1-1`): client A creates a checkout for the victim's email; client B (different IP, no cookies, only email + link id) now gets **201 `reused:false`**, its own transaction/session/cookie, and none of A's identifiers appear in B's body. Details (`pay3-n1.log`, 22/22 PASS):
- Same cookie → 200 `reused:true`, no new Set-Cookie. Same `Idempotency-Key`+email → same txn; same key + other email → independent txn (no leak). Same key on another drop → 409 with no txn-id leak.
- **Forged/guessed/truncated/tampered cookies** (truncated, last/first char flipped, upper-cased, reversed, empty, 31/65 chars, 43 zeros/`A`s, SQL, `%00`, latin-1, SHA-256 of the real token, base64 padding): all treated as an unknown client → 201 own session, never the victim's txn/URL, 0×5xx. Duplicate cookie names: first wins, only tokens the caller already holds.
- Cookie from drop A used on drop B (same email): independent txn per drop; same cookie with a different email: separate txn; email case/whitespace variants map to the same pending.
- **Flags** (live, production build): `HttpOnly; SameSite=lax; Path=/api/checkout; Max-Age=86400; Secure` (Secure because `config.isProd`; no Domain); `Cache-Control: no-store`. Because Path is `/api/checkout`, the cookie is not sent to `/api/checkout/status`, `/pay/*` or any other route.
- **Entropy:** 300 tokens: all unique, 43 chars base64url (256-bit), per-byte diversity ≥166/256, bit balance 0.501, no relation to email/txn/time; DB stores only the 64-hex SHA-256 (CHECK-constrained), never the token.
- **Cookie reads nothing:** status API output is byte-identical with/without the cookie (txn uuid is the capability), `/api/earnings` with a buyer cookie → 401.
- **Concurrency:** 20 parallel with the same cookie → 1 txn (all 200); 20 parallel with the same key (no cookie) → 1 txn (1×201); 20 anonymous parallel requests → 20 independent pendings (by design: no key and no cookie = separate clients); 60 mixed concurrent requests (keys/cookies/3 emails/2 drops) → 0×5xx, 0 duplicate pendings; DB index rejects a duplicate (drop,email,token) with 23505. Real-browser double-click → **1 POST, 1 transaction** (`pay3-dblclick.log`).
- **Price change mid-pending:** reuse by cookie or by key after the seller changes the price → old txn `failed/superseded`, key released, **new txn at the new price (201)**, DB amount == link price; another client unaffected; a keyed replay then maps to the new txn. Reuse is still refused after drop unpublish (404) and after the 30-min TTL (new 201). INFO-1 of round 2 (stale price on reuse) is therefore fixed.
- Residual / by design (INFO): (a) the `Idempotency-Key` is a bearer capability — anyone who holds the victim's key + email can replay it (keys are random UUIDs per page load and never shown to others); (b) the same real buyer in two browsers gets two pending txns and could pay both (documented trade-off in the notes); (c) a hosted-page payment of a *superseded* session is refused ("replaced by a newer one"), but a valid-signature **webhook** for a superseded txn is booked at the price actually charged (txn succeeded 2000, 3 ledger lines, gross == fees+net) — consistent with PAYMENTS-NOTES.

### 2. Payments janitor — **PASS** (`pay3-n2.log`, 19/19)
- **Auth order / matrix (live server):** `CRON_SECRET` unset, empty or 31 chars → **503 for every request even with a (correct or wrong) header**, GET and POST; exactly 32 chars works. With a secret: no header / empty / `Bearer` / `Bearer ` / wrong same-length / last char flipped / prefix (len-1, 8) / secret+extra / short / 8 KB token / Basic / raw secret / `Token` / double `Bearer` / lowercase `bearer` → **401** with `WWW-Authenticate: Bearer`, body `{"error":"Unauthorized","code":"unauthorized"}`, no secret/length echo. Extra/trailing whitespace is tolerated (200). Comparison is SHA-256-then-`timingSafeEqual` (code review; timing not measurable remotely).
- **Methods / CSRF:** GET and POST work with the bearer; PUT/DELETE/PATCH → 405; a cookie-only GET with a foreign Origin/Referer → 401 and **no run** (heartbeat counter unchanged), so a browser/img-tag/cross-site request can never trigger it; POST with a foreign Origin + correct bearer → 403 (same-origin guard).
- **Limiter:** per-IP `CRON` 30/min counted **before** auth: 30×401 then **429** (+`Retry-After: 60`); a *correct* token while limited is also 429; other IPs unaffected; limiter also applies before the 503. **XFF spoofing:** with no overwriting proxy, 60 requests with rotating single `X-Forwarded-For` values → 60×401, 0×429 (limiter evaded); a constant right-most entry with spoofed left entries is still limited. Same deployment caveat as round-1 M3-16 — INFO/deployment (proxy must overwrite XFF). Brute-forcing a 64-hex secret remains infeasible either way.
- **Secret handling:** `CRON_SECRET` in no response body, server log, audit row, DB dump.
- **Behaviour:** expiry honours TTL (29:50 stays pending, 31 min expires, setting `ttl=5` honoured, sold txns untouched, repeat run = 0). **Void-refund retry:** provider failure (txn pointed at a bogus provider) → attempts 1..5 with `next_attempt` backoff **+5/+10/+20/+40/+80 min** (= base·2^(n−1)), `last_error` stored, attempt cap honoured (no 6th call; cap setting `max=2` honoured), not-yet-due rows skipped, `gaveUp` counted as a standing condition, recovery after the provider returns sets `refund_requested_at` with ledger still 0 and `review_reason` intact. **Overlap:** 8 concurrent janitor runs + 30 concurrent late-success webhooks (10 on one txn with new event ids, 20 other void candidates) → 7 skipped by the advisory lock, 1 executed, all 20 voided txns `failed/invalid_at_capture`, `review_reason` + `refund_requested_at` set, **0 ledger lines**, exactly one processed event on the contended txn, 0×5xx; 12 simultaneous in-process runs → 1 executed / 11 `already_running`; an externally held lock → skipped; lock freed on disconnect. 20 pay‖webhook‖janitor races at TTL−0.03 s → 20/20 consistent (succeeded ⇒ 3 lines), 0×5xx. Heartbeat increments every run; the `payments_janitor_run` audit row is written only for busy/erroring runs.
- **Parked events:** refund+chargeback parked before the sale, back-dated 80 h → janitor stamps `stale_flagged_at` on both (re-run flags 0), rows kept; the late sale then applies them in-order inside its own transaction (parked remaining 0, tx `charged_back`, 9 ledger lines) and a following janitor run changes nothing. **Coverage note:** I could not construct a natural state where `retryParkedEvents()` itself has work (the sale path applies parked events atomically), so "janitor applies a parked event exactly once" is covered only by the repo's own DB tests + my "janitor never double-applies" checks (`JAN-14/15`), not by an independent positive repro.
- **CLI:** `npm run payments:janitor` prints the JSON result (exit 0); with bad DB credentials exits 1 with no secrets on stderr.
- **Money invariants after the storm** (1,680 txns / 1,489 ledger lines): no ledger on failed/pending, gross == platform+processing+net, unrefunded ledger == net, `reversed ≤ amount`, no negative seller balance, no duplicate pendings.

### 3. Admin foundation — **PASS with 2 LOW findings** (`pay3-n3.log` 23/24 + browser 13)
- **CLI (`create-admin`):** lowercases email, bcrypt hash, audit `admin_created_cli`; duplicate refused; `--reset-password` rotates and **revokes that admin's sessions** (old session 401, old pw 401, new pw 200); 6 invalid emails and 6 weak passwords (short, common, sequential, repeated, contains email, >200) rejected with nothing created; any `--password` flag refused (usage exit 2, password never accepted via argv); with no TTY and no `ADMIN_PASSWORD` it refuses; password never printed or logged.
- **Anonymous:** every `/api/admin/*` route (GET/POST, PUT/DELETE/PATCH) → **401**; unknown admin API paths → 404; pages `/admin`, `/admin/sellers/flagged`, `/admin/sellers/<id>/transactions` → 307 to `/admin/login` with no data; no 500s.
- **Seller ↔ admin isolation:** signed-in seller on all 4 admin routes → **403**; seller token pasted into `unveil_admin` → 401 (pages redirect); admin token in `unveil_session` → 401/404 on `/api/earnings`, `/api/drops`, `/api/auth/me`; both cookies at once resolve per principal. **Forged tokens** (alg=none, HS256 with the raw `SESSION_SECRET` and the admin audience, derived key + wrong audience / unknown jti / non-uuid jti / expired / tampered signature / **revoked session's jti** / a seller token / garbage / another admin's `sub`) → all 401; only a token signed with the derived key *and* a live session id is accepted (control, QA holds the secret).
- **Sessions:** new session per login (attacker-chosen pre-login cookie replaced → no fixation); logout revokes server-side (replayed cookie 401; other session unaffected; double/anonymous logout harmless); `expires_at` in the past → 401; Max-Age 28800. **Disabled admin:** both live sessions return 401 within ~0.7 s of the `UPDATE` (re-checked on every request), login refused with the uniform error, re-enable restores, deleting an admin cascades its sessions.
- **Login:** uniform 401 body for unknown email / wrong password / disabled and no cookie on failure; malformed bodies (no body, array, missing/number/100 KB password, NUL, SQLi strings, object email, lone surrogate) → 400/401, never 500; case-insensitive email; median latency unknown-email 327 ms vs known-email 322 ms (bcrypt on both → no enumeration signal); per-email progressive delay (namespaced `admin:`) → 429 + Retry-After from the 6th attempt, correct password during the delay refused, and a delay on an admin address does not delay a seller with the same email (and vice versa); per-IP limiter 10/15 min → 11th attempt 429 even with valid credentials, other IP unaffected (rotating XFF evades — same deployment note as above). Password policy = seller policy (min 10, common/sequential/repeat/email checks).
- **Cookie:** `unveil_admin=…; Path=/; Max-Age=28800; Secure; HttpOnly; SameSite=strict`, cleared with `Max-Age=0` on logout. Pages and APIs send `X-Robots-Tag: noindex, nofollow`, `<meta robots noindex,nofollow,nocache>`, `Cache-Control: no-store`; `robots.txt` has `Disallow: /admin`; `/`, `/u/<link>`, sitemap contain no `/admin` link.
- **CSRF:** 9 foreign/odd Origins (`evil.example` http/https, `null`, `localhost.evil.com`, `localhost:3717.evil.com`, wrong port, garbage, nested URL, `file://`) × 3 content types (JSON, `text/plain`, form-urlencoded) on clear-flag → all 403, flag intact; login and logout CSRF → 403 (still logged in afterwards). INFO: the same-origin check compares host only, not scheme (Origin `https://localhost:3717` vs an http app passes), and a request **without** an Origin header (and `text/plain`) is accepted — only reachable by non-browser clients; browsers always send Origin on cross-site POSTs and the cookie is `SameSite=Strict`.
- **Clear flag:** note must be 3–500 chars (empty/whitespace/2/501 chars/non-string/missing/bad JSON → 400, flag untouched); unflagged seller → **409 `not_flagged`**; unknown/garbage/SQLi/overlong ids → 404/400; mass-assignment fields (`risk_flagged_at`, `adminId`, `risk_reviewed_by`, …) ignored — reviewer is always the session admin; success writes `risk_reviewed_at/by/note` and **one `audit_log` row** (`admin_id`, DB timestamp, `previous_reason`, trimmed note) in the same transaction; **double clear → 409**, still 1 audit row; **10 concurrent clears → exactly one 200 + nine 409, one audit row**; clear ‖ chargeback consistent. Clear changes nothing else (verification status and drops unchanged; flagged seller remains purchasable).
- **XSS:** `<img onerror>`/`<script>` in seller display name, flag reason, drop title, `review_reason`, refund last error → HTML-escaped on `/admin/sellers/flagged` and `/admin/sellers/<id>/transactions`; real Chrome check: 0 dialogs, `window.__x` undefined, no injected `<img>`. CSP present but `script-src 'self' 'unsafe-inline'` (INFO, defence-in-depth).
- **Data exposure:** the 3 admin JSON endpoints and 2 pages never include password hashes, payout details, DOB/legal name, buyer emails, idempotency keys, token hashes, provider refs or secrets.
- **Real-browser admin flow** (`pay3-adminui.log`, screenshots `pay3-admin-*.png`): anonymous → login redirect; wrong password shows "Invalid email or password"; login lands on flagged list; flagged card shows name/email/reason/counts; review table renders (refund-state cells "Refund requested (time)" / pending / FAILED with last error); 1-char note blocked by HTML `minLength`; confirm dialog "…recorded in the audit log"; card disappears after clear; seller transactions page ("buyer emails are not shown"); unknown seller → 404; Sign out → direct URL redirects to login. Console shows only the expected 401 (logged-out probe) and 404.
- **Not built (404/405 on GET/POST):** admin refunds, suspend, ban, settings, payouts, audit-log viewer, admin user management → M5-05/06/09/10/12/13 stay BLOCKED; `sellers` has no suspend/ban columns.

### (d) Re-flag after clear — matches the notes (`ADM-REFLAG-1/2/3`)
Seller with 3 chargebacks → flagged → admin clears (note) → the 3 old chargebacks do **not** re-flag. After the clear: new chargeback #1 → not flagged, #2 → not flagged, **#3 → flagged again** (`3 chargebacks within 90 days (threshold 3)`, +1 audit row from the flagging). Edge cases: chargeback *webhooks* arriving after the clear for sales made before it count as new (count is by ledger event time vs `risk_reviewed_at`), so 2 late ones + 1 refund → not flagged, a 3rd → flagged; a second clear works and writes a second audit row; 6 simultaneous new chargebacks right after a clear → 6×200, flagged exactly once. Exactly as PAYMENTS-NOTES describes ("the chargeback count **restarts** at `risk_reviewed_at`"; old ones don't instantly re-flag, 3 new ones do). INFO: because only post-review chargebacks count, a seller can accumulate 2 new chargebacks per review cycle indefinitely (by design).

## Migrations 008–010 (`qa-pay3-mig.sh`, `pay3-migration.log`)
| Check | Result |
|---|---|
| Upgrade 007 → 008, 009, 010 via `npm run migrate` on a DB with data (flagged seller, 3 pendings incl. keyed/legacy, failed, succeeded + 3 ledger rows, void row, parked webhook row, legacy admin + audit row) | **PASS** — ledger 3/1360 and all txn statuses unchanged; legacy pendings keep `buyer_token_hash NULL` (never handed to anyone); 009 defaults 5/5/72, `payments_janitor_state` seeded; legacy admin row kept with `password_hash NULL` (cannot log in) and its audit row kept; seller flag preserved; 007's `transactions_one_pending_uniq` replaced by `transactions_one_pending_per_client_uniq` |
| Index semantics | **PASS** — second NULL-token pending for same drop+email → 23505; non-hex token hash → CHECK violation; `admins_email_lowercase` is `NOT VALID` so legacy mixed-case rows are kept but new ones rejected |
| Re-run `npm run migrate` | **PASS** — "up to date" |
| 008/009/010 SQL applied manually 2× more | **PASS** — all idempotent, no data change |
| Failed migration (appended `SELECT 1/0` to each of 008, 009, 010 on a clone) | **PASS** — whole file rolled back each time: not recorded, 0 leftover objects; clean re-apply works |
| Rollback | No down migrations ship (INFO, as before). QA-authored down + re-upgrade preserved ledger, txns and the flag |
| 4 concurrent `npm run migrate` on a fresh DB | **PASS** — advisory lock: one runner applied all 10, others 0, 0 errors |
| Unique-index violations under concurrency | **PASS** — N1 (60 mixed + 20 same-cookie/same-key) and janitor/admin races: 0×5xx, 0 duplicate pendings |

## Earlier suite re-run against 5716360 (assertion changes noted)
money **11/11**, webhooks **45/45** (17 signature variants 401, idempotency 3×/12×, out-of-order), refunds **16/16**, checkout **32/32**, payouts **13/13** (min / hold / double-spend), races **5/5**, session **3/3**, retry **2/2**, prod-mode matrix **8/8** (live servers on 3740–3749: production without flag, flag + public/deceptive `APP_URL`, short secrets, unknown provider), r2a **31/31** (BUG-1…4), r2b **24/24** (expiry/void/invariants), r2c **34/34** (BUG-8 config matrix incl. `MOCK_PAYMENTS_ENABLED`), r2d **10/10**, UI **7 PASS + 3 BLOCKED**. PAN/CVC grep (`pay3-pan-grep.log`): none of the 6 test PANs in a full `pg_dump` or any server log; `CRON_SECRET`, `SESSION_SECRET` and the admin password also absent from DB and logs. Server logs contain only the NEW-2 error lines (`pay3-server-errors.log`).

| Assertion changed for round 3 | Old | New |
|---|---|---|
| "same client" definition (PRICE-1, DUP-1, BUG-1a/1b/1l/1m/1n, REUSE-2/3/5, INV) | same drop+email reuses the live pending txn for anyone | reuse only for the same **cookie jar** or **Idempotency-Key** (what `BuyForm` sends per page load); a keyless, cookieless caller is a separate client by design |
| BUG-1j / REUSE-4 | reuse keeps the old price (INFO-1) | price change **supersedes** the old txn (`failed/superseded`) and a new txn is created at the new price |
| BUG-1k / REUSE-5 (NEW-1) | asserted the oracle (reuse + victim's URL) | asserts **no oracle** (201, `reused:false`, own session) |
| duplicate-pending invariant | `(drop, lower(email))` | `(drop, lower(email), coalesce(token_hash,''))` |
| `retryVoidRefunds()` | returns number | returns `{requested, failed, gaveUp}` |
| Harness | ports 36xx, `qa-pay2` | ports 37xx, `qa-pay3`; `CRON_SECRET` in env |

## Plan-case table (39 rows)
| ID | Result | Evidence / change vs round 2 |
|---|---|---|
| M3-01 | PASS | guest checkout, no login; UI + API re-run |
| M3-02 | PASS (status) | redirect to download still BLOCKED (not built) |
| M3-03 | PASS | declines book nothing; session payable again; friendly copy |
| M3-04 | BLOCKED | no 3-D Secure in mock — Payments (real sandbox) |
| M3-05 | PASS | $20 → 2000/240/200/1560 |
| M3-06 | PASS | money 11/11 incl. 698,614-case sweep; money files byte-identical to main |
| M3-07 | PASS | fee changes via DB setting honoured (no admin settings UI/API: see M5-13) |
| M3-08 | BLOCKED | needs a real processor account |
| M3-09 | PASS | pending/available/hold |
| M3-10 | PASS | 17 signature variants → 401, no state change |
| M3-11 | PASS | 3×/12× idempotency |
| M3-12 | PASS | out-of-order/parked/NUL; janitor stale-flags parked events, never deletes |
| M3-13 | BLOCKED | receipt email not built |
| M3-14 | BLOCKED | receipt re-access/download not built |
| M3-15 | PASS | 18+ confirmation |
| M3-16 | PASS | 10/60 limiter; XFF-rotation note unchanged (INFO) |
| M3-17 | BLOCKED | processor choice (CCBill/Segpay) undecided |
| M3-18 | PASS | all-sales-final on link page + hosted page |
| M3-19 | BLOCKED | hosted fields need a real processor; "no card data stored/logged" half PASSES |
| M3-20 | BLOCKED | no download end of the flow |
| M4-13 | PASS (service) | payouts 13/13 |
| M4-14 | PASS (service) | hold/available |
| M4-15 | BLOCKED | no seller/admin payout routes |
| M4-16 | BLOCKED | payout failure restores funds (service), but "visible to admin" has no screen |
| M5-04 | BLOCKED | admin flagged-*drop* review not built (only flagged **sellers** exist) |
| M5-05 | BLOCKED | no admin refund route/button (`requestRefund` service only) |
| M5-06 | BLOCKED | same |
| M5-07 | PASS | refund after payout → negative balance, netted against new sale |
| M5-08 | PASS | + admin review/clear and re-flag behaviour verified |
| M5-09 | BLOCKED | no suspend |
| M5-10 | BLOCKED | no ban |
| M5-11 | PARTIAL | admin sees a seller's last 200 txns (no buyer emails) and verification status in the flagged list; no search/seller directory, not "full history" |
| M5-12 | BLOCKED | no payout approve/release; admins see failed void refunds only |
| M5-13 | BLOCKED | no settings editor (SQL only) |
| M5-14 | PARTIAL | every admin action (`admin_login`, `admin_logout`, `seller_flag_cleared`, `admin_created_cli`, `admin_password_reset_cli`) is logged with timestamp and admin id; **no API can edit/delete the log**; but the table is not tamper-proof at DB level (NEW-3) and failed logins are not logged |
| M5-15 | PASS | for every route/page that exists: anonymous 401/redirect, seller 403, forged/seller/revoked tokens 401; no data leaks; no 500s |
| S2-02 | BLOCKED | = M3-20 |
| S2-03 | PASS | = M3-07 |
| S2-05 | BLOCKED | receipt link of the trail missing; txn → webhook → ledger → void/refund + audit trail (flag clear) traceable |

**Counts (39 rows): PASS 19 · FAIL 0 · PARTIAL 2 · BLOCKED 18.** (Round 2: PASS 18 / FAIL 0 / BLOCKED 14 over 32 rows; new rows M5-09…M5-15 added because admin auth now exists. M5-15 PASS is new.)

## New bugs / findings
| # | Severity | Finding | Exact repro |
|---|---|---|---|
| NEW-2 | **LOW** | A NUL byte in the clear-flag **note** returns **500 "Internal error"** (unhandled Postgres `invalid byte sequence for encoding "UTF8": 0x00`). The transaction rolls back, so the flag stays set and no audit row is written (no integrity impact), but it is the same class as BUG-3 and the error is logged as an unhandled exception. Lone surrogates are scrubbed to U+FFFD and accepted; every other odd note (emoji, HTML, CRLF, ANSI, SQL) is stored safely. Admin-only, hence LOW. | As a logged-in admin: `curl -b unveil_admin=<tok> -H 'content-type: application/json' -d '{"note":"abc\u0000def"}' http://HOST/api/admin/sellers/<flagged-seller-id>/clear-flag` → 500. Fix: reject/scrub `\u0000` in `note` like `clean()` does for webhooks. (`pay3-note-edge.log`, `ADM-NOTE-1`) |
| NEW-3 | **LOW** | `audit_log` is append-only only by convention: the app DB role can `UPDATE`/`DELETE` rows (no trigger, unlike `ledger_entries`), and `admin_id` is `ON DELETE SET NULL`, so removing an admin row erases "who" from their audit rows. No API exposes edit/delete, so M5-14 "log not editable" is met at the API level only. Failed admin logins are not audited either. | `psql … -c "BEGIN; UPDATE audit_log SET action='x' WHERE id=(SELECT id FROM audit_log LIMIT 1); ROLLBACK;"` succeeds; `DELETE FROM admins WHERE id=…` → that admin's audit rows get `admin_id NULL`. Suggest an append-only trigger like `ledger_entries_no_update` and `ON DELETE RESTRICT`. (`ADM-AUDIT-1`) |
| INFO-1 | INFO | e2e `[#13]` login-delay check ("exactly 3 evaluated", saw 4) failed on **both** the first run and the single rerun (earlier rounds cleared on rerun). Not payments-related; flag to the owner of the login throttle in case it is no longer rare. | `npm run e2e` ×2 (`pay3-e2e*.log`) |
| INFO-2 | INFO / deployment | Per-IP limiters (`CRON` 30/min, `ADMIN_LOGIN_IP` 10/15 min, checkout, webhook) key on the client-supplied `X-Forwarded-For` when no proxy overwrites it: 60 requests with rotating XFF → 0×429. Per-email admin login delay still applies (guessing one account stays throttled). Same as round-1 M3-16 — deployment must set `TRUSTED_PROXY_HOPS`/overwrite XFF. | `for i in $(seq 60); do curl -H "X-Forwarded-For: 10.9.$i.1" -H 'Authorization: Bearer x' -X POST http://HOST/api/internal/cron/payments-janitor; done` → all 401 |
| INFO-3 | INFO | Origin check is host-only (scheme ignored) and absent-Origin requests pass (non-browser); admin CSP allows `script-src 'unsafe-inline'`. No exploitable path found (SameSite=Strict, escaping verified). | `ADM-CSRF-1`, `ADM-XSS-1` |
| INFO-4 | INFO | The `Idempotency-Key` is a bearer capability for its email: replay by another client with the same key+email returns the original session. Keys are random per page load and never exposed. Also one buyer in two browsers can end up with two payable sessions (documented trade-off). | `N1-4`, `N1-22` |
| INFO-5 | INFO | After a clear, 2 new chargebacks per review cycle never re-flag; a webhook for a superseded txn is booked at the charged (old) price. Both match PAYMENTS-NOTES. | `ADM-REFLAG-2`, `N1-18` |
| INFO-6 | INFO | Cannot independently positively test `retryParkedEvents()` applying work (sale path applies parked events atomically); relying on the repo's DB tests. | `JAN-14/15` |

No regressions in the earlier suite; NEW-1 (round 2 LOW) and INFO-1 (stale price) are closed.

## Remaining BLOCKED by owner
- **Backend/Admin:** admin refund (M5-05/06), suspend/ban seller (M5-09/10), settings editor with validation (M5-13, M3-07 via admin), payout request/approve/paid/failed routes and screens (M4-15/16, M5-12), admin audit-log viewer, admin user management (disable/enable, in-app password change, 2FA), flagged-*drop* review (M5-04), seller directory / full history (M5-11), append-only audit table (NEW-3).
- **Backend/Payments:** download/unlock delivery, receipt email and re-access (M3-02 redirect, M3-13, M3-14, M3-20, S2-02, S2-05); scheduling of the janitor (nothing in the repo triggers it: needs Vercel Cron / external pinger / box cron with `CRON_SECRET`).
- **Payments + business:** real processor sandbox — 3-D Secure (M3-04), live $1 charge (M3-08), hosted card fields (M3-19), CCBill/Segpay choice + fee docs (M3-17).
- **DevOps/Deployment:** proxy that overwrites `X-Forwarded-For` (INFO-2); `CRON_SECRET` provisioning.

## Cleanup
Servers started by this run (3717, 3718, 3720–3722, 3730 e2e, 3740–3749) stopped; no 37xx listeners remain. Throwaway DBs `unveil_qa_pay3`, `unveil_qa_pay3_up`, `unveil_e2e_qapay3` (and transient clones) dropped. No other DB/process touched.

## Appendix: all round-3 probe results (JSON under `qa/artifacts/pay3-*-results.json`)

### N1: NEW-1 fix (client-bound pending sessions, price supersede)
| ID | Result | Evidence |
|---|---|---|
| N1-1 | PASS | A=774b0904 B=a45733cb: B 201 reused:false, different txn/session/cookie; no A identifiers in B body |
| N1-2 | PASS | 200 reused:true; no Set-Cookie on reuse |
| N1-3 | PASS | same key+email → 200 same txn; same key + other email → 201 own txn; cookie issued |
| N1-4 | PASS | INFO: replay of same key by 2nd client returns 200 reused=true same txn=true (key is a bearer capability; the page's key is client-generated random UUID, never shown to other users) |
| N1-5 | PASS | truncated:201+ck tampered_last_char:201 tampered_first:201 upper:201 reversed:201 empty:201+ck short31:201+ck long65:201+ck zeros:201 sql:201+ck nul:201+ck percent:201+ck latin1:201+ck hash_of_token:201 b64pad:201+ck guess_seq:201 |
| N1-6 | PASS | extras ok (200 reused); duplicate-name cookies: first-wins (r2→other, r3→a) — only tokens the caller already holds; no escalation |
| N1-7 | PASS | per-(drop,email,client): A and B independent; each reuses own |
| N1-8 | PASS | ok |
| N1-9 | PASS | key(A)+cookie(B) → 200 txn=A's; same key other drop → 409 (no id leak) |
| N1-10 | PASS | unveil_buyer=<tok>; Path=/api/checkout; Expires=Fri, 02 Oct 2026 16:21:15 GMT; Max-Age=86400; Secure; HttpOnly; SameSite=lax \| Secure=true Cache-Control=no-store |
| N1-11 | PASS | 300 unique 43-char tokens; per-byte distinct values ≥166/256; bit-balance 0.499; DB has SHA-256 only |
| N1-12 | PASS | status identical with/without cookie; unknown id 404; /api/earnings 401 with buyer cookie. Keys: amountCents,message,retryable,status,transactionId |
| N1-13 | PASS | same-cookie ×20 → 1 txn (all 200); same-key ×20 → 1 txn (1×201); 20 anonymous clients → 20 independent pending (by design: no key/cookie ⇒ separate clients); 20 distinct keys → 0×5xx |
| N1-14 | PASS | ok |
| N1-15 | PASS | old 0e6e50b4 → failed/superseded; new 7ddbd039 at 9000 (201); hosted page for new session amount: pending in DB=9000 |
| N1-16 | PASS | ok |
| N1-17 | PASS | hosted pay of superseded session → failed/This checkout was replaced by a newer one. Please go back to the page and start again.; tx status=failed code=superseded ledger lines=0 (INFO: refused) |
| N1-18 | PASS | webhook 200 processed/; tx succeeded/null/null; amount=2000; ledger 3 lines sum 1560 |
| N1-19 | PASS | ok (A stays pending at old price until A returns; INFO) |
| N1-20 | PASS | unpublished → 404; 31 min → new 201 |
| N1-21 | PASS | unique index rejects duplicate (23505); 60 mixed concurrent: {"200":18,"201":42}, 0×5xx, 0 duplicate pendings |
| N1-22 | PASS | victim txn succeeded; other-client txn pending (still pending, payable separately: INFO — one real buyer using two browsers can double-pay) |

### N2: payments janitor
| ID | Result | Evidence |
|---|---|---|
| JAN-1 | PASS | 19 cases as expected; lowercase 'bearer' scheme → 401 (INFO; regex is case-sensitive "Bearer"); extra/trailing whitespace tolerated (200) |
| JAN-2 | PASS | 401 body={"error":"Unauthorized","code":"unauthorized"}; WWW-Authenticate=Bearer; X-Robots-Tag=noindex, nofollow; 200 Cache-Control=no-store; secret in 200 body? false |
| JAN-3 | PASS | PUT:405 DELETE:405 PATCH:405 HEAD:200 POST+foreign Origin+bearer:403; cookie-only GET with foreign Origin/Referer → 401 and no run; GET 200, POST 200. (Foreign Origin with correct bearer is blocked by api() same-origin guard on POST: 403) |
| JAN-4 | PASS | first={"expiredCheckouts":0,"voidRefundsRequested":0,"voidRefundsFailed":0,"voidRefundsGaveUp":0,"parkedEventsApplied":0,"parkedEventsFlaggedStale":0} repeat={"expiredCheckouts":0,"voidRefundsRequested":0,"voidRefundsFailed":0,"voidRefundsG |
| JAN-5 | PASS | first 429 at request #31; correct token while limited → 429 (Retry-After 60); other IP → 200 |
| JAN-6 | PASS | 60 requests each with a different single XFF value: 60×401, 0×429 (limiter evaded by header rotation — deployment must overwrite XFF at the proxy / TRUSTED_PROXY_HOPS; MEDIUM-LOW deployment note); 40 requests with constant right-most XFF en |
| JAN-7 | PASS | not in logs/audit_log/responses |
| JAN-8 | PASS | unset/empty: 5×POST+GET → 503; 31 chars: 5×POST+GET → 503; limiter before 503 check: 10×429 of 40; exactly 32 chars → 200 |
| JAN-9 | PASS | run1 expired=1; ttl=5 run expired>=1 (429); repeat=0 |
| JAN-10 | PASS | run1: attempts=1 failed=1 gaveUp=0 next=+5m \| run2: attempts=2 failed=1 gaveUp=0 next=+10m \| run3: attempts=3 failed=1 gaveUp=0 next=+20m \| run4: attempts=4 failed=1 gaveUp=0 next=+40m \| run5: attempts=5 failed=1 gaveUp=1 next=+80m \| r |
| JAN-11 | PASS | attempts stopped at 2; gaveUp=1 (standing condition; row stays refund_requested_at NULL until ops resets) |
| JAN-12 | PASS | 20 voided txns: all failed/invalid_at_capture, review_reason set, refund_requested_at set, 0 ledger; 8 concurrent janitor runs → 7 skipped (advisory lock), 1 executed; webhooks 200 ×30, target processed once |
| JAN-13 | PASS | 12 simultaneous: 1 executed / 11 skipped; lock freed; external holder → skipped; after disconnect → runs |
| JAN-14 | PASS | parked rows=2 → stale flagged=2 (2nd run flagged 0); late sale processed/ → tx charged_back, ledger 9 lines; parked remaining 0; janitor after apply changed nothing (applied=0) |
| JAN-15 | PASS | refund processed once (3→6 lines); janitor runs applied=0/0; seller balance unchanged |
| JAN-16 | PASS | busy run: {"expiredCheckouts":1,"voidRefundsRequested":0,"voidRefundsFailed":1,"voidRefundsGaveUp":0,"parkedEventsApplied":0,"parkedEventsFlaggedStale":0}; audit row +1 only on busy run; heartbeat runs +1 per run |
| JAN-17 | PASS | 20 races: 20 succeeded(3 lines) / 0 failed(0 lines); webhook-after-expiry within grace honoured |
| JAN-18 | PASS | all invariants hold over 1829 txns / 1645 ledger lines |
| JAN-19 | PASS | CLI ok: {"skipped":false,"counts":{"expiredCheckouts":0,"voidRefundsRequested":0,"voidRefundsFailed":0,"voidRefundsGaveUp":0,"parkedEventsApplied":0; bad credentials exit=1; stderr has no secrets |

### N3: admin foundation + re-flag
| ID | Result | Evidence |
|---|---|---|
| ADM-CLI-1 | PASS | created (email lowercased, bcrypt), duplicate → exit≠0 'already exists', reset revokes old session (401) & old pw 401 & new pw 200; audit: admin_created_cli,admin_login,admin_password_reset_cli,admin_login |
| ADM-CLI-2 | PASS | 6 bad emails, 6 weak passwords rejected (nothing created); argv password flag refused (exit 2); no TTY → refuses; valid creates |
| ADM-AUTHZ-1 | PASS | GET:401 GET:401 GET:401 POST:401 /admin:307 /admin/sellers/flagged:307 /admin/sellers/0000000:307; /api/admin/nonexistent → 404 |
| ADM-AUTHZ-2 | PASS | seller → 4 admin routes all 403; seller token in admin cookie → 401; admin token in seller cookie → 401/404; both cookies resolve per-principal |
| ADM-AUTHZ-3 | PASS | alg_none:401 raw_secret_admin_aud:401 derived_wrong_aud:401 derived_unknown_jti:401 derived_nonuuid_jti:401 derived_expired:401 tampered:401 revoked_session:401 seller_token:401 garbage:401 empty:401 sub_other_admin:401 \| control (QA knows |
| ADM-SESS-1 | PASS | fresh token per login; attacker-chosen cookie replaced; logout → replay 401 (server-side), other session unaffected; expires_at in past → 401; Max-Age=28800; logout twice/anonymous → 200/200 |
| ADM-SESS-2 | PASS | disable → both live sessions 401 within 716 ms of the UPDATE; disabled login 401 invalid_credentials; re-enable works; delete cascades sessions |
| ADM-LOGIN-1 | PASS | uniform 401 body "{"error":"Invalid email or password","code":"invalid_credentials"}" for unknown/wrong/disabled; no Set-Cookie; no body:400 array:400 missing pw:400 pw number:400 huge pw:400 email NUL:400 pw NUL:401 sqli:400 email obj:400  |
| ADM-LOGIN-2 | PASS | admin: 401,401,401,401,401,429,429,429,429,429,429,429 (Retry-After 1); correct pw during delay → 429; seller login with same email → 200; seller spam (7×429) leaves admin login 200 |
| ADM-LOGIN-3 | PASS | first 429 at attempt #11; valid creds from limited IP → 429; other IP → 200; 25 attempts each with fresh XFF → 25×401 (no cap: deployment must overwrite XFF) |
| ADM-LOGIN-4 | PASS | median unknown-email 327 ms vs known-email wrong pw 322 ms (first 4 wrong guesses are un-delayed; both bcrypt-bound; no enumeration signal) |
| ADM-COOKIE-1 | PASS | unveil_admin=<tok>; Path=/; Expires=Fri, 02 Oct 2026 00:33:10 GMT; Max-Age=28800; Secure; HttpOnly; SameSite=strict \| logout: unveil_admin=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=strict |
| ADM-NOINDEX-1 | PASS | login+flagged pages and APIs: noindex header (+meta), no-store; robots.txt Disallow:/admin; no /admin link on /, /u/<link>, sitemap |
| ADM-CSRF-1 | PASS | 9×3 foreign-origin/content-type combos → 403, flag intact; login & logout CSRF 403; INFO-a: Origin check compares host only, not scheme: Origin https://localhost:3717 vs http app → not blocked (200); INFO-b: request WITHOUT Origin and with  |
| ADM-FLAG-1 | PASS | list row keys=[chargebacks,displayName,email,flagReason,flaggedAt,id,refunds,totalSales,verificationStatus]; invalid notes/bodies/ids → 400/404, flag untouched; unflagged → 409; success 200 (reviewer = session admin despite body fields); 1  |
| ADM-FLAG-2 | PASS | 10 concurrent: 200,409,409,409,409,409,409,409,409,409; clear ‖ 4th chargeback: clear=200, cb=200, final flagged=false (either order is consistent: cleared last) |
| ADM-NOTE-1 | FAIL | NUL → 500 {"error":"Internal error"} |
| ADM-XSS-1 | PASS | payload escaped on /admin/sellers/flagged and /admin/sellers/<id>/transactions; browser: dialogs=0 window.__x=undefined injected <img src=x>=0; CSP header=default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inlin |
| ADM-DATA-1 | PASS | no sensitive field names/values in 3 JSON endpoints + 2 pages; emails present are seller/admin account emails only (32 foreign) |
| ADM-AUDIT-1 | PASS | actions: admin_created_cli:16(admin_id on 0) admin_login:25(admin_id on 19) admin_logout:5(admin_id on 5) admin_password_reset_cli:2(admin_id on 0) seller_flag_cleared:12(admin_id on 12); no audit read/write API (404/405); DB-level UPDATE A |
| ADM-ROUTES-1 | PASS | all 404/405: refunds:404/404 transactions/00000000-0000-0000-0000-000000000000/refund:404/404 sellers/00000000-0000-0000-0000-000000000000/suspend:404/404 sellers/00000000-0000-0000-0000-000000000000/ban:404/404 settings:404/404 payouts:404 |
| ADM-REFLAG-1 | PASS | new cb#1 flagged=false; new cb#2 flagged=false; new cb#3 flagged=true; reason="3 chargebacks within 90 days (threshold 3)"; audit rows for re-flag (non-clear): 2; matches PAYMENTS-NOTES ("count restarts; 3 new ones re-flag") |
| ADM-REFLAG-2 | PASS | 2 late cbs for pre-clear sales → flagged=false; refund → flagged=false; 3rd cb after clear (sale also after) → flagged=true; after clear2, 3 more cbs → flagged=true; 2 audit rows for 2 clears |
| ADM-REFLAG-3 | PASS | 6 concurrent new chargebacks → 200×6, flagged once (3 chargebacks within 90 days (threshold 3)); verification_status & drop unchanged by clear; flagged seller still purchasable |

### Browser: admin UI
| ID | Result | Evidence |
|---|---|---|
| ADM-UI-1 redirect | PASS | anonymous → http://localhost:3717/admin/login |
| ADM-UI-2 wrong pw | PASS | "Invalid email or password" |
| ADM-UI-3 login | PASS | landed on http://localhost:3717/admin/sellers/flagged |
| ADM-UI-4 meta | PASS | meta robots="noindex, nofollow, nocache" |
| ADM-UI-5 flagged card | PASS | QA adminui adminui+muprahyde6fa@example.test flagged 2026-10-01 16:36 UTC 3 chargebacks within 90 days (threshold 3) Sales: 3 · Chargebacks: 3 · Refunds: 0 · Verification: verified · View transactions |
| ADM-UI-6 review table | PASS | 89 review transactions rendered; refund-state cells: Refund requested (2026-10-01 16:23 UTC) \| Refund requested (2026-10-01 16:23 UTC) \| Refund requested (2026-10-01 16:23 UTC) \| Refund requested (2026-10-01 16:20 UTC) |
| ADM-UI-7 note validation | PASS | 1-char note blocked by HTML minLength: valid=false |
| ADM-UI-8 confirm dialog | PASS | "Mark this seller as reviewed and clear the flag? This is recorded in the audit log." |
| ADM-UI-9 cleared | PASS | seller card gone after clear (page reloaded) |
| ADM-UI-10 seller tx page | PASS | Unveil Admin Flagged sellers & review adm-ui-muprahyde6fa@example.test Sign out ← Flagged sellers Transactions: QA adminui adminui+muprahyde |
| ADM-UI-11 unknown seller | PASS | status page text: 404 This page could not be found. |
| ADM-UI-12 logout | PASS | after logout, direct URL → http://localhost:3717/admin/login |
| console | NOTE | Failed to load resource: the server responded with a status of 401 (Unauthorized) \| Failed to load resource: the server responded with a status of 404 (Not Found) |

### Browser: buyer UI
| ID | Result | Evidence |
|---|---|---|
| M3-18 (link page) | PASS | R2: "All sales are final. Because this is a digital product delivered immediately, purchases can't be refunded or exchanged once completed." visible=true, rendered above the Buy button (y 526 < 604) on 390px viewport |
| M3-15 UI | PASS | unticked 18+ box blocks submit (HTML required); server also 400 (API case AGE-1) |
| BUG-7 decline copy | PASS | R2 declined card message: "Your card was declined. Please try a different card." (friendly, no raw failure code: true) |
| M3-18 (hosted checkout) | PASS | R2 hosted page: "All sales are final. Because this is a digital product delivered immediately, purchases can't be refunded or exchanged once completed." |
| M3-03e UI retry (R2 by-design change) | PASS | R2: re-submitting a good card on the SAME declined session: "Payment succeeded (mock)." (was terminal in R1; now payable again) |
| M3-02 UI | PASS | fresh checkout with default 4242 card: "Payment succeeded (mock)." |
| M3-02 redirect | BLOCKED | No redirect to a download page after success: download/unlock delivery not built (documented known gap) |
| M3-20 / S2-02 | BLOCKED | link→paid (mock, mobile viewport, local, no typing delay) took 0.3s; link→checkout redirect 0.2s; cannot reach 'download' step (not built) |
| M3-19 UI | BLOCKED | mock page posts card to our own origin (3 requests to /api/dev/payments/pay); hosted-field requirement can only be assessed against a real processor |
| console | PASS | no console errors |

### Earlier suite re-run
| ID | Result | Evidence |
|---|---|---|
| M3-01 | PASS | 201 + hosted card page 200 (no cookies sent) |
| M3-02 | PASS | tx dc3a4138 succeeded/null |
| M3-03a | PASS | tx c08316f9 failed/card_declined |
| M3-03b | PASS | tx b2a3b110 failed/insufficient_funds |
| M3-03c | PASS | tx bd923b80 failed/expired_card |
| M3-03d | PASS | tx e55c9c16 failed/incorrect_cvc |
| CARD-x | PASS | tx 5d7a469e failed/unrecognized_test_card |
| CARD-y | PASS | tx 9ece279b failed/invalid_card_number |
| CARD-z | PASS | tx b6207c76 succeeded/null |
| M3-03e | PASS | second attempt on same session after decline → succeeded, 3 ledger lines (R2 assertion changed: was terminal) |
| M3-15 / AGE-1 | PASS | undefined:400 false:400 "true":400 1:400 null:400 "on":400 [true]:400 |
| M3-15 / AGE-2 | PASS | buyer_confirmed_18_at set; checkbox required |
| EMAIL-1 | PASS | "":400 " ":400 "plain":400 "a@":400 "@b.com":400 "a b@c.com":400 "a@b":400 "<script>@x.com":400 "a@b.com\r\nBcc: x:400 "xxxxxxxxxxxxxxxxx:400 \| valid → lowercased, trimmed |
| PRICE-1 | PASS | all tamper fields ignored → 2000/200/1560 pending |
| PRICE-2 | PASS | checkout amount 1500 (DB price); note: no PATCH /api/drops/:id on this branch |
| DROP-1 | PASS | draft/dropId:404 unpublished/linkId:404 unpublished/dropId:404 flagged/linkId:404 flagged/dropId:404 malformed:400 unknown:404 both-ids:400 unverified-seller:409 |
| DROP-2 | PASS | payment on a now-unpublished drop's pending session → failed (note: money captured for an unlistable drop; no download delivery exists to honor it) |
| DROP-3 | PASS | status failed (flagged drop can still be paid from an earlier session - NOTE) |
| DUP-1 | PASS |  |
| DUP-2 | PASS | same tx |
| DUP-3 | PASS | one charge; webhook outcomes [{"outcome":"duplicate","count":"1"},{"outcome":"processed","count":"1"}] |
| DUP-4 | PASS | succeeded/3 succeeded/3 succeeded/3 succeeded/3 succeeded/3 succeeded/3 |
| M3-19 / PAN-1 | PASS | pg_dump (1679 KiB) and app logs contain no PAN; only payload hashes/fixed fields stored in webhook_events |
| M3-19 / PAN-2 | PASS | mock page → same-origin /api/dev/payments/pay with card in body (dev-only, 404 in prod); acceptable for mock, M3-19 for real processor BLOCKED until Segpay/CCBill |
| PAN-3 | PASS | 740 webhook_events rows scanned, 0 card-like numbers (long digit runs seen were uuid/hex fragments and a 1e12 amount) |
| M3-16 / RL-1 | PASS | codes 201,200,200,200,200,200,200,200,200,200,429,429,429, Retry-After 60, other IP 201 |
| RL-2 invalid requests count | PASS | 400,400,400,400,400,400,400,400,400,400,429,429 |
| RL-3 XFF spoof (note) | PASS | rotating single XFF: 201,201,201,201,201,201,201,201,201,201,201,201,201,201,201 (no 429 → trivially bypassable when app is NOT behind a proxy that overwrites XFF); prepended spoof with fixed right-most: 201,201,201,201,201,201,201,201,201, |
| AUTHZ-1 | PASS | A total 1560, B total 2340; sellerId param ignored; no emails |
| AUTHZ-2 | PASS | ok |
| SEC-3 checkout injection | PASS | 400 400 400 201 201 nonjson:400 text/plain:201 |
| SEC-4 CSRF/origin | PASS | 403 |
| M3-06/MONEY-1 | PASS | 698614 (amount, rate) cases, 0 mismatches vs reference, 0 negative, 0 non-integer |
| M3-05/MONEY-2 | PASS | 99→77/10/12 999→779/100/120 1999→1559/200/240 49999→38999/5000/6000 100→78/10/12 50000→39000/5000/6000 |
| MONEY-3 | PASS | half-up verified on both fees; seller absorbs remainder |
| MONEY-4 | PASS | 6000 random sequences exact; 999×1¢ refunds reverse exactly net 779 |
| MONEY-5 | PASS | rejects floats/negatives/NaN/inf/unsafe and malformed percents |
| M3-05/M3-06 e2e | PASS | 13 prices OK (net/plat/proc): 100:78/10/12 101:79/10/12 199:155/20/24 999:779/100/120 1000:780/100/120 1999:1559/200/240 2000:1560/200/240 3333:2600/333/400 4999:3899/500/600 12345:9629/1235/1481 49999:38999/5000/6000 50000:39000/5000/6000  |
| M3-06 bounds | PASS | 99→400, 50001→400, 999.5→400, -5→400 |
| M3-07/S2-03 | PASS | pending tx snapshot 200/240/1560 stays after settings change & settles at 1560; new tx @15%/3% = 300/60/1640 |
| MONEY-6 | PASS | 101 rejected, -1 rejected, proc 100.5 rejected |
| MONEY-7 | PASS | 999¢ @100%/12% → net 0 plat 879 proc 120 |
| MONEY-8 | PASS | ledger_entries.amount_cents:integer, payouts.amount_cents:integer, transactions.amount_cents:integer, transactions.platform_fee_cents:integer, transactions.processing_fee_cents:integer, transactions.reversed_cents:integer, transactions.sell |
| M3-09 / HOLD-1 | PASS | pending 1560 available 0; hold 7.000d |
| M4-13 | PASS | 2499→below_minimum_payout, 0→nothing_available, -100→nothing_available, 25.5→nothing_available; exactly 2500 accepted |
| M4-13b | PASS | below_minimum_payout |
| M4-14 | PASS | over-request insufficient_available_balance; default payout 3900 (available only); pending 3900 untouched |
| M4-14b | PASS | 0 available / 3900 pending |
| M4-14c | PASS | observed: payable immediately with hold_days=0; per-sale hold only (no distinct first-payout rule) — NOTE |
| M4-15a | PASS | balance 7800→2800; statuses requested→approved→paid; illegal transitions → bad_payout_state; earnings.paidOutCents 5000. NOTE: no HTTP route to request/approve payout (service functions only) |
| M4-16 | PASS | reserve 3000 → fail → 3900 restored; approved→failed also restored; admin-visible via payouts.failure_reason (NOTE: no admin UI/route) |
| PAYOUT-CONC-1 | PASS | 1 ok / 7 rejected (OK,insufficient_available_balance); available 900 |
| PAYOUT-CONC-2 | PASS | OK,nothing_available |
| PAYOUT-CONC-3 | PASS | payout:OK refund:processed sale:sold final available 0 total 0 (negative allowed only via refund after payout) |
| PAYOUT-INV-1 | PASS | 19 sellers reconcile; UPDATE blocked, DELETE blocked, TRUNCATE blocked |
| M4-09 | PASS | NOTE fees in summary are NET of fee shares returned on refunds (reported 1430 vs 2640 on transactions rows); identity gross−refunds−chargebacks−fees==balance holds. gross 11997, refunded 500, chargebacks 4999, balance 5068 |
| PROD-1 (M3 / mock disabled) | PASS | {"checkout":503,"webhook":503,"pay":404,"page":404} |
| PROD-2 | PASS | {"checkout":503,"webhook":503,"pay":404,"page":404} |
| PROD-3 | PASS | http://localhost.evil.com:ok http://localhost@evil.com:ok http://127.0.0.1.evil.com:ok http://evil.com/localhost:ok |
| PROD-4 (config residual risk) | PASS | exception works (201) — only when both flag and loopback APP_URL are set |
| PROD-5 missing/short secret fails closed | PASS | 31ch:503/503 0ch:503/503 5ch:503/503 |
| PROD-6 unknown PAYMENT_PROVIDER | PASS | 503 payments_unavailable |
| PROD-7 test card in prod | PASS | tx remained pending across all prod-mode probes |
| PROD-8 non-'production' NODE_ENV | PASS | NODE_ENV=staging → mockPaymentsAllowed=false (R2: default-deny; was true in round 1) |
| BUG-1a | PASS | 1×201 + 11×200 reused; 1 row; same session mocksess_43b7d… |
| BUG-1b | PASS | 1 txn |
| BUG-1c | PASS | 201 then 200 reused |
| BUG-1d | PASS | 409 + same txn for dropId variant |
| BUG-1e | PASS | 3 distinct txns/sessions |
| BUG-1f | PASS | 128:201 129:400 "has space":400 "tab\there":400 "ünï":400 sqli:201 blank:201 |
| BUG-1g | PASS | new after paid: 201; keyed replay after paid: 200 status=succeeded same=true (returns paid session URL; pay endpoint on it is idempotent) |
| BUG-1h | PASS | new txn, old failed/session_expired, key released |
| BUG-1i | PASS | isolated per (drop,email) |
| BUG-1j | PASS | R3 by-design change (was INFO-1): same buyer after price change → old txn failed/superseded, new txn amount=5000; new buyer 5000; settled at 5000 (succeeded) |
| BUG-1k | PASS | R3 NEW-1 FIXED: second client got 201 reused:false with its OWN session (bd4071e62b3b ≠ victim's); control same shape |
| BUG-1l | PASS | 60 reqs: 50 ok, 10 409 (key reused across drops – expected), 0×5xx, 0 duplicate pendings |
| BUG-1m | PASS | 100 reqs in 374 ms, 1 txn |
| BUG-1n | PASS | one charge, 3 lines |
| BUG-2a | PASS | rejected → processed; ledger 1560 |
| BUG-2b | PASS | ignored → processed |
| BUG-2c | PASS | ok |
| BUG-2d | PASS | pddddddd |
| BUG-2e | PASS | ok |
| BUG-2f | PASS | 1+11 |
| BUG-2g | PASS | 50 rejected events → 50 log rows, ledger unchanged (rejected rows are stored once each; no dedupe → log growth only possible with valid signatures) |
| BUG-3a | PASS | reference:400 event id:400 transaction_id:400 related_transaction_id:400 failure_code:400 currency:400; 6 rejected rows; legit sale afterwards processed |
| BUG-3b | PASS | surrogate:400 513ch:400 emoji/long-valid:200/duplicate |
| BUG-3c | PASS | 60×400 then 429 |
| BUG-4a | PASS | details -,-,seller_flagged_for_review,-; reason="3 chargebacks within 90 days (threshold 3)"; 1 audit row; still verified & purchasable (no auto-ban) |
| BUG-4b | PASS | replay×3 + dup cb on same tx + 3 refunds + 1 more distinct cb = 2 distinct → not flagged |
| BUG-4c | PASS | 91 d: flagged=false; 89 d: flagged=true (seller_flagged_for_review) [ledger created_at backdated in throwaway DB with append-only trigger temporarily disabled] |
| BUG-4d | PASS | processed,processed,processed,seller_flagged_for_review |
| BUG-4e | PASS | 18 concurrent, 6 flagged |
| BUG-4f | PASS | parked×3 → flagged; threshold=1 + partial cb → flagged (seller_flagged_for_review) |
| BUG-4g | PASS | chargeback_flag_threshold=0 rejected, chargeback_flag_window_days=0 rejected, chargeback_flag_window_days=4000 rejected, checkout_session_ttl_minutes=0 rejected, checkout_late_success_grace_minutes=-1 rejected |
| BUG-6a | PASS | failed/unavailable; msg="This item is no longer available for purchase. You have not been charged." |
| BUG-6b-unpublished | PASS | failed/unavailable |
| BUG-6b-flagged | PASS | failed/unavailable |
| BUG-6b-draft | PASS | failed/unavailable |
| BUG-6c | PASS | failed; status API msg="This checkout has expired. Please go back to the page and start again." retryable=false |
| BUG-6d | PASS | 29 min succeeded; 31 min refused |
| BUG-6e | PASS | 55 s: succeeded; 63 s: failed/session_expired |
| BUG-6f | PASS | swept 2 |
| VOID-1 | PASS | voided:seller_not_verified; refund_requested_at set; ledger 0; balance unchanged; buyer msg="This purchase could not be completed. If you were charged, the payment is being refunded." |
| VOID-2-unpublished | PASS | voided:drop_unavailable |
| VOID-2-flagged | PASS | voided:drop_unavailable |
| VOID-3 | PASS | 25 h old → voided (voided:session_expired); expired 60 min ago, paid within grace → honoured (late-success policy) |
| VOID-4 | PASS | replay=duplicate; new-evt=duplicate/undefined; fail-after-void=ignored/voided; refund hook=void_refund_confirmed; chargeback on voided=processed/void_refund_confirmed |
| VOID-5 | PASS | pddddddddd |
| VOID-6 | PASS | retry hook requested [object Object]; second run 0 (this tx not repeated: true) |
| VOID-7 | PASS | 14 voided txns, 0 awaiting refund retry (should be 1 from VOID-6 reset? 0); none have ledger |
| VOID-8 | PASS | earnings.recent excludes failed? failed in recent=15; balance 6240 == ledger |
| VOID-9 | PASS | 254 settled txns satisfy gross == net+platform+processing |
| VOID-10 | PASS | 20 boundary races: 20 succeeded(3 lines), 0 expired(0 lines), 0 inconsistent |
| BUG-7a | PASS | card_declined:"Your card was declined. Please t…"→retry ok \| insufficient_funds:"Your card has insufficient funds…"→retry ok \| expired_card:"Your card has expired. Please tr…"→retry ok \| incorrect_cvc:"The security code you entered is…"→ |
| BUG-7b | PASS | 3 declines + success: ledger 3 lines; processed events 4; later decline ignored |
| BUG-7c | PASS | expired: "This checkout has expired. Please go back to the page and start again."; pay→failed |
| BUG-7d | PASS | sales-final present on both; no raw codes in HTML |
| INV-1 | PASS | all hold (1576 txns, 1282 ledger lines) |
| BUG-8-01 | PASS | mockPaymentsAllowed=false |
| BUG-8-02 | PASS | mockPaymentsAllowed=true |
| BUG-8-03 | PASS | mockPaymentsAllowed=false |
| BUG-8-04 | PASS | mockPaymentsAllowed=false |
| BUG-8-05 | PASS | mockPaymentsAllowed=false |
| BUG-8-06 | PASS | mockPaymentsAllowed=true |
| BUG-8-07 | PASS | mockPaymentsAllowed=false |
| BUG-8-08 | PASS | mockPaymentsAllowed=false |
| BUG-8-09 | PASS | mockPaymentsAllowed=false |
| BUG-8-10 | PASS | mockPaymentsAllowed=false |
| BUG-8-11 | PASS | mockPaymentsAllowed=false |
| BUG-8-12 | PASS | mockPaymentsAllowed=false |
| BUG-8-13 | PASS | mockPaymentsAllowed=false |
| BUG-8-14 | PASS | mockPaymentsAllowed=true |
| BUG-8-15 | PASS | mockPaymentsAllowed=true |
| BUG-8-16 | PASS | mockPaymentsAllowed=false |
| BUG-8-17 | PASS | mockPaymentsAllowed=false |
| BUG-8-18 | PASS | mockPaymentsAllowed=false |
| BUG-8-19 | PASS | mockPaymentsAllowed=false |
| BUG-8-20 | PASS | mockPaymentsAllowed=true |
| BUG-8-21 | PASS | mockPaymentsAllowed=true |
| BUG-8-22 | PASS | mockPaymentsAllowed=false |
| BUG-8-23 | PASS | mockPaymentsAllowed=false |
| BUG-8-24 | PASS | mockPaymentsAllowed=false |
| BUG-8-25 | PASS | mockPaymentsAllowed=false |
| BUG-8-26 | PASS | mockPaymentsAllowed=false |
| BUG-8-27 | PASS | mockPaymentsAllowed=false |
| BUG-8-28 | PASS | mockPaymentsAllowed=false |
| BUG-8-29 | PASS | mockPaymentsAllowed=false (informational) |
| BUG-8-30 | PASS | mockPaymentsAllowed=true (informational) |
| BUG-8-31 | PASS | mockPaymentsAllowed=false (informational) |
| BUG-8-32 | PASS | mockPaymentsAllowed=true (informational) |
| BUG-8-33 | PASS | mockPaymentsAllowed=false |
| BUG-8-34 | PASS | mockPaymentsAllowed=false (informational) |
| REUSE-1 | PASS | unpublished:404 flagged:404 seller-failed:409 |
| REUSE-2 | PASS | 31 min → new 201 (old session_expired); 29 min → reused 200 (hands buyer a URL with ~1 min left; INFO) |
| REUSE-3 | PASS | lower:200/true padded+upper:200/true |
| REUSE-4 | PASS | R3 (INFO-1 fixed): same buyer reuse=false amount=2000 (old price, drop now 9000); other buyer 9000. Buyer page shows new price on /u/<link> while hosted page charges 2000. |
| REUSE-5 | PASS | R3: NEW-1 FIXED — attacker with victim email + link id gets 201 reused:false and an independent session (eb0f6c922f29 ≠ victim's) |
| REUSE-6 | PASS | paid txn never reused; new checkout creates new txn (repeat purchase allowed by design?) |
| LEAK-1 | PASS | status keys=amountCents,message,retryable,status,transactionId; earnings clean |
| LEAK-2 | PASS | 404,404,404,404,404,404 |
| IDEM-9 | PASS | "":201 " ":201 "a":201 "AAAAAAA:201 "AAAAAAA:400 "k\u0000:client-reject "k\r\nX::client-reject "ключ":client-reject "%00":201 "../../e:201 "{{7*7}}:201 "null":201 "undefin:201 "0":201 |
| IDEM-10 | PASS | first 201; over18=false same key 400 invalid_input; tampered amount same key 200/amount 2500 |
| RACE-1 | PASS | 15/15 consistent (sale,refund outcomes: pp pp pp pp pp pp pp pp pp pp pp pp pp pp pp) |
| RACE-2 | PASS | always succeeded/3 lines (success after failure accepted; failure after success ignored) |
| RACE-3 | PASS | duplicate via (provider, processor tx id, type) key |
| RACE-4 | PASS | first processed, second (different amount, same refund id) duplicate; reversed 500 — by design dedupe key; NOTE only |
| LOG-1 | PASS | no secrets in logs; 0 distinct error-ish lines:  |
| M5-05 / REF-1 | PASS | refunded; ledger 0; extra 1¢ → rejected/over_refund |
| M5-06 / REF-2 | PASS | 500:succeeded/1170 750:succeeded/585 750:refunded/0 |
| REF-3 | PASS | rejected/over_refund |
| REF-4 | PASS | ledger remaining 390 |
| REF-5 | PASS | over → rejected; null → remaining 1500 refunded |
| REF-6 | PASS | pending:parked/sale_not_seen_yet failed:ignored/reversal_of_failed_sale failed-cb:ignored |
| REF-7 | PASS | refund 800 + chargeback remaining 1200 = 2000, ledger 0; extra cb rejected |
| REF-8 | PASS | rejected/over_refund |
| REF-9 concurrency | PASS | 4 processed / 6 rejected; reversed 2000 |
| REF-10 concurrency | PASS | 6 processed; ledger 156 |
| REF-11 concurrency | PASS | reversed 2000, status charged_back, ledger 0 |
| M5-07 / REF-12 | PASS | after refund available=-3900 (negative allowed); after new sale 0; payout while 0<available<min → nothing_available |
| M5-08 / CB-1 | PASS | details processed,processed,seller_flagged_for_review; reason="3 chargebacks within 90 days (threshold 3)"; audit rows 1; still verified |
| CB-2 | PASS | ledger -1500 (chargeback fee), net reversal 0 |
| REF-13 API | PASS | request refund 500→200, 5000→400 over_refund, pending→409 not_refundable |
| REF-14 invariants | PASS | 37 settled txs checked (36 exact), no violations |
| M3-12 retry | PASS | 400 → no claim, no ledger; error rows logged=0; retry processed |
| M6-08 queue | PASS | parked row visible; applied automatically when the sale lands (OOO-1..4); no cron for stragglers whose sale never arrives (NOTE) |
| SESS-1 | PASS | expired |
| SESS-2 | PASS | blocked |
| SESS-3 | PASS | none |
| M3-11 / IDEM-1 | PASS | outcomes processed,duplicate,duplicate; ledger lines 3, sum 1560 |
| IDEM-2 | PASS | 1 processed + 11 duplicate (all 200); seller ledger delta 1560 |
| IDEM-3 | PASS | 200:processed 200:ignored 200:ignored 200:ignored 200:ignored 200:ignored 200:ignored 200:ignored 200:ignored 200:ignored 200:ignored 200:ignored |
| IDEM-4 | PASS | second sale new evt: duplicate/undefined; new evt+new saleId: ignored/sale_succeeded_but_succeeded; fail-after-success: ignored/sale_failed_but_succeeded; refund reusing a sale's event id: duplicate/undefined (state succeeded/0/mocktx_2358e |
| IDEM-5 | PASS | mismatch→rejected/amount_mismatch; tx pending, no ledger |
| IDEM-5b | PASS | processed |
| IDEM-5c | PASS | EUR→amount_mismatch |
| IDEM-5d | PASS | early ignored; legit processed |
| M3-10 / SIG-1 | PASS | 401 invalid_signature |
| M3-10 / SIG-2 | PASS | 401 invalid_signature |
| M3-10 / SIG-3 | PASS | 401 invalid_signature |
| M3-10 / SIG-4 | PASS | 401 invalid_signature |
| M3-10 / SIG-5 | PASS | 401 invalid_signature |
| M3-10 / SIG-6 | PASS | 401 invalid_signature |
| M3-10 / SIG-7 | PASS | 401 invalid_signature |
| M3-10 / SIG-8 | PASS | 401 invalid_signature |
| M3-10 / SIG-9 | PASS | 401 invalid_signature |
| M3-10 / SIG-10 | PASS | 401 invalid_signature |
| M3-10 / SIG-11 | PASS | 401 invalid_signature |
| M3-10 / SIG-12 | PASS | 401 invalid_signature |
| M3-10 / SIG-13 | PASS | 401 invalid_signature |
| M3-10 / SIG-14 | PASS | 401 invalid_signature |
| M3-10 / SIG-15 | PASS | 401 invalid_signature |
| M3-10 / SIG-16 | PASS | 401 invalid_signature |
| M3-10 / SIG-17 | PASS | 401 invalid_signature |
| M3-10 / SIG-18 | PASS | text/plain→200/processed (tx now succeeded; body is HMAC-verified JSON so content-type is not security relevant) |
| SIG-19 | PASS | replay of byte-identical signed request inside window → duplicate |
| SIG-20 | PASS | 401 |
| SIG-21 | PASS | both 200 |
| SIG-22 | PASS | stripe:404 paypal:404 __proto__:404 constructor:404 toString:404 MOCK:404 mock%20:404 ..%2fmock:404 segpay:404 ccbill:404 |
| SIG-23 | PASS | signature.ts uses timingSafeEqual on 32-byte buffers; non-hex candidate compares against zero buffer |
| SIG-24 | PASS | POST 413, GET 405 |
| SIG-25 | PASS | 60×401 then 10×429; max stored rejected payload 247 bytes |
| SIG-26 | PASS | amount float:400 amount negative:400 amount string:400 amount huge:400 type unknown:400 no data:400 currency 4 chars:400 badjson:400 array:400 |
| SEC-1 injection | PASS | ref(' OR '1'='1):200/ignored ref('; DROP TABL):200/ignored ref(00000000-000):200/ignored ref(${{7*7}}):200/ignored ref(11f09390-96f):200/ignored ref(\):200/ignored ref(é😀):200/ignored; tx still succeeded, failure_code=null |
| SEC-1b NUL byte | PASS | reference:400 event id:400 failure_code:400 |
| SEC-2 mass-assign | PASS | 200 processed; split unchanged 1560/200 |
| OOO-5b | PASS | parked then applied via processor id match; refunded |
| M3-12 / OOO-1 | PASS | parked→applied: [{"outcome":"processed","outcome_detail":"applied_after_sale"}] |
| OOO-2 | PASS | charged_back, ledger 0 |
| OOO-3 | PASS | final succeeded reversed=1200 ledgerSum=624; events ["500:processed/applied_after_sale","700:processed/applied_after_sale","1000:rejected/over_refund"] |
| OOO-4 | PASS | reversed 1500, status succeeded, events [{"outcome":"processed","outcome_detail":"applied_after_sale"},{"outcome":"rejected","outcome_detail":"over_refund"}] |
| OOO-5 | PASS | unknown ref: ignored/unknown_transaction; non-uuid ref: ignored/unknown_transaction |
| OOO-6 | PASS | failed(processed) → succeeded; ledger 3 lines |
| S2-05 audit | PASS | 804520f2:refunded wh=2 ledger=6; c5c2ffae:succeeded wh=4 ledger=9; f7d93984:succeeded wh=1 ledger=3 (no receipt record exists: receipt email not built) |

