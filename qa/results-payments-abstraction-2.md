# Unveil QA results — `payments/abstraction`, run 2 (fix verification)

- **Date:** 2026-10-01 10:43–11:25 ET
- **Branch tested:** `origin/payments/abstraction` @ **`a83c40f1077b503aee85dada1341d8470f192ed6`** (fast-forward from `af475d0`, round 1).
- **Env:** clean detached worktree `/workspace/qa-pay2`; Node 20.19.2, PostgreSQL 17; `npm ci`; throwaway DBs `unveil_qa_pay2` (main), `unveil_qa_pay2_up` (migration upgrade test), `unveil_e2e_qapay2` (e2e); own storage/mail dirs, random secrets; servers on 3617 (checkout limiter raised) and 3618 (default limits), production-mode probes on 3619–3629, e2e on its own ports. Built with `NODE_ENV=production next start`, `MOCK_PAYMENTS_ENABLED=1`, loopback `APP_URL` (the documented e2e exception). No other worker's DB/port/process touched. App source not modified.
- **Re-run:** `. qa/scripts/qa-pay-env.sh && npx tsx qa/scripts/qa-pay-<money|webhooks|refunds|checkout|payouts|prod|races|session|retry|r2a|r2b|r2c|r2d>.ts`, `node qa/scripts/qa-pay-ui.mjs <base> <link>`, `node qa/scripts/qa-pay-dblclick.mjs <base> <link>`, `qa/scripts/qa-pay-mig.sh unveil_qa_pay<x>`. Scripts refuse to run unless `DATABASE_URL` is a `unveil_qa_pay*` DB. Round-2 evidence is under `qa/artifacts/pay2-*` (round-1 evidence `pay-*` is untouched in history at `7c4b8fd`).
- **New round-2 probe scripts:** `qa-pay-r2a.ts` (BUG-1/2/3/4, 31 probes), `qa-pay-r2b.ts` (BUG-6/7, expiry, void+refund, invariants, 24), `qa-pay-r2c.ts` (BUG-8 config matrix, 34), `qa-pay-r2d.ts` (reuse/idempotency/leak edge cases, 10), `qa-pay-mig.sh` (migration 007), plus updated browser scripts.

## Headline
**All 8 round-1 bugs are FIXED** with their original repros. **No new MEDIUM/HIGH bugs.** One new LOW (privacy: pending-checkout reuse is an email oracle) and several INFO notes. Totals: **plan cases PASS 18 / FAIL 0 / BLOCKED 14**; **244 probes: 241 PASS / 0 FAIL / 3 BLOCKED**, plus 6 manual migration checks (all PASS) and the PAN/CVC grep. Baseline: typecheck/lint clean, `npm test` 140/140, `npm run e2e` 69/69 (second run; see anomaly).

## Baseline suite (a83c40f)
| Check | Expected | Result |
|---|---|---|
| `npm ci` | clean | OK, 0 vulnerabilities |
| `npm run migrate` | 001–007 | **applied 001–007** |
| typecheck (after `next typegen`) | clean | **clean** |
| lint | clean | **0 errors**; 2 warnings are unused `eslint-disable` directives in my own QA scripts |
| `npm test` | 140 | **140/140** (`pay2-npm-test.log`) |
| `npm run e2e` | 69 | run 1: **41/69**, every failure `fetch failed` starting at the `[#13]` checks and including all `[pay]` checks — **not** the known login-delay flake pattern; I was running a `next build` concurrently on the same box, so I believe it is environmental, but I could not confirm it (INFO, flagged rather than explained; log `pay2-baseline-e2e.log`). Run 2 on an idle box: **69/69** (`pay2-baseline-e2e-run2.log`). |

