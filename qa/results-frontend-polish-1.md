# Unveil QA results — PR #5 `frontend/polish-1` (round "FE4": verification of FE-12 / FE-13 / FE-14 / FE-15)

- **Date:** 2026-10-01, ≈22:27–23:05 ET.
- **Branch / SHA tested:** `origin/frontend/polish-1` @ **`24b631af57e8a5403c62371f4ef2e2cb2913893e`** (PR https://github.com/unveil-link/Unveil.link/pull/5, not merged), 2 commits (`60bbca3`, `24b631a`) on top of `origin/main` @ **`206320e135dcc90161c76e79e974272f51b3035c`** (= merge of PR #1 / e4b5722). Baseline for regression: the same scripts on a clean worktree of main 206320e. QA base: `origin/qa/test-plan` @ 990104a (rebased before every push, no force).
- **Env:** Node 20.19.2, PostgreSQL 17, headless Google Chrome 154 (playwright-core, `--no-sandbox`). Worktrees `/workspace/qa-fe4` (branch) and `/workspace/qa-fe4-main` (main), both removed at the end. Throwaway DBs `unveil_qa_fe4` (branch), `unveil_qa_fe4m` (main), `unveil_e2e_qafe4` (e2e) — dropped. Production builds (`NEXT_DIST_DIR=.next-qa`): branch :4401 (limits off, mock on), :4402 (limits off, `MOCK_PAYMENTS_ENABLED=0`), :4403 (default limits), e2e :4400; main :4411 (limits off), :4412 (default limits), :4413 (mock off). All stopped at the end. `.env` per `docs/frontend-dashboard-notes.md` (`PAYMENT_WEBHOOK_SECRET`, `MOCK_PAYMENTS_ENABLED=1`, fresh secrets). No other worker's ports/DBs/worktrees touched (3xxx/43xx previously used ports were free; I used 44xx).
- **Rules followed:** no app code modified (a production build with a non-default `NEXT_DIST_DIR` appends `.next-qa/*` includes to `tsconfig.json` in the throw-away worktree only); nothing pushed to `main`, lane branches or `frontend/polish-1`; only `qa/test-plan`. Nothing sent to anyone; M5-16 untouched.

## Verdict
**FE-12, FE-13, FE-14 (the buyer/hosted/dashboard copy part) and FE-15 are all FIXED** and verified with the original repros; every one of those repros still fails on main 206320e (before/after evidence in `qa/artifacts/fe4/main/`). **0 FAIL, 0 regressions** over the whole earlier suite (≈ 700 checks), tsc/lint/unit (242/242)/e2e (83/83) green. The diff vs main is limited to the stated files; `Cache-Control: no-store` is added **only** to `/api/earnings` (41-route header diff). **FE-14 is not fully closed:** the landing page (Hero, HowItWorks, BuyerTrust, FAQ, PaymentLinkMock), the auth shell and the site-wide `<meta description>` still promise instant download / a receipt (admitted by Frontend; residual list below, **FE-14R, Medium**). New: **FE-16 (Low)** Sold-count semantics vs the Gross card, plus INFO items.

| Item | Verdict | One-line evidence |
|---|---|---|
| **FE-12** "Balance owed" wording | **FIXED ✔** | card hint "Below zero. It will be deducted from future earnings."; alert no longer says "after a payout / already been paid out" — checked on Ned (desktop + 390 px) and the never-paid-out chargeback seller from `qa-fe3-cbhold.ts` (Balance owed −$5.00, Pending $15.60, Paid out $0) — `fe4-fe1213.log` 34 OK |
| **FE-13** alert tone / role | **FIXED ✔** | `[data-testid=negative-balance]` has `role="alert"`, `border-danger/30 bg-danger-soft`, found by `getByRole('alert')`; text contrast 16.0:1, icon 4.9:1; no alert for positive sellers |
| **FE-14** buyer copy | **FIXED ✔ (buyer page, hosted page, dashboard) / residual FE-14R** | label "Email", button "Pay $12.00", sub-line "Pay by card · No account needed", trust point "Access after payment … Delivery options are coming soon.", `SALES_FINAL_TEXT` without "delivered immediately", dashboard How-it-works reworded; 27 checks desktop+mobile (`fe4-fe14.log`); main fails 23 of them (`main/main-fe14.log`) |
| **FE-15** per-drop Sold / Revenue | **FIXED ✔** | Maya: Spring 21/$252.00 + Studio 6/$140.00 + Travel 4/$32.00 = **$424.00** = `GET /api/earnings` gross − refunded − charged back = raw-ledger recompute; list (desktop + mobile cards) and detail page agree; 69 edge-case checks OK. Main shows Studio $150.00 (partial refund not netted) |
| `Cache-Control: no-store` on `/api/earnings` | **OK ✔** | on 200/401/405; other 38 routes byte-identical headers vs main (static, pages, `/api/checkout`, `/api/webhooks/mock`, auth, `/api/earnings/x`, `/api/earningsx`…) |
| X-Robots-Tag `/terms /privacy /dmca /contact` | **still OK ✔** | `noindex, nofollow` header + meta, also with query string; `/u/*` keeps noindex |
| Legal links / placeholders | **intact ✔** | all four links on landing, login, signup, forgot, reset, buyer page, unavailable page, draft link, dashboard shell (overview/drops/new/detail, 390 px); four pages 200, "Coming soon" only; `/2257` 404 |
| eslint ignores `qa/ proof/ screenshots/` | **OK ✔** | plain `npm run lint` rc 0 with `qa/` present (round 3 needed `--ignore-pattern`) |
| Diff vs main | **as stated ✔** | see below |

## Counts (106 plan rows; ratings unchanged from round 3)
| Milestone | PASS | PARTIAL | FAIL | BLOCKED | NOT RUN | Total |
|---|---|---|---|---|---|---|
| M1 | 10 | 0 | 0 | 4 | 0 | 14 |
| M2 | 13 | 0 | 0 | 6 | 0 | 19 |
| M3 | 11 | 1 | 0 | 7 | 1 | 20 |
| M4 | 4 | 0 | 0 | 14 | 0 | 18 |
| M5 | 3 | 0 | 0 | 17 | 0 | 20 |
| M6 | 2 | 0 | 0 | 6 | 2 | 10 |
| S2 | 3 | 0 | 0 | 2 | 0 | 5 |
| **Total** | **46** | **1** | **0** | **56** (incl. M5-16 BLOCKED-ON-LEGAL) | **3** | **106** |

No rating changes. Notes updated on M4-09, M4-10, M5-07, M3-02, M3-13, M3-14, M3-20, M2-14, S2-02, M5-16 (plan table). Rows marked "re-run on the branch" were exercised again with the round-3 scripts; the others are carried over (no backend/db/package change in the diff).

## Suite results on `frontend/polish-1` @ 24b631a
| Check | Result |
|---|---|
| `npm ci` / `npm run migrate` | OK / 001–012 applied |
| `npx tsc --noEmit` | clean (`fe4-typecheck.log`) |
| `npm run lint` | **clean**, rc 0 (`fe4-lint.log`) |
| `npm run build` | OK |
| `npm test` | **242/242** (13 files; includes the new copy-guard tests and the DB test "dashboard per-drop stats reconcile with the earnings summary") — `fe4-npm-test.log` |
| `npm run e2e` | **83/83** (`fe4-e2e-run1.log`; `proof/db.txt` saved as `fe4-e2e-proof-db-run1.txt` and reverted) |
| Earlier QA suite on the branch (0 FAIL each) | earnings 115, fixes 90, buy 67, buyerr 18, back 2, fees 16, journey 4, misc 9, regress 55, reg-modal 52, reg-duration 93, reg-meta 17, boundary 20, webhook 6, ned-netting 3, payout-ui 7, dropdetail 6, perdrop-edge 69, fe1213 34, fe14 27 |
| Same scripts on main 206320e | fixes 90, buy 67, buyerr 18, back 2, fees 16, journey 4, misc 9, regress 55, webhook 6 OK; earnings: 92 OK + 15 intended FAIL (no `Cache-Control`, per-drop rows lack `data-testid`/net-out); fe1213: 21 intended FAIL; fe14: 23 intended FAIL — i.e. all four bugs reproduce on main |

### Diff `origin/main..frontend/polish-1` (36 files)
`components/buyer/{BuyPanel,TrustPoints}.tsx`, `components/dashboard/DropList.tsx` (test ids), `lib/purchase-copy.ts`, `next.config.ts` (+2 lines, the `/api/earnings` header rule), `eslint.config.mjs`, `scripts/e2e.ts`, `src/app/dashboard/{data.ts,page.tsx}`, `src/app/u/[linkId]/BuyForm.tsx` (dead code), tests (`tests/frontend-lib.test.ts`, `tests/db/payments.test.ts`, new `vitest.config.mts` — only mirrors the tsconfig `@/` alias), `docs/frontend-dashboard-notes.md`, retaken screenshots. **0 files** under `src/server`, `src/app/api`, `db/`, `package.json`, `package-lock.json`; `scripts/seed-demo.ts` and `lib/earnings.ts` unchanged. The only data-layer change is the read-only query in `src/app/dashboard/data.ts` (`getDropStats`, parameterised, reads `transactions` incl. `reversed_cents`; no ledger/pricing/payout code). Evidence: `git diff --name-only origin/main origin/frontend/polish-1`.

## Per-fix evidence

### FE-12 / FE-13 (`qa-fe4-fe1213.mjs`, `qa-fe4-cbhold.ts`; `fe4-fe1213.log`, `fe4-cbhold.log`, `fe4-negative-*.png`)
Original repro (`BASE_URL=… npx tsx qa/scripts/qa-fe4-cbhold.ts`, then Ned): card "Balance owed −$46.80 / Below zero. It will be deducted from future earnings."; alert "You owe $46.80 — Your available balance is below zero because a refund, chargeback or chargeback fee was larger than the money available to you. It will be deducted from your future earnings before your next payout." (accurate for both Ned and the never-paid-out seller). Alert: `role="alert"`, danger tone matches the red card. Maya (positive) shows the "Available" card and no alert. On main the same script gives `role="status"`, `border-warning`, "after earlier sales had already been paid out" (`main/main-fe1213.log`). Netting by a later sale still removes both card and alert (`fe4-ned-netting.log`); payout lifecycle unchanged (`fe4-payout-ui.log`).

### FE-15 (`qa-fe4-earnings.mjs` §E, `qa-fe4-perdrop-edge.ts`, `qa-fe4-dropdetail.mjs`)
Independent truth = `ledger_entries` joined to `transactions` (gross components of sale_credit / refund_reversal / chargeback_reversal per drop; a unit = a sale whose net gross > 0) — it does not use `transactions.reversed_cents` or `status`, which the new query uses.
- **Maya (clean seed):** Spring 21 / $252.00, Studio 6 / $140.00 (5×$25 + one $25 sale partly refunded by $10 = $15; the fully refunded $25 sale is not a unit), Travel 4 / $32.00 (one $8 chargeback excluded); drafts / under-review / unpublished 0 / $0.00; sum **$424.00** = API gross $467.00 − refunded $35.00 − charged back $8.00. Desktop rows, 390 px cards and drop detail pages all equal the ledger. Sam: no rows; Ned: Print pack 0 / $0.00 (sale fully refunded); Jo: draft 0 / $0.00.
- **Edge cases (69 OK):** S1 all sales refunded (full, two partials summing to full, three partials) → 0 / $0.00; S2 drop with zero sales + draft + one sale; S3 chargeback **after payout** with $5 fee (payout paid, then chargeback; seller owes $20.60, per-drop "Paid then disputed" 0 / $0.00, "Stays good" 2 / $60.00); S4 partial refund then chargeback of the same sale (remaining amount reversed → 0 units); S5 partial chargeback $10 of $40 (tx status `charged_back`, still 1 unit, $30 kept); S6 over-refund $50 on $40 and a $30 chargeback exceeding the remaining $25 → both **rejected** by Payments (`webhook_events.outcome=rejected / over_refund`), revenue consistent; S7 pending + declined checkouts ignored, price edited after the sale doesn't change revenue; S8 two sellers with same-titled drops are isolated. In every scenario UI revenue == ledger, Sold == ledger units, and the per-drop sum == API gross − refunded − charged back (`fe4-perdrop-edge.log`, screenshot `fe4-perdrop-s3-cb-after-payout.png`).
- **Main baseline:** Studio shows $150.00 (ledger $140.00) and the sum $448.00 vs kept $424.00 (+ test sales) — `main/main-earnings.log` §E.

### FE-14 (`qa-fe4-fe14.mjs`, `qa-fe4-copyaudit.mjs`)
Buy through the UI at `/u/<id>` (desktop + 390 px): label "Email", button "Pay $12.00", sub-line "Pay by card · No account needed", trust point "Access after payment — Once your payment is confirmed, we’ll share how to access your files. Delivery options are coming soon.", "Just pay — nothing to sign up for.", sales-final text without "delivered immediately"; validation state, hosted mock page (before/after paying), rate-limit countdown label ("Try again in 19s") and dashboard overview/drops/new contain no receipt / instant-download / unlock-moment promise. After a successful payment the hosted page shows "Payment succeeded (mock)" and a "Back to the drop" link only (no receipt mail: 0 files; the only email template that exists is password reset, `fe4-email-forgot-password.txt`). The buyer page title/og/twitter tags are unchanged and neutral.

### Cache-Control and other routes (`qa-fe4-headers-diff.sh`, `fe4-headers-diff.txt`)
41 routes compared between main and branch, GET/POST, anonymous and logged in (pages, static chunk, icons, manifest, `/u/*`, `/pay/mock/*`, `/dashboard*`, `/api/auth/*`, `/api/drops`, `/api/settings`, `/api/checkout`, `/api/webhooks/mock`, `/api/earnings` variants). Only three rows differ: `GET /api/earnings` 200, 401 and `POST /api/earnings` 405 gain `Cache-Control: no-store`. Trailing-slash `/api/earnings/` (308), `/api/earnings/x`, `/api/earningsx` unchanged.

## FE-14 residual list (every remaining promise of instant delivery / receipt / download)
Method: rendered text (incl. collapsed `<details>`), `<meta>`/og/twitter, aria/alt/title attributes, manifest, robots, emails and source grep, over 31 pages/states (`fe4-copyaudit-polish.log`/`.json`; main baseline `fe4-copyaudit-main.log`).

| # | Where (page → file:line) | Text | Kind |
|---|---|---|---|
| 1 | `/` → `components/landing/Hero.tsx:22` | "Buyers pay by card — no account needed — and download instantly." | marketing, visible |
| 2 | `/` → `components/landing/PaymentLinkMock.tsx:39` | badge "Instant download" | marketing, visible |
| 3 | `/` → `components/landing/PaymentLinkMock.tsx:43` | button "Pay & download" | marketing, visible |
| 4 | `/` → `components/landing/PaymentLinkMock.tsx:7` | aria-label "…a Pay and download button" | marketing, a11y |
| 5 | `/` → `components/landing/HowItWorks.tsx:7` | "Buyers pay by card and download right away." | marketing, visible |
| 6 | `/` → `components/landing/BuyerTrust.tsx:7` | "Instant download — Your files are ready the moment your payment goes through." | marketing, visible |
| 7 | `/` → `components/landing/BuyerTrust.tsx:8` | "Private signed links — Every download link is unique to your purchase and expires automatically." | marketing, visible (no download link exists yet) |
| 8 | `/` → `components/landing/Faq.tsx:4` (collapsed `<details>`) | "Buyers pay with a card at checkout and download straight away. We only ask for an email address so we can send a receipt and a backup download link." — **receipt-email promise** | marketing, visible when FAQ opened |
| 9 | `/` → `components/landing/Faq.tsx:8` (collapsed) | "Files … are only delivered through signed links created after a successful purchase." | marketing |
| 10 | `/login`, `/signup`, `/forgot-password`, `/reset-password` → `components/auth/AuthShell.tsx:10` | "Instant delivery — Share one link anywhere. Files are delivered automatically." | marketing, visible |
| 11 | **every page** (also `/u/<id>`, `/terms`, `/privacy`, `/dmca`, `/contact`, dashboard, `/404`) → `src/app/layout.tsx:18` | `<meta name="description">` "…Buyers pay by card, no account needed, and download instantly." | site meta (search snippets) |
| 12 | `/u/<published>` (also while validation errors show) → `src/app/u/[linkId]/page.tsx:80` | "Previews are blurred. The full files unlock after purchase." | buyer page, mild (promises unlock, not "instant") |
| 13 | not rendered (dead code) → `src/app/u/[linkId]/BuyForm.tsx:35,44` | label "Email" now, but button still "Unlock for {price}"; component is imported nowhere | INFO |
| 14 | not routed → `components/buyer/DownloadPanel.tsx` (+ `/design` demo `components/design/DesignExtras.tsx:91-94`, 404 unless `ENABLE_DESIGN_PAGE=1`) | "Download", "Your download links are private to you and expire …" | INFO (unwired by design) |

Not promises (checked, fine): "Publishing unlocks once your identity is verified", "They’re added to this drop right away" (uploads), "Becomes available right away" (payout hold hint), reset-password mail, manifest description ("Sell your files with a simple payment link."), og/twitter on `/u/<id>`, robots/sitemap, README (documents the missing flow), the dashboard How-it-works line (fixed), the hosted mock page and buyer page (fixed). Rows 1–11 are the items Frontend listed as out of scope; **row 12 and the dead-code row 13 were not in their list**.

## New bugs / findings
| ID | Sev | Finding | Exact repro |
|---|---|---|---|
| **FE-14R** | Medium (open; known + admitted; marketing/trust, not a regression) | Rows 1–12 above still promise instant download / a receipt email / signed links, which do not exist (no receipt, order or download route; no receipt mail). Highest-risk items: FAQ row 8 ("we can send a receipt and a backup download link") and the site-wide meta description row 11. Owner: Frontend (copy) until Backend/Payments deliver receipt + download. | Open `/` (expand the first FAQ), `/login`, view-source `<meta name="description">` on any page; `node qa/scripts/qa-fe4-copyaudit.mjs` (env BASE, SEED, OUT, WT, TAG) lists every hit. |
| **FE-16** | Low (copy/consistency) | "Sold" counts only sales with a positive amount kept, but the Gross sales card hint says "33 sales" (every sale ever, incl. the fully refunded and the charged-back one). Per-drop Sold sums to 31 for Maya. "Revenue" per drop ($424.00) is gross *kept*, while the Gross card ($467.00) is gross charged — two revenue notions on adjacent pages without a label explaining the difference (the reconciliation line on the overview does). | Maya `/dashboard` ("Gross sales $467.00 · 33 sales") vs `/dashboard/drops` (21 + 6 + 4 = 31 sold, $424.00). |
| INFO-a | Info | `src/app/u/[linkId]/BuyForm.tsx` is dead code and still says "Unlock for" (not rendered anywhere). | `rg BuyForm src components` |
| INFO-b | Info | The alert now has `role="alert"`, so a screen reader announces "You owe …" on every `/dashboard` load for as long as the balance is negative (intended by Frontend; just noting the verbosity). | Ned `/dashboard`. |
| INFO-c | Info | `no-store` is also sent on the 401 and 405 responses of `/api/earnings` (harmless). | `curl -si localhost:4401/api/earnings`. |
| INFO-d | Info | Carried over, not branch-related: `POST /api/checkout` accepts `text/plain` (Origin check still blocks cross-site); the `%zz` path 500 (NEW-6) in `/u`, `/pay/mock`, `/dashboard/drops`; `/api/earnings.recent` returns rows the UI never renders; only the mock processor exists; the Gross-card "33 sales" count includes reversed sales. | see round 3 |
| INFO-e | Info | Payments rejects over-refunds / over-chargebacks with HTTP 200 (`webhook_events.outcome=rejected`, `over_refund`); the dashboard stays consistent (never negative revenue). | `fe4-perdrop-edge.log` S6 |

Closed from round 3: **FE-12, FE-13, FE-15 FIXED; FE-14 FIXED for buyer page/hosted page/dashboard (residual FE-14R above); round-3 INFO "`/api/earnings` has no Cache-Control" FIXED; round-3 INFO "QA scripts fail the repo eslint" FIXED (eslint ignores `qa/**`).**

## Still BLOCKED — on whom
- **Receipt email, receipt link, order/download routes, signed-URL delivery** (M2-12, M2-14..16, M3-13, M3-14, M3-20, S2-02): Backend/Payments first, then Frontend wires `DownloadPanel` and removes the FE-14R copy.
- **Real processor / sandbox** (M3-04 3DS, M3-08, M3-17, M3-19 hosted fields, S2-05 beyond the ledger): Payments + provider account.
- **KYC / payout provider and payout routes/UI** (M4-01..05, M4-07, M4-08, M4-12, M4-13, M4-15, M4-16): Payments/Backend.
- **Frontend-listed:** M4-10 (views & conversion not tracked; units/revenue are now correct), M4-11 (no transaction-history page), M4-17 (no profile/settings; `PATCH|PUT /api/auth/me` 405), M6-06 (status page).
- **Backend:** M2-10, M2-13, M1-06, M1-09, M1-11, M1-14. **Admin / moderation / compliance:** M5-01..06, M5-09..15, M5-17..19, M6-04, M6-05, M6-08..10.
- **M5-16: BLOCKED-ON-LEGAL** — unchanged; placeholders are not legal copy; no message sent to anyone. **Google OAuth (M1-02):** presence only (needs credentials).
- **NOT RUN:** M3-12 (Payments R5 PASS), M6-01 (OWASP review), M6-03 (load test).

## Case-by-case results
| Case | Result | Evidence / notes |
|---|---|---|
| M4-09 | **PASS** | **R4 (24b631a):** re-verified: dashboard == `GET /api/earnings` == raw ledger for Maya/Ned/Sam/Jo (115 OK incl. per-drop). FE-12/13/15 now FIXED; remaining caveat FE-16 (Low). |
| M1-01 | **PASS** | Carried over from round 3/2, not re-run (branch diff vs main touches no backend, db or package files). |
| M1-02 | **PASS** | Carried over from round 3/2, not re-run (branch diff vs main touches no backend, db or package files). |
| M1-03 | **PASS** | Carried over from round 3/2, not re-run (branch diff vs main touches no backend, db or package files). |
| M1-04 | **PASS** | Carried over from round 3/2, not re-run (branch diff vs main touches no backend, db or package files). |
| M1-05 | **PASS** | Carried over from round 3/2, not re-run (branch diff vs main touches no backend, db or package files). |
| M1-06 | **BLOCKED** | Carried over from round 3/2, not re-run (branch diff vs main touches no backend, db or package files). |
| M1-07 | **PASS** | Carried over from round 3/2, not re-run (branch diff vs main touches no backend, db or package files). |
| M1-08 | **PASS** | Carried over from round 3/2, not re-run (branch diff vs main touches no backend, db or package files). |
| M1-09 | **BLOCKED** | Carried over from round 3/2, not re-run (branch diff vs main touches no backend, db or package files). |
| M1-10 | **PASS** | Carried over from round 3/2, not re-run (branch diff vs main touches no backend, db or package files). |
| M1-11 | **BLOCKED** | Carried over from round 3/2, not re-run (branch diff vs main touches no backend, db or package files). |
| M1-12 | **PASS** | Carried over from round 3/2, not re-run (branch diff vs main touches no backend, db or package files). |
| M1-13 | **PASS** | Carried over from round 3/2, not re-run (branch diff vs main touches no backend, db or package files). |
| M1-14 | **BLOCKED** | Carried over from round 3/2, not re-run (branch diff vs main touches no backend, db or package files). |
| M2-01 | **PASS** | Carried over from round 3/2, not re-run (branch diff vs main touches no backend, db or package files). |
| M2-02 | **PASS** | Carried over from round 3/2, not re-run (branch diff vs main touches no backend, db or package files). |
| M2-03 | **PASS** | **R4 (24b631a):** re-run on the branch with the round-3 scripts, rating unchanged. Previous evidence (R3): Re-run: publish by pending-verification seller (Jo) → 403; checkout on that seller's draft → 404 (`fe3-misc.log`). |
| M2-04 | **PASS** | Carried over from round 3/2, not re-run (branch diff vs main touches no backend, db or package files). |
| M2-05 | **PASS** | Carried over from round 3/2, not re-run (branch diff vs main touches no backend, db or package files). |
| M2-06 | **PASS** | Carried over from round 3/2, not re-run (branch diff vs main touches no backend, db or package files). |
| M2-07 | **PASS** | **R4 (24b631a):** re-run on the branch with the round-3 scripts, rating unchanged. Previous evidence (R3): Buyer page in the combined state (seed Maya): blurred hero/thumbs, title, seller name, price, file summary, Buy panel; legal footer. Screenshots `fe3-buyer-390.png`, `fe3-buy-validation-desktop.png`. |
| M2-08 | **PASS** | **R4 (24b631a):** re-run on the branch with the round-3 scripts, rating unchanged. Previous evidence (R3): No storage key / filename / `/original` in page, RSC payload or public API; anonymous `/original` 403 (`fe3-regress.log`). |
| M2-09 | **PASS** | **R4 (24b631a):** re-run on the branch with the round-3 scripts, rating unchanged. Previous evidence (R3): `X-Robots-Tag: noindex, nofollow` + `<meta robots noindex, nofollow, nocache>` on `/u/*` (also unknown link); `robots.txt` Disallows /u/ /api/ /dashboard; `/sitemap.xml` 404. |
| M2-10 | **BLOCKED** | Carried over from round 3/2, not re-run (branch diff vs main touches no backend, db or package files). |
| M2-11 | **PASS** | Carried over from round 3/2, not re-run (branch diff vs main touches no backend, db or package files). |
| M2-12 | **BLOCKED** | **R4 (24b631a):** re-run on the branch with the round-3 scripts, rating unchanged. Previous evidence (R3): No buyer download flow exists to test (the sale succeeds, nothing is delivered). Unchanged: Payments/Backend. |
| M2-13 | **BLOCKED** | Carried over from round 3/2, not re-run (branch diff vs main touches no backend, db or package files). |
| M2-14 | **BLOCKED** | **R4:** no download page (404s unchanged); DownloadPanel is not routed. BLOCKED. |
| M2-15 | **BLOCKED** | **R4 (24b631a):** re-run on the branch with the round-3 scripts, rating unchanged. Previous evidence (R3): Signed-URL expiry carried from R2; receipt link that mints a fresh URL does not exist. |
| M2-16 | **BLOCKED** | **R4 (24b631a):** re-run on the branch with the round-3 scripts, rating unchanged. Previous evidence (R3): No download-attempt counter / purchase concept. |
| M2-17 | **PASS** | **R4 (24b631a):** re-run on the branch with the round-3 scripts, rating unchanged. Previous evidence (R3): Default-limits instance: 80 bad-signature requests from one IP → 403×60, 429×20; second IP still 403 (`fe3-misc.log`). |
| M2-18 | **PASS** | **R4 (24b631a):** re-run on the branch with the round-3 scripts, rating unchanged. Previous evidence (R3): 390×844 and 360×800 (touch, DPR 2): landing, signup, login, forgot, terms, `/u/<id>`, unavailable page, dashboard, drops, new drop, and Ned's dashboard with the negative-balance alert: no horizontal scroll; Buy button ≥44 px touch target (`fe3-regress.log`; `f |
| M2-19 | **PASS** | **R4 (24b631a):** re-run on the branch with the round-3 scripts, rating unchanged. Previous evidence (R3): Throttled 4G (9 Mbit/s, 170 ms RTT, 4× CPU, cache off), 3 runs: Buy button visible 304–325 ms, FCP 708–772 ms, load ≈0.92–0.95 s (`fe3-misc.log`). |
| M3-01 | **PASS** | **R4 (24b631a):** re-run on the branch with the round-3 scripts, rating unchanged. Previous evidence (R3): Guest checkout, no login/account prompt: Buy → email + 18+ → redirected to the hosted card page `/pay/mock/<session>` which shows the card form (UI desktop + 390 mobile, `fe3-buy.log`; `fe3-hosted-page.png`). Real processor-hosted fields still need a real prov |
| M3-02 | **PARTIAL** | **R4:** PARTIAL as before: payment -> webhook-driven `succeeded` + 3 pending ledger lines OK; "redirect to download page" half does not exist (hosted page offers only "Back to the drop"; copy no longer implies a download). |
| M3-03 | **PASS** | **R4 (24b631a):** re-run on the branch with the round-3 scripts, rating unchanged. Previous evidence (R3): Declined / insufficient funds / expired / bad CVC / garbage card: friendly text only (no codes), no succeeded tx, 0 ledger lines, same session retryable with a good card (`fe3-fees.log`; UI check in `fe3-buy.log`). |
| M3-04 | **BLOCKED** | **R4 (24b631a):** re-run on the branch with the round-3 scripts, rating unchanged. Previous evidence (R3): No 3-D Secure in the mock processor (5 card outcomes); needs a real sandbox. Owner: Payments. |
| M3-05 | **PASS** | **R4 (24b631a):** re-run on the branch with the round-3 scripts, rating unchanged. Previous evidence (R3): $20.00 → platform $2.00, processing $2.40, net $15.60, integer cents; ledger sum = net (`fe3-fees.log`). |
| M3-06 | **PASS** | **R4 (24b631a):** re-run on the branch with the round-3 scripts, rating unchanged. Previous evidence (R3): $1.00, $1.01, $9.99, $49.99, $123.45, $500.00: platform + processing + net = gross exactly; ledger sum = net. |
| M3-07 | **PASS** | **R4 (24b631a):** re-run on the branch with the round-3 scripts, rating unchanged. Previous evidence (R3): `platform_settings.fee_percent` 10→15 via SQL: new sale platform $3.00, earlier sale unchanged $2.00, no deploy (no admin UI: M5-13). |
| M3-08 | **BLOCKED** | **R4 (24b631a):** re-run on the branch with the round-3 scripts, rating unchanged. Previous evidence (R3): Needs a real processor account / live $1 charge. |
| M3-09 | **PASS** | **R4 (24b631a):** re-run on the branch with the round-3 scripts, rating unchanged. Previous evidence (R3): New sale pending (7 d), 3 ledger lines available_at = created_at + 7 days; boundary now±1 s/µs flips exactly; live flip observed at ≈3.3 s for a +3 s entry; refund inside the hold reduces pending, not available (`fe3-boundary.log`, 20 checks). |
| M3-10 | **PASS** | **R4 (24b631a):** re-run on the branch with the round-3 scripts, rating unchanged. Previous evidence (R3): Unsigned, bad-signature and tampered-body webhooks → 401, transaction stays pending (`fe3-webhook.log`, `fe3-buyerr.log` §D). |
| M3-11 | **PASS** | **R4 (24b631a):** re-run on the branch with the round-3 scripts, rating unchanged. Previous evidence (R3): Same signed `sale.succeeded` ×3 → 200/200/200, one `sale_credit`; second event id for the same sale → still one credit. |
| M3-12 | **NOT RUN** | **R4 (24b631a):** re-run on the branch with the round-3 scripts, rating unchanged. Previous evidence (R3): Not re-run in this FE round (Payments R5: PASS). |
| M3-13 | **BLOCKED** | **R4:** buyer copy no longer promises a receipt (label "Email"), but there is still no receipt email (0 mail files after a paid sale; only a reset-password mail template exists). Marketing FAQ still says "we can send a receipt" (FE-14 residual). Stays BLOCKED: Backend/Payments. |
| M3-14 | **BLOCKED** | **R4:** still no receipt link / re-access route (`/receipt`, `/orders`, `/download`, `/api/receipts/orders/downloads` all 404). BLOCKED: Backend/Payments. |
| M3-15 | **PASS** | **R4 (24b631a):** re-run on the branch with the round-3 scripts, rating unchanged. Previous evidence (R3): `confirmOver18` missing/false/`"true"`/1/null → 400 server-side (API, not just UI); UI blocks the submit and shows 'Please confirm to continue.'; `buyer_confirmed_18_at` stored (`fe3-buy.log`). |
| M3-16 | **PASS** | **R4 (24b631a):** re-run on the branch with the round-3 scripts, rating unchanged. Previous evidence (R3): Default limits: 10 checkouts then 429 `Retry-After: 60` (4/4); UI shows disabled button with countdown 'Try again in 59s' + 'You can try again in 59 seconds.', re-enables when it ends; single buyer unaffected (`fe3-buyerr.log` §C; `fe3-buy-real429.png`). |
| M3-17 | **BLOCKED** | **R4 (24b631a):** re-run on the branch with the round-3 scripts, rating unchanged. Previous evidence (R3): No Stripe/PayPal in src/scripts/lib/components/package.json/README (only a substring inside the common-passwords list) ✔; CCBill/Segpay not chosen/integrated (README documents the provider hook). Owner: Payments. |
| M3-18 | **PASS** | **R4 (24b631a):** re-run on the branch with the round-3 scripts, rating unchanged. Previous evidence (R3): Re-run on the new BuyPanel: final-sale text + 18+/Terms checkbox before Buy, and again on the hosted page (`fe3-buy-validation-desktop.png`, `fe3-hosted-page.png`). |
| M3-19 | **BLOCKED** | **R4 (24b631a):** re-run on the branch with the round-3 scripts, rating unchanged. Previous evidence (R3): Hosted fields need a real processor. The 'no card data stored/logged' half PASSES: PAN/CVC absent from `pg_dump --data-only` and from server logs after declined + approved cards; no card-like column in any table; secrets absent too (`fe3-leak-scan.log`). |
| M3-20 | **BLOCKED** | **R4:** still no download end of the flow; buyer copy now says "Access after payment ... Delivery options are coming soon." Open-link-to-paid ≈0.4 s scripted. BLOCKED. |
| M4-01 | **BLOCKED** | Carried over from round 3/2, not re-run (branch diff vs main touches no backend, db or package files). |
| M4-02 | **BLOCKED** | Carried over from round 3/2, not re-run (branch diff vs main touches no backend, db or package files). |
| M4-03 | **BLOCKED** | Carried over from round 3/2, not re-run (branch diff vs main touches no backend, db or package files). |
| M4-04 | **BLOCKED** | Carried over from round 3/2, not re-run (branch diff vs main touches no backend, db or package files). |
| M4-05 | **BLOCKED** | Carried over from round 3/2, not re-run (branch diff vs main touches no backend, db or package files). |
| M4-06 | **PASS** | **R4 (24b631a):** re-run on the branch with the round-3 scripts, rating unchanged. Previous evidence (R3): Re-run: pending seller publish 403, checkout on its draft 404, checkout when seller becomes `manual_review` after page load → 409 with friendly UI notice (`fe3-buyerr.log` §B). |
| M4-07 | **BLOCKED** | Carried over from round 3/2, not re-run (branch diff vs main touches no backend, db or package files). |
| M4-08 | **BLOCKED** | Carried over from round 3/2, not re-run (branch diff vs main touches no backend, db or package files). |
| M4-10 | **BLOCKED** | **R4:** units/revenue per drop are now correct and refund/chargeback-aware (Maya 21/$252 + 6/$140 + 4/$32 = $424.00 = ledger gross kept; 69 edge-case checks; detail page agrees). Stays BLOCKED: views and conversion are not tracked anywhere (Frontend/Backend); FE-16 note on Sold semantics. |
| M4-11 | **BLOCKED** | **R4 (24b631a):** re-run on the branch with the round-3 scripts, rating unchanged. Previous evidence (R3): Still no transaction-history page (`/dashboard/transactions/sales` 404, no buyer country). `GET /api/earnings.recent` (20 rows) exists but isn't rendered. Frontend lists this as still open. |
| M4-12 | **BLOCKED** | Carried over from round 3/2, not re-run (branch diff vs main touches no backend, db or package files). |
| M4-13 | **BLOCKED** | **R4 (24b631a):** re-run on the branch with the round-3 scripts, rating unchanged. Previous evidence (R3): No seller payout route/UI (`POST /api/payouts*` 404). Service rejects <$25 (`below_minimum_payout`) and the dashboard hint says 'Payouts start at $25.00' (`fe3-payout-ui.log`); Payments R5 PASS (service). |
| M4-14 | **PASS** | **R4 (24b631a):** re-run on the branch with the round-3 scripts, rating unchanged. Previous evidence (R3): (service + dashboard) only post-hold funds are Available; entries inside the hold are Pending; eligibility flag follows min payout (`fe3-boundary.log`, `fe3-payout-ui.log`). |
| M4-15 | **BLOCKED** | **R4 (24b631a):** re-run on the branch with the round-3 scripts, rating unchanged. Previous evidence (R3): No payout routes/screens. Through the service the dashboard follows requested→approved→paid correctly: In payout +$30, Available −$30, then Paid out +$30 (`fe3-payout-ui.log`). |
| M4-16 | **BLOCKED** | **R4 (24b631a):** re-run on the branch with the round-3 scripts, rating unchanged. Previous evidence (R3): Failed payout returns funds and the dashboard follows (Available restored); no admin screen to see it. |
| M4-17 | **BLOCKED** | **R4 (24b631a):** re-run on the branch with the round-3 scripts, rating unchanged. Previous evidence (R3): Still blocked: `PATCH/PUT /api/auth/me` 405, no profile/settings UI (`fe3-blocked-probes.log`). Frontend lists this as still open. |
| M4-18 | **PASS** | **R4 (24b631a):** re-run on the branch with the round-3 scripts, rating unchanged. Previous evidence (R3): Scripted signup → verification stand-in (DB) → new drop one-step upload+publish → live link in 1.3 s (`fe3-journey.log`); well under 15 min. |
| M5-01 | **BLOCKED** | Carried over from round 3/2, not re-run (branch diff vs main touches no backend, db or package files). |
| M5-02 | **BLOCKED** | Carried over from round 3/2, not re-run (branch diff vs main touches no backend, db or package files). |
| M5-03 | **BLOCKED** | Carried over from round 3/2, not re-run (branch diff vs main touches no backend, db or package files). |
| M5-04 | **BLOCKED** | Carried over from round 3/2, not re-run (branch diff vs main touches no backend, db or package files). |
| M5-05 | **BLOCKED** | Carried over from round 3/2, not re-run (branch diff vs main touches no backend, db or package files). |
| M5-06 | **BLOCKED** | Carried over from round 3/2, not re-run (branch diff vs main touches no backend, db or package files). |
| M5-07 | **PASS** | **R4:** re-verified; negative balance copy now accurate (FE-12) and alert is danger/role=alert (FE-13); netting by new sales still works (`fe4-ned-netting.log`). |
| M5-08 | **PASS** | **R4 (24b631a):** re-run on the branch with the round-3 scripts, rating unchanged. Previous evidence (R3): Chargeback webhook (+$5 fee) shown on the dashboard as 'charged back' separate from refunds, fee named in the reconciliation line; also with the chargeback inside the hold window (`fe3-cbhold.log`). Flagging/review: Payments R5. |
| M5-09 | **BLOCKED** | Carried over from round 3/2, not re-run (branch diff vs main touches no backend, db or package files). |
| M5-10 | **BLOCKED** | Carried over from round 3/2, not re-run (branch diff vs main touches no backend, db or package files). |
| M5-11 | **BLOCKED** | Carried over from round 3/2, not re-run (branch diff vs main touches no backend, db or package files). |
| M5-12 | **BLOCKED** | Carried over from round 3/2, not re-run (branch diff vs main touches no backend, db or package files). |
| M5-13 | **BLOCKED** | Carried over from round 3/2, not re-run (branch diff vs main touches no backend, db or package files). |
| M5-14 | **BLOCKED** | Carried over from round 3/2, not re-run (branch diff vs main touches no backend, db or package files). |
| M5-15 | **BLOCKED** | Carried over from round 3/2, not re-run (branch diff vs main touches no backend, db or package files). |
| M5-16 | **BLOCKED-ON-LEGAL** | **R4:** BLOCKED-ON-LEGAL (unchanged; placeholders still "Coming soon", X-Robots-Tag + legal links intact, `/2257` 404). Not counted as FAIL; nobody messaged. |
| M5-17 | **BLOCKED** | Carried over from round 3/2, not re-run (branch diff vs main touches no backend, db or package files). |
| M5-18 | **BLOCKED** | Carried over from round 3/2, not re-run (branch diff vs main touches no backend, db or package files). |
| M5-19 | **BLOCKED** | Carried over from round 3/2, not re-run (branch diff vs main touches no backend, db or package files). |
| M5-20 | **PASS** | **R4 (24b631a):** re-run on the branch with the round-3 scripts, rating unchanged. Previous evidence (R3): Re-scan of landing, auth, legal placeholders, buyer page, unavailable page, hosted checkout page, og/twitter tags: no adult-market wording; the 18+ confirmation text is neutral (`fe3-misc.log`). |
| M6-01 | **NOT RUN** | Carried over from round 3/2, not re-run (branch diff vs main touches no backend, db or package files). |
| M6-02 | **PASS** | **R4 (24b631a):** re-run on the branch with the round-3 scripts, rating unchanged. Previous evidence (R3): All 6 security headers on `/`, `/login`, `/terms`, `/u/*`, `/api/earnings`, `/dashboard`; CSP without `unsafe-eval`; 5 secret values absent from the 27 client-bundle files and rendered HTML; mock endpoints 404/503 when the mock is disabled. |
| M6-03 | **NOT RUN** | Carried over from round 3/2, not re-run (branch diff vs main touches no backend, db or package files). |
| M6-04 | **BLOCKED** | Carried over from round 3/2, not re-run (branch diff vs main touches no backend, db or package files). |
| M6-05 | **BLOCKED** | Carried over from round 3/2, not re-run (branch diff vs main touches no backend, db or package files). |
| M6-06 | **BLOCKED** | Carried over from round 3/2, not re-run (branch diff vs main touches no backend, db or package files). |
| M6-07 | **PASS** | **R4 (24b631a):** re-run on the branch with the round-3 scripts, rating unchanged. Previous evidence (R3): Manifest valid, `/icons/icon-192.png` and `icon-512.png` 200 image/png (the og/twitter image is the 512 icon). |
| M6-08 | **BLOCKED** | Carried over from round 3/2, not re-run (branch diff vs main touches no backend, db or package files). |
| M6-09 | **BLOCKED** | Carried over from round 3/2, not re-run (branch diff vs main touches no backend, db or package files). |
| M6-10 | **BLOCKED** | Carried over from round 3/2, not re-run (branch diff vs main touches no backend, db or package files). |
| S2-01 | **PASS** | **R4 (24b631a):** re-run on the branch with the round-3 scripts, rating unchanged. Previous evidence (R3): = M4-18 (1.3 s scripted). |
| S2-02 | **BLOCKED** | **R4:** = M3-20, BLOCKED. |
| S2-03 | **PASS** | **R4 (24b631a):** re-run on the branch with the round-3 scripts, rating unchanged. Previous evidence (R3): = M3-07. |
| S2-04 | **PASS** | **R4 (24b631a):** re-run on the branch with the round-3 scripts, rating unchanged. Previous evidence (R3): = M2-03 / M4-06. |
| S2-05 | **BLOCKED** | **R4 (24b631a):** re-run on the branch with the round-3 scripts, rating unchanged. Previous evidence (R3): Trace works up to the ledger (tx → `webhook_events` row `sale_succeeded/processed` → 3 ledger lines posted via that event → dashboard), but no receipt exists (`fe3-journey.log`). |

## Reproducing
```
git worktree add --detach /workspace/qa-fe4 24b631a && cd /workspace/qa-fe4 && npm ci      # main baseline: same with 206320e
# .env: DATABASE_URL (throwaway), fresh secrets, MAIL_DEV_DIR, PAYMENT_WEBHOOK_SECRET, MOCK_PAYMENTS_ENABLED=1
set -a; . ./.env; set +a; unset NODE_ENV; npm run migrate && npx tsc --noEmit && npm run lint && npm test && NEXT_DIST_DIR=.next-qa npm run build
BASE_URL=http://localhost:4401 npx tsx scripts/seed-demo.ts                                  # Maya / Ned / Sam / Jo
# env for scripts: BASE SEED DB WT OUT IMG BASE_NOMOCK BASE_LIM MAIL_DIR SEEDJSON (+ BASE_URL for .ts)
node qa/scripts/qa-fe4-earnings.mjs; node qa/scripts/qa-fe4-fe1213.mjs   # CBEMAIL from qa-fe4-cbhold.ts
npx tsx qa/scripts/qa-fe4-perdrop-edge.ts; node qa/scripts/qa-fe4-fe14.mjs; node qa/scripts/qa-fe4-copyaudit.mjs
A=http://localhost:4411 B=http://localhost:4401 SA=seedm.json SB=seed.json bash qa/scripts/qa-fe4-headers-diff.sh
```
Other scripts are the round-3 suite renamed `qa-fe4-*` (fixes, buy, buyerr, back, fees, journey, misc, regress, reg-*, boundary, webhook, ned-netting, payout-ui, blocked). `qa-fe4-regress.mjs` expects Ned still negative: run it before `ned-netting`.

## Housekeeping
Servers :4400–4403 and :4411–4413 stopped; DBs `unveil_qa_fe4`, `unveil_qa_fe4m`, `unveil_e2e_qafe4` dropped; worktrees `/workspace/qa-fe4`, `/workspace/qa-fe4-main` and the push worktree removed; temp files removed. Scripts: `qa/scripts/qa-fe4-*`; evidence: `qa/artifacts/fe4/` (logs, seeds not committed, screenshots `fe4-*.png`, baseline logs in `main/`).
