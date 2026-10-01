# Unveil QA results — backend/foundation, run 1

- **Date:** 2026-09-30 (America/New_York), run ≈ 20:37–21:00 ET
- **Build under test:** `origin/backend/foundation` @ `0829936` ("README: accurate blur threshold"); QA branch `qa/test-plan` (adds only `qa/` files; no app/source files modified)
- **Env:** Node 20.19.2, PostgreSQL 17 (local apt), `npm ci`, production build (`next build` + `next start -p 3200`), `STORAGE_DRIVER=local`, throwaway DB `unveil_e2e_qa` + storage dir `/workspace/qa-run/storage`, fresh random secrets. Google OAuth, S3 and payments not configured.
- **Baseline checks:** `npm test` 4/4 pass · `npm run typecheck` clean · `npm run e2e` **23/23 checks passed** (18 s) · `eslint src scripts tests` clean (note `npm run lint` at repo root reports 418 errors only because `.next-e2e`/`.next-qa` build output is not in `globalIgnores`, BUG-16).
- **Method:** HTTP probes with Node `fetch` (scripts in `qa/scripts/`), SQL checks/state changes via psql/pg (verification status flips use the same mechanism as `npm run verify-seller`; settings edited via SQL as README describes), headless system Chrome (playwright-core) for UI smoke, visual inspection of blur output (`qa/artifacts/`). Raw output: `qa/evidence-run*.log`.
- **Legend:** PASS / FAIL / BLOCKED (feature not implemented, or needs frontend / device / external service) / NOT RUN. A case is PASS only if every *backend-observable* part of its expected result held; where a frontend-only part is missing it is noted.
- **Scope note:** the plan file's header says 94 cases but it actually contains 106 numbered rows (14 M1 + 19 M2 + 20 M3 + 18 M4 + 20 M5 + 10 M6 + 5 S2). All 106 are rated below. M3–M6 are all rated, but nearly all are BLOCKED because the README states payments, payouts, ID provider, video, admin, reports, moderation are **not built**; a few were partially probed for real.

## Summary

| Milestone | PASS | FAIL | BLOCKED | NOT RUN | Total |
|---|---|---|---|---|---|
| M1 | 7 | 2 | 5 | 0 | 14 |
| M2 | 7 | 3 | 8 | 1 | 19 |
| M3 | 0 | 0 | 20 | 0 | 20 |
| M4 | 1 | 0 | 17 | 0 | 18 |
| M5 | 0 | 1 | 18 | 1 | 20 |
| M6 | 0 | 1 | 7 | 2 | 10 |
| S2 | 1 | 0 | 4 | 0 | 5 |
| **Total** | **16** | **7** | **79** | **4** | **106** |

**Headline:** the implemented foundation (auth, drafts, image upload/blur, private storage, signed URLs, publish gating, IDOR) is solid — no critical/high security defects found. The 7 FAILs are: session not revocable on logout, no noindex on link pages, file limits differ from spec (+ race), public page missing seller name/file count/types, link format `/d/` vs `/u/`, legal pages 404, and missing security headers.

## Bugs found

