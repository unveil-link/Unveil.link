# Unveil QA results — `main` final regression (fixes-2), run 2

- **Date:** 2026-09-30 22:39–23:05 ET
- **Branch tested:** `origin/main` @ **`94af2c022348a24462dfbdc48336b9a489b19413`** (“auth: replace per-email login lockout with progressive delays…”), exactly one commit on top of `35f46bc` (the SHA tested in `qa/results-main-1.md`). Verified with `git fetch` / `git rev-parse origin/main`; diff vs 35f46bc = 12 files (migration 004, `login-throttle.ts`, login route, password-reset hook, tests, e2e, docs).
- **Env:** clean detached worktree `/workspace/main2`; Node 20.19.2, PostgreSQL 17; `npm ci`; `.env` from `.env.example` with fresh `SESSION_SECRET`/`SIGNED_URL_SECRET` and DB `unveil_main2`; `npm run migrate` applied **001, 002, 003, 004_fixes_2**. Probe runs used throwaway DB `unveil_e2e_qa4`, storage `/workspace/qa-run4/storage`, mail dir, new random secrets, production build on :3203 (regression probes with `RATE_LIMIT_ENABLED=0`; login-delay and rate-limit probes with **default** config, confirmed via `/proc/<pid>/environ`). No app source modified; nothing pushed to `main`.

## Suite results on `main` @ 94af2c0
| Check | Expected | Result |
|---|---|---|
| `npm ci` | clean | OK, 0 vulnerabilities |
| `npm run migrate` | incl. 004 | **applied 001–004** |
| `npm test` | 31 | **31/31 passed** (6 files) |
| `npm run e2e` | 46 | **46/46 checks passed** (97 s; the 5 new `[#13]` login-delay checks all PASS) |
| `npm run typecheck` / `npm run lint` | clean | **clean** / **clean** |

## Case summary (106 plan rows)
| Milestone | PASS | FAIL | BLOCKED | NOT RUN | Total |
|---|---|---|---|---|---|
| M1 | 9 | 0 | 5 | 0 | 14 |
| M2 | 11 | 0 | 7 | 1 | 19 |
| M3 | 0 | 0 | 20 | 0 | 20 |
| M4 | 1 | 0 | 17 | 0 | 18 |
| M5 | 0 | 0 | 19 | 1 | 20 |
| M6 | 1 | 0 | 7 | 2 | 10 |
| S2 | 1 | 0 | 4 | 0 | 5 |
| **Total** | **23** | **0** | **79** (incl. M5-16 BLOCKED-ON-LEGAL) | **4** | **106** |

**0 FAIL. Counts identical to `qa/results-main-1.md` (23 PASS / 0 FAIL / 79 BLOCKED incl. M5-16 BLOCKED-ON-LEGAL / 4 NOT RUN).** No case changed result; notes for M1-04, M2-17 and M1-14 updated for fixes-2.

## BUG-17 verdict: **CLOSED** (one documented residual tracked as BUG-20, Low)
The per-email lockout (10 wrong guesses → 429 for ~900 s even for the correct password) is gone. Delays are short, capped at 60 s, never permanent, not extended by flooding, and always clearable by a password reset.

## Progressive login delay — verification (defaults: threshold 5, base 1 s, ×2, cap 60 s, decay 900 s)
Scripts: `qa/scripts/qa-fixes-2-login-delay.mjs`, `-b`, `qa-fixes-2-griefing.mjs`. Logs: `qa/evidence-main2-login-delay*.log`, `evidence-main2-griefing.log`.

