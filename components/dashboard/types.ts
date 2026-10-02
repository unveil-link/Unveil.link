export type DropStatus = "draft" | "published" | "unpublished" | "flagged";
export type VerificationStatus = "pending" | "verified" | "failed" | "manual_review";

export type DropRow = {
  id: string;
  title: string;
  priceCents: number;
  status: DropStatus;
  publicLinkId: string;
  fileCount: number;
  createdAt: string;
  units: number;
  revenueCents: number;
  /** id of the first file with a (blurred) preview, for the thumbnail */
  thumbFileId: string | null;
};

export const STATUS_META: Record<DropStatus, { label: string; tone: "neutral" | "success" | "warning" | "danger"; hint: string }> = {
  draft: { label: "Draft", tone: "neutral", hint: "Only you can see this. Publish it when you’re ready." },
  published: { label: "Published", tone: "success", hint: "Live — anyone with the link can buy." },
  unpublished: { label: "Unpublished", tone: "warning", hint: "The link is switched off. Publish again to turn it back on." },
  flagged: { label: "Under review", tone: "danger", hint: "This drop is paused and under review. It can’t be edited or published for now." },
};

/**
 * What a seller is told in each verification state - worded for what actually exists today: `sellers.verification_status` is set only by
 * `scripts/set-verification.ts` / SQL (no KYC provider, no admin verification screen, no self-serve flow, /contact is a placeholder).
 * What IS enforced: publishing (and checkout of a published link) requires status "verified".
 */
export const VERIFICATION_META: Record<VerificationStatus, { label: string; tone: "warning" | "success" | "danger" | "primary"; hint: string }> = {
  pending: { label: "Pending", tone: "warning", hint: "You can create drafts and upload files now. Publishing stays off until your account is verified, and verification isn’t self-serve yet. We’ll share next steps here when they’re available." },
  verified: { label: "Verified", tone: "success", hint: "Your account is verified. You can publish drops." },
  failed: { label: "Not completed", tone: "danger", hint: "Verification wasn’t completed. You can keep drafting drops; publishing stays off until your account is verified. We’ll share next steps here when they’re available." },
  manual_review: { label: "Marked for review", tone: "primary", hint: "Your verification is marked for review. You can keep drafting drops; publishing stays off until it’s cleared." },
};