## Per-bug verdicts (original repros re-run against a83c40f)
| Bug | Verdict | Evidence |
|---|---|---|
| **BUG-1** checkout idempotency | **FIXED** | 12 concurrent identical checkouts → 1×201 + 11×200 `reused:true`, 1 row. 12 concurrent with same `Idempotency-Key` → 1 txn. Sequential replay → 200. Same key on a different drop → 409 `idempotency_key_reused`. Keys namespaced per buyer email (no cross-seller/cross-buyer collision). 128-char key OK, 129 → 400, spaces/control/unicode → 400, whitespace-only → treated as no key. Paid txn is never reused; a keyed replay after payment returns the succeeded txn (200). Expired keyed txn releases its key. 60 mixed concurrent requests → 0×5xx, 0 duplicate pendings; 100 concurrent in 395 ms. Pay double-submit → 1 charge; real-browser double-click → 1 POST, 1 txn (`pay2-dblclick.log`). (`pay2-r2a`: BUG-1a…1n) |
| **BUG-2** burned dedupe key | **FIXED** | Wrong amount → rejected, then correct event (same processor txn id, new event id) → processed. Same after `ignored` and after `unknown_transaction`, and after currency mismatch. 3 wrong events then 8 concurrent correct → exactly 1 posting. Genuine duplicates unchanged (12 concurrent → 1 processed + 11 duplicate). Old failing IDEM-5b, IDEM-5d now PASS (`pay2-r2a` 2a–2g; `pay2-old-webhooks.log`). |
| **BUG-3** NUL → 500 | **FIXED** | NUL in `data.reference`, event id, transaction_id, related id, failure_code, currency → **400 `invalid_payload`**, rejected row logged (no stack/PII), no state change, no claim left, legit sale afterwards processed. Lone surrogate and >512-char strings → 400; valid emoji/astral accepted; invalid payloads are IP rate-limited (60×400 then 429). (`pay2-r2a` 3a–3c, `M3-12 retry`.) Note: the `created` field is only parsed as a date and never stored, so NUL there is harmless (200). |
| **BUG-4** chargeback flagging | **FIXED** | 2 chargebacks → not flagged. 3rd → `risk_flagged_at` set, one `audit_log` row, `verification_status` unchanged, seller still purchasable (flag only; no auto-ban). Replay of the same chargeback event does not double count; refunds don't count. 91-day-old chargebacks not counted, 89-day-old counted (ledger `created_at` backdated in my throwaway DB). 4 simultaneous and 18 cross-seller concurrent chargebacks → flagged once, no deadlock/5xx. Chargebacks parked before the sale flag when the sale lands. threshold=1 flags on the first. CHECK constraints reject bad settings. (`pay2-r2a` 4a–4g.) |
| **BUG-5** "all sales final" | **FIXED** | `data-testid="sales-final"` present on `/u/<link>` (rendered above the Buy button on a 390 px viewport) and on the hosted `/pay/mock/<session>` page: "All sales are final. Because this is a digital product delivered immediately, purchases can't be refunded or exchanged once completed." (`pay2-ui.log`, screenshots `pay2-ui-*.png`; HTML checks BUG-7d). M3-18 → PASS. |
| **BUG-6** stale pending sessions payable | **FIXED** | After checkout started: seller verification `failed` → hosted pay refused (`failed/unavailable`, "no longer available… You have not been charged"), 0 ledger lines; drop `unpublished`/`flagged`/`draft` → same; 30-day-old txn → `session_expired`; 29 min → payable, 31 min → refused; real-time TTL=1 min: pay at 55 s succeeds, at 63 s refused (`session_expired`); `expirePendingCheckouts()` sweeps only >TTL pending rows. Webhook-path (valid signature) success for an invalid session is **voided** — see VOID block below. SESS-1/2/3 (the round-1 failing repros) now PASS. (`pay2-r2b` BUG-6a–6f, VOID-1…10.) |
| **BUG-7** decline terminal + raw codes | **FIXED** | Declined session can be paid again (all decline classes: `0002`, `9995`, `0069`, `0127`, unknown, garbage): friendly copy ("Your card was declined. Please try a different card."), no raw code in message, status API or HTML; status API `{status, retryable, message}` (keys `amountCents,message,retryable,status,transactionId`; no `failureCode`). 3 declines then success on one session → each attempt processed separately, exactly 1 posting; a decline after success does not flip it. Expired/unavailable sessions are `retryable:false` with friendly text. Real browser: decline copy friendly, retry on same session → "Payment succeeded (mock)". (`pay2-r2b` BUG-7a–7d, `pay2-ui.log`.) Note: the dev simulator's own JSON still carries `failureCode`; it is dev-only (404 in prod). |
| **BUG-8** mock allowed outside prod | **FIXED** | 34-case matrix (`pay2-r2c`) on `config.mockPaymentsAllowed` plus live servers (`qa-pay-prod`, PROD-1…8). **Denied**: `NODE_ENV` unset, `staging`, `Production`, `prod`, `Development`, `development ` (trailing space), empty; production without the flag; flag `true`/`0`/` 1`; old `MOCK_PAYMENTS_LOCAL_BUILD=1` (no longer honoured); flag=1 with public `APP_URL`, `localhost.evil.com`, `localhost@evil.com`, `127.0.0.1.evil.com`, `evil.com/localhost`, `localhost:80@evil.com`, `evil.com#@localhost`, `evil.com/?h=localhost`, `0.0.0.0`, `127.0.0.2`, garbage and empty `APP_URL`. Live servers: checkout 503, valid-signature webhook 503 (tx stays pending, 0 ledger), dev pay 404, mock page 404. **Allowed (by design)**: `development`/`test`; production+flag=1+loopback `APP_URL` (`localhost`, `127.0.0.1`, `[::1]`). INFO: `http://127.1` (short loopback form) and unset `APP_URL` + flag=1 are also allowed — both effectively loopback, no action needed. |

## Void / late-success path (new behaviour; M3-12/M5 related)
`pay2-r2b` VOID-1…10, all PASS:
- Valid-signature success for a session whose seller is unverified / drop unpublished or flagged / session older than TTL+24 h → `200 processed detail=voided:<reason>`, tx `failed/invalid_at_capture`, `review_reason` = `seller_not_verified | drop_unavailable | session_expired`, `refund_requested_at` set, **0 ledger lines**, seller balance unchanged, buyer status message "…If you were charged, the payment is being refunded.", nothing downloadable (status ≠ succeeded).
- Success for a session that expired 60 min ago (within the 24 h grace) → honoured: `succeeded`, 3 ledger lines.
- Replay → `duplicate`; new event id → no second void; 10 concurrent late-success deliveries → exactly 1 processed, 1 refund request, ledger 0, no 5xx. A later `sale_failed` is ignored; the processor's refund webhook → `void_refund_confirmed` with **no ledger change**; chargeback on a voided txn → recorded as `void_refund_confirmed`, no ledger.
- `retryVoidRefunds()` re-requests only rows with `refund_requested_at IS NULL`, once.
- 20 pay-vs-expiry-sweep-vs-status races at 29 min 59.9 s: 0 inconsistent rows (succeeded ⇒ 3 lines, failed ⇒ 0), 0×5xx.
- Invariants over all 257+ settled txns: `gross == platform + processing + seller_net`, no negatives, `reversed ≤ amount`, no ledger on pending/failed, no duplicate pending per (drop, lower(email)), unrefunded ledger sums to `seller_net`; earnings `balance == Σ ledger`.

## Migration 007 (`qa/scripts/qa-pay-mig.sh`, `pay2-migration.log`)
| Check | Result |
|---|---|
| Upgrade 006 → 007 with data (4 duplicate pending txns for one drop+buyer incl. case-variant emails, another drop, another buyer, failed + succeeded txn with 3 ledger rows) via `npm run migrate` | **PASS** — oldest 3 duplicates retired as `failed/superseded` (newest-by-`created_at,id` kept), other pendings/failed/succeeded untouched; ledger 3 rows / sum 1360 unchanged; settings defaults 30/1440/3/90; all 5 indexes built |
| Re-run `npm run migrate` | **PASS** — "up to date" |
| 007 SQL applied manually 2 more times | **PASS** — idempotent (only NOTICEs), no data change |
| Failure mid-migration (appended `SELECT 1/0` to a copy) | **PASS** — whole file rolled back: 007 not recorded, 0 new columns left; clean re-apply afterwards |
| Rollback | No down migration ships (INFO, consistent with 001–006). The additive DDL is rolled back cleanly inside a transaction; manual down + re-upgrade preserved ledger and txns |
| Unique pending index under concurrency | **PASS** — 100 concurrent / 60 mixed / 12 identical checkouts: 0×5xx, 0 duplicates (advisory lock + index backstop); pay-vs-expiry races 0 inconsistencies |