| ID | Sev | Title | Cases |
|---|---|---|---|
| BUG-01 | **Medium** | Logout doesn't invalidate the session token (stateless JWT, valid 7 days) | M1-04 |
| BUG-02 | **Medium** | Public link page / API have no noindex (no `X-Robots-Tag`, no meta robots, no robots.txt) | M2-09 |
| BUG-03 | **Medium** | `max_files_per_drop` check is racy: parallel uploads exceed limit | M1-08 |
| BUG-04 | **Medium** | Default limits don't match spec: 20 files/drop (spec 10), no per-drop total-size cap (spec 2 GB), image cap 15 MiB, video unsupported (spec 500 MB) | M1-08 |
| BUG-05 | **Medium** | Public drop page omits seller display name, file count and file types (price only inside a disabled button) | M2-07 |
| BUG-06 | **Medium** | No rate limiting anywhere (login, signup, link-guessing, `/original`) | M2-17, M1-04 |
| BUG-07 | **Medium** | Footer links `/terms`, `/privacy`, `/dmca` → 404; no 2257 page | M5-16 |
| BUG-08 | Low | `Origin: null` / malformed `Origin` on a mutating request → HTTP 500 (unhandled `Invalid URL`) | M6-01 |
| BUG-09 | **Medium** | Published link is `/d/<12>` but spec/plan says `/u/<12>`; `/u/<id>` → 404 | M2-04 |
| BUG-10 | Low/Med | No security headers (HSTS, X-Frame-Options/frame-ancestors, CSP, Referrer-Policy, Permissions-Policy) on pages/API | M6-02 |
| BUG-11 | Low | Re-publish overwrites attestation timestamp (no history/IP/UA kept; matters for 2257 audit); `unpublish` on a never-published draft sets `unpublished` | M2-05, M2-11 |
| BUG-12 | Low | Signed-URL default TTL 300 s vs spec 24 h download validity (no receipt flow yet to mint fresh links) | M2-15 |
| BUG-13 | Low | State-changing JSON endpoints accept `Content-Type: text/plain` with no `Origin` header (CSRF guard only blocks *mismatching* Origin; relies on SameSite=Lax) | M6-01 |
| BUG-14 | Low | Password policy = length ≥ 8 only (`password`, `12345678` accepted) | M1-03 |
| BUG-15 | Low (FE) | Upload UI has no progress bar (plain `fetch`) | M1-05 |
| BUG-16 | Low (dev) | `npm run lint` fails with 418 errors from generated `.next-e2e` (not ignored in `eslint.config.mjs`) | — |

### Repro steps

**BUG-01 Logout doesn't revoke session (Medium).**
```
curl -c jar -H 'content-type: application/json' -d '{"email":"u@x.com","password":"Passw0rd!long","displayName":"u"}' localhost:3200/api/auth/signup
OLD=$(awk '/unveil_session/{print $7}' jar)
curl -b jar -X POST localhost:3200/api/auth/logout
curl -H "cookie: unveil_session=$OLD" localhost:3200/api/auth/me     # -> 200 with seller (expected 401)
```
Cause: `src/server/auth/session.ts` — stateless HS256 JWT, only clears the browser cookie (README admits "no server-side revocation list yet"). Fix idea: session table or per-seller `token_version`/`sessions_valid_after`.

**BUG-02 No noindex (Medium).** Publish a drop, then `curl -si localhost:3200/d/<link>` → no `X-Robots-Tag`, no `<meta name="robots">`; `/robots.txt`, `/sitemap.xml` 404; `/api/public/drops/<link>` and `/api/files/<id>/preview` also lack it. Spec requires noindex (meta + header). Fix idea: `export const metadata = {robots:{index:false,follow:false}}` on `d/[linkId]/page.tsx`, `X-Robots-Tag: noindex` via `next.config` headers for `/d/*` and `/api/files/*/preview`, plus `robots.txt` disallow.

**BUG-03 File-limit race (Medium).** `UPDATE platform_settings SET max_files_per_drop=5;` create a drop; send 25 concurrent `POST /api/drops/:id/files` → 25×201, 25 rows (sequential: 5×201 then 400). Cause: count-then-insert without lock/tx in `services/images.ts`. Fix: `SELECT … FOR UPDATE` on the drop row (or advisory lock) in a tx. Also lets a seller exceed any per-drop quota/storage.

**BUG-04 Limits vs spec (Medium).** `SELECT max_files_per_drop, max_image_size_bytes, max_video_size_bytes FROM platform_settings` → 20 / 15 MiB / 500 MiB. Upload 11 images to one drop → all 201 (spec: 11th blocked). No code/schema enforces a 2 GB per-drop total (`grep` finds none). Per-file 500 MB applies to video only (unsupported).

**BUG-05 Public page content (Medium).** Anonymous `GET /d/<link>`: HTML `<main>` contains title, description, blurred imgs, disabled button "Unlock for $20.00". No seller display name (present in `/api/public/drops/<link>` JSON but not rendered), no file count, no file types. Plan M2-07 expects all of these.

