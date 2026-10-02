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
  /** The backend has no video upload endpoint yet (images only). Flip when it ships. */
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
  videoUploadEnabled: false,
};

const EXT_MIME: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", mp4: "video/mp4" };

export function mimeOf(f: { name: string; type: string }): string {
  if (f.type) return f.type;
  return EXT_MIME[f.name.split(".").pop()?.toLowerCase() ?? ""] ?? "";
}

/** Returns a user-facing problem with a single file, or null when it's acceptable. */
export function validateFile(f: { name: string; type: string; size: number }, l: UploadLimits): string | null {
  const mime = mimeOf(f);
  if (f.size === 0) return "This file is empty.";
  if (mime === "video/mp4") {
    if (!l.videoUploadEnabled) return "MP4 video uploads are coming soon — for now, add JPG, PNG or WebP images.";
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
