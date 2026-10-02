# Unveil QA results — PR #6 `frontend/copy-sweep` (round "FE5": verification of FE-14R / FE-16 / role=status / copy-guard)

- **Date:** 2026-10-01, ≈22:30–00:10 ET.
- **Branch / SHA tested:** `origin/frontend/copy-sweep` @ **`6c22f05c96488b8761467361335f86dfa54b4748`** (PR https://github.com/unveil-link/Unveil.link/pull/6, not merged), 2 commits (`1add993`, `6c22f05`) on `origin/main` @ **`82a68b5`** (= merge of PR #5). QA base `origin/qa/test-plan` @ 5042fe4.
- **Env:** Node 20.19.2, PostgreSQL 17, headless Google Chrome (playwright-core, `--no-sandbox`). Worktrees `/workspace/qa-fe5` (branch) and `/workspace/qa-fe5-main` (main), removed at the end. Throwaway DBs `unveil_qa_fe5`, `unveil_qa_fe5m`, `unveil_e2e_qafe5`. Production builds (`NEXT_DIST_DIR=.next-qa`), ports 4500–4504 (branch) and 4511–4513 (main).
- **Rules followed:** no app code modified (the build only appends `.next-qa` includes to `tsconfig.json` in the throw-away worktree); nothing pushed to `main`, lane branches or `frontend/copy-sweep`; push only to `qa/test-plan` (rebased, no force). M5-16 stays BLOCKED-ON-LEGAL; nobody was messaged.

## Verdict
**FE-14R is FIXED for every item on the list, FE-16 is FIXED (labels, note, Gross hint; numbers unchanged), `BuyForm.tsx` is gone, the corrected fee-timing FAQ answer is accurate. No regression vs main, and nothing under `src/server`, `src/app/api`, `db`, money/pricing/ledger/payout files or package files changed.** Open items (none blocks merge of this copy-only PR, but FE-17 means the landing page still makes seller-side claims that are not true today):
- **FE-17 (Medium):** the *corrected* "How do I get paid?" FAQ answer is still inaccurate/unverifiable; "Payouts straight to your bank" and "photos and videos" are not true today.
- **FE-18 (Low–Medium, test quality):** `tests/copy-guard.test.ts` gives false confidence — 12 of 17 meaningful injected promises bypass it, including a re-insert of the ORIGINAL AuthShell "Instant delivery" line.
- **FE-19 (Low, copy):** BuyerTrust "Private links — each payment link is private to the creator who shares it" is incoherent.

| Item | Verdict | One-line evidence |
|---|---|---|
| **FE-14R** wording on all listed places | **FIXED ✔** | Hero, PaymentLinkMock badge/button/aria-label, HowItWorks, BuyerTrust, FAQ, AuthShell, layout.tsx meta, buyer line, TrustPoints: 31 pages (incl. collapsed FAQ, meta/og/twitter, aria/alt/title, mail) leave only the 4 hits Frontend named — all acceptable (table below). `fe5-copyaudit-copy-sweep.log`, `fe5-copy.log` 95 OK / 0 FAIL, `fe5-grep-ui.txt` |
| Dead `BuyForm.tsx` | **deleted ✔** | `rg BuyForm src components` → none; still mentioned in backend doc `PAYMENTS-NOTES.md` (INFO) |
| FAQ fee timing ("What does it cost?") | **accurate ✔** | fees are taken at sale time (ledger `sale_credit`+`platform_fee`+`processing_fee`), old "only when you get paid" is gone |
| FAQ "How do I get paid?" | **✘ inaccurate / unverifiable (FE-17)** | sales show as *Pending* immediately (not "after a hold"); "payments partner" does not exist; payouts are record-only; no seller request path |
| **FE-16** labels / note / Gross hint | **FIXED ✔** | "Sold (net)", "Revenue (kept)" + tooltips + reversal note on list (desktop table, 390 px cards) and detail; Gross hint "$622.00 · 43 sales charged, before refunds" = API `salesCount`; sums == API kept == ledger for Maya, Ned, Sam, never-paid chargeback seller |
| alert `role=status`, still red | **OK ✔ (INFO)** | `role=status`, danger classes kept, contrast 16.0:1 text / 4.9:1 icon, `getByRole('alert')` count 0; polite instead of assertive = intentional downgrade |
| copy-guard test | **weak (FE-18)** | `fe5-guard-mutation.log`; e2e `[copy-sweep]` is better but regex-only, no hosted page/dashboard/email |
| Diff vs main | **as claimed ✔** | 17 non-screenshot files (+64 screenshots); none of `src/server`, `src/app/api`, `db`, `package*.json`, `lib/earnings.ts`, `seed-demo.ts`, `next.config.ts` |
| Headers vs main (41 routes, GET/POST, anon + logged in) | **identical ✔** | `fe5-headers-diff.txt`: `Cache-Control: no-store` on `/api/earnings`, X-Robots-Tag on legal pages and `/u/*`, 6 security headers |
| Regression suite vs main | **no regression ✔** | table below |

## Counts (106 plan rows; ratings unchanged from round 4)
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

No rating changes. Notes updated on M4-09, M4-10, M3-13, M3-14, M3-20, M2-14, S2-02, M3-02, M5-07, M5-16 (plan table `qa/unveil-v1-test-plan.md`).

## Suite results
| Check | Branch 6c22f05 | Main 82a68b5 |
|---|---|---|
| `npm ci` / migrate / `npx tsc --noEmit` / `npm run lint` | OK / 001–012 / clean / clean (rc 0) | n/a |
| `npm run build` | OK | OK |
| `npm test` | **246/246** (14 files, incl. `copy-guard.test.ts`) | n/a (Frontend: 242) |
| `npm run e2e` | **84/84** incl. `[copy-sweep]` (`fe5-e2e-run1.log`, proof db reverted) | n/a |
| fixes / buy / buyerr / back / fees / journey / misc / regress | 90 / 67 / 18 / 2 / 16 / 4 / 9 / 55 OK, 0 FAIL | 90 / 67 / 18 / 2 / 16 / 4 / 9 / 55 OK, 0 FAIL |
| reg-modal / reg-duration / reg-meta / boundary | 52 / 93 / 17 / 20 OK | reg-meta 17 OK |
| webhook (signature, replay/idempotency, rejects) | 6 OK | 6 OK |
| earnings (§ incl. per-drop, API == UI == ledger) | **115 OK / 0 FAIL** | 113 OK + 2 FAIL — **seed-state artefact**: the main DB had the buy/regress suites run first so Maya shows $555.00 ≠ clean-seed $424.00 (per-drop sum still == API kept == ledger on main, `main-earnings.log` l.111); not a behavioural difference |
| fe1213 (balance-owed copy, alert) | 34 OK (expects `role=status`) | 28 OK + 6 FAIL = expected: main has `role=alert` |
| copy (new FE-14R/FE-16 checks, `qa-fe5-copy.mjs`) | **95 OK / 0 FAIL** | 34 OK + 61 FAIL = expected: main still has the old wording (baseline evidence) |
| perdrop-edge / dropdetail / ned-netting / payout-ui | 69 / 6 / 3 / 7 OK | n/a (labels adapted to "Sold (net)"/"Revenue (kept)") |
| overflow (320/360/390/768/1280 px × landing, auth, buyer, dashboard, drops) | 0 px overflow everywhere except landing @320 px = 1 px | same 1 px on main (pre-existing) |
| headers diff (41 routes) | identical to main | |

Covered by those suites (all 0 FAIL): buy flow with mock payments, validation errors, idempotency (duplicate webhook/checkout), webhook signature, XSS/escaping on dashboard + buyer page, og/twitter tags (`/u/<id>`), auth/ownership (other seller's drop, draft link 404), legal links on 10 pages, X-Robots-Tag, `Cache-Control: no-store` on `/api/earnings`, 429 messages (checkout, file upload; 58-min upload message).

## Per-item evidence

### 1. FE-14R copy audit — leftover hits and judgement
Method: `qa-fe5-copyaudit.mjs` (rendered text incl. collapsed `<details>`, `<meta>`/og/twitter, aria/alt/title, manifest, robots, mail dir) over 31 pages/states + independent source grep (`fe5-grep-ui.txt`) over `src/app`, `components`, `lib`, `src/server` (emails, error strings), `public`, `next.config.ts`. Main baseline: 35 pages/states contain "instantly/Instant/download/receipt" promises (`main-copyaudit.log`).

| Leftover hit | Where | Judgement |
|---|---|---|
| "Delivery options are coming soon." (×3) | BuyerTrust / TrustPoints / FAQ line | **Acceptable.** It explicitly says delivery is not available yet; promises nothing. (Caveat: it implies delivery will exist — fine, but must be removed/updated when delivery lands.) |
| `/design` DownloadPanel showcase ("Download", "Your download links are private…", "Not wired yet") | `components/design/DesignExtras.tsx`, `components/buyer/DownloadPanel.tsx` | **Acceptable.** Returns 404 unless `ENABLE_DESIGN_PAGE=1` (dev flag, off by default), panel itself is unrouted and labelled "Not wired yet". INFO: the flagged page sent no `X-Robots-Tag` — irrelevant while 404 in prod. |
| "Publishing unlocks once your identity is verified." | seller dashboard (pending/empty seller) | **Acceptable.** Seller-side, about the publish gate (`verification_status`), not buyer delivery. (Whether "identity verified" is real is FE-17.) |
| "They're added to this drop right away." | seller upload UI (drop detail/draft) | **Acceptable.** Seller-side, describes the upload being attached to the draft; true. |
| "Becomes available right away" (balance-card hint, `dashboard/page.tsx:97`) | dashboard source; rendered only if `holdDays` = 0 (default 7 → "Becomes available 7 days after each sale") | **Acceptable.** Seller-side, conditional, not buyer-facing. |
| "Enter the email you signed up with and we'll send you a reset link." / "Nothing in your inbox?" | `/forgot-password` | **Acceptable.** A real email exists (`src/server/services/password-reset.ts`, dev mail dir verified) and is the only email template; it contains no buyer promise. |
| `DownloadIcon` identifiers, `PAYMENTS-NOTES.md` ("BuyForm", "Unlock for $X") | source / backend doc | **Acceptable / INFO.** Not user-visible; doc is stale (Backend). |

Nothing else: no "instant", "right away", "straight away", "immediately", "receipt", "backup link", "signed link", "unlock after purchase" for buyers on any page, meta description, og/twitter, aria-label, hosted `/pay/mock` page (before and after payment), buyer page (also with validation errors), unavailable/draft page, API error strings (`src/app/api`, `src/server`) or the reset email. Buyer page line is now "Previews are blurred. Access to the full files is shared once your payment is confirmed." (`u/[linkId]/page.tsx`) — no "unlock"/instant wording; it is a *soft* statement that access will be shared (no mechanism exists yet), same class as TrustPoints "Access after payment — Once your payment is confirmed, we'll share how…" and "Delivery options are coming soon" → judged **acceptable** (INFO-g: re-word when delivery is still absent at launch).

### 2. Seller-side claims vs reality (`qa-fe5-sellerclaims.sh`, `fe5-sellerclaims.log`, code)
Facts: default hold **7 days** (`holdDays: 7` in `/api/earnings`), minimum payout **$25.00** (`minPayoutCents: 2500`), platform fee **10 %**, processing fee % from the provider; fees are posted at **sale time** (`sale_credit`, `platform_fee`, `processing_fee` in the ledger); every new sale is shown in the dashboard immediately as **Pending**, **Available** only after the hold; payouts are **RECORD-ONLY** (`src/server/services/payouts.ts`: "no money moves"); there is **no seller payout route/UI** (`/api/payouts`, `/api/payouts/request`, `/api/earnings/payout`, `/dashboard/payouts` → 404 GET and POST), **no schedule** (`approvePayout` is an admin service function with no route), **no payments partner/bank/KYC integration** (only the mock processor; seller verification is a stub moved by `npm run verify-seller` / SQL); uploads accept JPG/PNG/WebP only (MP4 → 415 `invalid_image`).

| Claim (file) | Verdict | Reasoning |
|---|---|---|
| FAQ "What does it cost?" — platform + processing fees per sale | **Accurate** | fees are taken per sale, dashboard shows both lines; the old "fee only when you get paid" is fixed |
| FAQ "How do I get paid?" — "sales show up in your dashboard after a short hold period" | **INACCURATE** | they show immediately as Pending; the hold delays *Available*, not visibility |
| same — "Payouts are handled through our payments partner once your balance reaches the minimum payout" | **UNVERIFIABLE / currently false** | no partner, payouts record-only, seller cannot request one, no schedule. Only the **$25 minimum** and the **7-day hold** (not stated in the copy) are true |
| SellerCta "Payouts straight to your bank" (unchanged) | **Not true today** | no bank/partner/KYC integration, 7-day hold, no seller payout path ("straight" also contradicts the hold) |
| "Sell photos and videos" (layout meta, Hero, FAQ "What kinds of files") | **Not true** | MP4 upload → 415; upload UI itself says "JPG, PNG or WebP" |
| BuyerTrust "Verified creators: identity- and age-verified" | **Unverifiable** | publish gate on `verification_status` is real, but nothing verifies identity or age (no KYC) |
| "Payments are processed by a trusted payment provider. We never see or store your card number." | **Unverifiable** until a real provider exists | only the mock processor; the dev mock page does take a card number (disabled in production) |
| BuyerTrust "Private links — each payment link is private to the creator who shares it" | **Incoherent (FE-19)** | `/u/<id>` is reachable by anyone with the URL (unguessable, noindex) |
| "Pay only when you make a sale", "No subscriptions" | Accurate | |
| "Sales dashboard with simple analytics" | Mild | no views/conversion (M4-10) |
| Dashboard hint "Ready for a payout" / "Payouts start at $25.00" | INFO (pre-existing) | shown when `payoutEligible`, but no seller action exists |
| "Originals stay locked until a purchase is complete" | True for anonymous (403) | but no post-purchase unlock exists |

### 3. FE-16 (`qa-fe5-copy.mjs` §2, `qa-fe5-earnings.mjs`, `qa-fe5-perdrop-edge.ts`, `qa-fe5-dropdetail.mjs`; screenshots `fe5-drops-maya-desktop.png`, `fe5-drops-maya-390px.png`, `fe5-dashboard-ned-*.png`, `fe5-negative-cb-never-paid-out.png`)
- Gross card: "$622.00 · 43 sales charged, before refunds" (test-polluted seed) — the count equals API `salesCount`; on a clean seed Maya reads 33 sales / $467.00.
- Overview reversals line quotes the kept amount; equals API gross − refunded − charged back.
- Drops list: table headers "Sold (net)" / "Revenue (kept)" with tooltips (uppercase via CSS); 390 px cards labelled "Files / Sold (net) / Revenue (kept)"; the note text matches the claim; drop detail page shows the same labels and numbers.
- Sums: Maya Spring 21/$252.00 + Studio 6/$140.00 + Travel 4/$32.00 = **$424.00** = API gross − refunded − charged back = raw-ledger recompute; Ned 1 sale $60.00 charged, $0.00 kept (charged back; negative balance), Sam and the never-paid chargeback seller consistent; 69 edge cases (full/partial refunds, chargeback after payout, zero-sale drop) unchanged vs round 4.
- Numbers identical to main for the same DB state (only labels differ).

### 3b. role=status alert (`qa-fe5-fe1213.mjs`, 34 OK)
`[data-testid=negative-balance]` has `role="status"`, still `border-danger/30 bg-danger-soft`, visible (not aria-hidden), contrast 16.0:1 / icon 4.9:1, absent for positive balances, copy still accurate ("deducted from future earnings", no payout wording). `getByRole('alert')` = 0. INFO: `role=status` is polite, so an urgent debt is no longer announced assertively (round 4 INFO-b complained about verbosity; this is the trade-off Frontend chose).

### 4. copy-guard test review (`qa-fe5-guard-mutation.sh`, on a scratch copy; app untouched; `fe5-guard-mutation.log`)
Baseline passes. 18 mutations injected: **5 CAUGHT** (Hero "download instantly", layout meta, a promise added on another line of `dashboard/page.tsx`, two `lib/purchase-copy.ts` cases — the latter have their own test) and **13 BYPASS** (12 of the 17 meaningful ones; M18 `next.config.ts` is a no-op mutation, ignore):

| # | Mutation | Result | Why |
|---|---|---|---|
| M1 | re-insert the ORIGINAL AuthShell line "Instant delivery … delivered automatically" | **BYPASS** | line also contains `DownloadIcon`, which is the per-line `ALLOW` regex → the guard would NOT have caught the original bug |
| M2, M3 | "Instant download" on the `DownloadIcon` line in TrustPoints / BuyerTrust | BYPASS | same |
| M5, M6 | synonym promises ("we email you the files", "arrive in your inbox") | BYPASS | word-list regex, no synonyms |
| M7, M8 | `"In"+"stantly"`, `Downl&#111;ad` | BYPASS | source-level regex |
| M10, M11 | receipt promise added to the FAQ answer | BYPASS | the whole FAQ answer is one source line and it contains the allowlisted "Delivery options are coming soon" |
| M12 | `DownloadPanel.tsx` gains "Instant download" | BYPASS | file fully exempt |
| M16 | receipt promise in the password-reset email template | BYPASS | `src/server` not scanned |
| M17 | error string in `src/app/api` | BYPASS | `src/app/api` skipped |
| M4, M9, M13–M15 | Hero, layout meta, dashboard page, `purchase-copy` ×2 | CAUGHT | |

Coverage: unit guard scans only `components`, `lib`, `src/app` (not `src/server`, `src/app/api`, `public`, `next.config.ts`, docs, no rendering, so meta/og/aria are only checked where they are string literals in scanned files). The e2e `[copy-sweep]` check scans rendered HTML (visible text, meta/og/twitter, aria-labels) of landing (incl. collapsed FAQ), `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/u/<id>`; it does **not** cover `/pay/mock`, the dashboard, emails or API strings, and is regex-based (synonyms bypass). Conclusion: useful tripwire for the exact old strings, not a guarantee. Suggested fix (for Frontend): make `ALLOW` match the allowlisted *phrase* only (strip it, then re-test the line), scan `src/server` + `src/app/api`, drop the blanket `DownloadPanel` exemption, and add `/pay/mock` + dashboard to the e2e sweep.

### 5. Diff `origin/main..frontend/copy-sweep` (`fe5-diff-files.txt`, `fe5-diff-stat.txt`)
17 non-screenshot files: `components/{auth/AuthShell,buyer/TrustPoints,dashboard/DropList,landing/{BuyerTrust,Faq,Hero,HowItWorks,PaymentLinkMock}}.tsx`, `src/app/components/DropEditor.tsx`, `src/app/dashboard/page.tsx`, `src/app/layout.tsx`, `src/app/u/[linkId]/page.tsx`, **deleted** `src/app/u/[linkId]/BuyForm.tsx`, **new** `tests/copy-guard.test.ts`, `scripts/e2e.ts`, `scripts/screenshots-dashboard.mjs`, `docs/frontend-dashboard-notes.md` (+64 screenshots). **None** of `src/server/**`, `src/app/api/**`, `db/**`, money/pricing/ledger/payout files, `lib/earnings.ts`, `seed-demo.ts`, `next.config.ts`, `package.json`, `package-lock.json`.

## New bugs / findings
| ID | Sev | Finding | Exact repro |
|---|---|---|---|
| **FE-17** | **Medium** (copy; open) | Seller-side landing claims are inaccurate or unverifiable: FAQ "How do I get paid?" ("show up in your dashboard after a short hold period" — they show as Pending immediately; "handled through our payments partner" — no partner, payouts record-only, no seller request path, no schedule); SellerCta "Payouts straight to your bank" (no bank/partner/KYC, 7-day hold); "Sell photos and videos" (MP4 → 415); BuyerTrust "identity- and age-verified" (no KYC; verification is a stub). Owner: Frontend (copy) now; Payments/Backend for the real features. | open `/#faq` → "How do I get paid?" and the SellerCta perks; `bash qa/scripts/qa-fe5-sellerclaims.sh` (MP4 upload 415; `/api/payouts*` 404; `/api/earnings` → `holdDays:7`, `minPayoutCents:2500`); `src/server/services/payouts.ts` header "RECORD-ONLY" |
| **FE-18** | Low–Medium (test false confidence) | `tests/copy-guard.test.ts` per-line allowlist and scan scope let 12/17 meaningful injected promises through, incl. the original AuthShell "Instant delivery" line | `WT=/workspace/qa-fe5 bash qa/scripts/qa-fe5-guard-mutation.sh` (scratch copy; app untouched) |
| **FE-19** | Low (copy) | BuyerTrust "Private links — Each payment link is private to the creator who shares it" and FAQ "Are my files private?" read as if the link were restricted; `/u/<id>` is public to anyone with the URL | view `/` (BuyerTrust) and open the FAQ; `curl -s localhost:PORT/u/<id>` anonymously → 200 |
| INFO-a | Info | `PAYMENTS-NOTES.md` (backend doc) still describes `BuyForm` / "Unlock for $X" | `rg BuyForm PAYMENTS-NOTES.md` |
| INFO-b | Info | Dashboard hint "Ready for a payout" is shown but there is no way for the seller to request a payout (pre-existing) | Maya `/dashboard`; `/api/payouts` 404 |
| INFO-c | Info | Alert downgraded `role=alert` → `role=status` (intentional; no longer assertive) | Ned `/dashboard` |
| INFO-d | Info | `/design` (only with `ENABLE_DESIGN_PAGE=1`) still shows the DownloadPanel demo; 404 by default | `ENABLE_DESIGN_PAGE=1`, GET `/design` |
| INFO-e | Info | Landing overflows 1 px horizontally at 320 px (same on main); my clipped-element heuristic also flagged sr-only "Skip to content", truncated badges/emails — false positives | `node qa/scripts/qa-fe5-overflow.mjs` (`fe5-overflow.log`) |
| INFO-g | Info | Buyer page / TrustPoints now say access "is shared once your payment is confirmed" — soft promise with no delivery mechanism yet; acceptable, revisit before launch | `/u/<id>` |
| INFO-f | Info | Carried over: `POST /api/checkout` accepts `text/plain` (Origin check blocks cross-site); `%zz` path 500 (NEW-6) in `/u`, `/pay/mock`, `/dashboard/drops`; `/api/earnings.recent` not rendered; only the mock processor exists; over-refunds rejected with HTTP 200 | rounds 3–4 |

**Closed this round:** FE-14R (all listed items), FE-16, dead `BuyForm.tsx`, FAQ fee-timing claim.

## Still BLOCKED — on whom
- **Receipt email, receipt link, order/download routes, signed-URL delivery** (M2-12, M2-14..16, M3-13, M3-14, M3-20, S2-02): Backend/Payments first, then Frontend wires `DownloadPanel` and removes "Delivery options are coming soon".
- **Real processor / sandbox** (M3-04 3DS, M3-08, M3-17, M3-19 hosted fields, S2-05 beyond the ledger): Payments + provider account.
- **KYC / payout provider and payout routes/UI** (M4-01..05, M4-07, M4-08, M4-12, M4-13, M4-15, M4-16): Payments/Backend — also what FE-17's claims depend on.
- **Frontend-listed:** M4-10 (views/conversion not tracked), M4-11 (no transaction history), M4-17 (no profile/settings), M6-06 (status page).
- **Backend:** M2-10, M2-13, M1-06 (mp4), M1-09, M1-11, M1-14. **Admin / moderation / compliance:** M5-01..06, M5-09..15, M5-17..19, M6-04, M6-05, M6-08..10.
- **M5-16: BLOCKED-ON-LEGAL** — unchanged; nobody messaged. **Google OAuth (M1-02):** presence only.
- **NOT RUN:** M3-12, M6-01 (OWASP review), M6-03 (load test).

## Case-by-case results
| Case | Result | Evidence / notes |
|---|---|---|
| M4-09 | **PASS** | **R5 (6c22f05):** re-verified: dashboard == `GET /api/earnings` == ledger for Maya/Ned/Sam/never-paid seller at desktop and 390 px (115 OK). FE-16 FIXED (labels, note, Gross hint; numbers unchanged). |
| M1-01 | **PASS** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M1-02 | **PASS** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M1-03 | **PASS** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M1-04 | **PASS** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M1-05 | **PASS** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M1-06 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M1-07 | **PASS** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M1-08 | **PASS** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M1-09 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M1-10 | **PASS** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M1-11 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M1-12 | **PASS** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M1-13 | **PASS** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M1-14 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M2-01 | **PASS** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M2-02 | **PASS** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M2-03 | **PASS** | **R5 (6c22f05):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: Re-run: publish by pending-verification seller (Jo) → 403; checkout on that seller's draft → 404 (`fe3-misc.log`). |
| M2-04 | **PASS** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M2-05 | **PASS** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M2-06 | **PASS** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M2-07 | **PASS** | **R5 (6c22f05):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: Buyer page in the combined state (seed Maya): blurred hero/thumbs, title, seller name, price, file summary, Buy panel; legal footer. Screenshots `fe3-buyer-390.png`, `fe3-buy-validation-desktop.png`. |
| M2-08 | **PASS** | **R5 (6c22f05):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: No storage key / filename / `/original` in page, RSC payload or public API; anonymous `/original` 403 (`fe3-regress.log`). |
| M2-09 | **PASS** | **R5 (6c22f05):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: `X-Robots-Tag: noindex, nofollow` + `<meta robots noindex, nofollow, nocache>` on `/u/*` (also unknown link); `robots.txt` Disallows /u/ /api/ /dashboard; `/sitemap.xml` 404. |
| M2-10 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M2-11 | **PASS** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M2-12 | **BLOCKED** | **R5 (6c22f05):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: No buyer download flow exists to test (the sale succeeds, nothing is delivered). Unchanged: Payments/Backend. |
| M2-13 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M2-14 | **BLOCKED** | **R5:** no download page (404s unchanged); DownloadPanel is unrouted (only the flag-gated `/design` demo). BLOCKED. |
| M2-15 | **BLOCKED** | **R5 (6c22f05):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: Signed-URL expiry carried from R2; receipt link that mints a fresh URL does not exist. |
| M2-16 | **BLOCKED** | **R5 (6c22f05):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: No download-attempt counter / purchase concept. |
| M2-17 | **PASS** | **R5 (6c22f05):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: Default-limits instance: 80 bad-signature requests from one IP → 403×60, 429×20; second IP still 403 (`fe3-misc.log`). |
| M2-18 | **PASS** | **R5 (6c22f05):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: 390×844 and 360×800 (touch, DPR 2): landing, signup, login, forgot, terms, `/u/<id>`, unavailable page, dashboard, drops, new drop, and Ned's dashboard with the negative-balance alert: no horizontal scroll; Buy button ≥44 px touch target (`fe3-regress.log`; `f |
| M2-19 | **PASS** | **R5 (6c22f05):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: Throttled 4G (9 Mbit/s, 170 ms RTT, 4× CPU, cache off), 3 runs: Buy button visible 304–325 ms, FCP 708–772 ms, load ≈0.92–0.95 s (`fe3-misc.log`). |
| M3-01 | **PASS** | **R5 (6c22f05):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: Guest checkout, no login/account prompt: Buy → email + 18+ → redirected to the hosted card page `/pay/mock/<session>` which shows the card form (UI desktop + 390 mobile, `fe3-buy.log`; `fe3-hosted-page.png`). Real processor-hosted fields still need a real prov |
| M3-02 | **PARTIAL** | **R5:** PARTIAL unchanged: payment -> webhook -> `succeeded` + 3 pending ledger lines OK; the 'redirect to download page' half does not exist; hosted page offers only 'Back to the drop' and no copy implies a download (FE-14R FIXED). |
| M3-03 | **PASS** | **R5 (6c22f05):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: Declined / insufficient funds / expired / bad CVC / garbage card: friendly text only (no codes), no succeeded tx, 0 ledger lines, same session retryable with a good card (`fe3-fees.log`; UI check in `fe3-buy.log`). |
| M3-04 | **BLOCKED** | **R5 (6c22f05):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: No 3-D Secure in the mock processor (5 card outcomes); needs a real sandbox. Owner: Payments. |
| M3-05 | **PASS** | **R5 (6c22f05):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: $20.00 → platform $2.00, processing $2.40, net $15.60, integer cents; ledger sum = net (`fe3-fees.log`). |
| M3-06 | **PASS** | **R5 (6c22f05):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: $1.00, $1.01, $9.99, $49.99, $123.45, $500.00: platform + processing + net = gross exactly; ledger sum = net. |
| M3-07 | **PASS** | **R5 (6c22f05):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: `platform_settings.fee_percent` 10→15 via SQL: new sale platform $3.00, earlier sale unchanged $2.00, no deploy (no admin UI: M5-13). |
| M3-08 | **BLOCKED** | **R5 (6c22f05):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: Needs a real processor account / live $1 charge. |
| M3-09 | **PASS** | **R5 (6c22f05):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: New sale pending (7 d), 3 ledger lines available_at = created_at + 7 days; boundary now±1 s/µs flips exactly; live flip observed at ≈3.3 s for a +3 s entry; refund inside the hold reduces pending, not available (`fe3-boundary.log`, 20 checks). |
| M3-10 | **PASS** | **R5 (6c22f05):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: Unsigned, bad-signature and tampered-body webhooks → 401, transaction stays pending (`fe3-webhook.log`, `fe3-buyerr.log` §D). |
| M3-11 | **PASS** | **R5 (6c22f05):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: Same signed `sale.succeeded` ×3 → 200/200/200, one `sale_credit`; second event id for the same sale → still one credit. |
| M3-12 | **NOT RUN** | **R5 (6c22f05):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: Not re-run in this FE round (Payments R5: PASS). |
| M3-13 | **BLOCKED** | **R5:** FAQ no longer promises a receipt (FE-14R FIXED) but there is still no receipt email (0 mails after a paid sale). Stays BLOCKED: Backend/Payments. |
| M3-14 | **BLOCKED** | **R5:** still no receipt link / re-access route (`/receipt`, `/orders`, `/download`, `/api/receipts|orders|downloads` all 404). BLOCKED: Backend/Payments. |
| M3-15 | **PASS** | **R5 (6c22f05):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: `confirmOver18` missing/false/`"true"`/1/null → 400 server-side (API, not just UI); UI blocks the submit and shows 'Please confirm to continue.'; `buyer_confirmed_18_at` stored (`fe3-buy.log`). |
| M3-16 | **PASS** | **R5 (6c22f05):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: Default limits: 10 checkouts then 429 `Retry-After: 60` (4/4); UI shows disabled button with countdown 'Try again in 59s' + 'You can try again in 59 seconds.', re-enables when it ends; single buyer unaffected (`fe3-buyerr.log` §C; `fe3-buy-real429.png`). |
| M3-17 | **BLOCKED** | **R5 (6c22f05):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: No Stripe/PayPal in src/scripts/lib/components/package.json/README (only a substring inside the common-passwords list) ✔; CCBill/Segpay not chosen/integrated (README documents the provider hook). Owner: Payments. |
| M3-18 | **PASS** | **R5 (6c22f05):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: Re-run on the new BuyPanel: final-sale text + 18+/Terms checkbox before Buy, and again on the hosted page (`fe3-buy-validation-desktop.png`, `fe3-hosted-page.png`). |
| M3-19 | **BLOCKED** | **R5 (6c22f05):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: Hosted fields need a real processor. The 'no card data stored/logged' half PASSES: PAN/CVC absent from `pg_dump --data-only` and from server logs after declined + approved cards; no card-like column in any table; secrets absent too (`fe3-leak-scan.log`). |
| M3-20 | **BLOCKED** | **R5:** still no download end of the flow. Copy now says only 'Delivery options are coming soon' (not a promise). Open-link-to-paid scripted OK. BLOCKED. |
| M4-01 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M4-02 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M4-03 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M4-04 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M4-05 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M4-06 | **PASS** | **R5 (6c22f05):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: Re-run: pending seller publish 403, checkout on its draft 404, checkout when seller becomes `manual_review` after page load → 409 with friendly UI notice (`fe3-buyerr.log` §B). |
| M4-07 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M4-08 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M4-10 | **BLOCKED** | **R5:** per-drop 'Sold (net)' / 'Revenue (kept)' and the reversal note verified (Maya 21/$252 + 6/$140 + 4/$32 = $424.00; 69 edge-case + 6 detail-page checks OK). Stays BLOCKED: views and conversion are not tracked. |
| M4-11 | **BLOCKED** | **R5 (6c22f05):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: Still no transaction-history page (`/dashboard/transactions/sales` 404, no buyer country). `GET /api/earnings.recent` (20 rows) exists but isn't rendered. Frontend lists this as still open. |
| M4-12 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M4-13 | **BLOCKED** | **R5 (6c22f05):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: No seller payout route/UI (`POST /api/payouts*` 404). Service rejects <$25 (`below_minimum_payout`) and the dashboard hint says 'Payouts start at $25.00' (`fe3-payout-ui.log`); Payments R5 PASS (service). |
| M4-14 | **PASS** | **R5 (6c22f05):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: (service + dashboard) only post-hold funds are Available; entries inside the hold are Pending; eligibility flag follows min payout (`fe3-boundary.log`, `fe3-payout-ui.log`). |
| M4-15 | **BLOCKED** | **R5 (6c22f05):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: No payout routes/screens. Through the service the dashboard follows requested→approved→paid correctly: In payout +$30, Available −$30, then Paid out +$30 (`fe3-payout-ui.log`). |
| M4-16 | **BLOCKED** | **R5 (6c22f05):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: Failed payout returns funds and the dashboard follows (Available restored); no admin screen to see it. |
| M4-17 | **BLOCKED** | **R5 (6c22f05):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: Still blocked: `PATCH/PUT /api/auth/me` 405, no profile/settings UI (`fe3-blocked-probes.log`). Frontend lists this as still open. |
| M4-18 | **PASS** | **R5 (6c22f05):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: Scripted signup → verification stand-in (DB) → new drop one-step upload+publish → live link in 1.3 s (`fe3-journey.log`); well under 15 min. |
| M5-01 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M5-02 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M5-03 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M5-04 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M5-05 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M5-06 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M5-07 | **PASS** | **R5:** re-verified: Ned netting by new sales still works (`fe5-ned-netting.log`); alert is now `role=status`, danger-toned (INFO: polite instead of assertive). |
| M5-08 | **PASS** | **R5 (6c22f05):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: Chargeback webhook (+$5 fee) shown on the dashboard as 'charged back' separate from refunds, fee named in the reconciliation line; also with the chargeback inside the hold window (`fe3-cbhold.log`). Flagging/review: Payments R5. |
| M5-09 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M5-10 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M5-11 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M5-12 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M5-13 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M5-14 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M5-15 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M5-16 | **BLOCKED-ON-LEGAL** | **R5:** BLOCKED-ON-LEGAL (unchanged; placeholders, X-Robots-Tag and legal links intact; `/2257` 404). Not counted as FAIL; nobody messaged. |
| M5-17 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M5-18 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M5-19 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M5-20 | **PASS** | **R5 (6c22f05):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: Re-scan of landing, auth, legal placeholders, buyer page, unavailable page, hosted checkout page, og/twitter tags: no adult-market wording; the 18+ confirmation text is neutral (`fe3-misc.log`). |
| M6-01 | **NOT RUN** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M6-02 | **PASS** | **R5 (6c22f05):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: All 6 security headers on `/`, `/login`, `/terms`, `/u/*`, `/api/earnings`, `/dashboard`; CSP without `unsafe-eval`; 5 secret values absent from the 27 client-bundle files and rendered HTML; mock endpoints 404/503 when the mock is disabled. |
| M6-03 | **NOT RUN** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M6-04 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M6-05 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M6-06 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M6-07 | **PASS** | **R5 (6c22f05):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: Manifest valid, `/icons/icon-192.png` and `icon-512.png` 200 image/png (the og/twitter image is the 512 icon). |
| M6-08 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M6-09 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M6-10 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| S2-01 | **PASS** | **R5 (6c22f05):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: = M4-18 (1.3 s scripted). |
| S2-02 | **BLOCKED** | **R5:** = M3-20, BLOCKED. |
| S2-03 | **PASS** | **R5 (6c22f05):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: = M3-07. |
| S2-04 | **PASS** | **R5 (6c22f05):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: = M2-03 / M4-06. |
| S2-05 | **BLOCKED** | **R5 (6c22f05):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: Trace works up to the ledger (tx → `webhook_events` row `sale_succeeded/processed` → 3 ledger lines posted via that event → dashboard), but no receipt exists (`fe3-journey.log`). |

## Reproducing
```
git worktree add --detach /workspace/qa-fe5 6c22f05 && cd /workspace/qa-fe5 && npm ci      # main baseline: same with 82a68b5
# .env: DATABASE_URL (throwaway), fresh secrets, MAIL_DEV_DIR, PAYMENT_WEBHOOK_SECRET, MOCK_PAYMENTS_ENABLED=1
set -a; . ./.env; set +a; unset NODE_ENV; npm run migrate && npx tsc --noEmit && npm run lint && npm test && NEXT_DIST_DIR=.next-qa npm run build && npm run e2e
BASE_URL=http://localhost:4501 npx tsx scripts/seed-demo.ts                                  # Maya / Ned / Sam / Jo
# env for scripts: BASE BASE_NOMOCK BASE_LIM SEED SEEDJSON DB WT OUT IMG MAIL_DIR (+ BASE_URL for .ts, CBEMAIL from qa-fe5-cbhold.ts)
node qa/scripts/qa-fe5-earnings.mjs; node qa/scripts/qa-fe5-copy.mjs; node qa/scripts/qa-fe5-fe1213.mjs
npx tsx qa/scripts/qa-fe5-perdrop-edge.ts; node qa/scripts/qa-fe5-copyaudit.mjs; node qa/scripts/qa-fe5-overflow.mjs
WT=/workspace/qa-fe5 bash qa/scripts/qa-fe5-guard-mutation.sh; bash qa/scripts/qa-fe5-sellerclaims.sh
A=http://localhost:4511 B=http://localhost:4501 SA=seedm.json SB=seed.json bash qa/scripts/qa-fe5-headers-diff.sh
```
Other scripts are the round-4 suite renamed `qa-fe5-*` (fixes, buy, buyerr, back, fees, journey, misc, regress, reg-*, boundary, webhook, ned-netting, payout-ui, dropdetail, blocked). `qa-fe5-regress.mjs` expects Ned still negative: run it before `ned-netting`. Adapted this round: perdrop-edge/dropdetail accept "Sold (net)"/"Revenue (kept)"; fe1213 expects `role=status`. New: copy, guard-mutation, sellerclaims, overflow.

## Housekeeping
Servers :4500–4504 and :4511–4513 stopped; DBs `unveil_qa_fe5`, `unveil_qa_fe5m`, `unveil_e2e_qafe5` dropped; worktrees `/workspace/qa-fe5`, `/workspace/qa-fe5-main` and the push worktree removed; temp files removed. Scripts: `qa/scripts/qa-fe5-*`; evidence: `qa/artifacts/fe5/` (logs, screenshots `fe5-*.png`, baseline logs in `main/`; seeds not committed).
