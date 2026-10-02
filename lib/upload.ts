import { formatDurationLong } from "./format";

export type UploadOutcome =
  | { ok: true; file: { id: string; filename?: string; mime?: string; size_bytes?: number } }
  | { ok: false; status: number; error: string; code?: string; retryAfter?: number; aborted?: boolean };

/** POST /api/drops/:id/files as multipart (field `file`) with upload progress (fetch can't report it). */
export function uploadFile(
  dropId: string,
  file: File,
  onProgress: (pct: number) => void,
  signal?: AbortSignal,
): Promise<UploadOutcome> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/drops/${dropId}/files`);
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.min(99, (e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      const body = (xhr.response ?? {}) as { error?: string; code?: string; file?: { id: string } };
      if (xhr.status >= 200 && xhr.status < 300 && body.file) {
        onProgress(100);
        resolve({ ok: true, file: body.file });
      } else {
        const ra = Number(xhr.getResponseHeader("retry-after"));
        resolve({
          ok: false,
          status: xhr.status,
          error: body.error ?? "Upload failed.",
          code: body.code,
          retryAfter: xhr.status === 429 && Number.isFinite(ra) ? ra : undefined,
        });
      }
    };
    xhr.onerror = () => resolve({ ok: false, status: 0, error: "Network error — check your connection and retry." });
    xhr.onabort = () => resolve({ ok: false, status: 0, error: "Upload cancelled.", aborted: true });
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    const fd = new FormData();
    fd.append("file", file);
    xhr.send(fd);
  });
}

/** Friendly text for backend upload error codes. */
export function uploadErrorMessage(r: Extract<UploadOutcome, { ok: false }>): string {
  switch (r.code) {
    case "file_too_large": return "This file is larger than the allowed size.";
    case "too_many_files": return "This drop already has the maximum number of files.";
    case "drop_too_large": return "This drop has reached its total size limit.";
    case "unsupported_type": return "Only JPG, PNG and WebP images are supported right now.";
    case "invalid_image": return "We couldn’t read this image. Try re-exporting it as JPG or PNG.";
    case "empty_file": return "This file is empty.";
    case "unauthenticated": return "Your session expired. Sign in again to continue.";
    case "rate_limited": return `Too many requests — try again in ${formatDurationLong(r.retryAfter ?? 30)}.`;
    default: return r.error;
  }
}
