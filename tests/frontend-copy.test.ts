import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { VIDEO_UPLOAD } from "../lib/features";
import { acceptAttr, DEFAULT_LIMITS, dropzoneHint, validateFile, videoNote } from "../lib/upload-limits";
import { VERIFICATION_META, type VerificationStatus } from "../components/dashboard/types";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8");
const OFF = { ...DEFAULT_LIMITS, videoUploadEnabled: false };
const ON = { ...DEFAULT_LIMITS, videoUploadEnabled: true };

describe("FE-20: upload copy + accept attribute follow VIDEO_UPLOAD (lib/features.ts)", () => {
  it("the shipped default limits are driven by the flag", () => {
    expect(DEFAULT_LIMITS.videoUploadEnabled).toBe(VIDEO_UPLOAD);
  });
  it("flag off: images only everywhere (hint, accept, validation, note)", () => {
    const l = { ...OFF, maxFilesPerDrop: 20, maxTotalBytesPerDrop: 2 * 1024 ** 3 };
    expect(dropzoneHint(l)).toBe("JPG, PNG or WebP · up to 20 files · 2 GB per drop");
    expect(dropzoneHint(l)).not.toMatch(/mp4|video/i);
    expect(acceptAttr(l)).not.toMatch(/mp4|video/i);
    expect(acceptAttr(l)).toContain("image/webp");
    expect(videoNote(l)).toBe("Video upload is coming soon.");
    expect(validateFile({ name: "a.mp4", type: "video/mp4", size: 10 }, l)).toBe("Video upload is coming soon — for now, add JPG, PNG or WebP images.");
    expect(validateFile({ name: "clip.mp4", type: "", size: 10 }, l)).toMatch(/coming soon/);
  });
  it("flag on: everything flips back", () => {
    const l = { ...ON, maxFilesPerDrop: 20, maxTotalBytesPerDrop: 2 * 1024 ** 3 };
    expect(dropzoneHint(l)).toBe("JPG, PNG, WebP or MP4 · up to 20 files · 2 GB per drop");
    expect(acceptAttr(l)).toContain("video/mp4");
    expect(acceptAttr(l).split(",")).toContain(".mp4");
    expect(videoNote(l)).toMatch(/^MP4 video up to .* each\.$/);
    expect(validateFile({ name: "a.mp4", type: "video/mp4", size: 10 }, l)).toBeNull();
  });
  it("the three upload surfaces use the helpers (no hard-coded type lists)", () => {
    const dz = read("components/dashboard/FileDropzone.tsx");
    expect(dz).toMatch(/acceptAttr\(limits\)/);
    expect(dz).toMatch(/dropzoneHint\(limits\)/);
    expect(dz.replace(/VideoIcon|isVideo|startsWith\("video\/"\)/g, "")).not.toMatch(/mp4|video/i);
    const nd = read("components/dashboard/NewDropFlow.tsx");
    expect(nd).toMatch(/videoNote\(limits\)/);
    expect(nd.replace(/videoNote/g, "")).not.toMatch(/mp4|video/i);
    expect(read("src/app/components/DropEditor.tsx")).toMatch(/FileDropzone/);
  });
});

describe("FE-21: verification-state messages describe what actually happens", () => {
  const states: VerificationStatus[] = ["pending", "failed", "manual_review", "verified"];
  it("no state promises support contact, a human reviewer, a timeline or a self-serve flow", () => {
    for (const s of states) {
      const m = VERIFICATION_META[s];
      expect(`${m.label} ${m.hint}`, s).not.toMatch(/contact|support|a person|someone|our team|team will|human|within|hours|days|shortly|appeal|upload (?:your )?(?:id|document)/i);
    }
  });
  it("failed / manual_review / pending say publishing is off and drafting works; verified says you can publish", () => {
    expect(VERIFICATION_META.failed.hint).toBe("Verification wasn’t completed. You can keep drafting drops; publishing stays off until your account is verified. We’ll share next steps here when they’re available.");
    expect(VERIFICATION_META.manual_review.hint).toMatch(/^Your verification is marked for review\./);
    expect(VERIFICATION_META.manual_review.hint).toMatch(/publishing stays off until it’s cleared/);
    expect(VERIFICATION_META.pending.hint).toMatch(/create drafts and upload files now/i);
    expect(VERIFICATION_META.pending.hint).toMatch(/Publishing stays off until your account is verified/);
    expect(VERIFICATION_META.verified.hint).toMatch(/can publish/);
  });
  it("the dashboard banner, drop detail, new-drop flow and publish dialog all render VERIFICATION_META (one source of truth)", () => {
    for (const f of ["components/dashboard/PublishDialog.tsx", "src/app/components/DropEditor.tsx", "components/dashboard/NewDropFlow.tsx", "src/app/dashboard/page.tsx"]) {
      expect(read(f), f).toMatch(/VERIFICATION_META/);
    }
  });
});

describe("FE-22: signup / landing copy does not over-promise", () => {
  it("signup subtitle says drafting now, publishing after verification", () => {
    const a = read("src/app/components/AuthForm.tsx");
    expect(a).toContain("Create your account and start drafting drops. Publishing opens once your account is verified.");
    expect(a).not.toMatch(/Start sharing paid links today/);
  });
  it("landing CTAs say 'Create your account', not 'Start selling'", () => {
    for (const f of ["components/landing/Hero.tsx", "components/landing/SellerCta.tsx", "components/landing/SiteHeader.tsx"]) {
      expect(read(f), f).toMatch(/Create your account/);
      expect(read(f), f).not.toMatch(/Start selling/);
    }
  });
});
