# Unveil v1 QA Test Plan

Source: Unveil v1 Build Specification (Sept 30, 2026), section 12 (milestone acceptance) and section 2 (success criteria), plus the spec requirements each one depends on.
Owner: Unveil QA. Status legend: PASS / FAIL / BLOCKED / NOT RUN. Every case starts NOT RUN.
Environment: test mode (processor sandbox) until M3 real-charge case. Devices: iOS Safari, Android Chrome, desktop Chrome.

## How to record results
Each case: ID, owner bot (FE = Frontend, BE = Backend, PAY = Payments), steps, expected, Result, Notes/evidence (screenshot, URL, txn ID).

---
## M1 Foundations (wk 1-2)
Acceptance: Seller can sign up, upload files, see blurred previews.

| ID | Owner | Steps | Expected | Result |
|---|---|---|---|---|
| M1-01 | BE/FE | Sign up with email + password (valid, new email) | Account created; redirected to dashboard; unverified status shown | NOT RUN |
| M1-02 | BE/FE | Sign up / sign in with Google OAuth | Account created/logged in; same session behavior as email | NOT RUN |
| M1-03 | BE | Sign up with already-used email; weak password; malformed email | Clear validation errors; no duplicate account | NOT RUN |
| M1-04 | BE/FE | Log out, log back in, reset password | All work; old session invalid after logout | NOT RUN |
| M1-05 | FE | Upload 1 JPG, then PNG, then WebP to a draft drop | Each uploads with progress bar; appears in file list | NOT RUN |
| M1-06 | FE | Upload 1 MP4 | Uploads with progress; appears in list | NOT RUN |
| M1-07 | BE/FE | Upload unsupported types (GIF, PDF, EXE, renamed .exe as .jpg) | Rejected with clear message; server validates content, not just extension | NOT RUN |
| M1-08 | BE/FE | Upload file over 500 MB; drop total over 2 GB; 11th file | Each blocked with clear limit message | NOT RUN |
| M1-09 | FE/BE | Interrupt an upload (kill network / close tab) and resume | Upload resumes from where it stopped (tus-style), no restart | NOT RUN |
| M1-10 | BE | After image upload, view generated blurred preview | Preview exists, is actually blurred (text/faces unreadable), original not recoverable from preview file | NOT RUN |
| M1-11 | BE | After MP4 upload, view generated preview | Blurred thumbnail generated from video | NOT RUN |
| M1-12 | BE | Try to fetch a stored original by guessing the storage URL / public bucket path | Denied; files only reachable via signed URLs | NOT RUN |
| M1-13 | BE | Check another seller's draft/files via direct ID (IDOR test) | 403/404; no data leaked | NOT RUN |
| M1-14 | BE | Confirm CI/CD, hosting, HTTPS, DB schema match section 11 entities | All entities/fields present; HTTP redirects to HTTPS | NOT RUN |

## M2 Drops + links (wk 3-4)
Acceptance: Full seller -> link -> buyer download path works end-to-end in test mode.

