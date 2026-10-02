/**
 * Exact-string allowlist for tests/copy-guard.test.ts. An entry exempts ONE string (exact, whitespace-collapsed, `{}` = template hole) in ONE file,
 * at most `count` times (default 1) - never a whole file, never a substring, never "one more of the same". Every entry needs a written reason, and the
 * guard fails if an entry no longer matches (stale) or matches fewer times than `count`. There are no file-level exemptions (SKIP_FILES was removed).
 * Add an entry only when the wording is true today; if the sentence promises something that is not live, change the copy instead.
 */
export type Allow = { file: string; text: string; reason: string; count?: number };

const DOWNLOAD_PANEL = "Presentational post-purchase panel. NOT routed anywhere (no order / download route exists); only rendered on /design, which 404s unless ENABLE_DESIGN_PAGE=1.";
const DELIVERY_SOON = "Explicitly says delivery is NOT available yet ('coming soon'); this is the one allowed delivery sentence.";
const VIDEO_FLAG = "Video wording is behind VIDEO_UPLOAD (lib/features.ts, currently false; the guard re-evaluates the flag) or is a file-type constant.";
const VIDEO_NOTE = "The single allowed video note: says video upload is NOT available yet. Rendered only while VIDEO_UPLOAD=false.";
const RESET_MAIL = "Password-reset mail (a real feature: POST /api/auth/forgot-password sends a reset link; the only mail the app sends).";

export const ALLOW: Allow[] = [
  { file: "components/buyer/DownloadPanel.tsx", text: "Thanks — your files are ready", reason: DOWNLOAD_PANEL + " (heading)" },
  { file: "components/buyer/DownloadPanel.tsx", text: "Download {}", reason: DOWNLOAD_PANEL + " (aria-label)" },
  { file: "components/buyer/DownloadPanel.tsx", text: "Download", reason: DOWNLOAD_PANEL + " (button label)" },
  { file: "components/buyer/DownloadPanel.tsx", text: "Your download links are private to you and expire", reason: DOWNLOAD_PANEL + " (footnote)" },
  { file: "components/design/DesignExtras.tsx", text: "download", reason: "Anchor id of the /design showcase block (404 in production)." },
  { file: "components/design/DesignExtras.tsx", text: "Post-purchase download panel", reason: "/design showcase block title for DownloadPanel (404 in production)." },
  { file: "components/design/DesignExtras.tsx", text: "No checkout/order backend exists, so there is no live download route. See docs/frontend-dashboard-notes.md.", reason: "/design note that says there is NO live download route." },
  { file: "components/buyer/TrustPoints.tsx", text: "Access to the files is shared once your payment is confirmed. Delivery options are coming soon.", reason: DELIVERY_SOON },
  { file: "components/landing/BuyerTrust.tsx", text: "Once your payment is confirmed, the creator’s files are shared with you. Delivery options are coming soon.", reason: DELIVERY_SOON },
  { file: "components/landing/Faq.tsx", text: "No. Buyers pay with a card at checkout, with no sign-up or password. We ask for an email address at checkout, and access to the files is shared once the payment is confirmed. Delivery options are coming soon.", reason: DELIVERY_SOON },
  { file: "components/landing/PaymentLinkMock.tsx", text: "12 photos · 2 videos", reason: VIDEO_FLAG + " (only rendered when VIDEO_UPLOAD is true)" },
  { file: "lib/features.ts", text: "photos and videos", reason: VIDEO_FLAG + " (the VIDEO_UPLOAD=true branch)" },
  { file: "lib/features.ts", text: "(video is coming soon)", reason: VIDEO_FLAG },
  { file: "lib/format.ts", text: "video", reason: "File-count label ('2 images, 1 video') for files that exist in a drop; not a marketing claim." },
  { file: "lib/upload-limits.ts", text: "video/mp4", reason: VIDEO_FLAG + " (MIME constant; offered in `accept` only when videoUploadEnabled)" },
  { file: "lib/upload-limits.ts", text: ".mp4", reason: VIDEO_FLAG + " (extension constant; offered in `accept` only when videoUploadEnabled)" },
  { file: "lib/upload-limits.ts", text: "JPG, PNG, WebP or MP4", reason: VIDEO_FLAG + " (dropzone hint; used only when videoUploadEnabled, covered by unit + e2e tests)" },
  { file: "lib/upload-limits.ts", text: "MP4 video up to {} each.", reason: VIDEO_FLAG + " (videoNote(), videoUploadEnabled branch)" },
  { file: "lib/upload-limits.ts", text: "Video upload is coming soon.", reason: VIDEO_NOTE },
  { file: "lib/upload-limits.ts", text: "Video upload is coming soon — for now, add JPG, PNG or WebP images.", reason: VIDEO_NOTE + " (validation message for a picked .mp4)" },
  { file: "lib/upload-limits.ts", text: "Videos can be up to {} MB.", reason: VIDEO_FLAG + " (only reachable when videoUploadEnabled)" },
  { file: "src/app/components/DropEditor.tsx", text: "JPG, PNG or WebP. They’re added to this drop right away.", reason: "Seller upload step: files are attached to the draft immediately (not buyer delivery)." },
  { file: "src/app/components/ForgotPasswordForm.tsx", text: "Check your email", reason: RESET_MAIL },
  { file: "src/app/components/ForgotPasswordForm.tsx", text: ", we’ve sent a link to reset your password. It’s valid for 1 hour.", reason: RESET_MAIL },
  { file: "src/app/components/ForgotPasswordForm.tsx", text: "Nothing in your inbox? Check your spam folder, or try again in a few minutes.", reason: RESET_MAIL },
  { file: "src/app/components/ForgotPasswordForm.tsx", text: "Enter the email you signed up with and we’ll send you a reset link.", reason: RESET_MAIL },
  { file: "src/app/dashboard/page.tsx", text: "Becomes available right away", reason: "Payout hold hint when platform hold_days = 0 (balance availability, not delivery)." },
  { file: "src/app/dashboard/page.tsx", text: "Paid out", reason: "Label of the payout-status bucket (payouts marked as paid by an operator); describes a ledger state, not a promise." },
  { file: "src/app/dashboard/page.tsx", text: "Net earnings = gross sales − platform fee − card-processing fees − refunds, chargebacks and chargeback fees. Available + pending + in payout + paid out add up to your net earnings.", reason: "Earnings-breakdown definition (ledger arithmetic), not a payout promise." },
]