## Assertions changed in my scripts (declared by-design changes) — each noted
| Case | Old assertion | New assertion |
|---|---|---|
| M3-03e | declined session terminal (second attempt rejected) | second attempt on the same declined session **succeeds** |
| PRICE-1 | second same-email checkout → 201 | first 201, second same email+drop → **200 `reused:true`** (same txn) |
| REF-6 / M3-07 | N checkouts for one buyer produce N txns | `checkout()` helper now uses a **unique buyer email per call**; same drop+email intentionally shares one pending txn |
| M3-12 retry | NUL in event id → 500 | → **400 `invalid_payload`**, no claim |
| AUTHZ-2 | status API keys include `failureCode` | keys = `amountCents,message,retryable,status,transactionId` |
| CB-1 / M5-08 | no flag after repeated chargebacks (BUG-4 repro) | flag set at the **3rd** chargeback in 90 days, none before |
| RL-1 | first 10 checkouts → 201 | first 10 → 200 or 201 |
| PROD-8 | `NODE_ENV=staging` allowed mock (BUG-8 repro) | → `mockPaymentsAllowed=false` |
| UI M3-18 / M3-03 UI / retry | missing text; raw code shown; retry rejected | text present; friendly copy, no raw code; retry on same session succeeds |
| Harness | env `MOCK_PAYMENTS_LOCAL_BUILD`, ports 35xx | `MOCK_PAYMENTS_ENABLED`, ports 36xx. Payout/refund scripts set `process.env.MOCK_PAYMENTS_ENABLED=1` because their in-process service calls run with `NODE_ENV` unset, which is now default-deny ("Payments are not available") — expected, not a bug |

## Plan-case summary (32 rows in scope)
| Group | PASS | FAIL | BLOCKED | Change vs round 1 |
|---|---|---|---|---|
| M3 (20) | 13 | 0 | 7 | M3-18 FAIL → PASS |
| M4 (M4-09, 13, 14, 15, 16) | 2 | 0 | 3 | — |
| M5 (M5-05, 06, 07, 08) | 2 | 0 | 2 | M5-08 FAIL → PASS |
| S2 (S2-02, 03, 05) | 1 | 0 | 2 | — |
| **Total** | **18** | **0** | **14** | PASS 16→18, FAIL 2→0 |

## Per-case table updates
| ID | Result | Evidence |
|---|---|---|
| M3-01 | PASS | unchanged; re-run (`pay2-old-checkout.log`, UI) |
| M3-02 | PASS (status) | unchanged; redirect to download still BLOCKED (not built) |
| M3-03 | **PASS** | declines still book nothing; R2: session is **payable again** (M3-03e assertion changed) and buyer text is friendly, no raw code |
| M3-04 / 08 / 13 / 14 / 17 / 19 / 20 | BLOCKED | unchanged (see BLOCKED list). M3-19 "no card data stored/logged" half re-verified: pg_dump of the whole QA DB and all server logs contain none of the 6 test PANs; no CVC values (only the strings `incorrect_cvc` as failure codes) |
| M3-05, 06, 07, 09, 10, 11 | PASS | re-run (money 11/11, webhooks 45/45, 17 signature variants 401, idempotency 3×/12×) |
| M3-12 | PASS | out-of-order/parked/concurrent all still pass; NUL now 400 (by design) |
| M3-15, 16 | PASS | re-run |
| **M3-18** | **PASS** (was FAIL) | sales-final text on link page and hosted checkout (BUG-5) |
| M4-09 | BLOCKED | no dashboard UI on this branch (API verified; also R2 leak check: `/api/earnings` has no idempotency key / checkout URL / review fields) |
| M4-13, 14 | PASS (service) | payouts 13/13 re-run: min / hold / double-spend |
| M4-15, 16 | BLOCKED | no seller/admin routes |
| M5-05, 06 | BLOCKED | no admin refund route; webhook-driven refunds 16/16 + sequences re-run PASS |
| M5-07 | PASS | re-run |
| **M5-08** | **PASS** (was FAIL) | flag at 3 chargebacks in 90 days (BUG-4); audit row; no auto-ban |
| S2-02 / S2-05 | BLOCKED | download/receipt not built |
| S2-03 | PASS | re-run |

