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
npm run lint && npm run build && npm test           # all pass;  npm run e2e  (backend + payments regression + FE checks)
```
`/design` is a 404 in production builds unless `ENABLE_DESIGN_PAGE=1` — start the screenshot server with `ENABLE_DESIGN_PAGE=1 bash scripts/dev-start.sh 3400`.
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
| `/dashboard` | Responsive shell (sidebar ≥1024px; top bar + bottom tab nav on mobile; skip link; sign-out). Earnings (see *QA follow-up* below): **Gross sales**, **Platform fee**, **Processing fees**, **Your earnings (net)** + a reconciliation line, then **Available**, **Pending payouts**, **Paid out**. Verification banner, drops table (desktop) / cards (mobile), loading skeleton (`loading.tsx`), error boundary, not-found. |
| `/dashboard/drops` | Full list with status tabs (All / Published / Drafts / Unpublished / Under review) and counts. Per-drop: thumbnail (blurred preview), status badge (`draft`, `published`, `unpublished`, `flagged`→"Under review"), price, files, **units + revenue**, *Copy link* (published), *Publish* (draft/unpublished; opens attestation dialog), *Unpublish* (confirm modal), *Manage*. |
| `/dashboard/drops/new` | Title / price (limits from `platform_settings`, live) / description; drag-and-drop + picker; per-file validation (JPG/PNG/WebP, 15 MB image cap from settings, 10 files, 2 GB/drop, duplicates; MP4 recognised but blocked with a "coming soon" message because the backend has no video upload); per-file `XMLHttpRequest` progress bars; retry per file; optional "publish right after upload" with the 3 required attestations (`over18`, `ownsRights`, `consentOfSubjects`); success state with `unveil.link/u/<id>` + copy; graceful draft fallback when the seller isn't verified. |
| `/dashboard/drops/[id]` | Rebuilt editor: status, share link, stats, blurred previews with sizes, add-more-files dropzone (same validation/progress), publish/unpublish. |
| `/u/[linkId]` | Landing-style buyer page, mobile-first: blurred hero + thumbnails, lock badge, "Verified creator" badge (only while the seller is currently `verified`), title, seller name, description, file count/types, price, terms checkbox, **Buy** button, trust points (secure checkout / instant download / no account), "All sales are final". **Buy stays stubbed**: it calls the existing `POST /api/checkout` (rate-limited, 501) and shows a friendly "Checkout is in test mode — nothing was charged" notice; 429 → countdown on the button. Branded `not-found` ("This link isn't available") also covers unpublished/draft/flagged. |
| Download page | **No such route exists** in the backend (no orders, no buyer signed-URL minting). A presentational `components/buyer/DownloadPanel` is designed and shown on `/design` (and screenshotted) so wiring is trivial once an order flow exists. |
| `/design` | New sections: Alerts, Stat cards, Progress & skeleton, Tabs & table, Modal/Toast/Checkbox, Empty state, Password strength, Download panel. |

## New design-system pieces (`components/ui`)
`Alert`, `Progress`, `Skeleton`, `StatCard`, `EmptyState`, `Table/THead/TBody/Tr/Th/Td`, `Tabs` (arrow-key roving tabindex), `Modal` (native `<dialog>`), `Toast` (`ToastProvider`/`useToast`/`ToastViewport`), `Checkbox`, `icons.tsx` (shared icon set incl. re-exports of landing icons).
App components: `components/auth/*` (AuthShell, PasswordInput, PasswordStrength, ThrottleNotice, useThrottle), `components/dashboard/*`, `components/buyer/*`. No new colour tokens were needed; `lib/` gained `api.ts` (typed fetch, `Retry-After` parser), `useCountdown.ts`, `upload.ts`, `upload-limits.ts`, `password-hint.ts`, `format.ts`, `share.ts`. 19 unit tests added (`tests/frontend-lib.test.ts`).

## Backend API gaps / mismatches found (not fixed — out of scope)
1. ~~No earnings API~~ — resolved: `main` now has `GET /api/earnings` / `getEarningsSummary` (see "Earnings data source"). Still missing: per-drop stats (units/revenue come from two small queries), payout request UI/API for sellers.
2. **No views counter anywhere** — only units/revenue (from `transactions`) are shown; "views" are omitted.
3. **`fee_percent` is not exposed by `GET /api/settings`**; the dashboard reads `platform_settings` server-side. Suggest adding `feePercent` to `/api/settings`. Also `transactions.platform_fee_cents`/`processing_fee_cents` are never computed (no fee logic). (Superseded: the dashboard no longer hard-codes any percentage — see QA follow-up.)
4. **Video upload not implemented** (`/api/drops/:id/files` is images-only, 15 MiB cap from `max_image_size_bytes`; `max_video_size_bytes` 500 MiB exists but unused; `/api/settings` doesn't return it). UI accepts `.mp4` selection but blocks it with a clear message (`videoUploadEnabled` flag in `lib/upload-limits.ts`). The spec "500 MB/file" currently only applies to video; **images are capped at 15 MB** on the backend.
5. **No checkout / order / buyer-download flow** (`POST /api/checkout` → 501). The "self-declared checkbox for flagged drops" is not required by the backend: `/u/<id>` 404s for anything not `published` (flagged included), so no such checkbox is rendered; the terms/"all sales final" checkbox is client-side only (nothing stored).
6. **Publish requires verification** (`verification_required` 403) and there is no verification flow/UI backend (only `npm run verify-seller`); the UI explains this and keeps drops as drafts.
7. **No drop edit/delete endpoints** (`PATCH /api/drops/:id`, `DELETE /api/drops/:id/files/:fileId`) — title/price/description can't be changed after creation and files can't be removed; the editor only adds files.
8. `GET /api/drops` returns snake_case rows without `units/revenue/views/thumbnail`; `GET /api/drops/:id` omits `public_link_id`-based URL. `POST …/files` is buffered in memory and has no progress/resume (client uses XHR upload progress).
9. `Drop` list/`/api/drops/:id` do not expose `published_at` or attestation info.
10. `next.config.ts` CSP has `upgrade-insecure-requests` in production builds: on plain `http://localhost` this makes Chromium retry some sub-requests/prefetches over https (harmless, but breaks `networkidle` waits and shows `ERR_SSL_PROTOCOL_ERROR` in the console when testing a prod build locally).
11. ~~`/terms`, `/privacy`, `/dmca`, `/contact` do not exist (404)~~ — now "Coming soon" placeholders (noindex), no legal text; real content still needed.
12. Landing header links to `/signin` (redirect to `/login` exists in `next.config.ts`) — fine, noted only.

## QA follow-up (QA run on `faa38d4`, report `qa/results-frontend-dashboard-1.md`)
| ID | What changed | How to verify |
|---|---|---|
| **FE-01** (Medium) | Overview shows **Gross sales**, **Platform fee**, **Processing fees** (separate cards, each with its real % of completed sales), **Your earnings (net)** (no more "Your 90%"; the % shown is computed, e.g. 85% in the seed), a reconciliation line `gross − platform fee − processing fees [− refunded] [− charged back] = net`, and a *Reversed sales: $X refunded · $Y charged back* line (refunds and chargebacks are separate everywhere; `charged_back` is no longer counted as "refunded"). Second row: **Available**, **Pending payouts**, **Paid out**. Math lives in `lib/earnings.ts` (unit-tested). | `BASE_URL=http://localhost:3400 npx tsx scripts/seed-demo.ts`, sign in as maya → `/dashboard`: $506.00 gross (30 sales + one $50 refunded + one $25 charged-back row) − $43.10 − $21.56 − $50.00 − $25.00 = **$366.34**; Available $156.34, Pending $60.00, Paid out $150.00 (same numbers QA reconciled; the reversed rows do not change fees/net). `npm test` → `tests/frontend-earnings.test.ts`. |
| FE-02 | `Modal` remembers the element focused when it opened and returns focus to it on close (Esc, X, Cancel/Keep, backdrop; also if the parent unmounts the dialog). `DropList`'s row actions were a component defined inside render (remounted on every state change, which destroyed the trigger) — now a plain render helper. | `/dashboard/drops` → Tab to *Unpublish* or *Publish* → Enter → Esc: `document.activeElement` is that button again. |
| FE-03 | `/u/[linkId]` uses `generateMetadata`: title = drop title → `<title>Sunset set · Unveil</title>`; unavailable link → `Link unavailable · Unveil`. | `curl -s localhost:3400/u/<id> \| grep -o '<title>[^<]*'` (also an e2e check). |
| FE-04 | Seller query now reads `verification_status`; badge renders only when it is `verified` (hidden for pending/failed/manual_review/unknown seller), evaluated per request (page is `force-dynamic`). | Set `sellers.verification_status='pending'` for a seller with a live drop → reload `/u/<id>`: no badge (e2e check toggles it). |
| FE-05 | `formatDuration` (`lib/format.ts`): ≤120 s stays `45s`; then `5 min`, `58 min`, `1 h 12 min`, `2 h` (rounded **up**). Used in the button label, the throttle card, and the Buy button. Screen-reader text uses the long form ("1 hour 12 minutes") and is announced once at start and end (the ticking number stays `aria-hidden`). | Screenshots `signup-429-long-wait-*`, `buyer-429-long-wait-*`; `npm test`. |
| FE-06 | `/design` calls `notFound()` when `NODE_ENV==='production'` unless `ENABLE_DESIGN_PAGE=1` (page is `force-dynamic`, so the env var is read at request time). Documented in `.env.example`. | `curl -o /dev/null -w '%{http_code}' localhost:3400/design` → 404 (200 with the flag); e2e check. |
| Placeholders | `/terms`, `/privacy`, `/dmca`, `/contact`: shared `ComingSoon` page ("Coming soon." + back link), `robots: noindex`, no legal wording. The footer / signup / Buy-flow links now resolve. | Click *Terms* on a buyer page; screenshots `placeholder-terms-*`, `placeholder-privacy-*`. |

### Earnings data source (updated after rebasing onto `main` with payments)
`main` now contains the payments layer (migrations 005–012, ledger, `GET /api/earnings`). The dashboard no longer has any earnings maths of its own:
`src/app/dashboard/data.ts#getEarnings` calls payments' `getEarningsSummary(sellerId)` **directly** (the function behind `GET /api/earnings`). That is the idiomatic choice for a server component: the seller id comes from the session (`getSessionSellerId`), never from the client (seller isolation), and there is no extra HTTP hop or cookie forwarding. The HTTP endpoint is unchanged and is checked against the dashboard in the e2e.
`lib/earnings.ts#toEarningsView` only maps names and derives display figures. Mapping (`EarningsSummary` → UI):

| UI figure | Source |
|---|---|
| Gross sales (+ sales count) | `lifetime.grossCents`, `lifetime.salesCount` (sum of `sale_credit`; refunded/charged-back sales stay in gross) |
| Platform fee | `lifetime.platformFeeCents` (ledger, already net of fee shares returned on refunds/chargebacks) |
| Processing fees | `lifetime.processingFeeCents` (same) |
| Refunded / Charged back | `lifetime.refundedCents` / `lifetime.chargebackCents` (partial refunds included; always shown separately) |
| Your earnings (net) | `balance.totalCents + lifetime.paidOutCents + lifetime.requestedPayoutCents` (payouts only move money out of the balance, so adding them back gives lifetime net; includes chargeback fees) |
| Chargeback fees (only if ≠ 0) | residual `gross − refunded − chargebacks − platform − processing − net` (the summary doesn't list them separately) |
| Available | `balance.availableCents` — **may be negative**, shown as "Balance owed" (red) + explanation, never clamped |
| Pending | `balance.pendingCents` (inside the `holdDays` hold, e.g. 7 days) |
| In payout | `lifetime.requestedPayoutCents` (payouts `requested`/`approved`) |
| Paid out | `lifetime.paidOutCents` |
| hint texts | `holdDays`, `minPayoutCents`, `payoutEligible` |

Invariant (unit-tested and used in the e2e): Available + Pending + In payout + Paid out = Net.
Per-drop *Sold / Revenue* still come from one small read-only `transactions` query (`getDropStats`) because the summary has no per-drop data. Since round 3 **Revenue = gross kept**: `amount_cents − reversed_cents` over completed / refunded / charged-back sales (partial refunds and chargebacks deducted; fully reversed sales are not a unit). The per-drop totals therefore equal the earnings card's `gross − refunded − charged back`.

### Round 2 QA (`qa/results-frontend-dashboard-2.md`)
| ID | What changed | How to verify |
|---|---|---|
| FE-07 | Duplicated SQL/maths removed (see above): pending/in-payout, hold, partial refunds, chargeback fees, failed/pending checkouts all come from the ledger. | `qa/scripts/qa-fe2-divergence.mjs` scenario; or seed + compare `/dashboard` to `GET /api/earnings` (e2e check "[FE-07/08]"). |
| FE-08 | No `Math.max(0, …)`: negative available shows as **Balance owed −$46.80**, red card + alert "You owe …, deducted from future earnings". | seed seller `ned` (sale paid out, then refunded); screenshot `dashboard-overview-negative-balance`. |
| FE-09 | `X-Robots-Tag: noindex, nofollow` on `/terms /privacy /dmca /contact` via `next.config.ts` headers (meta robots kept). | `curl -sI localhost:3400/terms | grep -i x-robots`. |
| FE-10 | `components/LegalLinks.tsx` (Terms · Privacy · DMCA · Contact) under the auth forms (`/login /signup /forgot-password /reset-password`), in the dashboard shell footer, in the buyer-page footer (so also the unavailable page). Landing footer reuses the same list. | `curl -s localhost:3400/login | grep -o 'href="/\(terms\|privacy\|dmca\|contact\)"' | sort -u`; e2e check. |
| FE-11 | New-drop 429 banner and upload errors use `formatDurationLong` ("…in 58 minutes"). | `tests/frontend-earnings.test.ts`. |
| og/twitter | `/u/<id>` has page-specific `og:*`/`twitter:*`: title "<drop title> · Unveil", description "A payment link by <seller name> on Unveil." (only what the page already shows publicly), generic `/icons/icon-512.png`, canonical URL. No description text, price, file names or preview images. Unavailable links keep the generic site tags. | view-source of `/u/<id>`; e2e check. |
| Buy flow | After the rebase `main` has a real checkout (`POST /api/checkout` → hosted page). `BuyPanel` was re-pointed at that contract (email + 18+ confirmation + `Idempotency-Key`, redirect to `checkoutUrl`, 429 countdown) and keeps our design; main's plain `BuyForm.tsx` is left in the tree but unused. The "All sales are final" text now comes from `lib/purchase-copy.ts`. | `/u/<id>` → fill email, tick box → lands on `/pay/mock/<session>` (local/test only). |

Rebase note: 12 frontend commits replayed onto `origin/main` @ `10c4e65`; conflicts: `src/app/u/[linkId]/page.tsx` (main changed it for BuyForm; ours kept) and `.env.example` (both blocks kept). `src/app/components/AppShell.tsx` (deleted by our dashboard rewrite) is restored because main's admin/hosted-checkout pages import it.

`seed-demo` now drives the **real** payments pipeline (mock processor: checkout → pay → refund/partial refund/chargeback webhooks → payout service) and needs `PAYMENT_WEBHOOK_SECRET` and `MOCK_PAYMENTS_ENABLED=1` in `.env`. Sellers: `maya` (available + pending + in-payout + paid-out, full and partial refund, chargeback with $5 fee), `ned` (negative balance), `sam`, `jo`.

### Round 3 QA (`qa/results-frontend-dashboard-3.md`, branch `frontend/polish-1`)
| ID | Change | How to verify |
|---|---|---|
| FE-14 | Buyer page / checkout no longer promise a receipt email or instant download (no receipt / order / download routes exist yet). Email label is just "Email"; button "Pay $X"; sub-line "Pay by card · No account needed"; trust point "Access after payment — once your payment is confirmed, we'll share how to access your files. Delivery options are coming soon."; `SALES_FINAL_TEXT` (`lib/purchase-copy.ts`, shared with the hosted mock page) drops "delivered immediately" but keeps "All sales are final". `DownloadPanel` untouched. **Not changed (marketing, out of the brief):** landing Hero / BuyerTrust / FAQ / PaymentLinkMock, auth shell ("Instant delivery"), site meta description. | `/u/<id>`: no "receipt" / "Instant download"; `tests/frontend-lib.test.ts` ("copy guards"); e2e `[FE-…] price shown`. |
| FE-12 | "Balance owed" hint → "Below zero. It will be deducted from future earnings."; alert body no longer says "after a payout / already been paid out". | `/dashboard` as `ned` (negative balance); copy-guard unit test. |
| FE-13 | Negative-balance alert is `tone="danger"` with `role="alert"` _(superseded in the copy sweep: now `role="status"`)_ (red, matches the red card; it is an urgent, always-visible account state). Contrast: body text `#14121f` on `danger-soft` ≈ 16:1, icon / border `#c62828` on `#fdeaea` ≈ 4.9:1 (≥ 3:1 for non-text). | `dashboard-overview-negative-balance` screenshot; `[role=alert][data-testid=negative-balance]`. |
| FE-15 | `getDropStats` is refund- and chargeback-aware (see "Earnings data source"). Maya: Spring 21 / $252 + Studio 6 / $140 + Travel 4 / $32 = **$424.00** = ledger gross kept ($467 − $35 − $8). | DB test `dashboard per-drop stats reconcile with the earnings summary` (`tests/db/payments.test.ts`); e2e "per-drop revenue == gross kept"; `/dashboard/drops` as `maya`. |
| Lint | `eslint.config.mjs` ignores `qa/**`, `proof/**`, `screenshots/**` (QA / evidence output, not app code) — plain `npm run lint` is clean. | `npm run lint`. |
| INFO no-store | `Cache-Control: no-store` for `GET /api/earnings` added as a header rule in `next.config.ts` (no backend file touched). `/dashboard*` pages were already `no-store` (dynamic). | `curl -si localhost:3400/api/earnings \| grep -i cache-control`. |
| Test infra | New `vitest.config.mts` only mirrors the tsconfig `@/` alias so tests can import dashboard modules. | `npm test`. |

Still open / not frontend: receipt, order and download routes (Backend / Payments); views & conversion (M4-10), M4-11, M4-17, M6-06; M5-16 (Legal).

### Copy sweep (`frontend/copy-sweep`, QA report `qa/results-frontend-polish-1.md`: FE-14R, FE-16, INFO)
Rule: until receipt emails, order pages and buyer downloads exist, **no page may promise them** (instant delivery, emailed receipts, backup download links, signed-link downloads, "unlock"). Allowed claims: secure card checkout, no account needed, private links / privately stored files with blurred previews, verified creators, creators keep most of each sale, "access to the files is shared once payment is confirmed" (+ "Delivery options are coming soon").

| Where | Before | After |
|---|---|---|
| `Hero.tsx:22` | "…and download instantly." | "…and access to the files is shared once payment is confirmed." |
| `PaymentLinkMock.tsx` badge / button / aria | "Instant download" / "Pay & download" / "…a Pay and download button" | "Verified creator" / "Pay $12" / "…a Pay button" |
| `HowItWorks.tsx:7` | "Buyers pay by card and download right away." | "Buyers pay by card, with no account needed. Access to the files is shared once payment is confirmed." |
| `BuyerTrust.tsx:7` | "Instant download — ready the moment your payment goes through" | "Access after payment — once your payment is confirmed, the creator's files are shared with you. Delivery options are coming soon." |
| `BuyerTrust.tsx:8` | "Private signed links — every download link is unique to your purchase and expires automatically" | "Private links — each payment link is private to the creator who shares it; files are stored privately with blurred previews until purchase" |
| `Faq.tsx` "Do buyers need an account?" | "…download straight away… send a receipt and a backup download link" | "No sign-up or password… access to the files is shared once the payment is confirmed. Delivery options are coming soon." |
| `Faq.tsx` "Are my files private?" | "…only delivered through signed links created after a successful purchase" | "Files are stored privately, and previews are blurred until a purchase. Payment links are private to the creator." |
| `Faq.tsx` "How do I get paid?" / "What does it cost?" | "Connect your bank account… regular schedule" / "a small fee is taken only when you get paid" (not accurate: fees are taken per sale; no seller payout-request UI) | earnings appear after a short hold; payouts via the payments partner once the minimum is reached / platform + card-processing fee on each sale, dashboard shows the breakdown |
| `AuthShell.tsx:10` (login / signup / forgot / reset) | "Instant delivery — files are delivered automatically" | "One link, anywhere — share your payment link in a message, bio or email; buyers check out with a card" |
| `layout.tsx:18` meta description | "…and download instantly." | "…and access to the files is shared once payment is confirmed." (og / twitter descriptions never had the promise) |
| `src/app/u/[linkId]/page.tsx:80` | "The full files unlock after purchase." | "Access to the full files is shared once your payment is confirmed." |
| `components/buyer/TrustPoints.tsx` | "Access after payment — once your payment is confirmed, we'll share how to access your files…" | "Access to the files is shared once your payment is confirmed. Delivery options are coming soon." |
| `src/app/u/[linkId]/BuyForm.tsx` | dead code, "Unlock for {price}" | deleted (imported nowhere) |

Left as is on purpose: `DownloadPanel` + its `/design` showcase (not routed; `/design` 404s unless `ENABLE_DESIGN_PAGE=1`), seller-side "Publishing unlocks once you're verified", "added to this drop right away" (uploads), "Becomes available right away" (payout hold), reset-password mail. **Backend-owned, not touched:** `PAYMENTS-NOTES.md` still mentions `BuyForm`/"Unlock for $X"; server strings (`src/server`, hosted mock page) contain no delivery/receipt promise.

**Regression guard:** `tests/copy-guard.test.ts` scans `components/`, `lib/`, `src/app/` (not `src/app/api`) for instant / right away / immediately / receipt / download / deliver / unlock / signed link (comment lines ignored) with a short, reasoned allowlist; e2e check `[copy-sweep]` renders `/`, auth pages and a buyer page (visible text, meta/og, aria-labels). `node qa/scripts/qa-fe4-copyaudit.mjs` now only reports the allowlisted items.

| ID | Change | How to verify |
|---|---|---|
| FE-16 | Gross card hint "N sales charged, before refunds"; when reversals exist the line under the cards adds "Per-drop Sold and Revenue are net of these reversals ($X kept)". Drops table / cards / drop detail: "Sold (net)" and "Revenue (kept)" (tooltips) plus a note under the list: fully reversed sales are not counted, partial refunds reduce revenue, revenue is before fees. Numbers unchanged (Maya: 31 net sold of 33 charged; $424.00 kept of $467.00 gross). | Maya `/dashboard` and `/dashboard/drops`; e2e `[FE-07/08]`. |
| INFO | Negative-balance alert is `role="status"` (polite) instead of `role="alert"`, red styling kept — no loud re-announcement on every load. | Ned `/dashboard`: `[data-testid=negative-balance][role=status]`. |

## Screenshots
`screenshots/dashboard/<name>-mobile-390x844.png` (2× DPR) and `<name>-desktop-1280x800.png`, full-page, produced by `scripts/screenshots-dashboard.mjs` (list in `screenshots/dashboard/INDEX.md`; horizontal-overflow audit at 360/390/1280 in `overflow-report.json` — all 0px).
Notes: the signup 429 screenshot uses a mocked 429 response (same shape as the real `SIGNUP_IP` limiter: `429`, `Retry-After`, `{code:"rate_limited"}`); the sign-in lockout shots use the **real** progressive login delay.

Retaken for the QA follow-up: `dashboard-overview`, `drop-unpublish-confirm`, `drop-publish-attestation-dialog`; new: `signup-429-long-wait`, `buyer-429-long-wait`, `placeholder-terms`, `placeholder-privacy`. `seed-demo` now also inserts one refunded and one charged-back sale for maya.

Round-2 screenshot changes: `dashboard-overview` (ledger-backed: available / pending / in payout / paid out, partial refund + chargeback + chargeback fee), new `dashboard-overview-negative-balance`, `buyer-ready-to-buy` / `buyer-hosted-checkout` (real checkout flow), and every auth / buyer / dashboard page now shows the Terms · Privacy · DMCA · Contact footer. The remaining pages (landing, `/design`) are unchanged.

Round-3 screenshot changes: all `buyer-*` (copy), `dashboard-overview`, `dashboard-overview-negative-balance` (red alert, new wording), `drop-list*` and `drop-detail-published` (refund-aware revenue).

Copy-sweep screenshots: landing (+ new `landing-faq-expanded`), `design`, all auth pages, `buyer-*`, `dashboard-overview*`, `drop-list*`, `drop-detail-*` (new copy / labels).
