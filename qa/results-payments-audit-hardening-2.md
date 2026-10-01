# Unveil QA results — `payments/audit-hardening`, run 2 (NEW-4 credentials_version, NEW-5 throttle upsert, migration 012, `[#13]` verdict)

- **Date:** 2026-10-01 ~16:30–18:40 ET
- **Branch tested:** `origin/payments/audit-hardening` @ **`16da94bc66ece7a644ee47ab36fd6f4627ec2947`** ("e2e: probe the new password first (a success clears the delay), then the old one"). Confirmed fast-forward from 94b485d (`git merge-base --is-ancestor`); 7 commits: `54594dc` (NEW-4), `6a8e5b9` (NEW-5), `0f4e02c`/`fb558cc`/`9ea8246`/`16da94b` (tests, e2e), `8614877` (docs).
- **main:** `origin/main` @ **`3e75de74dec81fc73695929b23e37ccd126d7d08`** (unchanged since R4; merge of PR #3). Branch is 18 commits ahead of main, merge-base == main.
- **Money-file claim verified TRUE:** `git diff origin/main origin/payments/audit-hardening -- src/server/payments/{money,pricing,ledger,payouts}.ts` is **empty** (0 lines). R4→R5 delta is 8 files: migration 012, `src/server/admin/{auth,audit}.ts`, `src/server/ratelimit/login-throttle.ts`, `scripts/e2e.ts`, `tests/db/payments.test.ts`, README, PAYMENTS-NOTES. **No new routes** (the 3,966-request route list is unchanged).
- **Env:** clean detached worktree `/workspace/qa-pay5`; Node 20.19.2, PostgreSQL 17, 8 cores. Throwaway DBs `unveil_qa_pay5` (main), `unveil_qa_pay5_up` (+ transient `_c12/_cc/_lk/_load` clones), `unveil_e2e_qapay5` (e2e), and on a separate temp cluster (port 5898) `unveil_qa_pay5_audit` with owner `qaowner` and non-owner app role `qa_app`. Servers: 3917 (limiters raised), 3918 (default limits), 3919 (as non-owner `qa_app`), 3920 (default webhook-rejected limiter), 3921 (login delay threshold 3 / base 30 s: deterministic admission counts), 3922 (e2e login-delay config: 3 / 1 s / cap 4 s), 3923 (migration-under-load), 3930 (e2e). App source not modified; nothing pushed to main or the branch.
- **Re-run:** `qa/scripts/qa-pay5-servers.sh start|stop` (3917/3918), `qa-pay5-servers2.sh start|stop` (3919/3920), `qa/scripts/qa-pay5-run.sh <script.ts> <log>`, `qa-pay5-env.sh`; migration: `qa-pay5-mig.sh unveil_qa_pay5_up`, `qa-pay5-migload.sh`; e2e loop: `qa-pay5-e2e-loop.sh <n> <prefix> [nice -n N]`; CPU generators: `qa-pay5-cpuburn.sh start|stop spin|bcrypt <n>`. Scripts refuse to run unless `DATABASE_URL` is a `unveil_qa_pay*` DB.
- **New round-5 probe scripts:** `qa-pay5-cred.ts` (CV-1…15, credentials_version), `qa-pay5-resetrace.ts` (NEW-4 race, MODE=seq|fast, 32 trials each), `qa-pay5-newfive.ts` (NEW-5, 24 probes; STRICT=1 TH=3 variant on 3921), `qa-pay5-t13.ts` / `qa-pay5-t13b.ts` (`[#13]` study), `qa-pay5-mig.sh`, `qa-pay5-migload.sh`, `qa-pay5-e2e-loop.sh`, `qa-pay5-cpuburn.sh`, `qa-pay5-pangrep.sh`, plus the whole earlier suite re-pointed to 39xx.

## Headline
- **NEW-4: FIXED.** 64 trials of old-password attackers racing the real `--reset-password` CLI (32 sequential, 32 with 4 parallel attackers; 255 attacker sessions minted before the resets): **0 sessions created after the revoke, 0 old-password cookies alive, `GET /api/admin/me` 401 every time**, 28 late logins turned into the uniform 401 + `superseded` audit row. Disable/enable mid-login (40+160 trials), plain-SQL password change and disable, no-op UPDATEs, trigger protection from a non-owner role, deadlocks: all clean. No new bug in the fix. Two design notes (enable/disable version bump; rehash).
- **NEW-5: FIXED.** 30- and 120-way parallel logins, seller and admin, valid/invalid/mixed-case/different emails, plus 60 rounds × 5 racing valid-login-vs-guess: **0 5xx** (vs 12×500/30 in R4). Throttle semantics intact; with a 30 s base delay exactly `threshold` guesses are evaluated out of 120 parallel (strict mode). One theoretical overflow (INFO).
- **`[#13]` flake: test-timing artifact, NOT a product race** — conclusive evidence below. With 16da94b: **5/5 e2e runs 81/81**, flake rate 0/5; also 81/81 under 12-process CPU spin and under 4 niced bcrypt hogs; only an extreme starvation run (10 bcrypt hogs, whole e2e niced +10, 16 min) fails the wall-clock-sensitive checks (76/81),; the DB-clock invariant "no admission inside an armed delay window" was verified separately under the same kind of load (T13-c, t13b).
- **Migration 012: PASS** (upgrade with live sessions/disabled+enabled admins/audit rows, idempotent, atomic rollback, 4 concurrent runners, lock-wait). **Deploy-order finding:** new code on a pre-012 schema returns 500 for every admin login until `npm run migrate` runs (31×500 → 200 in the load test): run the migration BEFORE (or with) the deploy.
- **NEW-6 unchanged** (same 500s on the same routes; `src/proxy.ts` guard does not exist in the repo, documented as a suggestion only).
- **Deployment checklist in the notes is accurate** for the code/config (verified item by item, see below), with 2 doc nits.
- **Regression: clean** (299 earlier probes PASS + audit/roles/flood/fuzz/PAN-grep). **No new bugs above INFO/LOW.** Plan cases: **PASS 19 / FAIL 0 / PARTIAL 2 / BLOCKED 18 (39 rows)**; M5-11 and M5-14 remain PARTIAL.
- Totals: baseline typecheck/lint clean, `npm test` **205/205** (11 files; 124 DB-backed pass when run with a non-production `NODE_ENV`, see note), `npm run e2e` **81/81 ×5**.

## Baseline suite (16da94b)
| Check | Expected | Result |
|---|---|---|
| `npm ci` | clean | OK, 0 vulnerabilities |
| `npm run migrate` | 001–012 | **applied 001–012** (`done (12 applied)`) |
| typecheck (after `next typegen`) | clean | **clean** |
| lint | clean | **0 errors / 0 warnings** |
| `npm test` | 205 (124 DB-backed) | **205/205** (11 files, `pay5-npm-test.log`); DB-backed file alone **124/124** (`pay5-npm-test-db.log`). *Harness note:* my shell had `NODE_ENV=production` exported once and the DB suite then failed 92/124 with "Payments are not available" (mock provider is refused in production mode) — an environment artifact, not a bug; with `NODE_ENV` unset it is 124/124. |
| `npm run e2e` ×5 | 81 | **81/81, 81/81, 81/81, 81/81, 81/81** (143–152 s each, `pay5-e2e-1..5.log`) |

## `[#13]` e2e flake — verdict: **test-timing artifact, not a product race in login-throttle**

**e2e flake rate (16da94b):** `[#13]` 0/5 failures; every other check 0/5 (405 check-executions, all PASS). Evaluated guesses in the 20-way burst: 4, 4, 3, 3, 4 (burst took 1602, 1403, 1052, 1030, 1344 ms) — i.e. **3 of 5 runs hit the "4 evaluated" case that used to fail the check**, and the new assertion (`4 only if the burst outlasted the 1 s delay`) now accepts them correctly. For comparison, R4 on 94b485d: 79, 78, 78, 79, 78 → 3/5 `[#13]` failures.

**Stress runs requested:**
| Run | Condition | Result |
|---|---|---|
| CPU load | 12 busy-loop `node` processes on 8 cores for the whole run | **81/81**; burst 4×401 in 2040 ms (221 s total run) |
| nice'd bcrypt contention, moderate | 4 background bcrypt-cost-12 hash loops, whole e2e under `nice -n 5` | **81/81**; burst 3×401 in 1035 ms |
| nice'd bcrypt contention, extreme | 10 hash loops, whole e2e (server too) under `nice -n 10`, 960 s | **76/81**: 4× `[#13]` + `[fu3] admin login … progressive delay`. Burst took **19,790 ms** (20 requests spread over 20 s, 5 admitted — legitimately, each after the previous 1/2/4 s delay had elapsed); "blocked right after failure #3" and "expected 401,401,401,429…" assert wall-clock ordering that cannot hold when each request takes seconds. |
So: the 3 s explicit arming window added by Payments is enough for normal and moderately loaded runners; under extreme starvation the *other* wall-clock checks still break first (the `evaluated === 3 || (4 && burst ≥ 1 s)` assertion does not allow 5 admissions even when the burst lasted 19.8 s). Not a product problem.

**Why it is not a race — code + measurements:**
1. `admitLoginAttempt` (src/server/ratelimit/login-throttle.ts) is one transaction: `INSERT … ON CONFLICT DO UPDATE … RETURNING` (row lock, always returns the row) → if `next_allowed_at > now()` return 429 (password never evaluated) else count the attempt and arm `next_allowed_at = now() + delay`. The password is evaluated only *after* admission, so a correct password can only be evaluated if the previous delay has already elapsed on the DB clock. `now()` is the transaction start (before the lock wait), which can only make the window *end earlier* by the lock-wait time — never admit inside it.
2. The delay is armed at **admission** time, not at response time. In the e2e config the first delay is 1 s, while the 3 evaluated bcrypt compares share one Node event loop (~0.3 s each, ~1 s concurrent; seconds under load). A sequential client therefore regularly reaches its "correct password during the delay" probe *after* the 1 s window has really elapsed → correct 200. That is exactly the R4 symptom "expected 429, got 200" and the R3 symptom "saw 4 evaluated".
3. **Deterministic repro of the symptom** (`qa-pay5-t13.ts`, server 3922 = e2e delay config threshold 3 / base 1 s): T13-a: 3 wrong guesses, immediate correct probe → **429** (Retry-After 1, no cookie), after 1.3 s → 200. **T13-b:** same sequence with the probe sent 1.1 s later → **200** — reproduces "got 200 instead of 429" on demand with no concurrency at all.
4. **Invariant under load** (T13-c): a trigger on `login_throttle` records every admission with `clock_timestamp()`; across **25 bursts × 20 parallel wrong guesses + 18 parallel noise logins from 6 other emails (77 admissions)**, **0 admissions occurred inside a previously armed window** (and the wall-clock gap between consecutive admissions was never shorter than the armed delay: worst shortfall 0 ms). 2 bursts evaluated 4 guesses only because the burst lasted longer than the 1 s delay.
5. **Sequential probe under CPU hogs** (`qa-pay5-t13b.ts`, 10 bcrypt hogs, 8 trials): each trial logs when the delay was armed, until when, and when the probe arrived: all 8 probes arrived **1.2–3.8 s after the 3rd admission** (window 1 s) → 8× 200 *after* the window; **0 bypasses (200 inside a window)**. (Under that load the same script's T13-a "immediately after" probe also arrived late: `pay5-t13-underload.log`.)
6. **Concurrency cannot exceed the threshold** (`qa-pay5-newfive.ts` STRICT, server 3921 with a 30 s base delay so wall time cannot admit extra guesses): 30- and 120-way parallel wrong passwords → exactly **3 evaluated (401)** and the rest 429 + Retry-After ≤ 60, for both seller and admin routes; `login_throttle.failures == evaluated`.
Residual **INFO** (design, not a bug): the visible lock is `delay − evaluation time` because the delay starts at admission; with the 1 s e2e base and a ~0.3 s bcrypt a sequential client gets ~0.7 s of window. Irrelevant for security (evaluation rate is bounded by admissions), but it is why 1 s windows are brittle in tests.

## Item verdicts

### 1. NEW-4 — `admins.credentials_version` (migration 012): **FIXED** (`qa-pay5-resetrace.ts`, `qa-pay5-cred.ts` 16/16, `pay5-audit.log` AUD-11b)
| Probe | Result |
|---|---|
| **Original repro, sequential attacker**, real CLI `--reset-password`, 32 trials | 93 attacker logins minted before the reset; **0** `admin_sessions` rows created after the `admin_sessions_revoked` audit row; **0** cookies alive; `/api/admin/me` 401 for all; new password 200 and old password 401 in 32/32 (R4: 3/5 trials left a live session) |
| **Fast attacker** (4 parallel login loops), 32 trials | 162 minted before the reset; **0 after the revoke, 0 alive**; **26 late logins** got the uniform 401 with audit reason `superseded`; 204×401 / 48×429 / 162×200, no 5xx |
| AUD-11b (R4 failing probe, 6 timings) | **no survivor in 6/6** (login 401 or 200 → me 401) |
| CV-2 multiple sessions | several concurrent sessions per admin allowed; reset kills **all 3** (me 401), version 1→2, audit `sessions_revoked: 3`, new pw 200 / old pw 401 |
| CV-3 plain-SQL disable, then enable | version +1 on disable and +1 on enable (1→3); the pre-disable cookie is 401 while disabled **and stays dead after re-enable** (its row is not revoked — only the version protects it); a fresh login after re-enable works |
| CV-4 plain-SQL `UPDATE admins SET password_hash=<new bcrypt>` | version +1; old cookie 401, old pw 401, new pw 200 |
| CV-5 trigger only on real changes | `password_hash=password_hash`, `disabled_at=NULL` on enabled, `email=email`, `last_login_at`, `SET password_hash=(SELECT same)`, and `disabled_at` changed while already disabled → **no bump, session stays alive** |
| CV-6/6b rehash | **NOTE:** storing a *different bcrypt hash of the same password* bumps the version and logs everyone out (the trigger compares hashes). The app never rehashes on login (no cost-upgrade path), so nothing triggers this today; a future bcrypt cost-upgrade rehash must set the hash without a bump (or accept the logout). `--reset-password` with the same password also bumps/revokes (intended). |
| CV-7 | `UPDATE … SET password_hash=x, credentials_version=1` during a real change still yields `old+1` (trigger overrides the supplied value) |
| CV-8 non-owner `qa_app` | **8/8 denied**: `DISABLE TRIGGER`, `DISABLE TRIGGER ALL`, `DROP TRIGGER`, `CREATE OR REPLACE FUNCTION`, `DROP FUNCTION`, `DROP COLUMN`, `ALTER COLUMN … SET DEFAULT`, `session_replication_role`; trigger still enabled |
| CV-9 app role writes `credentials_version` directly | **INFO:** allowed (`SET credentials_version=42`, `=-5` both succeed — it is plain DML on a column, no CHECK). That lets an app-role SQL user *lower* a version to resurrect a version-killed session, but the same role can already `INSERT INTO admin_sessions` directly, so it adds no capability beyond "has the app DB credential". A `CHECK (credentials_version >= 1)` would be a cheap hardening. |
| CV-10 disable mid-login, 40 trials (disable 40–420 ms into the ~300 ms bcrypt, then re-enable) | 12 logins completed before the disable (200), 28 became 401 with audit **`superseded` (28/28)**; **after re-enable none of the 12 pre-disable cookies is alive**; no 5xx |
| CV-11 uniformity | `superseded` 401 body + 13 headers **byte-identical** to bad_password and unknown_email; timing n=40 each: superseded median 326 / p95 346 ms, bad_password 323 / 352, unknown 323 / 356 → not distinguishable. Audit row: reason `superseded`, ip, lower-cased admin email, `admin_id` NULL (same as all failed-login rows), no password anywhere in the table |
| CV-12 logout during login | no error; logging out one of several sessions leaves the others alive; resetting admin A leaves admin B's session alive |
| CV-13 expiry/revocation | expired → 401, unexpired at current version → 200, revoked → 401 (unchanged) |
| CV-14 reset on a disabled admin | re-enables, **one** bump (hash+disabled in one UPDATE = +1), old cookies dead, new pw 200 |
| CV-15 lock-wait/deadlock stress | 6 CLI resets + disable/enable toggling every 30 ms + 8 parallel login loops + random logouts on 2 admins: 0 5xx, **pg deadlocks +0**, resets exit 0; (3 cookies minted after the last bump are legitimately alive) |
| Spec/section checks | CV-1: both columns `integer NOT NULL DEFAULT 1`; trigger `BEFORE UPDATE OF password_hash, disabled_at`; legit flow after reset works (new pw 200) |

### 2. NEW-5 — throttle upsert: **FIXED** (`qa-pay5-newfive.ts` 24/24 default config, 16/16 strict on 3921; `qa-pay5-sellerconc.ts`)
| Probe | Result |
|---|---|
| 30 / 120 parallel **valid** logins, one email, seller and admin | 0 5xx; only 200/429 (e.g. seller 14×200/16×429, admin 4×200 in the e2e run); successes reset the row so >threshold successes in one burst are legitimate; with the 30 s config 3–13 successes |
| 30 / 120 parallel **wrong** passwords, one email | 0 5xx; strict config (threshold 3, base 30 s): **exactly 3 evaluated**, 27/117 × 429, `failures == 3`, delay 30 s; default config (base 1 s): 5–6 evaluated depending on burst duration (time-based admissions, all after a real 1 s delay) |
| mixed-case / padded emails, valid+invalid mix | same throttle key (`HoWdY@…` = `howdy@…`); `" email "` → 400 (zod); no 5xx |
| 30 / 120 **different** emails (known + unknown) | each first attempt evaluated (401), no cross-talk; no 5xx |
| **Original NEW-5 trigger**: 60 rounds × (1 valid + 4 wrong in parallel) per route (success `DELETE` racing admissions) | **0 5xx** (seller {200:30,401:164,429:106}; admin {200:27,401:166,429:107}); R4: 12×500/30 |
| Progressive delay | 4 free, 5th arms 1 s (429 + `Retry-After: 1` for the correct password, no cookie), then 2/4/8 s; success deletes the row and 4 free attempts return |
| Parity unknown vs known | status sequence, Retry-After and 429 bodies identical (seller and admin) |
| Decay / bounds | row idle > 900 s → restarts at 1 (evaluated); `failures=1e6` → wait ≤ 59 s (cap 60); armed delay 60 s ≤ cap; no negative waits; no permanent lock (login 200 after window / row cleared). DB `CHECK next_allowed_at <= last_attempt_at + 1 h` still the backstop |
| 24 parallel admin logins + e2e `[r4] NEW-5` check | pass, 5 runs |
| **INFO (theoretical):** `failures` stored as `integer`; a row manually set to 2,147,483,647 makes the next admission overflow → HTTP 500. Needs 2³¹ admitted attempts without a 15-min idle at ≤ 1/min per email (cap 60 s) — unreachable; noted only. |
| **INFO:** the seller route has a second per-email burst limiter (`LOGIN_EMAIL` 20/60 s) whose 429 carries code `rate_limited` (admin route only has `login_delayed`); harmless but explains mixed codes in 120-way seller bursts. |

### 3. Migration 012 (`qa-pay5-mig.sh` on `unveil_qa_pay5_up`, `pay5-migration.log`; `qa-pay5-migload.sh`, `pay5-migload.log`): **PASS**
- **Upgrade 011→012** with 4 admins (enabled with history, disabled with history, enabled without history, NULL password), 4 sessions (live, revoked, expired, live-of-disabled-admin), 4 audit rows: `npm run migrate` applies 012 only; both new columns present; **backfill: all admins and all sessions = version 1**; audit hash and admins data unchanged; the 011 triggers (append-only, delete guard, disable audit) still intact.
- **Sessions created before 012:** the live session of an enabled admin **stays valid** (session v1 == admin v1; verified via the read predicate: 5a1=true; revoked/expired/disabled-admin sessions stay dead). I.e. 012 does *not* force-logout existing admins; the notes do not state this explicitly (they say "additive").
- Trigger behaviour on the migrated DB: real hash change 1→2, same-value UPDATE no bump, disable → 3.
- **Idempotent:** second `migrate` "up to date"; 012 re-applied manually 3× OK (versions unchanged, 1 trigger).
- **Failed 012** (`SELECT 1/0` appended): rolled back atomically — not recorded, 0 columns/trigger/function left, sessions intact.
- **4 concurrent runners** on a DB at 011 with data: exactly one applied 012, 0 errors, 1 trigger.
- **Lock wait:** with another transaction holding `FOR UPDATE` on `admins`, the migration waits (3 s) and then applies (ALTER needs ACCESS EXCLUSIVE; the migration itself is milliseconds; no deadlock).
- **Under load / deploy order (new finding, LOW/INFO):** app 16da94b running against a DB still at 011 returns **500 for every admin login** (selects `credentials_version`); during the test 31 consecutive login attempts failed with 500 until `npm run migrate` applied 012 (≈3 s later), then 100% 200 — no hangs or mixed errors during the switch. Old code on the 012 schema is additive-compatible by inspection (new columns have defaults) but was not run. **Run the migration before (or together with) the deploy.**

### 4. NEW-6 — status: **unchanged, not fixed (as expected)** (`pay5-new6.txt`, fuzz)
- `/u/%zz`, `/api/public/drops/%ff`, `/api/drops/%c0%af`, `/api/webhooks/%` → **500** (same 14 dynamic routes: `/u/:linkId`, `/pay/mock/:id`, `/dashboard/drops/:id`, `/admin/sellers/:id/transactions`, `/api/public/drops/:linkId`, `/api/drops/:id` (+publish/unpublish/files), `/api/files/:id/{original,preview,signed-url}`, `/api/webhooks/:provider`, `/api/admin/sellers/:id/clear-flag`); static paths with bad `%` → 404. No state change.
- **`src/proxy.ts` does not exist** on the branch (also no `middleware.ts`); the notes describe the 5-line guard as an option that was tried in `next dev` and removed. `TRACE /api/settings` → 500 (raw socket TRACE too), `TRACE /` → 405.

### 5. Deployment checklist verification (README "Production database roles" + PAYMENTS-NOTES "Deployment requirements")
| Claim | Verdict vs code/config |
|---|---|
| App DB role neither superuser nor table owner; owner runs migrations; recipe `CREATE ROLE unveil_app LOGIN … NOSUPERUSER; GRANT USAGE ON SCHEMA; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES; GRANT USAGE,SELECT ON ALL SEQUENCES` | **Accurate.** I reproduced an equivalent setup (`qa_app`, same grants): the whole app (create-admin, reset, login, failed-login audit + coalescing, clear-flag, logout, janitor) works, and the 16-path / 18-bypass / 8 new credentials_version-trigger attacks are denied (ROLE-1..3 3/3, CV-8 8/8). Repeat the grants after each migration that adds tables — stated. |
| `docker-compose.yml`/README defaults are superuser+owner, dev only | **Accurate** — compose still has `POSTGRES_USER: unveil` (superuser, owner of everything); `.env.example` still points at `unveil:unveil`. It is documented in README "Production database roles". **Doc nit (INFO):** README quick-start step 2 (`createuser -P unveil ; createdb -O unveil unveil`, or docker) gives no inline pointer to that section, and the section sits after the test instructions. |
| Reverse proxy that OVERWRITES `X-Forwarded-For` + `TRUSTED_PROXY_HOPS` | **Accurate/precise enough:** `clientIp()` takes the Nth entry from the right (default 1) and truncates to 64 chars; without a proxy the left-most client value is trusted (R3 INFO-2 unchanged). Wording "overwrites" vs "appends": with hops set correctly either works since the rightmost entry is the proxy-observed address. |
| `CRON_SECRET` provisioned (503 when unset) | **Accurate** — n2 JAN-8: unset/short secret → 503 before the token compare, limiter counted first. |
| Body size cap at the proxy (JSON parsed without app-level limit; webhooks 256 KB and uploads capped) | **Accurate** — 5 MB (and R4: 60 MB) JSON → 400 (parsed, then rejected by schema), not 413; webhook >256 KB → 413; upload declared huge Content-Length → 413. |
| Escape `audit_log.ip`/`admin_email`/`target` in any future viewer | **Accurate** — ip stored verbatim ≤ 64 chars from XFF (hostile values stored: markup, SQLi, `%00`); email lower-cased/truncated to 100; no viewer exists to render them. |
| ≤ 200 itemised failed-login rows/hour + `admin_login_flood` marker; ~200 distinct emails exhaust it | **Accurate** — re-measured: 1,500 unique-email failures with rotating XFF → exactly 200 rows + 1 marker; real login/clear-flag/logout still audited at the cap; a new attacker failure after the cap is only counted. Cap is per UTC hour (up to 2×200 across the boundary) — not stated in the notes (INFO). |
| NEW-6 / TRACE limitation | **Accurate** (see item 4). |

## Regression (earlier suite re-pointed to 39xx) — **PASS**
money 11/11, webhooks 45/45, refunds 16/16, checkout 32/32, payouts 13/13, races 5/5, session 3/3, retry 2/2, prod-matrix 8/8 (ports 3940–3949), r2a 31/31, r2b 24/24, r2c 34/34, r2d 10/10, n1 (buyer cookie / NEW-1) 22/22, n2 (janitor auth/503/401/429, overlap with webhook void) 19/19, n3 (admin isolation / CSRF / disabled admin / session revocation / XSS / re-flag) 24/24 → **299 probes PASS**. Browser: buyer UI 7 PASS / 3 BLOCKED (M3-02 redirect, M3-19, M3-20 — not built), double-click → 1 checkout POST, admin UI 12 PASS + 1 NOTE (expected 401/404 console lines).
- Test-config artifacts (same as R4, not bugs): `SIG-25`/`BUG-3c` need the default webhook-rejected limiter (3920: webhooks 45/45, r2a 31/31; on 3917 where I raise it they fail); `JAN-8` failed once because my 3920/3921 servers occupied ports the n2 script starts its own servers on — 19/19 after stopping them.
- **Audit/roles suite** (`pay5-audit.log`): **AUD-1…14 17/17 PASS** — append-only 16 paths denied; owner-role INFO unchanged; admin delete restricted by FK; email snapshot; failed-login parity (byte-identical 401, 13 headers); timing medians 321.7 / 320.8 / 321.7 / 320.8 ms for unknown / wrong-pw / disabled / disabled+wrong-pw, p95 339–344, Mann-Whitney p = 0.104 / 0.708 / … (not distinguishable); coalescing exact; global cap 200 + 1 marker; concurrency; `--reset-password` incl. AUD-11b now PASS; CLI edge cases; audit coverage; no viewer/read path (anonymous/seller 401/403/404). **ROLE-1..3 3/3** on the non-owner `qa_app` cluster.
- **Flood** (`pay5-flood.log`, 4/4 PASS): 1,500 unique-email failures with rotating spoofed XFF → 200 itemised rows + 1 marker; `audit_log` 3591→3899 rows (+41 KB); side tables `admin_login_failure_buckets` 95→1596 rows, `rate_limits` 12,622→14,122; 1,000 requests at one real admin email → 401×6 then 429×994, no lockout beyond the delay; at the cap real admin login/logout/clear-flag are still audited; hostile XFF stored ≤ 64 chars.
- **Fuzz** (`pay5-fuzz.log`, `qa-pay5-fuzz.ts`): **3,966 requests**, every API/page/admin route, same payload matrix as R4; **0 state changes on 4xx**, server alive. 134 flagged 5xx = 126 malformed-`%`-path (NEW-6; 9 per route × 14 routes) + 3 raw-socket (`%zz`, `%ff`, TRACE) + 5 harness artifacts (fetch refuses an `Origin` with a trailing space ×4; client-side `fetch failed` on an absurd declared Content-Length — the raw-socket version, `pay5-hugecl.log`, gets the 413). **0 application-code 5xx.** Same set as R4.
- **PAN/CVC/secret grep** (`pay5-pan-grep.log`): 4.3 MB `pg_dump` + all server logs: 0 hits for the 6 test PANs, `CRON_SECRET`, `SESSION_SECRET`, `PAYMENT_WEBHOOK_SECRET`, admin password, `cvc/cvv` keys (3 PANs appear only in my own probe output as the decline-test card numbers).
- **Unique-index/trigger concurrency:** no 500 from the credentials_version trigger vs `FOR SHARE` (CV-15, 0 deadlocks), the throttle upsert (NEW-5), the audit-trigger races (AUD-2/10) or the fuzz.

## Plan-case table (39 rows)
| ID | Result | Evidence / change vs round 4 |
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
| M5-07 | PASS | refund after payout → negative balance, netted against new sale (regression 16/16, 13/13) |
| M5-08 | PASS | + admin review/clear and re-flag verified (n3 24/24) |
| M5-09 | BLOCKED | no suspend |
| M5-10 | BLOCKED | no ban |
| M5-11 | PARTIAL | unchanged: last 200 txns per seller (36-dash/NUL ids → clean 404), no seller directory/full history |
| M5-12 | BLOCKED | no payout approve/release; admins see failed void refunds only |
| M5-13 | BLOCKED | no settings editor (SQL only) |
| M5-14 | PARTIAL | unchanged vs R4: every admin action audited (login ok/failed incl. reason `superseded`, logout, create/disable, reset x2 rows, clear-flag) with admin id/email snapshot + timestamp (+ip); append-only by trigger for a non-owner role (16 paths + 18 bypasses denied, re-run R5); admin delete blocked once history exists. Still PARTIAL only because **no audit viewer exists** and immutability needs the non-owner app role (deployment checklist) |
| M5-15 | PASS | re-verified R5: 3,966-request fuzz, 0 state changes on 4xx, no 5xx from app code (only NEW-6 framework path-decoding 500); credentials_version adds no auth bypass |
| S2-02 | BLOCKED | = M3-20 |
| S2-03 | PASS | = M3-07 |
| S2-05 | BLOCKED | receipt link of the trail still missing; txn → webhook → ledger → void/refund + audit trail (flag clear, with actor email) traceable |

(Changed vs R4: M5-14 (still PARTIAL; text), M5-11 (PARTIAL; text), M5-15/M5-07/M5-08 (re-verified; text). Counts unchanged: **PASS 19 / FAIL 0 / PARTIAL 2 / BLOCKED 18**.)

## New bugs / findings
No new bug above LOW. NEW-4 and NEW-5 are closed.
| ID | Sev | Description | Repro |
|---|---|---|---|
| NEW-7 | LOW (deployment/ops) | Deploying 16da94b before migration 012 breaks **all** admin logins with HTTP 500 (and any admin request, since `readAdminToken` selects `s.credentials_version`) until `npm run migrate` runs. | Start the app against a DB at 011, `POST /api/admin/login` with valid credentials → 500; run `npm run migrate` → 200 (`pay5-migload.log`). Fix/mitigation: run migrations before the new version takes traffic (document in the deploy notes). |
| NEW-6 | LOW (pre-existing, framework) — **still open** | Malformed percent-encoding in a dynamic path segment → 500 `text/plain` on 14 dynamic routes; no state change. | `curl --path-as-is http://localhost:PORT/u/%zz` (also `/api/public/drops/%ff`); `TRACE /api/settings` → 500. Fix: the `src/proxy.ts` `decodeURIComponent` guard the notes describe, or reject at the reverse proxy. |
| INFO-A | INFO | `credentials_version` has no `CHECK (>= 1)` and the app role may write it directly (CV-9); only reachable with app-DB credentials which already allow inserting sessions. |
| INFO-B | INFO | Any UPDATE that stores a different bcrypt hash of the same password bumps the version and logs every session out (CV-6). No code path does this today (no rehash-on-login). |
| INFO-C | INFO | Pre-012 sessions stay valid after the migration (version 1 == 1); admins are not force-logged-out by the upgrade. |
| INFO-D | INFO | `failures` is `integer`; theoretical overflow → 500 at 2³¹ (unreachable). Seller route returns `rate_limited` (burst limiter) vs `login_delayed` codes. |
| INFO-E | INFO | Throttle delay is armed at admission (tx start), so the visible lock shrinks by the evaluation time (≈0.3 s idle, seconds under load) — explains `[#13]`; no security impact. |
| INFO-F | INFO | Carry-overs from R4 (still true): audit blinding by exhausting 200 rows/hour (cap per UTC hour), side-table growth under flood, XFF stored verbatim ≤ 64 chars, per-email delay can be used to hold a real admin in 429, `ADMIN_PASSWORD` visible via `/proc` to the same uid, unicode/homoglyph admin emails accepted by the CLI but unable to log in, JSON body size uncapped (5 MB/60 MB → 400), no audit viewer, plain-SQL email rename not audited, table owner/superuser can disable triggers. |
| INFO-G | INFO (docs) | README quick start (step 2) still shows the owner/superuser dev setup without an inline pointer to "Production database roles"; the notes do not state the per-UTC-hour nature of the 200-row cap or that pre-012 sessions survive. |

R4 findings closed: **NEW-4 FIXED**, **NEW-5 FIXED**; `[#13]` explained as a test-timing artifact (not a bug).

## Remaining BLOCKED by owner
- **Backend/Admin:** admin refund (M5-05/06), suspend/ban seller (M5-09/10), settings editor (M5-13), payout request/approve/paid/failed routes and screens (M4-15/16, M5-12), **admin audit-log viewer (M5-14)**, flagged-*drop* review (M5-04), seller directory / full history (M5-11), in-app admin user management (2FA, password change).
- **Backend/Payments:** download/unlock delivery, receipt email and re-access (M3-02 redirect, M3-13, M3-14, M3-20, S2-02, S2-05); scheduling of the janitor (needs Vercel Cron / pinger / box cron with `CRON_SECRET`).
- **Payments + business:** real processor sandbox — 3-D Secure (M3-04), live $1 charge (M3-08), hosted card fields (M3-19), CCBill/Segpay choice (M3-17).
- **DevOps/Deployment checklist (all documented, none verifiable here):** non-owner non-superuser app DB role (README "Production database roles"); migrations run by an owner role **before** the new app version serves traffic (NEW-7); reverse proxy with correct `X-Forwarded-For` handling + `TRUSTED_PROXY_HOPS`; `CRON_SECRET` provisioned + janitor scheduled; request-body size cap at the proxy; optionally reject malformed `%` paths at the proxy (NEW-6); escape `ip`/`admin_email`/`target` in any audit viewer; alert on the `admin_login_flood` marker.

## Cleanup
Servers 3917–3923, 3930 and 3940–3949 stopped; temp PG cluster (`/tmp/qa5-pg`, port 5898) stopped and removed; CPU/bcrypt generators killed; throwaway DBs `unveil_qa_pay5`, `unveil_qa_pay5_up`, `unveil_e2e_qapay5` (and transient clones) dropped; worktrees `/workspace/qa-pay4`, `/workspace/qa-pay4-commit`, `/workspace/qa-pay5` removed. No other DB/process touched.

## Evidence
`qa/artifacts/pay5-*`: e2e `pay5-e2e-1..5.log` + `-summary.txt`, `pay5-e2eCPU-1.log`, `pay5-e2eBC-1.log` (extreme), `pay5-e2eBC2-1.log` (moderate); `[#13]` study `pay5-t13.log`, `pay5-t13-underload.log`, `pay5-t13b-load.log`; NEW-4 `pay5-resetrace-seq.log`, `pay5-resetrace-fast.log`, `pay5-cred.log`; NEW-5 `pay5-newfive.log` (default config), `pay5-newfive-strict.log` (3921), `pay5-newfive-run1-staleassert.log` (first run, before I fixed my own test setup: it ignored the seller `LOGIN_EMAIL` burst limiter and assumed ≤ threshold successes — kept for transparency); migration `pay5-migration.log`, `pay5-migload.log`, `pay5-mig-sessions-readable.txt`; regression `pay5-old-*.log`, `pay5-regress-summary.txt`; audit/flood/fuzz/roles `pay5-audit.log`, `pay5-flood.log`, `pay5-fuzz.log`, `pay5-roles.log`; `pay5-npm-test*.log`, `pay5-pan-grep.log`, `pay5-new6.txt`, `pay5-bodycap.txt`, `pay5-hugecl.log`.
