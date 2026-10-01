# Unveil QA results — `payments/abstraction`, run 1

- **Date:** 2026-10-01 09:27–10:20 ET
- **Branch tested:** `origin/payments/abstraction` @ **`af475d0a1b5a69105174cb4181d39bb3d70b71a0`** ("docs: clarify e2e run history"), 9 commits on top of `main` @ `94af2c0`.
- **Env:** own clean detached worktree `/workspace/qa-pay`; Node 20.19.2, PostgreSQL 17; `npm ci`; throwaway DB `unveil_qa_pay1` (e2e used its own `unveil_e2e_qapay`), own storage/mail dirs, random SESSION/SIGNED_URL/PAYMENT_WEBHOOK secrets, ports 3517 (checkout limiter raised), 3518 (default limits), 3519–3529 (production-mode probes), e2e on 3521/3531. No other worker's DB/process touched. App source not modified.
- **How tested:** probe scripts `qa/scripts/qa-pay-*.ts|mjs` hit the running production build (`next start`, `MOCK_PAYMENTS_LOCAL_BUILD=1` on loopback, the documented e2e exception) over HTTP and read the DB directly; evidence in `qa/artifacts/pay-*`. Re-run: `. qa/scripts/qa-pay-env.sh && npx tsx qa/scripts/qa-pay-<money|webhooks|refunds|checkout|payouts|prod|races|session|retry>.ts` (scripts refuse to run unless `DATABASE_URL` names a `unveil_qa_pay*` DB). Plan source: `qa/unveil-v1-test-plan.md`.

## Baseline suite (af475d0)
| Check | Expected | Result |
|---|---|---|
| `npm ci` | clean | OK, 0 vulnerabilities |
| `npm run migrate` | 001–006 | **applied 001–006** (incl. 005 enums, 006 payments) |
| `npm run typecheck` | clean | **clean** after `next typegen`/build. On a pristine checkout (no `.next/types`) it fails with `src/app/layout.tsx(47,50): Cannot find name 'LayoutProps'` — pre-existing (layout.tsx untouched by payments), INFO |
| `npm run lint` | clean | **clean** (before QA files were added) |
| `npm test` | ~105 (38 DB) | **105/105 passed** (9 files; DB suites ran, created/dropped their own `unveil_paytest_payments`) |
| `npm run e2e` | 62 | run 1: **61/62** — only `[#13]` login-delay "exactly 3 evaluated saw 4" (the timing flake the owner documented; not payments; log `pay-baseline-e2e.log`). Run 2 (repeat, `pay-baseline-e2e-run2.log`): **62/62**, incl. all 16 `[pay]` checks and the 46 earlier-milestone checks → no regression of earlier passing cases. Flake on `origin/main` itself not verified. |

## Plan-case summary (32 rows in scope)
| Group | PASS | FAIL | BLOCKED | NOT RUN |
|---|---|---|---|---|
| M3 (20) | 12 | 1 | 7 | 0 |
| M4 (M4-09, 13, 14, 15, 16) | 2 | 0 | 3 | 0 |
| M5 (M5-05, 06, 07, 08) | 1 | 1 | 2 | 0 |
| S2 (S2-02, 03, 05) | 1 | 0 | 2 | 0 |
| **Total** | **16** | **2** | **14** | **0** |

Other plan rows (M1, M2, rest of M4/M5/M6, S2-01/04) were not part of this task; only M2/M1 regression through `npm run e2e` (62/62).
Additionally **144 targeted probes** were executed (PASS 131 / FAIL 10 / BLOCKED 3; table in the appendix) – the 10 probe FAILs are the bugs below.

