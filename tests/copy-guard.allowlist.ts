/**
 * Exact-string allowlist for tests/copy-guard.test.ts. An entry exempts ONE string (exact, whitespace-collapsed, `{}` = template hole) in ONE file —
 * never a whole file, never a substring. Every entry needs a written reason, and the guard fails if an entry no longer matches anything (stale).
 * Add an entry only when the wording is true today; if the sentence promises something that is not live, change the copy instead.
 */
export type Allow = { file: string; text: string; reason: string };

const DOWNLOAD_PANEL = "Presentational post-purchase panel. NOT routed anywhere (no order / download route exists); only rendered on /design, which 404s unless ENABLE_DESIGN_PAGE=1.";
const DELIVERY_SOON = "Explicitly says delivery is NOT available yet ('coming soon'); this is the one allowed delivery sentence.";
const VIDEO_FLAG = "Video wording is behind VIDEO_UPLOAD (lib/features.ts, currently false) or explicitly says video is coming soon / is a file-type label.";

export const ALLOW: Allow[] = [
  { file: "components/buyer/DownloadPanel.tsx", text: "Download {}", reason: DOWNLOAD_PANEL + " (aria-label)" },
  { file: "components/buyer/DownloadPanel.tsx", text: "Download", reason: DOWNLOAD_PANEL + " (button label)" },
  { file: "components/buyer/DownloadPanel.tsx", text: "Your download links are private to you and expire", reason: DOWNLOAD_PANEL + " (footnote)" },
  { file: "components/design/DesignExtras.tsx", text: "download", reason: "Anchor id of the /design showcase block (404 in production)." },
  { file: "components/design/DesignExtras.tsx", text: "Post-purchase download panel", reason: "/design showcase block title for DownloadPanel (404 in production)." },
  { file: "components/design/DesignExtras.tsx", text: "No checkout/order backend exists, so there is no live download route. See docs/frontend-dashboard-notes.md.", reason: "/design note that says there is NO live download route." },
  { file: "components/buyer/TrustPoints.tsx", text: "Access to the files is shared once your payment is confirmed. Delivery options are coming soon.", reason: DELIVERY_SOON },
  { file: "components/landing/BuyerTrust.tsx", text: "Once your payment is confirmed, the creator’s files are shared with you. Delivery options are coming soon.", reason: DELIVERY_SOON },
  { file: "components/landing/Faq.tsx", text: "No. Buyers pay with a card at checkout, with no sign-up or password. We ask for an email address at checkout, and access to the files is shared once the payment is confirmed. Delivery options are coming soon.", reason: DELIVERY_SOON },
  { file: "components/dashboard/NewDropFlow.tsx", text: "each. MP4 video up to", reason: VIDEO_FLAG + " (sentence continues: 'is coming soon')" },
  { file: "components/landing/PaymentLinkMock.tsx", text: "12 photos · 2 videos", reason: VIDEO_FLAG + " (only rendered when VIDEO_UPLOAD is true)" },
  { file: "lib/features.ts", text: "photos and videos", reason: VIDEO_FLAG + " (the VIDEO_UPLOAD=true branch)" },
  { file: "lib/features.ts", text: "(video is coming soon)", reason: VIDEO_FLAG },
  { file: "lib/format.ts", text: "video", reason: "File-count label ('2 images, 1 video') for files that exist in a drop; not a marketing claim." },
  { file: "lib/upload-limits.ts", text: "MP4 video uploads are coming soon — for now, add JPG, PNG or WebP images.", reason: VIDEO_FLAG },
  { file: "lib/upload-limits.ts", text: "Videos can be up to {} MB.", reason: VIDEO_FLAG + " (only reachable when videoUploadEnabled, i.e. VIDEO_UPLOAD true)" },
  { file: "src/app/components/DropEditor.tsx", text: "JPG, PNG or WebP. They’re added to this drop right away.", reason: "Seller upload step: files are attached to the draft immediately (not buyer delivery)." },
  { file: "src/app/components/ForgotPasswordForm.tsx", text: "Nothing in your inbox? Check your spam folder, or try again in a few minutes.", reason: "Password-reset mail (a real feature, the only mail the app sends)." },
  { file: "src/app/dashboard/page.tsx", text: "Becomes available right away", reason: "Payout hold hint when platform hold_days = 0 (balance availability, not delivery)." },
];

/**
 * BACKEND-OWNED strings (src/server, src/app/api). Frontend must not edit these, so they cannot make the suite red by existing — this is a RATCHET:
 * the listed hits are tolerated and reported (console.warn), but any NEW forbidden string in backend paths fails the suite. Backend should remove entries
 * when it fixes the string. Same exact-string rule and stale check as above.
 */
export const BACKEND_BASELINE: Allow[] = [
  { file: "src/server/services/drops.ts", text: "Identity verification required to publish (status: {})", reason: "BACKEND-OWNED API error text; verification is a status gate today (frontend maps the code to its own message). Report to Backend." },
  { file: "src/server/services/drops.ts", text: "video", reason: "BACKEND-OWNED: mime-kind label." },
  { file: "src/app/api/public/drops/[linkId]/route.ts", text: "video", reason: "BACKEND-OWNED: mime-kind field value." },
  { file: "src/app/api/files/[id]/original/route.ts", text: "DOWNLOAD", reason: "BACKEND-OWNED: audit/rate-limit action name, not rendered to users." },
];

/** Whole data files that are word lists, not copy (explicit, reasoned). */
export const SKIP_FILES: Record<string, string> = {
  "src/server/auth/common-passwords-data.ts": "Password blocklist (data, not copy); may contain any word.",
};
