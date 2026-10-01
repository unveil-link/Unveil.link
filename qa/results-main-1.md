# Unveil QA results — `main` full-suite run 1

- **Date:** 2026-09-30 22:23–22:45 ET
- **Branch tested:** `origin/main` @ **`35f46bc18a8410bbfda8b4b93eb22baabb8262c2`** — identical to `origin/backend/fixes-1` (`git diff origin/backend/fixes-1 origin/main` is empty; both refs resolve to the same SHA). Tested in a clean detached worktree (`/workspace/main1`); no app source modified; nothing pushed to `main`.
- **Env:** Node 20.19.2, PostgreSQL 17. Clean `npm ci`; `.env` copied from `.env.example` with freshly generated `SESSION_SECRET` / `SIGNED_URL_SECRET` and DB `unveil_main1` (`npm run migrate` → 001, 002, 003 applied). Probe runs used a separate throwaway DB `unveil_e2e_qa3`, storage `/workspace/qa-run3/storage`, mail dir `/workspace/qa-run3/mail`, new random secrets, production build on :3202. Probes ran with `RATE_LIMIT_ENABLED=0` (burst tests); rate-limit/reset probes ran with defaults (checked via `/proc/<pid>/environ`).
- **Plan scope:** the plan file has 106 numbered rows (header says 94): 14 M1, 19 M2, 20 M3, 18 M4, 20 M5, 10 M6, 5 S2. All 106 rated below. **M5-16 is BLOCKED-ON-LEGAL (parked by coordinator), not FAIL.**

## Suite results on `main`

| Check | Expected | Result |
|---|---|---|
| `npm ci` | clean | OK (0 vulnerabilities) |
| `npm run migrate` | 3 migrations | **applied 001, 002, 003** |
| `npm test` | 25 | **25/25 passed** (5 files) |
| `npm run e2e` | 41 | **41/41 checks passed** (53 s; auto-picked :3101) |
| `npm run typecheck` | clean | **clean** (after the e2e build) — BUG-19 still applies on a truly fresh checkout |
| `npm run lint` | clean | **clean** |

## Case summary (106 rows)

| Milestone | PASS | FAIL | BLOCKED | NOT RUN | Total |
|---|---|---|---|---|---|
| M1 | 9 | 0 | 5 | 0 | 14 |
| M2 | 11 | 0 | 7 | 1 | 19 |
| M3 | 0 | 0 | 20 | 0 | 20 |
| M4 | 1 | 0 | 17 | 0 | 18 |
| M5 | 0 | 0 | 19 | 1 | 20 |
| M6 | 1 | 0 | 7 | 2 | 10 |
| S2 | 1 | 0 | 4 | 0 | 5 |
| **Total** | **23** | **0** | **79** (incl. 1 BLOCKED-ON-LEGAL) | **4** | **106** |

**No FAILs.** 23 PASS = the 16 from run 1 + the 7 previously failing cases fixed by fixes-1 (M1-04, M1-08, M2-04, M2-07, M2-09, M6-02) + M2-17 (rate limiting now on the signed-download route). Everything else is BLOCKED (feature not built / needs frontend, device, legal, or an external provider) or NOT RUN (M2-19 throttled-4G, M5-20 full branding audit, M6-01 full OWASP review, M6-03 load test; partial probes noted in the table).

## Regression vs `qa/results-fixes-1.md`
Re-ran `qa-backend-1.mjs`, `1b`, `1c`, `1d`, `qa-fixes-1.mjs`, `qa-fixes-1-ratelimit.mjs`, both UI smokes and diffed the logs against the fixes-1 logs after normalising ids/timestamps (`qa/evidence-main1-*.log` vs `qa/evidence-fixes1-*.log`). Differences are limited to random ids/byte counts.

| Area | fixes-1 result | main result | Same? |
|---|---|---|---|
| 7 retested cases (M1-04, M1-08, M2-04, M2-07, M2-09, M6-02 PASS; M5-16 FAIL→now BLOCKED-ON-LEGAL) | as reported | identical outputs (old cookie 401; 10 files, 30-parallel → exactly 10; `/u/<id>` + `/d` 308; seller/summary on page; noindex + robots.txt; 6 headers everywhere) | ✔ |
| Previously PASSing M1/M2/M4-06/S2-04 | 16 PASS | 16 PASS | ✔ |
| Rate limits (default config) | login per-email 10/15 min → 429 + `Retry-After`; download 60/min; checkout stub 10/min | `401×10, 429×5` / `403×60, 429×20` / `429×4, 501×10` | ✔ |
| Password reset | works end to end | works end to end (reuse 400, sessions revoked) | ✔ |
| e2e / unit | 41/41, 25/25 | 41/41, 25/25 | ✔ |
| Open items (BUG-07, 11b, 13, 15, 17, 18, 19) | open | **still open, unchanged** (see below) | ✔ expected |

**Regression verdict: none. `main` behaves identically to `backend/fixes-1`.**