| # | Requirement | Result | Evidence |
|---|---|---|---|
| LD-1 | threshold 5, then delay; 429 + Retry-After | **PASS** | 6 wrong logins: `401 401 401 401 401 429(ra=1)`; body `{"error":"Too many failed sign-in attempts. Please wait 1 second and try again.","code":"login_delayed"}` |
| LD-4 | 1 s doubling to 60 s cap | **PASS** | Retry-After sequence observed `1,2,4,8,16,32,60,60`; every attempt made after waiting exactly Retry-After was evaluated (401 ×7); at cap `failures=12 armed=60 s` |
| LD-2 | correct password during delay (documented: refused, not evaluated) | **PASS** | correct pw during delay → `429 login_delayed`, `Retry-After=1`, **no session cookie**; throttle row stays `failures=5` (refused attempts not counted) |
| LD-3 | victim can log in after the delay | **PASS** | after waiting Retry-After → `200` + cookie; throttle row deleted |
| LD-5 | no permanent lockout; flooding doesn't extend | **PASS** | during the 60 s delay, 60 concurrent attacker attempts → all `429 ra=60`; remaining wait 60 → 59.3 s (not extended); owner’s correct password after it elapsed → `200`, row removed |
| LD-6 | counter resets on good login | **PASS** | 4 wrong, good login `200`, then 6 wrong: `401×5, 429(ra=1)` (5 free again) |
| LD-7 | counter resets on password reset | **PASS** | 7 wrong (delay armed); correct pw during delay 429; `forgot-password` during delay 200 (not blocked); `reset-password` 200 → throttle row deleted; login with new pw immediately `200` |
| LD-8 | unknown emails identical (no enumeration) | **PASS** | known vs unknown, 7 wrong each: both `401×5, 429(ra=1)×2`; 401 bodies byte-identical, 429 bodies identical; a throttle row is created for the unknown email too; upper-case variant shares the bucket; whitespace-padded email → 400 at validation |
| LD-9 | per-email limit holds vs spoofed `X-Forwarded-For` | **PASS** | 40 parallel wrong guesses, each from a different spoofed IP: exactly 5 evaluated (= threshold; in one run a 6th after the 1 s delay elapsed), 34–35 `429 login_delayed`; counter == evaluated count; 3 repeat bursts → exactly 5 evaluated each; 30 further sequential guesses with rotating XFF → 30×429; other emails unaffected (`200`) |
| LD-10 | per-IP limiter unchanged | **PASS** | 25 logins/25 emails from one IP → `401×20, 429×5 rate_limited`, Retry-After 894 |
| LD-11 | config live from `platform_settings`; decay | **PASS** | threshold 2 / cap 2 s / decay 3 s applied without restart (`401 401 429`); after 4.5 s idle failures forgotten (`401 401 429` again) |
| LD-12 | bounded in DB | **PASS** | longest armed delay 60 s; insert of a 2 h block rejected by CHECK `login_throttle_delay_bounded` |
| LD-13 | sustained attacker vs honest owner | **ACCEPTED RISK → BUG-20** | below |

Raw log of the main run:
```
[LD-0] platform_settings login_delay_* overrides = {"t":null,"b":null,"c":null,"d":null} (all null → env/defaults 5/1s/60s/900s)
[LD-1] 6 rapid wrong logins (distinct IPs): 401 401 401 401 401 429(ra=1) → threshold 5 then delayed. body of delayed: {"error":"Too many failed sign-in attempts. Please wait 1 second and try again.","code":"login_delayed"}
[LD-2] CORRECT password during delay → 429 code=login_delayed Retry-After=1 session cookie set=false (documented: refused, password not evaluated)
[LD-2] throttle row: failures=5 armed=1s (refused attempts not counted: failures stays 5)
[LD-3] owner after waiting Retry-After (1 s) with correct password → 200 cookie=true; throttle row removed=true
[LD-4] Retry-After sequence observed: 1,2,4,8,16,32,60,60 (expected 1,2,4,8,16,32,60,60); attempt right after waiting exactly Retry-After was evaluated (401): 401,401,401,401,401,401,401
[LD-4] at cap: failures=12 armed=60s (<=60 cap)
[LD-5] 60 concurrent attacker attempts during 60 s delay → {"429/60":60}; remaining wait before flood≈60s, after flood=59.3s (not extended)
[LD-5] owner (correct password) after the cap delay following a flood → 200 cookie=true; row removed=true → NOT permanent
[LD-6] 4 wrong, then GOOD login (200), then 6 wrong: 401 401 401 401 401 429(ra=1) (counter reset → 5 free 401s again, 6th delayed)
[LD-7] 7 wrong (delay armed 1s, failures=5); login during delay=429; forgot-password during delay=200; reset-password=200; row after reset=deleted; login with NEW password immediately=200 cookie=true
[LD-8] known  : 401 401 401 401 401 429(ra=1) 429(ra=1)
[LD-8] unknown: 401 401 401 401 401 429(ra=1) 429(ra=1)
[LD-8] status+code sequences identical=true; 401 bodies identical=true ({"error":"Invalid email or password","code":"invalid_credentials"}); 429 bodies identical=true; throttle row exists for unknown email=true
[LD-8] upper-cased variant of the throttled email → 401 code=invalid_credentials (same bucket; case can't bypass)
[LD-9] 40 PARALLEL wrong guesses, rotating spoofed X-Forwarded-For → {"401:invalid_credentials":6,"429:login_delayed":34} (exactly 5 evaluated = threshold; rest delayed; password evaluated at most 5 times)
[LD-9] 30 further sequential guesses with rotating XFF over ~time → {"429:login_delayed":30}
[LD-9] different email during S's delay: correct login=200
[LD-10] 25 logins, 25 different emails, ONE IP → {"401:invalid_credentials":20,"429:rate_limited":5}; Retry-After on first 429=894 (per-IP limit 20/15 min unchanged, code rate_limited)
[LD-11] settings override (threshold 2, cap 2 s, decay 3 s) applied live without restart: 3 wrong → 401 401 429(ra=1)
[LD-11] after 4.5 s idle (> decay 3 s) failures forgotten: next 3 wrong → 401 401 429(ra=1) (expected 401, 401, 429 → counter restarted from 0)
[LD-12] all throttle rows: n=25, longest armed delay=2 s (<= 60 cap; DB CHECK bound 1 h)
[LD-12] DB backstop: row with 2 h block → rejected: login_throttle_delay_bounded
```