## New bugs / findings
| # | Severity | Finding | Repro |
|---|---|---|---|
| NEW-1 | **LOW** (privacy) | Reuse-pending makes `POST /api/checkout` an oracle for "does buyer X have a live purchase intent on drop Y" and hands any caller the victim's live `checkoutUrl`/transaction id. No secret, cookie or IP binding is needed. A third party can also complete or decline the victim's session (txn would then settle under the victim's email). Impact is limited: only that drop at that session's price, no download exists, sessions expire in 30 min. | `POST /api/checkout {linkId, email: victim, confirmOver18:true}` from client A (201), then the same body from client B (different IP/cookies) → 200 `reused:true` with A's `checkoutUrl`. Suggest returning a fresh session id/URL (or binding reuse to the creating browser cookie), still reusing the same txn row. (`pay2-r2d` REUSE-5/6) |
| INFO-1 | INFO | A reused pending txn keeps the **old price** after a seller changes the price, for up to 30 min: the link page shows the new price while the hosted page charges the old one; settles at the old price (snapshot semantics, consistent with fee snapshots). Other buyers get the new price. No price-edit API exists on this branch (changed via SQL). | create checkout at $20; `UPDATE drops SET price_cents=9000`; same buyer re-checkouts → same txn at $20 (`REUSE-4`) |
| INFO-2 | INFO | Reuse at 29 min hands the buyer a URL with ~1 min left. | `REUSE-2` |
| INFO-3 | INFO | Nothing schedules `expirePendingCheckouts()` or `retryVoidRefunds()` (only lazy expiry on checkout/status/pay, plus a manual ops hook). If the processor refund call fails after a void, nobody retries it until something calls `retryVoidRefunds()`. | `grep -rn retryVoidRefunds src` → only definition and a comment |
| INFO-4 | INFO | Voided (`failed/invalid_at_capture`) txns appear in the seller's `GET /api/earnings` `recent` list as `failed`; no admin screen lists `review_reason` txns or flagged sellers. | `VOID-8` |
| INFO-5 | INFO | Over-refund and other rejected events (valid signature) each write a `webhook_events` row (50 events → 50 rows; ledger unchanged); invalid-signature/invalid-payload floods are IP rate limited (60/min). | r2a |
| INFO-6 | INFO | No down migration for 007 (same as earlier migrations). | `pay2-migration.log` |
| INFO-7 | INFO | e2e run 1 produced 41/69 `fetch failed` while a concurrent build ran; unexplained but not reproduced (run 2: 69/69). Worth one more look if it recurs in CI. | `pay2-baseline-e2e.log` |

No regressions found in the earlier suite (money, 17 signature variants, out-of-order, refund sequences, payouts, authz isolation, rate limiter, PAN/CVC).

## Remaining BLOCKED by owner
- **Backend/Payments:** download/unlock delivery after purchase, receipt email and receipt re-access (M3-02 redirect, M3-13, M3-14, M3-20, S2-02, S2-05 receipt). R2 void path currently has "no download" only trivially; re-test "voided buyer gets no download" when delivery lands.
- **Backend/Admin:** routes for seller payout request, admin approve/paid/failed, admin refund, payout history, platform-settings API (M4-15, M4-16, M5-05, M5-06; M3-07 via admin); admin view of flagged sellers (`risk_flagged_at`) and review txns (`review_reason`); a scheduler/cron for `expirePendingCheckouts` and `retryVoidRefunds`.
- **Payments + business/processor accounts:** real processor sandbox — 3-D Secure (M3-04), live $1 charge (M3-08), hosted card fields (M3-19), Segpay/CCBill choice + fee docs (M3-17).
- **Frontend:** dashboard earnings UI (M4-09; API ready).

## Cleanup
Servers started by this run (3617, 3618, 3619–3629, e2e ports) stopped; no 36xx listeners remain. Throwaway DBs `unveil_qa_pay2`, `unveil_qa_pay2_up`, `unveil_e2e_qapay2` dropped (`unveil_paytest_payments` is created/dropped by `npm test` itself). No other DB or process touched.

## Appendix: all round-2 probe results (JSON under `qa/artifacts/`)

### Old suite re-run against a83c40f
| ID | Result | Evidence |
|---|---|---|
| M3-01 | PASS | 201 + hosted card page 200 (no cookies sent) |
| M3-02 | PASS | tx 89f69aa9 succeeded/null |
| M3-03a | PASS | tx 458b0f9a failed/card_declined |
| M3-03b | PASS | tx b77b2f49 failed/insufficient_funds |
| M3-03c | PASS | tx 7dd9371c failed/expired_card |
| M3-03d | PASS | tx 3e063034 failed/incorrect_cvc |
| CARD-x | PASS | tx 80a09c29 failed/unrecognized_test_card |
| CARD-y | PASS | tx d6cd54eb failed/invalid_card_number |
| CARD-z | PASS | tx 9f1a0401 succeeded/null |
| M3-03e | PASS | second attempt on same session after decline → succeeded, 3 ledger lines (R2 assertion changed: was terminal) |
| M3-15 / AGE-1 | PASS | undefined:400 false:400 "true":400 1:400 null:400 "on":400 [true]:400 |
| M3-15 / AGE-2 | PASS | buyer_confirmed_18_at set; checkbox required |
| EMAIL-1 | PASS | "":400 " ":400 "plain":400 "a@":400 "@b.com":400 "a b@c.com":400 "a@b":400 "<script>@x.com":400 "a@b.com\r\nBcc: x:400 "xxxxxxxxxxxxxxxxx:400 \| valid → lowercased, trimmed |
| PRICE-1 | PASS | all tamper fields ignored → 2000/200/1560 pending |
| PRICE-2 | PASS | checkout amount 1500 (DB price); note: no PATCH /api/drops/:id on this branch |
| DROP-1 | PASS | draft/dropId:404 unpublished/linkId:404 unpublished/dropId:404 flagged/linkId:404 flagged/dropId:404 malformed:400 unknown:404 both-ids:400 unverified-seller:409 |
| DROP-2 | PASS | payment on a now-unpublished drop's pending session → failed (note: money captured for an unlistable drop; no download delivery exists to honor it) |
| DROP-3 | PASS | status failed (flagged drop can still be paid from an earlier session - NOTE) |
| DUP-1 | PASS |  |
| DUP-2 | PASS | same tx |
| DUP-3 | PASS | one charge; webhook outcomes [{"outcome":"duplicate","count":"1"},{"outcome":"processed","count":"1"}] |
| DUP-4 | PASS | succeeded/3 succeeded/3 succeeded/3 succeeded/3 succeeded/3 succeeded/3 |
| M3-19 / PAN-1 | PASS | pg_dump (622 KiB) and app logs contain no PAN; only payload hashes/fixed fields stored in webhook_events |
| M3-19 / PAN-2 | PASS | mock page → same-origin /api/dev/payments/pay with card in body (dev-only, 404 in prod); acceptable for mock, M3-19 for real processor BLOCKED until Segpay/CCBill |
| PAN-3 | PASS | 409 webhook_events rows scanned, 0 card-like numbers (long digit runs seen were uuid/hex fragments and a 1e12 amount) |
| M3-16 / RL-1 | PASS | codes 201,200,200,200,200,200,200,200,200,200,429,429,429, Retry-After 60, other IP 201 |
| RL-2 invalid requests count | PASS | 400,400,400,400,400,400,400,400,400,400,429,429 |
| RL-3 XFF spoof (note) | PASS | rotating single XFF: 201,200,200,200,200,200,200,200,200,200,200,200,200,200,200 (no 429 → trivially bypassable when app is NOT behind a proxy that overwrites XFF); prepended spoof with fixed right-most: 200,200,200,200,200,200,200,200,200,200,429,429,429 |
| AUTHZ-1 | PASS | A total 1560, B total 2340; sellerId param ignored; no emails |
| AUTHZ-2 | PASS | ok |
| SEC-3 checkout injection | PASS | 400 400 400 201 200 nonjson:400 text/plain:200 |
| SEC-4 CSRF/origin | PASS | 403 |
| M3-06/MONEY-1 | PASS | 698614 (amount, rate) cases, 0 mismatches vs reference, 0 negative, 0 non-integer |
| M3-05/MONEY-2 | PASS | 99→77/10/12 999→779/100/120 1999→1559/200/240 49999→38999/5000/6000 100→78/10/12 50000→39000/5000/6000 |
| MONEY-3 | PASS | half-up verified on both fees; seller absorbs remainder |
| MONEY-4 | PASS | 6000 random sequences exact; 999×1¢ refunds reverse exactly net 779 |
| MONEY-5 | PASS | rejects floats/negatives/NaN/inf/unsafe and malformed percents |
| M3-05/M3-06 e2e | PASS | 13 prices OK (net/plat/proc): 100:78/10/12 101:79/10/12 199:155/20/24 999:779/100/120 1000:780/100/120 1999:1559/200/240 2000:1560/200/240 3333:2600/333/400 4999:3899/500/600 12345:9629/1235/1481 49999:38999/5000/6000 50000:39000/5000/6000 777:606/78/93 |
| M3-06 bounds | PASS | 99→400, 50001→400, 999.5→400, -5→400 |
| M3-07/S2-03 | PASS | pending tx snapshot 200/240/1560 stays after settings change & settles at 1560; new tx @15%/3% = 300/60/1640 |
| MONEY-6 | PASS | 101 rejected, -1 rejected, proc 100.5 rejected |
| MONEY-7 | PASS | 999¢ @100%/12% → net 0 plat 879 proc 120 |
| MONEY-8 | PASS | ledger_entries.amount_cents:integer, payouts.amount_cents:integer, transactions.amount_cents:integer, transactions.platform_fee_cents:integer, transactions.processing_fee_cents:integer, transactions.reversed_cents:integer, transactions.seller_net_cents:integer |
| M3-09 / HOLD-1 | PASS | pending 1560 available 0; hold 7.000d |
| M4-13 | PASS | 2499→below_minimum_payout, 0→nothing_available, -100→nothing_available, 25.5→nothing_available; exactly 2500 accepted |
| M4-13b | PASS | below_minimum_payout |
| M4-14 | PASS | over-request insufficient_available_balance; default payout 3900 (available only); pending 3900 untouched |
| M4-14b | PASS | 0 available / 3900 pending |
| M4-14c | PASS | observed: payable immediately with hold_days=0; per-sale hold only (no distinct first-payout rule) — NOTE |
| M4-15a | PASS | balance 7800→2800; statuses requested→approved→paid; illegal transitions → bad_payout_state; earnings.paidOutCents 5000. NOTE: no HTTP route to request/approve payout (service functions only) |
| M4-16 | PASS | reserve 3000 → fail → 3900 restored; approved→failed also restored; admin-visible via payouts.failure_reason (NOTE: no admin UI/route) |
| PAYOUT-CONC-1 | PASS | 1 ok / 7 rejected (OK,insufficient_available_balance); available 900 |
| PAYOUT-CONC-2 | PASS | OK,nothing_available |
| PAYOUT-CONC-3 | PASS | payout:OK refund:processed sale:sold final available 0 total 0 (negative allowed only via refund after payout) |
| PAYOUT-INV-1 | PASS | 35 sellers reconcile; UPDATE blocked, DELETE blocked, TRUNCATE blocked |
| M4-09 | PASS | NOTE fees in summary are NET of fee shares returned on refunds (reported 1430 vs 2640 on transactions rows); identity gross−refunds−chargebacks−fees==balance holds. gross 11997, refunded 500, chargebacks 4999, balance 5068 |
| PROD-1 (M3 / mock disabled) | PASS | {"checkout":503,"webhook":503,"pay":404,"page":404} |
| PROD-2 | PASS | {"checkout":503,"webhook":503,"pay":404,"page":404} |
| PROD-3 | PASS | http://localhost.evil.com:ok http://localhost@evil.com:ok http://127.0.0.1.evil.com:ok http://evil.com/localhost:ok |
| PROD-4 (config residual risk) | PASS | exception works (201) — only when both flag and loopback APP_URL are set |
| PROD-5 missing/short secret fails closed | PASS | 31ch:503/503 0ch:503/503 5ch:503/503 |
| PROD-6 unknown PAYMENT_PROVIDER | PASS | 503 payments_unavailable |
| PROD-7 test card in prod | PASS | tx remained pending across all prod-mode probes |
| PROD-8 non-'production' NODE_ENV | PASS | NODE_ENV=staging → mockPaymentsAllowed=false (R2: default-deny; was true in round 1) |
| RACE-1 | PASS | 15/15 consistent (sale,refund outcomes: pp pp pp pp pp pp pp pp pp pp pp pp pp pp pp) |
| RACE-2 | PASS | always succeeded/3 lines (success after failure accepted; failure after success ignored) |
| RACE-3 | PASS | duplicate via (provider, processor tx id, type) key |
| RACE-4 | PASS | first processed, second (different amount, same refund id) duplicate; reversed 500 — by design dedupe key; NOTE only |
| LOG-1 | PASS | no secrets in logs; 0 distinct error-ish lines:  |
| M5-05 / REF-1 | PASS | refunded; ledger 0; extra 1¢ → rejected/over_refund |
| M5-06 / REF-2 | PASS | 500:succeeded/1170 750:succeeded/585 750:refunded/0 |
| REF-3 | PASS | rejected/over_refund |
| REF-4 | PASS | ledger remaining 390 |
| REF-5 | PASS | over → rejected; null → remaining 1500 refunded |
| REF-6 | PASS | pending:parked/sale_not_seen_yet failed:ignored/reversal_of_failed_sale failed-cb:ignored |
| REF-7 | PASS | refund 800 + chargeback remaining 1200 = 2000, ledger 0; extra cb rejected |
| REF-8 | PASS | rejected/over_refund |
| REF-9 concurrency | PASS | 4 processed / 6 rejected; reversed 2000 |
| REF-10 concurrency | PASS | 6 processed; ledger 156 |
| REF-11 concurrency | PASS | reversed 2000, status charged_back, ledger 0 |
| M5-07 / REF-12 | PASS | after refund available=-3900 (negative allowed); after new sale 0; payout while 0<available<min → nothing_available |
| M5-08 / CB-1 | PASS | details processed,processed,seller_flagged_for_review; reason="3 chargebacks within 90 days (threshold 3)"; audit rows 1; still verified |
| CB-2 | PASS | ledger -1500 (chargeback fee), net reversal 0 |
| REF-13 API | PASS | request refund 500→200, 5000→400 over_refund, pending→409 not_refundable |
| REF-14 invariants | PASS | 147 settled txs checked (145 exact), no violations |
| M3-12 retry | PASS | 400 → no claim, no ledger; error rows logged=0; retry processed |
| M6-08 queue | PASS | parked row visible; applied automatically when the sale lands (OOO-1..4); no cron for stragglers whose sale never arrives (NOTE) |
| SESS-1 | PASS | expired |
| SESS-2 | PASS | blocked |
| SESS-3 | PASS | none |
| M3-11 / IDEM-1 | PASS | outcomes processed,duplicate,duplicate; ledger lines 3, sum 1560 |
| IDEM-2 | PASS | 1 processed + 11 duplicate (all 200); seller ledger delta 1560 |
| IDEM-3 | PASS | 200:ignored 200:ignored 200:ignored 200:ignored 200:processed 200:ignored 200:ignored 200:ignored 200:ignored 200:ignored 200:ignored 200:ignored |
| IDEM-4 | PASS | second sale new evt: duplicate/undefined; new evt+new saleId: ignored/sale_succeeded_but_succeeded; fail-after-success: ignored/sale_failed_but_succeeded; refund reusing a sale's event id: duplicate/undefined (state succeeded/0/mocktx_9c60f45b53da58ff45a06427) |
| IDEM-5 | PASS | mismatch→rejected/amount_mismatch; tx pending, no ledger |
| IDEM-5b | PASS | processed |
| IDEM-5c | PASS | EUR→amount_mismatch |
| IDEM-5d | PASS | early ignored; legit processed |
| M3-10 / SIG-1 | PASS | 401 invalid_signature |
| M3-10 / SIG-2 | PASS | 401 invalid_signature |
| M3-10 / SIG-3 | PASS | 401 invalid_signature |
| M3-10 / SIG-4 | PASS | 401 invalid_signature |
| M3-10 / SIG-5 | PASS | 401 invalid_signature |
| M3-10 / SIG-6 | PASS | 401 invalid_signature |
| M3-10 / SIG-7 | PASS | 401 invalid_signature |
| M3-10 / SIG-8 | PASS | 401 invalid_signature |
| M3-10 / SIG-9 | PASS | 401 invalid_signature |
| M3-10 / SIG-10 | PASS | 401 invalid_signature |
| M3-10 / SIG-11 | PASS | 401 invalid_signature |
| M3-10 / SIG-12 | PASS | 401 invalid_signature |
| M3-10 / SIG-13 | PASS | 401 invalid_signature |
| M3-10 / SIG-14 | PASS | 401 invalid_signature |
| M3-10 / SIG-15 | PASS | 401 invalid_signature |
| M3-10 / SIG-16 | PASS | 401 invalid_signature |
| M3-10 / SIG-17 | PASS | 401 invalid_signature |
| M3-10 / SIG-18 | PASS | text/plain→200/processed (tx now succeeded; body is HMAC-verified JSON so content-type is not security relevant) |
| SIG-19 | PASS | replay of byte-identical signed request inside window → duplicate |
| SIG-20 | PASS | 401 |
| SIG-21 | PASS | both 200 |
| SIG-22 | PASS | stripe:404 paypal:404 __proto__:404 constructor:404 toString:404 MOCK:404 mock%20:404 ..%2fmock:404 segpay:404 ccbill:404 |
| SIG-23 | PASS | signature.ts uses timingSafeEqual on 32-byte buffers; non-hex candidate compares against zero buffer |
| SIG-24 | PASS | POST 413, GET 405 |
| SIG-25 | PASS | 60×401 then 10×429; max stored rejected payload 247 bytes |
| SIG-26 | PASS | amount float:400 amount negative:400 amount string:400 amount huge:400 type unknown:400 no data:400 currency 4 chars:400 badjson:400 array:400 |
| SEC-1 injection | PASS | ref(' OR '1'='1):200/ignored ref('; DROP TABL):200/ignored ref(00000000-000):200/ignored ref(${{7*7}}):200/ignored ref(7b64e394-c06):200/ignored ref(\):200/ignored ref(é😀):200/ignored; tx still succeeded, failure_code=null |
| SEC-1b NUL byte | PASS | reference:400 event id:400 failure_code:400 |
| SEC-2 mass-assign | PASS | 200 processed; split unchanged 1560/200 |
| OOO-5b | PASS | parked then applied via processor id match; refunded |
| M3-12 / OOO-1 | PASS | parked→applied: [{"outcome":"processed","outcome_detail":"applied_after_sale"}] |
| OOO-2 | PASS | charged_back, ledger 0 |
| OOO-3 | PASS | final succeeded reversed=1200 ledgerSum=624; events ["500:processed/applied_after_sale","700:processed/applied_after_sale","1000:rejected/over_refund"] |
| OOO-4 | PASS | reversed 1500, status succeeded, events [{"outcome":"processed","outcome_detail":"applied_after_sale"},{"outcome":"rejected","outcome_detail":"over_refund"}] |
| OOO-5 | PASS | unknown ref: ignored/unknown_transaction; non-uuid ref: ignored/unknown_transaction |
| OOO-6 | PASS | failed(processed) → succeeded; ledger 3 lines |
| S2-05 audit | PASS | 37258ccc:succeeded wh=2 ledger=3; 1855722f:succeeded wh=2 ledger=3; 3c042d2d:succeeded wh=1 ledger=3 (no receipt record exists: receipt email not built) |

### r2a: BUG-1/2/3/4
| ID | Result | Evidence |
|---|---|---|
| BUG-1a | PASS | 1×201 + 11×200 reused; 1 row; same session mocksess_430cd… |
| BUG-1b | PASS | 1 txn |
| BUG-1c | PASS | 201 then 200 reused |
| BUG-1d | PASS | 409 + same txn for dropId variant |
| BUG-1e | PASS | 3 distinct txns/sessions |
| BUG-1f | PASS | 128:201 129:400 "has space":400 "tab\there":400 "ünï":400 sqli:201 blank:201 |
| BUG-1g | PASS | new after paid: 201; keyed replay after paid: 200 status=succeeded same=true (returns paid session URL; pay endpoint on it is idempotent) |
| BUG-1h | PASS | new txn, old failed/session_expired, key released |
| BUG-1i | PASS | isolated per (drop,email) |
| BUG-1j | PASS | reused amount=1000 (old price), new buyer amount=5000; paid settled at 1000 (succeeded). INFO: buyer keeps old price for ≤30 min after a seller price change |
| BUG-1k | PASS | FINDING (LOW/privacy): second client from different IP got reused:true + victim's session URL (49176a7fea25) – reveals that <email> has a live purchase intent for <drop> |
| BUG-1l | PASS | 60 reqs: 50 ok, 10 409 (key reused across drops – expected), 0×5xx, 0 duplicate pendings |
| BUG-1m | PASS | 100 reqs in 395 ms, 1 txn |
| BUG-1n | PASS | one charge, 3 lines |
| BUG-2a | PASS | rejected → processed; ledger 1560 |
| BUG-2b | PASS | ignored → processed |
| BUG-2c | PASS | ok |
| BUG-2d | PASS | pddddddd |
| BUG-2e | PASS | ok |
| BUG-2f | PASS | 1+11 |
| BUG-2g | PASS | 50 rejected events → 50 log rows, ledger unchanged (rejected rows are stored once each; no dedupe → log growth only possible with valid signatures) |
| BUG-3a | PASS | reference:400 event id:400 transaction_id:400 related_transaction_id:400 failure_code:400 currency:400; 6 rejected rows; legit sale afterwards processed |
| BUG-3b | PASS | surrogate:400 513ch:400 emoji/long-valid:200/processed |
| BUG-3c | PASS | 60×400 then 429 |
| BUG-4a | PASS | details -,-,seller_flagged_for_review,-; reason="3 chargebacks within 90 days (threshold 3)"; 1 audit row; still verified & purchasable (no auto-ban) |
| BUG-4b | PASS | replay×3 + dup cb on same tx + 3 refunds + 1 more distinct cb = 2 distinct → not flagged |
| BUG-4c | PASS | 91 d: flagged=false; 89 d: flagged=true (seller_flagged_for_review) [ledger created_at backdated in throwaway DB with append-only trigger temporarily disabled] |
| BUG-4d | PASS | processed,processed,processed,seller_flagged_for_review |
| BUG-4e | PASS | 18 concurrent, 6 flagged |
| BUG-4f | PASS | parked×3 → flagged; threshold=1 + partial cb → flagged (seller_flagged_for_review) |
| BUG-4g | PASS | chargeback_flag_threshold=0 rejected, chargeback_flag_window_days=0 rejected, chargeback_flag_window_days=4000 rejected, checkout_session_ttl_minutes=0 rejected, checkout_late_success_grace_minutes=-1 rejected |

### r2b: BUG-6/7, void, expiry, invariants
| ID | Result | Evidence |
|---|---|---|
| BUG-6a | PASS | failed/unavailable; msg="This item is no longer available for purchase. You have not been charged." |
| BUG-6b-unpublished | PASS | failed/unavailable |
| BUG-6b-flagged | PASS | failed/unavailable |
| BUG-6b-draft | PASS | failed/unavailable |
| BUG-6c | PASS | failed; status API msg="This checkout has expired. Please go back to the page and start again." retryable=false |
| BUG-6d | PASS | 29 min succeeded; 31 min refused |
| BUG-6e | PASS | 55 s: succeeded; 63 s: failed/session_expired |
| BUG-6f | PASS | swept 1 |
| VOID-1 | PASS | voided:seller_not_verified; refund_requested_at set; ledger 0; balance unchanged; buyer msg="This purchase could not be completed. If you were charged, the payment is being refunded." |
| VOID-2-unpublished | PASS | voided:drop_unavailable |
| VOID-2-flagged | PASS | voided:drop_unavailable |
| VOID-3 | PASS | 25 h old → voided (voided:session_expired); expired 60 min ago, paid within grace → honoured (late-success policy) |
| VOID-4 | PASS | replay=duplicate; new-evt=duplicate/undefined; fail-after-void=ignored/voided; refund hook=void_refund_confirmed; chargeback on voided=processed/void_refund_confirmed |
| VOID-5 | PASS | pddddddddd |
| VOID-6 | PASS | retry hook requested 1; second run 0 (this tx not repeated: true) |
| VOID-7 | PASS | 14 voided txns, 0 awaiting refund retry (should be 1 from VOID-6 reset? 0); none have ledger |
| VOID-8 | PASS | earnings.recent excludes failed? failed in recent=15; balance 6240 == ledger |
| VOID-9 | PASS | 288 settled txns satisfy gross == net+platform+processing |
| VOID-10 | PASS | 20 boundary races: 20 succeeded(3 lines), 0 expired(0 lines), 0 inconsistent |
| BUG-7a | PASS | card_declined:"Your card was declined. Please t…"→retry ok \| insufficient_funds:"Your card has insufficient funds…"→retry ok \| expired_card:"Your card has expired. Please tr…"→retry ok \| incorrect_cvc:"The security code you entered is…"→retry ok \| unrecogn |
| BUG-7b | PASS | 3 declines + success: ledger 3 lines; processed events 4; later decline ignored |
| BUG-7c | PASS | expired: "This checkout has expired. Please go back to the page and start again."; pay→failed |
| BUG-7d | PASS | sales-final present on both; no raw codes in HTML |
| INV-1 | PASS | all hold (533 txns, 1504 ledger lines) |

### r2c: BUG-8 config matrix
| ID | Result | Evidence |
|---|---|---|
| BUG-8-01 | PASS | mockPaymentsAllowed=false |
| BUG-8-02 | PASS | mockPaymentsAllowed=true |
| BUG-8-03 | PASS | mockPaymentsAllowed=false |
| BUG-8-04 | PASS | mockPaymentsAllowed=false |
| BUG-8-05 | PASS | mockPaymentsAllowed=false |
| BUG-8-06 | PASS | mockPaymentsAllowed=true |
| BUG-8-07 | PASS | mockPaymentsAllowed=false |
| BUG-8-08 | PASS | mockPaymentsAllowed=false |
| BUG-8-09 | PASS | mockPaymentsAllowed=false |
| BUG-8-10 | PASS | mockPaymentsAllowed=false |
| BUG-8-11 | PASS | mockPaymentsAllowed=false |
| BUG-8-12 | PASS | mockPaymentsAllowed=false |
| BUG-8-13 | PASS | mockPaymentsAllowed=false |
| BUG-8-14 | PASS | mockPaymentsAllowed=true |
| BUG-8-15 | PASS | mockPaymentsAllowed=true |
| BUG-8-16 | PASS | mockPaymentsAllowed=false |
| BUG-8-17 | PASS | mockPaymentsAllowed=false |
| BUG-8-18 | PASS | mockPaymentsAllowed=false |
| BUG-8-19 | PASS | mockPaymentsAllowed=false |
| BUG-8-20 | PASS | mockPaymentsAllowed=true |
| BUG-8-21 | PASS | mockPaymentsAllowed=true |
| BUG-8-22 | PASS | mockPaymentsAllowed=false |
| BUG-8-23 | PASS | mockPaymentsAllowed=false |
| BUG-8-24 | PASS | mockPaymentsAllowed=false |
| BUG-8-25 | PASS | mockPaymentsAllowed=false |
| BUG-8-26 | PASS | mockPaymentsAllowed=false |
| BUG-8-27 | PASS | mockPaymentsAllowed=false |
| BUG-8-28 | PASS | mockPaymentsAllowed=false |
| BUG-8-29 | PASS | mockPaymentsAllowed=false (informational) |
| BUG-8-30 | PASS | mockPaymentsAllowed=true (informational) |
| BUG-8-31 | PASS | mockPaymentsAllowed=false (informational) |
| BUG-8-32 | PASS | mockPaymentsAllowed=true (informational) |
| BUG-8-33 | PASS | mockPaymentsAllowed=false |
| BUG-8-34 | PASS | mockPaymentsAllowed=false (informational) |

### r2d: reuse / idempotency edge / leaks
| ID | Result | Evidence |
|---|---|---|
| REUSE-1 | PASS | unpublished:404 flagged:404 seller-failed:409 |
| REUSE-2 | PASS | 31 min → new 201 (old session_expired); 29 min → reused 200 (hands buyer a URL with ~1 min left; INFO) |
| REUSE-3 | PASS | lower:200/true padded+upper:200/true |
| REUSE-4 | PASS | INFO: same buyer reuse=true amount=2000 (old price, drop now 9000); other buyer 9000. Buyer page shows old price on /u/<link> while hosted page charges 2000. |
| REUSE-5 | PASS | LOW: attacker w/ victim email + public link id receives reused:true + victim's sessionId URL (801cf552b151); can complete/decline payment on victim's session & learn intent. Impact limited: session pays only that drop at its price, no access to download |
| REUSE-6 | PASS | paid txn never reused; new checkout creates new txn (repeat purchase allowed by design?) |
| LEAK-1 | PASS | status keys=amountCents,message,retryable,status,transactionId; earnings clean |
| LEAK-2 | PASS | 404,404,404,404,404,404 |
| IDEM-9 | PASS | "":201 " ":201 "a":201 "AAAAAAA:201 "AAAAAAA:400 "k\u0000:client-reject "k\r\nX::client-reject "ключ":client-reject "%00":201 "../../e:201 "{{7*7}}:201 "null":201 "undefin:201 "0":201 |
| IDEM-10 | PASS | first 201; over18=false same key 400 invalid_input; tampered amount same key 200/amount 2500 |

### Browser UI
| ID | Result | Evidence |
|---|---|---|
| M3-18 (link page) | PASS | R2: "All sales are final. Because this is a digital product delivered immediately, purchases can't be refunded or exchanged once completed." visible=true, rendered above the Buy button (y 526 < 604) on 390px viewport |
| M3-15 UI | PASS | unticked 18+ box blocks submit (HTML required); server also 400 (API case AGE-1) |
| BUG-7 decline copy | PASS | R2 declined card message: "Your card was declined. Please try a different card." (friendly, no raw failure code: true) |
| M3-18 (hosted checkout) | PASS | R2 hosted page: "All sales are final. Because this is a digital product delivered immediately, purchases can't be refunded or exchanged once completed." |
| M3-03e UI retry (R2 by-design change) | PASS | R2: re-submitting a good card on the SAME declined session: "Payment succeeded (mock)." (was terminal in R1; now payable again) |
| M3-02 UI | PASS | fresh checkout with default 4242 card: "Payment succeeded (mock)." |
| M3-02 redirect | BLOCKED | No redirect to a download page after success: download/unlock delivery not built (documented known gap) |
| M3-20 / S2-02 | BLOCKED | link→paid (mock, mobile viewport, local, no typing delay) took 0.3s; link→checkout redirect 0.2s; cannot reach 'download' step (not built) |
| M3-19 UI | BLOCKED | mock page posts card to our own origin (3 requests to /api/dev/payments/pay); hosted-field requirement can only be assessed against a real processor |
| console | PASS | no console errors |

