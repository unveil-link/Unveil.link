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
  flagged: { label: "Under review", tone: "danger", hint: "This drop is paused while our team reviews it." },
};

export const VERIFICATION_META: Record<VerificationStatus, { label: string; tone: "warning" | "success" | "danger" | "primary"; hint: string }> = {
  pending: { label: "Pending", tone: "warning", hint: "You can create drafts and upload files now. Publishing unlocks once your identity is verified." },
  verified: { label: "Verified", tone: "success", hint: "You can publish drops." },
  failed: { label: "Failed", tone: "danger", hint: "Verification didn’t go through. Contact support to continue." },
  manual_review: { label: "In review", tone: "primary", hint: "A person is reviewing your verification. We’ll update this page." },
};