**BUG-06 No rate limiting (Medium).** 15 wrong logins in a row → 15×401; 200 parallel `GET /api/files/<id>/original?exp=1&sig=x` → 200×403 in 0.5 s; 300 random link guesses → 300×404; no 429s. Brute-force on login (bcrypt cost 12 limits speed only) and unbounded unauthenticated DB hits. README lists this as not built; flagged because M2-17/M3-16 require it.

**BUG-07 Legal pages (Medium).** `curl -si localhost:3200/terms` (also `/privacy`, `/dmca`, `/2257`) → 404 while `components/landing/SiteFooter.tsx` links to the first three. Needed before launch (M5-16). Owner FE.

**BUG-08 `Origin` → 500 (Low).** `curl -i -X POST localhost:3200/api/auth/logout -H 'Origin: null'` → `500 {"error":"Internal error"}`; server log `TypeError: Invalid URL … input: 'garbage'`. `new URL(origin)` in `src/server/http.ts` is outside a try/catch for non-URL origins (browsers send `Origin: null` for sandboxed/cross-origin form posts). Should be 403. Not exploitable beyond noisy 500s.

**BUG-09 Link format (Medium).** Publish → response `url:"/d/8eZfzAXdNBSf"`; `GET /u/8eZfzAXdNBSf` → 404. Spec/plan: `unveil.link/u/<12 chars>`. Decide (and align FE/PAY/docs) before links are shared.

**BUG-10 Security headers (Low/Med).** `curl -si localhost:3200/` and `/d/<link>` → no `Strict-Transport-Security`, `X-Frame-Options`/`frame-ancestors`, `Content-Security-Policy`, `Referrer-Policy`, `Permissions-Policy`. `X-Content-Type-Options` only on file routes. Clickjacking of dashboard/publish attestation boxes is possible. HTTPS redirect is a hosting concern (not testable locally).

**BUG-11 Publish/unpublish state quirks (Low).** (a) `POST /publish` twice → second call overwrites `drops.attestation.at` (and returns 200); history of what the seller attested when is lost; no IP/user-agent captured (M4-08 2257 export will want these). (b) `POST /unpublish` on a draft → 200, status `unpublished`.

**BUG-12 Download TTL (Low).** `DEFAULT_TTL_S = 300` in `services/signing.ts`; spec says 24 h, configurable, with receipt link minting fresh ones. Expiry itself works (410 on expired; 403 on tampered `exp`). Not yet wired to buyers.

**BUG-13 Content-Type/CSRF hardening (Low).** `curl -b jar -H 'content-type: text/plain' -d '{"title":"x","priceCents":1000}' localhost:3200/api/drops` → 201 (no Origin header present). Cross-site browsers always send Origin on POST, and cookie is SameSite=Lax, so exploitability is low; recommend rejecting non-JSON content types and requiring Origin/Sec-Fetch-Site on mutations.

**BUG-14 Weak passwords (Low).** Signup with `password` / `12345678` → 201. Consider a common-password check.

**BUG-15 Upload progress (Low, FE).** Dashboard drop page upload form: no `progress`/`role=progressbar` element; M1-05 expects progress bar.

**BUG-16 Lint config (Low, dev).** `npm run lint` → "5310 problems (418 errors)" all in `.next-e2e/**` (generated by `npm run e2e`); add `.next-e2e/**` (and `NEXT_DIST_DIR` outputs) to `globalIgnores`. Source lint is clean.

### Observations (not bugs / info)
- Uploads are buffered in memory; a 60 MiB chunked body is fully read before the 413 (memory-DoS surface; fine at 15 MiB cap, noted in README).
- A 9900×9900 PNG (≈100 MP, 298 KiB on disk) is accepted and processed in ~0.2 s; 10100×10000 rejected (415). The 100 MP cap works.
- Valid JPEG with appended `<?php …` bytes accepted and stored verbatim; harmless as served (`attachment`, `nosniff`, application never executes uploads, preview is re-encoded).
- Positive security results: IDOR clean across all drop/file routes (404 indistinguishable from nonexistent), tampered/`alg=none` JWT rejected, deleted seller's cookie rejected immediately, signed URLs bound to file id + exp (cross-file reuse 403, exp extension 403), originals mode 0600 outside `public/`, session cookie HttpOnly/Secure/SameSite=Lax, no secrets in client bundle or git history, XSS payloads in title/description rendered escaped, mass-assignment of `status`/`seller_id`/`verification_status` ignored, price bounds enforced in API and DB and honour live `platform_settings` edits.
- Signed URLs are multi-use until expiry (by design; the 5-attempt cap in M2-16 would need server-side state).

