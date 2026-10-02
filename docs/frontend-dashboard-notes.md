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
| Buy flow | After the rebase `main` has a real checkout (`POST /api/checkout` → hosted page). `BuyPanel` was re-pointed at that contract (email + 18+ confirmation + `Idempotency-Key`, redirect to `checkoutUrl`, 429 countdown) and keeps our design; main's plain `BuyForm.tsx` was left unused here and has since been deleted (copy sweep). The "All sales are final" text now comes from `lib/purchase-copy.ts`. | `/u/<id>` → fill email, tick box → lands on `/pay/mock/<session>` (local/test only). |

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

### Copy accuracy (`frontend/copy-accuracy`, QA report `qa/results-frontend-copy-sweep.md`: FE-17, FE-18, FE-19)
Rule: words must not over-promise features that are not live. Every claim below was checked against the code before it was kept: sales are `Pending` as soon as the payment is confirmed; the **7-day hold** only delays when they become `Available`; the only payout facts are the **$25 minimum** and that hold (`GET /api/earnings` → `holdDays`, `minPayoutCents`); payouts are RECORD-ONLY (`src/server/payments/payouts.ts`) and there is **no seller payout-request route/UI**; MP4 upload answers 415; publishing **does** require `verification_status = 'verified'` (enforced, but verification itself is a stub); only the mock processor exists. Feature flags live in `lib/features.ts` (`VIDEO_UPLOAD=false` also drives `DEFAULT_LIMITS.videoUploadEnabled`; flip it when video ships and Hero / meta / FAQ / how-it-works / mock card follow).

| ID | Where | Before | After |
|---|---|---|---|
| FE-17a | FAQ "How do I get paid?" | "show up in your dashboard after a short hold period. Payouts are handled through our payments partner…" | "Each sale is listed in your dashboard as Pending. After a 7-day hold it becomes Available, and payouts start at $25. Payout requests and processing are coming soon." |
| FE-17b | SellerCta perks | "Payouts straight to your bank", "Sales dashboard with simple analytics" | "Sales, fees and balance in your dashboard", "Payout requests coming soon" |
| FE-17c | meta description, Hero, How it works, FAQ "kinds of files", PaymentLinkMock | "photos and videos" / "12 photos · 2 videos" | "photos" (+ "video is coming soon" in the FAQ) via `SELLABLE` / `VIDEO_UPLOAD` in `lib/features.ts` |
| FE-17d | Hero badge, BuyerTrust, FAQ, dashboard (new-drop, publish dialog, drop editor, verification hint) | "Age-verified sellers", "identity- and age-verified", "Sellers are verified", "Publishing unlocks once your identity is verified" | "Verification required to publish", "A seller must have a verified status before they can publish a link, and the badge only shows while that is the case", "Publishing requires a verified account status" |
| FE-17d | BuyerTrust "Secure card checkout", TrustPoints, buyer footer | "Payments are processed by a trusted payment provider", "Card payments handled by a trusted provider", "Payments by a trusted provider" | "You pay by card on a separate checkout page, and Unveil does not store card numbers" / "You pay by card on a separate checkout page." / "Card checkout on a separate page. We never store card numbers." (no card data is stored anywhere in the code) |
| FE-17e | Dashboard Available hint; Paid out hint | "Ready for a payout"; "Sent to you so far" | "You've reached the $25.00 minimum. Payout requests are coming soon"; "Payouts marked as paid" |
| FE-17 | AuthShell "Private by design" | "Originals stay locked until a purchase is complete." | "Originals are stored privately. Buyers only see blurred previews." |
| FE-19 | BuyerTrust "Private links", FAQ "Are my files private?" | "Each payment link is private to the creator who shares it" / "Payment links are private to the creator…" | "Each payment link is long and unguessable, and it isn't listed or searchable. Only people the creator shares it with have it." (`/u/*` is `noindex`, no public listing, 12-char random id) |
| INFO | `BuyForm` mentions | stale in this file | removed; `PAYMENTS-NOTES.md` (backend-owned) still mentions `BuyForm` / "Unlock for $X" — not touched |
| kept | FAQ "What does it cost?" | accurate | unchanged |

