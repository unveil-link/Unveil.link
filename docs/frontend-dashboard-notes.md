# Frontend: seller dashboard, buyer page, auth polish — `frontend/dashboard`

Branched from `origin/main` @ `94af2c0`. **Frontend only** — no backend route, service, migration or test was changed.
Needs **QA + coordinator review** before any merge to `main` (not merged).

## How to run & verify

```bash
npm ci
cp .env.example .env              # set SESSION_SECRET / SIGNED_URL_SECRET (openssl rand -base64 48), DATABASE_URL
createdb unveil_fe                # or any DB; point DATABASE_URL at it
npm run migrate
npm run build && bash scripts/dev-start.sh 3400     # or: npm run dev -- -p 3400   (3000 may be taken by another agent)
npx tsx scripts/seed-demo.ts      # creates 3 sellers via the real API (+ SQL for sales/payouts/flagged) -> .e2e/seed.json
node scripts/screenshots-dashboard.mjs              # re-takes every screenshot into screenshots/dashboard/
npm run lint && npm run build && npm test           # all pass;  npm run e2e  (backend regression) still 46/46
```
Optional `.env` knobs used while capturing screenshots: `LOGIN_DELAY_THRESHOLD=3`, `LOGIN_DELAY_BASE_SECONDS=20`, `LOGIN_DELAY_CAP_SECONDS=60`
(so the progressive login delay is easy to reach) and relaxed `RATE_LIMIT_LOGIN_IP/SIGNUP_IP/CHECKOUT`.
`seed-demo` logins: `maya+…@example.test` (verified, populated), `sam+…` (new, empty state), `jo+…` (pending, one draft); password `Sunrise-Harbor-4821` (printed + in `.e2e/seed.json`).

Manual checks: sign up → `/dashboard` (empty state) → *New drop* → fill, add images (try a `.txt`, a `.gif`, a price of `0.50`) → upload progress → success with `unveil.link/u/<id>`;
`npm run verify-seller -- you@example.com verified` → publish (3 attestations) → *Copy link* → open `/u/<id>` → *Buy* (stub message) → *Unpublish* → `/u/<id>` shows "link isn't available".
Wrong password 4× on one email → 429 `login_delayed` → countdown on the button.

## What changed (page by page)

| Route | Notes |
|---|---|
| `/signup`, `/login` | Split layout (brand panel on desktop). Inline validation on blur/submit, show/hide password, live strength meter + checklist of the backend's *cheap* rules (≥10 chars, not email/name, no repeats/sequences), server `weak_password` message shown verbatim and marks the meter "Too common"; `email_taken`; generic wrong-credentials message (same for unknown email); network errors; `aria-live` errors, focus moves to the first invalid field / error summary; Google button only if configured. |
| 429 handling (all auth forms) | `Retry-After` parsed (seconds or HTTP-date) → submit disabled, label becomes "Try again in Ns", visible countdown card, one polite SR announcement at start and end. Distinguishes `login_delayed` (progressive delay) vs `rate_limited`. |
| `/forgot-password`, `/reset-password` | Same shell/validation/throttle; reset shows strength meter, handles `invalid_token` ("Link expired"), missing token, weak server password. |
| `/dashboard` | Responsive shell (sidebar ≥1024px; top bar + bottom tab nav on mobile; skip link; sign-out). Earnings cards: **Gross sales**, **Your {100−fee_percent}%** (fee from `platform_settings.fee_percent`, default 10 → "Your 90%"), **Available**, **Pending payouts** (+ paid-out hint). Verification banner, drops table (desktop) / cards (mobile), loading skeleton (`loading.tsx`), error boundary, not-found. |
| `/dashboard/drops` | Full list with status tabs (All / Published / Drafts / Unpublished / Under review) and counts. Per-drop: thumbnail (blurred preview), status badge (`draft`, `published`, `unpublished`, `flagged`→"Under review"), price, files, **units + revenue**, *Copy link* (published), *Publish* (draft/unpublished; opens attestation dialog), *Unpublish* (confirm modal), *Manage*. |
| `/dashboard/drops/new` | Title / price (limits from `platform_settings`, live) / description; drag-and-drop + picker; per-file validation (JPG/PNG/WebP, 15 MB image cap from settings, 10 files, 2 GB/drop, duplicates; MP4 recognised but blocked with a "coming soon" message because the backend has no video upload); per-file `XMLHttpRequest` progress bars; retry per file; optional "publish right after upload" with the 3 required attestations (`over18`, `ownsRights`, `consentOfSubjects`); success state with `unveil.link/u/<id>` + copy; graceful draft fallback when the seller isn't verified. |
| `/dashboard/drops/[id]` | Rebuilt editor: status, share link, stats, blurred previews with sizes, add-more-files dropzone (same validation/progress), publish/unpublish. |
| `/u/[linkId]` | Landing-style buyer page, mobile-first: blurred hero + thumbnails, lock badge, "Verified creator" badge, title, seller name, description, file count/types, price, terms checkbox, **Buy** button, trust points (secure checkout / instant download / no account), "All sales are final". **Buy stays stubbed**: it calls the existing `POST /api/checkout` (rate-limited, 501) and shows a friendly "Checkout is in test mode — nothing was charged" notice; 429 → countdown on the button. Branded `not-found` ("This link isn't available") also covers unpublished/draft/flagged. |
| Download page | **No such route exists** in the backend (no orders, no buyer signed-URL minting). A presentational `components/buyer/DownloadPanel` is designed and shown on `/design` (and screenshotted) so wiring is trivial once an order flow exists. |
| `/design` | New sections: Alerts, Stat cards, Progress & skeleton, Tabs & table, Modal/Toast/Checkbox, Empty state, Password strength, Download panel. |