## Blocked on Frontend (or needs devices / UI work)
- **M1-02** Google sign-in (needs credentials + FE button; backend routes exist, 501 w/o config)
- **M1-05** progress bar (BUG-15); **M1-06** MP4 upload UI (backend also missing)
- **M1-09** resumable upload client (backend also missing)
- **M2-10** edit price/description UI (backend also missing); **M2-11** dedicated "unavailable" page (currently generic 404); **M2-13** delete UI; **M2-14** download page with per-file buttons / Download all
- **M2-07 / BUG-05** public page must render seller name, file count/types, price
- **M2-18, M2-19** mobile / throttled-4G passes; **M6-07** PWA install pass
- **M3-01, M3-15, M3-18, M3-19, M3-20** checkout UI (card form, 18+ checkbox, "all sales final", hosted fields)
- **M4-01, M4-09, M4-10, M4-11, M4-12, M4-18** verification start, earnings/stats/transaction dashboards, bank connect, onboarding timing
- **M5-04** admin review UI; **M5-16 / BUG-07** legal pages; **M5-17** DMCA form; **M5-19** cookie banner; **M5-20** neutral-branding audit; **M6-06** status banner
- **S2-01 / S2-02** timed flows

## Blocked on Backend (not implemented), for reference
Video upload + thumbnail (M1-06/11), resumable upload (M1-09), password reset (M1-04 part), drop edit/delete, buyer download/zip/expiry/attempt-cap/rate-limit (M2-12…17), all payments/webhooks/fees (M3), KYC provider/webhooks/payouts/profile edit (M4), moderation, reports, refunds/chargebacks, admin API + auth + audit writes, suspend/ban, GDPR export/delete (M5), backup/monitoring/webhook queue (M6).

## Case-by-case results

