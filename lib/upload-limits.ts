import { VIDEO_UPLOAD } from "./features";
import { formatBytes } from "./format";

/**
 * Client-side upload rules. Source of truth is the backend: `GET /api/settings` supplies the live numbers
 * (maxImageSizeBytes, maxFilesPerDrop, maxTotalBytesPerDrop, allowedImageMimes, price min/max). These defaults are
 * only used until that call returns (or if it fails) and match the backend defaults / product spec.
 */
export type UploadLimits = {
  priceMinCents: number;
  priceMaxCents: number;
  maxImageSizeBytes: number;
  maxVideoSizeBytes: number;
  maxFilesPerDrop: number;
  maxTotalBytesPerDrop: number;
  allowedImageMimes: string[];
  /** The backend has no video upload endpoint yet (images only). Driven by lib/features.ts (VIDEO_UPLOAD). */
  videoUploadEnabled: boolean;
};

export const DEFAULT_LIMITS: UploadLimits = {
  priceMinCents: 100,
  priceMaxCents: 50000,
  maxImageSizeBytes: 15 * 1024 ** 2,
  maxVideoSizeBytes: 500 * 1024 ** 2,
  maxFilesPerDrop: 10,
  maxTotalBytesPerDrop: 2 * 1024 ** 3,
  allowedImageMimes: ["image/jpeg", "image/png", "image/webp"],
  videoUploadEnabled: VIDEO_UPLOAD,
};

const MP4_MIME = "video/mp4";
const MP4_EXT = ".mp4";
const EXT_MIME: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", mp4: MP4_MIME };

/** `accept` attribute of the file picker. Video types are offered ONLY when video upload is live (lib/features.ts VIDEO_UPLOAD). */
export function acceptAttr(l: UploadLimits): string {
  return [...l.allowedImageMimes, ".jpg", ".jpeg", ".png", ".webp", ...(l.videoUploadEnabled ? [MP4_MIME, MP4_EXT] : [])].join(",");
}
/** Dropzone hint, from the real limits: "JPG, PNG or WebP · up to 10 files · 2 GB per drop" (MP4 is added only when video upload is live). */
export function dropzoneHint(l: UploadLimits): string {
  const types = l.videoUploadEnabled ? "JPG, PNG, WebP or MP4" : "JPG, PNG or WebP";
  return `${types} · up to ${l.maxFilesPerDrop} files · ${formatBytes(l.maxTotalBytesPerDrop)} per drop`;
}
/** The single note about video under the dropzone. */
export function videoNote(l: UploadLimits): string {
  return l.videoUploadEnabled ? `MP4 video up to ${formatBytes(l.maxVideoSizeBytes)} each.` : "Video upload is coming soon.";
}

export function mimeOf(f: { name: string; type: string }): string {
  if (f.type) return f.type;
  return EXT_MIME[f.name.split(".").pop()?.toLowerCase() ?? ""] ?? "";
}

/** Returns a user-facing problem with a single file, or null when it's acceptable. */
export function validateFile(f: { name: string; type: string; size: number }, l: UploadLimits): string | null {
  const mime = mimeOf(f);
  if (f.size === 0) return "This file is empty.";
  if (mime === MP4_MIME) {
    if (!l.videoUploadEnabled) return "Video upload is coming soon — for now, add JPG, PNG or WebP images.";
    if (f.size > l.maxVideoSizeBytes) return `Videos can be up to ${Math.round(l.maxVideoSizeBytes / 1024 ** 2)} MB.`;
    return null;
  }
  if (!l.allowedImageMimes.includes(mime)) return "Unsupported type. Use JPG, PNG or WebP.";
  if (f.size > l.maxImageSizeBytes) return `Images can be up to ${Math.round(l.maxImageSizeBytes / 1024 ** 2)} MB.`;
  return null;
}

export function validatePrice(raw: string, l: UploadLimits): string | null {
  if (!raw.trim()) return "Enter a price.";
  const n = Number(raw);
  if (!Number.isFinite(n)) return "Enter a valid amount, e.g. 12.00.";
  if (!/^\d+(\.\d{1,2})?$/.test(raw.trim())) return "Use at most two decimal places.";
  const cents = Math.round(n * 100);
  if (cents < l.priceMinCents) return `Minimum price is $${(l.priceMinCents / 100).toFixed(2)}.`;
  if (cents > l.priceMaxCents) return `Maximum price is $${(l.priceMaxCents / 100).toFixed(2)}.`;
  return null;
}