## New design-system pieces (`components/ui`)
`Alert`, `Progress`, `Skeleton`, `StatCard`, `EmptyState`, `Table/THead/TBody/Tr/Th/Td`, `Tabs` (arrow-key roving tabindex), `Modal` (native `<dialog>`), `Toast` (`ToastProvider`/`useToast`/`ToastViewport`), `Checkbox`, `icons.tsx` (shared icon set incl. re-exports of landing icons).
App components: `components/auth/*` (AuthShell, PasswordInput, PasswordStrength, ThrottleNotice, useThrottle), `components/dashboard/*`, `components/buyer/*`. No new colour tokens were needed; `lib/` gained `api.ts` (typed fetch, `Retry-After` parser), `useCountdown.ts`, `upload.ts`, `upload-limits.ts`, `password-hint.ts`, `format.ts`, `share.ts`. 19 unit tests added (`tests/frontend-lib.test.ts`).

## Backend API gaps / mismatches found (not fixed — out of scope)
1. **No earnings/payouts/stats API.** No `GET /api/earnings`, `/api/payouts`, `/api/transactions`, or per-drop stats. The dashboard reads aggregates directly from `transactions`/`payouts` in a server component (`src/app/dashboard/data.ts`) — nothing writes those tables yet, so real accounts show $0. Swap for a fetch once an endpoint exists.
2. **No views counter anywhere** — only units/revenue (from `transactions`) are shown; "views" are omitted.
3. **`fee_percent` is not exposed by `GET /api/settings`**; the dashboard reads `platform_settings` server-side. Suggest adding `feePercent` to `/api/settings`. Also `transactions.platform_fee_cents`/`processing_fee_cents` are never computed (no fee logic). Labels use "Your {100−fee}%" with the 10% default.
4. **Video upload not implemented** (`/api/drops/:id/files` is images-only, 15 MiB cap from `max_image_size_bytes`; `max_video_size_bytes` 500 MiB exists but unused; `/api/settings` doesn't return it). UI accepts `.mp4` selection but blocks it with a clear message (`videoUploadEnabled` flag in `lib/upload-limits.ts`). The spec "500 MB/file" currently only applies to video; **images are capped at 15 MB** on the backend.
5. **No checkout / order / buyer-download flow** (`POST /api/checkout` → 501). The "self-declared checkbox for flagged drops" is not required by the backend: `/u/<id>` 404s for anything not `published` (flagged included), so no such checkbox is rendered; the terms/"all sales final" checkbox is client-side only (nothing stored).
6. **Publish requires verification** (`verification_required` 403) and there is no verification flow/UI backend (only `npm run verify-seller`); the UI explains this and keeps drops as drafts.
7. **No drop edit/delete endpoints** (`PATCH /api/drops/:id`, `DELETE /api/drops/:id/files/:fileId`) — title/price/description can't be changed after creation and files can't be removed; the editor only adds files.
8. `GET /api/drops` returns snake_case rows without `units/revenue/views/thumbnail`; `GET /api/drops/:id` omits `public_link_id`-based URL. `POST …/files` is buffered in memory and has no progress/resume (client uses XHR upload progress).
9. `Drop` list/`/api/drops/:id` do not expose `published_at` or attestation info.
10. `next.config.ts` CSP has `upgrade-insecure-requests` in production builds: on plain `http://localhost` this makes Chromium retry some sub-requests/prefetches over https (harmless, but breaks `networkidle` waits and shows `ERR_SSL_PROTOCOL_ERROR` in the console when testing a prod build locally).
11. `/terms`, `/privacy`, `/dmca`, `/contact` are linked from the landing footer, signup and buyer page but the pages do not exist (404).
12. Landing header links to `/signin` (redirect to `/login` exists in `next.config.ts`) — fine, noted only.

## Screenshots
`screenshots/dashboard/<name>-mobile-390x844.png` (2× DPR) and `<name>-desktop-1280x800.png`, full-page, produced by `scripts/screenshots-dashboard.mjs` (list in `screenshots/dashboard/INDEX.md`; horizontal-overflow audit at 360/390/1280 in `overflow-report.json` — all 0px).
Notes: the signup 429 screenshot uses a mocked 429 response (same shape as the real `SIGNUP_IP` limiter: `429`, `Retry-After`, `{code:"rate_limited"}`); the sign-in lockout shots use the **real** progressive login delay.