## Per-case table
| ID | Result | Evidence |
|---|---|---|
| M3-01 | **PASS** | Guest with no cookies: link page 200 with buy form (email + 18+); `POST /api/checkout` 201; hosted card page 200; no login demanded (`pay-checkout.log` M3-01; UI run `pay-ui.log`, screenshots `pay-ui-*.png`). |
| M3-02 | **PASS** (status) | 4242 card → tx `succeeded`, `processor_ref`, `succeeded_at`, 3 ledger lines, status API agrees. The "redirect to download page immediately" half is **BLOCKED** (no download/unlock page; documented known gap) → tracked as GAP-1. |
| M3-03 | **PASS** | 0002 → `failed/card_declined`, 9995 → `insufficient_funds`, 0069 → `expired_card`, 0127 → `incorrect_cvc`, unknown card → `unrecognized_test_card`, garbage → `invalid_card_number`; every failure: 0 ledger lines, no `succeeded` row, status API `failed`. (No download exists at all, so "no access" is trivially true; re-test when delivery lands.) UX note: buyer sees raw code `Payment failed: card_declined`, and a declined session is terminal (BUG-7). |
| M3-04 | BLOCKED | Mock has no 3-D Secure challenge. On Payments (real processor sandbox). |
| M3-05 | **PASS** | $20.00 → stored `amount 2000 / processing 240 / platform 200 / net 1560` via HTTP checkout (`pay-money.log`), also pure + BigInt reference. |
| M3-06 | **PASS** | Every cent 100..50000 × 14 fee-% combos (698,614 cases) match an independent BigInt reference; sum exact, ints, none negative. Spot: 99¢-class odd amounts (999→779/100/120, 1999→1559/200/240, 49999→38999/5000/6000, 50000→39000/5000/6000). Rounding = half-up on both fees, platform capped at G−processing, seller net = remainder (consistent). 13 prices also checked through real checkout rows. Prices < $1 / > $500 / float / negative rejected at drop creation. |
| M3-07 | **PASS** | Fee 10%→15% and processing 12%→3% (via SQL; **no admin API/UI for settings exists**): new checkout 300/60/1640 with `fee_percent=15.00` snapshot; earlier tx unchanged 200/240/1560; a pending tx created before a later change (to 20%/1%) still settles with its snapshot (ledger 1560). |
| M3-08 | BLOCKED | Needs a real processor account (plan assumption 3). On Payments/ops. |
| M3-09 | **PASS** | After $20 sale: pending 1560 / available 0; `available_at` = now+7.000 d; payout_hold_days 0 → immediately available, 1-day hold → pending; reversals inherit sale `available_at`; totals == SUM(ledger). |
| M3-10 | **PASS** | 17 signature variants all 401, zero state change (missing, empty, garbage, truncated v1 ×2, empty v1, no t, wrong secret, empty secret, −301 s, −1 day, +10 min, t tampered, body tampered, trailing whitespace, case/other-body sig, raw HMAC without timestamp prefix). Constant-time `timingSafeEqual` confirmed by code review (no timing measurement). Unknown providers (`stripe, paypal, __proto__, constructor, toString, MOCK, segpay, ccbill, …`) → 404, no log rows. 300 KB body → 413. Rejected-log flood limited (60×401 then 429). Malformed-but-signed payloads → 400. |
| M3-11 | **PASS** | Same event ×3 → processed,duplicate,duplicate; 12 concurrent identical → 1 processed + 11 duplicate, 3 ledger lines, seller ledger +1560 once; 12 concurrent with different event ids & different processor tx ids → 1 processed + 11 `ignored`; refund re-delivery under new event id → duplicate. ("one receipt" part: receipts not built – see M3-13.) |
| M3-12 | **PASS** | Refund / chargeback / 3 mixed refunds before the sale → `parked` (200), applied in order inside the sale transaction (`applied_after_sale`), over-refund remainder rejected; sale‖refund delivered concurrently ×15 → always `refunded`, ledger 0; sale‖failed ×12 consistent. A 5xx leaves no dedupe claim and no partial ledger; corrected retry processed. Note: no internal retry queue – "retry" = processor redelivery; `retryParkedEvents()` has no route/cron. |
| M3-13 | BLOCKED | Receipt email not built (known gap). On Payments/Backend. |
| M3-14 | BLOCKED | Receipt re-access / download links not built. On Backend. |
| M3-15 | **PASS** | `confirmOver18` must be literal `true`: missing/false/"true"/1/null/"on"/[true] → 400, 0 rows created; recorded in `buyer_confirmed_18_at`; HTML checkbox `required` and real-browser unticked submit sends no request. Required for **every** drop (no adult flag in schema – owner's open question). |
| M3-16 | **PASS** | Default 10/60 s: 10×201 then 429 with `Retry-After: 60`; other IP unaffected; invalid requests also consume the budget (limiter first). XFF note: with `TRUSTED_PROXY_HOPS=1` the right-most XFF entry is used – prepending forged entries does **not** evade; but a client that sends a single rotating XFF (app not behind an overwriting proxy) evades completely (15 different values, 0×429). Deployment must sit behind a proxy that appends/overwrites XFF. |
| M3-17 | BLOCKED | Negative check passes (no Stripe/PayPal in `src/ scripts/ db/ components/ README PAYMENTS-NOTES package*.json`; no outbound network calls in mock), but "CCBill or Segpay in use, choice documented" is not true yet: only the mock exists, processor undecided. On Payments/business. |
| M3-18 | **FAIL** | No "all sales final"/refund-policy text on the link page, buy form or hosted checkout page (UI check, BUG-5). |
| M3-19 | BLOCKED | Card number is typed into the mock page and POSTed to our own `/api/dev/payments/pay` (dev-only, 404 in prod). Hosted-fields requirement can only be assessed with a real processor. The "no card data stored/logged" half **PASSES**: sent a PAN/CVC/expiry (incl. extra fields on checkout) then grepped a full `pg_dump` and the server logs → 0 hits; Luhn scan of all `webhook_events.payload/normalized` → 0 card-like numbers. |
| M3-20 | BLOCKED | Link→paid 0.3 s on mock (mobile viewport), but the "download" end of the flow does not exist. |
| M4-09 | BLOCKED | No dashboard earnings UI on this branch. Data layer `GET /api/earnings` verified vs independent SQL over `transactions`/ledger: gross, count, refunded, chargebacks, pending/available, `gross − refunds − chargebacks − fees == balance`; fee totals are **net of fee shares returned on refunds** (document for FE so it does not subtract refunds twice). |
| M4-13 | **PASS** (service) | 2499 → `below_minimum_payout`; 0/−100/25.5 → `nothing_available`; exactly 2500 accepted; no payout row / ledger change on rejection. Service functions only – **no HTTP route** for a seller to request a payout (GAP-2). |
| M4-14 | **PASS** (service) | 3900 available + 3900 in hold: request 7800 → `insufficient_available_balance`; default request pays exactly 3900; pending untouched. Hold is a uniform per-sale `payout_hold_days` (default 7); there is no distinct "first payout" rule – NOTE vs plan wording. |
| M4-15 | BLOCKED | Service flow requested→approved→paid works (debit reserved at request, `provider_ref mockpo_…`, illegal transitions → `bad_payout_state`, balance 7800→2800, `earnings.paidOutCents`), but no seller/admin route or history endpoint exists. On Payments/Backend (admin routes). |
| M4-16 | BLOCKED | Service: failed from requested and approved restores funds via `payout_reversal`, reason stored, double-fail → `bad_payout_state`. "Visible to admin" – no admin surface exists. On Backend/Admin. |
| M5-05 | BLOCKED | No admin refund route. Processor-driven full refund verified: `refunded`, `reversed=2000`, ledger nets 0; duplicate event idempotent; extra 1¢ → `rejected/over_refund`. On Backend/Admin. |
| M5-06 | BLOCKED | No admin route. Webhook-driven partial: $5+$7.50+$7.50 → ledger 1170/585/0; 999×1¢ refunds reverse exactly net; 6,000 random sale×refund-sequence property runs exact. On Backend/Admin. |
| M5-07 | **PASS** | Refund after payout: available −3900 (negative allowed), `totalCents == SUM(ledger)`; a new $50 sale nets against it (→ 0); requesting payout while available ≤ 0 → `nothing_available`. |
| M5-08 | **FAIL** | Chargeback webhook → `charged_back`, reversal posted, optional `chargeback_fee` honoured – works. **Repeat chargebacks do NOT flag the seller**: 4 chargebacks on one seller → no flag/review/risk column or state anywhere (BUG-4). |
| S2-02 | BLOCKED | = M3-20. |
| S2-03 | **PASS** | = M3-07: platform cut configurable (DB setting, no deploy), seller gets remainder minus processing. |
| S2-05 | BLOCKED | Trace of 3 random transactions works for txn → webhook_events (claim, duplicates, payload SHA-256) → ledger lines (each linked by `webhook_event_id`) → refund events; **receipt** link of the trail does not exist. |

## Priority-area results
1. **Money math** – PASS (see M3-05/06/07). Float-free (integer `Number` cents, BigInt cross-check), no negatives even at 100 % + 12 % rates (platform capped), DB CHECK rejects fee_percent 101/−1 and processing 100.5, snapshot not retroactive.
2. **Idempotency** – PASS for same event ×N and ×12 concurrent, across event ids and across processor ids. See BUG-2/BUG-3 for edge cases where a *rejected/ignored* event burns the dedupe key.
3. **Signatures** – PASS (M3-10). `text/plain`, form and no content-type with a valid signature are accepted (signature is over bytes; INFO).
4. **Out-of-order** – PASS (M3-12). Refund with only a processor sale id (no reference) also parks and applies when the sale arrives. Refund for an unknown reference → `ignored/unknown_transaction`. A refund with *only* an unknown related sale id parks forever if that sale never arrives (no reaper; INFO).
5. **Refund sequences** – PASS: full→partial, partial→partial, over-refund, refund of pending (parked)/failed (ignored), refund+chargeback combos, 10 concurrent $5 refunds on $20 → exactly 4 applied/6 rejected, 10×$3 → 6 applied, 20-way mixed storm → `reversed ≤ gross`, ledger equals recomputed expectation. **Seller flagging after repeats FAILS** (BUG-4).
6. **Rate limiter** – PASS (M3-16).
7. **Mock in production** – PASS: `NODE_ENV=production` without the flag → checkout 503, **valid-signature** webhook 503 with no state change, `/api/dev/payments/pay` 404, `/pay/mock/*` 404. Flag + public `APP_URL` → still disabled; flag + deceptive hosts (`localhost.evil.com`, `localhost@evil.com`, `127.0.0.1.evil.com`, `evil.com/localhost`) → disabled. Secret of 31/0/5 chars → 503/503; unregistered `PAYMENT_PROVIDER=segpay` → 503 (no fallback to mock). Residual: flag + loopback `APP_URL` re-enables the mock in a production build (by design), and `mockPaymentsAllowed` is true for any `NODE_ENV` other than the exact string `production` (INFO/hardening, BUG-8).

## Bugs / findings (exact repro)
| # | Severity | Finding | Repro |
|---|---|---|---|
| BUG-1 | **MEDIUM** | `POST /api/checkout` has no idempotency: a double submit creates two pending transactions + two sessions; an `Idempotency-Key` header is ignored. (The shipped UI button disables itself — 3/3 real-browser double-clicks sent one POST — and paying one session twice is safe (DUP-3: one charge); but API/retry clients or two tabs can create two payable sessions for one purchase intent.) | `POST /api/checkout {linkId,email,confirmOver18:true}` twice concurrently, same email/drop → 2 different `transactionId`s (`qa-pay-checkout.ts` DUP-1/DUP-2). |
| BUG-2 | **MEDIUM** (latent; HIGH once a provider with `confirmTransaction` ships) | A *rejected* or *ignored* sale event keeps its dedupe claim, so a later correct sale event with the same processor transaction id is answered `duplicate` (200) and the transaction stays `pending` forever → buyer charged, seller not credited, nothing retries. Affects `rejected/amount_mismatch`, `rejected/confirmation_not_approved` (transient confirm API lag) and `ignored/unknown_transaction`. Partial unique index `(provider, provider_transaction_id, event_type)` is the cause. | Create checkout (tx T). Send signed `sale.succeeded` for T with amount 1 → `rejected/amount_mismatch`. Send the correct signed `sale.succeeded` (new event id, same `transaction_id`) → `{"outcome":"duplicate"}`, tx still `pending` (`qa-pay-webhooks.ts` IDEM-5b; IDEM-5d same via unknown reference). |
| BUG-3 | LOW | Signed event containing U+0000 in `id`/`reference` → Postgres `invalid byte sequence` → 500 `webhook_error`; the error-log insert also fails (swallowed) so no `error` row is recorded; processor would retry indefinitely. Requires an authentic signed event. | Send signed `sale.succeeded` with `data.reference:"a\u0000b"` → 500 (SEC-1b). |
| BUG-4 | **MEDIUM** | M5-08: repeat chargebacks do not flag the seller for review; no state exists on `sellers` for it. | Make 4 sales by one seller, send a `chargeback.created` for each → all `charged_back`, `sellers` row unchanged, no flag anywhere (`qa-pay-refunds.ts` CB-1). |
| BUG-5 | **MEDIUM** | M3-18: no "all sales final" statement before paying. | Open `/u/<link>` and the `/pay/mock/<session>` page → no refund-policy text (`qa-pay-ui.mjs`). |
| BUG-6 | **MEDIUM** | The sale webhook path re-checks nothing about the drop/seller/session age: a pending session can be paid (and credited to the seller) after the drop was unpublished or flagged, after the seller's verification became `failed`, or 30 days after creation (sessions never expire; pending rows are never reaped). | Start checkout; then `UPDATE sellers SET verification_status='failed'` (or flag the drop, or backdate `created_at` 30 d); `POST /api/dev/payments/pay {sessionId, card:"4242…"}` → `succeeded`, 3 ledger lines (`qa-pay-session.ts` SESS-1/2, `qa-pay-checkout.ts` DROP-2/3). |
| BUG-7 | LOW (UX) | A declined session is terminal: retrying a good card on the same hosted page answers `Payment failed: failed`; buyer sees raw codes (`card_declined`). | Pay with 4000 0000 0000 0002, then 4242… on the same `/pay/mock/<session>` (`qa-pay-ui.mjs`). |
| BUG-8 | LOW / hardening | `config.mockPaymentsAllowed` is true for every `NODE_ENV` other than exactly `production` (e.g. `staging`); the e2e exception (`MOCK_PAYMENTS_LOCAL_BUILD=1` + loopback `APP_URL`) re-enables the mock in a production build. | `NODE_ENV=staging npx tsx -e "import {config} from './src/server/config'; console.log(config.mockPaymentsAllowed)"` → `true` (PROD-8). Recommend allow-list opposite (`development`/`test` only). |
| NOTE-A | INFO | XFF: a client-supplied rotating `X-Forwarded-For` evades the checkout limiter when not behind an overwriting proxy (prepended forged entries do not). | RL-3. |
| NOTE-B | INFO | Fresh checkout `npm run typecheck` needs `next typegen` (pre-existing `LayoutProps`). | |
| NOTE-C | INFO | Two distinct partial refunds sharing one processor refund id → second dropped as duplicate (by design of the dedupe key; processors normally give unique ids). | RACE-4. |
| NOTE-D | INFO | `/api/dev/payments/*` (unauth simulator) is not mounted when the mock is disallowed (verified 404 in prod mode). | PROD-1. |

### Gaps that make cases BLOCKED (not bugs; owner and next step)
- GAP-1 download/unlock delivery after purchase, receipt email, receipt re-access (M3-02 redirect, M3-13, M3-14, M3-20, S2-02, S2-05 receipt) — **Backend/Payments** (declared out of scope).
- GAP-2 no HTTP routes for seller payout request, admin approve/paid/failed, admin refund, platform-settings admin API, payout history (M4-15, M4-16, M5-05, M5-06, M3-07 via admin) — **Backend/Admin**.
- GAP-3 real processor sandbox: 3-D Secure (M3-04), live $1 charge (M3-08), hosted card fields (M3-19), Segpay/CCBill choice + fee docs (M3-17) — **Payments + business/processor accounts**.
- GAP-4 dashboard earnings UI (M4-09) — **Frontend** (API ready: `GET /api/earnings`).

## Cleanup
Servers started by this run (3517, 3518, 3519–3529, e2e ports) stopped; throwaway DBs `unveil_qa_pay1` and `unveil_e2e_qapay` dropped; no other DB/process touched.

## Appendix: all 144 probe results
Source JSON: `qa/artifacts/pay-*-results.json`; logs `qa/artifacts/pay-*.log`; DB snapshot `qa/artifacts/pay-db-evidence.txt`.

| Probe | Name | Result | Evidence |
|---|---|---|---|
| M3-01 | guest (no account, no cookies) can open link, see buy form and start checkout; no login redirect | PASS | 201 + hosted card page 200 (no cookies sent) |
| M3-02 | card 4242 4242 4242 4242 → tx succeeded; ledger 3 lines; status API agrees | PASS | tx f9b33436 succeeded/null |
| M3-03a | card 4000 0000 0000 0002 → tx failed (card_declined); ledger none; status API agrees | PASS | tx 35b64eea failed/card_declined |
| M3-03b | card 4000000000009995 → tx failed (insufficient_funds); ledger none; status API agrees | PASS | tx 2c43215a failed/insufficient_funds |
| M3-03c | card 4000000000000069 → tx failed (expired_card); ledger none; status API agrees | PASS | tx fef0afac failed/expired_card |
| M3-03d | card 4000000000000127 → tx failed (incorrect_cvc); ledger none; status API agrees | PASS | tx 2809aa93 failed/incorrect_cvc |
| CARD-x | card 4111 1111 1111 1111 → tx failed (unrecognized_test_card); ledger none; status API agrees | PASS | tx b97e8538 failed/unrecognized_test_card |
| CARD-y | card abc → tx failed (invalid_card_number); ledger none; status API agrees | PASS | tx d760f274 failed/invalid_card_number |
| CARD-z | card 5555-5555-5555-4242 → tx succeeded; ledger 3 lines; status API agrees | PASS | tx 255eb578 succeeded/null |
| M3-03e | after a decline: same session can't be re-paid (session terminal) and a new checkout with 4242 succeeds; no su | PASS | second attempt on same session → failed (buyer must restart checkout; UX note) |
| M3-15 / AGE-1 | 18+ required: missing / false / 'true' string / 1 / null → 400; no tx rows created | PASS | undefined:400 false:400 "true":400 1:400 null:400 "on":400 [true]:400 |
| M3-15 / AGE-2 | 18+ recorded: buyer_confirmed_18_at set on tx; UI checkbox 'required' attr present on buy form | PASS | buyer_confirmed_18_at set; checkbox required |
| EMAIL-1 | buyer_email validation: invalid forms → 400; valid incl. plus-address/uppercase accepted & lower-cased; 255-ch | PASS | "":400 " ":400 "plain":400 "a@":400 "@b.com":400 "a b@c.com":400 "a@b":400 "<script>@x.com":400 "a@b.com\r\nBcc: x:400 "xxxxxxxxxxxxxxxxx:400 \| valid → lowercased, trimmed |
| PRICE-1 | price tamper: amount/amountCents/price/priceCents/total/seller_net/platform_fee fields in body ignored; DB pri | PASS | all tamper fields ignored → 2000/200/1560 pending |
| PRICE-2 | price edited by seller after link is shown: checkout uses current DB price | PASS | checkout amount 1500 (DB price); note: no PATCH /api/drops/:id on this branch |
| DROP-1 | unpublished / draft / flagged drops can't be bought (404) by linkId or dropId; unverified seller → 409; unknow | PASS | draft/dropId:404 unpublished/linkId:404 unpublished/dropId:404 flagged/linkId:404 flagged/dropId:404 malformed:400 unknown:404 both-ids:400 unverified-seller:409 |
| DROP-2 | drop unpublished AFTER checkout started: pending tx can still be paid? (record behaviour) | PASS | payment on a now-unpublished drop's pending session → succeeded (note: money captured for an unlistable drop; no download delivery exists to honor it) |
| DROP-3 | drop flagged AFTER checkout started: sale succeeded for flagged drop | PASS | status succeeded (flagged drop can still be paid from an earlier session - NOTE) |
| DUP-1 | double-click submit: 2 concurrent POST /api/checkout (same buyer, same drop) → ??? one pending tx expected per | FAIL | NO checkout idempotency: 2 submits → 2 separate pending transactions/sessions (b97a6353, 4d269575); POST body has no idempotency key and no Idempotency-Key header is honoured |
| DUP-2 | Idempotency-Key header honoured on /api/checkout | FAIL | header ignored: two different transactions for the same Idempotency-Key |
| DUP-3 | double-click PAY on the same session (10 concurrent approve posts) → exactly one charge/ledger posting | PASS | one charge; webhook outcomes [{"outcome":"duplicate","count":"8"},{"outcome":"processed","count":"1"}] |
| DUP-4 | concurrent approve + decline on the same session: final state consistent with ledger (no ledger without succee | PASS | succeeded/3 succeeded/3 succeeded/3 succeeded/3 succeeded/3 succeeded/3 |
| M3-19 / PAN-1 | card data never stored: PAN/CVC sent to pay endpoint & checkout; grep full DB dump and server logs for the ful | PASS | pg_dump (934 KiB) and app logs contain no PAN; only payload hashes/fixed fields stored in webhook_events |
| M3-19 / PAN-2 | card number is POSTed to OUR server (/api/dev/payments/pay) by the mock hosted page (mock only; real processor | PASS | mock page → same-origin /api/dev/payments/pay with card in body (dev-only, 404 in prod); acceptable for mock, M3-19 for real processor BLOCKED until Segpay/CCBill |
| PAN-3 | webhook_events.payload / normalized contain no Luhn-valid 13-19 digit standalone numbers (card-like) | PASS | 763 webhook_events rows scanned, 0 card-like numbers (long digit runs seen were uuid/hex fragments and a 1e12 amount) |
| M3-16 / RL-1 | checkout limiter (default 10/60s per IP): 10 allowed then 429 + Retry-After; other IP unaffected; single legit | PASS | codes 201,201,201,201,201,201,201,201,201,201,429,429,429, Retry-After 60, other IP 201 |
| RL-2 invalid requests count | limiter runs BEFORE validation: invalid requests also consume the budget (e2e already relies on this) | PASS | 400,400,400,400,400,400,400,400,400,400,429,429 |
| RL-3 XFF spoof (note) | X-Forwarded-For handling: rotating a single client-supplied XFF value bypasses the limiter; prepending extra e | PASS | rotating single XFF: 201,201,201,201,201,201,201,201,201,201,201,201,201,201,201 (no 429 → trivially bypassable when app is NOT behind a proxy that overwrites XFF); prepended spoof with fixed right-most: 201,201,201,201,201,201,201,201,201,201,429,429,429 |
| AUTHZ-1 | /api/earnings: anonymous → 401; seller A sees only own ledger/transactions; seller B's data not leaked; no buy | PASS | A total 1560, B total 2340; sellerId param ignored; no emails |
| AUTHZ-2 | /api/checkout/status leaks only status/amount/failure_code (UUID capability); random uuid 404; SQLi id 404 | PASS | ok |
| SEC-3 checkout injection | SQLi / mass-assignment in checkout JSON (dropId/linkId/email) → 400/404, tables intact | PASS | 400 400 400 201 201 nonjson:400 text/plain:201 |
| SEC-4 CSRF/origin | cross-origin POST /api/checkout and /api/dev/payments/pay blocked (403) | PASS | 403 |
| M3-06/MONEY-1 | pure sweep: every cent 100..50000 × 14 fee-% combos: gross == net+platform+processing, ints, none negative, ma | PASS | 698614 (amount, rate) cases, 0 mismatches vs reference, 0 negative, 0 non-integer |
| M3-05/MONEY-2 | defaults $20.00 => net 1560 / platform 200 / processing 240; $0.99,$9.99,$19.99,$499.99 spot values | PASS | 99→77/10/12 999→779/100/120 1999→1559/200/240 49999→38999/5000/6000 100→78/10/12 50000→39000/5000/6000 |
| MONEY-3 | rounding direction: half-cent rounds UP consistently for both fees (e.g. 5¢@10% → 1 (0.5), 15¢@10% → 2 (1.5)) | PASS | half-up verified on both fees; seller absorbs remainder |
| MONEY-4 | refund reversal property: random sale × random partial-refund sequences (incl 1¢ steps) sum exactly to origina | PASS | 6000 random sequences exact; 999×1¢ refunds reverse exactly net 779 |
| MONEY-5 | float/NaN inputs rejected by money layer | PASS | rejects floats/negatives/NaN/inf/unsafe and malformed percents |
| M3-05/M3-06 e2e | HTTP checkout stores integer-cent split in transactions: odd prices incl 99¢→skipped (min 100), 999, 1999, 499 | PASS | 13 prices OK (net/plat/proc): 100:78/10/12 101:79/10/12 199:155/20/24 999:779/100/120 1000:780/100/120 1999:1559/200/240 2000:1560/200/240 3333:2600/333/400 4999:3899/500/600 12345:9629/1235/1481 49999:38999/5000/6000 50000:39000/5000/6000 777:606/78/93 |
| M3-06 bounds | price below $1 (0.99 → 99¢) and above $500 rejected at drop creation; 100 and 50000 accepted | PASS | 99→400, 50001→400, 999.5→400, -5→400 |
| M3-07/S2-03 | change platform fee 10%→15% and processing 12%→3%: new sale uses new rates (fee_percent snapshot), old transac | PASS | pending tx snapshot 200/240/1560 stays after settings change & settles at 1560; new tx @15%/3% = 300/60/1640 |
| MONEY-6 | fee-percent settings: invalid platform_settings values (fee_percent 101, -1, 'abc') are rejected by DB constra | PASS | 101 rejected, -1 rejected, proc 100.5 rejected |
| MONEY-7 | fee 100% platform + 12% processing cap: net never negative at HTTP level | PASS | 999¢ @100%/12% → net 0 plat 879 proc 120 |
| MONEY-8 | DB columns are integer cents (no numeric/float money columns in transactions/ledger/payouts) | PASS | ledger_entries.amount_cents:integer, payouts.amount_cents:integer, transactions.amount_cents:integer, transactions.platform_fee_cents:integer, transactions.processing_fee_cents:integer, transactions.reversed_cents:integer, transactions.seller_net_cents:integer |
| M3-09 / HOLD-1 | after a $20 sale (default 7-day hold): pending 1560, available 0; ledger entries available_at ≈ now+7d; totals | PASS | pending 1560 available 0; hold 7.000d |
| M4-13 | payout below $25 blocked: requested 2499 with 5000 available → below_minimum_payout; no payouts row, no ledger | PASS | 2499→below_minimum_payout, 0→nothing_available, -100→nothing_available, 25.5→nothing_available; exactly 2500 accepted |
| M4-13b | available below $25 but > 0 (balance 2000): request with no amount → below_minimum_payout | PASS | below_minimum_payout |
| M4-14 | funds in hold not payable: sale A (hold 0, 3900 available) + sale B (hold 7d, 3900 pending): payout of 7800 re | PASS | over-request insufficient_available_balance; default payout 3900 (available only); pending 3900 untouched |
| M4-14b | hold-boundary: tx whose available_at is in the future is not counted available (use 1-day hold, check 0 availa | PASS | 0 available / 3900 pending |
| M4-14c | first-payout hold: spec says 'first-payout 7-day hold honored' — implementation applies a uniform per-sale hol | PASS | observed: payable immediately with hold_days=0; per-sale hold only (no distinct first-payout rule) — NOTE |
| M4-15a | payout flow requested→approved→paid: ledger debit reserved at request, payout row timestamps, provider_ref sto | PASS | balance 7800→2800; statuses requested→approved→paid; illegal transitions → bad_payout_state; earnings.paidOutCents 5000. NOTE: no HTTP route to request/approve payout (service functions only) |
| M4-16 | payout failure: status failed, reason stored, funds returned (payout_reversal), balance restored, can't double | PASS | reserve 3000 → fail → 3900 restored; approved→failed also restored; admin-visible via payouts.failure_reason (NOTE: no admin UI/route) |
| PAYOUT-CONC-1 | concurrent payout requests cannot double-spend: 8 parallel requests of 3000 vs 3900 available → exactly 1 succ | PASS | 1 ok / 7 rejected (OK,insufficient_available_balance); available 900 |
| PAYOUT-CONC-2 | concurrent default-amount payout requests (no amount) ×6: one payout of the full available, rest nothing_avail | PASS | nothing_available,OK |
| PAYOUT-CONC-3 | concurrent payout request vs refund webhook vs new sale: ledger SUM stays == earnings total; available never n | PASS | payout:OK refund:processed sale:sold final available 0 total 0 (negative allowed only via refund after payout) |
| PAYOUT-INV-1 | global ledger invariants: per seller Σ ledger == balance.total (pending+available); payouts open+paid reserved | PASS | 52 sellers reconcile; UPDATE blocked, DELETE blocked, TRUNCATE blocked |
| M4-09 | earnings summary vs transactions: gross/platform/processing/net/refunds/chargebacks/pending/available match in | PASS | NOTE fees in summary are NET of fee shares returned on refunds (reported 1430 vs 2640 on transactions rows); identity gross−refunds−chargebacks−fees==balance holds. gross 11997, refunded 500, chargebacks 4999, balance 5068 |
| PROD-1 (M3 / mock disabled) | NODE_ENV=production, no MOCK_PAYMENTS_LOCAL_BUILD, localhost APP_URL: checkout 503, VALID-signature webhook 50 | PASS | {"checkout":503,"webhook":503,"pay":404,"page":404} |
| PROD-2 | production + MOCK_PAYMENTS_LOCAL_BUILD=1 + PUBLIC APP_URL (https://unveil.link): still disabled | PASS | {"checkout":503,"webhook":503,"pay":404,"page":404} |
| PROD-3 | production + flag + deceptive hosts (http://localhost.evil.com, http://localhost@evil.com, http://127.0.0.1.ev | PASS | http://localhost.evil.com:ok http://localhost@evil.com:ok http://127.0.0.1.evil.com:ok http://evil.com/localhost:ok |
| PROD-4 (config residual risk) | mock allowed in production when flag=1 + localhost APP_URL (documented e2e exception). Verify that exception w | PASS | exception works (201) — only when both flag and loopback APP_URL are set |
| PROD-5 missing/short secret fails closed | PAYMENT_WEBHOOK_SECRET 31 chars / empty / 5 chars (truly-unset not testable: Next auto-loads the worktree .env | PASS | 31ch:503/503 0ch:503/503 5ch:503/503 |
| PROD-6 unknown PAYMENT_PROVIDER | PAYMENT_PROVIDER=stripe / segpay (not registered) → checkout 503 (fails closed), not fallback to mock | PASS | 503 payments_unavailable |
| PROD-7 test card in prod | no test-card acceptance in prod: /api/dev/payments/pay 404 for card 4242 (covered by PROD-1/2/3: pay=404) and  | PASS | tx remained pending across all prod-mode probes |
| PROD-8 non-'production' NODE_ENV | config.mockPaymentsAllowed is true for ANY NODE_ENV != 'production' (e.g. 'staging', unset): record (next star | PASS | NODE_ENV=staging → mockPaymentsAllowed=true (fail-OPEN for non-production env names; NOTE low-severity hardening) |
| RACE-1 | sale and refund webhooks delivered CONCURRENTLY (15 trials): final state always refunded, ledger nets 0, exact | PASS | 15/15 consistent (sale,refund outcomes: pp pp pp pp pp pp pp pp pp pp pp pp pp pp pp) |
| RACE-2 | sale_succeeded racing sale_failed (12 trials): final state consistent with ledger | PASS | always succeeded/3 lines (success after failure accepted; failure after success ignored) |
| RACE-3 | refund re-delivered under NEW event id with the same processor refund id → duplicate, not a second refund | PASS | duplicate via (provider, processor tx id, type) key |
| RACE-4 | two DIFFERENT partial refunds that reuse the same processor refund id (processor bug / collision): second sile | PASS | first processed, second (different amount, same refund id) duplicate; reversed 500 — by design dedupe key; NOTE only |
| LOG-1 | app logs: no stack traces/secrets: PAYMENT_WEBHOOK_SECRET / SESSION_SECRET never printed; list distinct error  | PASS | no secrets in logs; 2 distinct error-ish lines: webhook processing failed error: invalid byte sequence for encoding "UTF8": 0x00 \|   severity: 'ERROR', |
| M5-05 / REF-1 | full refund $20: status refunded, reversed 2000, ledger nets to 0, duplicate refund event idempotent | PASS | refunded; ledger 0; extra 1¢ → rejected/over_refund |
| M5-06 / REF-2 | partial then partial then remainder: $5 + $7.50 + $7.50 on $20 → ledger nets exactly 0; amounts per step consi | PASS | 500:succeeded/1170 750:succeeded/585 750:refunded/0 |
| REF-3 | full then partial: partial after full → rejected over_refund, ledger unchanged | PASS | rejected/over_refund |
| REF-4 | partial then over-refund (1500 then 1000 on 2000): second rejected, reversed stays 1500, status stays succeede | PASS | ledger remaining 390 |
| REF-5 | refund event with amount > gross (999999) and refund with null amount ('all that remains') | PASS | over → rejected; null → remaining 1500 refunded |
| REF-6 | refund of never-succeeded txns: pending → parked (no ledger), failed → ignored, no state change | PASS | pending:parked/sale_not_seen_yet failed:ignored/reversal_of_failed_sale failed-cb:ignored |
| REF-7 | refund then chargeback on same sale: chargeback only for remaining; total reversed ≤ gross; status charged_bac | PASS | refund 800 + chargeback remaining 1200 = 2000, ledger 0; extra cb rejected |
| REF-8 | chargeback then refund: refund after full chargeback rejected (no double reversal) | PASS | rejected/over_refund |
| REF-9 concurrency | 10 concurrent distinct refund events of $5 each on a $20 sale: exactly 4 processed, 6 rejected, reversed=2000, | PASS | 4 processed / 6 rejected; reversed 2000 |
| REF-10 concurrency | 10 concurrent refunds of $3 on $20: floor(20/3)=6 processed, reversed 1800, ledger sum = net - reversal(1800), | PASS | 6 processed; ledger 156 |
| REF-11 concurrency | concurrent refund + chargeback + refund-duplicates storm (20 requests) → reversed ≤ gross and ledger equals re | PASS | reversed 2000, status charged_back, ledger 0 |
| M5-07 / REF-12 | refund after payout leaves NEGATIVE available balance (allowed), earnings API consistent, new sale nets agains | PASS | after refund available=-3900 (negative allowed); after new sale 0; payout while 0<available<min → nothing_available |
| M5-08 / CB-1 | repeat chargebacks flag the seller for review | FAIL | 4 chargebacks (4 charged_back txns) → no seller flag/review state. seller columns: id,email,password_hash,google_id,display_name,avatar,bio,verification_status,verification_ref,legal_name,dob,payout_details,created_at; flag-ish values: none. Spec M5-08 'repeat |
| CB-2 | single chargeback: tx charged_back, ledger reversal posted, optional chargeback_fee honoured when set; fee pos | PASS | ledger -1500 (chargeback fee), net reversal 0 |
| REF-13 API | refund API surface: only dev simulator routes exist; /api/dev/payments/refund without auth works in non-prod o | PASS | request refund 500→200, 5000→400 over_refund, pending→409 not_refundable |
| REF-14 invariants | global: every tx reversed_cents ≤ amount; Σ ledger per tx == seller_net − reversed-net share; no tx with statu | PASS | 52 settled txs checked (51 exact), no violations |
| M3-12 retry | event that 500s (DB error from NUL byte in event id) leaves NO claim/partial ledger; error row logged; correct | PASS | 500 → no claim, no ledger; error rows logged=0; retry processed |
| M6-08 queue | 'queued with retry' is the processor's at-least-once redelivery (no internal queue/retry worker exists); parke | PASS | parked row visible; applied automatically when the sale lands (OOO-1..4); no cron for stragglers whose sale never arrives (NOTE) |
| SESS-1 | pending checkout older than 30 days can still be paid (no session expiry) | FAIL | 30-day-old pending session was payable (status succeeded); pending sessions never expire - ledger posted 3 lines |
| SESS-2 | seller loses verification (failed/manual_review) after checkout started: payment still completes | FAIL | sale succeeded for a seller whose verification is now 'failed' (webhook path re-checks nothing) |
| SESS-3 | pending tx never auto-expire: count of pending older than 1 day is 0 after cleanup job? (no cleanup job exists | PASS | none |
| M3-18 |  | FAIL | No 'all sales final' / refund-policy statement anywhere on link page or hosted checkout page |
| M3-15 UI |  | PASS | unticked 18+ box blocks submit (HTML required); server also 400 (API case AGE-1) |
| M3-03 UI |  | PASS | declined card message: "Payment failed: card_declined" (raw failure_code shown to buyer; copy is not buyer-friendly) |
| M3-03 UI retry |  | FAIL | re-submitting a good card on the SAME declined session: "Payment failed: failed" (declined session is terminal; buyer must go back and restart checkout; UX issue, LOW) |
| M3-02 UI |  | PASS | fresh checkout with default 4242 card: "Payment succeeded (mock)." |
| M3-02 redirect |  | BLOCKED | No redirect to a download page after success: download/unlock delivery not built (documented known gap) |
| M3-20 / S2-02 |  | BLOCKED | link→paid (mock, mobile viewport, local, no typing delay) took 0.3s; link→checkout redirect 0.2s; cannot reach 'download' step (not built) |
| M3-19 UI |  | BLOCKED | mock page posts card to our own origin (3 requests to /api/dev/payments/pay); hosted-field requirement can only be assessed against a real processor |
| console |  | PASS | no console errors |
| M3-11 / IDEM-1 | same sale webhook 3x (identical bytes) → 1 ledger posting (3 lines), 1 succeeded tx, balance credited once | PASS | outcomes processed,duplicate,duplicate; ledger lines 3, sum 1560 |
| IDEM-2 | 12 concurrent identical deliveries → exactly one processed, 11 duplicates, 3 ledger lines, balance +1560 once | PASS | 1 processed + 11 duplicate (all 200); seller ledger delta 1560 |
| IDEM-3 | 12 concurrent deliveries with DIFFERENT event ids + different processor tx ids for the same payment → one sale | PASS | 200:ignored 200:ignored 200:ignored 200:processed 200:ignored 200:ignored 200:ignored 200:ignored 200:ignored 200:ignored 200:ignored 200:ignored |
| IDEM-4 | same sale, new event id (sequential) → ignored/duplicate, not a second posting; same event id with different t | PASS | second sale new evt: duplicate/undefined; new evt+new saleId: ignored/sale_succeeded_but_succeeded; fail-after-success: ignored/sale_failed_but_succeeded; refund reusing a sale's event id: duplicate/undefined (state succeeded/0/mocktx_4ed0dd65779a7b35c3a3f234) |
| IDEM-5 | amount mismatch sale (tampered amount in signed event) → rejected, tx stays pending, no ledger | PASS | mismatch→rejected/amount_mismatch; tx pending, no ledger |
| IDEM-5b | after a REJECTED amount-mismatch sale event, the correct sale event for the same payment (same processor tx id | FAIL | legit sale after rejected mismatch → {"received":true,"outcome":"duplicate"}; tx=pending (dedupe claim burned by the rejected event?): expected processed, got duplicate |
| IDEM-5c | currency mismatch (EUR) sale rejected with no state change | PASS | EUR→amount_mismatch |
| IDEM-5d | a sale_succeeded for an UNKNOWN reference (ignored) does not burn the dedupe key of a later legit sale with th | FAIL | early=ignored/unknown_transaction; legit={"received":true,"outcome":"duplicate"}: expected processed, got duplicate |
| M3-10 / SIG-1 | webhook rejected: missing header | PASS | 401 invalid_signature |
| M3-10 / SIG-2 | webhook rejected: empty header | PASS | 401 invalid_signature |
| M3-10 / SIG-3 | webhook rejected: garbage header | PASS | 401 invalid_signature |
| M3-10 / SIG-4 | webhook rejected: truncated v1 (63 hex) | PASS | 401 invalid_signature |
| M3-10 / SIG-5 | webhook rejected: truncated v1 (half) | PASS | 401 invalid_signature |
| M3-10 / SIG-6 | webhook rejected: empty v1 | PASS | 401 invalid_signature |
| M3-10 / SIG-7 | webhook rejected: no t | PASS | 401 invalid_signature |
| M3-10 / SIG-8 | webhook rejected: wrong secret | PASS | 401 invalid_signature |
| M3-10 / SIG-9 | webhook rejected: empty-string secret | PASS | 401 invalid_signature |
| M3-10 / SIG-10 | webhook rejected: stale (-301s) | PASS | 401 invalid_signature |
| M3-10 / SIG-11 | webhook rejected: stale (-1 day) | PASS | 401 invalid_signature |
| M3-10 / SIG-12 | webhook rejected: future (+10min) | PASS | 401 invalid_signature |
| M3-10 / SIG-13 | webhook rejected: t tampered after signing | PASS | 401 invalid_signature |
| M3-10 / SIG-14 | webhook rejected: tampered body (amount changed after signing) | PASS | 401 invalid_signature |
| M3-10 / SIG-15 | webhook rejected: body with trailing whitespace after signing | PASS | 401 invalid_signature |
| M3-10 / SIG-16 | webhook rejected: uppercase-hex + valid secret but sig over different body | PASS | 401 invalid_signature |
| M3-10 / SIG-17 | webhook rejected: signature of body signed w/o timestamp prefix (raw HMAC) | PASS | 401 invalid_signature |
| M3-10 / SIG-18 | wrong content-type (text/plain, form-urlencoded, none) with VALID signature: not processed as an exploitable b | PASS | text/plain→200/processed (tx now succeeded; body is HMAC-verified JSON so content-type is not security relevant) |
| SIG-19 | valid signature w/ OK body processes (control) and replay of the exact signed request later is duplicate | PASS | replay of byte-identical signed request inside window → duplicate |
| SIG-20 | stale replay: previously valid request replayed > tolerance (simulated by old t) rejected even though event id | PASS | 401 |
| SIG-21 | tolerance boundary: t=-290s accepted, t=+290s accepted | PASS | both 200 |
| SIG-22 | unknown provider paths → 404 no state change: /stripe /paypal /__proto__ /constructor /MOCK /mock%2f.. | PASS | stripe:404 paypal:404 __proto__:404 constructor:404 toString:404 MOCK:404 mock%20:404 ..%2fmock:404 segpay:404 ccbill:404 |
| SIG-23 | timing-safe compare (code review): crypto.timingSafeEqual on equal-length buffers, always executed, constant-t | PASS | signature.ts uses timingSafeEqual on 32-byte buffers; non-hex candidate compares against zero buffer |
| SIG-24 | oversized body (300 KB) → 413 and nothing stored beyond cap; GET/PUT/DELETE method not allowed | PASS | POST 413, GET 405 |
| SIG-25 | rejected deliveries are logged (signature_valid=false, payload truncated ≤1KiB) and log flooding is limited (6 | PASS | 60×401 then 10×429; max stored rejected payload 247 bytes |
| SIG-26 | valid-signature but malformed payloads → 400 (schema), no state change: bad JSON, wrong types, negative/float/ | PASS | amount float:400 amount negative:400 amount string:400 amount huge:400 type unknown:400 no data:400 currency 4 chars:400 badjson:400 array:400 |
| SEC-1 injection | SQL injection / odd values in webhook reference, ids, failure_code: stored as data; no error, no schema damage | PASS | ref(' OR '1'='1):200/ignored ref('; DROP TABL):200/duplicate ref(00000000-000):200/duplicate ref(${{7*7}}):200/duplicate ref(36d13fd3-08f):200/duplicate ref(\):200/duplicate ref(é😀):200/duplicate; tx still succeeded, failure_code=null |
| SEC-1b NUL byte | signed event containing U+0000 in id/reference/failure_code → clean 4xx or handled (not 500 retry-storm) | FAIL | reference NUL → 500 {"error":"Internal error","code":"webhook_error"} |
| SEC-2 mass-assign | extra/unknown fields in webhook JSON (status, seller_id, platform_fee_cents, amount_cents at top-level) cannot | PASS | 200 processed; split unchanged 1560/200 |
| OOO-5b | refund WITHOUT merchant reference (processor sale id only) before the sale → parked; when sale (with processor | PASS | parked then applied via processor id match; refunded |
| M3-12 / OOO-1 | refund (with reference) before sale → parked(200), then sale arrives → refund applied, final refunded & ledger | PASS | parked→applied: [{"outcome":"processed","outcome_detail":"applied_after_sale"}] |
| OOO-2 | chargeback before sale → parked, then sale → charged_back, ledger nets to 0 (no chargeback fee set) | PASS | charged_back, ledger 0 |
| OOO-3 | partial refund + chargeback + refund all arrive before sale, in order → applied in received order after sale;  | PASS | final succeeded reversed=1200 ledgerSum=624; events ["500:processed/applied_after_sale","700:processed/applied_after_sale","1000:rejected/over_refund"] |
| OOO-4 | parked over-refund: refunds exceeding gross arrive before sale → excess rejected after sale, never over-refund | PASS | reversed 1500, status succeeded, events [{"outcome":"processed","outcome_detail":"applied_after_sale"},{"outcome":"rejected","outcome_detail":"over_refund"}] |
| OOO-5 | refund/chargeback for an unknown transaction uuid (ref matches nothing) → ignored, nothing created; refund w/o | PASS | unknown ref: ignored/unknown_transaction; non-uuid ref: ignored/unknown_transaction |
| OOO-6 | failed sale then success (retry with same checkout) accepted; success then failed ignored | PASS | failed(processed) → succeeded; ledger 3 lines |
| S2-05 audit | 3 random transactions traceable: txn → webhook_events (claim+dups) → ledger lines linked by webhook_event_id → | PASS | 1ae4055c:refunded wh=2 ledger=6; 262a3c1c:succeeded wh=2 ledger=3; c2191baf:succeeded wh=2 ledger=3 (no receipt record exists: receipt email not built) |