## Known open items (not in this build — confirmed still present, not counted as new)
| ID | Status on main | Evidence |
|---|---|---|
| BUG-07 legal pages | open / case now BLOCKED-ON-LEGAL | `/terms /privacy /dmca /2257 /contact` → 404 |
| BUG-11b unpublish never-published draft | open | `POST /unpublish` on draft → 200 `unpublished` |
| BUG-13 `text/plain` CSRF hardening | open | `POST /api/drops` with `content-type: text/plain`, no Origin, valid session → 201 |
| BUG-15 upload progress bar | open | 0 `progress` elements in UI smoke |
| BUG-17 per-email lockout DoS | open (progressive delay expected on `backend/fixes-2`) | 10 wrong → correct password gets 429 for ~900 s |
| BUG-18 `X-Forwarded-For` trust | open (deploy config) | 25 logins with rotating spoofed XFF, 25 emails → all 401 (per-IP limit bypassed; per-email limit holds) |
| BUG-19 typecheck on fresh checkout | open (dev) | `Cannot find name 'LayoutProps'` before first build |

## New bugs
**None new in this run** (no FAILs, no regressions). Observations only:
- M2-06 χ² for link-id randomness came out at 79.4 (df 63; 5% critical value ≈ 82.5) — still within bounds; earlier runs 64.8 and 73.9. Three of three runs pass; code uses `crypto.randomBytes(9)`. Re-sample if it recurs near/above 82.5.
- Public-page "file types" are shown as categories ("2 files: 2 images"), not JPG/PNG/WebP — acceptable reading of the plan, flagged for product to confirm.
- Public API returns both `seller.displayName` and legacy `seller.display_name` (harmless duplicate).
- `/d/<id>` 308 redirect response has no `X-Robots-Tag` (target does) — irrelevant to indexing.

## Not testable here (explicit)
Google OAuth (needs credentials), real 2 GB upload (boundary tested by seeding `size_bytes`), TLS/HTTP→HTTPS/hosting/CI/backups/monitoring, S3/R2 adapter, Resend/Postmark adapters, mobile devices and throttled-4G, payments/payout/KYC/admin/moderation (not built).

## Blocked on Frontend / Legal / other (unchanged from fixes-1 except M5-16 reclassified)
- **BLOCKED-ON-LEGAL:** M5-16 (and M6-10 launch checklist items that depend on counsel-reviewed legal pages).
- **Frontend:** M1-02 button, M1-05 progress bar, M2-10 edit UI, M2-11 "unavailable" page, M2-13 delete UI, M2-14 download page, M2-18/19 mobile+perf, M3-01/15/18/19/20 checkout UI, M4-01/09–12/18 dashboards & onboarding, M5-04, M5-17, M5-19, M5-20, M6-06, M6-07, S2-01/02.
- **Backend not built:** video upload/thumbnails (M1-06/11), resumable upload (M1-09), drop edit/delete, buyer download/zip/attempt cap (M2-12–16), payments/webhooks/fees (M3), KYC/payout/profile (M4), moderation/reports/refunds/admin/suspend/audit/GDPR (M5), backup/monitoring/webhook queue (M6).

## Case-by-case results