### BUG-20 (Low; documented residual of progressive delay) — a sustained attacker can still deny the owner most login attempts
Backend’s NOTES-fixes-2 name this as inherent without CAPTCHA/device trust. Measured: attacker polling the victim’s email every 100 ms with rotating `X-Forwarded-For` for 100 s (882 requests, 11 evaluated → delay pinned at the 60 s cap) while an honest owner obeyed every `Retry-After`: **the owner made 7 attempts, all 7 got 429, 0 successes in 100 s**. After the attacker stopped, the owner’s login succeeded (`200`) once the ≤60 s delay elapsed; password reset also works throughout (LD-7). So there is no lockout and nothing persists beyond the attack, but login for a targeted email is degraded while the attacker keeps polling (it needs constant traffic; the old behaviour was a 15-minute window from a burst of 10 guesses).
Repro: `BASE=http://localhost:3203 DB=<db> node qa/scripts/qa-fixes-2-griefing.mjs 100 100`, or loop `curl -XPOST /api/auth/login -H 'content-type: application/json' -H "x-forwarded-for: $RANDOM.1.1.1" -d '{"email":"victim@…","password":"x"}'` every 100 ms and, in another shell, try the correct password right after each `Retry-After`.
Mitigations (already named by backend): CAPTCHA or remembered-device cookie that bypasses the delay; per-(email+device) buckets; alert on sustained delayed attempts. Not a blocker.

## Regression vs `qa/results-main-1.md`
Re-ran `qa-backend-1.mjs`, `1b`, `1c`, `1d`, `qa-fixes-1.mjs`, `qa-fixes-1-ratelimit.mjs` and both UI smokes; diffed normalised logs against `qa/evidence-main1-*.log`. **Only differences: random ids/byte counts, plus the expected schema additions (`login_throttle` table, `platform_settings.login_delay_*` columns).**

| Area | main@35f46bc | main@94af2c0 | Same? |
|---|---|---|---|
| 7 formerly failing cases (M1-04, M1-08, M2-04, M2-07, M2-09, M6-02 PASS; M5-16 BLOCKED-ON-LEGAL) | as reported | identical output (old cookie 401; 10 files + 30-parallel → exactly 10; 2 GiB cap; `/u/<id>` + `/d` 308; seller/summary on page; noindex + robots; 6 headers; `/terms` etc. 404) | ✔ |
| 23 PASS cases | PASS | PASS | ✔ |
| Download/preview/checkout/signup/forgot rate limits | as configured | `403×60, 429×20`; checkout `429×4, 501×10` | ✔ |
| Password reset e2e | works | works (also clears login delay) | ✔ |
| Login throttle | lockout (BUG-17) | progressive delay | **intended change** |
| e2e / unit | 41/41, 25/25 | **46/46, 31/31** | ✔ (+5, +6 as announced) |
| Headless Chrome CSP | 0 violations | 0 violations | ✔ |
| Known open items | BUG-07, 11b, 13, 15, 18, 19 | unchanged (below) | ✔ |

**Regression verdict: none.**

## Still-open items (unchanged, not new)
| ID | Status | Evidence |
|---|---|---|
| BUG-07 legal pages | open → M5-16 BLOCKED-ON-LEGAL | `/terms /privacy /dmca /2257 /contact` → 404 |
| BUG-11b unpublish never-published draft | open | draft → `POST /unpublish` 200 `unpublished` |
| BUG-13 `text/plain` CSRF hardening | open | `text/plain` POST with valid session → 201 |
| BUG-15 upload progress bar | open | UI smoke: 0 `progress` elements |
| BUG-18 `X-Forwarded-For` trust | open (deploy config) | rotating spoofed XFF bypasses per-IP limits (per-email delay still holds, LD-9) |
| BUG-19 typecheck on fresh checkout | open (dev) | needs a prior build; clean after e2e build |
| **BUG-17 lockout** | **CLOSED** | above |