/**
 * BACKEND-OWNED strings (src/server, src/app/api). Frontend must not edit these, so they cannot make the suite red by existing - this is a RATCHET:
 * the listed hits are tolerated and reported (console.warn), but any NEW forbidden string in backend paths fails the suite. Backend should remove entries
 * when it fixes the string. Same exact-string, count and stale rules as above.
 */
const PASSWORD_WORD = "BACKEND-OWNED: one line of the password blocklist (data, not copy; a common password that happens to be a flagged word).";

export const BACKEND_BASELINE: Allow[] = [
  { file: "src/app/api/files/[id]/original/route.ts", text: "DOWNLOAD", reason: "BACKEND-OWNED: audit/rate-limit action name, not rendered to users." },
  { file: "src/app/api/public/drops/[linkId]/route.ts", text: "video", reason: "BACKEND-OWNED: mime-kind field value." },
  { file: "src/server/services/drops.ts", text: "Identity verification required to publish (status: {})", reason: "BACKEND-OWNED API error text; verification is a status gate today (frontend maps the code to its own message). Report to Backend." },
  { file: "src/server/services/drops.ts", text: "video", reason: "BACKEND-OWNED: mime-kind label." },
  { file: "src/server/auth/common-passwords-data.ts", text: "clips", reason: PASSWORD_WORD },
  { file: "src/server/auth/common-passwords-data.ts", text: "download", reason: PASSWORD_WORD },
  { file: "src/server/auth/common-passwords-data.ts", text: "film", reason: PASSWORD_WORD },
  { file: "src/server/auth/common-passwords-data.ts", text: "films", reason: PASSWORD_WORD },
  { file: "src/server/auth/common-passwords-data.ts", text: "films+pic+galeries", reason: PASSWORD_WORD, count: 2 },
  { file: "src/server/auth/common-passwords-data.ts", text: "instant", reason: PASSWORD_WORD },
  { file: "src/server/auth/common-passwords-data.ts", text: "movie", reason: PASSWORD_WORD },
  { file: "src/server/auth/common-passwords-data.ts", text: "movies", reason: PASSWORD_WORD },
  { file: "src/server/auth/common-passwords-data.ts", text: "streaming", reason: PASSWORD_WORD },
  { file: "src/server/auth/common-passwords-data.ts", text: "telechargement", reason: PASSWORD_WORD, count: 2 },
  { file: "src/server/auth/common-passwords-data.ts", text: "unlock", reason: PASSWORD_WORD },
  { file: "src/server/auth/common-passwords-data.ts", text: "video", reason: PASSWORD_WORD },
]
