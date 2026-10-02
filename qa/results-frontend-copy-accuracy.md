# Unveil QA results — PR #7 `frontend/copy-accuracy` (round "FE6": FE-17 seller claims, FE-19 link wording, FE-18 copy guard)

- **Date:** 2026-10-02, ≈05:45–06:30 ET.
- **Branch / SHA tested:** `origin/frontend/copy-accuracy` @ **`8681122`** (PR https://github.com/unveil-link/Unveil.link/pull/7, not merged), 2 commits (`b317522`, `8681122`) on `origin/main` @ **`7014c7e`** (= merge of PR #6). QA base `origin/qa/test-plan` @ 0a11de8.
- **Env:** Node 20.19.2, PostgreSQL 17, headless Google Chrome (playwright-core, `--no-sandbox`). Worktrees `/workspace/qa-fe6` (branch) and `/workspace/qa-fe6-main` (main), removed at the end. Throwaway DBs `unveil_qa_fe6`, `unveil_qa_fe6m`, `unveil_e2e_qafe6`; production builds (`NEXT_DIST_DIR=.next-qa`), ports 4600–4604 (branch; 4604 = `/design` flag check) and 4611–4613 (main).
- **Rules followed:** no app code modified (a build only appends `.next-qa` includes to `tsconfig.json`, and `npm run e2e` rewrites `proof/db.txt`; both reverted/never committed); nothing pushed to `main`, lane branches or `frontend/copy-accuracy`; push only to `qa/test-plan` (rebased, no force). M5-16 stays BLOCKED-ON-LEGAL; nobody was messaged.

## Verdict
**FE-17 is fixed for the landing page, FAQ, CTA, meta, dashboard hints and the video flag — every rewritten claim checked out against code and behaviour. FE-19 wording is accurate. The copy guard is much better (it now catches the ORIGINAL "Instant delivery" line and has a working backend ratchet) but is still a narrow tripwire. No regression vs main; nothing under `src/server`, `src/app/api`, `db`, money/pricing/ledger/payout files or package files changed.** New findings (none blocks merging this copy-only PR):
- **FE-20 (Low–Medium, copy):** the upload dropzone on `/dashboard/drops/new` and on every drop detail page still says **"JPG, PNG, WebP or MP4 · 10 files · 2 GB per drop"** and the file picker's `accept` still offers `video/mp4`/`.mp4`, although video upload is not available (415) and the PR claims video wording is driven by `VIDEO_UPLOAD=false`. `FileDropzone.tsx:64,88` ignore the flag. (Choosing an MP4 is then rejected client-side with "coming soon", so it is a contradiction, not a dead end.) Pre-existing on main; **the guard and e2e do not catch it** (no `mp4` rule).
- **FE-21 (Low–Medium, copy):** verification hints promise things that do not exist: *failed* → "Contact support to continue" (`/contact` is a "Coming soon." placeholder, no support channel), *in review* → "A person is reviewing your verification. We'll update this page." (nothing in `src/` sets `verification_status`; no admin verification queue; only `npm run verify-seller` / SQL).
- **FE-22 (Low, copy):** signup subtitle "Set up in a minute. **Start sharing paid links today.**" — a new seller is `pending`, cannot publish and has no way to become verified.
- **FE-18b (Low–Medium, test quality):** 17/18 of our old mutations are caught (was 5/18), but **35 of 42** new must-catch mutations of ours still bypass the guard (paraphrases, JSX-split words, CSS/`public/`/`.mjs`, language, a file-level skip, flag flips), and the guard passes today while FE-20 is live.

| Item | Verdict | One-line evidence |
|---|---|---|
| **FE-17** FAQ "How do I get paid?" | **FIXED ✔** | "Each sale is listed … as Pending. After a 7-day hold it becomes Available, and payouts start at $25. Payout requests and processing are coming soon." — each part verified (settings 7 d / 2500 ¢, sale shows Pending at once, `available_at` = sale + 7 d, no payout route) `fe6-claims.log` §A |
| FE-17 "What does it cost?" | **accurate ✔** | platform 10 % + processing 12 % posted at sale time (`sale_credit`, `platform_fee`, `processing_fee`); payouts only debit the requested amount (`fe6-payout-ui.log`) |
| FE-17 "Payouts straight to your bank" / payments partner | **removed ✔** | absent from every page, meta, hint |
| FE-17 video claims | **FIXED on marketing ✔ / ✘ dropzone (FE-20)** | landing, meta, FAQ, HowItWorks, mock card say "photos" / "video is coming soon"; main 7014c7e has no video upload and `backend/m2-media` is NOT merged (`git merge-base --is-ancestor origin/backend/m2-media origin/main` = no); `POST video/mp4` = 415 on main and branch ⇒ `VIDEO_UPLOAD=false` matches reality |
| FE-17 verification / age / processor claims | **accurate ✔ (marketing) / ✘ hints (FE-21, FE-22)** | "A seller must have a verified status before they can publish … badge only shows while that is the case": pending/failed/manual_review ⇒ badge hidden **and** checkout 409 `seller_not_verified`; publish 403; "does not store card numbers": a UI purchase with 4242… leaves no card number in pg_dump, storage, mail dir or server log |
| FE-17 hints "Ready for a payout"/"Sent to you so far" | **reworded ✔** | "You've reached the $25.00 minimum. Payout requests are coming soon" (only when `payoutEligible`), "Payouts marked as paid" / "No payouts yet" |
| **FE-19** link wording | **accurate ✔** | 12 chars base64url of 9 CSPRNG bytes = 72 bit; no listing/sitemap/profile/search route; `X-Robots-Tag: noindex, nofollow` + meta; robots Disallow; same 404 for unknown/draft/unpublished; no external links ⇒ no Referer leak; API probing 429s after 120/min |
| **FE-18** guard | **improved, still narrow (FE-18b)** | `fe6-guard-mutation-old.log` 17 caught / 1 bypass; `fe6-guard-mutation2.log` 7 caught / 35 bypass (+3 loophole probes, 3 correct non-user-facing passes) |
| FE-16/FE-15 numbers | **still reconcile ✔** | Maya, Ned, Sam, never-paid seller: Gross hint, reversal line, per-drop Sold (net)/Revenue (kept) == `/api/earnings` == ledger, desktop + 390 px (115 + 69 + 6 + 95 OK) |
| Diff vs main | **as claimed ✔** | 23 non-screenshot files (+50 screenshots); `lib/features.ts` new, `lib/upload-limits.ts` only wires `VIDEO_UPLOAD`; none of `src/server`, `src/app/api`, `db`, `package*.json`, `next.config.ts`, `lib/earnings.ts`, seed |
| Headers vs main (41 routes) | **identical ✔** | `fe6-headers-diff.txt`: `Cache-Control: no-store` on `/api/earnings`, X-Robots-Tag on legal + `/u/*`, 6 security headers |
| Regression vs main | **no regression ✔** | table below |

## Counts (106 plan rows; ratings unchanged from round 5)
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

No rating changes. Notes updated on M1-06, M2-03, M2-09, M2-14, M3-02, M3-13, M3-14, M3-20, M4-01, M4-09, M4-10, M4-13, M5-07, M5-16, M5-20, S2-02 (plan table `qa/unveil-v1-test-plan.md`).

## Suite results
| Check | Branch 8681122 | Main 7014c7e |
|---|---|---|
| `npm ci` / migrate / `npx tsc --noEmit` / `npm run lint` | OK / 001–012 / clean (after a build; Next's `LayoutProps` typegen, same on main) / clean | n/a |
| `npm run build` | OK | OK |
| `npm test` | **287/287** (15 files; incl. `copy-guard.test.ts`, `copy-guard-mutation.test.ts`) — `fe6-npm-test.log` | n/a (Frontend: 246) |
| `npm run e2e` | **84/84** incl. `[copy-sweep]` (`fe6-e2e-run1.log`; `proof/db.txt` saved as `fe6-e2e-proof-db-run1.txt`, then reverted) | n/a |
| fixes / buy / buyerr / back / fees / journey / misc / regress | 90 / 67 / 18 / 2 / 16 / 4 / 9 / 55 OK, 0 FAIL | 90 / 67 / 18 / 2 / 16 / 4 / 9 / 55 OK, 0 FAIL |
| reg-meta / reg-modal / reg-duration / boundary | 17 / 52 / 93 / 20 OK | reg-meta 17 OK |
| webhook (signature, replay/idempotency, rejects) | 6 OK | 6 OK |
| ned-netting / payout-ui | 3 / 7 OK | n/a |
| earnings (API == UI == ledger, per-drop) | **115 OK / 0 FAIL** (clean seed and a second clean seed) | 115 OK / 0 FAIL |
| perdrop-edge / dropdetail | 69 / 6 OK (both seeds) | n/a |
| fe1213 (balance owed copy, `role=status`, contrast) | 34 OK (both seeds) | 34 OK (main already has `role=status`) |
| copy (`qa-fe6-copy.mjs`: FE-14R wording, FE-16, desktop + 390) | **95 OK / 0 FAIL** | 93 OK + 2 FAIL = expected: old FAQ wording |
| claims (`qa-fe6-claims.mjs`: FE-17/FE-19 behaviour) | 47 OK + **4 FAIL = FE-20** (MP4 text/accept on 2 pages) | 47 OK + 9 FAIL = old FAQ/"bank"/hints (fixed here) + the same 4 FE-20 + landing "videos" |
| overflow (320/360/390/768/1280 px) | 0 px except landing @ 320 px = 1 px | same 1 px (pre-existing) |
| headers diff (41 routes) | identical to main | |

Regression coverage (all 0 FAIL): buy flow with mock payments, validation errors, idempotency (duplicate webhook/checkout), webhook signature/replay, XSS/escaping on dashboard + buyer page, og/twitter tags on `/u/<id>`, auth/ownership, legal links on all pages, X-Robots-Tag on legal pages and `/u/*`, `Cache-Control: no-store` on `/api/earnings`, 429 messages (checkout, uploads, human-readable durations).

## 1. FE-17 claim by claim (`qa-fe6-claims.mjs` → `fe6-claims.log`, `qa-fe6-textdump.mjs` → `fe6-textdump.txt`)
Behaviour facts at 8681122 = main 7014c7e: `platform_settings` fee 10 %, hold 7 d, min payout 2500 ¢ (processing fee % NULL ⇒ provider default 12 %); sale ⇒ ledger `sale_credit`, `platform_fee`, `processing_fee` at sale time with `available_at` = sale + 7.0000 d; payouts record-only; `/api/payouts`, `/api/payouts/request`, `/api/earnings/payout`, `/dashboard/payouts` 404 for GET and POST; `POST video/mp4` = 415; only the mock processor.

| Claim (where) | Verdict | Evidence |
|---|---|---|
| FAQ "Each sale is listed in your dashboard as Pending." | **True** | new $20 sale: Pending $15.60 (=20 − 10 % − 12 %), Available $0.00, dashboard card "Pending $15.60 / Becomes available 7 days after each sale" |
| "After a 7-day hold it becomes Available" | **True (default)** | ledger `available_at` − sale time = 7.0000 d on every line; INFO: the number is hard-coded in `lib/features.ts`; with `payout_hold_days=3`, `min_payout_cents=5000` the landing still says 7 days / $25 while the dashboard follows settings (`fe6-claims.log` §B). No admin UI changes these today |
| "payouts start at $25" | **True (default)** | `minPayoutCents` 2500; `payoutEligible` flips at ≥ $25; service rejects below (payout-ui) |
| "Payout requests and processing are coming soon" / SellerCta "Payout requests coming soon" | **True** | no seller route/UI exists (404s above) |
| FAQ "What does it cost?" — platform + card-processing fees per sale, "keep most of every sale", "exact breakdown" | **True** | 10 % + 12 %, seller keeps ≈ 78 % (Maya 76.9 % after reversals); dashboard shows both fee lines and the reconciliation line |
| SellerCta "Sales, fees and balance in your dashboard" | **True** | |
| Hero badge "Verification required to publish"; FAQ "Publishing requires a verified account status" | **True** | pending seller: publish 403 `verification_required`, Publish dialog "Verification needed … can't publish until you're verified" (button disabled), New-drop alert "Publishing requires a verified account status (yours: pending)" |
| BuyerTrust "A seller must have a verified status before they can publish a link, and the badge only shows while that is the case" | **True** | flipping Maya through pending/failed/manual_review/verified: badge only for verified; page stays 200; checkout 201 only when verified, otherwise 409 `seller_not_verified` |
| BuyerTrust/TrustPoints/BuyerShell "You pay by card on a separate checkout page" / "Card checkout on a separate page. We never store card numbers." / "Unveil does not store card numbers" | **True for what exists** | card typed on `/pay/mock/<session>` (separate page, same origin, mock processor); after a UI purchase with 4242 4242 4242 4242 the card number appears in no DB dump, storage dir, mail dir or server log. INFO: with the mock off checkout is 503 — there is no live processor yet, so "secure checkout" is unverifiable until one exists |
| AuthShell "Originals are stored privately. Buyers only see blurred previews." | **True** | 800×600 noise JPEG: public preview 320×240, 1 KB, 0.0 % of the original's high-frequency detail; anonymous `/original` 403; storage outside `public/`; no storage key/filename in public JSON (`fe6-blur.log`) |
| FAQ "What kinds of files": "Photos … (video is coming soon)"; Hero/HowItWorks/meta/mock card "photos" | **True** | 415 for MP4 on main and branch; `VIDEO_UPLOAD=false`; with the flag on, copy would switch to "photos and videos" — the flag is a manual promise the guard cannot check (N38) |
| **Dropzone "JPG, PNG, WebP or MP4 …" + picker accepts `.mp4`** (`FileDropzone.tsx`) | **✘ FALSE (FE-20)** | `fe6-mp4ui.log`, `fe6-mp4-dropzone.png`; same text sits one line above "MP4 video up to 500 MB is coming soon" |
| Dashboard failed → "Contact support to continue" | **✘ unverifiable (FE-21)** | `/contact` = "Coming soon." |
| Dashboard in review → "A person is reviewing your verification. We'll update this page." | **✘ unverifiable (FE-21)** | no code path sets `verification_status`; no admin verification queue (`fe6-verifstates.log`) |
| Signup "Start sharing paid links today." | **✘ misleading (FE-22)** | new sellers are pending, cannot publish |
| "Share anywhere and get paid", AuthShell "Get paid by card", og:description "Get paid by card" | INFO (soft) | payouts do not exist yet; FAQ/CTA say so honestly, headline-level copy does not |
| "Buyers check out in seconds", "get a link in seconds", "Checkout you can trust … quick and safe", "Secure checkout" badges | INFO (marketing, unverifiable) | scripted open-to-paid ≈ 0.4 s with the mock; nothing measurable with a real processor |
| "Access to the files is shared once payment is confirmed" (meta, Hero, HowItWorks, buyer page, FAQ) + "Delivery options are coming soon" | INFO (soft promise, no mechanism yet) | judged acceptable in round 5; revisit before launch |
| Hosted-page "All sales are final … can't be refunded or exchanged"; checkbox "I agree to the Terms" while Terms/Privacy/DMCA/Contact are "Coming soon." | INFO — legal-owned | tied to M5-16 BLOCKED-ON-LEGAL; no message sent |
| Reset email "Open this link within 60 minutes" / reset page "signed out of all devices" | **True** | e2e #12: 1 h expiry, single use, all sessions revoked |
| API error strings (72 `HttpError`s) | no promise | only backend-owned "Identity verification required to publish (status: …)"; the UI maps the code to its own text, the raw string is never shown (checked on a pending seller) |

Full sweep: every page and state (landing incl. FAQ, auth, legal, buyer published/unpublished/draft/unknown, 404, admin login, validation errors, hosted mock page, dashboard overview/drops/new/detail for Maya, Jo (pending), Sam (empty), Ned (negative), never-paid seller; meta/og/twitter/aria/title) dumped to `fe6-textdump.txt` and read; plus rendered audit `qa-fe6-copyaudit.mjs` (31 pages): the only promise-word hits are "Delivery options are coming soon." (landing, buyer page), "They're added to this drop right away." (seller upload), the forgot-password reset line, and (flag on) the `/design` DownloadPanel demo — all acceptable as in round 5; the former "Publishing unlocks once your identity is verified" hit is gone. `/design` with `ENABLE_DESIGN_PAGE=1` still renders "Download … Your download links are private to you and expire in 24 hours / Not wired yet", no X-Robots-Tag (404 by default).

## 2. FE-19 (`fe6-claims.log` §F)
"Each payment link is long and unguessable, and it isn't listed or searchable. Only people the creator shares it with have it."
- **Unguessable:** `newPublicLinkId()` = `crypto.randomBytes(9).toString("base64url")` ⇒ 12 chars, 72 bits (≈ 4.7·10²¹ ids). 23 real ids all match `^[A-Za-z0-9_-]{12}$`, unique, 63 distinct symbols, χ² 57.7 (63 dof) vs a reference sample.
- **Not listed/searchable:** `/sitemap.xml`, `/u`, `/u/`, `/api/public/drops`, `/api/public`, `/d/x`, `/sellers`, `/explore`, `/search`, `/@maya`, `/maya` → 404; `/api/drops` 401; `/u/*` `X-Robots-Tag: noindex, nofollow` + `<meta robots noindex,nofollow,nocache>`; `robots.txt` Disallow `/u/` (advisory only). The public drop JSON and the buyer page HTML contain none of the seller's other links; no external links on the page and `Referrer-Policy: strict-origin-when-cross-origin` ⇒ no Referer leak.
- **Enumeration:** unknown/draft/unpublished links give the same 404 and the same body length (no existence oracle). 160 random probes of `/api/public/drops/<id>` from one IP: 120× 404 then 40× 429 (`PUBLIC_LINK` 120/min). **INFO:** the `/u/<id>` page route itself is not rate-limited (160/160 = 404) — harmless at 72 bits, but the limiter only covers the JSON API and `/api/checkout/status`.
- "Only people the creator shares it with have it" holds as far as the product controls it; anyone who has the URL can open it (no access control), which the new wording no longer denies.

## 3. FE-18 copy guard
**Their suite:** `tests/copy-guard.test.ts` + `copy-guard-mutation.test.ts` (35 in-memory mutations) pass (287/287). Design is sound: TypeScript AST (JSX text, string/template literals, concatenation, `[..].join("")`, attributes, metadata), NFKC + zero-width + entity normalisation, 19 rule groups + a letters-only "squashed" check, allowlist by exact file + exact string with a reason and a stale-entry check, `DownloadPanel` scanned, backend ratchet.

**Our old script** (`qa-fe6-guard-mutation.sh`, real test on a scratch copy; `fe6-guard-mutation-old.log`): **17 CAUGHT / 1 BYPASS** — the original AuthShell "Instant delivery" line (M1/M2/M3) is now caught (round 5: bypassed), as are synonyms, concatenation, entities, FAQ, `DownloadPanel`, email template and API string. The miss is M18 (`// x` comment in `next.config.ts`; not user-facing, as Frontend said).

**Our new script** (`qa-fe6-guard-mutation2.mjs` → `fe6-guard-mutation2.log`; 48 mutations, run against the real test on a scratch copy, app untouched):

| Group | Mutations | Result |
|---|---|---|
| Extractor evasion | N1 `In<b>stant</b>ly`, N2 sibling spans, N3 `straight <b>away</b>`, N4 `the <i>moment</i> you pay`, N5 variable + literal, N6 `` `${"In"}${"stantly"}` ``, N7 `.concat`, N8 `String.fromCharCode`, N9 `atob`, N10 reversed string, N11 Cyrillic homoglyphs, N12 accents (`instánt`), N13 leet, N14 `.map().join("")` | **all 14 BYPASS** (N1–N4 are plausible accidents in JSX; N8–N13 are deliberate obfuscation) |
| Paraphrase | N15 `straightaway`, N16 "land in seconds", N17 "We'll send you the link", N18 "Check your email for access", N19 "You'll receive your files", N20 "confirmation email", N21 "Your files are ready" (DownloadPanel's own phrase), N22 "no waiting / at once / on the spot", N23 Spanish, N24 French | **all 10 BYPASS** |
| Claims outside the rules | N25 "Upload MP4 clips", N26 "Payouts every Friday", N27 "All creators are fully verified", N28 "card details are encrypted end to end" | **BYPASS ×4**; N29 "Payouts are sent automatically every week" **CAUGHT** |
| Scope | N30 CSS `content: "Instant download"` in `globals.css`, N31 new `public/promo.svg`, N32 new `public/promo.json`, N33 new `.mjs` under `src/app`, N34 promise inside `src/server/auth/common-passwords-data.ts` (`SKIP_FILES`) | **BYPASS ×5** (unit guard reads only `.ts/.tsx`; `SKIP_FILES` is a file-level exemption despite "no file-level exemptions") |
| Backend ratchet | N35 new file `src/server/mail/promo.ts`, N36 split string in `src/app/api/checkout/route.ts` | **CAUGHT ×2** (ratchet works) |
| Loophole probes | N37 second exact `Download` button in `DownloadPanel.tsx` (allowlist is keyed by file + text, not position), N38 `VIDEO_UPLOAD = true` while the backend still 415s, N39 `PAYOUT_HOLD_DAYS = 30` | **pass** (by design; flag/number truth cannot be checked by a string scan) |
| Real FE-20 string | N40 "JPG, PNG, WebP or MP4 accepted." | **BYPASS** — the live FE-20 line passes the guard today |
| Other | N43 unused const with the promise, N45 `dangerouslySetInnerHTML` entity, N46 JSON-LD `JSON.stringify`, N47 `openGraph.description` | **CAUGHT ×4** |
| Should pass (not user-facing) | N41 `//` comment, N42 JSX comment, N44 type-level literal | pass (correct, no false alarm) |
| Paraphrase in FAQ | N48 "Thanks — your files are ready." | **BYPASS** |

**Total (excluding should-pass and loophole probes): 7 caught, 35 bypass of 42.** Realistic risk is the paraphrase/scope groups, not the cryptographic ones: a future honest edit such as "We'll send you the link", "your files are ready", an `.svg`/CSS text, or "MP4" in a hint passes silently. **Allowlist review:** every entry has a reason and an exact string, stale entries fail, the Faq entry is the whole first answer (so editing any other sentence in it IS caught); weak spots are the text-only key (reuse in the same file passes, N37), `SKIP_FILES` (N34), and flag-gated video copy (N38). **e2e `[copy-sweep]`** (passes) covers rendered landing incl. FAQ, auth, legal, buyer, `/pay/mock`, dashboard, 404, meta/aria and API JSON strings, but with a fixed regex (no `mp4`, no paraphrases) and strips tags before matching, so split words are invisible to it too.

## 4. FE-16 / FE-15 numbers (`fe6-earnings.log`, `fe6-perdrop-edge.log`, `fe6-dropdetail.log`, `fe6-copy-seed2.log`, screenshots `fe6-drops-*.png`, `fe6-dashboard-*.png`, `fe6-negative-*.png`)
Unchanged by this PR and still correct on a clean seed and on a second clean seed: Maya Spring 21 / $252.00 + Studio 6 / $140.00 + Travel 4 / $32.00 = **$424.00** = API gross − refunded − charged back = ledger; Gross hint "N sales charged, before refunds" == API `salesCount`; reversal line quotes the kept amount; "Sold (net)" / "Revenue (kept)" + tooltips + note on list (desktop table, 390 px cards) and detail; Ned: 1 sale $60.00 charged, $0.00 kept (charged back), "Balance owed" copy + `role=status` alert; the never-paid chargeback seller: 2 sales $40.00, $20.00 kept; Sam: empty state, no note. New hints: "Available … You've reached the $25.00 minimum. Payout requests are coming soon", "Paid out … Payouts marked as paid". `role=status` alert unchanged (34 OK).

## 5. Diff `origin/main..frontend/copy-accuracy` (`fe6-diff-files.txt`, `fe6-diff-stat.txt`)
23 non-screenshot files (+50 screenshots): `components/{auth/AuthShell, buyer/BuyerShell, buyer/TrustPoints, dashboard/NewDropFlow, dashboard/PublishDialog, dashboard/types, landing/{BuyerTrust,Faq,Hero,HowItWorks,PaymentLinkMock,SellerCta}}.tsx`, `src/app/components/DropEditor.tsx`, `src/app/dashboard/page.tsx`, `src/app/layout.tsx`, **new** `lib/features.ts`, `lib/upload-limits.ts` (only `videoUploadEnabled: VIDEO_UPLOAD`), `tests/copy-guard.test.ts`, **new** `tests/copy-guard-mutation.test.ts`, `tests/copy-guard.allowlist.ts`, `tests/helpers/copy-scan.ts`, `scripts/e2e.ts`, `docs/frontend-dashboard-notes.md`. **None** of `src/server/**`, `src/app/api/**`, `db/**`, money/pricing/ledger/payout files, `lib/earnings.ts`, `seed-demo.ts`, `next.config.ts`, `package.json`, `package-lock.json`. Backend-owned strings untouched as stated ("Identity verification required to publish" in `drops.ts`, mime "video" labels, `DOWNLOAD` action name, `PAYMENTS-NOTES.md` still mentions `BuyForm`).

## New bugs / findings
| ID | Sev | Finding | Exact repro |
|---|---|---|---|
| **FE-20** | **Low–Medium** (copy; open; also on main) | Dropzone hint "JPG, PNG, WebP or MP4 · 10 files · 2 GB per drop" and `<input accept="…video/mp4,…,.mp4">` on `/dashboard/drops/new` and `/dashboard/drops/<id>`, while MP4 upload is unavailable (415) and the line below says "MP4 video up to 500 MB is coming soon". `components/dashboard/FileDropzone.tsx:64,88` do not use `VIDEO_UPLOAD`/`videoUploadEnabled`. Owner: Frontend. | log in as any seller → `/dashboard/drops/new` → read the dropzone; or `node qa/scripts/qa-fe6-mp4ui.mjs` (picks an MP4: "MP4 video uploads are coming soon"); `curl -F file=@t.mp4;type=video/mp4 …/api/drops/<id>/files` → 415 |
| **FE-21** | **Low–Medium** (copy; open; pre-existing text) | `VERIFICATION_META` hints: failed → "Contact support to continue" (no support channel: `/contact` "Coming soon."); manual_review → "A person is reviewing your verification. We'll update this page." (no review path exists; `verification_status` is only changed by `scripts/set-verification.ts`/SQL). Owner: Frontend (copy) / Backend (KYC). | `UPDATE sellers SET verification_status='failed'` (or `manual_review`) for a test seller, open `/dashboard`; `node qa/scripts/qa-fe6-verifstates.mjs` |
| **FE-22** | **Low** (copy; open; pre-existing) | Signup subtitle "Set up in a minute. Start sharing paid links today." — new sellers are `pending` and cannot publish; nothing verifies them. Owner: Frontend. | open `/signup`; sign up; `/dashboard` shows "Verification: Pending … Publishing requires a verified account status" |
| **FE-18b** | **Low–Medium** (test quality) | Guard is a narrow word-list tripwire: 35/42 of our new must-catch mutations pass (paraphrases, JSX-split words, CSS/`public/`/`.mjs`, `SKIP_FILES`, no `mp4`/"ready" rules), and it passes while FE-20 is live. Suggested: add `mp4`, "files are ready", "send/receive … link/files", "check your email", "straightaway", "in seconds" rules; scan `.css`/`public/**`/`.mjs`; join adjacent JSX text/element children before matching; drop or justify `SKIP_FILES`; add a runtime assertion that `VIDEO_UPLOAD=true` only builds with the backend video route present. Owner: Frontend. | `WT=<worktree> node qa/scripts/qa-fe6-guard-mutation2.mjs` (scratch copy) |
| INFO-a | Info | Landing copy hard-codes the defaults `7`-day hold and `$25` (`lib/features.ts`); `platform_settings` changes (SQL only today) make the landing stale while the dashboard follows settings. | `fe6-claims.log` §B |
| INFO-b | Info | `/u/<id>` page route is not rate-limited (the JSON API is: 120/min/IP). | 160 probes of `/u/<random>` against a default-limits server → 160× 404 |
| INFO-c | Info | Soft/unverifiable marketing: "get paid" headlines before payouts exist, "Secure checkout"/"quick and safe", "access … is shared once payment is confirmed" with no delivery yet; Terms are placeholders while the buyer checkbox says "I agree to the Terms" (BLOCKED-ON-LEGAL). | `fe6-textdump.txt` |
| INFO-d | Info | `/design` (only with `ENABLE_DESIGN_PAGE=1`) still shows the DownloadPanel demo ("Thanks — your files are ready … Download") with no X-Robots-Tag; 404 by default. | `ENABLE_DESIGN_PAGE=1`, GET `/design` |
| INFO-e | Info | Landing overflows 1 px horizontally at 320 px (same on main). | `qa-fe6-overflow.mjs` |
| INFO-f | Info | Carried over (not branch-related): `POST /api/checkout` accepts `text/plain`; `%zz` path 500 (NEW-6); `/api/earnings.recent` not rendered; only the mock processor exists; no seller payout route; `PAYMENTS-NOTES.md` mentions `BuyForm`. | rounds 3–5 |

**Closed this round:** FE-17 (FAQ pay/cost answers, "Payouts straight to your bank", video marketing claims, verification/processor wording, payout hints), FE-19, the round-5 FE-18 bypasses (original AuthShell line, FAQ allowlist reuse, `DownloadPanel`, backend not scanned) — **FE-18 partially: see FE-18b.**

## Still BLOCKED — on whom
- **Receipt email, receipt link, order/download routes, signed-URL delivery** (M2-12, M2-14..16, M3-13, M3-14, M3-20, S2-02): Backend/Payments first, then Frontend wires `DownloadPanel` and removes "Delivery options are coming soon".
- **Video upload** (M1-06 for the FE/main view): `backend/m2-media` is not merged into main; when it is, flip `VIDEO_UPLOAD` **and** fix `FileDropzone` (FE-20); the guard will not tell you if the flag is flipped early.
- **Real processor / sandbox** (M3-04 3DS, M3-08, M3-17, M3-19 hosted fields, S2-05 beyond the ledger): Payments + provider account.
- **KYC / payout provider and payout routes/UI** (M4-01..05, M4-07, M4-08, M4-12, M4-13, M4-15, M4-16): Payments/Backend — also what FE-21/FE-22 hints depend on.
- **Frontend-listed:** M4-10 (views & conversion not tracked), M4-11 (no transaction history), M4-17 (no profile/settings), M6-06 (status page).
- **Backend:** M2-10, M2-13, M1-09, M1-11, M1-14. **Admin / moderation / compliance:** M5-01..06, M5-09..15, M5-17..19, M6-04, M6-05, M6-08..10.
- **M5-16: BLOCKED-ON-LEGAL** — unchanged; placeholders are not legal copy; no message sent to anyone. **Google OAuth (M1-02):** presence only.
- **NOT RUN:** M3-12, M6-01 (OWASP review), M6-03 (load test).

## Case-by-case results
| Case | Result | Evidence / notes |
|---|---|---|
| M4-09 | **PASS** | **R6 (8681122):** re-verified: dashboard == `GET /api/earnings` == ledger for Maya/Ned/Sam/never-paid seller on a clean seed, desktop and 390 px (earnings 115 OK, perdrop-edge 69, dropdetail 6, copy §2). FE-15/FE-16 numbers and labels unchanged by this PR; new hints 'Payouts marked as paid' / 'You’ve reached the $25.00 minimum. Payout requests are coming soon' verified. |
| M1-01 | **PASS** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M1-02 | **PASS** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M1-03 | **PASS** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M1-04 | **PASS** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M1-05 | **PASS** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M1-06 | **BLOCKED** | **R6:** on main 7014c7e and this branch `POST video/mp4` -> 415 `invalid_image`, so MP4 upload is not in the product as it stands (backend/m2-media NOT merged; `VIDEO_UPLOAD=false` matches). BE lane m2-media passed on its own branch (plan row text). FE-20: the dropzone still advertises MP4. Stays BLOCKED for the FE/main view. |
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
| M2-03 | **PASS** | **R6:** pending seller publish -> 403 `verification_required`; Publish dialog explains 'Verification needed' and the button is disabled; checkout on a non-verified seller's link -> 409 `seller_not_verified` for pending/failed/manual_review (`fe6-claims.log` §D). |
| M2-04 | **PASS** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M2-05 | **PASS** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M2-06 | **PASS** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M2-07 | **PASS** | **R6 (8681122):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: Buyer page in the combined state (seed Maya): blurred hero/thumbs, title, seller name, price, file summary, Buy panel; legal footer. Screenshots `fe3-buyer-390.png`, `fe3-buy-validation-desktop.png`. |
| M2-08 | **PASS** | **R6 (8681122):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: No storage key / filename / `/original` in page, RSC payload or public API; anonymous `/original` 403 (`fe3-regress.log`). |
| M2-09 | **PASS** | **R6:** link ids = 12 chars base64url of 9 CSPRNG bytes (72 bit); `/u/*` X-Robots-Tag noindex + meta; robots Disallow /u/; sitemap 404; no listing/profile/search routes; FE-19 wording ('long and unguessable, not listed or searchable') verified. INFO: the /u/<id> page itself is not rate-limited (the JSON API is: 120/min/IP). |
| M2-10 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M2-11 | **PASS** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M2-12 | **BLOCKED** | **R6 (8681122):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: No buyer download flow exists to test (the sale succeeds, nothing is delivered). Unchanged: Payments/Backend. |
| M2-13 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M2-14 | **BLOCKED** | **R6:** no download page (404s unchanged); DownloadPanel unrouted (only the flag-gated `/design` demo). BLOCKED. |
| M2-15 | **BLOCKED** | **R6 (8681122):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: Signed-URL expiry carried from R2; receipt link that mints a fresh URL does not exist. |
| M2-16 | **BLOCKED** | **R6 (8681122):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: No download-attempt counter / purchase concept. |
| M2-17 | **PASS** | **R6 (8681122):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: Default-limits instance: 80 bad-signature requests from one IP → 403×60, 429×20; second IP still 403 (`fe3-misc.log`). |
| M2-18 | **PASS** | **R6 (8681122):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: 390×844 and 360×800 (touch, DPR 2): landing, signup, login, forgot, terms, `/u/<id>`, unavailable page, dashboard, drops, new drop, and Ned's dashboard with the negative-balance alert: no horizontal scroll; Buy button ≥44 px touch target (`fe3-regress.log`; `f |
| M2-19 | **PASS** | **R6 (8681122):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: Throttled 4G (9 Mbit/s, 170 ms RTT, 4× CPU, cache off), 3 runs: Buy button visible 304–325 ms, FCP 708–772 ms, load ≈0.92–0.95 s (`fe3-misc.log`). |
| M3-01 | **PASS** | **R6 (8681122):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: Guest checkout, no login/account prompt: Buy → email + 18+ → redirected to the hosted card page `/pay/mock/<session>` which shows the card form (UI desktop + 390 mobile, `fe3-buy.log`; `fe3-hosted-page.png`). Real processor-hosted fields still need a real prov |
| M3-02 | **PARTIAL** | **R6:** PARTIAL unchanged: payment -> webhook -> `succeeded` + 3 pending ledger lines OK; the 'redirect to download page' half does not exist and no copy implies it. |
| M3-03 | **PASS** | **R6 (8681122):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: Declined / insufficient funds / expired / bad CVC / garbage card: friendly text only (no codes), no succeeded tx, 0 ledger lines, same session retryable with a good card (`fe3-fees.log`; UI check in `fe3-buy.log`). |
| M3-04 | **BLOCKED** | **R6 (8681122):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: No 3-D Secure in the mock processor (5 card outcomes); needs a real sandbox. Owner: Payments. |
| M3-05 | **PASS** | **R6 (8681122):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: $20.00 → platform $2.00, processing $2.40, net $15.60, integer cents; ledger sum = net (`fe3-fees.log`). |
| M3-06 | **PASS** | **R6 (8681122):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: $1.00, $1.01, $9.99, $49.99, $123.45, $500.00: platform + processing + net = gross exactly; ledger sum = net. |
| M3-07 | **PASS** | **R6 (8681122):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: `platform_settings.fee_percent` 10→15 via SQL: new sale platform $3.00, earlier sale unchanged $2.00, no deploy (no admin UI: M5-13). |
| M3-08 | **BLOCKED** | **R6 (8681122):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: Needs a real processor account / live $1 charge. |
| M3-09 | **PASS** | **R6 (8681122):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: New sale pending (7 d), 3 ledger lines available_at = created_at + 7 days; boundary now±1 s/µs flips exactly; live flip observed at ≈3.3 s for a +3 s entry; refund inside the hold reduces pending, not available (`fe3-boundary.log`, 20 checks). |
| M3-10 | **PASS** | **R6 (8681122):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: Unsigned, bad-signature and tampered-body webhooks → 401, transaction stays pending (`fe3-webhook.log`, `fe3-buyerr.log` §D). |
| M3-11 | **PASS** | **R6 (8681122):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: Same signed `sale.succeeded` ×3 → 200/200/200, one `sale_credit`; second event id for the same sale → still one credit. |
| M3-12 | **NOT RUN** | **R6 (8681122):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: Not re-run in this FE round (Payments R5: PASS). |
| M3-13 | **BLOCKED** | **R6:** no copy promises a receipt (FAQ/CTA/meta/hosted page/email); there is still no receipt email (0 mails after paid sales). Stays BLOCKED: Backend/Payments. |
| M3-14 | **BLOCKED** | **R6:** still no receipt link / re-access route (404s unchanged). BLOCKED: Backend/Payments. |
| M3-15 | **PASS** | **R6 (8681122):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: `confirmOver18` missing/false/`"true"`/1/null → 400 server-side (API, not just UI); UI blocks the submit and shows 'Please confirm to continue.'; `buyer_confirmed_18_at` stored (`fe3-buy.log`). |
| M3-16 | **PASS** | **R6 (8681122):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: Default limits: 10 checkouts then 429 `Retry-After: 60` (4/4); UI shows disabled button with countdown 'Try again in 59s' + 'You can try again in 59 seconds.', re-enables when it ends; single buyer unaffected (`fe3-buyerr.log` §C; `fe3-buy-real429.png`). |
| M3-17 | **BLOCKED** | **R6 (8681122):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: No Stripe/PayPal in src/scripts/lib/components/package.json/README (only a substring inside the common-passwords list) ✔; CCBill/Segpay not chosen/integrated (README documents the provider hook). Owner: Payments. |
| M3-18 | **PASS** | **R6 (8681122):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: Re-run on the new BuyPanel: final-sale text + 18+/Terms checkbox before Buy, and again on the hosted page (`fe3-buy-validation-desktop.png`, `fe3-hosted-page.png`). |
| M3-19 | **BLOCKED** | **R6 (8681122):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: Hosted fields need a real processor. The 'no card data stored/logged' half PASSES: PAN/CVC absent from `pg_dump --data-only` and from server logs after declined + approved cards; no card-like column in any table; secrets absent too (`fe3-leak-scan.log`). |
| M3-20 | **BLOCKED** | **R6:** still no download end of the flow; copy only says 'Access … is shared once your payment is confirmed. Delivery options are coming soon.' BLOCKED. |
| M4-01 | **BLOCKED** | **R6:** BLOCKED (no KYC provider; verification is a stub set by script/SQL). Copy is now honest ('Verification required to publish', 'verified account status'); remaining unverifiable: dashboard 'A person is reviewing your verification' / 'Contact support' (FE-21). |
| M4-02 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M4-03 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M4-04 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M4-05 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M4-06 | **PASS** | **R6 (8681122):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: Re-run: pending seller publish 403, checkout on its draft 404, checkout when seller becomes `manual_review` after page load → 409 with friendly UI notice (`fe3-buyerr.log` §B). |
| M4-07 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M4-08 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M4-10 | **BLOCKED** | **R6:** per-drop 'Sold (net)' / 'Revenue (kept)' + reversal note unchanged and correct (Maya 21/$252 + 6/$140 + 4/$32 = $424.00 on a clean seed). Stays BLOCKED: views and conversion not tracked. |
| M4-11 | **BLOCKED** | **R6 (8681122):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: Still no transaction-history page (`/dashboard/transactions/sales` 404, no buyer country). `GET /api/earnings.recent` (20 rows) exists but isn't rendered. Frontend lists this as still open. |
| M4-12 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M4-13 | **BLOCKED** | **R6:** no seller payout request route/UI (`/api/payouts*`, `/dashboard/payouts` 404 GET+POST); copy now says 'Payout requests are coming soon' (accurate); service rejects <$25. BLOCKED: Payments/Backend. |
| M4-14 | **PASS** | **R6 (8681122):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: (service + dashboard) only post-hold funds are Available; entries inside the hold are Pending; eligibility flag follows min payout (`fe3-boundary.log`, `fe3-payout-ui.log`). |
| M4-15 | **BLOCKED** | **R6 (8681122):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: No payout routes/screens. Through the service the dashboard follows requested→approved→paid correctly: In payout +$30, Available −$30, then Paid out +$30 (`fe3-payout-ui.log`). |
| M4-16 | **BLOCKED** | **R6 (8681122):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: Failed payout returns funds and the dashboard follows (Available restored); no admin screen to see it. |
| M4-17 | **BLOCKED** | **R6 (8681122):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: Still blocked: `PATCH/PUT /api/auth/me` 405, no profile/settings UI (`fe3-blocked-probes.log`). Frontend lists this as still open. |
| M4-18 | **PASS** | **R6 (8681122):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: Scripted signup → verification stand-in (DB) → new drop one-step upload+publish → live link in 1.3 s (`fe3-journey.log`); well under 15 min. |
| M5-01 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M5-02 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M5-03 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M5-04 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M5-05 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M5-06 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M5-07 | **PASS** | **R6:** re-verified: Ned netting by new sales still works (`fe6-ned-netting.log`); negative-balance alert is `role=status`, danger-toned (fe1213 34 OK). |
| M5-08 | **PASS** | **R6 (8681122):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: Chargeback webhook (+$5 fee) shown on the dashboard as 'charged back' separate from refunds, fee named in the reconciliation line; also with the chargeback inside the hold window (`fe3-cbhold.log`). Flagging/review: Payments R5. |
| M5-09 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M5-10 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M5-11 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M5-12 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M5-13 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M5-14 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M5-15 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M5-16 | **BLOCKED-ON-LEGAL** | **R6:** BLOCKED-ON-LEGAL (unchanged; Terms/Privacy/DMCA/Contact are 'Coming soon.' placeholders, X-Robots-Tag + legal links intact). Not counted as FAIL; nobody messaged. |
| M5-17 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M5-18 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M5-19 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M5-20 | **PASS** | **R6:** neutral-branding re-scan of every page, meta/og, emails, aria: no adult-market wording; new copy ('Verification required to publish', 'unguessable and unlisted') is neutral. |
| M6-01 | **NOT RUN** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M6-02 | **PASS** | **R6 (8681122):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: All 6 security headers on `/`, `/login`, `/terms`, `/u/*`, `/api/earnings`, `/dashboard`; CSP without `unsafe-eval`; 5 secret values absent from the 27 client-bundle files and rendered HTML; mock endpoints 404/503 when the mock is disabled. |
| M6-03 | **NOT RUN** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M6-04 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M6-05 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M6-06 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M6-07 | **PASS** | **R6 (8681122):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: Manifest valid, `/icons/icon-192.png` and `icon-512.png` 200 image/png (the og/twitter image is the 512 icon). |
| M6-08 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M6-09 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| M6-10 | **BLOCKED** | Carried over from rounds 2-4, not re-run (branch diff vs main touches no backend, db, api or package files). |
| S2-01 | **PASS** | **R6 (8681122):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: = M4-18 (1.3 s scripted). |
| S2-02 | **BLOCKED** | **R6:** = M3-20, BLOCKED. |
| S2-03 | **PASS** | **R6 (8681122):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: = M3-07. |
| S2-04 | **PASS** | **R6 (8681122):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: = M2-03 / M4-06. |
| S2-05 | **BLOCKED** | **R6 (8681122):** re-run on the branch with the renamed round-4 suite (0 FAIL), rating unchanged. Previous evidence: Trace works up to the ledger (tx → `webhook_events` row `sale_succeeded/processed` → 3 ledger lines posted via that event → dashboard), but no receipt exists (`fe3-journey.log`). |

## Reproducing
```
git worktree add --detach /workspace/qa-fe6 8681122 && cd /workspace/qa-fe6 && npm ci      # main baseline: same with 7014c7e
# .env: DATABASE_URL (throwaway), fresh secrets, MAIL_DEV_DIR, PAYMENT_WEBHOOK_SECRET, CRON_SECRET, MOCK_PAYMENTS_ENABLED=1
set -a; . ./.env; set +a; unset NODE_ENV; npm run migrate && NEXT_DIST_DIR=.next-qa npm run build && npx tsc --noEmit && npm run lint && npm test && E2E_PORT=4600 npm run e2e
BASE_URL=http://localhost:4601 npx tsx scripts/seed-demo.ts                                  # Maya / Ned / Sam / Jo  (.e2e/seed.json)
# env for scripts: BASE BASE_NOMOCK BASE_LIM SEED SEEDJSON DB WT OUT IMG MAIL_DIR (+ BASE_URL for .ts, CBEMAIL from qa-fe6-cbhold.ts "EMAIL=")
node qa/scripts/qa-fe6-earnings.mjs; node qa/scripts/qa-fe6-copy.mjs; node qa/scripts/qa-fe6-claims.mjs; node qa/scripts/qa-fe6-textdump.mjs
node qa/scripts/qa-fe6-mp4ui.mjs; node qa/scripts/qa-fe6-verifstates.mjs; node qa/scripts/qa-fe6-blur.mjs; TAG=x node qa/scripts/qa-fe6-copyaudit.mjs
WT=/workspace/qa-fe6 bash qa/scripts/qa-fe6-guard-mutation.sh; WT=/workspace/qa-fe6 node qa/scripts/qa-fe6-guard-mutation2.mjs
A=http://localhost:4611 B=http://localhost:4601 SA=seedm.json SB=seed.json bash qa/scripts/qa-fe6-headers-diff.sh
```
Other scripts are the round-5 suite renamed `qa-fe6-*` (fixes, buy, buyerr, back, fees, journey, misc, regress, reg-*, boundary, webhook, ned-netting, payout-ui, perdrop-edge, dropdetail, fe1213, overflow, sellerclaims, blocked). `qa-fe6-regress.mjs` expects Ned still negative: run it before `ned-netting`. Adapted this round: `qa-fe6-copy.mjs` (new FAQ wording). New: claims, textdump, mp4ui, verifstates, blur, guard-mutation2.

## Housekeeping
Servers :4600–4604 and :4611–4613 stopped; DBs `unveil_qa_fe6`, `unveil_qa_fe6m`, `unveil_e2e_qafe6` dropped; worktrees `/workspace/qa-fe6`, `/workspace/qa-fe6-main` and the push worktree removed; temp files removed. Scripts: `qa/scripts/qa-fe6-*`; evidence: `qa/artifacts/fe6/` (logs, screenshots `fe6-*.png`, baseline logs in `main/`; seeds not committed).
