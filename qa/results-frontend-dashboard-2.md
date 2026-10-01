# Unveil QA results — `frontend/dashboard` (PR #1), run 2 (fix verification)

- **Date:** 2026-10-01 10:59–11:35 ET
- **Branch / SHA tested:** `origin/frontend/dashboard` @ **`f3d9eb1f58579ce3a494f5d82b310963ed37b237`** (on top of `faa38d4`, PR https://github.com/unveil-link/Unveil.link/pull/1; `origin/main` still `94af2c0`). Commits since round 1: `d002f42` (FE-01), `8ae2a3d` (FE-02), `b48626e` (FE-03/04 + placeholder pages), `0279753` (FE-05), `70925ac` (FE-06), `f3d9eb1` (docs/tests/screenshots). Verified in a clean detached worktree (`/workspace/fe2`, now removed).
- **Env:** Node 20.19.2, PostgreSQL 17, headless Google Chrome 154 (playwright-core, `--no-sandbox`). Throwaway DB `unveil_qa_fe2` (e2e DB `unveil_e2e_qa_fe2`, divergence-check DB `unveil_qa_fe2_x` = main migrations 001–004 **plus payments/abstraction migrations 005–007**), storage/mail under `/workspace/qa-run6`, fresh secrets. Servers: :3230 (prod build, default rate limits), :3232 (limits off), :3233 (`ENABLE_DESIGN_PAGE=1`), :3234 (fake Google creds), :3235 (payments-schema DB), e2e on :3231. **Ports 3100/3120/3300/3400 and 3500+ and every `unveil_qa_pay*` DB were not touched.** All my servers are stopped and my 3 DBs dropped.
- **Rules followed:** no app source modified; nothing pushed to `main` or `frontend/dashboard`; only `qa/test-plan`.

## Verdict
**FE-01..FE-06 are all FIXED and verified** with the original repros. **No FAIL left on this branch; 0 regressions.** M4-09 flips **FAIL → PASS**. The new placeholder pages work, but M5-16 correctly **stays BLOCKED-ON-LEGAL** (placeholders are not legal copy; `/2257` still 404). I found **5 new findings**, none blocking for this branch: **FE-07 (Medium, integration)** — `data.ts` re-implements the earnings rules and diverges from `payments/abstraction` (will show wrong money once both are merged), plus 4 Low (FE-08..FE-11).

| Fix | Verdict | One-line evidence |
|---|---|---|
| **FE-01** earnings breakdown (M4-09) | **FIXED ✔** | Maya: Gross $506.00 / Platform fee $43.10 / Processing $21.56 / Net $366.34 / Available $156.34 / Pending $60.00 / Paid out $150.00 = independent DB recompute to the cent; reconciliation line + separate “$50.00 refunded · $25.00 charged back”; “Your 90%” gone; 69 assertions OK over 5 seller scenarios (zero, 400+ odd-cent sales, negative, isolation). Caveat → FE-07/FE-08 |
| **FE-02** modal focus return | **FIXED ✔** | 52/52 checks: Esc, X, Keep published, backdrop, Enter on Keep, mouse + keyboard open, desktop + 390 px, Publish dialog (Esc/Cancel) → focus back on the **same** trigger button; Tab/Shift+Tab ×24 never leaves the dialog |
| **FE-03** buyer title | **FIXED ✔** | `<title>Spring collection pack · Unveil</title>` (1 title tag, no double Unveil); unavailable/draft/unpublished/bogus → `Link unavailable · Unveil`; XSS-y titles escaped. (OG/Twitter tags remain the generic site-wide ones — informational) |
| **FE-04** Verified badge | **FIXED ✔** | `pending`, `failed`, `manual_review` → page renders, **no** badge; `verified` → badge; restored |
| **FE-05** long 429 waits | **FIXED ✔** (login/signup/forgot/reset/checkout) | 22 boundaries × 4 auth forms + checkout via the real UI: 59 s→“59s”, 60→“60s”, 121→“3 min”, 3480→“58 min”, 3599/3600→“1 h”, 3661→“1 h 2 min”, 4320→“1 h 12 min”, 86400→“24 h”; real forgot-password limiter 429 `Retry-After: 3596` → “Try again in 1 h”. Dashboard upload 429 still raw seconds → FE-11 (Low) |
| **FE-06** `/design` | **FIXED ✔** | prod build without flag → **404** (:3230, :3232); `ENABLE_DESIGN_PAGE=1` (verified in `/proc/<pid>/environ`) → **200**, `<title>Design system · Unveil</title>` |
| New placeholders | **OK ✔ / M5-16 stays BLOCKED-ON-LEGAL** | `/terms /privacy /dmca /contact` 200, `<meta robots noindex, nofollow>`, only “Coming soon.” text, security headers present, linked from landing footer, buyer-page terms checkbox, signup; `/2257` 404. Gaps: FE-09, FE-10 |

## Counts (106 plan rows)
| Milestone | PASS | FAIL | BLOCKED | NOT RUN | Total |
|---|---|---|---|---|---|
| M1 | 10 | 0 | 4 | 0 | 14 |
| M2 | 13 | 0 | 6 | 0 | 19 |
| M3 | 1 | 0 | 19 | 0 | 20 |
| M4 | 3 | 0 | 15 | 0 | 18 |
| M5 | 1 | 0 | 19 | 0 | 20 |
| M6 | 2 | 0 | 6 | 2 | 10 |
| S2 | 1 | 0 | 4 | 0 | 5 |
| **Total** | **31** | **0** | **73** (incl. M5-16 BLOCKED-ON-LEGAL) | **2** | **106** |

vs round 1 (`results-frontend-dashboard-1.md`: 30 PASS / 1 FAIL / 73 BLOCKED / 2 NOT RUN): **PASS 30 → 31, FAIL 1 → 0, BLOCKED 73 → 73 (72 + M5-16 BLOCKED-ON-LEGAL), NOT RUN 2 → 2** (M6-01 OWASP review and M6-03 load test).

### Cases whose rating changed vs round 1
| Case | Round 1 | Now |
|---|---|---|
| M4-09 | **FAIL** | **PASS** |

All other re-rated round-1 cases (M1-02, M1-05, M2-11, M2-18, M2-19, M3-18, M4-18, M5-20, M6-07) were **re-run and stay PASS** (remark “Round 2” appended in the case table); M5-16 stays **BLOCKED-ON-LEGAL**.

## Suite results on `frontend/dashboard` @ f3d9eb1
| Check | Result |
|---|---|
| `npm ci` / `npm run migrate` | OK / applied 001–004 (no new migration) |
| `npm run lint` | **clean** (`qa/evidence-fe2-suite/lint.log`) |
| `npm run build` | **OK** — `/terms /privacy /dmca /contact` prerendered static (○), `/design` dynamic (ƒ) |
| `npx tsc --noEmit` | **clean** |
| `npm test` | **61/61 passed** (8 files: 50 + 11 new in `tests/frontend-earnings.test.ts`) |
| `npm run e2e` | **47/47 on the first run** (no [#13] flake this time; the new check “[FE-03/04/06 + placeholders]” passes) — `E2E_DATABASE_URL=…/unveil_e2e_qa_fe2`, `E2E_PORT=3231`; `proof/db.txt` reverted |
| Backend untouched | `git diff --name-only origin/main f3d9eb1 -- src/server src/app/api db next.config.ts package.json package-lock.json` → **0 files** |
| Regression probes (`qa-backend-1/1b/1c/1d`, `qa-fixes-1`, `PUB=/u`, limits-off app) | **identical to round 1** after normalising ids/timestamps/file sizes; the only diff is intended: `/terms /privacy /dmca` now 200 (were 404) in the `qa-backend-1b` route probe (`/2257` still 404) |
| CSP violations in headless Chrome | **0** across ≈70 page loads |
| Console errors | only the localhost `ERR_SSL_PROTOCOL_ERROR` (CSP `upgrade-insecure-requests` on http, env only) plus deliberate 4xx/5xx probes; **the `/terms` `/privacy` `_rsc` 404s from round 1 are gone** |

## Per-fix evidence

### FE-01 — earnings breakdown (M4-09) — FIXED
Seed (`seed-demo.ts`) now adds a $50 refund + $25 chargeback for Maya. Dashboard (`dashboard-maya-desktop-final.png`):

| Card | UI | Independent DB recompute | Hint text |
|---|---|---|---|
| Gross sales | **$506.00** | succeeded $431.00 + refunded $50.00 + charged_back $25.00 = 50,600¢ | “30 sales · 2 reversed” |
| Platform fee | **$43.10** | SUM(platform_fee_cents) over `succeeded` (reversed rows contribute 0) = 4,310¢ | “10% of completed sales” |
| Processing fees | **$21.56** | 2,156¢ | “5% of completed sales · card processor” |
| Your earnings (net) | **$366.34** | = SUM(seller_net_cents) of succeeded = 36,634¢ | “85% of completed sales, after fees” |
| Available | **$156.34** | 36,634 − 15,000 paid − 6,000 pending | “Net earnings not yet in a payout” |
| Pending payouts | **$60.00** | payouts `pending` 6,000¢ | “Requested, not yet paid” |
| Paid out | **$150.00** | payouts `paid` 15,000¢ | “Sent to you so far” |

Reconciliation line: “$506.00 gross − $43.10 platform fee − $21.56 processing fees − $50.00 refunded − $25.00 charged back = $366.34” (506.00 − 43.10 − 21.56 − 50.00 − 25.00 = 366.34 ✓). Separate line: “Reversed sales: $50.00 refunded · $25.00 charged back. Fees on reversed sales are returned, so they are not counted above.” → refunds and chargebacks shown separately, subtracted **once** (from gross; the reversed sales’ fee shares are 0, not subtracted again). “Your 90%” does not appear anywhere. Check `gross == net + platform + processing + refunded + charged back` passes for every scenario.

Scenarios (`qa/scripts/qa-fe2-earnings.mjs`, `qa/evidence-fe2-earnings.log`, each UI value compared with a fresh SQL recompute):
- **A Maya (seed):** all OK.
- **B zero sales:** all cards $0.00, “0 sales”, no reversals line, no NaN / “null%”.
- **C many sales (400+ odd-cent sales incl. a $1.23M sale, refund/chargeback rows, a failed payout):** Gross **$1,257,801.65**, fees $125,777.36 / $36,571.27, Net $1,095,431.91 — thousands separators fine, odd-cent amounts exact, reconciliation arithmetic exact to the cent (no rounding drift), failed payout ignored.
- **D negative balance (payout $90.00 > net $86.80):** all breakdown cards correct; **Available shows $0.00 while ledger truth is −$3.20** → FE-08.
- **E multi-seller isolation:** two sellers with $111.11 / $222.22 see only their own figures; no cross-seller text.
- **Percent hints:** computed from kept gross (platform 10 %, processing 5 %, keep 85 %), 1 decimal; on mixed data they read e.g. “7.1% / 2.6% / 90.2%” (see divergence run) — consistent with the cards, not misleading.

#### Divergence from `payments/abstraction` earnings logic (source read at `origin/payments/abstraction`: `src/server/payments/earnings.ts`, `ledger.ts`, migrations 005–007; checked live on a DB migrated with 001–007, `qa/scripts/qa-fe2-divergence.mjs`, `qa/evidence-fe2-divergence.log`, `dashboard-divergence-payments-schema.png`)
`data.ts` matches payments’ `lifetime` semantics **for the data that exists on this branch’s schema** (fees net of the fee shares returned on reversals; refunded / charged-back gross kept apart; net = gross − refunded − chargebacks − fees; `paid` = payouts `paid`). It diverges where payments adds new schema/rules:

| # | Payments/abstraction | `data.ts` on f3d9eb1 | Observed (seller with 6 ledger sales, 1 partial refund $40 of $100, 1 full refund, 1 chargeback + $15 chargeback fee, a pending + a failed tx, 1 sale in the 7-day hold, payouts paid $10 / requested $30 / approved $20 / failed $5) |
|---|---|---|---|
| 1 | open payouts = `status IN ('requested','approved')` | `IN ('pending','processing')` | UI “Pending payouts **$0.00**, None in progress” vs **$50.00** open → Available overstated by $50 |
| 2 | gross = ledger `sale_credit` (only succeeded/settled sales) | `SUM(amount_cents)` over **all** tx statuses | UI Gross **$285.00** vs **$225.00** (pending + failed checkouts $30 + $30 counted as gross; “4 sales · **4 reversed**” counts pending/failed as reversed) |
| 3 | partial refunds via `transactions.reversed_cents`; tx stays `succeeded` | no `reversed_cents` handling | $40 partial refund ignored: refunded UI **$50.00** vs **$90.00**, fees on the partially refunded sale still counted in full |
| 4 | `chargeback_fee` ledger entries reduce balance | not modelled | $15.00 chargeback fee missing from Available |
| 5 | hold period: `pending` = entries with `available_at` in the future (default 7 days), `available` excludes them | no hold concept (“Pending payouts” means requested-not-paid) | Available UI **$179.45** vs ledger **$11.32**; pending(hold) $8.41 not shown |
| 6 | available may be negative (“deducted from future earnings”) | `Math.max(0, available)` | debt hidden → FE-08 |

None of these is visible on f3d9eb1 alone (the base schema has none of those columns/statuses), but they make the dashboard show **wrong money** the moment `payments/abstraction` is merged (rows 1–2 need no new data at all: any requested payout or pending checkout is misreported). Recommendation: after payments merges, replace `getEarnings` by the payments `getEarningsSummary` / `GET /api/earnings` (single source of truth) — or fix rows 1–6. Owner: **Frontend** (with Payments for the contract).

### FE-02 — modal focus return — FIXED
`qa/scripts/qa-fe2-modal.mjs`, `qa/evidence-fe2-modal.log` (52 OK / 0 FAIL, desktop 1280×900 and mobile 390×844). Unpublish confirm dialog opened by **mouse click** and by **keyboard (focus trigger + Enter)**, closed by **Escape, “Keep published”, X (Close dialog), backdrop click, Enter on Keep published** → each time the dialog is closed and `document.activeElement` is the very same trigger button (marked with an attribute to prove identity). Initial focus lands inside the dialog (Close button). Focus trap: 12 × Tab + 12 × Shift+Tab never reach a focusable element outside the dialog (native `<dialog>.showModal()`: the wrap goes through the browser chrome, document stays inert); dialog is `:modal`, `aria-labelledby` + `aria-describedby` present. Publish dialog: Esc and Cancel/X return focus to the Publish trigger. Screens: `modal-desktop.png`, `modal-mobile.png`.

### FE-03 — buyer page title — FIXED
`qa/evidence-fe2-meta.log`. Published: `<title>Spring collection pack · Unveil</title>` (exactly one title tag). Draft / unpublished / non-existent: `<title>Link unavailable · Unveil</title>`. Title `<script>alert(1)</script> & "q" 's'` → `&lt;script&gt;…&amp;…&quot;…&#x27;` and `</title><img src=x onerror=alert(1)>` → fully escaped (no tag injection); 120-char title not truncated. Informational: a drop literally named “Unveil” gives “Unveil · Unveil” (by design). `og:title` / `twitter:title` / `og:description` on `/u/<id>` stay the generic site-wide strings (“Unveil — Sell your files with a simple payment link”); no double “Unveil”. Not a bug (page is noindex; avoids leaking a title to link-preview crawlers) but note for Product if link previews should show the drop.

### FE-04 — Verified badge — FIXED
`qa/evidence-fe2-meta.log`: with the drop still published and the page rendering (200), seller `verification_status` = `pending`, `failed`, `manual_review` → **no** “Verified creator” badge; `verified` → badge shown; restored to `verified` → badge back. (Enum is exactly these 4 values; “rejected” is invalid.) Backend still doesn’t unpublish on status change (not part of FE-04).

### FE-05 — long 429 waits — FIXED
`qa/scripts/qa-fe2-duration.mjs` (`Retry-After` mocked through the real UI on `/login`, `/forgot-password`, `/signup`, `/reset-password?token=…`, and the buyer checkout), `qa/evidence-fe2-duration.log` (93 OK / 0 FAIL). Button label and countdown card agree on every surface:

| Retry-After | Button / card | Screen-reader text |
|---|---|---|
| 1, 45, 59, 60, 61, 120 s | “1s”, “45s”, “59s”, “60s”, “61s”, “120s” | “59 seconds” |
| 121 s | “3 min” (rounds up; a wait is never understated) | “3 minutes” |
| 300 s / 3480 s / 3481 s / 3540 s | “5 min” / **“58 min”** / “59 min” / “59 min” | “58 minutes” |
| 3599 s / 3600 s | “1 h” / “1 h” | “1 hour” |
| 3601 s / 3661 s / 4320 s | “1 h 1 min” / “1 h 2 min” / **“1 h 12 min”** | “1 hour 12 minutes” |
| 7200 s / 86399 s / 86400 s / 86401 s / 172800 s / 999999 s | “2 h” / “24 h” / “24 h” / “24 h 1 min” / “48 h” / “277 h 47 min” | “2 hours”, “24 hours” |

Real limiter (no mocking), `qa/evidence-fe2-real429.log`: 5th forgot-password request from one IP → `429 Retry-After: 3596` → button “Try again in 1 h”, card “1 h”, SR “You can try again in 1 hour.” (`forgot-429-real-58min.png`, `login-429-58min.png`, `buyer-429-1h12.png`). Real progressive login delay (`qa-fe2-d.mjs`, default limits): Retry-After 1,2,4,8,16 matches the card each time (ticks 16s,15s,14s), button re-enables when the countdown ends, correct password afterwards → 200 `/dashboard`. Remaining raw-seconds spots → FE-11.

### FE-06 — `/design` in production — FIXED
Production builds (`next start`, `NODE_ENV=production`): without the flag `/design` → **404** (`<title>404: This page could not be found.`) on :3230 and :3232; instance started with `ENABLE_DESIGN_PAGE=1` (confirmed in `/proc/<pid>/environ`, same build, no rebuild — read at request time) → **200**, `Design system · Unveil`, noindex. The e2e check covers both. `.env.example` documents the flag.

### New placeholder pages `/terms /privacy /dmca /contact` and M5-16
| Check | Result |
|---|---|
| Status | 200 on all four; `/2257` → **404** (unchanged) |
| noindex | `<meta name="robots" content="noindex, nofollow"/>` ✔; **no `X-Robots-Tag` response header** (requested “header+meta”) → FE-09 (Low) |
| Content | visible text = “{Terms|Privacy|DMCA|Contact}”, “Coming soon.”, “Back to Unveil”, standard footer (tagline + 4 links + “© 2026 Unveil · unveil.link. All rights reserved.”). **No legal claims** (0 hits for warrant/liab/agree/jurisdiction/governed/hereby/designated agent/2257/compliance…), **no adult-market signalling** (0 hits for adult/porn/nsfw/explicit/sex*/18+/mature/…), nothing reflected from the URL (`?x=<script>` → 0 echoes) |
| Titles | “Terms · Unveil”, “Privacy · Unveil”, “DMCA · Unveil”, “Contact · Unveil” |
| Security headers | CSP, HSTS, XFO DENY, XCTO, Referrer-Policy, Permissions-Policy on all four (and on `/2257` 404) |
| Mobile | 390×844 and 360×800: no horizontal scroll (`placeholder-*-390.png`) |
| Links | Landing footer: Terms/Privacy/DMCA/Contact → each opens its placeholder (clicked through at 390 and 360 px); buyer page: the terms-checkbox “Terms” link → `/terms`; signup: “Terms” → `/terms`, “Privacy Policy” → `/privacy`. Missing elsewhere → FE-10 (Low) |
| `robots.txt` | unchanged (`Disallow: /u/ /d/ /api/ /dashboard`); placeholders not disallowed (correct, otherwise crawlers couldn’t see the noindex) |

**M5-16 stays BLOCKED-ON-LEGAL.** The placeholders only remove the 404s; there is still no Terms of Service, Privacy Policy, DMCA agent/takedown procedure, contact channel or §2257 statement. Remove the placeholders’ `noindex` only together with the real copy.

## Regression (all re-run on f3d9eb1, `evidence-fe2-suite/`)
| Area | Result |
|---|---|
| M1-02 | PASS (presence-only; fake creds on :3234) |
| M1-05 | PASS (progress bars, validation) |
| M2-11 | PASS (unpublish/republish, branded unavailable page) |
| M2-18 | PASS (390×844 + 360×800; incl. placeholders and new overview cards) |
| M2-19 | PASS (4G 0.32–0.42 s Buy visible, load ≤ 1.09 s; slow-4G ≤ 1.72 s) |
| M3-18 | PASS (final-sale text before Buy) |
| M4-18 | PASS (≈18 s signup → live) |
| M5-20 | PASS (neutral branding; placeholders clean; only the mandated attestation wording) |
| M6-07 | PASS (installability errors `[]`) |
| Auth validation (signup/signin/forgot/reset) | PASS (per-field errors, rules, `email_taken`, no enumeration, reset single-use, sign-out kills cookie) — `probe-fe1-c/signup/misc.log`. (The round-1 reset-step of `qa-fe1-d` hit a script selector issue again, covered by `qa-fe1-misc`) |
| 429 countdown vs real delay | PASS (1,2,4,8,16 s; see FE-05) |
| XSS (display name, title, description) | PASS — also in the new elements: `<title>` escaped, dashboard cards contain no user input, placeholders reflect nothing; `window.__x` undefined, 0 dialogs |
| Originals not exposed | PASS (only `/api/files/<id>/preview`; no `/original`/signed URL in HTML or network on buyer page + dashboard) |
| noindex on `/u/<id>` | PASS (`X-Robots-Tag: noindex, nofollow` + meta, also on unavailable pages) |
| Headers / CSP / console | PASS (0 CSP violations; see table above) |
| a11y basics | PASS (labels, alt, one `h1`, landmarks, skip link, focus outline, keyboard-only purchase flow; contrast spot-checks as round 1) |
| AuthZ | PASS (logged-out `/dashboard*` → 307 `/login`, no leak; other seller → “couldn’t find that drop”; API 404) |

## New bugs / findings
Severity: Medium = fix before release, Low = polish/hardening. IDs continue the Frontend numbering.

| ID | Sev | Area | Finding | Exact repro |
|---|---|---|---|---|
| **FE-07** | **Medium** (integration; invisible until payments merges) | `src/app/dashboard/data.ts` vs `payments/abstraction` earnings | Earnings SQL is a re-implementation that diverges from payments’ ledger rules: open payouts counted as `pending/processing` (payments uses `requested/approved`) → “Pending payouts $0.00 / None in progress” while $50 is requested; gross sums `amount_cents` over **all** statuses incl. `pending`/`failed` checkouts (overstated; counted as “reversed”); partial refunds (`reversed_cents`), chargeback fees and the 7-day hold are ignored → Available $179.45 vs ledger $11.32 | DB migrated with `main` 001–004 + `payments/abstraction` 005–007, seller with a `requested` payout and a `pending` tx → `/dashboard` (script `qa/scripts/qa-fe2-divergence.mjs`, `BASE=… DB=…`; screenshot `dashboard-divergence-payments-schema.png`). Fix: use payments’ `getEarningsSummary` (`GET /api/earnings`) once merged |
| **FE-08** | Low (Medium once payouts exist) | Negative balance | `Math.max(0, availableCents)` hides a negative balance (refund/chargeback after payout): UI “Available $0.00”, true ledger −$3.20 (payments: “deducted from future earnings”). Seller isn’t told they owe | Seller with sale net $86.80 and a `paid` payout $90.00 (or sale, payout, then refund) → `/dashboard` → Available shows $0.00 (`evidence-fe2-earnings.log` scenario D, 1 deliberate FAIL) |
| **FE-09** | Low | Placeholders noindex | `/terms /privacy /dmca /contact` are noindex only via `<meta robots>`; no `X-Robots-Tag` header (the plan/spec asked header + meta; `/u/*` etc. have both) | `curl -sI http://localhost:3230/terms \| grep -i x-robots` → empty. Fix: add `{ source: "/(terms\|privacy\|dmca\|contact)", headers: noindex }` in `next.config.ts` (Backend owns that file) |
| **FE-10** | Low | Legal links coverage | Footer with the 4 legal links exists only on landing + placeholder pages. Buyer page (where DMCA/contact matter most) links only `Terms` (checkbox) and has no Privacy / DMCA / Contact; `/u/<unavailable>`, `/login`, `/forgot-password`, `/reset-password`, `/dashboard*` have no legal links at all (signup has Terms + Privacy) | `curl -s localhost:3230/u/<id> \| grep -o 'href="/\(terms\|privacy\|dmca\|contact\)"' \| sort -u` → only `/terms`; same on `/login` → none (`evidence-fe2-pwa-placeholders.log` “[links]” lines). Decide with Legal which pages need them |
| **FE-11** | Low (UX, FE-05 scope gap) | Dashboard upload 429 | Duration formatting was applied to auth + checkout only; the new-drop / add-files 429 still prints raw seconds: “Too many requests. Please try again in **3500 seconds**.” (and `lib/upload.ts`: “try again in 3500s”) | Mock/trigger `429 Retry-After: 3500` on `POST /api/drops` from `/dashboard/drops/new` (`qa/scripts/qa-fe2-upload429.mjs`, `evidence-fe2-upload429.log`) |

Informational (not bugs): `ERR_SSL_PROTOCOL_ERROR` console lines on plain-http production builds come from CSP `upgrade-insecure-requests` (env only); “3481 s” → “59 min” (rounded up by design); 121 s → “3 min”; `og:*`/`twitter:*` on `/u/<id>` are site-wide; BUG-21 ([#13] e2e flake) did **not** reproduce this run (47/47 first try) but remains open as a known flake.

## Still-open items from earlier runs
| ID | Status |
|---|---|
| BUG-07 legal pages | **partly mitigated** (placeholders, no 404) → M5-16 **BLOCKED-ON-LEGAL** (real copy + `/2257` outstanding) |
| BUG-11b / BUG-13 / BUG-18 / BUG-19 / BUG-20 | open, unchanged (backend/deploy; not touched by this branch) |
| BUG-21 e2e [#13] flake | open (Backend test), did not trigger in this run |
| FE-01..FE-06 | **closed** (this run) |

## Remaining BLOCKED — on whom
| Blocked cases | On |
|---|---|
| M2-10 edit price/description, M2-13 delete drop | **Backend** (`PATCH`/`DELETE /api/drops/:id`, file delete) then **Frontend** controls |
| M2-14 download page, M2-12/15/16 | **Backend/Payments** (orders, signed buyer URLs, zip) then Frontend |
| M3-01 real Buy / card form, M3-02…M3-17, M3-19/20 | **Payments** (Frontend must re-point Buy at the hosted-page contract; switch the dashboard to payments’ earnings source = FE-07) |
| M4-10 views & conversion | **Backend** (view counter) |
| M4-11 transaction history | **Backend** (transactions API + country) then **Frontend** |
| M4-17 profile edit | **Backend** (`PATCH /api/auth/me`) + **Frontend** |
| M4-01…08, 12…16 KYC / payouts / disputes | **Backend** + KYC/payout provider |
| M5-01…15, 17…19 | **Backend** (moderation/admin/reports/audit); M5-19 cookie banner **Frontend** |
| **M5-16 legal pages** | **Legal** (BLOCKED-ON-LEGAL: Terms, Privacy, DMCA agent + takedown process, contact, §2257 statement) → then Frontend swaps placeholders |
| M6-06 status banner | **Backend/Ops** + **Frontend** |
| M6-04/05/08/09/10 | **Ops/Backend** |
| M1-02 full OAuth, M2-18/M6-07 real devices | **Juice / coordinator** (Google credentials, physical iOS + Android) |
| M1-06/09/11 video, resumable upload | **Backend** |
| M6-01 OWASP review, M6-03 load test | QA, once checkout/download exist |

## Case-by-case results
Rows re-rated or re-verified in this run carry a “**Round 2 (f3d9eb1):**” remark; all other rows carry over unchanged from round 1.

| Case | Result | Evidence / notes |
|---|---|---|
| M1-01 | **PASS** | signup 201 `verification_status:pending`, cookie `HttpOnly; Secure; SameSite=lax; Max-Age=604800`, `/api/auth/me` 200, email lower-cased, bcrypt hash. Headless Chrome: /signup → `/dashboard`, badge “Pending”. |
| M1-02 | **PASS** | **Presence-only (no creds, OAuth round-trip NOT tested).** Google not configured → `/login` and `/signup` render **no** Google control (0 matches) and `GET /api/auth/google` → 501 JSON. With a *fake* `GOOGLE_CLIENT_ID/SECRET` env on a second instance (:3207) the button appears on both pages as a link to `/api/auth/google`, which 307s to `accounts.google.com/o/oauth2/v2/auth?client_id=…&redirect_uri=…/api/auth/google/callback`. Real sign-in/sign-up with Google still needs real credentials (owner: Juice/coordinator). Evidence: `qa/evidence-fe1-i.log`, `qa/artifacts/frontend-dashboard/login-google-button-desktop.png`. **Round 2 (f3d9eb1):** re-run with a 2nd instance (:3234, fake `GOOGLE_CLIENT_ID/SECRET`): button present on `/login` + `/signup` as link to `/api/auth/google` → 307 `accounts.google.com`; without creds no control and API 501. Still presence-only. `qa/evidence-fe2-suite/probe-fe1-i.log`. |
| M1-03 | **PASS** | dup email 409 `email_taken` (also upper-case); `short` → 400 `weak_password` (“at least 10 characters”); `password` and `12345678` now 400; `not-an-email`, `a@b`, blank name, bad JSON → 400; 1 row per email. FE regression: UI mirrors the cheap rules inline (see CHK-AUTH). |
| M1-04 | **PASS** | Replay of pre-logout cookie → 401 (and `POST /api/drops` 401); other device stays 200; expired/forged sessions 401; relogin 200. Reset flow: `forgot-password` 200 identical for known/unknown; `reset-password` 200, token reuse 400, pre-reset session → 401, new pw 200. **Login throttle is now the progressive delay (fixes-2) — see ‘Progressive login delay’: PASS on every sub-check.** FE regression: forgot/reset UI flow works end to end and signs out everywhere (CHK-RESET). |
| M1-05 | **PASS** | **BUG-15 CLOSED.** New-drop flow uploaded a JPG, PNG and WebP (+ a 3.7 MB JPG): each file row has a `role=progressbar` with `aria-valuenow` (0→100; intermediate values 3,6,10…97 observed under a 4 Mbit/s upload throttle); all four listed in DB with mime `image/jpeg, image/png, image/webp, image/jpeg`; editor “Add files” shows the same bars (2…31 % sampled). Client-side validation: `.txt`/`.gif` → “Unsupported type. Use JPG, PNG or WebP.”, `.mp4` → “MP4 video uploads are coming soon…”, 19 MB JPG → “Images can be up to 15 MB.”; a text file renamed `.jpg` passes client checks, server 415 → “We couldn’t read this image…” + Retry. Evidence: `qa/evidence-fe1-c.log`, `-h.log`, `-o.log`; `qa/artifacts/frontend-dashboard/newdrop-*.png`. **Round 2 (f3d9eb1):** new-drop flow progress bars (`aria-valuenow` 3…97 under throttle) and editor add-files bars (2…31 %) unchanged; client validation messages unchanged; fake `.jpg` → 415 → “We couldn’t read this image”. `probe-fe1-c/h/o.log`. |
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
| M2-07 | **PASS** | Anonymous `/u/<id>` (new design) shows: blurred hero + up to 5 blurred thumbnails (natural size 320×240, all from `/api/files/<id>/preview`), title, “by <seller display name>”, description, price, file summary “6 files: 6 images” (types are categories, not JPG/PNG/WebP), terms checkbox, Buy. No original reference in HTML or network (see CHK-ORIG). Evidence: `qa/evidence-fe1-a.log`, `qa/artifacts/frontend-dashboard/buyer-desktop-1280.png`, `buyer-mobile-390x844.png`. **Round 2 (f3d9eb1):** buyer page main text unchanged except `<title>` now “<drop> · Unveil” (FE-03); 6 previews 320×240, no original refs, 0 CSP violations. `probe-fe1-a.log`. |
| M2-08 | **PASS** | Scan of page HTML + RSC payload + `/api/public/drops/:id` JSON for storage_key, `originals/`, `/original`, filenames → none. Only `/api/files/:id/preview` URLs. Anon previews return JPEG blur only. Re-verified on the new buyer page + dashboard pages: only `/api/files/<id>/preview` is requested/rendered (CHK-ORIG). |
| M2-09 | **PASS** | `/u/<id>`: `X-Robots-Tag: noindex, nofollow` + `<meta name="robots" content="noindex, nofollow, nocache">`; same header on public API, previews, signed originals and 404 variant. `/robots.txt` 200 (`Disallow: /u/ /d/ /api/ /dashboard`); `/sitemap.xml` 404; no listing routes (`/u`, `/explore`, `/browse`, `/api/public/drops` → 404). Re-verified on the new buyer page: header + meta + robots.txt unchanged, also on the branded 404 (CHK-NOINDEX). |
| M2-10 | **BLOCKED** | Still blocked on **Backend**: `PATCH`/`PUT`/`DELETE /api/drops/:id` → 405 (re-probed from a logged-in browser session). The new drop editor has **no** edit fields (0 inputs/textarea besides the file picker) – Frontend correctly did not fake it. Needs `PATCH /api/drops/:id` then a Frontend edit form. |
| M2-11 | **PASS** | Dashboard UI: Unpublish (confirm modal) → DB `unpublished`, `/u/<id>` 404 **with the new branded “This link isn’t available” page** (no Buy button; same page for draft / flagged / unpublished / bogus ids, all with `X-Robots-Tag: noindex`), republish through the attestation dialog → `/u/<id>` 200 again. Improvement over main (generic Next 404). Open BUG-11b unchanged at API level (the UI only offers Unpublish on published drops). `POST /api/checkout` for an unpublished link still answers 501 (stub), not 404 – re-check when checkout is real. Evidence: `qa/evidence-fe1-g.log`, `qa/artifacts/frontend-dashboard/buyer-unavailable-desktop.png`, `editor-unpublished-desktop.png`. **Round 2 (f3d9eb1):** UI unpublish → 404 branded page (same for draft/unpublished/bogus; `<title>` now “Link unavailable · Unveil”, `X-Robots-Tag: noindex`), republish → 200; modal focus returns to the trigger (FE-02). `probe-fe1-a.log`, `-g.log`. |
| M2-12 | **BLOCKED** | Needs purchase flow (M3) – not implemented. |
| M2-13 | **BLOCKED** | Still blocked on **Backend**: `DELETE /api/drops/:id` → 405, no file-delete endpoint. No delete control exists in the UI (correct). |
| M2-14 | **BLOCKED** | Confirmed **absent**: there is no buyer download/order route (Frontend notes: only a presentational `DownloadPanel` rendered on `/design`). Blocked on **Backend/Payments** (orders + buyer-minted signed URLs, zip). |
| M2-15 | **BLOCKED** | Expiry works: signed link default TTL now 24 h (`ttl=86399 s`); expired(-10 s) 410, expired(-1 d) 410, valid 200 (signed with the QA instance secret). Receipt link minting a fresh URL needs the buyer/receipt flow (M3) → not implemented. |
| M2-16 | **BLOCKED** | No download-attempt counter/purchase concept; 50 repeat downloads with one signed URL → 50×200. |
| M2-17 | **PASS** | Download route `/api/files/:id/original` (only download endpoint): default limits → 80 sequential bad-sig requests from one IP `403×60, 429×20` with `Retry-After`; other IP unaffected. Login: per-IP 20/15 min unchanged (`429 rate_limited`, Retry-After 894); per-email is now the progressive delay. Caveats: no buyer download endpoint yet; per-IP limiter bypassable with spoofed `X-Forwarded-For` when exposed without a trusted proxy (BUG-18, deploy config). |
| M2-18 | **PASS** | Headless Chrome mobile emulation (touch, DPR 2) at **390×844 and 360×800**: `/u/<id>`, `/`, `/signup`, `/login`, `/forgot-password` and (logged in) `/dashboard`, `/dashboard/drops`, `/dashboard/drops/new`, drop editor → `scrollWidth == clientWidth` everywhere (no horizontal scroll). Buy button 308×52 px (390) / 278×52 px (360), fully inside the viewport, ≥44 px tall, tap works (terms checkbox first, then test-mode notice). Dashboard mobile uses top bar + bottom tabs (Overview / Drops / New drop) and Sign out is reachable. **Emulation only – real iOS Safari / Android Chrome devices not tested.** Evidence: `qa/evidence-fe1-a.log`, `-b.log`, `-o.log`; `qa/artifacts/frontend-dashboard/buyer-mobile-*.png`, `dashboard-maya-mobile-*.png`. **Round 2 (f3d9eb1):** 390×844 and 360×800: `/u/<id>`, `/`, `/signup`, `/login`, `/forgot-password`, dashboard, drops, new, editor **and the 4 new placeholder pages** → no horizontal scroll; Buy 308×52 / 278×52 inside viewport and tappable; new overview cards (4 + 3) stack without overflow (`dashboard-maya-mobile-390.png`). Still Chrome emulation only. `probe-fe1-a/b/o.log`, `evidence-fe2-pwa-placeholders.log`. |
| M2-19 | **PASS** | CDP throttling, cache disabled, 4× CPU slowdown, mobile viewport, 3 runs each, prod build on localhost (no CDN): **4G (9 Mbit/s, 170 ms RTT)** Buy button visible ≈0.33–0.36 s, FCP 0.62–0.66 s, load event 0.95–0.99 s; **slow 4G (1.6 Mbit/s, 150 ms)** Buy visible ≈0.32–0.40 s, FCP 1.0–1.2 s, load (incl. 6 blurred previews) 1.72–1.73 s – all < 2 s. 217 KB transferred, 16 requests. Caveat: server-side render on loopback; real-network TTFB/CDN not included. Evidence: `qa/evidence-fe1-a.log`. **Round 2 (f3d9eb1):** CDP 4× CPU: 4G Buy visible 0.32–0.42 s, load 0.95–1.09 s; slow-4G Buy visible 0.30–0.32 s, load 1.70–1.72 s (< 2 s); 217 KB / 16 requests (unchanged). `probe-fe1-a.log`. |
| M3-01 | **BLOCKED** | Still blocked on **Payments**: Buy is a stub. Guest click on Buy (after ticking terms) shows **no login/account prompt** (0 login controls) but also **no card form** – `POST /api/checkout` → 501 → friendly notice “Checkout is in test mode — nothing was charged.” (focus moves to the notice). Without ticking terms: “Please confirm to continue.” 11th click inside 60 s → real limiter 429 `Retry-After: 58` → button “Try again in 58s” ticking down. Integration note: the stub targets the *main* 501 `/api/checkout`; the payments branch (af475d0, hosted `/pay/mock/<session>`) changes that contract – Frontend must be re-pointed and re-tested. Evidence: `qa/evidence-fe1-a.log`, `-l.log`. **Round 2 (f3d9eb1):** unchanged: Buy still a stub (501 `not_implemented` → “Checkout is in test mode”); real limiter 429 shows “Try again in 58s” and counts down. `probe-fe1-a.log`, `-l.log`. |
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
| M3-18 | **PASS** | On `/u/<id>` the statement is visible **before** the Buy click, twice: checkbox label “I agree to the Terms and understand all sales are final.” (must be ticked, else “Please confirm to continue.”) and the panel “All sales are final. Because files are delivered digitally right away, purchases can’t be refunded.” (`data-testid=final-sale`, visible at 1280 and 390/360 px). Scope: link page only – the hosted payment page of the payments branch (`/pay/mock/<session>`) is a separate surface (that branch’s BUG-5 reported the text missing there) and is not part of this branch. The checkbox’s “Terms” link goes to `/terms` = 404 (BUG-07, legal parked). Evidence: `qa/evidence-fe1-a.log`, `qa/artifacts/frontend-dashboard/buyer-buy-stub-desktop.png`. **Round 2 (f3d9eb1):** final-sale statement visible before Buy (checkbox label + panel) at 1280/390/360; the checkbox’s “Terms” link now opens the `/terms` **Coming-soon placeholder** (200) instead of a 404 – it is *not* the real terms text (see M5-16). `probe-fe1-a.log`, `evidence-fe2-pwa-placeholders.log`. |
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
| M4-09 | **PASS** | **FE-01 FIXED & verified (Medium → closed).** Overview now has separate cards **Gross sales $506.00** (“30 sales · 2 reversed”), **Platform fee $43.10** (“10% of completed sales”), **Processing fees $21.56** (“5% of completed sales · card processor”), **Your earnings (net) $366.34** (“85% of completed sales, after fees”), then **Available $156.34**, **Pending payouts $60.00**, **Paid out $150.00**, a reconciliation line “$506.00 gross − $43.10 platform fee − $21.56 processing fees − $50.00 refunded − $25.00 charged back = $366.34” and a separate reversals line “$50.00 refunded · $25.00 charged back”. “Your 90%” is gone. Independent DB recompute (psql/pg, not the app’s SQL): succeeded 30 sales = $431.00 gross, fee $43.10, proc $21.56, net $366.34 (= SUM(seller_net_cents)); refunded $50.00 / charged_back $25.00 kept apart; paid $150.00, requested/pending $60.00; `gross − refunded − charged back − platform − processing = net` holds to the cent in all 6 seller scenarios (maya, zero sales, 400+ sales with odd cents and a $1.23M sale, negative-balance, 2 isolated sellers); refunds subtracted once; 69 assertions OK (1 deliberate FAIL = FE-08 negative balance clamped). Also correct: thousands separators (`$1,257,801.65`), odd-cent rounding, failed payouts ignored, no cross-seller leakage, $0.00 for a seller with no sales. **Caveats:** the rules are re-implemented in `data.ts` and **diverge from `payments/abstraction`** (ledger, partial refunds, `requested/approved` payouts, pending/failed transactions) → **FE-07** (Medium, integration) and **FE-08** (Low). Evidence: `qa/evidence-fe2-earnings.log`, `evidence-fe2-divergence.log`, `probe-fe1-b.log`; `dashboard-maya-desktop-final.png`, `dashboard-zero/many/negative-desktop-r2.png`, `dashboard-maya-mobile-390.png`. |
| M4-10 | **BLOCKED** | Per-drop **units sold and revenue are correct** vs DB (Spring 18 / $216.00, Studio 7 / $175.00, Travel 5 / $40.00, others 0 / $0.00; only `succeeded` rows). **Views and conversion do not exist** (no view counter anywhere in backend; Frontend omitted the columns). Blocked on **Backend** (view tracking → conversion). Evidence: `qa/evidence-fe1-b.log`. **Round 2 (f3d9eb1):** per-drop units/revenue still correct vs DB (Spring 18 / $216.00 …); still no views/conversion. `probe-fe1-b.log`. |
| M4-11 | **BLOCKED** | No transaction-history page/endpoint: `/dashboard/transactions` → 404, dashboard/drops pages contain no per-transaction list; schema has no buyer-country column. Blocked on **Backend** (transactions API + country) and then **Frontend** (page). |
| M4-12 | **BLOCKED** | Not implemented (no KYC provider, payouts, earnings dashboards, profile edit). |
| M4-13 | **BLOCKED** | Not implemented (no KYC provider, payouts, earnings dashboards, profile edit). |
| M4-14 | **BLOCKED** | Not implemented (no KYC provider, payouts, earnings dashboards, profile edit). |
| M4-15 | **BLOCKED** | Not implemented (no KYC provider, payouts, earnings dashboards, profile edit). |
| M4-16 | **BLOCKED** | Not implemented (no KYC provider, payouts, earnings dashboards, profile edit). |
| M4-17 | **BLOCKED** | Blocked on **Backend + Frontend**: `PATCH`/`PUT /api/auth/me` → 405, no profile/settings UI (`/dashboard/settings`, `/dashboard/profile`, `/settings`, `/profile` → 404). No public seller profile page exists ✔ (the buyer page shows only the display name). |
| M4-18 | **PASS** | Automated UI run (excluding the ID-verification wait, which has no UI: `npm run verify-seller` stood in, 1.0 s): signup page → account (2.7 s, incl. 2 validation round-trips) → new drop form → 4 images uploaded (7.9 s at a 4 Mbit/s throttle) → draft → verify → Publish dialog (3 attestations; error “Please confirm all three statements to publish.” until ticked) → **live link `/u/<id>` returns 200 at ≈17.4 s** (≪ 15 min). Verified seller one-step “Upload & publish” (1 file) → live in 1.2 s; attestation stored `{at, over18, ownsRights, consentOfSubjects}`. Caveat: no seller-facing verification flow exists, so a real seller can’t reach “live” until Backend/KYC ships; unverified sellers get a clear “Publishing locked” notice and drafts. Evidence: `qa/evidence-fe1-c.log`, `-o.log`; `qa/artifacts/frontend-dashboard/editor-published-desktop.png`, `publish-dialog-desktop.png`, `newdrop-one-step-published-desktop.png`. **Round 2 (f3d9eb1):** timed flow signup→account 2.6 s→4 images uploaded 7.9 s→draft→`verify-seller`→publish dialog (3 attestations)→ live `/u/<id>` 200 at **≈18 s (17.3 s excl. the 1 s verify command)** ≪ 15 min; verified one-step Upload & publish 1.1 s. Still no seller-facing KYC UI. `probe-fe1-c.log`, `-o.log`. |
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
| M5-16 | **BLOCKED-ON-LEGAL** | Parked (legal copy pending), **not counted as FAIL; stays BLOCKED-ON-LEGAL.** The 4 pages now exist as **noindex “Coming soon” placeholders** (`/terms /privacy /dmca /contact` → 200, `<meta name="robots" content="noindex, nofollow">`, titles “Terms · Unveil” etc., visible text only title + “Coming soon.” + “Back to Unveil” + footer; 0 legal claims, 0 adult-market words, no user input reflected [`?x=<script>` probe → 0 echoes]; full security headers; no horizontal scroll at 390/360). They are **not** the real legal copy: no terms, privacy policy, DMCA agent/takedown procedure, contact address or 18 U.S.C. §2257 statement. `/2257` still → **404**. Footer links on landing (all 4), `/terms` link in the buyer-page terms checkbox, `/terms` + `/privacy` on signup – all resolve. Gaps found → **FE-09** (no `X-Robots-Tag` header on placeholders) and **FE-10** (legal links absent on login/forgot/reset/dashboard/unavailable page; buyer page links only Terms). Owner: **Legal** (copy, DMCA agent, 2257 custodian, contact) → then **Frontend**. Evidence: `qa/evidence-fe2-pwa-placeholders.log`, `placeholder-*.png`, `landing-footer-desktop.png`. |
| M5-17 | **BLOCKED** | Not implemented (no moderation, reports API, refunds, admin routes/UI). |
| M5-18 | **BLOCKED** | Not implemented (no moderation, reports API, refunds, admin routes/UI). |
| M5-19 | **BLOCKED** | No cookie-consent banner; only the essential session cookie is set. Frontend. |
| M5-20 | **PASS** | Scope audited: UI copy of all 12 reachable pages (landing, signup, login, forgot, reset, design, buyer page incl. 404/unavailable, dashboard overview/list/new/editor), `<title>`, meta description/OG/Twitter, manifest (`name`, `description`), icons alt/aria text, password-reset email (subject “Reset your Unveil password”, text+HTML), error/validation messages. Regex for adult-market terms (adult, porn, nsfw, explicit, sex*, nude, fetish, escort, 18+, mature, kink…) over rendered HTML: only hits are the required age attestation wording in the publish dialog / `/design` (“Everyone in this content is 18 or older – Anyone who appears in your files is an adult”) – mandated by M2-05; flagged for Legal/Product to confirm the wording is acceptable under M5-20, not a signalling violation. Tagline/description are generic (“Sell your files…”, “photos and videos”). Receipts/other emails don’t exist yet (not audited). Evidence: `qa/evidence-fe1-f.log`, `-m.log`. **Round 2 (f3d9eb1):** re-audit incl. 4 new placeholder pages (visible text is only the title, “Coming soon.”, “Back to Unveil”, footer; scan for adult/porn/nsfw/explicit/sex*/18+/… and legal-claim words → 0 hits), new overview copy, new `<title>`s: 0 hits except the mandated age-attestation wording in the publish dialog (`/dashboard/drops/<id>`), as in round 1 (`/design` is now 404 in prod). Placeholders carry no fabricated legal claims. `probe-fe1-f.log`, `evidence-fe2-pwa-placeholders.log`. |
| M6-01 | **NOT RUN** | Full OWASP review not performed. Partial probes all clean: SQL is parameterised (only constant column lists interpolated), XSS payloads escaped on public page, JWT tamper/alg=none 401, CSRF: foreign/`null`/garbage Origin → 403 JSON, IDOR clean (M1-13), decompression cap (10100×10000 → 415), no `dangerouslySetInnerHTML`, only outbound fetch is the fixed Google token URL (+ mail adapters). Open: BUG-13 (`text/plain` accepted). |
| M6-02 | **PASS** | App-level: CSP, HSTS (`max-age=63072000; includeSubDomains; preload`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` present on pages, API, previews, signed originals, 404s, static 404, redirects and POST responses; no `X-Powered-By`. 0 CSP violations in headless Chrome. Secrets: 0 hits in client bundle, `.env` never tracked, cookie HttpOnly/Secure/SameSite=Lax, storage 0700/0600 outside `public/`. Residuals: CSP allows `'unsafe-inline'` scripts (documented); TLS configuration and public-bucket (S3/R2) checks are hosting concerns, not testable locally. Re-verified on faa38d4: CSP/HSTS/XFO/XCTO/Referrer-Policy/Permissions-Policy on pages (no `unsafe-eval`); 0 CSP violations across 40+ page loads (CHK-HDR). **Round 2 (f3d9eb1):** CSP (no `unsafe-eval`), HSTS, XFO DENY, XCTO, Referrer-Policy, Permissions-Policy present on `/`, `/login`, `/u/<id>`, `/dashboard` (307), `/design` 404 and on the 4 placeholders + `/2257` 404; 0 CSP violations in ≈60 page loads. `probe-fe1-l.log`. |
| M6-03 | **NOT RUN** | Only link page exists; load test not run (checkout/download not built). |
| M6-04 | **BLOCKED** | Not implemented / out of scope for foundation (no backup/monitoring/status page/webhook queue/launch artifacts). |
| M6-05 | **BLOCKED** | Not implemented / out of scope for foundation (no backup/monitoring/status page/webhook queue/launch artifacts). |
| M6-06 | **BLOCKED** | No status page / incident banner exists in UI or backend (no toggle source). Blocked on **Backend/Ops** (banner flag or status feed) then **Frontend**. |
| M6-07 | **PASS** | `/manifest.webmanifest` valid (name, short_name, `display: standalone`, start_url/scope `/`, theme/background colours, 192 + 512 `any` + 512 `maskable` PNG icons, all 200 `image/png`); `apple-touch-icon` 180×180 200; `theme-color`, viewport and `apple-mobile-web-app-*` meta present. Chrome CDP `Page.getInstallabilityErrors` on a persistent (non-incognito) profile → **[]**, `Page.getAppManifest` errors **[]**. No service worker (`/sw.js` 404) – no offline mode; not required by Chrome’s installability check today. **Real-device install and iOS Safari / Android Chrome flow pass not performed** (needs devices). Evidence: `qa/evidence-fe1-e.log`, `-pwa.log`. **Round 2 (f3d9eb1):** Chrome CDP installability on a persistent profile → **[]**, manifest errors **[]** (name “Unveil”, standalone, 192/512/maskable icons); still no service worker; real-device install not tested. `evidence-fe2-pwa-placeholders.log`. |
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
git fetch origin && git worktree add --detach /tmp/fe2 origin/frontend/dashboard && cd /tmp/fe2   # expect f3d9eb1
unset NODE_ENV; cp .env.example .env   # set SESSION_SECRET / SIGNED_URL_SECRET (openssl rand -base64 48), DATABASE_URL (throwaway DB), STORAGE_LOCAL_DIR, MAIL_DEV_DIR
npm ci && npm run migrate && npm run lint && npm run build && npm test          # 61 tests
E2E_DATABASE_URL=postgres://…/unveil_e2e_<unique> E2E_PORT=<free> npm run e2e   # 47/47 (BUG-21 flake: rerun once)
bash scripts/dev-start.sh 3230 & BASE_URL=http://localhost:3230 npx tsx scripts/seed-demo.ts   # writes .e2e/seed.json
# from the qa/test-plan checkout (playwright-core + /usr/bin/google-chrome); second instance with RATE_LIMIT_ENABLED=0 for bursts:
export BASE=http://localhost:3232 SEED=/tmp/fe2/.e2e/seed.json DB=postgres://…/unveil_qa_fe2 MAIL=<mail dir> OUT=qa/artifacts/frontend-dashboard-r2
node qa/scripts/qa-fe2-earnings.mjs; node qa/scripts/qa-fe2-modal.mjs; node qa/scripts/qa-fe2-meta.mjs; node qa/scripts/qa-fe2-duration.mjs
BASE=http://localhost:3230 node qa/scripts/qa-fe2-real429.mjs; node qa/scripts/qa-fe2-pwa.mjs; node qa/scripts/qa-fe2-upload429.mjs
# FE-07: BASE=<app on a DB migrated with main 001–004 + payments/abstraction 005–007> DB=<that DB> node qa/scripts/qa-fe2-divergence.mjs
for s in a b c f g h j l n o signup misc; do node qa/scripts/qa-fe1-$s.mjs; done   # round-1 probes (FE=/tmp/fe2 for c; qa-fe1-misc now reads BASE/MAIL from env)
# backend regression (limits off, PUB=/u): qa-backend-1/1b/1c/1d, qa-fixes-1 as in earlier runs
```
`qa/scripts/qa-fe2-d.mjs` = `qa-fe1-d` with a unique `x-forwarded-for` per browser context. Screenshots (≈50) are in `qa/artifacts/frontend-dashboard-r2/`; logs in `qa/evidence-fe2-*.log` and `qa/evidence-fe2-suite/`. Reset tokens in logs are redacted; the only credential is the documented demo password.

## Housekeeping
Stopped my servers on :3230, :3232, :3233, :3234, :3235 (and the e2e server on :3231 exited); dropped `unveil_qa_fe2`, `unveil_e2e_qa_fe2`, `unveil_qa_fe2_x`; removed worktree `/workspace/fe2`. Servers on :3100, :3120, :3300, :3400 and the payments worker’s :3500+ ports / `unveil_qa_pay*` DBs were not touched. `proof/db.txt` modified by `npm run e2e` reverted in the throwaway worktree.
