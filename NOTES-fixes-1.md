# NOTES — backend/fixes-1

Branched from `origin/backend/foundation` @ `0829936`. Addresses the failing QA cases in `qa/results-backend-foundation-1.md` (branch `origin/qa/test-plan`) plus the "owed" items. Migration `db/migrations/003_fixes_1.sql` is additive (sessions, password_reset_tokens, rate_limits tables; new platform_settings/drops columns).

**Deploy note:** sessions are now server-side, so migration 003 invalidates every pre-existing cookie (everyone logs in once).

## What changed (and where to look)
| # | QA | Change | Verified by (e2e check / unit test) |
|---|---|---|---|
| 1 | M1-04 / BUG-01 | `sessions` table; JWT `jti` = session row; checked on every request; logout revokes the row | e2e `[#1 M1-04]` (replay old cookie after logout → 401) |
| 2 | M1-08 / BUG-03,04 | per-drop `SELECT … FOR UPDATE` tx makes count+size+insert atomic; limits 10 files & 2 GiB (`platform_settings.max_files_per_drop`, `max_total_bytes_per_drop`); image cap unchanged | e2e `[#2 M1-08]` ×3 (15 parallel → exactly 10; lowered size cap seq+parallel); `tests/quota.test.ts` (2 GB boundary math) |
| 3 | M2-04 / BUG-09 | public page `/u/[linkId]`; publish returns `/u/<id>`; `/d/<id>` → 308 `/u/<id>` | e2e `[#3 M2-04]` |
| 4 | M2-07 / BUG-05 | page + `/api/public/drops/:id` show seller display name, file count/types (`"3 files: 2 images, 1 video"`), title, price, blurred previews | e2e `[#4 M2-07]`; `tests/misc.test.ts` |
| 5 | M2-09 / BUG-02 | `<meta robots noindex,nofollow>`, `X-Robots-Tag` on `/u/*`, `/api/public/*`, `/api/files/*`, `robots.txt` | e2e `[#5 M2-09]` |
| 6 | M6-02 / BUG-10 | CSP, HSTS, nosniff, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy app-wide (`next.config.ts`, CSP rationale documented there + README); no X-Powered-By | e2e `[#6 M6-02]` ×2; headless-Chrome signup flow under the CSP (manual) |
| 7 | M6-01 / BUG-08 | `assertSameOrigin`: present-but-foreign/`null`/garbage Origin → 403 `bad_origin` JSON | e2e `[#7]` |
| 8 | M2-15 / BUG-12 | signed-URL TTL default 24 h; `platform_settings.download_ttl_seconds` > env `SIGNED_URL_TTL_SECONDS` > 24 h | e2e `[#8]`; `tests/misc.test.ts` |
| 9 | M1-03 / BUG-14 | min length 10 + blocklist (~13k exact/~15k base words from SecLists) + email/local-part/display-name + repeated/sequential | e2e `[#9 M1-03]`; `tests/policy.test.ts` |
| 10 | M2-05 / BUG-11 | `drops.attested_at`/`attestation` written once; re-publishes append to `attestation_history`, set `last_republished_at` | e2e `[#10 M2-05]` |
| 11 | M2-17 / BUG-06 | rate limiter (Postgres store, `RateLimitStore` interface for Redis), 429 + `Retry-After`, env-configurable; on download/preview/public-link/signed-url/login/signup/forgot/reset; stub `POST /api/checkout` → 501 | e2e `[#11]` ×3; `tests/ratelimit.test.ts` |
| 12 | M1-04 (reset) | `/forgot-password`, `/reset-password` pages + APIs; hashed single-use 1 h tokens; revokes all sessions; no enumeration; mail via `MailTransport` (file/console dev; Resend/Postmark adapters) | e2e `[#12]` ×2; `tests/misc.test.ts` (adapters, mocked fetch only) |

Also: e2e now starts on the next free port if 3100 is taken and kills its server's whole process group (an orphaned server from an earlier run silently masked failures); `eslint` ignores `.next-*`/`.e2e`.

## Existing e2e checks whose expectations changed
- `/d/<id>` → `/u/<id>` in "publish BLOCKED while pending" and "after verification_status=verified … public page" (public page moved).
- "logout clears session…" renamed to "logout clears the cookie…" (server-side revocation has its own new check).
- Every e2e HTTP client now sends its own fake `X-Forwarded-For` so rate limits don't bleed between checks; `scripts/e2e.sh` also sets `MAIL_TRANSPORT=file`, `MAIL_DEV_DIR`, `RATE_LIMIT_CHECKOUT=3/60`.
- The expiry check still uses an explicit 2 s TTL (the default is now 24 h); the 24 h default has its own check.
All other original checks are unchanged; 23 original + 18 new = 41 e2e checks.

## How to verify
```bash
git checkout backend/fixes-1 && npm ci
npm run migrate        # applies 003 (needs DATABASE_URL)
npm test               # vitest: 5 files, 25 tests
npm run e2e            # builds, starts app, 41 checks, expects "41/41 checks passed"
```
Manual: sign up → log out → replay the old cookie (`curl -H "cookie: unveil_session=…" /api/auth/me` → 401); `curl -si /u/<id> | grep -i robots`; `curl -si / | grep -iE 'content-security|strict-transport'`; forgot-password in dev writes the link to `.dev-mail/*.txt`.

## Not done / caveats
- Resend and Postmark adapters are **untested live** (request shape unit-tested with a mocked `fetch`).
- CSP uses `'unsafe-inline'` for scripts/styles (Next inline bootstrap); a nonce-based CSP is future work.
- Rate-limit client IP relies on `X-Forwarded-For`; set `TRUSTED_PROXY_HOPS` correctly in prod.
- No max-download-attempts concept existed, so none was added.
- Not in scope / still open from QA: legal pages 404 (BUG-07, frontend), `Content-Type: text/plain` CSRF hardening (BUG-13), upload progress bar (BUG-15), `unpublish` of a never-published draft still returns 200.