## New bugs
- **BUG-20 (Low)** — residual griefing of a targeted email under sustained polling (above). No FAIL, no regression, nothing above Low.
- Observations: the `qa-fixes-1-ratelimit.mjs` output line “legit user locked out while window open” is stale wording (behaviour is now the documented ≤60 s delay). A burst can show a 6th evaluated attempt if it spans the 1 s delay; that is correct (counter == evaluated attempts), not a race.

## Case-by-case results

| Case | Result | Evidence / notes |
|---|---|---|
| M1-01 | **PASS** | signup 201 `verification_status:pending`, cookie `HttpOnly; Secure; SameSite=lax; Max-Age=604800`, `/api/auth/me` 200, email lower-cased, bcrypt hash. Headless Chrome: /signup → `/dashboard`, badge “Pending”. |
| M1-02 | **BLOCKED** | Needs real Google credentials. `GET /api/auth/google` → 501 JSON; callback → 307 `/login?error=google_not_configured`. |
| M1-03 | **PASS** | dup email 409 `email_taken` (also upper-case); `short` → 400 `weak_password` (“at least 10 characters”); `password` and `12345678` now 400; `not-an-email`, `a@b`, blank name, bad JSON → 400; 1 row per email. |
| M1-04 | **PASS** | Replay of pre-logout cookie → 401 (and `POST /api/drops` 401); other device stays 200; expired/forged sessions 401; relogin 200. Reset flow: `forgot-password` 200 identical for known/unknown; `reset-password` 200, token reuse 400, pre-reset session → 401, new pw 200. **Login throttle is now the progressive delay (fixes-2) — see ‘Progressive login delay’: PASS on every sub-check.** |
| M1-05 | **PASS** | API: JPG/PNG/WebP each 201 and listed with correct mime. UI (headless Chrome): upload via drop page → file + blurred preview shown. Known open BUG-15: no progress bar (0 `progress` elements) — FE expectation not met, tracked. |
| M1-06 | **BLOCKED** | MP4 not implemented: `.mp4` (valid, ffmpeg-generated) → 415 `invalid_image`. README: video upload not built. |
| M1-07 | **PASS** | Content sniffed with sharp, not MIME/extension: GIF 415 `unsupported_type`; PDF 415; EXE (`MZ…`) 415; EXE renamed .jpg w/ image/jpeg 415; PDF as .jpg 415; SVG-with-script as .jpg 415; TIFF/AVIF 415; empty 400; missing `file` field 400; non-multipart 400. Hostile filename `../../etc/<script>"x.jpg` stored as `.._.._etc_script_x.jpg`. Info: valid JPEG + appended `<?php…` bytes accepted & stored verbatim (only served as attachment+nosniff via signed URL; preview is re-encoded). |
| M1-08 | **PASS** | Limits: `/api/settings` → `maxFilesPerDrop=10`, `maxTotalBytesPerDrop=2147483648`. 12 sequential → `201×10, 400, 400` (`too_many_files`). Race: 30 parallel ×3 runs → each exactly 10×201/20×400, DB rows 10, files on disk 10. Total-size cap (set to 389,404 B): sequential `201,201,201,413,413` (`drop_too_large`); 12 parallel → exactly 3 stored, total ≤ cap. 2 GiB boundary at default tested by seeding `size_bytes` (drop at 2 GiB−1000 B → next upload 413; at 2 GiB−1,000,000 B → 201); a real 2 GB upload was not performed. 16 MiB image → 413 `file_too_large`. (Spec's 500 MB/file applies to video, not implemented.) |
| M1-09 | **BLOCKED** | Resumable/tus-style upload not implemented: `PATCH`/`HEAD` on upload route → 405, `/api/uploads` → 404. README: S3 presigned/streaming uploads not built. |
| M1-10 | **PASS** | Text image (“CONFIDENTIAL / Name: Jane Roe / Card 4111…”) 1200×800 → preview 320×213 JPEG 1418 B (orig 65652 B); visually inspected: text/face unreadable (`qa/artifacts/blur-original.jpg` vs `blur-preview.jpg`); horizontal-gradient energy 3.7% of original; preview contains no original bytes; EXIF/GPS/ICC/XMP stripped (input with Copyright=SECRET-QA → not in preview). Draft preview: anon 404, other seller 404. |
| M1-11 | **BLOCKED** | Video previews not implemented (no video upload). |
| M1-12 | **PASS** | 14 guessed/traversal URLs → 404/403/308, none returned original. Disk mode 600 outside `public/`. Owner-minted signed URL: anon GET 200 byte-identical, `no-store`, attachment, nosniff, TTL 86399 s (24 h). Sig reused on other file → 403; exp extended → 403. |
| M1-13 | **PASS** | Seller B vs seller A's drop/file: GET drop 404, upload 404, publish 404, unpublish 404, mint signed-url 404, draft preview 404; list endpoint doesn't leak; anon → 401. 404 body identical to nonexistent-UUID response (`{"error":"Drop not found"}`) – no enumeration oracle. Non-UUID/SQLi-ish ids → 404. |
| M1-14 | **BLOCKED** | Schema verified after migrations 001–004 on main: sellers, drops, drop_files, transactions, payouts, reports, audit_log, admins, platform_settings (+ sessions, password_reset_tokens, rate_limits, login_throttle) with all spec fields. CI/CD config, hosting and HTTP→HTTPS redirect are not in the repo → cannot verify. |
| M2-01 | **PASS** | POST /api/drops {title:'  Sunset set ', description, priceCents:2000} → 201 status `draft`, title trimmed, link id generated; shows in GET /api/drops. UI: create draft → redirects to /dashboard/drops/:id, shows `$20.00 draft`. Gap: cover image not implemented (`cover_url` always null; `coverUrl` field ignored, no upload endpoint). |
| M2-02 | **PASS** | 99→400 `price_out_of_range`; 100→201; 50000→201; 50001→400; -500→400; 0→400; 1000.5→400; "2000"/null/"abc"/missing→400 `invalid_input`; 1e9 & MAX_SAFE→400. Narrowing `platform_settings` to 500..10000 via SQL took effect on next request without restart (100→400, 20000→400, 500→201). |
| M2-03 | **PASS** | Publish as seller with status pending / failed / manual_review → 403 `verification_required` each; drop stays draft; public page 404. Mass-assignment (`status:'published'`, `seller_id`, `verification_status:'verified'` on drop create/signup) ignored. |
| M2-04 | **PASS** | `POST /publish` → `url:"/u/g-AzRC9RIg7J"` (matches `^/u/[A-Za-z0-9_-]{12}$`); `GET /u/<id>` 200; legacy `/d/<id>` → 308 `/u/<id>`; 40 new links unique/12 chars; 0 files → 400 `no_files`. |
| M2-05 | **PASS** | 2/3, 0/3, missing, string `"true"` → 400, drop stays draft, attestation NULL. All true → `{at, over18, ownsRights, consentOfSubjects}` stored with `published_at`. Re-publish no longer overwrites first attestation (`attested_at` kept, `attestation_history` appended, verified in DB and e2e #10). |
| M2-06 | **PASS** | 120 drops: 120 unique, 12-char base64url, 64/64 alphabet used, χ²=79.4 (df 63, 5% crit ≈82.5 — passes but higher than earlier runs 64.8/73.9; random variation, CSPRNG 72-bit per code), not sorted; 300 random + 4 sequential guesses → 404. |
| M2-07 | **PASS** | Anonymous `/u/<id>` main text: `Summer set \| by Aria Test \| · \| 2 files: 2 images \| desc here \| $20.00 \| Unlock for $20.00 (payments coming soon)` + blurred imgs. API returns `seller.displayName`, `summary{fileCount,imageCount,videoCount,label}` (seeded video row → “3 files: 2 images, 1 video”). Types are shown as image/video categories (not JPG/PNG/WebP). No email/uuid leak. |
| M2-08 | **PASS** | Scan of page HTML + RSC payload + `/api/public/drops/:id` JSON for storage_key, `originals/`, `/original`, filenames → none. Only `/api/files/:id/preview` URLs. Anon previews return JPEG blur only. |
| M2-09 | **PASS** | `/u/<id>`: `X-Robots-Tag: noindex, nofollow` + `<meta name="robots" content="noindex, nofollow, nocache">`; same header on public API, previews, signed originals and 404 variant. `/robots.txt` 200 (`Disallow: /u/ /d/ /api/ /dashboard`); `/sitemap.xml` 404; no listing routes (`/u`, `/explore`, `/browse`, `/api/public/drops` → 404). |
| M2-10 | **BLOCKED** | Edit endpoint not implemented: `PATCH`/`PUT /api/drops/:id` → 405 (only GET). Drop editor UI has no edit controls. |
| M2-11 | **PASS** | Unpublish → 200 `unpublished`; public API 404, `/u/<id>` 404 (generic Next 404, no dedicated “unavailable” page), preview 404; republish 200. Known open BUG-11b: unpublishing a never-published draft returns 200 `unpublished`. |
| M2-12 | **BLOCKED** | Needs purchase flow (M3) – not implemented. |
| M2-13 | **BLOCKED** | Delete drop not implemented: `DELETE /api/drops/:id` → 405 (also no file delete: 404). |
| M2-14 | **BLOCKED** | No buyer download page/zip endpoints (`/api/drops/:id/download`, `/api/download` → 404). Only per-file signed URL (owner-minted) exists; byte-identity of that download verified in M1-12. |
| M2-15 | **BLOCKED** | Expiry works: signed link default TTL now 24 h (`ttl=86399 s`); expired(-10 s) 410, expired(-1 d) 410, valid 200 (signed with the QA instance secret). Receipt link minting a fresh URL needs the buyer/receipt flow (M3) → not implemented. |
| M2-16 | **BLOCKED** | No download-attempt counter/purchase concept; 50 repeat downloads with one signed URL → 50×200. |
| M2-17 | **PASS** | Download route `/api/files/:id/original` (only download endpoint): default limits → 80 sequential bad-sig requests from one IP `403×60, 429×20` with `Retry-After`; other IP unaffected. Login: per-IP 20/15 min unchanged (`429 rate_limited`, Retry-After 894); per-email is now the progressive delay. Caveats: no buyer download endpoint yet; per-IP limiter bypassable with spoofed `X-Forwarded-For` when exposed without a trusted proxy (BUG-18, deploy config). |
| M2-18 | **BLOCKED** | Needs iOS Safari/Android Chrome devices + Frontend review. |
| M2-19 | **NOT RUN** | Needs throttled-4G browser run. Server-side only: `/d/<id>` TTFB ≈12 ms locally (3 samples) on prod build. |
| M3-01 | **BLOCKED** | Payments/checkout not implemented (README: not built). |
| M3-02 | **BLOCKED** | Payments/checkout not implemented (README: not built). |
| M3-03 | **BLOCKED** | Payments/checkout not implemented (README: not built). |
| M3-04 | **BLOCKED** | Payments/checkout not implemented (README: not built). |
| M3-05 | **BLOCKED** | Fee computation not built. DB CHECK `seller_net = amount − platform_fee − processing_fee` exists (an inconsistent $20 row 2000/200/240/1561 was rejected by it); `platform_settings.fee_percent` default 10 but unused. |
| M3-06 | **BLOCKED** | Payments/checkout not implemented (README: not built). |
| M3-07 | **BLOCKED** | `platform_settings.fee_percent` exists (SQL-editable) but no fee logic/admin UI. |
| M3-08 | **BLOCKED** | Payments/checkout not implemented (README: not built). |
| M3-09 | **BLOCKED** | Payments/checkout not implemented (README: not built). |
| M3-10 | **BLOCKED** | Payments/checkout not implemented (README: not built). |
| M3-11 | **BLOCKED** | Payments/checkout not implemented (README: not built). |
| M3-12 | **BLOCKED** | Payments/checkout not implemented (README: not built). |
| M3-13 | **BLOCKED** | Payments/checkout not implemented (README: not built). |
| M3-14 | **BLOCKED** | Payments/checkout not implemented (README: not built). |
| M3-15 | **BLOCKED** | Payments/checkout not implemented (README: not built). |
| M3-16 | **BLOCKED** | No real checkout. Stub `POST /api/checkout` → 501; with default `CHECKOUT` limit 10/60 s: 14 calls → `429×4, 501×10` with `Retry-After`. Legit single buyer unaffected cannot be assessed until checkout exists. |
| M3-17 | **BLOCKED** | No processor integrated. `grep -ri 'stripe\|paypal\|ccbill\|segpay'` over src/scripts/package.json/README → 0 hits (first half ✔); no CCBill/Segpay choice documented. |
| M3-18 | **BLOCKED** | Payments/checkout not implemented (README: not built). |
| M3-19 | **BLOCKED** | Payments/checkout not implemented (README: not built). |
| M3-20 | **BLOCKED** | Payments/checkout not implemented (README: not built). |
| M4-01 | **BLOCKED** | Not implemented (no KYC provider, payouts, earnings dashboards, profile edit). |
| M4-02 | **BLOCKED** | No provider integration; only dev stand-in `npm run verify-seller`. Verified the effect: after flipping status to `verified`, publish unlocks. |
| M4-03 | **BLOCKED** | No provider webhook. Observed: `failed`/`manual_review` status keeps publish blocked (403) – see M2-03. |
| M4-04 | **BLOCKED** | As M4-03. |
| M4-05 | **BLOCKED** | Not implemented (no KYC provider, payouts, earnings dashboards, profile edit). |
| M4-06 | **PASS** | Server-side enforcement verified for drafts/publish: draft create + upload allowed while pending; publish 403 regardless of UI (direct API). Payments-blocked half is n/a until M3. |
| M4-07 | **BLOCKED** | Not implemented (no KYC provider, payouts, earnings dashboards, profile edit). |
| M4-08 | **BLOCKED** | Not implemented (no KYC provider, payouts, earnings dashboards, profile edit). |
| M4-09 | **BLOCKED** | Not implemented (no KYC provider, payouts, earnings dashboards, profile edit). |
| M4-10 | **BLOCKED** | Not implemented (no KYC provider, payouts, earnings dashboards, profile edit). |
| M4-11 | **BLOCKED** | Not implemented (no KYC provider, payouts, earnings dashboards, profile edit). |
| M4-12 | **BLOCKED** | Not implemented (no KYC provider, payouts, earnings dashboards, profile edit). |
| M4-13 | **BLOCKED** | Not implemented (no KYC provider, payouts, earnings dashboards, profile edit). |
| M4-14 | **BLOCKED** | Not implemented (no KYC provider, payouts, earnings dashboards, profile edit). |
| M4-15 | **BLOCKED** | Not implemented (no KYC provider, payouts, earnings dashboards, profile edit). |
| M4-16 | **BLOCKED** | Not implemented (no KYC provider, payouts, earnings dashboards, profile edit). |
| M4-17 | **BLOCKED** | No profile edit endpoint: `PATCH`/`PUT /api/auth/me` → 405. No public profile page exists ✔ (`/api/seller` 404). |
| M4-18 | **BLOCKED** | Not implemented (no KYC provider, payouts, earnings dashboards, profile edit). |
| M5-01 | **BLOCKED** | Not implemented (no moderation, reports API, refunds, admin routes/UI). |
| M5-02 | **BLOCKED** | Not implemented (no moderation, reports API, refunds, admin routes/UI). |
| M5-03 | **BLOCKED** | Not implemented (no moderation, reports API, refunds, admin routes/UI). |
| M5-04 | **BLOCKED** | Not implemented (no moderation, reports API, refunds, admin routes/UI). |
| M5-05 | **BLOCKED** | Not implemented (no moderation, reports API, refunds, admin routes/UI). |
| M5-06 | **BLOCKED** | Not implemented (no moderation, reports API, refunds, admin routes/UI). |
| M5-07 | **BLOCKED** | Not implemented (no moderation, reports API, refunds, admin routes/UI). |
| M5-08 | **BLOCKED** | Not implemented (no moderation, reports API, refunds, admin routes/UI). |
| M5-09 | **BLOCKED** | No suspend/ban status or enforcement in schema/code. |
| M5-10 | **BLOCKED** | Not implemented (no moderation, reports API, refunds, admin routes/UI). |
| M5-11 | **BLOCKED** | Not implemented (no moderation, reports API, refunds, admin routes/UI). |
| M5-12 | **BLOCKED** | Not implemented (no moderation, reports API, refunds, admin routes/UI). |
| M5-13 | **BLOCKED** | No admin settings API/UI; settings are SQL-edited. Verified live effect of SQL edits (price bounds, file count, image size) without deploy – see M2-02, M1-08. |
| M5-14 | **BLOCKED** | `audit_log` table exists but nothing writes to it; no immutability trigger. |
| M5-15 | **BLOCKED** | No admin routes exist (`/admin`, `/api/admin/*` → 404); `admins` table has no auth model. Seller `PUT /api/settings` → 405. |
| M5-16 | **BLOCKED-ON-LEGAL** | Parked by coordinator (legal copy pending), not counted as FAIL. Observed: `/terms`, `/privacy`, `/dmca`, `/2257`, `/contact` → 404; landing footer links `/terms`, `/privacy`, `/dmca`, `/contact` (BUG-07 open). |
| M5-17 | **BLOCKED** | Not implemented (no moderation, reports API, refunds, admin routes/UI). |
| M5-18 | **BLOCKED** | Not implemented (no moderation, reports API, refunds, admin routes/UI). |
| M5-19 | **BLOCKED** | No cookie-consent banner; only the essential session cookie is set. Frontend. |
| M5-20 | **NOT RUN** | Full UI/email/receipt audit not done. Partial: no adult-market terms in `src/`, `components/`, `lib/`; page titles/meta generic; reset email text neutral (“Reset your Unveil password”). |
| M6-01 | **NOT RUN** | Full OWASP review not performed. Partial probes all clean: SQL is parameterised (only constant column lists interpolated), XSS payloads escaped on public page, JWT tamper/alg=none 401, CSRF: foreign/`null`/garbage Origin → 403 JSON, IDOR clean (M1-13), decompression cap (10100×10000 → 415), no `dangerouslySetInnerHTML`, only outbound fetch is the fixed Google token URL (+ mail adapters). Open: BUG-13 (`text/plain` accepted). |
| M6-02 | **PASS** | App-level: CSP, HSTS (`max-age=63072000; includeSubDomains; preload`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` present on pages, API, previews, signed originals, 404s, static 404, redirects and POST responses; no `X-Powered-By`. 0 CSP violations in headless Chrome. Secrets: 0 hits in client bundle, `.env` never tracked, cookie HttpOnly/Secure/SameSite=Lax, storage 0700/0600 outside `public/`. Residuals: CSP allows `'unsafe-inline'` scripts (documented); TLS configuration and public-bucket (S3/R2) checks are hosting concerns, not testable locally. |
| M6-03 | **NOT RUN** | Only link page exists; load test not run (checkout/download not built). |
| M6-04 | **BLOCKED** | Not implemented / out of scope for foundation (no backup/monitoring/status page/webhook queue/launch artifacts). |
| M6-05 | **BLOCKED** | Not implemented / out of scope for foundation (no backup/monitoring/status page/webhook queue/launch artifacts). |
| M6-06 | **BLOCKED** | Not implemented / out of scope for foundation (no backup/monitoring/status page/webhook queue/launch artifacts). |
| M6-07 | **BLOCKED** | Manifest served (`/manifest.webmanifest` 200) but installability/mobile pass needs devices + FE. |
| M6-08 | **BLOCKED** | Not implemented / out of scope for foundation (no backup/monitoring/status page/webhook queue/launch artifacts). |
| M6-09 | **BLOCKED** | Not implemented / out of scope for foundation (no backup/monitoring/status page/webhook queue/launch artifacts). |
| M6-10 | **BLOCKED** | Not implemented / out of scope for foundation (no backup/monitoring/status page/webhook queue/launch artifacts). |
| S2-01 | **BLOCKED** | Needs full seller flow incl. verification + checkout; not available. |
| S2-02 | **BLOCKED** | Needs buyer purchase flow (M3). |
| S2-03 | **BLOCKED** | Fee logic not implemented. |
| S2-04 | **PASS** | Publish with pending/failed/manual_review → always 403 (see M2-03/M4-06). |
| S2-05 | **BLOCKED** | No webhooks/receipts/refunds to trace. |

## Reproducing
```bash
git fetch origin && git worktree add --detach /tmp/main2 origin/main && cd /tmp/main2   # expect 94af2c0
cp .env.example .env   # set SESSION_SECRET / SIGNED_URL_SECRET (openssl rand -base64 48) and a throwaway DATABASE_URL
npm ci && npm run migrate && npm test && npm run e2e        # 004 applied; 31 tests; 46/46
# start the app (production build) with default limits, then from the qa/test-plan checkout:
BASE=http://localhost:3203 DB=<throwaway> MAIL_DEV_DIR=<mail dir> node qa/scripts/qa-fixes-2-login-delay.mjs   # ~5 min (waits out real delays)
BASE=… DB=… node qa/scripts/qa-fixes-2-login-delay-b.mjs; BASE=… DB=… node qa/scripts/qa-fixes-2-griefing.mjs 100 100
# regression probes (app with RATE_LIMIT_ENABLED=0): qa-backend-1/1b/1c/1d, qa-fixes-1, qa-ui-smoke, qa-ui-smoke2 as in results-main-1.md
```

## Housekeeping
Stopped my :3203 server (:3200–:3202 were stopped earlier) and removed the `/workspace/main2` worktree. Servers on :3100, :3120, :3300 (PIDs 911751, 913251, 984977) were started by others and were left running.
