# QA results: PR #8 `frontend/copy-guard-2` (FE-20 / FE-21 / FE-22 / FE-18b)

Head **67c9b46** (PR #8, not merged), branched from main **e5b6261**. Worktrees: `/workspace/qa-fe7` (branch), `/workspace/qa-fe7-main` (main), a flag-flipped copy (`VIDEO_UPLOAD=true`, scratch, never pushed). Throwaway Postgres DBs, ports 4701-4706 / 4711-4713 / 4730. Scripts `qa/scripts/qa-fe7-*`, evidence `qa/artifacts/fe7/`. No app code was changed.

## Verdict
**FE-20, FE-21 and FE-22 work as claimed, with one miss in FE-22 ("in seconds" is still on /login and /signup). The PR introduces one visible regression: the landing header overflows the screen at 320-375 px because the new "Create your account" button is longer than "Start selling" (FE-23, Medium).** No regression vs main in the rest of the earlier suite; no change under `src/server`, `src/app/api`, `db`, money/pricing/ledger/payout files, package files or `next.config.ts`. The new copy guard is deterministic and fast and passes the previous 48 + 18 mutations, but it is still a narrow tripwire: **46 of 62 new, realistic false-claim mutations get through, and 8 of 9 legitimate-copy probes are blocked** (FE-18c / FE-18d, both Low-Medium test-quality findings).

| Area | Result |
|---|---|
| FE-20 dropzone / accept / note, flag false | **FIXED ✔** (new drop + drop detail, desktop + 390 px; 15 checks, main 13 FAIL) |
| FE-20 flag flip (`VIDEO_UPLOAD=true` build) | flips hint/accept/note as designed ✔ (12 OK); upload still 415 on main and branch, so a flip without backend = UI offers an upload that always fails; guard test blocks the flip ✔ |
| FE-21 four verification states on dashboard / new drop / drop detail / publish dialog, desktop + 390 px | **FIXED ✔** exact new texts, no support / person / team / ETA; 90 checks OK (main 30 FAIL = old wording) |
| FE-21 flagged-drop hint vs behaviour | UI claim true; **API still accepts file uploads on a flagged drop (201)** (FE-25, Low, backend-owned) |
| FE-22 signup subtitle, CTAs, "in seconds", "today" | subtitle ✔, 3 CTAs ✔, HowItWorks "in seconds" gone ✔; **AuthShell "Buyers check out in seconds" remains** (FE-24, Low) |
| Re-sweep of pages / meta / og / aria / email / API strings | no instant / receipt / download / unlock promise for buyers; leftovers listed in §3 |
| FE-18b guard: previous mutation scripts | qa-fe6 (now qa-fe7) guard-mutation2: **45 caught, 0 bypass, 3 correct comment/type-only passes**; qa-fe5 sh: 17/18 (M18 is comment-only) |
| FE-18b guard: 75 NEW mutations | **16 of 62 promise mutations caught, 46 bypass**; 3 not-user-facing correctly pass; 8 of 9 legit-copy probes blocked |
| Diff vs main | as claimed ✔ (21 non-screenshot files + 49 screenshots; no new dependency) |
| Regression vs main | **0 FAIL** in every suite on branch and main (table §6) |
| FE-16 numbers (Maya, Ned, never-paid) | unchanged and correct ✔ (earnings 115 OK, perdrop-edge 69, dropdetail 6, copy 95, fe1213 34; clean second seed) |

## 1. FE-20 (`qa-fe7-mp4ui.mjs`; `fe7-mp4ui-flagfalse.log`, `-flagtrue.log`, `-main.log`)
| Check | Branch, `VIDEO_UPLOAD=false` | Branch, flag flipped to `true` | Main e5b6261 |
|---|---|---|---|
| Dropzone hint (new drop, drop detail, desktop and 390 px) | `JPG, PNG or WebP · up to 10 files · 2 GB per drop` | `JPG, PNG, WebP or MP4 · up to 10 files · 2 GB per drop` | `JPG, PNG, WebP or MP4 · 10 files · 2 GB per drop` ✘ |
| `accept` | `image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp` | `…,video/mp4,.mp4` | contains `video/mp4` and `.mp4` ✘ |
| Note under the dropzone | exactly one: `Images (JPG, PNG, WebP) up to 15 MB each. Video upload is coming soon.` (only occurrence of "video"/"MP4" on the page) | `… MP4 video up to 500 MB each.` (0 "coming soon") | `MP4 video up to 500 MB is coming soon.` ✘ |
| Picked `.mp4` (setInputFiles, new drop and drop detail) | rejected client-side: `Video upload is coming soon — for now, add JPG, PNG or WebP images.` | accepted by the client | old message ✘ |
| `POST /api/drops/:id/files` video/mp4 | **415** `invalid_image` | 415 (same backend) | 415 |
| `POST …/files` image/jpeg | 201 | 201 | 201 |
Backend m2-media is **not merged** (`git merge-base --is-ancestor origin/backend/m2-media origin/main` = no), so 415 on both is the truth and `VIDEO_UPLOAD=false` matches reality. Flag true flips everything back. Flipping the flag alone also fails the guard (2 tests: stale allowlist entries and "VIDEO_UPLOAD=true requires video/mp4 handling in the backend"). Latent, only if the flag is ever true: `DropEditor` hard-codes "JPG, PNG or WebP. They’re added to this drop right away." above a dropzone that then says "… or MP4" (INFO FE-26).

## 2. FE-21 (`qa-fe7-verifstates.mjs`, `fe7-verifstates.log`; screenshots `fe7-branch-verif-<state>-{dashboard,dashboard-390,newdrop,dropdetail,publishdialog}.png`, main `fe7-main-verif-*`)
Seller Maya driven through each state via SQL; checked on `/dashboard`, `/dashboard/drops/new`, draft detail ("Publishing is off") and the Publish dialog, desktop and 390 px; **exact wording** compared with the PR text:
| State | Title / label | Text | Mentions support / person / team / ETA? |
|---|---|---|---|
| pending | Verification: Pending | You can create drafts and upload files now. Publishing stays off until your account is verified, and verification isn’t self-serve yet. We’ll share next steps here when they’re available. | no |
| failed | Verification: Not completed | Verification wasn’t completed. You can keep drafting drops; publishing stays off until your account is verified. We’ll share next steps here when they’re available. | no |
| manual_review | Verification: Marked for review | Your verification is marked for review. You can keep drafting drops; publishing stays off until it’s cleared. | no |
| verified | no banner (sr-only "Verified"); no alert on new drop, detail, dialog | | n/a |
Every claim checked against behaviour: in all three non-verified states create-draft **201**, upload image **201**, publish **403 `verification_required`**; verified publishes **200**; nothing in `src/` writes `sellers.verification_status` (only `scripts/set-verification.ts` / SQL) and `/verify`, `/verification`, `/dashboard/verification`, `/api/verification` … are all 404, so "verification isn’t self-serve yet" is true; `/contact` is still "Coming soon", so not offering support is right; no page contains "contact support", "a person is reviewing" or "team reviews". "We’ll share next steps here when they’re available" is a future promise with nothing built yet (INFO, honest and non-committal). "until it’s cleared" implies a clearing step that exists only as ops SQL (INFO).
**Flagged drop** (Maya "Pop-up reel"): new text "This drop is paused and under review. You can’t edit or publish it for now." (main said "while our team reviews it"; the team claim is gone ✔; buyer page never says "under review"). Reality: buyer page 404 and checkout 404 ✔ (paused); publish **403 flagged**, unpublish **403 flagged**, no uploader in the UI ✔; PATCH and DELETE on the drop are 405 (no edit API on this branch, so "can’t edit" is vacuously true); **`POST /api/drops/:id/files` on the flagged drop → 201** (FE-25). Also nothing in `src/` sets a drop to `flagged` and `drops` has no `flagged_at`/`reviewed_*` columns, so "under review" is a state label only (set by SQL/ops); the new text no longer claims who reviews it or how long.

## 3. FE-22 and sweep of all copy (`fe7-copyaudit.log`, `fe7-textdump.txt`, `fe7-reset-email.txt`)
- Signup subtitle: "Create your account and start drafting drops. Publishing opens once your account is verified." ✔ true (drafting works; publishing needs verified).
- CTAs (header, Hero, SellerCta) all "Create your account" → `/signup` ✔; no "Start selling" anywhere (rendered pages, source grep); no "today"; HowItWorks step 2 "…get a shareable payment link." ✔ ("in seconds" gone there).
- **FE-24 (Low):** `components/auth/AuthShell.tsx:8` still says "Buyers check out in seconds — no accounts, no friction." on /login and /signup. It is a speed claim, not a delivery claim, and the guard misses it (the "in seconds" rule needs a delivery verb nearby; "check out in seconds" is not one). Contradicts "in seconds line gone".
- qa-fe4-copyaudit.mjs (31 pages) leftovers, judged: "Delivery options are coming soon." (landing, buyer page) **acceptable**, says delivery is NOT available; forgot-password "we’ll send you a reset link" **acceptable**, real feature (reset mail checked: subject "Reset your Unveil password", no receipt/delivery text); seller drop-detail "They’re added to this drop right away." **acceptable**, seller upload, true.
- INFO (carried): "access to the files is shared once payment is confirmed" appears **without** the "Delivery options are coming soon" qualifier in the site meta description, Hero and HowItWorks step 3; there is still no buyer delivery (M2-12/M3-20 blocked). Soft, no timing promise; revisit before launch.
- Other claims re-checked and fine: FAQ payout answer (Pending, 7-day hold, Available, $25 minimum, requests "coming soon") matches `platform_settings` defaults; "Keep most of every sale" (seller keeps ~78 % after 10 % + 12 %); "Verified creators … only shows while that is the case"; "Private links … unguessable … not listed" (robots.txt disallows /u/, no sitemap); manifest description generic; og/twitter generic; hosted `/pay/mock` and buyer page: no delivery promise. Static FAQ "7-day hold" / "$25" would go stale if an operator changes `platform_settings` (documented by Frontend).

## 4. FE-18b copy guard
**Their runs reproduced** (`fe7-guard-mutation2.log`, `fe7-guard-mutation.log`): mutation2 baseline PASS, **45 caught / 0 bypass**, N41, N42, N44 (comment, JSX comment, type-only) correctly pass; qa-fe5 script 17 caught, M18 (a `// x` comment in `next.config.ts`) passes, correctly.
**New:** `qa-fe7-guard-mutation3.mjs` = 75 mutations on a scratch copy running the real `tests/copy-guard.test.ts` (`ONLY='^S3$'` reruns one). Log `fe7-guard-mutation3.log`.
| Group | Caught | Bypass |
|---|---|---|
| P1-P23 paraphrases (speed, delivery, receipt, payout, fee %, support, review, trust, verification) | 1 (P5 "granted automatically") | 22 |
| L1-L4 other languages (ES, FR, ZH, PT) | 0 | 4 |
| S1-S17 extractor evasion | 4 (S14 aria/alt/placeholder, S15 String.raw + \u escapes, S16 invisible chars, S17 dynamic import of new src module) | 13 |
| F1-F10 places / file types | 4 (F5 .txt, F8 webmanifest, F9 API route ratchet, F10 next.config) | 6 |
| A1-A10 allowlist / flags | 7 (A1 rename, A2 copy, A3 append inside allowed unit, A4 reuse in same file, A8 flag flip + dummy backend string, A9 retyped constant, A10 "contact support") | 1 (A7) |
| **Total promise mutations** | **16** | **46** |
Notable bypasses (id: what gets through):
- Paraphrases of the delivery promise it is meant to stop: P1 "as the payment clears", P2 "open when checkout finishes", P3 "Zero wait", P4 "access within minutes", P6 "You’ll be sent the originals", P10 "order summary is on its way"; unverifiable retention/access claims P7 "Lifetime access", P8 "available for 30 days", P9 "Re-access any time".
- **Money claims are not pinned beyond hold days and minimum:** P11 "Funds arrive in 2 business days", P12 **"Keep 90% of every sale"** (real: ~78 %), P13 "zero fees", P14 "We pay creators 48 hours after each sale"; P15 `14-day hold` and P16 `$10` hard-coded in the FAQ instead of the pinned constants (the pin tests only check `lib/features.ts`, not the FAQ text).
- Support / review / trust: P17 "Email help@unveil.link", P18 "24/7 support", P19 "manually reviewed before it goes live", P20 "moderation team checks every link", P21 "256-bit SSL", P22 "ID-checked", P23 "Get verified in minutes".
- **Static folding the docs claim but does not do:** S3 object property `T.a + T.b`, S4 array destructuring, S5 `let s="In"; s += "stantly"`, S1 helper call `a() + "stantly"`, S2 ternary, S6 props composition; S7 `.replace(/x/g,"")`, S8 `[..."yltnatsni"].reverse().join("")`, S9 `Array.from(..).reverse()`, S10 bidi-override CSS; unmapped homoglyph S11 `ɪnstant`, symbol-leet S12 `!nstant`; S13 JSON parts joined at run time.
- **Scan scope:** F1 `messages/en.json` and F2 `content/copy.ts` (any top-level folder outside `components lib src public next.config.ts`; a component can import them by relative path), F3 `public/*.xml`, F4 mail templates `.hbs/.mjml` under `src/server`, F6 CSS `content: "In" "stantly"` (adjacent strings), F7 SVG `In<tspan>stant</tspan>ly`.
- A7 `VIDEO_UPLOAD = process.env.NEXT_PUBLIC_VIDEO === "1"`: the guard reads only `= true`, so an env-driven flag is invisible to it.
- A6 (process): adding an exact allowlist entry for a promise string passes (no CODEOWNERS / review gate in the repo); expected for an allowlist, noted.
What it does well: allowlist is exact (A1-A4: renaming, copying, appending, reusing an allowed string all fail), ratchet on `src/server` + `src/app/api` works (F9, plus the earlier N35/N36), flag/backend and pinned-constant checks work (A8, A9), invisible characters, entities, accents, Cyrillic homoglyphs, leet digits, `String.raw` and `\u` escapes are normalised.
**False positives** (legit copy that fails the guard and would need an exact allowlist entry): FP1 **"Your link is ready to share."** (seller copy after creating a drop), FP2 "Your reset link expires in 60 seconds.", FP3 honest negative "Receipts are not available yet.", FP4 "Download your sales as CSV", FP5 legal text "You may withdraw your consent at any time.", FP6 "We encrypt passwords with bcrypt.", FP8 "Photos only for now: no video.", FP9 a developer-only `console.log` string. Only FP7 ("Publish in one click. Supports JPG, PNG and WebP.") passes. Practical risk: the real Terms/Privacy text will trip `withdraw`, `deliver`, `receipt`, `download`, `encrypt`, `guarantee`, `certified` … and will need long exact-string entries (relevant when M5-16 legal copy arrives; nobody messaged).
**Runtime / flakiness** (`fe7-guard-flakiness.log`): `copy-guard.test.ts` + `copy-guard-mutation.test.ts` (127 tests) 1.8-1.9 s per run; 6 sequential runs, 3 with `--sequence.shuffle`, 4 in parallel and one from another cwd: all pass, no flakiness. Whole `npm test` 378/378 in 54 s.

## 5. Diff vs main e5b6261 (`git diff e5b6261 67c9b46`)
21 non-screenshot files + 49 screenshots: `components/{dashboard/{FileDropzone,NewDropFlow,PublishDialog,types},landing/{Hero,HowItWorks,SellerCta,SiteHeader}}.tsx`, `src/app/components/{AuthForm,DropEditor}.tsx`, `lib/upload-limits.ts`, `docs/frontend-dashboard-notes.md`, `scripts/{e2e.ts,screenshots-dashboard.mjs}`, `tests/{copy-guard.test.ts,copy-guard-mutation.test.ts,copy-guard.allowlist.ts,frontend-copy.test.ts,helpers/{copy-scan,guard,qa-mutations}.ts}`. **None** under `src/server`, `src/app/api`, `db`, `lib/earnings.ts`, `seed-demo.ts`, `next.config.ts`, `package.json`, `package-lock.json`; no new dependency (the AST scanner uses the existing devDependency `typescript ~5.9`; it is test code only). `lib/upload-limits.ts` changes copy and helpers only (limits unchanged). The extra "video/mp4" word-lists in tests are data. As stated by Frontend.

## 6. Suite results (branch 67c9b46 | main e5b6261)
| Check | Branch | Main |
|---|---|---|
| `npm ci`, migrate (12), `tsc --noEmit`, `npm run lint`, `npm run build` | all OK | build OK |
| `npm test` | **378/378** (16 files) | n/a |
| `npm run e2e` | **85/85** incl. `[copy-sweep]` (`fe7-e2e-run1.log`) | n/a |
| fixes / buy / buyerr / back / fees / journey / misc / regress | 90 / 67 / 18 / 2 / 16 / 4 / 9 / 55 OK, 0 FAIL | identical, 0 FAIL |
| reg-meta / reg-modal / reg-duration / boundary / ned-netting | 17 / 52 / 93 / 20 / 3 OK | identical |
| webhook (signature, replay/idempotency, rejects) | 6 OK | 6 OK |
| payout-ui | 7 OK | n/a |
| earnings (API == UI == ledger) on a clean seed | **115 OK / 0 FAIL** | 115 OK / 0 FAIL |
| perdrop-edge / dropdetail | 69 / 6 OK | 69 / 6 OK |
| fe1213 (balance owed, `role=status`, contrast) | 34 OK | 34 OK |
| copy (FE-14R wording, FE-16, desktop + 390 px) | 95 OK / 0 FAIL | 95 OK |
| claims (FE-17/19 behaviour) | 56 OK / 0 FAIL (after I updated one stale assertion: publish-dialog title is now "Verification: <label>") | 51 OK + 5 FAIL = old FE-20/21 wording, expected |
| verifstates (new, FE-21) | 90 OK | 30 FAIL = old wording, expected |
| mp4ui (new, FE-20) | 15 OK flag false; 12 OK flag true | 13 FAIL = old wording, expected |
| overflow / landing-overflow (320-1280 px) | **FAIL: landing @320 58 px, @360 18 px, @375 3 px** (all other pages 0) | landing @320 1 px (pre-existing), else 0 |
| headers diff (41 routes) | identical to main (0 differing) | |
Regression coverage (all 0 FAIL): buy flow with mock payments, validation errors, idempotency (duplicate webhook/checkout), webhook signature/replay, XSS/escaping, og/twitter tags, auth/ownership, legal links, X-Robots-Tag, `Cache-Control: no-store` on `/api/earnings`, 429 messages, earnings numbers for Maya, Ned and the never-paid seller.
I updated the two scripts Frontend named: `qa-fe7-mp4ui.mjs` (now asserts the new wording for flag false and true and the API 415/201) and `qa-fe7-verifstates.mjs` (asserts the exact new texts per state on every page, plus the flagged-drop behaviour).

## 7. FE-16 numbers (unchanged; `fe7-earnings-seed2.log`, `fe7-copy-seed2.log`, `fe7-perdrop-edge-seed2.log`, `fe7-dropdetail-seed2.log`, `fe7-fe1213-seed2.log`)
Maya, Ned, Sam and the never-paid chargeback seller on a clean seed, desktop and 390 px: dashboard == `GET /api/earnings` == ledger; "Sold (net)" / "Revenue (kept)" with tooltips and the reversal note; Gross hint "N sales charged, before refunds" == API `salesCount`; never-paid seller: 2 sales $40.00 charged, $20.00 kept; Ned: 1 sale $60.00, $0.00 kept, "Balance owed" copy; negative-balance alert `role="status"`, red, contrast 16.0:1 / icon 4.9:1. Screenshots `fe7-drops-maya-*`, `fe7-negative-ned*`.

## 8. Bugs
| ID | Sev | Finding | Exact repro |
|---|---|---|---|
| FE-23 | **Medium** (regression introduced by this PR) | Landing header overflows the viewport at ≤375 px: the new "Create your account" header button (166 px) is wider than "Start selling"; the page scrolls horizontally (18 px at 360, 3 px at 375, 58 px at 320) and the header CTA is cut off at the right edge. Main: 0 px at 360/375, 1 px at 320. 390 px and above are fine. Offenders: `SiteHeader` actions div (246 px wide) and the CTA `<a>`. | Open `/` at 360×800: `document.documentElement.scrollWidth` = 378 > 360. `BASE=… node qa/scripts/qa-fe7-landing-overflow.mjs`; screenshots `fe7-landing-branch-360.png` vs `fe7-landing-main-360.png`. Fix idea (not applied): shorter label in the header ("Sign up") or let the header wrap/shrink below 400 px. |
| FE-24 | Low | "Buyers check out in seconds — no accounts, no friction." still on /login and /signup (AuthShell). Contradicts "in seconds line gone"; unverifiable speed claim; the guard misses it. | `curl -s localhost:<port>/login | grep -o "check out in seconds"`; source `components/auth/AuthShell.tsx:8`. |
| FE-25 | Low (backend-owned) | The "can’t edit … for now" hint is true in the UI, but `POST /api/drops/:id/files` on a flagged drop returns **201** (a file was added to the flagged drop). Publish/unpublish are 403 `flagged`; PATCH/DELETE do not exist (405). Also no code path flags a drop and no review record exists, so "under review" is a label only. | Log in as the owner, `POST /api/drops/<flagged id>/files` with a JPEG → 201 (`qa-fe7-verifstates.mjs`, last section, `fe7-verifstates.log`). |
| FE-18c | Low-Medium (test quality, not user-visible) | The guard lets through 46 of 62 realistic false-claim mutations (paraphrases, money/fee claims incl. "Keep 90%", FAQ numbers hard-coded outside the pinned constants, support/review/trust phrasings, other languages, static string building the docs say is folded (object properties, destructuring, `+=`), unscanned top-level folders and extensions, CSS adjacent strings, SVG tspan, env-driven flag). The PR text says the guard folds static string building and scans CSS/SVG; those specific shapes are missed. | `WT=<worktree> ONLY='^(P12|S3|S5|F1|F6)$' node qa/scripts/qa-fe7-guard-mutation3.mjs` (each prints BYPASS). Full list in §4. |
| FE-18d | Low | 8 of 9 legitimate-copy probes are blocked ("Your link is ready to share.", "…expires in 60 seconds.", "Receipts are not available yet.", legal "withdraw"/"encrypt", CSV "Download", "no video"). Each needs an exact allowlist entry; real Terms/Privacy text will be affected. | `ONLY='^FP' node qa/scripts/qa-fe7-guard-mutation3.mjs`. |
| FE-26 | Info | Latent if `VIDEO_UPLOAD` is ever true: `DropEditor` still hard-codes "JPG, PNG or WebP" above the dropzone; the flag is read by the guard only as `= true`. | Flag-true build (`fe7-mp4ui-flagtrue.log` "[detail] uploader text"). |
INFO: unqualified "access to the files is shared once payment is confirmed" in meta description / Hero / HowItWorks (§3); duplicated sr-only status label inside the verification alert is read twice by screen readers ("Verification: Pending Pending …"); `FAQ` static 7-day / $25.

## 9. Plan rows and what stays blocked
Updated in `qa/unveil-v1-test-plan.md`: **M2-18 → FAIL (PR #8 head only; main PASS) due to FE-23**; notes added to M1-06, M2-03, M4-06, M4-01..M4-04, M4-09, M4-10, M4-18, M5-07, M5-16, M5-20, M2-14, M3-13, M3-14, M3-20, S2-01, S2-02. Everything else is unchanged. **Still BLOCKED:** buyer delivery / receipts (M2-12, M2-14..16, M3-13, M3-14, M3-20, S2-02), 3-D Secure / real processor (M3-04, M3-08, M3-17, M3-19), verification provider (M4-01..05, M4-07, M4-08), bank connect / payout request (M4-12, M4-13, M4-15), transaction history (M4-11), profile (M4-17), tus-style resume (M1-09), CI/HTTPS (M1-14), video upload on main (415; m2-media not merged). **M5-16 stays BLOCKED-ON-LEGAL** (Terms / Privacy / DMCA / Contact are "Coming soon." placeholders; nobody messaged).
