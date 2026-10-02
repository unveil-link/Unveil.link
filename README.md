# Unveil (unveil.link)

Creators sell photos/videos through payment links. Buyers see a **blurred preview**; originals stay **private** and are only released through expiring, HMAC-signed URLs.

**Status of this foundation:** auth, schema, private storage, image **and MP4 video** upload + blur pipeline (see [Video uploads](#video-uploads-m2-media)), drop edit/delete (see [Editing and deleting drops](#editing-and-deleting-drops)), signed-URL delivery, publish gating and a full automated e2e proof are built. **Payments:** processor-agnostic payment layer with a mock processor, webhook pipeline, ledger and record-only payouts (see [Payments layer](#payments-layer)); no real processor yet. **Not built yet:** real processor integration, payout transfers, ID-verification provider, admin UI, reports UI. See [Not built / untested](#not-built--untested).

## Stack
Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · PostgreSQL 17 · `pg` · `jose` (JWT sessions) · `bcryptjs` · `sharp` · `zod` · vitest.

## Repo structure
```
db/migrations/           001_init.sql … 004_fixes_2.sql, 005_payments_enums.sql, 006_payments.sql  (plain SQL, applied in filename order)
scripts/
  migrate.ts             migration runner (schema_migrations table, advisory lock, one tx per file)
  set-verification.ts    dev helper: flip a seller's verification_status (stand-in for the future KYC provider/admin)
  e2e.sh / e2e.ts        end-to-end proof (builds + starts app on :3100 with throwaway DB & storage)
  e2e-setup.ts           recreates the throwaway `unveil_e2e` database
src/server/              server layer — no React, no route code
  config.ts              lazy env access
  db/                    pg Pool, query helpers, transactions
  auth/                  password.ts (bcrypt), password-policy.ts (+ generated common-passwords-data.ts), session.ts (JWT cookie + server-side sessions table), google.ts (OAuth/OIDC + PKCE)
  ratelimit/             reusable rate limiter (Postgres store; Redis-ready interface)
  mail/                  MailTransport interface: file/console (dev), Resend, Postmark adapters
  storage/               Storage interface; local.ts (private dir), s3.ts (S3/R2 adapter), index.ts (env switch)
  services/              sellers, drops (create/edit/delete), images (validate → blur → store), video (MP4 magic bytes → ffprobe → ffmpeg frame → blur → store), range (HTTP Range parser), signing (HMAC URLs), settings
  upload.ts              streaming multipart receiver (busboy): MP4 → temp file on disk, images → memory
  http.ts, errors.ts     route wrapper (error mapping, same-origin guard), requireSeller
src/app/                 UI + route handlers (thin: parse → call service → respond)
  api/auth/{signup,login,logout,me,forgot-password,reset-password,google,google/callback}
  api/checkout            guest checkout (rate limited) -> pending transaction + processor session
  api/webhooks/[provider], api/checkout/status, api/earnings, api/dev/payments/* (mock simulator, 404 in production)
  pay/mock/[sessionId]    hosted mock checkout page (dev only)
  api/drops, api/drops/[id] (GET/PATCH/DELETE), .../files (image + MP4 upload), .../publish, .../unpublish
  api/files/[id]/{preview,original,signed-url}
  api/public/drops/[linkId], api/settings
  signup, login, forgot-password, reset-password, dashboard, dashboard/drops/[id], u/[linkId] (public drop page; /d/<id> 308-redirects here), robots.txt
src/app/design, components/, lib/  landing page + design system (from another workstream; pages here reuse `components/ui`)
tests/                   unit tests (vitest): signing, password policy, quota accounting, rate limiter, mail adapters, TTL, file summary, video/upload/range (tests/video.test.ts), drop edit/delete + video service (tests/db/drops-media.test.ts)
proof/                   compare.png, db.txt, test-original.jpg (output of the e2e run)
docker-compose.yml       Postgres 17 for your machine
.env.example             all env vars
```

## Run it locally
Prereqs: Node 20+, PostgreSQL 15+ (via Docker below, or a local install), and **ffmpeg + ffprobe on `PATH`** for video uploads (`apt-get install ffmpeg` / `brew install ffmpeg`; without them the app still runs and image uploads work, video uploads answer `503 video_unavailable`).

```bash
# 1. deps
npm ci

# 2. Postgres (pick one)
docker compose up -d db          # user/pass/db = unveil/unveil/unveil on :5432
#   — or a local Postgres:  createuser -P unveil ; createdb -O unveil unveil

# 3. env
cp .env.example .env
#    set SESSION_SECRET and SIGNED_URL_SECRET (each >= 32 chars):  openssl rand -base64 48

# 4. schema
npm run migrate

# 5. run
npm run dev                      # http://localhost:3000
```

Flow to try: sign up → dashboard shows **Pending** → create a draft → upload a JPG/PNG/WebP → blurred preview appears → *Publish* is refused until verified. To act as the verification provider in dev:

```bash
npm run verify-seller -- you@example.com verified
```

Production-style run: `npm run build && npm start`.

### Tests / proof
```bash
npm test          # unit tests
npm run e2e       # = bash scripts/e2e.sh : full end-to-end proof, 102 checks (needs ffmpeg), writes proof/*
```
`e2e.sh` needs Postgres reachable with the creds in `.env`; it creates/drops a separate database `unveil_e2e` (refuses any DB name not containing `e2e`), builds into `.next-e2e`, and uses its own storage dir `.e2e/storage` and dev-mail dir `.e2e/mail`. It starts the app on port 3100 (or the next free port if 3100 is taken, so it never tests a stale server) and gives every test client its own fake `X-Forwarded-For` so rate-limit state doesn't bleed between checks. It never touches your dev DB or `storage-data/`.

## Payments layer
Full design notes, decisions and open questions: **[PAYMENTS-NOTES.md](PAYMENTS-NOTES.md)**.

```
src/server/payments/
  types.ts        PaymentProvider interface + NormalizedPaymentEvent (sale_succeeded | sale_failed | refunded | chargeback)
  registry.ts     PAYMENT_PROVIDER=<name> (default "mock") -> provider; unknown/unavailable => 503
  signature.ts    HMAC-SHA256 webhook signing/verification (raw body, timestamp tolerance, constant-time compare)
  money.ts        PURE integer-cent math: one rounding rule (round-half-up), fee split, cumulative refund shares
  ledger.ts       append-only ledger_entries postings + balance (pending vs available)
  webhooks.ts     provider-independent pipeline: verify -> claim (dedupe) -> apply -> reconciliation log; parks out-of-order refunds
  checkout.ts / refunds.ts / payouts.ts / earnings.ts / pricing.ts   services (routes stay thin)
  mock/           the mock processor: cards.ts (test cards), events.ts (wire format + signed-event builders), index.ts
  dev/simulator.ts  dev-only "processor calls our webhook" helper behind /api/dev/payments/*
```
Flow: `POST /api/checkout` (drop must be published, seller verified, price read from the DB, buyer email + 18+ confirmation required) → `transactions` row `pending` + `provider.createCheckoutSession` → buyer pays at the processor → processor calls `POST /api/webhooks/<provider>` → signature verified over the raw body → event claimed once (unique index) → transaction `succeeded` + ledger postings in one DB transaction. A transaction is **never** marked succeeded from the browser redirect.

**Adding a real provider (Segpay / CCBill):** (1) create `src/server/payments/<name>/index.ts` exporting a `PaymentProvider`; keep wire formats, URLs, parameter names and credentials in that folder; (2) `createCheckoutSession` must pass our `transactionId` (and, since neither processor documents webhook signatures, an HMAC of `transactionId + price` made with `PAYMENT_WEBHOOK_SECRET`, in the processor's custom/pass-through variable); (3) `verifyWebhook` verifies that HMAC (+ optional IP allowlist) over the raw body and maps the processor's event types onto the four normalized types, deriving `eventId` as `<tranid>:<type>` when there is no event id; optionally implement `confirmTransaction` for the server-side confirmation call the handler runs before applying a sale; (4) implement `issueRefund` / `recordPayout`; (5) register it in `registry.ts`; (6) set `PAYMENT_PROVIDER=<name>`, `platform_settings.processing_fee_percent`, extend the CSP (`frame-src`/`form-action`) for the hosted page; (7) copy `tests/payments-provider.test.ts` for the new `verifyWebhook`. Nothing else changes: dedupe, ordering, ledger, refunds and payouts are provider-independent.

**Mock processor:** test cards by last four digits — `…4242` approves, `…0002` card_declined, `…9995` insufficient_funds, `…0069` expired_card, `…0127` incorrect_cvc, anything else declined. Dev flow: open a drop page → *Unlock* → hosted mock page (`/pay/mock/<session>`) → *Pay (mock)`. Webhook payloads are signed with `signMockEvent()` (`src/server/payments/mock/events.ts`), the same helper the tests and the simulator use. **The mock is default-deny:** it is allowed only when `NODE_ENV` is exactly `development` or `test`, or when `MOCK_PAYMENTS_ENABLED=1` **and** `APP_URL` is loopback (the repo's e2e runs a production *build* this way). Production, staging or an unset `NODE_ENV` ⇒ provider unavailable (checkout/webhook 503), `/api/dev/payments/*` and `/pay/mock/*` 404 (see `config.mockPaymentsAllowed`). **Checkout:** `POST /api/checkout` honours an `Idempotency-Key` header (same key ⇒ same session, 200; reused on another drop ⇒ 409) and returns the existing live pending session for an identical drop+email. Pending sessions expire after `platform_settings.checkout_session_ttl_minutes` (30); payment and webhook-success re-validate seller verification + drop status (invalid ⇒ voided + refund requested + flagged for review). Buyers see friendly failure messages (never raw codes) and an "All sales are final" notice. Repeated chargebacks (`chargeback_flag_threshold` 3 in `chargeback_flag_window_days` 90) set `sellers.risk_flagged_at` for review. Details: PAYMENTS-NOTES.md "Round 2".

**Money:** integer cents everywhere. Platform fee % = `platform_settings.fee_percent` (default 10), processing fee % = `platform_settings.processing_fee_percent` else `MOCK_PROCESSING_FEE_PERCENT` (12). `$20.00` → processing `$2.40`, platform `$2.00`, seller `$15.60`. Rounding rule: round-half-up on cents per fee, seller_net = gross − platform − processing (so it always sums). Hold period `payout_hold_days` (7), `min_payout_cents` (2500), `chargeback_fee_cents` (0) are platform settings.

**Follow-ups (see PAYMENTS-NOTES.md "Follow-ups"):** pending checkouts are only returned to the client that created them (httpOnly `unveil_buyer` cookie or same `Idempotency-Key`); a price change supersedes a stale pending checkout. **Payments janitor** (expire sessions, retry void refunds with backoff/cap, flag stale parked events): `npm run payments:janitor`, or `POST|GET /api/internal/cron/payments-janitor` with `Authorization: Bearer $CRON_SECRET` (401 otherwise, 503 when `CRON_SECRET` is unset). Schedule it yourself every ~5 min: Vercel Cron (`vercel.json` crons entry pointing at the route), any external scheduler (`curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/internal/cron/payments-janitor`), or box cron (`*/5 * * * * cd /srv/unveil && npm run payments:janitor`). **Admin:** separate admin principal (own session table + `unveil_admin` cookie); there is no default admin - create one with `ADMIN_PASSWORD=... npm run create-admin -- you@example.com`, sign in at `/admin/login` (not linked anywhere, `noindex`), and use `/admin/sellers/flagged` (flagged sellers, transactions needing review, audited "clear flag"). JSON: `/api/admin/*`. **Audit log** is append-only (DB triggers, migration 011), keeps the actor email, and records failed admin logins (bounded); admins are disabled, never deleted - see PAYMENTS-NOTES.md "Audit hardening".

**Run / verify payments**
```bash
npm run migrate                                   # applies 005 .. 010
npm run typecheck && npm run lint
npm test                                          # all unit tests; DB-backed suites in tests/db/ run when Postgres is reachable (else skip)
npm run e2e                                       # 62 checks incl. the payments flow
curl -s localhost:3000/api/earnings               # (signed-in seller) pending/available balance, lifetime totals
```
DB tests create and drop a throwaway database `unveil_paytest_payments` next to your `DATABASE_URL` (or `TEST_DATABASE_URL`).

## Production database roles
`docker-compose.yml` creates `unveil` as superuser **and** owner of every table - fine for local dev, **not** for production: the owner can disable the append-only triggers on `audit_log` / `ledger_entries`. In production run `npm run migrate` as an owner role and give the app a separate login with only DML: `CREATE ROLE unveil_app LOGIN PASSWORD '...' NOSUPERUSER; GRANT USAGE ON SCHEMA public TO unveil_app; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO unveil_app; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO unveil_app;` (repeat the grants after each migration that adds tables, or use `ALTER DEFAULT PRIVILEGES`), and point the app's `DATABASE_URL` at it. See PAYMENTS-NOTES.md "Deployment requirements".

## Environment
See `.env.example`. Key vars: `DATABASE_URL`, `SESSION_SECRET`, `SIGNED_URL_SECRET`, `STORAGE_DRIVER` (`local`|`s3`), `STORAGE_LOCAL_DIR`, `S3_*`, `GOOGLE_CLIENT_ID/SECRET`, `APP_URL`. `.env` is gitignored.

Added in `backend/fixes-1`:

| Var | Default | Meaning |
|---|---|---|
| `SIGNED_URL_TTL_SECONDS` | `86400` (24 h) | default lifetime of signed download links; `platform_settings.download_ttl_seconds` (if non-NULL) wins |
| `RATE_LIMIT_ENABLED` | on (`0` disables) | master switch for the limiter |
| `RATE_LIMIT_STORE` | `postgres` | `postgres` or `memory` (single process) |
| `RATE_LIMIT_<NAME>` | see below | override one limit as `max/windowSeconds`, e.g. `RATE_LIMIT_LOGIN_IP=30/900` |
| `TRUSTED_PROXY_HOPS` | `1` | number of reverse proxies appending to `X-Forwarded-For`; client IP = Nth entry from the right. **Set to your real hop count in production** (0 hops = no proxy, then the header is client-controlled and the limiter can be evaded) |
| `MAIL_TRANSPORT` | `file` (dev) / required in prod | `file` (writes `.dev-mail/*.json,.txt`), `console`, `resend`, `postmark` |
| `MAIL_FROM` | `Unveil <no-reply@unveil.link>` | From header |
| `MAIL_DEV_DIR` | `.dev-mail` | where the `file` transport writes |
| `RESEND_API_KEY` / `POSTMARK_SERVER_TOKEN` | – | credentials for the matching transport (**adapters untested live**) |

Added in `backend/m2-media`:

| Var | Default | Meaning |
|---|---|---|
| `FFMPEG_PATH` / `FFPROBE_PATH` | `ffmpeg` / `ffprobe` on `PATH` | binaries used for video validation + preview frames |
| `FFMPEG_TIMEOUT_MS` | `60000` | kill ffprobe/ffmpeg after this long (decompression-bomb / hang guard) |
| `UPLOAD_TMP_DIR` | `<os tmpdir>/unveil-uploads` | where video uploads are spooled (mode 0600) before being moved into storage; deleted after every request. Needs free space for one in-flight video per concurrent upload (≤ 500 MB each). |

Default rate limits (`NAME` → max/window): `LOGIN_IP` 20/15 min, `LOGIN_EMAIL` 20/min (burst valve only, **not** a lockout — see [Login delays](#login-delays-no-lockout)), `SIGNUP_IP` 10/h, `FORGOT_IP` 5/h, `FORGOT_EMAIL` 3/h (extra requests answer 200 but send no mail), `RESET_IP` 10/h, `DOWNLOAD` 60/min (`/api/files/:id/original`), `PREVIEW` 300/min, `PUBLIC_LINK` 120/min, `SIGNED_URL` 60/min (owner mint), `CHECKOUT` 10/min (`POST /api/checkout`), `WEBHOOK_REJECTED` 60/min (logged rejected webhook deliveries per IP). Exceeding a limit returns `429` with `Retry-After` and `{code:"rate_limited"}`.

### Platform settings added in migration 003
`max_files_per_drop` (default now **10**), `max_total_bytes_per_drop` (default **2147483648** = 2 GiB; sum of original sizes per drop), `download_ttl_seconds` (NULL = use env/24 h). Per-file caps unchanged: `max_image_size_bytes` 15 MiB (images), `max_video_size_bytes` 500 MiB (MP4 video; this is the per-file video cap — the column already existed since migration 002, so no new migration was needed). Edit via SQL (no admin UI yet), e.g. `UPDATE platform_settings SET download_ttl_seconds = 3600;`.

### Security headers / CSP
Set app-wide in `next.config.ts` (`X-Powered-By` removed): `Content-Security-Policy`, `Strict-Transport-Security` (2 y, includeSubDomains, preload), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` (+ CSP `frame-ancestors 'none'`), `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera/mic/geolocation/payment/usb off). The CSP is `default-src 'self'` with `script-src 'self' 'unsafe-inline'` and `style-src 'self' 'unsafe-inline'` because Next's App Router emits inline bootstrap scripts and Tailwind/Next inject inline styles; a nonce/`strict-dynamic` policy would need a per-request proxy and fully dynamic rendering. Documented trade-off: no third-party script origins, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`. When a payment processor is added, extend `script-src`/`frame-src`/`connect-src` for it. `X-Robots-Tag: noindex, nofollow` is added on `/u/*`, `/api/public/*`, `/api/files/*`; link pages also carry `<meta name="robots" content="noindex,nofollow">`; `/robots.txt` disallows `/u/`, `/d/`, `/api/`, `/dashboard`.

### Password policy
Min length **10** (was 8), max 200. Rejected: entries of a bundled blocklist (≈13k exact + ≈15k base words from SecLists top lists, MIT; regenerate with `node scripts/build-password-list.mjs <dir>`), common word + up to 6 trailing digits/symbols and simple leetspeak variants of those, password equal to (or trivially derived from) the email / its local part / display name, repeated patterns (`aaaaaaaaaa`, `abcabcabcabc`) and sequences (`1234567890`, `abcdefghij`, keyboard rows). Applies to signup and password reset. Existing accounts are not re-checked at login.

### Login delays (no lockout)
Failed logins on an email are answered with **progressive delays instead of a lockout**, so an attacker can never lock the real owner out. Per email (hashed; unknown emails behave identically, so nothing leaks account existence) the app stores the number of recent failures and `next_allowed_at` (table `login_throttle`). With threshold *T*, base *B*, cap *C* (defaults **5 / 1 s / 60 s**): failures 1…*T*-1 are free; the *f*-th failure (f ≥ T) arms a delay of `min(C, B·2^(f-T))` → 1 s, 2 s, 4 s, 8 s, 16 s, 32 s, 60 s, 60 s, … An attempt that arrives during the delay gets `429 {code:"login_delayed"}` with `Retry-After: <remaining seconds>` **without the password being evaluated** (a correct password is not a bypass, and rejected attempts neither count nor extend the delay). After the delay a correct password works. The delay is never longer than *C*, failures are forgotten after `decay` seconds (default 15 min) without an attempt, a successful login and a completed password reset clear the counter, and a DB `CHECK` guarantees no row can ever block for more than 1 h. Admission is atomic (row lock), so parallel guesses cannot slip through a window. The per-IP login limit (`LOGIN_IP`) and the per-email burst limiter (`LOGIN_EMAIL`, window clamped to ≤ *C*) are unchanged mechanisms.

Config (precedence: `platform_settings` column > env > default; invalid values are ignored, cap is bounded to 1 h):

| Setting | env | `platform_settings` column | default |
|---|---|---|---|
| failures before the first delay | `LOGIN_DELAY_THRESHOLD` | `login_delay_threshold` | 5 |
| first delay (doubles each failure) | `LOGIN_DELAY_BASE_SECONDS` | `login_delay_base_seconds` | 1 |
| maximum delay | `LOGIN_DELAY_CAP_SECONDS` | `login_delay_cap_seconds` | 60 |
| forget failures after this idle time | `LOGIN_DELAY_DECAY_SECONDS` | `login_delay_decay_seconds` | 900 |

e.g. `UPDATE platform_settings SET login_delay_cap_seconds = 30;`. Code: `src/server/ratelimit/login-throttle.ts`.

**Future hook (not built): CAPTCHA.** The natural place is `enforceLoginDelay` / the login route: once `failures` passes a (higher) threshold, require a verified CAPTCHA token (Turnstile/hCaptcha) instead of — or in addition to — the delay. A valid token would let the owner skip the wait, which also closes the "attacker keeps polling at the instant the delay expires" annoyance noted in NOTES-fixes-2.md.

### Password reset
`POST /api/auth/forgot-password {email}` always returns the same 200 body (work is done after the response so timing doesn't leak either). A random 256-bit token is emailed as `${APP_URL}/reset-password?token=…`; only its SHA-256 is stored; valid 60 minutes, single use (atomic claim), a newer request invalidates older links. `POST /api/auth/reset-password {token,password}` applies the password policy, sets the password and **revokes all of the seller's sessions**. In dev the email lands in `.dev-mail/` (`npm run dev` → read the newest `.txt`).

### Google OAuth setup (UNTESTED LIVE)
1. Google Cloud Console → APIs & Services → Credentials → *Create OAuth client ID* (Web application).
2. Authorised redirect URI: `${APP_URL}/api/auth/google/callback` (e.g. `http://localhost:3000/api/auth/google/callback`).
3. Put the client id/secret in `.env` and restart. The "Continue with Google" button appears only when both are set; `/api/auth/google` returns 501 otherwise.

Implementation: authorization-code flow with PKCE (S256), `state` and `nonce` kept in a short-lived httpOnly cookie, ID token verified against Google's JWKS (issuer, audience, nonce, `email_verified`). New Google users are created with `verification_status=pending`; an existing email/password account with the same verified email gets linked. **This was not run against real Google** (no credentials available); only the authorization-URL construction and the "not configured" path were exercised.

### S3 / Cloudflare R2
Set `STORAGE_DRIVER=s3`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION` (`auto` for R2) and `S3_ENDPOINT` (R2: `https://<account>.r2.cloudflarestorage.com`). The adapter (`src/server/storage/s3.ts`) uses the AWS SDK; **it is implemented but untested** (no bucket available). Keep the bucket private.

## Decisions
- **Server layer separated** from route handlers: handlers only validate input and call `src/server/services/*`. Swapping Next route handlers for a separate API process later means moving `src/server` and thin handlers.
- **Sessions:** JWT (HS256, `jose`) in an `httpOnly`, `SameSite=Lax`, `Secure`-in-prod cookie, 7-day expiry. The JWT's `jti` is a row in the `sessions` table; every authenticated request checks that the row exists, is not revoked and not expired, so logout, password reset (and any future "log out everywhere") invalidate tokens immediately. Tokens without a live `jti` row (incl. all pre-003 tokens) are rejected, i.e. deploying migration 003 logs everybody out once. Passwords: bcrypt cost 12 (`bcryptjs`, pure JS, no native build); constant-time-ish login for unknown emails. CSRF: mutating API calls whose `Origin` header is present but is not a same-host http(s) origin (foreign, `null`, garbage) get `403 bad_origin` JSON, plus SameSite=Lax. Requests with no Origin header are still allowed (non-browser clients).
- **Migrations:** plain SQL + ~50-line runner (no ORM). Forward-only.
- **Extra schema beyond spec §11:** `admins` (so `audit_log.admin_id` has an FK), `platform_settings` (single row: `fee_percent` default 10, price min/max, image/video size limits, max files, allowed MIME types), enums for statuses, `payout_status`/`report_status` enums (spec didn't list values), `updated_at/published_at` on drops, `created_at` on drop_files, `google_id` unique, `email` forced lowercase, CHECK that a seller has a password or Google id, `seller_net = amount − fees` CHECK on transactions, unique `processor_ref`. FKs: seller data cascades for drops/files/reports; `transactions`/`payouts` use RESTRICT so money records can't be silently deleted.
- **Price bounds** are enforced twice: hard `CHECK (100..50000)` in the DB, plus tunable (narrower) bounds from `platform_settings` in the service. The settings table's own CHECKs stop it being set outside the hard range. Upload size limits are read from `platform_settings` on every request (no deploy needed). There is no admin UI yet — edit via SQL.
- **`public_link_id`:** 9 CSPRNG bytes → 12-char base64url (72 bits), unique index + CHECK on format, retry on collision.
- **Storage:** `Storage` interface (`put/get/exists/delete`). Local driver writes under `STORAGE_LOCAL_DIR` (default `./storage-data`, outside `public/`, gitignored, dirs 0700 / files 0600, path-traversal guarded). Keys are random (`originals/<dropId>/<fileId>.<ext>`), never user-supplied.
- **Delivery:** the only route that can return original bytes is `GET /api/files/:id/original?exp&sig`, where `sig = HMAC-SHA256(SIGNED_URL_SECRET, "original:<fileId>:<exp>")`, compared timing-safely. Missing/bad signature → 403, expired → 410, `Cache-Control: private, no-store`, `Content-Disposition: attachment`. Default TTL 24 h (configurable, see above). Owner can mint one via `POST /api/files/:id/signed-url`; the future post-payment flow will mint them for buyers. `GET /api/files/:id/preview` can only read `blurred_preview_key`, and only for published drops (or to the owner for their drafts).
- **Blur:** EXIF-orient → downscale to ≤320px → gaussian blur σ=18 → JPEG q55; sharp drops all metadata (EXIF/GPS/ICC/XMP) by default. The e2e test asserts preview high-frequency detail < 20% of the original's (measured ≈12%), dimensions ≤320, no metadata, size <10%.
- **Upload validation:** format is decided from the bytes, never the client MIME/extension: images by decoding with sharp (only JPEG/PNG/WebP from settings, 100MP pixel cap, `max_image_size_bytes`), MP4 by `ftyp` magic bytes + ffprobe (see [Video uploads](#video-uploads-m2-media)). Images are buffered in memory (≤15 MB); **videos are streamed to a temp file and never held in memory** (verified: a 299 MB upload moved the server RSS by 0 KB).
- **Upload limits:** the file-count / total-size check and the insert run in one transaction holding `SELECT … FOR UPDATE` on the drop row, so parallel uploads can't overshoot. Originals are written to storage before the transaction; if the locked check fails they are deleted again.
- **Attestation:** `drops.attested_at` + `drops.attestation` are written once (first publish). Later publishes append to `drops.attestation_history` (jsonb array) and set `last_republished_at`.
- **Publish rule:** only `verification_status='verified'` sellers can publish (enforced in `services/drops.ts`, not in the UI); publish also requires the three attestations (18+, rights, consent) which are stored in `drops.attestation`, and ≥1 file. Drafts/uploads are open to unverified sellers.
- **Verification** is a stub: nothing moves a seller out of `pending` except `npm run verify-seller` / SQL. A KYC provider integration and admin review UI are future work.
- **Ports/DBs in the repo environment:** Postgres was installed with apt on the dev box (no Docker there); `docker-compose.yml` is provided for your machine but **was not run here**.

## Video uploads (M2 media)
`POST /api/drops/:id/files` (same route, auth, ownership, CSRF/Origin rule and quota as images) now also accepts **MP4 (`video/mp4`) only**. Pipeline (`src/server/upload.ts`, `services/video.ts`):
1. **Streaming receive** (busboy): the first 12 bytes decide the path. An ISO-BMFF `ftyp` box with an MP4 brand (`isom`, `iso2…9`, `mp41`, `mp42`, `avc1`, `dash`, `msdh`; *not* `qt  `, `heic`, `3gp*`, `M4A `) ⇒ the body is spooled to a 0600 temp file in `UPLOAD_TMP_DIR`, capped at `platform_settings.max_video_size_bytes` (500 MiB default; 413 `file_too_large` — the stream is cut as soon as the cap is crossed). Anything else ⇒ the existing in-memory image path (`max_image_size_bytes`). A file that *claims* to be a video (`video/*` MIME or a video extension) without the MP4 magic bytes is rejected 415 `unsupported_type` — so spoofed files never reach an image decoder or ffmpeg. Exactly one `file` part is accepted per request.
2. **ffprobe** must confirm the `mov/mp4` demuxer, a real (non-cover-art) video stream and sane dimensions (415 `invalid_video` otherwise: "ftyp + garbage", truncated files, etc.). ffmpeg/ffprobe are run with `-f mov -protocol_whitelist file`, so a crafted upload cannot make them open network URLs or other files, and with a timeout (`FFMPEG_TIMEOUT_MS`).
3. **Preview**: one frame at ~1 s (middle of clips <2 s) is extracted by ffmpeg and sent through the *same* `makeBlurredPreview()` as images (auto-orient → ≤320 px → Gaussian blur σ=18 → JPEG q55; sharp drops all metadata). Stored as `previews/<drop>/<file>.jpg` → `blurred_preview_key`, served by the existing `GET /api/files/:id/preview` (so published-drop visibility rules, rate limit and noindex are unchanged). The preview contains nothing from the video's container metadata.
4. **Storage**: the temp file is handed to the storage adapter's new streaming `putFile()` (local: copy to a 0600 file; S3: streamed `PutObject` — **untested against a real bucket**), the DB row (`mime='video/mp4'`, `size_bytes`) is inserted by the *same* row-locked transaction as images (`insertFileLocked`), so the 10-files / 2 GB-per-drop limits (shared between images and videos) stay atomic. On any failure the stored objects and the temp file are removed.
5. **Delivery**: the original video is reachable *only* via `GET /api/files/:id/original?exp&sig` (HMAC signed URL, minted by `POST /api/files/:id/signed-url` for the owner, later for paying buyers). That route now **streams** from storage (no buffering) and supports `Range: bytes=a-b` / `a-` / `-n` (206 + `Content-Range`, `Accept-Ranges: bytes`, 416 past the end; multi-range / garbage ⇒ full 200). Signature/expiry/rate-limit/`no-store`/`attachment` behaviour is unchanged.
6. **Public page**: `summarizeFiles` counts by stored MIME, e.g. `"3 files: 2 images, 1 video"`; the public API's `previews[].kind` is `video` for videos (the preview itself is still a blurred JPEG).
7. **No ffmpeg on the host?** `503 {code:"video_unavailable"}` with a clear message (and a server log line); images keep working.

**Deployment: the host/container image needs `ffmpeg` and `ffprobe`** (e.g. `apt-get install -y ffmpeg`; there is no Dockerfile in this repo yet — when one is added it must install ffmpeg, and `UPLOAD_TMP_DIR` should point at a disk with ≥ 500 MB per concurrent upload). A reverse proxy/CDN in front must allow ~500 MB request bodies and long upload timeouts (nginx `client_max_body_size 520m;`, `proxy_request_buffering off;`), and Vercel-style serverless request limits do not allow this at all — a self-hosted Node process (or presigned direct-to-bucket upload, not built) is required.

## Editing and deleting drops
**`PATCH /api/drops/:id`** (JSON, seller session, same-origin/CSRF rule like every mutating route): any subset of `title` (1–120 chars), `description` (≤2000, `null` clears), `priceCents` (alias `price_cents`; integer within `platform_settings.price_min_cents..price_max_cents`). The body is a strict whitelist — `status`, `attestation`, `seller_id`, `public_link_id`, … ⇒ 400, empty patch ⇒ 400. Another seller's (or unknown/malformed) id ⇒ **404** (ids don't leak), no session ⇒ 401, foreign `Origin` ⇒ 403 `bad_origin`, flagged drop ⇒ 403. Only `title/description/price_cents/updated_at` are written, so **editing a published drop never touches `status`, `attestation`, `attested_at`, `attestation_history`, `published_at`**; the change is visible on the public page immediately and every edit writes an `audit_log` row (`drop_edited`, with the old→new price). Checkout always reads the price from the DB and supersedes stale pending sessions (payments layer), so a price edit cannot sell at the old price.

**`DELETE /api/drops/:id`**: in one transaction (row-locked) the `drops` row is deleted — `drop_files` (and `reports`) go with it via `ON DELETE CASCADE` — and a `drop_deleted` audit row is written; then every stored **original and blurred preview** of the drop is deleted from storage (emptied per-drop directories are removed too). If storage deletion fails after the DB commit the drop stays deleted, the response reports `storageErrors`, and a `drop_storage_orphans` audit row lists the keys to clean up. Other seller ⇒ 404, no session ⇒ 401, flagged ⇒ 403. Deletion is **refused with 409** when `transactions` reference the drop (`drop_has_sales`; `transactions.drop_id` is `ON DELETE RESTRICT` on purpose so money history can't vanish) or when an abuse report is `open`/`reviewing` (`drop_has_open_report`) — unpublish instead.

**How deletion/unpublishing should interact with purchased downloads (to implement with the buyer-fulfilment flow; no purchases exist yet).** The spec says unpublishing/deleting need not revoke downloads that were already bought. Recommended design: (1) a purchase must outlive the drop, so deleting a drop *with sales* should become a **soft delete** (status `deleted`/`unpublished`, hidden from the public page and the seller's list, files **kept** in private storage) instead of today's hard 409 — hard delete (including the stored files) stays for drops with zero sales; (2) buyer downloads are served from signed URLs minted for the *transaction* (`transactions.id` → drop files), never from the public drop status, so they keep working after unpublish/soft-delete; (3) refunded/charged-back transactions must stop minting new URLs (already-issued ones expire with `download_ttl_seconds`); (4) a seller's "delete forever" for sold drops should only be possible after the retention period and with the buyers' access window closed, and a legal/abuse takedown (flagged) must be able to revoke everything regardless. Signed URLs are stateless HMACs and are not individually revocable: after a hard delete they simply 404 (file gone).

## Not built / untested
- **Untested live:** Google OAuth (needs credentials), Resend/Postmark mail adapters (unit-tested against a mocked `fetch` only), S3/R2 adapter, `docker-compose.yml` (no Docker on the build box).
- **Not built:** buyer download flow after payment, reports UI, admin UI for settings, video transcoding/streaming playback (originals are only downloadable, previews are still frames), email verification (password reset **is** built), NSFW/CSAM scanning (important before any public launch), malware scanning, S3 presigned uploads.
