# Unveil QA results — `payments/audit-hardening`, run 1 (NEW-2 input sanitizer, NEW-3 append-only audit log, migration 011)

- **Date:** 2026-10-01 ~14:10–16:00 ET
- **Branch tested:** `origin/payments/audit-hardening` @ **`94b485d28a752e1372699d0c6ad67d254425e74d`** (11 commits on top of main).
- **main:** `origin/main` @ **`3e75de74dec81fc73695929b23e37ccd126d7d08`** (merge of PR #3). It already contains `payments/followups` (5716360); merge-base(main, branch) == main, so the branch is a straight descendant.
- **Money-file claim verified TRUE:** `git diff origin/main origin/payments/audit-hardening -- src/server/payments/{money,pricing,ledger,payouts}.ts` is **empty** (0 lines). Branch diff is 19 files: migration 011, `src/server/admin/audit.ts`, `src/server/input.ts` (new), admin/auth/CLI/route edits, tests, PAYMENTS-NOTES.md.
- **Env:** clean detached worktree `/workspace/qa-pay4`; Node 20.19.2, PostgreSQL 17. Throwaway DBs `unveil_qa_pay4` (main), `unveil_qa_pay4_up` (migration), `unveil_qa_pay4_audit` (on a *separate temp PG cluster*, port 5898, roles `qaowner`/`qa_app` for the non-owner-role tests), `unveil_e2e_qapay4` (e2e). Servers: 3817 (NODE_ENV=production + mock, limiters raised), 3818 (default limits), 3819 (runs as non-owner role `qa_app`), 3820 (default webhook-rejected limiter), 3840–3849 (production-matrix). App source not modified; nothing pushed to main or the branch.
- **Re-run:** `qa/scripts/qa-pay4-servers.sh start|stop` (3817/3818), `qa-pay4-servers2.sh start|stop` (3819/3820), `qa/scripts/qa-pay4-run.sh <script.ts> <log>` (sets `QA_BASE_URL`), `. qa/scripts/qa-pay4-env.sh` for env; migration: `qa/scripts/qa-pay4-mig.sh`. Scripts refuse to run unless `DATABASE_URL` is a `unveil_qa_pay*` DB.
- **New probe scripts:** `qa-pay4-six.ts` (the six former 500s), `qa-pay4-fuzz.ts` (3,966-request route fuzz), `qa-pay4-audit.ts` (AUD-1…14), `qa-pay4-roles.ts` (non-owner role), `qa-pay4-flood.ts` (HTTP flood), `qa-pay4-resetrace.ts`/`resetrace2.ts` (NEW-4), `qa-pay4-sellerconc.ts` (NEW-5), `qa-pay4-hugecl.ts`, `qa-pay4-mig.sh`, plus the whole earlier suite re-pointed to 38xx.

## Headline
- **NEW-2: FIXED.** All 7 originally-failing inputs (NUL note + the six other 500s) now give 400/404, no state change, no audit row. A full-route fuzz (3,966 requests) found **no 5xx from application code** and **0 state changes on any 4xx**. One framework-level 5xx class remains (malformed `%` in a dynamic path segment → 500; **pre-existing, LOW, NEW-6**).
- **NEW-3: FIXED for a non-owner, non-superuser app role** (immutability, FK RESTRICT, email snapshot, uniform 401 + audited failed logins, bounded flood). Two caveats: (a) **NEW-4 (MEDIUM)** — `--reset-password` can be raced by an in-flight login with the old password, leaving a live session after the revoke; (b) the documented/README default makes the app role the **table owner**, and an owner can disable the triggers — the deployment must use a non-owner role.
- **Migration 011: PASS** (upgrade with existing audit rows/admins, idempotent, atomic rollback, 4 concurrent runners).
- **Regression: clean** (~299 earlier-suite probes PASS after 3 documented assertion changes; PAN/CVC grep 0 hits).
- **New bugs:** NEW-4 MEDIUM, NEW-5 LOW (pre-existing; 500 on concurrent valid logins), NEW-6 LOW (pre-existing; malformed %-path 500), plus INFO items.
- Totals: **plan cases PASS 19 / FAIL 0 / PARTIAL 2 / BLOCKED 18 (39 rows; M5-11 and M5-14 remain PARTIAL)**. Audit probes: 16 PASS / 1 FAIL (AUD-11b = NEW-4). Baseline: typecheck/lint clean, `npm test` 198/198 (117 DB-backed), `npm run e2e` 79/79 in 2 of 5 runs; otherwise only `[#13]`.

## Baseline suite (94b485d)
| Check | Expected | Result |
|---|---|---|
| `npm ci` | clean | OK, 0 vulnerabilities |
| `npm run migrate` | 001–011 | **applied 001–011** |
| typecheck (after `next typegen`) | clean | **clean** |
| lint | clean | **0 errors / 0 warnings** |
| `npm test` | 198 (117 DB-backed) | **198/198** (11 files); DB-backed 117 pass (`pay4-npm-test.log`) |
| `npm run e2e` | 79 | five runs: **79, 78, 78, 79, 78** (`pay4-e2e-run1..5.log`). Runs 2 and 4 fully green. Runs 1, 3, 5 fail only `[#13]` "correct password DURING the delay is also refused" — got **200** instead of 429 (R3's flake said "saw 4"; different symptom, same check). **Flake rate: 2/3 over the requested first three runs (run 1 fail, run 2 pass, run 3 fail), 3/5 over all five.** Unrelated to the branch's audit/input code (login delay timing); it reproduced in R3 as well. |

## Item verdicts

### 1. NEW-2 — sanitizer (`src/server/input.ts`): **FIXED** (`qa-pay4-six.ts` 9/9, `qa-pay4-fuzz.ts`)
| Former 500 | Now |
|---|---|
| NUL in clear-flag `note` | **400 `invalid_input`**; flag untouched; no audit row |
| 36-dash uuid-shaped id on clear-flag | 404 |
| 36-dash id on `/admin/sellers/:id/transactions` page | 404 |
| 36-dash id on checkout status | 404 |
| 36-dash id on file preview | 404 |
| NUL in dev-pay `sessionId` | 400 |
| NUL in signup `displayName` | 400 |
- 9 more note variants (lone surrogate, 501 chars, 1 char, whitespace, array, object, null, number, boolean) → all 400. 108 sibling uuid-lookalike requests over 12 uuid-consuming paths → {400: 9, 403: 9, 404: 90}, no 5xx.
- **Systematic fuzz** — every `src/app/api/**/route.ts`, page routes with params, admin routes; NUL, lone surrogates, >512 / oversize strings, 36-dash ids, arrays/objects/numbers/null/booleans per field, deep nesting, invalid JSON, wrong content-types, homoglyph/fullwidth/NFC-NFD emails, 1–1000s-char emails/passwords, emoji, odd cookies/Origin/Authorization/Idempotency-Key/XFF headers, multipart uploads, raw-socket abuse: **3,966 requests, 0 application 5xx, 0 state changes on 4xx** (row counts and md5 of sellers/drops/transactions + audit count snapshotted around each group); server alive afterwards. 2xx on odd-but-valid input (emoji titles, odd display names, sanitised upload filenames) reviewed: legitimate.
- **Body size:** webhook bodies >256 KB → 413; upload with huge Content-Length → 413 (`pay4-hugecl.log`). **JSON bodies have no size cap** — 3 MB and 60 MB bodies are parsed and rejected 400 (not 413). INFO (memory-DoS surface; put a body limit at the proxy).
- **Remaining 5xx — framework level, not a regression (NEW-6, LOW):** malformed percent-encoding in a dynamic path segment (`%zz`, `%`, `%ff`, `%c0%af`, `%ed%a0%80`) returns **500 text/plain** on 14 dynamic routes (`/u/:linkId`, `/pay/mock/:id`, `/dashboard/drops/:id`, `/admin/sellers/:id/transactions`, `/api/public/drops/:linkId`, `/api/drops/:id` (+publish/unpublish/files), `/api/files/:id/{original,preview,signed-url}`, `/api/webhooks/:provider`, `/api/admin/sellers/:id/clear-flag`). No state change, no app log line. Reproduces on the R3 build. Static paths with bad `%` → 404. `TRACE` → 500 (Next: method unsupported), INFO.

### 2. NEW-3 — append-only audit log: **FIXED (non-owner role)** (`qa-pay4-audit.ts`, `qa-pay4-roles.ts`, `qa-pay4-flood.ts`)
| Probe | Result |
|---|---|
| AUD-1a mutation paths on `audit_log` (UPDATE, DELETE, TRUNCATE, TRUNCATE…CASCADE, TRUNCATE `admins` CASCADE, MERGE update/delete, INSERT…ON CONFLICT DO UPDATE, UPDATE via CTE/FROM, …) | **PASS — 16 paths refused**, table md5 unchanged |
| AUD-1b same, as the **table owner** (README default role `unveil`) | **INFO**: `DISABLE TRIGGER`, `DROP TRIGGER`, replacing the trigger function, INHERITS-child trick, `DROP/RENAME TABLE` all succeed for the owner (rolled back in probe). `session_replication_role` and `COPY … PROGRAM` are denied (superuser-only). |
| ROLE-1..3 as a **non-owner, non-superuser** `qa_app` role (server 3819) | **PASS — 18/18 bypass attempts denied** (UPDATE/DELETE/TRUNCATE/CASCADE, DISABLE/DROP TRIGGER, replace function, ALTER/DROP/RENAME table, INHERITS, `session_replication_role`, COPY PROGRAM, ALTER OWNER, ALTER ROLE SUPERUSER; self-GRANT TRUNCATE is a no-op). The full admin flow (create-admin, reset, login, failed login, clear-flag, logout, janitor) works as `qa_app`. **Deployment requirement: the app role must not own the tables and must not be superuser; the docs' default does the opposite.** The Docker image's `POSTGRES_USER` is a superuser by convention (not tested). |
| AUD-2 `admin_id` FK `ON DELETE RESTRICT`; delete admin with history | **PASS** — refused for an actor, for a CLI-row-subject-only admin, for `DELETE FROM admins` (all) and for a disabled admin; admin with no history deletable; orphan inserts refused; 25 delete-vs-audit-insert races → 0 orphans |
| AUD-3 `admin_email` snapshot | **PASS** — survives email rename (old rows keep old email, new rows new), trigger fills raw inserts, 0 actor rows without email; system rows (janitor, chargeback flag, flood marker) NULL by design. INFO: a plain-SQL email rename is not itself audited (disable/enable is). |
| AUD-4 failed-login uniformity | **PASS** — unknown / wrong-password / disabled / disabled+wrong-pw → byte-identical 401 `{"error":"Invalid email or password","code":"invalid_credentials"}` with 13 identical headers; 9 malformed-email variants → 400; delay sequences identical for real/unknown/disabled |
| AUD-5 timing (150 samples/class, interleaved, fresh IP each) | **PASS** — medians 323.2 / 323.2 / 323.9 / 323.6 ms (unknown / wrong-pw / disabled / disabled+wrong-pw), p95 352–361 ms, Δmedian ≤ 0.7 ms (0.2 %), Mann-Whitney p = 0.74 / 0.79: **not distinguishable** (`pay4-timing-samples.json`) |
| AUD-6 stored content | **PASS** — reason, ip, lower-cased email, timestamp recorded; attempted passwords/bcrypt hashes appear nowhere; 213-char email truncated to 100; markup/NUL emails rejected 400 by zod so never stored. INFO: `X-Forwarded-For` is stored verbatim (≤64 chars, no IP validation) → any future viewer must HTML-escape the ip column. |
| AUD-7 coalescing | **PASS** — 1001 identical failures → 4 rows (1st, 10th, 100th, 1000th); next window's first row says "(+1000 repeats folded…)"; ip and reason are separate buckets; email case/whitespace normalised; 60 concurrent identical → exactly 2 rows, counter 60 |
| AUD-8 global cap | **PASS** — 400 distinct failures at 30-way concurrency → exactly **200 itemised rows + 1 `admin_login_flood` marker**; 40 more → still 200. At the cap, `admin_login`, `seller_flag_cleared` (HTTP 200), `admin_logout`, `admin_created_cli`, `admin_disabled` **are still written** (cap applies only to `admin_login_failed`). Cap is per UTC clock hour, so worst case across an hour boundary is 2×200. |
| AUD-8b per-IP limiter (defaults) | **PASS** — 16 requests/1 IP → 401,401, then 429×14; 2 audit rows (`bad_password`, `throttled`) |
| AUD-9 concurrent login/logout | **PASS** (rerun) — 24 parallel logins → 5×200 / 19×429, sessions == 200s, tokens unique; 24 parallel logouts of one token → exactly 1 audit row, token dead; 30-way storm: no anomalies/deadlocks. (First run exposed NEW-5.) |
| AUD-10 create/clear races | **PASS** — 6 concurrent createAdmin → 1 created; 10 concurrent clear-flag → one 200, nine 409, one audit row; 20 disable/enable toggles → 20 audit rows. INFO: CLI prints raw `duplicate key … admins_email_key` text on a concurrent create. |
| AUD-11a `--reset-password` | **PASS** — 3 live sessions all 401 immediately; old pw 401, new pw 200; two audit rows (`admin_password_reset_cli`, `admin_sessions_revoked` "sessions_revoked: 3"); password not in argv (9 `ps` samples), CLI output, `audit_log` or server logs; weak/short/common/sequential/email-as-password/blank rejected with password unchanged; `--password` flag refused (exit 2). INFO: the `ADMIN_PASSWORD` env var is readable by the same uid via `/proc/<pid>/environ`; prefer the hidden TTY prompt. |
| **AUD-11b reset vs in-flight login** | **FAIL → NEW-4 (MEDIUM)** — see below |
| AUD-12 create-admin CLI edge cases | **PASS** — case-insensitive duplicate refused cleanly, 8 malformed emails exit non-zero with no stack trace, NUL/surrogate/300-char clean messages, failed runs write no audit row. INFO: unicode/Cyrillic-homoglyph emails are accepted by the CLI but the login API 400s them (admin can never sign in; homoglyph admin creation possible). |
| AUD-13 audit coverage (spec §6) | **PASS** — present with admin id+email and timestamp: login (with ip), failed login, logout, create, reset (2 rows), disable/enable, clear-flag (seller id + previous_reason + note), flood marker, janitor, chargeback flag. Denied anonymous/seller attempts write nothing. INFO (not audited): 401/403 attempts, clear-flag 400/409 rejections, SQL-level email/password changes. |
| AUD-14 audit viewer / read path | **No viewer exists.** 36 URL variants × anonymous/seller/admin → only 404/401/403/redirect, no audit fields in any response. Seller and anonymous cannot read the audit log. Pagination/escaping/authz of a viewer: N/A (M5-14 "visible to admins" stays BLOCKED). |

**HTTP flood (`qa-pay4-flood.ts`, 3818, ~8 min):**
- FLOOD-1: 1,500 unique-email failures with rotating spoofed XFF, all 401 → failed-login rows this hour 0→**200 + 1 flood marker**; `audit_log` 1440→1647 rows (778,240→892,928 bytes). Side tables grew: `admin_login_failure_buckets` 85→1,587, `rate_limits` 6,732→8,275, `login_throttle` 0→1,500 — pruned only on ~1–2 % of calls with a 24 h window, so growth is bounded only by attacker request rate (INFO).
- FLOOD-2: 1,000 requests at one real admin email → 401×7, 429×993, audit rows stay at 200. INFO: the per-email delay is global per email, so a spoofed-XFF attacker can hold the real admin in 429 (up to the cap) indefinitely (pre-existing, same for sellers).
- FLOOD-3: at the cap, real HTTP login, clear-flag (200) and logout are still audited. INFO: an attacker can burn the 200-row budget with ~200 unique-email requests to stop per-attempt logging for the rest of the hour (the flood marker and per-bucket coalescing still record it).
- FLOOD-4: hostile XFF values (markup, 5 KB, empty entries, IPv6, SQLi, `%00`, latin1) → 401; max stored ip length 64 (`pay4-flood-4.log` is the targeted rerun after a harness ByteString error).

### 3. Migration 011 (`qa-pay4-mig.sh` on `unveil_qa_pay4_up`, `pay4-migration.log`): **PASS**
- Upgrade from a DB migrated through 010 with 8 seeded audit rows (actor rows, CLI NULL-admin rows, janitor, chargeback, and an orphan CLI row for a deleted admin): rows 8→8, original-column hash unchanged; FK → `RESTRICT`; 3 triggers; email backfill: actor rows from `admins`, CLI rows from the `admin:<uuid>` target, orphan/system rows stay NULL; immutable afterwards; deleting an admin with history refused (actor and subject-only), no-history admin deletable.
- Idempotent: second `migrate` no-op; 011 applied manually 2 more times OK. Failed-migration rollback (`SELECT 1/0` appended) atomic, nothing recorded. 4 concurrent runners: 11 migrations applied total, 0 errors, 3 triggers. QA-authored down + re-upgrade preserved rows. (Seed note: the `admins_email_lowercase` CHECK rejects mixed-case admins; the seed was fixed.)

### 4. Regression (earlier suite re-pointed to 38xx) — **PASS**
money 11/11, webhooks 45/45, refunds 16/16, checkout 32/32, payouts 13/13, races 5/5, session 3/3, retry 2/2, prod-matrix 8/8, r2a 31/31, r2b 24/24, r2c 34/34, r2d 10/10, n1 (buyer cookie / NEW-1) 22/22, n2 (janitor auth/503/401/429, overlap with webhook void) 19/19, n3 (admin isolation/CSRF/disabled-admin/session revocation/re-flag) 24/24 → **~299 probes PASS**. Browser: buyer UI 7 PASS / 3 BLOCKED (M3-02 redirect, M3-19, M3-20, as before); double-click → 1 checkout POST; admin UI 12 PASS + 1 NOTE (expected 401/404 console lines); XSS in admin UI re-checked, escaped.
- **Assertion changes (all test-config or declared design, not bugs):** `SIG-25` (webhooks) and `BUG-3c` (r2a) fail on 3817 only because I had raised the webhook-rejected limiter there; both pass on 3820 with defaults (webhooks 45/45, r2a 31/31). n3 `ADM-SESS-2` deleted an admin with history to test session revocation; that is now (intentionally) refused, so the assertion expects the refusal; n3 24/24.
- **PAN/CVC grep** (`pay4-pan-grep.log`): 4.5 MB `pg_dump` + all server/test logs: 0 hits for the 6 test PANs, `CRON_SECRET`, the admin password, `SESSION_SECRET`; long digit runs in 22 webhook payloads are only the amounts 1000000000000 / 9007199254740992.
- **Unique-index / trigger concurrency:** no 500 from unique violations or the audit triggers (AUD-2 races, AUD-10, fuzz, n1 concurrency). The only 500 found under concurrency is the login-throttle race (NEW-5).

## Plan-case table (39 rows)
| ID | Result | Evidence / change vs round 3 |
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
| M3-12 | PASS | out-of-order/parked/NUL; now also uniform 400/404 for NUL, lone surrogates, 36-dash ids across all uuid-consuming paths |
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
| M5-11 | PARTIAL | unchanged: last 200 txns per seller (36-dash/NUL ids now clean 404), no seller directory/full history |
| M5-12 | BLOCKED | no payout approve/release; admins see failed void refunds only |
| M5-13 | BLOCKED | no settings editor (SQL only) |
| M5-14 | PARTIAL | **Log integrity now met**: every admin action (login ok/failed, logout, create/disable, reset-password x2 rows, clear-flag) is audited with admin id+email snapshot, timestamp, ip where relevant; append-only by trigger (UPDATE/DELETE/TRUNCATE refused, 16 paths + 18 more as a non-owner role); admin delete blocked once history exists. Still PARTIAL only because **no admin audit viewer exists** (AUD-14) and the immutability holds only for a non-owner app role (deployment req.) |
| M5-15 | PASS | re-verified with the 3,966-request fuzz: anonymous 401/redirect, seller 403, 0 state changes, no 5xx on any route (apart from framework-level malformed `%` path, NEW-6) |
| S2-02 | BLOCKED | = M3-20 |
| S2-03 | PASS | = M3-07 |
| S2-05 | BLOCKED | receipt link of the trail still missing; txn → webhook → ledger → void/refund + audit trail (flag clear, with actor email) traceable |

(Changed vs R3: M5-14 (still PARTIAL, reason changed), M5-11 (PARTIAL, unchanged), M5-15 and M3-12 (re-verified, text only), S2-05 (BLOCKED, unchanged). Counts unchanged: **PASS 19 / FAIL 0 / PARTIAL 2 / BLOCKED 18**.)

## New bugs / findings
| ID | Sev | Description | Repro |
|---|---|---|---|
| **NEW-4** | **MEDIUM** | `--reset-password` does not reliably evict an attacker who still knows the old password. `loginAdmin` reads the hash, runs bcrypt (~300 ms), then inserts the session with no re-check; a login that is mid-bcrypt when the reset commits inserts a live `admin_sessions` row *after* the revoke. AUD-11b failed in 3/6 timings; `qa-pay4-resetrace.ts` (login every 60 ms during a CLI reset) left 1–3 live old-password sessions in 5/5 trials; the realistic sequential variant `qa-pay4-resetrace2.ts` (one login at a time, no throttle tampering) left a live session in **3/5** trials (`/api/admin/me` = 200 with a cookie created after the revoke). | Loop `POST /api/admin/login` with the OLD password while running `npm run create-admin -- <email> --reset-password`; afterwards `GET /api/admin/me` with a cookie minted after the `admin_sessions_revoked` audit row → 200. Fix: make the session INSERT conditional on the password hash being unchanged (password_version / `SELECT … FOR UPDATE` re-verify). |
| NEW-5 | LOW (pre-existing) | Concurrent valid logins for the same email can return **HTTP 500**: `TypeError: Cannot read properties of undefined (reading 'wait')` at `login-throttle.ts:96` in `admitLoginAttempt`. A successful login's `resetLoginThrottle` DELETEs the row between a concurrent request's `INSERT … ON CONFLICT DO NOTHING` and its `SELECT … FOR UPDATE`. Seller route: 30 parallel valid logins → 12×500 and 4×500 in two runs (`pay4-sellerconc-*.log`); admin route 3×500 in one audit run (0 on rerun). 57 such stack traces in the 3817 server log. Sessions/audit stay consistent; a retry works. | 30 parallel `POST /api/auth/login` with correct credentials (`qa-pay4-sellerconc.ts`). |
| NEW-6 | LOW (pre-existing, framework) | Malformed percent-encoding in a dynamic path segment → 500 `text/plain` on 14 dynamic routes (list above); no state change. | `curl --path-as-is http://localhost:3817/u/%zz` (also `/api/public/drops/%ff`). `TRACE` → 500 is a related INFO. |
| INFO-A | INFO | Audit blinding: ~200 unique-email failed logins use up the 200 rows/hour budget; later failures are only counted in the flood marker. Cap is per UTC hour (2×200 across the boundary). |
| INFO-B | INFO | Side-table growth under flood (`admin_login_failure_buckets`, `rate_limits`, `login_throttle`) is pruned only on ~1–2 % of calls. |
| INFO-C | INFO | Spoofed XFF is stored verbatim up to 64 chars; escape in any viewer. Per-IP limiters still trust client XFF without an overwriting proxy (INFO-2 from R3). Per-email delay allows login-DoS of a real admin. |
| INFO-D | INFO | Table owner / superuser can disable the immutability triggers; README/docker default makes the app role the owner → deployment must use a non-owner, non-superuser role (not hash-chained, by design). |
| INFO-E | INFO | `ADMIN_PASSWORD` env var visible via `/proc/<pid>/environ` to the same uid; CLI duplicate-key raw text on concurrent create; unicode/homoglyph admin emails accepted by the CLI but unable to log in; JSON bodies have no size cap; plain-SQL email rename not audited; 401/403 and clear-flag 400/409 not audited. |
| INFO-F | INFO | e2e `[#13]` flake: 2/3 over runs 1–3, 3/5 over all five; the failure now reads "correct password during the delay → expected 429, got 200". |
| INFO-G | INFO | No audit viewer / read path exists (admin cannot see the log in the UI). |

R3 findings closed: **NEW-2 FIXED**, **NEW-3 FIXED** (with NEW-4 and the non-owner-role requirement as the residual risk).

## Remaining BLOCKED by owner
- **Backend/Admin:** admin refund (M5-05/06), suspend/ban seller (M5-09/10), settings editor (M5-13), payout request/approve/paid/failed routes and screens (M4-15/16, M5-12), **admin audit-log viewer (M5-14)**, flagged-*drop* review (M5-04), seller directory / full history (M5-11), admin user management in-app (2FA, password change).
- **Backend/Payments:** download/unlock delivery, receipt email and re-access (M3-02 redirect, M3-13, M3-14, M3-20, S2-02, S2-05); scheduling of the janitor (needs Vercel Cron / pinger / box cron with `CRON_SECRET`).
- **Payments + business:** real processor sandbox — 3-D Secure (M3-04), live $1 charge (M3-08), hosted card fields (M3-19), CCBill/Segpay choice (M3-17).
- **DevOps/Deployment:** proxy that overwrites `X-Forwarded-For`; `CRON_SECRET` provisioning; **non-owner, non-superuser app DB role** (so the audit triggers cannot be disabled); request-body size limit at the proxy.

## Cleanup
Servers 3817–3820, 3840–3849 and the e2e server stopped; temp PG cluster (`/tmp/qa4-pg`, port 5898) stopped and removed; throwaway DBs `unveil_qa_pay4`, `unveil_qa_pay4_up`, `unveil_qa_pay4_audit`, `unveil_e2e_qapay4` dropped. No other DB/process touched.

## Evidence
`qa/artifacts/pay4-*` (logs and JSON per probe): `pay4-audit.log` is the full first audit run; `pay4-audit-rerun*.log` are targeted reruns after test-harness fixes (AUD-4/9/11/6/3/1/10/12/13), and `pay4-audit-results.json` was overwritten by the last targeted rerun — use the logs for the complete picture. Fuzz: `pay4-fuzz.log`/`-results.json`; roles: `pay4-roles.log`; flood: `pay4-flood*.log`; e2e: `pay4-e2e-run1..5.log`; migration: `pay4-migration.log`; timing: `pay4-timing-samples.json`; NEW-4: `pay4-resetrace.log`, `pay4-resetrace2.log`; NEW-5: `pay4-sellerconc-1..3.log`.