| ID | Owner | Steps | Expected | Result |
|---|---|---|---|---|
| M2-01 | FE/BE | Create drop: title, price $20, description, cover image | Saved as draft | NOT RUN |
| M2-02 | BE | Price boundaries: $0.99, $1, $500, $500.01, negative, non-numeric | $1 and $500 accepted; others rejected | NOT RUN |
| M2-03 | BE | Publish as unverified seller | Blocked: must verify 18+ first (see M4) | NOT RUN |
| M2-04 | BE/FE | Publish as verified seller (test override acceptable before M4) | Link generated in form unveil.link/u/<12 chars> | NOT RUN |
| M2-05 | BE | Publish without ticking all attestation boxes | Blocked; with all ticked, attestation stored per drop with timestamp | NOT RUN |
| M2-06 | BE | Generate 100 links; check uniqueness and randomness; try sequential guessing | All unique, unguessable, exactly 12 chars | NOT RUN |
| M2-07 | FE | Open link in logged-out browser | Page shows blurred preview, title, file count + types, price, seller display name; no originals exposed | NOT RUN |
| M2-08 | BE/FE | Inspect link page source/network for original file URLs | None present | NOT RUN |
| M2-09 | BE | Check link page for noindex (meta and X-Robots-Tag), no sitemap entry, no directory/search | noindex present; no public listing anywhere | NOT RUN |
| M2-10 | FE/BE | Edit price and description of published drop | Changes reflected on link page | NOT RUN |
| M2-11 | FE/BE | Unpublish drop | Link shows unavailable page; buying disabled | NOT RUN |
| M2-12 | BE | Buy, then unpublish, then use buyer's download link | Existing buyer download still works | NOT RUN |
| M2-13 | FE/BE | Delete a drop | Drop removed from dashboard; link dead; behavior for prior buyers documented and consistent | NOT RUN |
| M2-14 | FE/BE | Download page: each file individual button + Download all | Each file downloads intact (checksum matches original); zip contains all files | NOT RUN |
| M2-15 | BE | Download URL expiry (24h, configurable) — use time override or short config | Expired link rejected; receipt link generates a fresh one | NOT RUN |
| M2-16 | BE | Exceed 5 download attempts | 6th attempt blocked with clear message | NOT RUN |
| M2-17 | BE | Rate limiting on download endpoint (rapid repeat requests) | 429 after threshold | NOT RUN |
| M2-18 | FE | Link page on iOS Safari, Android Chrome (responsive, no layout breaks) | Usable, readable, Buy button reachable | NOT RUN |
| M2-19 | FE | Link page load time on throttled 4G | Under 2s to usable | NOT RUN |

## M3 Payments (wk 4-6)
Acceptance: Real $1 test charge flows through with correct fee split and seller balance update.

| ID | Owner | Steps | Expected | Result |
|---|---|---|---|---|
| M3-01 | PAY/FE | Click Buy as guest, no account | Card form shown; no login demanded | NOT RUN |
| M3-02 | PAY | Successful sandbox card payment | Transaction status succeeded; redirect to download page immediately | NOT RUN |
| M3-03 | PAY | Declined card; insufficient funds; expired card | Clear error; no download access; no succeeded transaction | NOT RUN |
| M3-04 | PAY | 3D Secure card flow (challenge pass and fail) | Pass completes purchase; fail leaves no access | NOT RUN |
| M3-05 | PAY | Fee math at defaults: $20 sale | Processing ~$2.40, platform $2.00, seller net ~$15.60; stored in transactions in cents | NOT RUN |
| M3-06 | PAY | Fee math on other amounts ($1, $9.99, $500) | Rounding consistent; processing + platform + net = gross exactly | NOT RUN |
| M3-07 | PAY/BE | Change platform fee % in admin settings (e.g., 15%), make a sale | New fee applied with no code deploy; old transactions unchanged | NOT RUN |
| M3-08 | PAY | Real $1 live charge (final acceptance) | Charge succeeds; fee split correct; seller pending balance increases by expected net | NOT RUN |
| M3-09 | PAY | Seller balance update | Pending vs available funds correct; hold applied | NOT RUN |
| M3-10 | PAY | Webhook with invalid/missing signature | Rejected; no state change | NOT RUN |
| M3-11 | PAY | Replay same webhook 3 times | Idempotent: one transaction, one balance credit, one receipt | NOT RUN |
| M3-12 | PAY | Webhook arrives out of order / endpoint down then retried | Queued with retry; final state correct | NOT RUN |
| M3-13 | PAY/BE | Receipt email after purchase | Sent with transaction ID and re-download link; no marketing content; generic branding, no adult signaling | NOT RUN |
| M3-14 | BE | Receipt link re-access later | Works within policy; new signed URLs issued | NOT RUN |
| M3-15 | PAY/FE | Adult-flagged drop checkout | Self-declared 18+ checkbox required before pay | NOT RUN |
| M3-16 | PAY | Rate limiting on checkout endpoint | 429 after threshold; legit single buyer unaffected | NOT RUN |
| M3-17 | PAY | Confirm no Stripe/PayPal anywhere in code, network calls, or docs | None; CCBill or Segpay in use, choice and fee math documented | NOT RUN |
| M3-18 | PAY/FE | Pre-purchase "all sales final" statement | Clearly visible before paying | NOT RUN |
| M3-19 | PAY/FE | Card data handling | Card fields hosted by processor; no card data hits our servers/logs | NOT RUN |
| M3-20 | PAY/FE | Full buyer flow timing on mobile | Open link to download under 60 seconds | NOT RUN |