**How the copy guard works (FE-18; superseded by "Copy guard 2" below).** `tests/copy-guard.test.ts` + `tests/helpers/copy-scan.ts` + `tests/copy-guard.allowlist.ts`:
1. **Extraction, not line regexes.** Every `.ts/.tsx` file is parsed with the TypeScript compiler (already a dependency); the scanner collects JSX text, string literals (JSX attributes such as `aria-label`/`title`/`alt`, metadata, error messages), template literals (holes → `{}`), string concatenation and `[...].join("")`. Identifiers (`DownloadIcon`), comments and import specifiers are not strings, so an icon name on the same line can no longer hide a promise.
2. **Normalisation + synonyms.** NFKC, zero-width characters removed, HTML entities decoded, whitespace collapsed, case-insensitive; 19 rule groups (instant/immediately/right away, receipt, emailed, inbox, backup link, signed link, deliver, download, unlock, "pay & download", trusted provider / payments partner, bank claims, identity/age-verified, "private to the creator", video) plus a letters-only check for spacing tricks ("in stant", "down-load").
3. **Exact allowlist.** Exemptions are exact file + exact string + written reason; no file is exempt (`DownloadPanel.tsx` is scanned; its 3 strings are allowed individually); stale entries fail the suite.
4. **Scope.** Frontend (`components/`, `lib/`, `src/app/` minus `src/app/api`, `next.config.ts`): any hit fails. Backend-owned code (`src/server`, `src/app/api`) is scanned as a **ratchet**: today's 4 hits (`Identity verification required to publish…` API error text, two `"video"` mime labels, an audit action name `DOWNLOAD`) are listed as `BACKEND_BASELINE` and only reported; a NEW forbidden string there fails the suite, so Backend is never forced to edit but cannot add a promise unnoticed. `src/server/auth/common-passwords-data.ts` (word list) is the only skipped file.
5. **Self-test.** `tests/copy-guard-mutation.test.ts` injects 35 bad edits into in-memory copies of the real sources (QA's M1–M18 plus entities, zero-width, spacing, concatenation, join, template literals, attributes, synonyms, case) and requires every one to be caught; QA's `qa/scripts/qa-fe5-guard-mutation.sh` (on disk, scratch copy) runs against the same guard.
6. **Runtime.** e2e `[copy-sweep]` re-checks rendered HTML (landing + FAQ, auth, legal, buyer, `/pay/mock`, seller dashboard pages), meta/aria attributes and API-returned strings (checkout / login errors, public drop JSON, settings, earnings).

## Copy guard 2 (`frontend/copy-guard-2`, QA report `qa/results-frontend-copy-accuracy.md`: FE-20, FE-21, FE-22, FE-18b)
Facts checked first: nothing in `src/` writes `sellers.verification_status` (only `scripts/set-verification.ts` / `npm run verify-seller`, or SQL); `/contact` is a `ComingSoon` placeholder; publishing (and checkout of a published link) **is** enforced against `verified`; MP4 still answers 415 (`VIDEO_UPLOAD=false`).

| ID | Where | Before | After |
|---|---|---|---|
| FE-20 | `FileDropzone` hint + `accept`; `NewDropFlow` note; validation message (new-drop, drop-detail add-files via `DropEditor` -> same `FileDropzone`) | hint "JPG, PNG, WebP or MP4 · N files · X per drop"; `accept` always listed `video/mp4` and `.mp4`; note "MP4 video up to 500 MB is coming soon."; picked MP4 -> "MP4 video uploads are coming soon…" | flag off: "JPG, PNG or WebP · up to 10 files · 2 GB per drop" (real limits from `/api/settings`), `accept` = images only, a single "Video upload is coming soon." note, picked MP4 -> "Video upload is coming soon — for now, add JPG, PNG or WebP images." Flag on: hint "JPG, PNG, WebP or MP4 …", `accept` adds `video/mp4,.mp4`, note "MP4 video up to X each." All driven by `acceptAttr` / `dropzoneHint` / `videoNote` in `lib/upload-limits.ts` (`DEFAULT_LIMITS.videoUploadEnabled = VIDEO_UPLOAD`). Other places checked (FAQ, Hero, meta, how-it-works, mock card) already follow `SELLABLE` / `VIDEO_UPLOAD` |
| FE-21 | `VERIFICATION_META` (`components/dashboard/types.ts`) used by the dashboard banner, drop detail ("Publishing is off"), publish dialog, new-drop notice | pending "…Publishing requires a verified account status"; failed "…Contact support to continue"; manual_review "In review — A person is reviewing…"; flagged drop "…while our team reviews it" | pending: "You can create drafts and upload files now. Publishing stays off until your account is verified, and verification isn’t self-serve yet. We’ll share next steps here when they’re available." failed (label "Not completed"): "Verification wasn’t completed. You can keep drafting drops; publishing stays off until your account is verified. We’ll share next steps here when they’re available." manual_review (label "Marked for review"): "Your verification is marked for review. You can keep drafting drops; publishing stays off until it’s cleared." verified: "Your account is verified. You can publish drops." flagged drop: "This drop is paused and under review. It can’t be edited or published for now." One source of truth, no per-component wording. No e-mail text exists for these states in frontend scope (the reset mail is backend) |
| FE-22 | signup subtitle; landing CTAs; How it works | "Set up in a minute. Start sharing paid links today."; "Start selling" (Hero, header, SellerCta); "…shareable payment link in seconds." | "Create your account and start drafting drops. Publishing opens once your account is verified."; "Create your account"; "…get a shareable payment link." Login / forgot / reset subtitles describe real features and are unchanged |

**Copy guard 2 – how it works (FE-18b; replaces points 1–5 of the FE-18 description above).** Entry test is still `tests/copy-guard.test.ts` (QA runs only that file on a scratch copy of `tests components lib src public … next.config.ts`).
1. **Extraction.** TS/TSX/JS/MJS via the TypeScript compiler: JSX text, string/template literals, attributes, metadata. Adjacent JSX text/element children are joined into runs (`In<b>stant</b>ly`, `straight <b>away</b>`, `<span>Insta</span><span>ntly</span>`). Statically resolvable string building is constant-folded (`+`, templates with literal holes, `.concat`, `String.fromCharCode`, `atob`, `split().reverse().join()`, `[…].map(x => x).join("")`, IIFEs, `const` strings). Obfuscation that cannot be folded (`fromCharCode(dynamic)`, `atob(dynamic)`, `.reverse()` on a string chain, `[…text…].join("")` / `.map(…).join("")` on unknown data) is a `dynamic-string` **violation** unless allowlisted exactly. CSS (quoted strings, `content:`), SVG/HTML (text, `title`/`aria-label`/`alt`/`content`), JSON/webmanifest (every string value), `*.mjs`, markdown/text, `next.config.ts` are scanned too (`public/` currently only holds PNGs; the walker would pick up anything added). Big newline lists (the password blocklist) are split per line.
2. **Normalisation to an ASCII skeleton.** Entities, NFKC (full-width), accents stripped, zero-width removed, Cyrillic/Greek look-alikes folded, contractions expanded, case folded, a leet form (`1nstant`, `d0wnload`) and a letters-only form (`in stant`, `down-load`).
3. **Semantic rule groups (~30).** Delivery/receipt/e-mail promises ("we’ll send you the link", "your files are ready", straightaway, in seconds, as soon as you pay, delivered to your inbox, check your email for, sent to your email, emailed, receipt, instant(ly), immediately, right away, automatically + deliver/send/sent/unlock, unlocks after payment/purchase …); money/payout promises (paid out, payouts straight/direct, weekly/daily/every-Friday payouts, bank transfer, withdraw instantly, same-day, guaranteed); trust/processing claims (trusted payment provider, bank-level, PCI compliant, certified, payments partner, end-to-end encrypted …); flag-tied capability claims (**any** mp4/video/clips wording while `VIDEO_UPLOAD=false` – the flag is read from `lib/features.ts` at test time; "contact support" while `/contact` is a placeholder; "a person is reviewing" / "our team will review"); basic Spanish / French / German equivalents (instantáneo, inmediatamente, recibo, instantané, reçu, sofort, Quittung, descarga/téléchargement …). Patterns are word-order, plural/tense and contraction tolerant.
4. **No file-level exemptions.** `SKIP_FILES` is gone. `common-passwords-data.ts` is scanned line by line; its 12 matching words (`clips`, `download`, `film(s)`, `instant`, `movie(s)`, `streaming`, `telechargement`, `unlock`, `video`, …) are exact `BACKEND_BASELINE` entries (backend-owned, reported, not edited).
5. **Allowlist = exact file + exact string + max count + written reason.** A second occurrence of an allowed string (e.g. another "Download" button) is a violation; stale entries (no longer matching, or fewer times than `count`) fail.
6. **Flag/backend consistency tests.** `VIDEO_UPLOAD = true` fails unless the backend has real `video/mp4` handling; `PAYOUT_HOLD_DAYS` / `MIN_PAYOUT_USD` are pinned to the platform defaults (7 days / $25, also checked against `db/migrations/006_payments.sql` when present).
7. **Self-test.** `tests/copy-guard-mutation.test.ts` = QA round 5 (18) + our evasions (17) + 30 FE-18b cases + QA round 6 ported verbatim as data (`tests/helpers/qa-mutations.ts`, 48 incl. 3 correct should-pass). Every must-catch is asserted; comments / JSX comments / type-only literals must stay green; the guard must be clean on the current code.
8. **Runtime.** e2e `[copy-sweep]` now also bans mp4/video wording while `VIDEO_UPLOAD=false`, and a second check covers the dropzone text + `accept` (new-drop and drop detail, against `/api/settings`), the verification messages for sellers seeded as pending / failed / manual_review (+ verified: no banner) on dashboard, drop detail and new-drop, and the signup/landing copy.

**Known limits (stated honestly – a static guard cannot do these).**
- A comment-only change (QA M18, `// x` in `next.config.ts`) is not user-facing; it can’t and shouldn’t be caught.
- Over-promises with no recognisable keyword (QA FE-22's "Start sharing paid links today.") can’t be found by phrase rules; that class is covered by review plus the e2e/unit assertions that pin the accurate sentence, not by the guard. The guard blocks the *delivery / money / trust / flag / support / review* families.
- Strings that only exist at run time (API/DB/i18n loaded dynamically), values built from non-constant data (we fail closed only for the string-gluing shapes above), phrasings and languages without a rule, text inside images/icons, promises made only by layout – not detectable statically. The e2e sweep covers rendered pages and API-returned strings to narrow the gap.
- Backend-owned strings (`src/server`, `src/app/api`, e.g. "Identity verification required to publish (status: …)", `"video"` mime labels, the `DOWNLOAD` audit action, the password blocklist) are baselined and reported, not edited.
- `PAYOUT_HOLD_DAYS` is a constant mirroring a DB default; if an operator changes `platform_settings`, the static FAQ text ("7-day hold") is stale by design – dashboard hints use the live `GET /api/earnings` values.

## Screenshots
`screenshots/dashboard/<name>-mobile-390x844.png` (2× DPR) and `<name>-desktop-1280x800.png`, full-page, produced by `scripts/screenshots-dashboard.mjs` (list in `screenshots/dashboard/INDEX.md`; horizontal-overflow audit at 360/390/1280 in `overflow-report.json` — all 0px).
Notes: the signup 429 screenshot uses a mocked 429 response (same shape as the real `SIGNUP_IP` limiter: `429`, `Retry-After`, `{code:"rate_limited"}`); the sign-in lockout shots use the **real** progressive login delay.

Retaken for the QA follow-up: `dashboard-overview`, `drop-unpublish-confirm`, `drop-publish-attestation-dialog`; new: `signup-429-long-wait`, `buyer-429-long-wait`, `placeholder-terms`, `placeholder-privacy`. `seed-demo` now also inserts one refunded and one charged-back sale for maya.

Round-2 screenshot changes: `dashboard-overview` (ledger-backed: available / pending / in payout / paid out, partial refund + chargeback + chargeback fee), new `dashboard-overview-negative-balance`, `buyer-ready-to-buy` / `buyer-hosted-checkout` (real checkout flow), and every auth / buyer / dashboard page now shows the Terms · Privacy · DMCA · Contact footer. The remaining pages (landing, `/design`) are unchanged.

Round-3 screenshot changes: all `buyer-*` (copy), `dashboard-overview`, `dashboard-overview-negative-balance` (red alert, new wording), `drop-list*` and `drop-detail-published` (refund-aware revenue).

Copy-sweep screenshots: landing (+ new `landing-faq-expanded`), `design`, all auth pages, `buyer-*`, `dashboard-overview*`, `drop-list*`, `drop-detail-*` (new copy / labels).

Copy-accuracy screenshots: landing (+ `landing-faq-expanded`, includes the seller CTA), `buyer-*`, `dashboard-overview*`, auth pages (AuthShell text).

Copy-guard-2 screenshots: `new-drop` (dropzone: images only, single video note), `drop-detail-draft`, `dashboard-verification-pending|failed|manual-review` (new banners), `signup` (new subtitle), landing (CTA label).