| Case | Result | Evidence / notes |
|---|---|---|
| M1-01 | **PASS** | signup 201 `verification_status:pending`, cookie `HttpOnly; Secure; SameSite=lax; Max-Age=604800`, `/api/auth/me` 200, email lower-cased, bcrypt hash. Headless Chrome: /signup → `/dashboard`, badge “Pending”. |
| M1-02 | **BLOCKED** | Needs real Google credentials. `GET /api/auth/google` → 501 JSON; callback → 307 `/login?error=google_not_configured`. |
| M1-03 | **PASS** | dup email 409 `email_taken` (also upper-case); `short` → 400 `weak_password` (“at least 10 characters”); `password` and `12345678` now 400; `not-an-email`, `a@b`, blank name, bad JSON → 400; 1 row per email. |
| M1-04 | **PASS** | Replay of pre-logout cookie → `/api/auth/me` **401** and `POST /api/drops` 401; other device's session stays 200; sessions row `revoked_at` set; expired session 401; forged jti 401; relogin 200; wrong pw/unknown user 401. Password reset: `forgot-password` 200 identical for known/unknown email; mail (file transport) has one-time link, no marketing wording; `reset-password` 200, token reuse 400, pre-reset session → 401, old pw 401, new pw 200, bogus token 400. Default rate limits active (see M2-17). |
| M1-05 | **PASS** | API: JPG/PNG/WebP each 201 and listed with correct mime. UI (headless Chrome): upload via drop page → file + blurred preview shown. Known open BUG-15: no progress bar (0 `progress` elements) — FE expectation not met, tracked. |
| M1-06 | **BLOCKED** | MP4 not implemented: `.mp4` (valid, ffmpeg-generated) → 415 `invalid_image`. README: video upload not built. |
| M1-07 | **PASS** | Content sniffed with sharp, not MIME/extension: GIF 415 `unsupported_type`; PDF 415; EXE (`MZ…`) 415; EXE renamed .jpg w/ image/jpeg 415; PDF as .jpg 415; SVG-with-script as .jpg 415; TIFF/AVIF 415; empty 400; missing `file` field 400; non-multipart 400. Hostile filename `../../etc/<script>"x.jpg` stored as `.._.._etc_script_x.jpg`. Info: valid JPEG + appended `<?php…` bytes accepted & stored verbatim (only served as attachment+nosniff via signed URL; preview is re-encoded). |
| M1-08 | **PASS** | Limits: `/api/settings` → `maxFilesPerDrop=10`, `maxTotalBytesPerDrop=2147483648`. 12 sequential → `201×10, 400, 400` (`too_many_files`). Race: 30 parallel ×3 runs → each exactly 10×201/20×400, DB rows 10, files on disk 10. Total-size cap (set to 389,404 B): sequential `201,201,201,413,413` (`drop_too_large`); 12 parallel → exactly 3 stored, total ≤ cap. 2 GiB boundary at default tested by seeding `size_bytes` (drop at 2 GiB−1000 B → next upload 413; at 2 GiB−1,000,000 B → 201); a real 2 GB upload was not performed. 16 MiB image → 413 `file_too_large`. (Spec's 500 MB/file applies to video, not implemented.) |
| M1-09 | **BLOCKED** | Resumable/tus-style upload not implemented: `PATCH`/`HEAD` on upload route → 405, `/api/uploads` → 404. README: S3 presigned/streaming uploads not built. |
| M1-10 | **PASS** | Text image (“CONFIDENTIAL / Name: Jane Roe / Card 4111…”) 1200×800 → preview 320×213 JPEG 1418 B (orig 65652 B); visually inspected: text/face unreadable (`qa/artifacts/blur-original.jpg` vs `blur-preview.jpg`); horizontal-gradient energy 3.7% of original; preview contains no original bytes; EXIF/GPS/ICC/XMP stripped (input with Copyright=SECRET-QA → not in preview). Draft preview: anon 404, other seller 404. |
| M1-11 | **BLOCKED** | Video previews not implemented (no video upload). |
| M1-12 | **PASS** | 14 guessed/traversal URLs → 404/403/308, none returned original. Disk mode 600 outside `public/`. Owner-minted signed URL: anon GET 200 byte-identical, `no-store`, attachment, nosniff, TTL 86399 s (24 h). Sig reused on other file → 403; exp extended → 403. |
| M1-13 | **PASS** | Seller B vs seller A's drop/file: GET drop 404, upload 404, publish 404, unpublish 404, mint signed-url 404, draft preview 404; list endpoint doesn't leak; anon → 401. 404 body identical to nonexistent-UUID response (`{"error":"Drop not found"}`) – no enumeration oracle. Non-UUID/SQLi-ish ids → 404. |
| M1-14 | **BLOCKED** | Schema verified on main after migration 003: sellers, drops, drop_files, transactions, payouts, reports, audit_log, admins, platform_settings (+ sessions, password_reset_tokens, rate_limits) with all spec fields incl. attestation (+history) columns. CI/CD config (no `.github/`), hosting and HTTP→HTTPS redirect are not in the repo → cannot verify. |
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
| M2-17 | **PASS** | Download delivery route `/api/files/:id/original` (the only download endpoint): default limits → 80 sequential bad-sig requests from one IP `403×60, 429×20` (`Retry-After` sent), other IP unaffected. Caveat: no buyer download endpoint/receipt flow exists yet, so this covers the signed-URL route only; per-IP limit is bypassable with spoofed `X-Forwarded-For` when app is directly exposed (BUG-18). |
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
git fetch origin && git worktree add --detach /tmp/main1 origin/main && cd /tmp/main1
cp .env.example .env   # set SESSION_SECRET and SIGNED_URL_SECRET (openssl rand -base64 48) and DATABASE_URL to a throwaway DB
npm ci && npm run migrate && npm test && npm run e2e     # 25 tests, 41/41 checks
# probe run (from the qa/test-plan checkout), app started per qa/results-fixes-1.md "Reproducing":
export BASE=http://localhost:3202 DB=<throwaway> PUB=/u STORAGE_LOCAL_DIR=<storage> ENVSH=<env.sh> NEXT_STATIC=<.next-qa/static>
for s in backend-1 backend-1b backend-1c backend-1d fixes-1; do node qa/scripts/qa-$s.mjs; done
# restart with default rate limits, then: MAIL_DEV_DIR=<mail dir> node qa/scripts/qa-fixes-1-ratelimit.mjs
node qa/scripts/qa-ui-smoke.mjs; node qa/scripts/qa-ui-smoke2.mjs
```

## Housekeeping
Stopped my :3202 app server at the end of the run (and :3200/:3201 earlier). Three other `next-server` processes (:3100, :3120, :3300) were started by other agents/runs before/outside this QA session (PIDs 911751, 913251, 984977) and were left running.