## M4 Verification + payouts (wk 6-7)
Acceptance: Verified seller completes a sale and receives a test payout.

| ID | Owner | Steps | Expected | Result |
|---|---|---|---|---|
| M4-01 | BE/FE | New seller starts ID verification | Redirected to provider flow; status pending | NOT RUN |
| M4-02 | BE | Provider returns verified | Status verified; provider ref + timestamp stored; email sent; publish unlocked | NOT RUN |
| M4-03 | BE | Provider returns failed | Status failed; email sent; publish remains blocked; retry possible | NOT RUN |
| M4-04 | BE | Provider returns manual_review | Status manual_review; email sent; publish blocked | NOT RUN |
| M4-05 | BE | Verification webhook signature and replay | Invalid rejected; replay idempotent | NOT RUN |
| M4-06 | BE | Unverified seller: draft OK, publish blocked, payments blocked (API and UI) | Enforced server-side, not just hidden in UI | NOT RUN |
| M4-07 | BE | Raw ID images | Not stored beyond provider need; retention window documented and implemented | NOT RUN |
| M4-08 | BE | 2257 data: legal name, DOB, provider ref, per-drop attestation stored; admin export | Complete export downloads for a seller/drop | NOT RUN |
| M4-09 | FE | Dashboard earnings summary | Gross, platform fees, processing fees, net, pending vs available all correct vs transactions | NOT RUN |
| M4-10 | FE | Per-drop stats | Views, conversion, units sold, revenue accurate after known test traffic | NOT RUN |
| M4-11 | FE | Transaction history | Buyer country, amount, fee breakdown, status present and correct | NOT RUN |
| M4-12 | PAY/FE | Connect bank account via payout provider | Connects; details stored via provider, not raw | NOT RUN |
| M4-13 | PAY | Request payout below $25 | Blocked with message | NOT RUN |
| M4-14 | PAY | Request payout at/above $25 with funds in hold | Only available (post-hold) funds payable; first-payout 7-day hold honored | NOT RUN |
| M4-15 | PAY | Payout end to end (test mode) | Seller receives test payout; payout record and balance updated; history shows it | NOT RUN |
| M4-16 | PAY | Payout failure | Status failed, funds returned, visible to admin | NOT RUN |
| M4-17 | BE | Seller profile: display name, avatar, bio | Editable; no public profile page exists | NOT RUN |
| M4-18 | FE | Seller: signup to first live link timing | Under 15 minutes excluding ID wait | NOT RUN |

## M5 Trust + admin (wk 7-8)
Acceptance: Flagged drop auto-unpublishes; admin can refund and suspend.

