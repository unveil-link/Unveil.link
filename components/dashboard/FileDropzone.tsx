"use client";
import { useId, useRef, useState } from "react";
import { Button, FileIcon, ImageIcon, Progress, UploadIcon, VideoIcon, XIcon } from "@/components/ui";
import { CheckIcon } from "@/components/landing/Icons";
import { cn } from "@/lib/cn";
import { formatBytes } from "@/lib/format";
import { mimeOf, validateFile, type UploadLimits } from "@/lib/upload-limits";

export type QueuedFile = {
  key: string;
  file: File;
  status: "queued" | "uploading" | "done" | "error" | "invalid";
  progress: number;
  error?: string;
};

let seq = 0;
export const newQueued = (file: File): QueuedFile => ({ key: `f${Date.now()}-${seq++}`, file, status: "queued", progress: 0 });

/**
 * Pure: turns picked files into queue entries, flagging type/size problems and the count / total-size caps
 * (taking `existingCount` / `existingBytes` already in the drop into account).
 */
export function addFilesToQueue(
  queue: QueuedFile[],
  picked: File[],
  limits: UploadLimits,
  existing: { count: number; bytes: number } = { count: 0, bytes: 0 },
): QueuedFile[] {
  const next = [...queue];
  for (const f of picked) {
    const q = newQueued(f);
    const accepted = next.filter((x) => x.status !== "invalid");
    const count = existing.count + accepted.length;
    const bytes = existing.bytes + accepted.reduce((n, x) => n + x.file.size, 0);
    let err = validateFile(f, limits);
    if (!err && count + 1 > limits.maxFilesPerDrop) err = `A drop can have up to ${limits.maxFilesPerDrop} files.`;
    if (!err && bytes + f.size > limits.maxTotalBytesPerDrop) err = `A drop can hold up to ${formatBytes(limits.maxTotalBytesPerDrop)} in total.`;
    if (!err && next.some((x) => x.status !== "invalid" && x.file.name === f.name && x.file.size === f.size && x.file.lastModified === f.lastModified)) err = "You already added this file.";
    next.push(err ? { ...q, status: "invalid", error: err } : q);
  }
  return next;
}

export function FileDropzone({
  queue, onPick, onRemove, onRetry, limits, disabled, existing = { count: 0, bytes: 0 }, error, id,
}: {
  queue: QueuedFile[];
  onPick: (files: File[]) => void;
  onRemove: (key: string) => void;
  onRetry?: (key: string) => void;
  limits: UploadLimits;
  disabled?: boolean;
  existing?: { count: number; bytes: number };
  error?: string;
  id?: string;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const accepted = queue.filter((q) => q.status !== "invalid");
  const totalBytes = existing.bytes + accepted.reduce((n, q) => n + q.file.size, 0);
  const totalCount = existing.count + accepted.length;
  const accept = ["image/jpeg", "image/png", "image/webp", "video/mp4", ".jpg", ".jpeg", ".png", ".webp", ".mp4"].join(",");

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (!disabled) onPick(Array.from(e.dataTransfer.files));
        }}
        className={cn(
          "relative flex flex-col items-center rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors sm:py-10",
          over ? "border-primary bg-primary-soft" : error ? "border-danger bg-danger-soft/40" : "border-border-strong bg-surface-muted/50",
          disabled && "opacity-60",
        )}
      >
        <span className="mb-3 grid size-12 place-items-center rounded-full bg-primary-soft text-primary"><UploadIcon className="size-6" /></span>
        <p className="text-base font-semibold text-text">
          <span className="hidden sm:inline">Drag &amp; drop files here, or </span>
          <label htmlFor={id ?? inputId} className="cursor-pointer text-primary underline underline-offset-2 focus-within:outline-2">choose files</label>
        </p>
        <p className="mt-1 text-sm text-muted">
          JPG, PNG, WebP or MP4 · {limits.maxFilesPerDrop} files · {formatBytes(limits.maxTotalBytesPerDrop)} per drop
        </p>
        <input
          ref={inputRef}
          id={id ?? inputId}
          type="file"
          multiple
          accept={accept}
          disabled={disabled}
          className="sr-only"
          aria-describedby={error ? `${id ?? inputId}-err` : undefined}
          onChange={(e) => { onPick(Array.from(e.target.files ?? [])); e.target.value = ""; }}
        />
        <Button type="button" variant="secondary" size="sm" className="mt-4 sm:hidden" disabled={disabled} onClick={() => inputRef.current?.click()}>Browse files</Button>
      </div>
      {error && <p id={`${id ?? inputId}-err`} role="alert" className="mt-2 text-sm font-medium text-danger">{error}</p>}

      {queue.length > 0 && (
        <>
          <p className="mt-4 text-xs text-muted" aria-live="polite">
            {totalCount} of {limits.maxFilesPerDrop} files · {formatBytes(totalBytes)} of {formatBytes(limits.maxTotalBytesPerDrop)}
          </p>
          <ul className="mt-2 flex flex-col gap-2" data-testid="file-queue">
            {queue.map((q) => {
              const isVideo = mimeOf(q.file).startsWith("video/");
              const Icon = isVideo ? VideoIcon : q.file.type.startsWith("image/") ? ImageIcon : FileIcon;
              return (
                <li key={q.key} className={cn("rounded-lg border bg-surface p-3", q.status === "invalid" || q.status === "error" ? "border-danger/40" : "border-border")}>
                  <div className="flex items-center gap-3">
                    <span className={cn("grid size-10 shrink-0 place-items-center rounded-md", q.status === "done" ? "bg-success-soft text-success" : q.status === "invalid" || q.status === "error" ? "bg-danger-soft text-danger" : "bg-surface-muted text-muted")}>
                      {q.status === "done" ? <CheckIcon className="size-5" /> : <Icon className="size-5" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-text">{q.file.name}</p>
                      <p className="text-xs text-muted">
                        {formatBytes(q.file.size)} ·{" "}
                        {q.status === "queued" && "Ready to upload"}
                        {q.status === "uploading" && `Uploading… ${Math.round(q.progress)}%`}
                        {q.status === "done" && "Uploaded"}
                        {(q.status === "error" || q.status === "invalid") && <span className="font-medium text-danger">{q.error}</span>}
                      </p>
                    </div>
                    {q.status === "error" && onRetry && <Button type="button" size="sm" variant="secondary" onClick={() => onRetry(q.key)}>Retry</Button>}
                    {q.status !== "uploading" && q.status !== "done" && (
                      <button type="button" onClick={() => onRemove(q.key)} aria-label={`Remove ${q.file.name}`} className="grid size-9 shrink-0 place-items-center rounded-md text-muted hover:bg-surface-muted hover:text-text">
                        <XIcon className="size-5" />
                      </button>
                    )}
                  </div>
                  {(q.status === "uploading" || q.status === "done") && (
                    <Progress className="mt-2.5" value={q.progress} tone={q.status === "done" ? "success" : "primary"} label={`Upload progress for ${q.file.name}`} />
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
