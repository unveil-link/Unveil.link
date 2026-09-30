# Unveil (unveil.link)

Creators sell photos/videos through payment links. Buyers see a **blurred preview**; originals stay **private** and are only released through expiring, HMAC-signed URLs.

**Status of this foundation:** auth, schema, private storage, image upload + blur pipeline, signed-URL delivery, publish gating and a full automated e2e proof are built. **Not built yet:** payments/checkout, payouts, video upload, ID-verification provider, admin UI, reports UI. See [Not built / untested](#not-built--untested).

## Stack
Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · PostgreSQL 17 · `pg` · `jose` (JWT sessions) · `bcryptjs` · `sharp` · `zod` · vitest.

## Repo structure
```
db/migrations/           001_init.sql, 002_platform_settings.sql  (plain SQL, applied in filename order)
scripts/
  migrate.ts             migration runner (schema_migrations table, advisory lock, one tx per file)
  set-verification.ts    dev helper: flip a seller's verification_status (stand-in for the future KYC provider/admin)
  e2e.sh / e2e.ts        end-to-end proof (builds + starts app on :3100 with throwaway DB & storage)
  e2e-setup.ts           recreates the throwaway `unveil_e2e` database
src/server/              server layer — no React, no route code
  config.ts              lazy env access
  db/                    pg Pool, query helpers, transactions
  auth/                  password.ts (bcrypt), session.ts (JWT cookie), google.ts (OAuth/OIDC + PKCE)
  storage/               Storage interface; local.ts (private dir), s3.ts (S3/R2 adapter), index.ts (env switch)
  services/              sellers, drops, images (validate → blur → store), signing (HMAC URLs), settings
  http.ts, errors.ts     route wrapper (error mapping, same-origin guard), requireSeller
src/app/                 UI + route handlers (thin: parse → call service → respond)
  api/auth/{signup,login,logout,me,google,google/callback}
  api/drops, api/drops/[id], .../files (upload), .../publish, .../unpublish
  api/files/[id]/{preview,original,signed-url}
  api/public/drops/[linkId], api/settings
  signup, login, dashboard, dashboard/drops/[id], d/[linkId] (public drop page)
src/app/design, components/, lib/  landing page + design system (from another workstream; pages here reuse `components/ui`)
tests/signing.test.ts    unit tests for signed URLs (vitest)
proof/                   compare.png, db.txt, test-original.jpg (output of the e2e run)
docker-compose.yml       Postgres 17 for your machine
.env.example             all env vars
```

## Run it locally
Prereqs: Node 20+, and PostgreSQL 15+ (via Docker below, or a local install).

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
npm test          # unit tests (signed URL logic)
npm run e2e       # = bash scripts/e2e.sh : full end-to-end proof, 23 checks, writes proof/*
```
`e2e.sh` needs Postgres reachable with the creds in `.env`; it creates/drops a separate database `unveil_e2e` (refuses any DB name not containing `e2e`), builds into `.next-e2e`, and uses its own storage dir `.e2e/storage`. It never touches your dev DB or `storage-data/`.

## Environment
See `.env.example`. Key vars: `DATABASE_URL`, `SESSION_SECRET`, `SIGNED_URL_SECRET`, `STORAGE_DRIVER` (`local`|`s3`), `STORAGE_LOCAL_DIR`, `S3_*`, `GOOGLE_CLIENT_ID/SECRET`, `APP_URL`. `.env` is gitignored.

### Google OAuth setup (UNTESTED LIVE)
1. Google Cloud Console → APIs & Services → Credentials → *Create OAuth client ID* (Web application).
2. Authorised redirect URI: `${APP_URL}/api/auth/google/callback` (e.g. `http://localhost:3000/api/auth/google/callback`).
3. Put the client id/secret in `.env` and restart. The "Continue with Google" button appears only when both are set; `/api/auth/google` returns 501 otherwise.

Implementation: authorization-code flow with PKCE (S256), `state` and `nonce` kept in a short-lived httpOnly cookie, ID token verified against Google's JWKS (issuer, audience, nonce, `email_verified`). New Google users are created with `verification_status=pending`; an existing email/password account with the same verified email gets linked. **This was not run against real Google** (no credentials available); only the authorization-URL construction and the "not configured" path were exercised.

### S3 / Cloudflare R2
Set `STORAGE_DRIVER=s3`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION` (`auto` for R2) and `S3_ENDPOINT` (R2: `https://<account>.r2.cloudflarestorage.com`). The adapter (`src/server/storage/s3.ts`) uses the AWS SDK; **it is implemented but untested** (no bucket available). Keep the bucket private.

## Decisions
- **Server layer separated** from route handlers: handlers only validate input and call `src/server/services/*`. Swapping Next route handlers for a separate API process later means moving `src/server` and thin handlers.
- **Sessions:** JWT (HS256, `jose`) in an `httpOnly`, `SameSite=Lax`, `Secure`-in-prod cookie, 7-day expiry, looked up against the DB on every request (so deleted sellers lose access immediately). No server-side session revocation list yet. Passwords: bcrypt cost 12 (`bcryptjs`, pure JS, no native build); constant-time-ish login for unknown emails. CSRF: mutating API calls with a mismatching `Origin` are rejected, plus SameSite=Lax.
- **Migrations:** plain SQL + ~50-line runner (no ORM). Forward-only.
- **Extra schema beyond spec §11:** `admins` (so `audit_log.admin_id` has an FK), `platform_settings` (single row: `fee_percent` default 10, price min/max, image/video size limits, max files, allowed MIME types), enums for statuses, `payout_status`/`report_status` enums (spec didn't list values), `updated_at/published_at` on drops, `created_at` on drop_files, `google_id` unique, `email` forced lowercase, CHECK that a seller has a password or Google id, `seller_net = amount − fees` CHECK on transactions, unique `processor_ref`. FKs: seller data cascades for drops/files/reports; `transactions`/`payouts` use RESTRICT so money records can't be silently deleted.
- **Price bounds** are enforced twice: hard `CHECK (100..50000)` in the DB, plus tunable (narrower) bounds from `platform_settings` in the service. The settings table's own CHECKs stop it being set outside the hard range. Upload size limits are read from `platform_settings` on every request (no deploy needed). There is no admin UI yet — edit via SQL.
- **`public_link_id`:** 9 CSPRNG bytes → 12-char base64url (72 bits), unique index + CHECK on format, retry on collision.
- **Storage:** `Storage` interface (`put/get/exists/delete`). Local driver writes under `STORAGE_LOCAL_DIR` (default `./storage-data`, outside `public/`, gitignored, dirs 0700 / files 0600, path-traversal guarded). Keys are random (`originals/<dropId>/<fileId>.<ext>`), never user-supplied.
- **Delivery:** the only route that can return original bytes is `GET /api/files/:id/original?exp&sig`, where `sig = HMAC-SHA256(SIGNED_URL_SECRET, "original:<fileId>:<exp>")`, compared timing-safely. Missing/bad signature → 403, expired → 410, `Cache-Control: private, no-store`, `Content-Disposition: attachment`. Default TTL 5 min. Owner can mint one via `POST /api/files/:id/signed-url`; the future post-payment flow will mint them for buyers. `GET /api/files/:id/preview` can only read `blurred_preview_key`, and only for published drops (or to the owner for their drafts).
- **Blur:** EXIF-orient → downscale to ≤320px → gaussian blur σ=18 → JPEG q55; sharp drops all metadata (EXIF/GPS/ICC/XMP) by default. The e2e test asserts preview high-frequency detail < 20% of the original's (measured ≈12%), dimensions ≤320, no metadata, size <10%.
- **Upload validation:** format is decided by decoding with sharp (client MIME/extension is ignored), only JPEG/PNG/WebP (from settings), pixel-count cap (100MP), size cap from settings (early `Content-Length` check then post-read check). Uploads are buffered in memory (fine for ≤15 MB images; **videos will need streaming/presigned multipart uploads**).
- **Publish rule:** only `verification_status='verified'` sellers can publish (enforced in `services/drops.ts`, not in the UI); publish also requires the three attestations (18+, rights, consent) which are stored in `drops.attestation`, and ≥1 file. Drafts/uploads are open to unverified sellers.
- **Verification** is a stub: nothing moves a seller out of `pending` except `npm run verify-seller` / SQL. A KYC provider integration and admin review UI are future work.
- **Ports/DBs in the repo environment:** Postgres was installed with apt on the dev box (no Docker there); `docker-compose.yml` is provided for your machine but **was not run here**.

## Not built / untested
- **Untested live:** Google OAuth (needs credentials), S3/R2 adapter, `docker-compose.yml` (no Docker on the build box).
- **Not built:** payments/checkout & buyer download flow, fee computation, payouts, refunds/chargebacks, reports UI, admin UI/audit writes, video upload + thumbnails, rate limiting / login throttling, email verification & password reset, NSFW/CSAM scanning (important before any public launch), malware scanning, S3 presigned uploads.
