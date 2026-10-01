# Unveil QA results — `frontend/dashboard` (PR #1), run 1

- **Date:** 2026-10-01 08:58–10:30 ET
- **Branch / SHA tested:** `origin/frontend/dashboard` @ **`faa38d45f7a18f64a5e44984d6c07ce07e12e9ce`** (PR https://github.com/unveil-link/Unveil.link/pull/1). Verified `git rev-parse HEAD` in a clean detached worktree (`/workspace/fe1`); `git merge-base origin/main HEAD` = **`94af2c0`** (6 Frontend commits on top: `7b6bfed ea54454 f57ec52 5bf4a3b 79490f7 faa38d4`).
- **Env:** Node 20.19.2, PostgreSQL 17, headless Google Chrome 154 (playwright-core, `--no-sandbox`). Throwaway DB `unveil_fe1` (+ `unveil_e2e_qa5`, `unveil_e2e_qa5f`, `unveil_e2e_qa5m` for e2e/probes), throwaway storage/mail dirs under `/workspace/qa-run5`, fresh `openssl rand` secrets. App = production build started with `bash scripts/dev-start.sh 3205` (default rate limits and default login-delay settings, verified); a second instance on :3206 with `RATE_LIMIT_ENABLED=0` for burst/regression probes; a third on :3207 with a *fake* Google client id (button-presence check only). Ports 3100/3120/3300/3400 untouched. All my servers are stopped.
- **Rules followed:** no app source modified; nothing pushed to `main` or `frontend/dashboard`; only `qa/test-plan`.

## Verdict
**No blocking defects; 1 FAIL (M4-09, Medium, display/labelling) and 6 Low findings.** Compared with `qa/results-main-2.md` (23 PASS / 0 FAIL / 79 BLOCKED / 4 NOT RUN) the Frontend branch moves **7 cases to PASS** (M1-02 presence-only, M2-18, M2-19, M3-18, M4-18, M5-20, M6-07; M2-19 and M5-20 were NOT RUN, the others BLOCKED), **1 to FAIL** (M4-09), closes **BUG-15** (M1-05 stays PASS, now with a progress bar) and leaves the rest BLOCKED on Backend/Payments/Legal. **No regression** of any previously passing backend case.

## Counts (106 plan rows)
| Milestone | PASS | FAIL | BLOCKED | NOT RUN | Total |
|---|---|---|---|---|---|
| M1 | 10 | 0 | 4 | 0 | 14 |
| M2 | 13 | 0 | 6 | 0 | 19 |
| M3 | 1 | 0 | 19 | 0 | 20 |
| M4 | 2 | 1 | 15 | 0 | 18 |
| M5 | 1 | 0 | 19 | 0 | 20 |
| M6 | 2 | 0 | 6 | 2 | 10 |
| S2 | 1 | 0 | 4 | 0 | 5 |
| **Total** | **30** | **1** | **73** (incl. M5-16 BLOCKED-ON-LEGAL) | **2** | **106** |

vs `results-main-2.md`: PASS 23 → **30**, FAIL 0 → **1**, BLOCKED 79 → **73**, NOT RUN 4 → **2** (only M6-01 OWASP review and M6-03 load test remain NOT RUN). Plan header says 94 cases; the file actually has 106 rows (unchanged from earlier runs).

### Cases whose rating changed vs `results-main-2.md`
| Case | Before | Now |
|---|---|---|
| M1-02 | BLOCKED | **PASS** |
| M2-18 | BLOCKED | **PASS** |
| M2-19 | NOT RUN | **PASS** |
| M3-18 | BLOCKED | **PASS** |
| M4-09 | BLOCKED | **FAIL** |
| M4-18 | BLOCKED | **PASS** |
| M5-20 | NOT RUN | **PASS** |
| M6-07 | BLOCKED | **PASS** |

Scope caveats on three PASSes (all stated in the case rows): **M1-02** = button presence only, the OAuth round trip needs real credentials; **M2-18** = Chrome mobile *emulation*, no real iOS Safari/Android devices; **M6-07** = Chrome installability check + manifest, no real-device install.

## Suite results on `frontend/dashboard` @ faa38d4
| Check | Result |
|---|---|
| `npm ci` | OK, 0 vulnerabilities (requires `NODE_ENV` unset — with `NODE_ENV=production` exported `npm ci` silently skips devDependencies and `npm run migrate` fails with `tsx: not found`; env gotcha, not a defect) |
| `npm run migrate` | applied 001–004 (same 4 migrations as main; no new migration) |
| `npm run lint` | **clean** |
| `npm run build` | **OK** (all routes incl. new dynamic `/dashboard/drops`, `/dashboard/drops/new`) |
| `npx tsc --noEmit` (after build) | **clean** (BUG-19 only bites before the first build; not re-tested) |
| `npm test` | **50/50 passed** (7 files = main's 31 + 19 new `tests/frontend-lib.test.ts`) |
| `npm run e2e` | **46/46 on 3 of 5 valid runs; 45/46 on 2 runs** — the only failing check is the pre-existing `[#13] attacker spamming 20 wrong passwords … exactly 3 evaluated … expected 3, got 4` (**BUG-21**, flaky, identical on `main@94af2c0`: 1 of 3 runs failed there). One further run was invalid because another agent dropped the shared default DB `unveil_e2e` mid-run (use `E2E_DATABASE_URL=…_<unique>` when several agents share the box) |
| Regression probes (`qa-backend-1/1b/1c/1d`, `qa-fixes-1`, `PUB=/u`, app with limits off) | **identical to `results-main-2` runs** after normalising ids/timestamps; only differences are the intended UI text (`/u/<id>` main text; unavailable page now has the custom copy: M2-11 probe prints `custom 'unavailable' text? true`) |
| CSP violations in headless Chrome | **0** across all runs (≈45 page loads: landing, auth pages, buyer page, dashboard, editor, mobile, throttled) |

## Files changed vs `main` (backend / lib / migration audit)
`git diff --name-status origin/main faa38d4`: 175 files = 108 screenshots + 67 others (51 A, 13 M, 3 D).
- **Backend: untouched.** `src/server/**`, `src/app/api/**`, `db/migrations/**` (no new migration), `next.config.ts` (CSP/headers/redirects), `package.json`, `package-lock.json` (no new dependency), `scripts/migrate.ts`, `scripts/e2e*.{ts,sh}`, existing `tests/*`, `proof/**`, `lib/cn.ts`, `lib/tokens.ts` → **no diff**. The claim “no backend code changed” is **confirmed**.
- **`lib/` (repo-root shared helper dir, not backend): 7 new files, all frontend-only** — `api.ts` (typed fetch + `Retry-After` parser), `format.ts`, `password-hint.ts` (client mirror of the cheap password rules), `share.ts` (copy-link; origin `https://unveil.link`, override `NEXT_PUBLIC_SHARE_ORIGIN`), `upload-limits.ts`, `upload.ts` (XHR upload with progress), `useCountdown.ts`.
- **Frontend-authored server code to review:** `src/app/dashboard/data.ts` (new) runs read-only, parameterised, `seller_id`-scoped SQL straight against `transactions`, `payouts`, `platform_settings`, `drop_files`/`drops` via `@/server/db` (bypasses the service layer by design, because no earnings API exists). I verified the numbers (M4-09/10) and cross-seller isolation (CHK-AUTHZ below); the pattern should be replaced by an endpoint when Backend ships one.
- Other: `scripts/dev-start.sh` (new, prod start on a port), `scripts/seed-demo.ts` (dev seeding via real API + SQL), `scripts/screenshots-dashboard.mjs`, `docs/frontend-dashboard-notes.md`, `components/{ui,auth,buyer,dashboard,design}/**` (new), old `src/app/components/{AppShell,LogoutButton,NewDropForm}.tsx` deleted, auth forms / `DropEditor` / dashboard + `u/[linkId]` pages rewritten.

## New bugs / findings (this branch)
Severity: Medium = fix before release, Low = polish/hardening. IDs `FE-n` (Frontend) / `BUG-21` (Backend test) to avoid clashing with the payments report’s own `BUG-1..8` numbering.

| ID | Sev | Area | Finding | Exact repro |
|---|---|---|---|---|
| **FE-01** | **Medium** | Dashboard earnings (M4-09) | Earnings cards don’t show **platform fee** and **processing fees** as separate figures (plan expects gross, platform fees, processing fees, net, pending vs available). The headline label “**Your 90%**” is shown next to *net after processing* = 85.0 % of gross in the seed ($366.34 of $431.00), so the label is arithmetically wrong for a seller; the subtitle only says “After the 10% platform fee & processing”. `charged_back` rows are summed into “$X refunded”. | Seed (`BASE_URL=http://localhost:3205 npx tsx scripts/seed-demo.ts`), sign in as the printed `maya+…` seller (password `Sunrise-Harbor-4821`) → `/dashboard`: cards read Gross $431.00 / Your 90% $366.34 / Available $156.34 / Pending $60.00. DB: `select sum(amount_cents),sum(platform_fee_cents),sum(processing_fee_cents),sum(seller_net_cents) from transactions where seller_id=… and status='succeeded'` = 43100 / 4310 / 2156 / 36634 (net/gross = 85.0 %). Insert one `refunded` and one `charged_back` $50 row → hint becomes “30 sales · $100.00 refunded”. Evidence `qa/evidence-fe1-b.log`, `-refund.log`. Fix: add “Platform fee” and “Processing fees” lines (or a breakdown popover), relabel “Your 90%” → “Net earnings”, separate refunded/charged-back. |
| **FE-02** | Low (a11y, WCAG 2.4.3) | Modal | After closing the confirm/publish modal (Esc, “Keep published”, X) focus is **not returned to the trigger**; it falls to `<body>` so keyboard/SR users restart at “Skip to content”. Initial focus inside the dialog is correct (Close button) and Esc works. | Sign in → `/dashboard/drops` → Tab to a row’s **Unpublish** → Enter → Esc → `document.activeElement` is `BODY`. Same with mouse open + any close. `qa/evidence-fe1-modal.log`. |
| **FE-03** | Low | Titles | Buyer page and its unavailable page have the title **“Unveil · Unveil”** (duplicated brand; title template applied to title “Unveil”). | `curl -s http://localhost:3205/u/<published-id> \| grep -o '<title>[^<]*'` and the same for `/u/nope`. `qa/evidence-fe1-f.log`. |
| **FE-04** | Low | Buyer page trust claim | “**Verified creator**” badge is hard-coded for every published drop; it is not tied to `sellers.verification_status` (a seller later set back to `pending`/`failed`/`manual_review` keeps the badge on live links). Backend also doesn’t unpublish on status change. | Publish a drop as a verified seller; `update sellers set verification_status='pending' where email=…`; reload `/u/<id>` → still 200 with badge. `qa/evidence-fe1-m.log`. |
| **FE-05** | Low (UX) | 429 countdown | Long waits are rendered in raw seconds: “Try again in **3481s**” (≈58 min, from the per-IP forgot-password limiter, `Retry-After: 3503`), also on the card (“3481s”). Should switch to minutes above ~120 s. Countdown itself is accurate and wall-clock based. | Against a default-limit server submit `/forgot-password` with 5 different emails from one IP → 5th response `429 Retry-After≈3500` → button label. `qa/evidence-fe1-d2.log`, `forgot-429-desktop.png`. |
| **FE-06** | Low (hardening) | `/design` | The internal design-system page is publicly reachable in production (`200`, `noindex` meta, but not listed in `robots.txt` and not behind auth). Harmless content, but exposes internal UI and a fake “Download panel”. | `curl -s -o /dev/null -w '%{http_code}' http://localhost:3205/design` → 200. Suggest dev-only or auth-gated. |
| **BUG-21** | Low (Backend test flake, pre-existing on main) | e2e `[#13]` | `npm run e2e` check “attacker spamming 20 wrong passwords … exactly 3 evaluated” intermittently gets **4** evaluated (status sequence e.g. `401,429,401,401,429,401,429…`): when the 1 s first delay elapses inside the 20-request burst on a loaded box, a further attempt is legitimately evaluated. Product behaviour is correct (see LD-9); the assertion is timing-dependent. | Run `npm run e2e` repeatedly (fails ≈1 in 2–3 runs here; same on `main@94af2c0`: 1 of 3). Owner: Backend (tolerate ≥3 and ≤4 or pin base delay in that test). Logs `qa/evidence-fe1-suite/e2e*.log`, `main3-e2e-*.log`. |

Not bugs, recorded for transparency: (a) `ERR_SSL_PROTOCOL_ERROR` console lines on plain `http://localhost` production builds come from `upgrade-insecure-requests` in the CSP (Frontend documented it; env only). (b) Console `404` on `/signup` and `/u/<id>` are `_rsc` prefetches of `/terms` & `/privacy` (BUG-07, legal parked). (c) My automated contrast scan flagged three white-alpha-on-dark and alpha-on-white items; recomputing with proper alpha compositing they pass (see CHK-A11Y).

## Still-open items from earlier runs (status on this branch)
| ID | Status |
|---|---|
| BUG-07 legal pages | open → M5-16 **BLOCKED-ON-LEGAL** (`/terms /privacy /dmca /contact /2257` → 404; now additionally linked from the buyer-page terms checkbox and signup footer) |
| BUG-11b unpublish never-published draft returns 200 | open (API; the new UI only offers Unpublish on published drops) |
| BUG-13 `text/plain` JSON accepted | open (backend unchanged) |
| **BUG-15 no upload progress bar** | **CLOSED on this branch** (per-file `role=progressbar` with live `aria-valuenow`) |
| BUG-18 `X-Forwarded-For` trust | open (deploy config; note my own probes rotate XFF to avoid per-IP limits) |
| BUG-19 typecheck before first build | open (not re-tested; typecheck clean after build) |
| BUG-20 sustained-polling griefing of login delay | open, accepted risk (Low) |

## Feature checks requested beyond the plan rows
| Area | Result | Evidence |
|---|---|---|
| **CHK-AUTH validation** (signup/signin/forgot/reset) | **PASS.** Empty submit → per-field messages (“Enter the name buyers will see.”, “Enter your email address.”, “Create a password.”) and focus moves to the first invalid field; blur validation (“Enter a valid email address, like name@example.com.”); live strength meter + rule checklist (≥10 chars, not email/name, no repeats/sequences: `aaaaaaaaaaaa`, `abcdefghijkl`, `1234567890123`, password containing own email local-part all rejected client-side); `password1234`/`Qwertyuiop12` pass client rules and the **server** `weak_password` message is shown verbatim and marks the meter “Too common”; `email_taken` → inline “An account with this email already exists.” with focus on email; sign-in error is identical for unknown email and wrong password (no enumeration); show/hide password toggle (`aria-label`, type switches); Enter submits. | `qa/evidence-fe1-c.log`, `-signup.log`, `signup-validation-desktop.png`, `signup-weak-server-desktop.png` |
| **CHK-429 countdown vs real delay** | **PASS.** Real progressive delay (defaults T=5,B=1,cap 60): 5 wrong → 401 ×5; attempt 6 → `429 login_delayed Retry-After:1`, button “Try again in 1s”, card “Too many sign-in attempts / 1s”; then Retry-After sequence **1, 2, 4, 8** matched the UI number each time (ticks `8s,7s,6s`), button re-enables exactly when the countdown ends, evaluated attempt after the wait returns 401 again. Owner flow: 5 wrong, then the correct password immediately → 429 (refused, not evaluated), password field **kept**, countdown 1 s → click → `200` and `/dashboard`. Per-IP limiter `429 rate_limited` shows the different copy “You’re going a little fast”. Submit is disabled while locked, one polite `role=status` announcement at lock end (“You can try again now.”), ticks are `aria-hidden`. Unknown-email attempts behave identically (no enumeration). Forgot-password and checkout also countdown (FE-05 for long waits). | `qa/evidence-fe1-d.log`, `-owner.log`, `-d2.log`, `-l.log`; `login-delay-countdown-*.png`, `forgot-429-desktop.png`, `buyer-checkout-429-desktop.png` |
| **CHK-RESET forgot/reset** | **PASS.** Forgot: validation, done state (“Reset link on its way”, focus moved to the heading, same copy for unknown emails), mail file written (subject “Reset your Unveil password”, `Unveil <no-reply@unveil.link>`, 60-min link, neutral text). Reset: missing token → “Invalid link”; bogus token → “Link expired”; short / weak / email-based passwords rejected inline or by server message; success → “You’re all set … signed out everywhere”, focus on heading; new password logs in (200), old password 401; **token reuse** → “Link expired” (API 400 `invalid_token`); session cookie from before the reset is dead (401); Sign out button works and kills the cookie server-side (401 on replay), also reachable at 390 px. | `qa/evidence-fe1-d2.log`, `-misc.log`, `-m.log`; `reset-*.png`, `forgot-done-desktop.png` |
| **CHK-A11Y** | **PASS with FE-02 (focus return).** All inputs labelled (0 unlabelled in 5 public pages), all images have `alt`, no nameless buttons/links, 1 `h1` per page, `lang=en`, landmarks present, “Skip to content” is the first Tab stop on the dashboard, logical Tab order on `/login`, visible 2 px focus outline on every stop, form errors `role=alert` + `aria-describedby` + focus management, buyer page fully usable keyboard-only (Space on checkbox, Enter on Buy, focus moves to the notice), native `<dialog>` modal (inert background, Esc closes, initial focus inside). Contrast spot-check (alpha-composited): body text 17.3:1, muted text 6.55:1 (on white), white on primary 6.72:1, login brand-panel text 9.35:1 / 6.17:1, table header 5.78:1, buyer footer 6.46:1 — all ≥ 4.5:1. | `qa/evidence-fe1-e.log`, `-f.log` |
| **CHK-XSS** | **PASS.** Display name `Eve <svg onload=window.__x=3> "&'`, title `<img src=x onerror=window.__x=1>"><script>window.__x=2</script>`, description `<b>bold</b> <img src=x onerror=…> &amp; <a href="javascript:…">click</a>` + `{{7*7}}`/`${7*7}`: stored verbatim, rendered as text in dashboard (sidebar name, drop list, editor, publish dialog title, success card) and buyer page; raw HTML contains `&lt;img src=x onerror` and no live `<img onerror>`, `<script>window.__x`, `<svg onload`; `window.__x` stays `undefined`, 0 dialogs, 0 `javascript:` links, 0 `<b>` elements in the description; no template evaluation. | `qa/evidence-fe1-c.log`; `dashboard-xss-desktop.png`, `buyer-xss-desktop.png` |
| **CHK-ORIG originals never exposed** | **PASS.** Buyer page HTML contains no `/original`, `signed-url`, `storage_key`; the only requests are `/api/files/<id>/preview` (6 blurred 320×240 JPEGs for a 1200×900 original); the logged-in dashboard/list/editor also request only `/preview`. Re-run of `qa-backend-1` M1-12/M2-08 probes unchanged. | `qa/evidence-fe1-a.log`, `-n.log`, `qa/evidence-fe1-suite/regress-*.log` |
| **CHK-NOINDEX** | **PASS.** `/u/<id>` (200, 404 and unavailable page): `X-Robots-Tag: noindex, nofollow` + `<meta name="robots" content="noindex, nofollow, nocache">`; `/robots.txt` unchanged (`Disallow: /u/ /d/ /api/ /dashboard`). Dashboard/auth/reset/design pages also `noindex`. | `qa/evidence-fe1-a.log`, `-f.log` |
| **CHK-HDR headers/CSP/console** | **PASS.** CSP (no `unsafe-eval`, `frame-ancestors 'none'`), HSTS, XFO DENY, XCTO, Referrer-Policy, Permissions-Policy present on `/`, `/login`, `/u/<id>`, `/dashboard` (307), `/design`. **0 CSP violations** and 0 page errors in every session. Only console errors: `404` prefetches of `/terms`,`/privacy` (BUG-07), `405`/`404` from my own deliberate method probes, `415` from the deliberately fake image, `501`/`429` from the checkout stub/limiter, and the localhost `ERR_SSL_PROTOCOL_ERROR` (see above). | `qa/evidence-fe1-a.log`, `-b.log`, `-l.log` |
| **CHK-AUTHZ** | **PASS.** Logged-out `/dashboard*` → 307 `/login`, `Cache-Control: private, no-store`, no data in body; seller Jo opening Maya’s drop editor → “We couldn’t find that drop” (same as nonexistent / non-UUID id), Maya’s drops absent from Jo’s list; direct API calls 404. | `qa/evidence-fe1-j.log`, `-k.log` |
| Dashboard empty / pending states | **PASS.** New account: “Nothing here yet” empty state, $0.00 cards, “Verification: Pending / Publishing unlocks once your identity is verified.” Editor for unverified seller: “Publishing locked”. Flagged drop → “Under review” with View only; `/u/<flagged>` 404. | `dashboard-sam-desktop.png`, `editor-unverified-desktop.png` |

## Remaining BLOCKED — on whom
| Blocked cases | On |
|---|---|
| M2-10 edit price/description, M2-13 delete drop | **Backend** (`PATCH /api/drops/:id`, `DELETE /api/drops/:id`, file delete), then **Frontend** edit/delete controls |
| M2-14 download page, M2-12/15/16 | **Backend/Payments** (orders, buyer signed URLs, zip) then Frontend wiring (`DownloadPanel` exists on `/design`) |
| M3-01 (card form / real Buy), M3-02…M3-17, M3-19/20 | **Payments** branch (af475d0 exists; Frontend must re-point Buy at its hosted-page contract and QA re-test) |
| M4-10 views & conversion | **Backend** (view counter) |
| M4-11 transaction history (buyer country, fee breakdown, status) | **Backend** (transactions API + country) then **Frontend** |
| M4-17 profile edit | **Backend** (`PATCH /api/auth/me`) + **Frontend** (profile UI) |
| M4-01…08, 12…16 KYC / payouts / disputes | **Backend** + KYC/payout provider |
| M5-01…15, 17…19 | **Backend** (moderation/admin/reports/audit), M5-19 cookie banner **Frontend** |
| **M5-16 legal pages** | **Legal** (BLOCKED-ON-LEGAL, parked by coordinator) → then Frontend |
| M6-06 status banner | **Backend/Ops** flag + **Frontend** banner |
| M6-04/05/08/09/10 | **Ops/Backend** |
| M1-02 full OAuth, M2-18/M6-07 real devices | **Juice / coordinator** (Google credentials, physical iOS + Android devices) |
| M1-06/09/11 video, resumable upload | **Backend** (video pipeline; the UI deliberately blocks MP4 with a “coming soon” message) |
| M6-01 OWASP review, M6-03 load test | QA, once checkout/download exist |

## Case-by-case results
Rows re-rated in this run are listed in “Cases whose rating changed” above; all other rows carry over from `results-main-2.md` (with a short regression remark appended where re-verified on this branch).

| Case | Result | Evidence / notes |
|---|---|---|
| M1-01 | **PASS** | signup 201 `verification_status:pending`, cookie `HttpOnly; Secure; SameSite=lax; Max-Age=604800`, `/api/auth/me` 200, email lower-cased, bcrypt hash. Headless Chrome: /signup → `/dashboard`, badge “Pending”. |
| M1-02 | **PASS** | **Presence-only (no creds, OAuth round-trip NOT tested).** Google not configured → `/login` and `/signup` render **no** Google control (0 matches) and `GET /api/auth/google` → 501 JSON. With a *fake* `GOOGLE_CLIENT_ID/SECRET` env on a second instance (:3207) the button appears on both pages as a link to `/api/auth/google`, which 307s to `accounts.google.com/o/oauth2/v2/auth?client_id=…&redirect_uri=…/api/auth/google/callback`. Real sign-in/sign-up with Google still needs real credentials (owner: Juice/coordinator). Evidence: `qa/evidence-fe1-i.log`, `qa/artifacts/frontend-dashboard/login-google-button-desktop.png`. |
| M1-03 | **PASS** | dup email 409 `email_taken` (also upper-case); `short` → 400 `weak_password` (“at least 10 characters”); `password` and `12345678` now 400; `not-an-email`, `a@b`, blank name, bad JSON → 400; 1 row per email. FE regression: UI mirrors the cheap rules inline (see CHK-AUTH). |
| M1-04 | **PASS** | Replay of pre-logout cookie → 401 (and `POST /api/drops` 401); other device stays 200; expired/forged sessions 401; relogin 200. Reset flow: `forgot-password` 200 identical for known/unknown; `reset-password` 200, token reuse 400, pre-reset session → 401, new pw 200. **Login throttle is now the progressive delay (fixes-2) — see ‘Progressive login delay’: PASS on every sub-check.** FE regression: forgot/reset UI flow works end to end and signs out everywhere (CHK-RESET). |
| M1-05 | **PASS** | **BUG-15 CLOSED.** New-drop flow uploaded a JPG, PNG and WebP (+ a 3.7 MB JPG): each file row has a `role=progressbar` with `aria-valuenow` (0→100; intermediate values 3,6,10…97 observed under a 4 Mbit/s upload throttle); all four listed in DB with mime `image/jpeg, image/png, image/webp, image/jpeg`; editor “Add files” shows the same bars (2…31 % sampled). Client-side validation: `.txt`/`.gif` → “Unsupported type. Use JPG, PNG or WebP.”, `.mp4` → “MP4 video uploads are coming soon…”, 19 MB JPG → “Images can be up to 15 MB.”; a text file renamed `.jpg` passes client checks, server 415 → “We couldn’t read this image…” + Retry. Evidence: `qa/evidence-fe1-c.log`, `-h.log`, `-o.log`; `qa/artifacts/frontend-dashboard/newdrop-*.png`. |
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
| M2-07 | **PASS** | Anonymous `/u/<id>` (new design) shows: blurred hero + up to 5 blurred thumbnails (natural size 320×240, all from `/api/files/<id>/preview`), title, “by <seller display name>”, description, price, file summary “6 files: 6 images” (types are categories, not JPG/PNG/WebP), terms checkbox, Buy. No original reference in HTML or network (see CHK-ORIG). Evidence: `qa/evidence-fe1-a.log`, `qa/artifacts/frontend-dashboard/buyer-desktop-1280.png`, `buyer-mobile-390x844.png`. |
| M2-08 | **PASS** | Scan of page HTML + RSC payload + `/api/public/drops/:id` JSON for storage_key, `originals/`, `/original`, filenames → none. Only `/api/files/:id/preview` URLs. Anon previews return JPEG blur only. Re-verified on the new buyer page + dashboard pages: only `/api/files/<id>/preview` is requested/rendered (CHK-ORIG). |
| M2-09 | **PASS** | `/u/<id>`: `X-Robots-Tag: noindex, nofollow` + `<meta name="robots" content="noindex, nofollow, nocache">`; same header on public API, previews, signed originals and 404 variant. `/robots.txt` 200 (`Disallow: /u/ /d/ /api/ /dashboard`); `/sitemap.xml` 404; no listing routes (`/u`, `/explore`, `/browse`, `/api/public/drops` → 404). Re-verified on the new buyer page: header + meta + robots.txt unchanged, also on the branded 404 (CHK-NOINDEX). |
| M2-10 | **BLOCKED** | Still blocked on **Backend**: `PATCH`/`PUT`/`DELETE /api/drops/:id` → 405 (re-probed from a logged-in browser session). The new drop editor has **no** edit fields (0 inputs/textarea besides the file picker) – Frontend correctly did not fake it. Needs `PATCH /api/drops/:id` then a Frontend edit form. |
| M2-11 | **PASS** | Dashboard UI: Unpublish (confirm modal) → DB `unpublished`, `/u/<id>` 404 **with the new branded “This link isn’t available” page** (no Buy button; same page for draft / flagged / unpublished / bogus ids, all with `X-Robots-Tag: noindex`), republish through the attestation dialog → `/u/<id>` 200 again. Improvement over main (generic Next 404). Open BUG-11b unchanged at API level (the UI only offers Unpublish on published drops). `POST /api/checkout` for an unpublished link still answers 501 (stub), not 404 – re-check when checkout is real. Evidence: `qa/evidence-fe1-g.log`, `qa/artifacts/frontend-dashboard/buyer-unavailable-desktop.png`, `editor-unpublished-desktop.png`. |
| M2-12 | **BLOCKED** | Needs purchase flow (M3) – not implemented. |
| M2-13 | **BLOCKED** | Still blocked on **Backend**: `DELETE /api/drops/:id` → 405, no file-delete endpoint. No delete control exists in the UI (correct). |
| M2-14 | **BLOCKED** | Confirmed **absent**: there is no buyer download/order route (Frontend notes: only a presentational `DownloadPanel` rendered on `/design`). Blocked on **Backend/Payments** (orders + buyer-minted signed URLs, zip). |
| M2-15 | **BLOCKED** | Expiry works: signed link default TTL now 24 h (`ttl=86399 s`); expired(-10 s) 410, expired(-1 d) 410, valid 200 (signed with the QA instance secret). Receipt link minting a fresh URL needs the buyer/receipt flow (M3) → not implemented. |
| M2-16 | **BLOCKED** | No download-attempt counter/purchase concept; 50 repeat downloads with one signed URL → 50×200. |
| M2-17 | **PASS** | Download route `/api/files/:id/original` (only download endpoint): default limits → 80 sequential bad-sig requests from one IP `403×60, 429×20` with `Retry-After`; other IP unaffected. Login: per-IP 20/15 min unchanged (`429 rate_limited`, Retry-After 894); per-email is now the progressive delay. Caveats: no buyer download endpoint yet; per-IP limiter bypassable with spoofed `X-Forwarded-For` when exposed without a trusted proxy (BUG-18, deploy config). |
| M2-18 | **PASS** | Headless Chrome mobile emulation (touch, DPR 2) at **390×844 and 360×800**: `/u/<id>`, `/`, `/signup`, `/login`, `/forgot-password` and (logged in) `/dashboard`, `/dashboard/drops`, `/dashboard/drops/new`, drop editor → `scrollWidth == clientWidth` everywhere (no horizontal scroll). Buy button 308×52 px (390) / 278×52 px (360), fully inside the viewport, ≥44 px tall, tap works (terms checkbox first, then test-mode notice). Dashboard mobile uses top bar + bottom tabs (Overview / Drops / New drop) and Sign out is reachable. **Emulation only – real iOS Safari / Android Chrome devices not tested.** Evidence: `qa/evidence-fe1-a.log`, `-b.log`, `-o.log`; `qa/artifacts/frontend-dashboard/buyer-mobile-*.png`, `dashboard-maya-mobile-*.png`. |
| M2-19 | **PASS** | CDP throttling, cache disabled, 4× CPU slowdown, mobile viewport, 3 runs each, prod build on localhost (no CDN): **4G (9 Mbit/s, 170 ms RTT)** Buy button visible ≈0.33–0.36 s, FCP 0.62–0.66 s, load event 0.95–0.99 s; **slow 4G (1.6 Mbit/s, 150 ms)** Buy visible ≈0.32–0.40 s, FCP 1.0–1.2 s, load (incl. 6 blurred previews) 1.72–1.73 s – all < 2 s. 217 KB transferred, 16 requests. Caveat: server-side render on loopback; real-network TTFB/CDN not included. Evidence: `qa/evidence-fe1-a.log`. |
| M3-01 | **BLOCKED** | Still blocked on **Payments**: Buy is a stub. Guest click on Buy (after ticking terms) shows **no login/account prompt** (0 login controls) but also **no card form** – `POST /api/checkout` → 501 → friendly notice “Checkout is in test mode — nothing was charged.” (focus moves to the notice). Without ticking terms: “Please confirm to continue.” 11th click inside 60 s → real limiter 429 `Retry-After: 58` → button “Try again in 58s” ticking down. Integration note: the stub targets the *main* 501 `/api/checkout`; the payments branch (af475d0, hosted `/pay/mock/<session>`) changes that contract – Frontend must be re-pointed and re-tested. Evidence: `qa/evidence-fe1-a.log`, `-l.log`. |
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
| M3-18 | **PASS** | On `/u/<id>` the statement is visible **before** the Buy click, twice: checkbox label “I agree to the Terms and understand all sales are final.” (must be ticked, else “Please confirm to continue.”) and the panel “All sales are final. Because files are delivered digitally right away, purchases can’t be refunded.” (`data-testid=final-sale`, visible at 1280 and 390/360 px). Scope: link page only – the hosted payment page of the payments branch (`/pay/mock/<session>`) is a separate surface (that branch’s BUG-5 reported the text missing there) and is not part of this branch. The checkbox’s “Terms” link goes to `/terms` = 404 (BUG-07, legal parked). Evidence: `qa/evidence-fe1-a.log`, `qa/artifacts/frontend-dashboard/buyer-buy-stub-desktop.png`. |
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
| M4-09 | **FAIL** | Numbers are **correct** vs DB but the expected breakdown is incomplete → see FE-01 (Medium). Seed data (SQL, because nothing on this branch writes `transactions`): DB succeeded rows = 30, gross 43,100¢, platform fee 4,310¢, processing 2,156¢, net 36,634¢; payouts paid 15,000¢ / pending 6,000¢. Dashboard shows Gross **$431.00** (30 sales) ✓, “Your 90%” **$366.34** ✓ (= net), Available **$156.34** ✓ (= 366.34 − 150 − 60), Pending payouts **$60.00** ✓ (“$150.00 paid out so far” ✓). Adding a $50 refunded + $50 charged_back row leaves gross/net unchanged ✓ but the hint reads “$100.00 refunded” (charged_back counted as refunded). **Gaps:** platform fees and processing fees are *not shown as separate figures* (only in prose “10% platform fee & processing”), and the headline “Your 90%” is really 85.0 % of gross after processing. New/real accounts show $0 (no write path; Frontend-declared). Evidence: `qa/evidence-fe1-b.log`, `-refund.log`, `qa/artifacts/frontend-dashboard/dashboard-maya-desktop.png`. |
| M4-10 | **BLOCKED** | Per-drop **units sold and revenue are correct** vs DB (Spring 18 / $216.00, Studio 7 / $175.00, Travel 5 / $40.00, others 0 / $0.00; only `succeeded` rows). **Views and conversion do not exist** (no view counter anywhere in backend; Frontend omitted the columns). Blocked on **Backend** (view tracking → conversion). Evidence: `qa/evidence-fe1-b.log`. |
| M4-11 | **BLOCKED** | No transaction-history page/endpoint: `/dashboard/transactions` → 404, dashboard/drops pages contain no per-transaction list; schema has no buyer-country column. Blocked on **Backend** (transactions API + country) and then **Frontend** (page). |
| M4-12 | **BLOCKED** | Not implemented (no KYC provider, payouts, earnings dashboards, profile edit). |
| M4-13 | **BLOCKED** | Not implemented (no KYC provider, payouts, earnings dashboards, profile edit). |
| M4-14 | **BLOCKED** | Not implemented (no KYC provider, payouts, earnings dashboards, profile edit). |
| M4-15 | **BLOCKED** | Not implemented (no KYC provider, payouts, earnings dashboards, profile edit). |
| M4-16 | **BLOCKED** | Not implemented (no KYC provider, payouts, earnings dashboards, profile edit). |
| M4-17 | **BLOCKED** | Blocked on **Backend + Frontend**: `PATCH`/`PUT /api/auth/me` → 405, no profile/settings UI (`/dashboard/settings`, `/dashboard/profile`, `/settings`, `/profile` → 404). No public seller profile page exists ✔ (the buyer page shows only the display name). |
| M4-18 | **PASS** | Automated UI run (excluding the ID-verification wait, which has no UI: `npm run verify-seller` stood in, 1.0 s): signup page → account (2.7 s, incl. 2 validation round-trips) → new drop form → 4 images uploaded (7.9 s at a 4 Mbit/s throttle) → draft → verify → Publish dialog (3 attestations; error “Please confirm all three statements to publish.” until ticked) → **live link `/u/<id>` returns 200 at ≈17.4 s** (≪ 15 min). Verified seller one-step “Upload & publish” (1 file) → live in 1.2 s; attestation stored `{at, over18, ownsRights, consentOfSubjects}`. Caveat: no seller-facing verification flow exists, so a real seller can’t reach “live” until Backend/KYC ships; unverified sellers get a clear “Publishing locked” notice and drafts. Evidence: `qa/evidence-fe1-c.log`, `-o.log`; `qa/artifacts/frontend-dashboard/editor-published-desktop.png`, `publish-dialog-desktop.png`, `newdrop-one-step-published-desktop.png`. |
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
| M5-16 | **BLOCKED-ON-LEGAL** | Parked by coordinator (legal copy pending), not counted as FAIL. Observed: `/terms`, `/privacy`, `/dmca`, `/2257`, `/contact` → 404; landing footer links `/terms`, `/privacy`, `/dmca`, `/contact` (BUG-07 open). Re-checked on frontend/dashboard: still 404; now also linked from the signup footer, the buyer-page terms checkbox and trust footer (404 `_rsc` prefetch console errors on /u and /signup). |
| M5-17 | **BLOCKED** | Not implemented (no moderation, reports API, refunds, admin routes/UI). |
| M5-18 | **BLOCKED** | Not implemented (no moderation, reports API, refunds, admin routes/UI). |
| M5-19 | **BLOCKED** | No cookie-consent banner; only the essential session cookie is set. Frontend. |
| M5-20 | **PASS** | Scope audited: UI copy of all 12 reachable pages (landing, signup, login, forgot, reset, design, buyer page incl. 404/unavailable, dashboard overview/list/new/editor), `<title>`, meta description/OG/Twitter, manifest (`name`, `description`), icons alt/aria text, password-reset email (subject “Reset your Unveil password”, text+HTML), error/validation messages. Regex for adult-market terms (adult, porn, nsfw, explicit, sex*, nude, fetish, escort, 18+, mature, kink…) over rendered HTML: only hits are the required age attestation wording in the publish dialog / `/design` (“Everyone in this content is 18 or older – Anyone who appears in your files is an adult”) – mandated by M2-05; flagged for Legal/Product to confirm the wording is acceptable under M5-20, not a signalling violation. Tagline/description are generic (“Sell your files…”, “photos and videos”). Receipts/other emails don’t exist yet (not audited). Evidence: `qa/evidence-fe1-f.log`, `-m.log`. |
| M6-01 | **NOT RUN** | Full OWASP review not performed. Partial probes all clean: SQL is parameterised (only constant column lists interpolated), XSS payloads escaped on public page, JWT tamper/alg=none 401, CSRF: foreign/`null`/garbage Origin → 403 JSON, IDOR clean (M1-13), decompression cap (10100×10000 → 415), no `dangerouslySetInnerHTML`, only outbound fetch is the fixed Google token URL (+ mail adapters). Open: BUG-13 (`text/plain` accepted). |
| M6-02 | **PASS** | App-level: CSP, HSTS (`max-age=63072000; includeSubDomains; preload`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` present on pages, API, previews, signed originals, 404s, static 404, redirects and POST responses; no `X-Powered-By`. 0 CSP violations in headless Chrome. Secrets: 0 hits in client bundle, `.env` never tracked, cookie HttpOnly/Secure/SameSite=Lax, storage 0700/0600 outside `public/`. Residuals: CSP allows `'unsafe-inline'` scripts (documented); TLS configuration and public-bucket (S3/R2) checks are hosting concerns, not testable locally. Re-verified on faa38d4: CSP/HSTS/XFO/XCTO/Referrer-Policy/Permissions-Policy on pages (no `unsafe-eval`); 0 CSP violations across 40+ page loads (CHK-HDR). |
| M6-03 | **NOT RUN** | Only link page exists; load test not run (checkout/download not built). |
| M6-04 | **BLOCKED** | Not implemented / out of scope for foundation (no backup/monitoring/status page/webhook queue/launch artifacts). |
| M6-05 | **BLOCKED** | Not implemented / out of scope for foundation (no backup/monitoring/status page/webhook queue/launch artifacts). |
| M6-06 | **BLOCKED** | No status page / incident banner exists in UI or backend (no toggle source). Blocked on **Backend/Ops** (banner flag or status feed) then **Frontend**. |
| M6-07 | **PASS** | `/manifest.webmanifest` valid (name, short_name, `display: standalone`, start_url/scope `/`, theme/background colours, 192 + 512 `any` + 512 `maskable` PNG icons, all 200 `image/png`); `apple-touch-icon` 180×180 200; `theme-color`, viewport and `apple-mobile-web-app-*` meta present. Chrome CDP `Page.getInstallabilityErrors` on a persistent (non-incognito) profile → **[]**, `Page.getAppManifest` errors **[]**. No service worker (`/sw.js` 404) – no offline mode; not required by Chrome’s installability check today. **Real-device install and iOS Safari / Android Chrome flow pass not performed** (needs devices). Evidence: `qa/evidence-fe1-e.log`, `-pwa.log`. |
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
git fetch origin && git worktree add --detach /tmp/fe1 origin/frontend/dashboard && cd /tmp/fe1   # expect faa38d4
unset NODE_ENV; cp .env.example .env   # set SESSION_SECRET / SIGNED_URL_SECRET (openssl rand -base64 48), DATABASE_URL (throwaway DB), STORAGE_LOCAL_DIR, MAIL_DEV_DIR
npm ci && npm run migrate && npm run lint && npm run build && npm test
E2E_DATABASE_URL=postgres://…/unveil_e2e_<unique> npm run e2e      # 46/46 (BUG-21 flake: rerun)
bash scripts/dev-start.sh 3205 & BASE_URL=http://localhost:3205 npx tsx scripts/seed-demo.ts   # writes .e2e/seed.json
# from the qa/test-plan checkout (needs playwright-core + /usr/bin/google-chrome):
export BASE=http://localhost:3205 SEED=/tmp/fe1/.e2e/seed.json DB=postgres://…/unveil_fe1 MAIL=<mail dir>
for s in a b c d e f g h j k l m n o; do node qa/scripts/qa-fe1-$s.mjs; done        # buyer/mobile/perf, dashboard numbers, seller flow+XSS, 429+reset, a11y/PWA, …
node qa/scripts/qa-fe1-i.mjs      # BASE_OFF=<no google> BASE_ON=<instance with fake GOOGLE_CLIENT_ID/SECRET>
node qa/scripts/qa-fe1-refund.mjs; node qa/scripts/qa-fe1-modal.mjs; node qa/scripts/qa-fe1-signup.mjs; node qa/scripts/qa-fe1-misc.mjs   # (misc: BASE of a RATE_LIMIT_ENABLED=0 instance)
# backend regression (instance with RATE_LIMIT_ENABLED=0, PUB=/u): qa-backend-1/1b/1c/1d, qa-fixes-1 as in results-main-1.md
```
The older `qa-ui-smoke*.mjs` selectors target the previous UI and are superseded by `qa-fe1-*`. Screenshots (45) are in `qa/artifacts/frontend-dashboard/`; logs in `qa/evidence-fe1-*.log` and `qa/evidence-fe1-suite/`. Reset tokens in logs are redacted; the only credential is the documented demo password.

## Housekeeping
Stopped my servers on :3205, :3206, :3207; removed worktrees `/workspace/fe1` and `/workspace/main3`; dropped nothing outside my throwaway DBs. Servers on :3100, :3120, :3300 (and Frontend’s :3400) were started by others and left running. `proof/db.txt` modified by `npm run e2e` was reverted with `git checkout proof/db.txt` in the throwaway worktrees.