| Case | Result | Evidence / notes |
|---|---|---|
| M1-01 | **PASS** | POST /api/auth/signup → 201, seller.verification_status=pending, cookie `unveil_session=<jwt>; HttpOnly; Secure(prod); SameSite=lax; Max-Age=604800`; /api/auth/me 200; email lower-cased in DB; bcrypt hash `$2b$`. Headless Chrome UI smoke: /signup → submit → URL `/dashboard`, badge text “Pending” (`qa/scripts/qa-ui-smoke.mjs`). |
| M1-02 | **BLOCKED** | Needs real Google credentials (README: untested live). Verified only: `GET /api/auth/google` → 501 `{error:'Google sign-in is not configured…'}`; callback w/o config → 307 `/login?error=google_not_configured`. |
| M1-03 | **PASS** | dup email → 409 `email_taken` (also upper-cased variant 409); `short` pw → 400 `password: Too small…>=8`; `not-an-email`/`a@b` → 400; blank name 400; bad JSON 400; 1 row per email. Note: `password`/`12345678` accepted (length-only policy, BUG-14). |
| M1-04 | **FAIL** | Login/logout/re-login OK (wrong pw 401, unknown user 401, upper-case email login 200). **FAIL:** replaying the pre-logout session cookie after `POST /api/auth/logout` → `/api/auth/me` **200** (BUG-01). Password reset not implemented: `/api/auth/reset-password`, `/forgot-password` → 404. Deleted-seller cookie correctly → 401. |
| M1-05 | **PASS** | API: JPG 201, PNG 201, WebP 201; `GET /api/drops/:id` lists all 3 with correct mimes. UI (headless Chrome): upload via dashboard drop page → file listed with blurred preview img. **FE gap:** no progress bar (0 `progress`/`role=progressbar` elements; plain `fetch`) – blocked on Frontend for that sub-expectation. |
| M1-06 | **BLOCKED** | MP4 not implemented: `.mp4` (valid, ffmpeg-generated) → 415 `invalid_image`. README: video upload not built. |
| M1-07 | **PASS** | Content sniffed with sharp, not MIME/extension: GIF 415 `unsupported_type`; PDF 415; EXE (`MZ…`) 415; EXE renamed .jpg w/ image/jpeg 415; PDF as .jpg 415; SVG-with-script as .jpg 415; TIFF/AVIF 415; empty 400; missing `file` field 400; non-multipart 400. Hostile filename `../../etc/<script>"x.jpg` stored as `.._.._etc_script_x.jpg`. Info: valid JPEG + appended `<?php…` bytes accepted & stored verbatim (only served as attachment+nosniff via signed URL; preview is re-encoded). |
| M1-08 | **FAIL** | Image >15 MiB → 413 `file_too_large` ✔ (also with chunked body / no Content-Length). **But**: default `max_files_per_drop`=20 (spec: 10) – 11th file accepted (20 accepted, 21st → 400 `too_many_files`); no per-drop total-size limit exists (spec 2 GB); per-file cap 15 MiB image / 500 MiB video (video unsupported). File-count limit bypassable by parallel uploads (BUG-03: limit=5, 25 parallel → 25 stored). |
| M1-09 | **BLOCKED** | Resumable/tus-style upload not implemented: `PATCH`/`HEAD` on upload route → 405, `/api/uploads` → 404. README: S3 presigned/streaming uploads not built. |
| M1-10 | **PASS** | Text image (“CONFIDENTIAL / Name: Jane Roe / Card 4111…”) 1200×800 → preview 320×213 JPEG 1418 B (orig 65652 B); visually inspected: text/face unreadable (`qa/artifacts/blur-original.jpg` vs `blur-preview.jpg`); horizontal-gradient energy 3.7% of original; preview contains no original bytes; EXIF/GPS/ICC/XMP stripped (input with Copyright=SECRET-QA → not in preview). Draft preview: anon 404, other seller 404. |
| M1-11 | **BLOCKED** | Video previews not implemented (no video upload). |
| M1-12 | **PASS** | 14 guessed URLs (`/originals/..`, `/storage-data/..`, `/public/..`, `/_next/static/..`, `/api/files/:id`, `/api/files/:id/original` w/o sig, bad sig, traversal variants) → 404/403/308, none returned original bytes. On disk: `storage/originals/…` mode 600, outside `public/`. Owner-minted signed URL → anon GET 200 byte-identical, `cache-control: private, no-store`, `content-disposition: attachment`, `nosniff`. Sig reused on another file → 403; exp extended → 403. |
| M1-13 | **PASS** | Seller B vs seller A's drop/file: GET drop 404, upload 404, publish 404, unpublish 404, mint signed-url 404, draft preview 404; list endpoint doesn't leak; anon → 401. 404 body identical to nonexistent-UUID response (`{"error":"Drop not found"}`) – no enumeration oracle. Non-UUID/SQLi-ish ids → 404. |
| M1-14 | **BLOCKED** | Schema verified: all 9 tables present (sellers, drops, drop_files, transactions, payouts, reports, audit_log, admins, platform_settings) with fields incl. verification_status/ref, legal_name, dob, payout_details, attestation, fee split columns (`qa/evidence-run2-3.log`). Spec §11 text not in repo, so compared to plan/README. CI/CD, hosting and HTTPS redirect not present (no `.github/`, no deploy config) → cannot verify. |
| M2-01 | **PASS** | POST /api/drops {title:'  Sunset set ', description, priceCents:2000} → 201 status `draft`, title trimmed, link id generated; shows in GET /api/drops. UI: create draft → redirects to /dashboard/drops/:id, shows `$20.00 draft`. Gap: cover image not implemented (`cover_url` always null; `coverUrl` field ignored, no upload endpoint). |
| M2-02 | **PASS** | 99→400 `price_out_of_range`; 100→201; 50000→201; 50001→400; -500→400; 0→400; 1000.5→400; "2000"/null/"abc"/missing→400 `invalid_input`; 1e9 & MAX_SAFE→400. Narrowing `platform_settings` to 500..10000 via SQL took effect on next request without restart (100→400, 20000→400, 500→201). |
| M2-03 | **PASS** | Publish as seller with status pending / failed / manual_review → 403 `verification_required` each; drop stays draft; public page 404. Mass-assignment (`status:'published'`, `seller_id`, `verification_status:'verified'` on drop create/signup) ignored. |
| M2-04 | **FAIL** | Publish as verified seller (status set via SQL) → 200, `url:"/d/8eZfzAXdNBSf"` (12 chars). **Link path is `/d/<id>`, spec/plan says `unveil.link/u/<id>`; `GET /u/<id>` → 404** (BUG-09). 0 files → 400 `no_files`. |
| M2-05 | **PASS** | 2/3, 0/3, missing, and string `"true"` attestation → 400 `attestation_required`/`invalid_input`, drop stays draft, attestation NULL. All true → stored `{"at":"2026-10-01T00:47:53.940Z","over18":true,"ownsRights":true,"consentOfSubjects":true}` + `published_at`. Note: re-publish overwrites attestation (no history, no IP/UA) (BUG-11). |
| M2-06 | **PASS** | 120 drops: 120 unique, all match `^[A-Za-z0-9_-]{12}$`, 64/64 alphabet chars used, χ²=64.8 (df 63, 5% crit ≈82.5), not sorted, avg adjacent Hamming 11.7/12. 300 random + 4 sequential guesses (`aaaaaaaaaaaa`, `000000000001`…) → all 404. 72-bit CSPRNG (code review). |
| M2-07 | **FAIL** | Anon `/d/<id>` 200 shows title, description, blurred `<img>`s (6 `Blurred preview` – 3 preload+3 img) and price (in disabled button “Unlock for $20.00 (payments coming soon)”). **Missing: seller display name, file count and file types** (display name is in `/api/public/drops/:id` JSON but not rendered; no count/types anywhere) (BUG-05). No originals exposed. |
| M2-08 | **PASS** | Scan of page HTML + RSC payload + `/api/public/drops/:id` JSON for storage_key, `originals/`, `/original`, filenames → none. Only `/api/files/:id/preview` URLs. Anon previews return JPEG blur only. |
| M2-09 | **FAIL** | `/d/<id>`: no `X-Robots-Tag`, no `<meta name=robots>`; `/robots.txt` 404; `/sitemap.xml` 404 (so no sitemap entry ✔, no directory/search routes ✔: `/d`, `/explore`, `/browse`, `/api/public/drops` all 404). **No noindex anywhere** (BUG-02). Previews are `cache-control: public, max-age=300`. |
| M2-10 | **BLOCKED** | Edit endpoint not implemented: `PATCH`/`PUT /api/drops/:id` → 405 (only GET). Drop editor UI has no edit controls. |
| M2-11 | **PASS** | `POST /unpublish` → 200 status `unpublished`; `/api/public/drops/:id` 404; `/d/<id>` 404 (generic Next 404, not a dedicated “unavailable” page); anon preview 404; owner can republish → 200. Buy-disabled n/a (no payments). Minor: unpublishing a never-published draft → 200 `unpublished` (BUG-11). |
| M2-12 | **BLOCKED** | Needs purchase flow (M3) – not implemented. |
| M2-13 | **BLOCKED** | Delete drop not implemented: `DELETE /api/drops/:id` → 405 (also no file delete: 404). |
| M2-14 | **BLOCKED** | No buyer download page/zip endpoints (`/api/drops/:id/download`, `/api/download` → 404). Only per-file signed URL (owner-minted) exists; byte-identity of that download verified in M1-12. |
| M2-15 | **BLOCKED** | No buyer/receipt flow. Signed-URL expiry itself works with a test-secret-signed link: valid 200, expired(-10s) 410, expired(-1d) 410. Default TTL is 300 s (spec 24 h) (BUG-12). |
| M2-16 | **BLOCKED** | No download-attempt counter/purchase concept; 50 repeat downloads with one signed URL → 50×200. |
| M2-17 | **BLOCKED** | No buyer download endpoint to limit. Observed no throttling anywhere: 200 rapid bad-sig requests to `/original` → 200×403, no 429 (BUG-06). |
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
| M3-16 | **BLOCKED** | Payments/checkout not implemented (README: not built). |
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
| M5-16 | **FAIL** | Landing footer links `/terms`, `/privacy`, `/dmca` all **404**; no 2257 page; not linked from checkout (none) (BUG-07). Owner FE. |
| M5-17 | **BLOCKED** | Not implemented (no moderation, reports API, refunds, admin routes/UI). |
| M5-18 | **BLOCKED** | Not implemented (no moderation, reports API, refunds, admin routes/UI). |
| M5-19 | **BLOCKED** | No cookie-consent banner; only the essential session cookie is set. Frontend. |
| M5-20 | **NOT RUN** | Full UI/email/receipt audit not done. Quick `grep -ri 'adult\|nsfw\|porn\|nude\|explicit\|onlyfans'` over src/README → only the README’s “NSFW/CSAM scanning” note. Page titles/meta are generic (“Unveil — Sell your files with a simple payment link”). |
| M6-01 | **NOT RUN** | Full OWASP review not performed. Partial probes: no SQLi via ids (parametrised); XSS in title/description escaped on public page; JWT tamper/alg=none → 401; cross-origin Origin → 403 (but `Origin: null`/garbage → 500, BUG-08); 10100×10000 PNG → 415 (100 MP cap), 9900×9900 accepted in 210 ms; IDOR clean (M1-13). |
| M6-02 | **FAIL** | Responses carry no HSTS, X-Frame-Options, CSP, Referrer-Policy, Permissions-Policy, X-Content-Type-Options (only on file routes) (BUG-10). ✔ Secret values: 0 hits in `.next/static`; `.env` untracked & never in git history; `x-powered-by` removed; storage dir private (0700/0600); session cookie HttpOnly+Secure+SameSite=Lax in prod. |
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

