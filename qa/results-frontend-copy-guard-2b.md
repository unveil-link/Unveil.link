# QA results: PR #8 `frontend/copy-guard-2` round 2 (FE-23 / FE-24 / FE-26 / FE-18c / FE-18d)

Head **30d6a48** (PR #8, not merged; two new commits `13514e8` follow-up + `30d6a48` screenshots on top of 67c9b46), base **main e5b6261 (has not moved**; `git ls-remote`: main e5b6261, refs/pull/8/head 30d6a48). Previous QA commit `4cbfd94` (report `qa/results-frontend-copy-guard-2.md`). `backend/m2-media` is still not merged into main, so video upload is still 415 on the backend.
Worktrees `/workspace/qa-fe8` (branch), `/workspace/qa-fe8-main` (main), `/workspace/qa-fe8-flip` (branch with `VIDEO_UPLOAD=true`, scratch only); throwaway PG DBs, ports 4801-4803 / 4811-4813 / 4805 / 4830; all removed at the end. Scripts `qa/scripts/qa-fe8-*`, evidence `qa/artifacts/fe8/`.

## Verdict
**FE-23, FE-24 and FE-26 are fixed as claimed; M2-18 is back to PASS. No new product bug and no regression vs main** (unit 411/411, e2e 85/85, tsc / lint / build clean, 0 FAIL in every regression suite, diff vs main touches only frontend + tests). One new Info item (FE-27: header still overflows with an enlarged *user font size*; main is worse). **Every claim about the guard numbers reproduces exactly** (59/62, 3 bypasses S6/S10/S13, `^FP` = 5 allowed / 4 blocked, mutation2 45 + 3 correct passes, qa-fe5 17/18). The guard is still easy to get around: **59 of 74 new promise mutations bypass** (details §4), incl. A6/A8 (confirmed open) and a new bypass of the contact-placeholder flag (A12).

| Area | Result |
|---|---|
| FE-23 header button | **FIXED ✔**: 'Sign up' <640 px, 'Create your account' ≥640 px, same `/signup`; landing overflow 0 px at 320/360/375/390/412 (main: 1 px at 320); 310 checks OK (24 page states × 10 widths + header detail), contrast 6.72:1, accessible name correct |
| FE-23 their 16 pages × 5 widths = 80/80 | reproduced and extended: 16 public + 6 Maya + 2 Ned page states × 10 widths, all 0 px, no clipped cells |
| M2-18 | **FAIL → PASS** (plan row updated) |
| FE-24 | **FIXED ✔** 'Buyers pay by card — no account needed.' on /login and /signup; BuyerTrust 'clear and safe'; no 'in seconds'/'quick' speed claim on any rendered page or in source |
| FE-26 | **FIXED ✔** DropEditor label follows the flag (false: 'JPG, PNG or WebP', true: 'JPG, PNG, WebP or MP4'); detail label, new-drop dropzone hint and `<input accept>` agree in both builds |
| Guard: their numbers | **reproduced** (§4.1) |
| Guard: 74 NEW promise mutations | **15 caught, 59 bypass** (+1 process); 88 isolated rule phrases: 36 caught, 52 bypass; false-positive probe: 18 of 70 honest/plain strings blocked (11 of them honest legal/product sentences, 7 single words blocked by design) |
| Guard runtime / flakiness | stable: 10+5+4 runs, 157/157 each, 2.6 s (3.9 s with 4 parallel runs) |
| Re-sweep pages/meta/og/aria/email/API | no new false claim; known open items unchanged (§5) |
| Diff vs main | frontend + tests only (§6) |
| Regression vs main | **0 FAIL** everywhere (§7) |

## 1. FE-23 (`qa-fe8-header.mjs`, `qa-fe8-landing-overflow.mjs`, `qa-fe8-header-zoom.mjs`; `fe8-header.log`, `fe8-main-header.log`, screenshots `fe8-header-{branch,main}-{320,639,640,641}.png`)
| Check | Result (branch 30d6a48) |
|---|---|
| Label / width | 320, 360, 375, 390, 412, **639: 'Sign up'**; **640, 641**, 768, 1280: 'Create your account' (switch exactly at the `sm` 640 px breakpoint) |
| Target | one header link to `/signup` at every width; clicking it lands on `/signup` at all 10 widths; Hero and SellerCta keep 'Create your account' → `/signup` |
| Accessible name | role=link name is exactly the visible label (the hidden span is `display:none`, not announced; no merged 'Sign up Create your account'); aria snapshots in `branch-header-aria-*.txt` |
| Contrast | white on #4f3be8 = **6.72:1** (AA 4.5) at both labels |
| Tap target | 79×36 px (<640) / 166×36 px (≥640); passes WCAG 2.2 AA minimum (24 px), is below the 44 px guideline; 'Sign in' is also 36 px high (same Button `sm` size as main). Gap to 'Sign in' 6 px. Info only |
| Single line | label on one line at every width; right edge 300/320, 340/360, 355/375, 370/390, 392/412 (≥20 px margin) |
| Landing overflow | **0 px** at 320, 360, 375, 390, 412 (67c9b46: 58/18/3/0/0; main: 1 px at 320) |
| All other pages (login, signup, signin redirect, forgot, reset, terms, privacy, dmca, contact, buyer page, unavailable, buyer 404, 404, admin login, bad mock pay page, Maya dashboard/drops/new/drop published/draft/flagged, Ned dashboard/drops) × 10 widths | **0 px overflow, no clipped cells, 0 offenders** (310 OK / 0 FAIL) |
| Main e5b6261 | header button is 'Start selling' at every width (so the 'want' checks FAIL by design: 289 OK / 21 FAIL, all label/name checks plus the 1 px at 320) |

**FE-27 (Info / Low, not a regression, new):** the fix is width-based, not content-based. With a bigger *user font size* (root font) the header still overflows: 18 px → 7 px overflow at 320; 20 px → 44 px at 320 and 4 px at 360; 24 px → 116/76/61/46/24 px at 320/360/375/390/412. Main is worse (18 px → 41 px at 320; 24 px → 161..69 px). Page zoom (the WCAG reflow case) is fine because it is the same as the 320 px test. Repro: `TAG=branch BASE=… node qa/scripts/qa-fe8-header-zoom.mjs`, or in devtools set `html{font-size:20px}` at 320 px on `/`. Suggested: allow the header actions to wrap or hide 'Sign in' text under a hamburger; low priority.

## 2. FE-24 and FE-26
- **FE-24:** `/login` and `/signup` body: "Buyers pay by card — no account needed." ✔ true (buy flow: email only, no account; buy 67 OK). BuyerTrust: "Buying from a creator should be clear and safe." ✔. Textdump diff branch vs main (1949 lines each): only the intended wording lines differ (plus ids). Note (Info): /login and /signup now also contain "Buyers check out with a card." a few lines below, so two near-identical buyer lines appear on the same page.
- **FE-26** (`qa-fe8-mp4ui.mjs`, now with four FE-26 assertions; `fe8-mp4ui-flagfalse.log` 19 OK, `fe8-mp4ui-flagtrue.log` 16 OK, `fe8-main-mp4ui.log` 4 OK / 15 FAIL as expected):

| | Flag false (branch) | Flag true (flipped copy) | Main |
|---|---|---|---|
| New-drop dropzone hint | JPG, PNG or WebP · up to 10 files · 2 GB per drop | JPG, PNG, WebP or MP4 · … | MP4 offered ✘ |
| Drop-detail "Add files" sentence | **JPG, PNG or WebP.** They’re added to this drop right away. | **JPG, PNG, WebP or MP4.** They’re added … | hard-coded |
| `<input accept>` new vs detail | identical, images only | identical, `…,video/mp4,.mp4` | contains mp4 |
| Picked `.mp4` | rejected client-side with the new message | accepted by the client | old message |
| `POST …/files` video/mp4 | 415 | **415** (backend has no video; flipping the flag without m2-media = UI offers an upload that always fails; guard test `VIDEO_UPLOAD=true requires …` is the only protection, see A8/A16) | 415 |

## 3. Seed-sensitive FE-15/16 numbers (clean seed) and flagged drop
earnings 115 OK, perdrop-edge 69, dropdetail 6, fe1213 34, copy 95 on branch **and** main, identical to the 67c9b46 round (Maya, Ned negative balance, never-paid seller with the chargeback inside the hold). Flagged drop (FE-25) behaviour unchanged: UI shows no file inputs; `POST /api/drops/:id/files` on a flagged drop is still 201 (backend, Low, untouched by this PR).

## 4. Copy guard (FE-18c / FE-18d)
### 4.1 Their runs reproduced (`fe8-guard-mutation3.log`, `-FP.log`, `fe8-guard-mutation2.log`, `fe8-guard-fe5.log`, `fe8-npm-test.log`, `fe8-e2e.log`)
| Claim | Mine |
|---|---|
| mutation3: 59/62 promise mutations caught, S6, S10, S13 bypass | **59 caught / 3 bypass (S6, S10, S13)**, 3 should-pass correct (C1–C3), A6 passes (process) ✔ |
| `ONLY='^FP'`: 5 allowed, 4 blocked (FP5 withdraw, FP6 encrypt, FP8 'Photos only for now: no video', FP9 console.log) | **5 allowed / 4 blocked, same four** ✔ |
| mutation2: 45 caught + 3 comment-only pass | **45 caught, 0 bypass, 3 correct passes** ✔ |
| qa-fe5: 17/18 | **17 caught / 1 bypass (M18, manifest-like text via next.config.ts)** ✔ |
| tsc / lint / build clean; unit 411/411; e2e 85/85 | all ✔ (tsc rc 0, lint rc 0, build rc 0; vitest 411 passed, 16 files; e2e 85/85) |
A8 and A6 are confirmed unchanged in kind (see A15/A16 below). Note that on this branch plain mutation3 A8 (flag flip + dummy `video/mp4` backend string) is *caught*, because 21 video allowlist entries go stale; it only bypasses together with deleting those entries (A16).

### 4.2 NEW mutations `qa-fe8-guard-mutation4.mjs` (75 = 74 promise + 1 process; real `tests/copy-guard.test.ts` on a scratch copy; `ONLY='^Q4[0-9]$' VERBOSE=1 …`; log `fe8-guard-mutation4.log`)
| Group | Caught | Bypass |
|---|---|---|
| Q1–Q18 new money / payout-timing / hold / minimum / SSL / support / access rules, paraphrased | Q5 'Get paid within 48 hours', Q7 'Payouts land in two working days' | **16**: Q1 'Keep ninety percent', Q2 'Our cut is just five percent', Q3 'Zero commission', Q4 'Paid weekly', Q6 'money shows up in your account within 2 days', Q8 'A 7 day hold' (no hyphen), Q9 'held for a week', Q10 'minimum payout is twenty-five dollars', Q11 'Minimum is $25', Q12 'protected by HTTPS', Q13 'Your data is safe with us', Q14 'always here to help', Q15 'Our team will reply to every message', Q16 'Your files never expire', Q17 'Permanent access', Q18 'Buyer protection on every order' |
| L5–L12 more languages | L9 Italian | **7**: Russian, Korean, Dutch, Turkish, Arabic, Polish, German 'in Sekunden' |
| Q19–Q39 new folding / extraction | Q22 JSON.parse of a parts array (caught by the letters-only 'spacing trick' form), Q23 and Q30 (`.map(non-identity)` / `.filter` chains are reported as `dynamic-string`), Q33 reassigned `let`, Q35, Q36 children composition | **15**: Q19 same identifier declared twice in the file (**dup name disables folding file-wide**), Q34 same with destructuring, Q20 `Object.values({..}).join`, Q21 `reduce`, Q24 ternary with different branches `{big ? "In" : "Con"}stantly`, Q25 helper with parameters `j("In","stantly")`, Q26 `String.fromCharCode(...[..])`, Q27 `Buffer.from(b64,"base64")`, Q28 enum members, Q29 object method, Q31 class static, Q32 `slice(0,-1)`, Q37 **S10** variant (Tailwind arbitrary bidi classes), Q38 **S13** variant (JSON module a+b), Q39 computed dictionary key |
| Q40–Q56 scan scope (exclude-list, new extensions) | Q55 `emails/receipt.mjml`, Q56 `src/server/mail/receipt.ejs` (new extensions work ✔) | **15**: files imported from an *excluded* top-level folder: `tmp/` Q40, `build/` Q41, `out/` Q42, `docs/` Q43, `scripts/` Q44, `tests/` Q45, a dot-folder `.content/` Q46, `db/` Q47; root `promo.json` Q48 (root files: code only); not-scanned extensions: `.yaml` Q49, `.jsonc` Q50, `.po` Q51, `.svelte` Q53, `.yml` Q54; `.env.production` value read via `process.env.NEXT_PUBLIC_…` Q52 |
| Q57–Q61 honest-copy carve-out smuggling | Q61 ('Downloads are not available yet - they unlock instantly later') | **4**: Q57 'Receipts are not available yet (we email you one).', Q58 'Files land in seconds (link valid for 1 hour).', Q59 'Buyers can download the files as a CSV.', Q60 'Files arrive in seconds - retry if not.' |
| A11–A16 flags / ratchet / allowlist | A11 (flag `false as boolean` + dummy backend string: caught by the 21 stale allowlist entries), A13 new promise string in `src/app/api`, A14 appended to a baselined backend string | **A12** (contact-placeholder flag: `/contact` still a placeholder but its page imports it under an alias so `ComingSoon` no longer appears → `support-claim` rule switches off → 'Contact support if anything goes wrong' passes; the flag test passes because both sides read the same text), **A16** (= A8 in full: `= false as boolean`, dummy backend string, delete the 21 stale allowlist entries, add 'Upload your MP4 videos.' → passes while the real flag is false). **A15** = A6, passes (no review gate) |
| **Total** | **15** | **59** (+A15) |
(Bypasses of S6/S10/S13 from mutation3 still stand.)

### 4.3 Rule coverage in isolation (`qa-fe8-guard-rules.ts`, `fe8-guard-rules.log`): 88 phrases, 36 caught / 52 bypass
Per group (caught / bypass): fee 3/7, timing 8/4, literal hold/minimum 5/7, ssl-id 5/5, support 3/6, access 2/6, languages 7/12, carve-outs 3/5. The harness (§4.2) puts the phrase after the Hero sentence, which can make a neighbouring rule fire through the merged JSX run (Q5/Q7); the isolated run does not have that artefact. Additional gaps seen only here: `0% platform fee`, `You keep the lot`, `Cash lands next Tuesday`, `Money in your account by Friday`, `Payouts begin from 25 dollars`, `A one-week hold applies`, `Pending for seven days`, `HTTPS everywhere`, `AES-256 storage`, `Chat with us anytime`, `Support is available around the clock`, `Yours forever`, `Access never expires`, Portuguese `Acesso imediato`, Swedish `Direkt nedladdning`, Hindi, Japanese.
**Bug in the normaliser (GB-2, repro `qa-fe8-guard-jp.ts`):** the `instant` regex contains `すぐ`, but NFKD turns `ぐ` into `く`+U+3099, so `すぐにダウンロード` and bare `すぐ` match nothing (`即时下载`/`立即下载` are caught). Any kana with a dakuten/handakuten has the same problem.

### 4.4 False-positive surface (`qa-fe8-guard-fp.ts`, `fe8-guard-fp.log`; mutation3 `^FP`)
70 plain/honest strings through the rules: 52 allowed, 18 blocked. Blocked **honest** copy (11): `You may withdraw your consent at any time.` (bank-promise `withdraw`), `We do not guarantee that the service will be uninterrupted.` / `We make no guarantee of earnings.` / `Unveil does not guarantee …` (bank-promise `guarantee` — a normal legal disclaimer is blocked), `We encrypt passwords with bcrypt.` and `Data is encrypted in transit.` (trusted-provider `encrypt`), `Certified copies of your ID may be requested.`, `Photos only for now: no video.` and `Video is not supported yet.` (video-claim — the honest 'no video' wording is blocked), `Available balance can be requested once it clears the 7-day hold.` (hard-coded-payout-number; must be `${PAYOUT_HOLD_DAYS}`), `Delivery options are coming soon.` (needs its exact allowlist entry; allowed only where listed). Seven plain single words (`Download`, `Deliver`, `Delivered`, `Receipt`, `Instantly`, `Instant`, `Withdraw`) are blocked by design. Allowed and correct: reset-link-expiry, retry-in-seconds, 'Receipts are not available yet', 'Download your sales as CSV', DMCA/ToS/cookie/refund sentences, pricing/limits copy, 'Buyers pay by card — no account needed.'. The four honest strings Frontend mentions still have no allowlist entry (they are blocked; the rule-level carve-outs only cover single-clause negatives for receipt/email/download/in-seconds): when real legal pages ship (M5-16) the authors will have to allowlist them one by one or reword; with the current `BENIGN` carve-outs a negative like 'X is not available' passes, which is also what Q57–Q60 abuse (a parenthesis, dash or "valid for/retry" in the same clause is enough).

### 4.5 Runtime and flakiness (`qa-fe8-guard-flaky.sh`, `fe8-guard-flaky.log`)
`copy-guard` + `copy-guard-mutation` = 157 tests: 10 sequential runs 2.56–2.68 s each (wall 3.3–3.4 s); 5 `--sequence.shuffle` runs and `--root` from another cwd all green; 4 parallel runs 3.8–4.0 s each, all green. Whole `npm test` 54 s under load (411/411). **No flakiness observed (0 of 20+ runs).** Also `qa-fe8-guard-flags.ts` (`fe8-guard-flags.log`): VIDEO_UPLOAD is "possibly true" for `false /* c */;`, `(false)`, `!true`, `false satisfies boolean`, and `false` without a semicolon at EOF (fail-closed but fragile: harmless refactors will fail the stale-allowlist test); a re-export alias reads as false; the contact placeholder is detected by the text 'ComingSoon'/'Coming soon' only (A12, and 'Not available yet' wording would also switch the support rule off).

### 4.6 Guard bugs (severity is for the guard as a safety net; none changes the product today)
| ID | Sev | Repro | Note |
|---|---|---|---|
| GB-1 | Medium | `qa-fe8-guard-rules.ts` / mutation4 Q1–Q18 | New money, timing, hold, minimum, SSL/ID, support, access rules each miss obvious paraphrases (spelled-out numbers, 'a 7 day hold', 'held for a week', 'Minimum is $25', 'HTTPS', 'always here to help', 'never expire', 'Permanent access', 'Paid weekly') |
| GB-2 | Medium | mutation4 L5–L12; `qa-fe8-guard-jp.ts` | New languages cover ES/FR/DE-ish/IT/ZH but not RU, KO, NL, TR, AR, PL, PT-'imediato', SV, HI; Japanese `すぐ` rule never matches because of NFKD (bug) |
| GB-3 | Medium | mutation4 Q19–Q39, S6, S10, S13 | Folding: duplicate identifier names disable folding for the whole file (easy to trigger on purpose); helpers with params, `Object.values`, `reduce`, enums, class statics, object methods, spread into `fromCharCode`, `Buffer`, ternaries with different branches still unresolved; bidi CSS reversal (S10), props composition (S6), JSON module parts (S13) |
| GB-4 | Medium | mutation4 Q40–Q54 | Exclude-list: any file under `tmp/ build/ out/ docs/ scripts/ tests/ db/ …` or a top-level dot-folder can be imported by app code unscanned; root non-code files; `.yaml .yml .po .jsonc .svelte …`; `.env*` values |
| GB-5 | Low | mutation4 Q57–Q60 | Honest carve-outs (`BENIGN`) drop a rule for the whole sentence when it merely contains a negative/'valid for'/'retry'/'csv'; a promise in parentheses or after a dash rides along |
| GB-6 | Medium | mutation4 A12 | Contact-placeholder flag is a text match on the page; alias/reword disables the support-claim rule (no test ties it to the route being real) |
| A6 / A8 | Medium (process) | mutation4 A15 / A16 | Allowlist edit approves anything (no CODEOWNERS / required review); flag flip needs any `video/mp4` string in the backend (A16) |
| FP | Low | §4.4 | Honest legal/product copy blocked: withdraw, guarantee (disclaimer), encrypt(ed), certified, 'no video', '7-day hold' |

## 5. Re-sweep of copy (`qa-fe8-textdump.mjs` → `fe8-textdump-{branch,main}.txt`, `qa-fe8-copyaudit.mjs` → `fe8-copyaudit-{branch,main}.json`, 31 pages × states, meta/og/twitter/aria/alt/title/placeholder, reset e-mail path, manifest/robots)
- Diff branch vs main (text): only intended changes (CTA labels, 'in seconds' removed from landing subtitle/AuthShell, 'quick' → 'clear', signup subtitle, upload note, verification texts, file-types label).
- No instant / seconds / quick / receipt / download-link / unlock / support / person / team / ETA promise for buyers or sellers. copyaudit hits (6) are the honest 'Delivery options are coming soon.' (landing, buyer page ×2), the forgot-password 'we’ll send you a reset link' (true) and 'They’re added to this drop right away.' (seller upload, true).
- **Still open (Info, unchanged, as Frontend says): "access to the files is shared once payment is confirmed" without 'Delivery options are coming soon'** in the meta description (36 page states), Hero and HowItWorks step 3; no download page yet. Must be fixed before launch.
- **FE-25 (Low, backend-owned) unchanged**: upload to a flagged drop via API = 201.
- Carried Info: 'Verified creators', 'Secure checkout', 'Secure card checkout', 'Private by design' and 'We never store card numbers' are accurate for the mock only; verification provider and real processor are not integrated (M4-01..08, M3-04/08/17/19 BLOCKED).
- 'All sales are final … purchases can't be refunded or exchanged' (buyer page) is a policy statement, not a feature; the ledger does support refunds/chargebacks (admin/webhook), so legal should confirm wording (M5-16).
- Emails: only the password-reset mail exists (unchanged, backend untouched); no receipt/delivery mail (M3-13/14 BLOCKED).

## 6. Diff vs main e5b6261 (`git diff --name-only e5b6261 30d6a48`)
23 non-screenshot files + screenshots (84 files, +1098/−177): `components/{auth/AuthShell, dashboard/FileDropzone|NewDropFlow|PublishDialog|types, landing/BuyerTrust|Hero|HowItWorks|SellerCta|SiteHeader}.tsx`, `lib/upload-limits.ts`, `src/app/components/{AuthForm,DropEditor}.tsx`, `docs/frontend-dashboard-notes.md`, `scripts/{e2e.ts,screenshots-dashboard.mjs}`, `tests/{copy-guard,copy-guard-mutation,frontend-copy}.test.ts`, `tests/copy-guard.allowlist.ts`, `tests/helpers/{copy-scan,guard,qa-mutations}.ts`. **Nothing** under `src/server`, `src/app/api`, `db/`, money/pricing/ledger/payout files, `lib/features.ts`, `package.json` or `package-lock.json` (no new dependency). Allowlist: 45 entries (same count as 67c9b46; one entry became the tail '. They’re added to this drop right away.').

## 7. Regression vs main (branch / main, clean seeds; logs `fe8-<suite>.log`, `fe8-main-<suite>.log`)
fixes 90/90 · buy 67/67 · buyerr 18/18 · back 2/2 · fees 16/16 · journey 4/4 · misc 9/9 (download 429 default limits, throttled-4G, secrets in bundle, branding) · regress 55/55 · reg-meta 17/17 (og tags) · reg-modal 52/52 · reg-duration 93/93 (429 messages) · boundary 20/20 · ned-netting 3/3 · webhook 6/6 (invalid signature, replay ×3 = one credit) · payout-ui 7/7 · claims 56 (main 51 + 5 expected FAIL for the old wording) · verifstates 90 (main 60 + 30 expected FAIL) · mp4ui see §2 · flagged-ui identical · headers diff 41 routes identical (X-Robots-Tag on /u/*, /terms, /contact; `Cache-Control: no-store` on /api/earnings; legal links; `fe8-headers-explicit.txt`) · earnings 115, perdrop-edge 69, dropdetail 6, fe1213 34, copy 95 (both) · e2e 85/85 · `npm test` 411/411 · tsc/lint/build clean. XSS/escaping, idempotency, validation, auth/ownership are inside buy/buyerr/regress/e2e and all green.

## 8. Still BLOCKED
Buyer delivery / receipts (M2-12, M2-14–16, M3-13/14/20, S2-02); processor-dependent M3-04/08/17/19; verification provider M4-01–05, 07, 08; payouts / bank M4-12/13/15; M4-11, M4-17, M1-09, M1-14; video upload on main (m2-media unmerged); **M5-16 BLOCKED-ON-LEGAL** (placeholders, nobody contacted).