| ID | Owner | Steps | Expected | Result |
|---|---|---|---|---|
| M5-01 | BE | Upload a moderation-API test image that triggers a banned category | Drop auto-unpublishes, status flagged, appears in moderation queue | NOT RUN |
| M5-02 | BE | Upload clean content | Passes screening; not flagged | NOT RUN |
| M5-03 | FE/BE | Buyer reports a drop | Report stored; appears in admin queue | NOT RUN |
| M5-04 | FE | Admin reviews flagged drop: clear or confirm takedown | Status updates; seller notified as appropriate | NOT RUN |
| M5-05 | BE | Admin full refund | Transaction status refunded; seller balance reduced | NOT RUN |
| M5-06 | BE | Admin partial refund | Correct partial amount; fees handled consistently | NOT RUN |
| M5-07 | BE | Refund with insufficient seller balance | Negative balance allowed; deducted from future earnings | NOT RUN |
| M5-08 | PAY | Simulated chargeback webhook | Transaction charged_back; repeat chargebacks flag seller for review | NOT RUN |
| M5-09 | BE | Suspend seller | Seller cannot log in/publish; links disabled per policy; reversible | NOT RUN |
| M5-10 | BE | Ban seller | As suspend, permanent; history retained | NOT RUN |
| M5-11 | BE | Admin views seller verification status and full transaction history | Accurate and complete | NOT RUN |
| M5-12 | BE | Admin approves/releases payouts and views failures | Works; state changes recorded | NOT RUN |
| M5-13 | BE | Change settings (fee %, price min/max, file limits, payout schedule, hold periods) | Take effect without deploy; validated | NOT RUN |
| M5-14 | BE | Audit log | Every admin action logged with timestamp and admin identity; log not editable | NOT RUN |
| M5-15 | BE | Privilege test: seller or anonymous hits admin routes/APIs | 401/403 everywhere | NOT RUN |
| M5-16 | FE | Legal pages: ToS, Privacy, 2257 statement, DMCA form | Present, linked from footer and checkout; placeholders flagged if not lawyer-final | NOT RUN |
| M5-17 | BE/FE | DMCA takedown intake form submitted | Stored; admin workflow handles it; repeat-infringer policy in ToS | NOT RUN |
| M5-18 | BE | Seller data export and delete (GDPR/CCPA) | Export delivered; delete removes data subject to documented retention | NOT RUN |
| M5-19 | FE | Cookie consent | Banner shown; non-essential cookies blocked until consent | NOT RUN |
| M5-20 | FE/BE | Neutral branding audit: UI, emails, page titles, meta, error text, receipts | No adult-market signaling anywhere | NOT RUN |

## M6 Hardening + launch
Acceptance: All acceptance criteria pass; go-live sign-off.

| ID | Owner | Steps | Expected | Result |
|---|---|---|---|---|
| M6-01 | BE | Security review: OWASP baseline (injection, XSS, CSRF, auth, IDOR, SSRF, file upload) | No high/critical findings open | NOT RUN |
| M6-02 | BE | Security headers, TLS config, no public buckets, secrets not in repo/client bundle | Clean | NOT RUN |
| M6-03 | BE | Load test on link page, checkout, download | Holds target latency; no errors at agreed load | NOT RUN |
| M6-04 | BE | Backup and restore drill | Daily encrypted backup restores successfully; files and DB consistent | NOT RUN |
| M6-05 | BE | Monitoring: Sentry captures an induced error; uptime monitor alerts on induced outage | Alerts fire | NOT RUN |
| M6-06 | FE | Status page or in-app incident banner | Can be toggled and shows to sellers | NOT RUN |
| M6-07 | FE | PWA manifest, installability, mobile Safari/Chrome full pass | Installs; flows work flawlessly | NOT RUN |
| M6-08 | BE | Webhook queue retry under processor outage | No lost or duplicated transactions | NOT RUN |
| M6-09 | All | Re-run every case in M1 to M5 on production-like environment | All PASS | NOT RUN |
| M6-10 | All | Launch checklist: processor approved, DMCA agent registered, legal pages counsel-reviewed, retention documented | All items checked | NOT RUN |

## Section 2 success criteria (cross-cutting)
| ID | Steps | Expected | Result |
|---|---|---|---|
| S2-01 | Timed run, new seller: landing page to live link | Under 15 min excluding ID wait (maps to M4-18) | NOT RUN |
| S2-02 | Timed run, new buyer: open link to files downloaded, no account | Under 60 s (maps to M3-20) | NOT RUN |
| S2-03 | Change fee to non-default, verify on sale | Platform cut configurable; seller gets remainder minus processing (M3-07) | NOT RUN |
| S2-04 | Attempt publish without verified 18+ | Always blocked (M2-03, M4-06) | NOT RUN |
| S2-05 | Pick 3 random transactions and trace | Full audit trail: txn, webhook, fee split, receipt, any refund (M3-05, M3-11, M5-14) | NOT RUN |

## Open questions / assumptions
1. Spec has no explicit download-all size limit; I will flag if zip generation fails on a 2 GB drop.
2. Spec open questions (fee %, payout provider, ID provider, geography) affect expected values; I'll record which choice each bot made and test against it.
3. M3-08 needs a real processor account; until then I'll mark it BLOCKED and run sandbox equivalents.
4. Retention windows are not specified; I'll check that they are documented and enforced, not assert specific numbers.