## Reproducing this run
```bash
git checkout qa/test-plan && npm ci
export DATABASE_URL=postgres://unveil:unveil@localhost:5432/unveil_e2e_qa   # name must contain "e2e" for the reset helper
E2E_DATABASE_URL=$DATABASE_URL npx tsx scripts/e2e-setup.ts                 # recreate DB + migrations
export SESSION_SECRET=$(openssl rand -base64 48) SIGNED_URL_SECRET=$(openssl rand -base64 48) \
       STORAGE_DRIVER=local STORAGE_LOCAL_DIR=/tmp/qa-storage APP_URL=http://localhost:3200 NEXT_DIST_DIR=.next-qa NODE_ENV=production
npx next build && npx next start -p 3200 &
BASE=http://localhost:3200 DB=$DATABASE_URL node qa/scripts/qa-backend-1.mjs     # M1/M2 probes
BASE=http://localhost:3200 DB=$DATABASE_URL node qa/scripts/qa-backend-1b.mjs    # video/race/bomb/headers/secrets
BASE=http://localhost:3200 DB=$DATABASE_URL node qa/scripts/qa-backend-1c.mjs    # race re-check, google, schema
BASE=http://localhost:3200 DB=$DATABASE_URL node qa/scripts/qa-backend-1d.mjs    # expiry (uses SIGNED_URL_SECRET), edit/delete probes
BASE=http://localhost:3200 DB=$DATABASE_URL node qa/scripts/qa-ui-smoke.mjs      # needs /usr/bin/google-chrome
BASE=http://localhost:3200 DB=$DATABASE_URL node qa/scripts/qa-ui-smoke2.mjs
```
Scripts only talk to the running app + the QA database; no app source is modified. Note `qa-backend-1b` temporarily sets `platform_settings.max_files_per_drop=5` and restores 20; `qa-backend-1` temporarily narrows price bounds and restores 100/50000.
