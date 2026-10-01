# Unveil QA results — backend/fixes-1 re-test

- **Date:** 2026-09-30 22:00–22:15 ET
- **Branch tested:** `origin/backend/fixes-1` @ **`35f46bc18a8410bbfda8b4b93eb22baabb8262c2`** ("e2e: 18 regression checks for fixes-1…"), parent chain `…→ 0829936` (foundation). Tested in a clean git worktree (`/workspace/fixes1`), no app source modified. QA files live only on `qa/test-plan`.
- **Env:** Node 20.19.2, PostgreSQL 17, fresh `npm ci`, migrations 001–003 applied to a throwaway DB `unveil_e2e_qa2`, local storage `/workspace/qa-run2/storage`, random secrets, production build (`next build` / `next start -p 3201`), `MAIL_TRANSPORT=file`. Two app runs: (a) `RATE_LIMIT_ENABLED=0` for the 7-case/regression probes (so the limiter does not interfere with burst tests), (b) **default** rate limits for the rate-limit/password-reset probes (verified via `/proc/<pid>/environ` that no `RATE_LIMIT_*` was set).
- **Probe scripts:** `qa/scripts/qa-fixes-1.mjs` (7 cases), `qa-fixes-1-ratelimit.mjs`, and the existing `qa-backend-1*.mjs` / `qa-ui-smoke*.mjs` (now parameterised with `PUB=/u`, `ENVSH`, `NEXT_STATIC`, and restoring `max_files_per_drop` to the DB's original value).

## Result: 6 of 7 previously failed cases now PASS; 1 still FAILS (M5-16, legal pages — frontend). No regressions found.

| Case | Before | Now | Summary |
|---|---|---|---|
| M1-04 logout revokes session | FAIL | **PASS** | old cookie → 401 after logout; reset flow works |
| M1-08 limits (10 files, race, 2 GB) | FAIL | **PASS** | 10/drop; 30-parallel ×3 → exactly 10; cap enforced at 2 GiB |
| M2-04 links are `/u/<id>` | FAIL | **PASS** | publish returns `/u/<12>`; `/d/<id>` 308 → `/u/<id>` |
| M2-07 public page content | FAIL | **PASS** | seller name, "2 files: 2 images", price, title, blurred previews |
| M2-09 noindex | FAIL | **PASS** | header + meta + robots.txt |
| M5-16 legal pages | FAIL | **FAIL** | `/terms`, `/privacy`, `/dmca`, `/contact` still 404; no 2257 page |
| M6-02 security headers | FAIL | **PASS** | all six headers on pages/API/files/404/redirects; no X-Powered-By |

## Baseline checks on fixes-1
| Check | Result |
|---|---|
| `npm test` | **PASS** — 5 files, 25 tests |
| `npm run typecheck` | **PASS after a build** (see BUG-19: on a fresh checkout it fails first with `layout.tsx(47,50): Cannot find name 'LayoutProps'` until `next build`/typegen has produced Next's global types; `layout.tsx` is unchanged vs foundation, so this is pre-existing, not a regression) |
| `npm run lint` | **PASS** (clean; BUG-16 from run 1 is fixed — `.next-*` now ignored) |
| `npm run e2e` | **PASS — 41/41 checks** (23 original + 18 new), 54 s. Started on :3101 because :3100 is occupied by a stale server from an earlier run (e2e.sh now picks the next free port) |

## The 7 cases — evidence and repro

### M1-04 — PASS (log out / log in / reset, old session invalid)
Evidence (`qa/evidence-fixes1-7cases.log`, `-ratelimit-reset.log`):
- `me-before=200; logout=200; REPLAY old cookie: GET /api/auth/me=401, POST /api/drops=401; other device session still=200; sessions rows total=2 revoked=1` (revocation is per-session, other devices unaffected).
- Re-login after logout 200; session with `expires_at` in the past → 401; forged token (valid `sub`, random `jti`, bad signature) → 401; previous-run checks: tampered JWT / `alg=none` → 401, deleted seller → 401.
- Password reset (new in fixes-1): `forgot-password` → 200 identical body for known/unknown email (no enumeration); mail captured by file transport contains a one-time link, no marketing/adult wording; `reset-password` → 200; token reuse → 400; **pre-reset session → 401**; old password → 401; new password → 200; bogus token → 400 `invalid_token`.
Repro: sign up, copy `unveil_session` value, `POST /api/auth/logout`, `curl -H "cookie: unveil_session=<old>" /api/auth/me` → 401.

### M1-08 — PASS (10 files/drop, parallel race, 2 GB cap)
- `/api/settings` → `maxFilesPerDrop=10`, `maxTotalBytesPerDrop=2147483648`; DB defaults identical.
- Sequential 12 uploads: `201×10, 400, 400` — message `A drop can have at most 10 files` (`too_many_files`).
- **Race (BUG-03 fixed):** 30 parallel uploads to one drop, 3 runs → each `201=10 400=20 other=0`, DB rows = 10, files on disk = 10 (no orphans). Earlier run with limit=5: 25 parallel → exactly 5.
- Per-drop total cap: lowered to 389,437 B (3 × 129,779 B incompressible JPEGs fit): sequential `201,201,201,413,413` (`drop_too_large`, "A drop can hold at most … bytes in total"), stored 389,337 B ≤ cap; 12 parallel → exactly 3 stored, 9×413, total ≤ cap.
- **2 GiB boundary at the real default:** drop pre-seeded (SQL) with a 2 GiB−1000 B row → next upload 413 `drop_too_large`; drop at 2 GiB−1,000,000 B → next ~130 KB upload 201. (A real 2 GB upload was not performed; boundary tested by seeding `size_bytes`.)
- Per-file image cap unchanged: 16 MiB → 413 `file_too_large`. Note: the spec's "500 MB per file" applies to video, which is still unsupported (M1-06/11 remain BLOCKED); image cap is 15 MiB.

### M2-04 — PASS
`publish=200 url=/u/8wzxPJccEKNA` (matches `^/u/[A-Za-z0-9_-]{12}$`); `GET /u/<id>` → 200; legacy `GET /d/<id>` → 308 `Location: /u/<id>`; 40 new links all unique/12 chars. Publish with 0 files still 400 `no_files`.

### M2-07 — PASS
Anonymous `/u/<id>` main text: `Summer set | by Aria Test | · | 2 files: 2 images | desc here | $20.00 | Unlock for $20.00 (payments coming soon)`; 2 blurred `<img>`. API `/api/public/drops/<id>` returns `seller.displayName`, `summary {fileCount:2,imageCount:2,videoCount:0,label:"2 files: 2 images"}`, `priceCents`; with a seeded video row label becomes `3 files: 2 images, 1 video`. No email/UUID leak; scan of HTML + JSON for storage keys / `originals/` / `/original` / filenames → none (M2-08 regression PASS). Note: "types" are shown as image/video categories, not JPG/PNG/WebP (acceptable for the plan wording "file count + types").

### M2-09 — PASS
- `/u/<id>`: `X-Robots-Tag: noindex, nofollow` and `<meta name="robots" content="noindex, nofollow, nocache">`.
- Also on `/api/public/drops/<id>`, `/api/files/<id>/preview`, signed `/original`, and the 404 variant of `/u/<unknown>`. (`/d/<id>` 308 redirect itself has no header — irrelevant, target has it.)
- `/robots.txt` 200: `Disallow: /u/ /d/ /api/ /dashboard`; `/sitemap.xml` 404 (no sitemap entry); no listing routes (`/u`, `/explore`, `/browse`, `/api/public/drops` all 404).

### M5-16 — FAIL (unchanged; owner Frontend)
`/terms=404 /privacy=404 /dmca=404 /2257=404 /legal=404 /contact=404 …` (`qa/evidence-fixes1-7cases.log` + `bash` loop in run notes). Landing page footer links `/terms`, `/privacy`, `/dmca`, `/contact` (all dead). `grep -ril 2257 src components` → none. Backend NOTES list this as "not in scope / frontend", so unchanged is expected.
Repro: `curl -s -o /dev/null -w '%{http_code}' http://localhost:3201/terms` → 404.

### M6-02 — PASS
On `/`, `/u/<id>`, `/login`, `/api/settings`, `/api/public/drops/<id>`, preview, signed original, a 404 page, a static-asset 404, the `/dashboard` 307, and a POST response: all of `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` present; `X-Powered-By` absent.
CSP: `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; upgrade-insecure-requests`. HSTS `max-age=63072000; includeSubDomains; preload`.
Headless Chrome (signup → dashboard → create draft → upload → preview render): **0 CSP violations / page errors**. Secrets in client bundle: 0 hits. Residual: CSP allows `'unsafe-inline'` scripts (documented by backend; nonce CSP is future work). HTTPS redirect/TLS is a hosting concern, not testable locally.

## Regression check (previously PASSed cases, re-run on fixes-1)
Re-ran `qa-backend-1.mjs`, `1b`, `1c`, `1d`, UI smoke 1 & 2 and compared to run 1. Logs: `qa/evidence-fixes1-regression-*.log`.

| Case | Previous | Now | Notes |
|---|---|---|---|
| M1-01 | PASS | PASS | signup 201 pending, cookie HttpOnly/Secure/Lax; UI → `/dashboard`, badge "Pending" |
| M1-03 | PASS | PASS (stronger) | dup 409; `short` → 400 `weak_password` "at least 10 characters"; `password`, `12345678` now 400 (BUG-14 fixed) |
| M1-05 | PASS | PASS | JPG/PNG/WebP 201 + listed; UI upload shows preview (still no progress bar, BUG-15) |
| M1-07 | PASS | PASS | GIF/PDF/EXE/renamed/SVG/TIFF/AVIF 415, empty 400, hostile filename sanitised |
| M1-10 | PASS | PASS | preview 320×213, 1418 B, text unreadable, EXIF stripped, identical output |
| M1-12 | PASS | PASS | 14 guessed URLs 404/403/308; signed URL 200 byte-identical, `no-store`, attachment; sig bound to file + exp; TTL now 86400 s (BUG-12 fixed) |
| M1-13 | PASS | PASS | all cross-seller routes 404; identical to nonexistent; anon 401 |
| M2-01 | PASS | PASS | draft created, listed (cover image still unimplemented) |
| M2-02 | PASS | PASS | 99/50001/neg/0/float/string → 400; 100 and 50000 → 201; live settings narrowing works |
| M2-03 | PASS | PASS | pending/failed/manual_review → 403 `verification_required`; mass-assignment ignored |
| M2-05 | PASS | PASS (improved) | 2/3, 0/3, missing → 400; all true → stored; re-publish **no longer overwrites** first attestation (`attested_at` kept; `attestation_history` appended) |
| M2-06 | PASS | PASS | 120 unique, 12-char, χ² 73.9 (crit 82.5), 300 random + sequential guesses 404 |
| M2-08 | PASS | PASS | no original keys/URLs/filenames in page or API |
| M2-11 | PASS | PASS | unpublish → public 404, preview 404, republish 200 |
| M4-06 | PASS | PASS | server-side publish block unchanged |
| S2-04 | PASS | PASS | always blocked for non-verified |
| Others that changed state | — | — | M1-08, M2-04, M2-07, M2-09, M6-02 above |

Still-BLOCKED items are unchanged except: **M1-04 reset** (now implemented, PASS), **M2-17** (rate limiting now implemented, see below; the buyer download endpoint itself does not exist, so M2-17 stays BLOCKED for the buyer-download scenario), `/api/checkout` stub (501). Other blocked/not-implemented probes re-confirmed identical (MP4 → 415, tus → 405, edit/delete → 405, admin routes 404).

**Regression verdict: none found.** All 16 prior PASSes still PASS; e2e 41/41; unit tests 25/25.

## Extra verification of new backend features (default limits, app run without `RATE_LIMIT_ENABLED=0`)
| Probe | Result |
|---|---|
| 15 wrong logins, same IP+email | `401 ×10, 429 ×5`, `Retry-After: 897` |
| Correct password while that email is throttled | **429** (see BUG-17) |
| 15 logins, 15 different emails, one IP | `401 ×15` (per-IP login limit is 20 / 15 min) |
| 25 wrong logins for ONE email, rotating spoofed `X-Forwarded-For` | `401 ×10, 429 ×15` (per-email limit holds) |
| 25 logins / 25 different emails, rotating spoofed XFF | `401 ×25` (per-IP limit bypassed, see BUG-18) |
| 80 sequential `/api/files/:id/original` (bad sig), one IP | `403 ×60, 429 ×20` (60/min); other IP unaffected |
| `POST /api/checkout` ×14 (limit 10/60 s) | `429`/`501` as configured |
| Same-origin `Origin` / text/plain w/o Origin (unauthenticated) | 401 (guard OK); `Origin: null` / `garbage` → **403 JSON** (BUG-08 fixed) |

## Bugs — status after fixes-1
| ID | Was | Now |
|---|---|---|
| BUG-01 logout doesn't revoke | Medium | **Fixed** |
| BUG-02 no noindex | Medium | **Fixed** |
| BUG-03 file-limit race | Medium | **Fixed** (also size cap atomic) |
| BUG-04 limits vs spec | Medium | **Fixed** (10 files, 2 GiB; video 500 MB n/a until video exists) |
| BUG-05 public page content | Medium | **Fixed** |
| BUG-06 no rate limiting | Medium | **Fixed** (see BUG-17/18 for caveats) |
| BUG-07 legal pages 404 | Medium | **OPEN** (Frontend) |
| BUG-08 `Origin` → 500 | Low | **Fixed** |
| BUG-09 `/d` vs `/u` | Medium | **Fixed** |
| BUG-10 security headers | Low/Med | **Fixed** |
| BUG-11 attestation overwritten / unpublish draft | Low | **Half fixed** — attestation preserved + history ✔; `unpublish` of a never-published draft still 200 `unpublished` |
| BUG-12 TTL 300 s | Low | **Fixed** (24 h default, configurable) |
| BUG-13 `text/plain` JSON accepted | Low | **OPEN** (unchanged) |
| BUG-14 weak passwords | Low | **Fixed** |
| BUG-15 no upload progress bar | Low (FE) | **OPEN** |
| BUG-16 lint on `.next-e2e` | Low | **Fixed** |

### New findings (none above Low/Medium; no regressions)
- **BUG-17 (Low/Medium) — per-email login lockout is a DoS vector.** After 10 failed attempts for an email in 15 min, even the *correct* password gets 429 (`Retry-After` ~900 s), regardless of source IP. Anyone who knows a seller's email can keep them locked out. Repro: `for i in $(seq 12); do curl -s -o /dev/null -w '%{http_code} ' -XPOST localhost:3201/api/auth/login -H 'content-type: application/json' -H "x-forwarded-for: 1.2.3.$i" -d '{"email":"victim@example.com","password":"bad"}'; done` then log in with the right password → 429. Mitigation ideas: count only failures, key on (email+IP) in addition, or require a CAPTCHA/backoff instead of hard lockout; ensure password reset still works while locked (it does: reset revokes sessions and resets via mail link).
- **BUG-18 (Low, deployment) — client IP is attacker-controlled when the app is reachable without a trusted proxy.** `clientIp()` takes the Nth-from-right `X-Forwarded-For` entry (default 1 hop), so with direct exposure a single spoofed header value picks the rate-limit bucket (25 logins across 25 emails with random XFF → all 401). Per-email limits still hold. Documented in backend NOTES (`TRUSTED_PROXY_HOPS`); needs a deploy-time check (set hops to the real count, or 0 behind no proxy → use socket address).
- **BUG-19 (Low, dev) — `npm run typecheck` fails on a fresh checkout** (`Cannot find name 'LayoutProps'` in `src/app/layout.tsx`) until `next build`/`next typegen` creates Next's route types. Pre-existing (file unchanged), CI should run `next typegen` or build first.
- Observation: forgot-password mail is written asynchronously after the HTTP response (dev transport); fine, noted because the first version of my probe raced it.

## Not covered / caveats
- Real 2 GB upload not performed (boundary verified by seeding rows); Resend/Postmark adapters untested (backend also states untested live).
- Stale servers from earlier runs (ports 3100, plus other `next-server` processes not started by this QA run) are still running on the box; I stopped only my own :3200/:3201 servers.
- M5-16/BUG-07 and the other Frontend-blocked items from `qa/results-backend-foundation-1.md` are unchanged.

## Reproducing
```bash
git fetch origin && git worktree add /tmp/fixes1 origin/backend/fixes-1 && cd /tmp/fixes1 && npm ci
npm test && npm run e2e                       # 25 tests, 41/41 e2e checks (typecheck needs a build first, BUG-19)
export DATABASE_URL=postgres://unveil:unveil@localhost:5432/unveil_e2e_qa2 SESSION_SECRET=$(openssl rand -base64 48) SIGNED_URL_SECRET=$(openssl rand -base64 48) \
  STORAGE_DRIVER=local STORAGE_LOCAL_DIR=/tmp/qa-storage MAIL_TRANSPORT=file MAIL_DEV_DIR=/tmp/qa-mail NODE_ENV=production APP_URL=http://localhost:3201 NEXT_DIST_DIR=.next-qa
E2E_DATABASE_URL=$DATABASE_URL npx tsx scripts/e2e-setup.ts && npx next build
RATE_LIMIT_ENABLED=0 npx next start -p 3201 &
# from the qa/test-plan checkout:
export BASE=http://localhost:3201 DB=$DATABASE_URL PUB=/u STORAGE_LOCAL_DIR=/tmp/qa-storage
node qa/scripts/qa-fixes-1.mjs; node qa/scripts/qa-backend-1.mjs; node qa/scripts/qa-backend-1b.mjs; node qa/scripts/qa-backend-1c.mjs; node qa/scripts/qa-backend-1d.mjs
# restart WITHOUT RATE_LIMIT_ENABLED=0, then:
MAIL_DEV_DIR=/tmp/qa-mail node qa/scripts/qa-fixes-1-ratelimit.mjs
```

## Status update (Sept 30, 2026, 10:20 PM ET)
- M5-16 re-classified from FAIL to **BLOCKED-ON-LEGAL**. Legal pages are parked by the coordinator until further notice; nothing for Frontend to build without the copy.
- Merge of `backend/fixes-1` to main approved by coordinator. Full-suite re-run on `main` to follow after the merge lands.
