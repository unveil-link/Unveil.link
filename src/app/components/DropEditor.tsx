"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, CardDescription, CardTitle, ExternalIcon, ImageIcon, Modal, useToast } from "@/components/ui";
import { StatusBadge } from "@/components/dashboard/DropList";
import { CopyLinkButton } from "@/components/dashboard/CopyLinkButton";
import { PublishDialog } from "@/components/dashboard/PublishDialog";
import { addFilesToQueue, FileDropzone, type QueuedFile } from "@/components/dashboard/FileDropzone";
import { STATUS_META, type DropStatus, type VerificationStatus } from "@/components/dashboard/types";
import { api } from "@/lib/api";
import { formatBytes, usd } from "@/lib/format";
import { shareLabel } from "@/lib/share";
import { uploadErrorMessage, uploadFile } from "@/lib/upload";
import type { UploadLimits } from "@/lib/upload-limits";

type FileItem = { id: string; filename: string; sizeBytes: number; mime: string };
type Props = {
  drop: { id: string; title: string; description: string | null; priceCents: number; status: DropStatus; publicLinkId: string };
  files: FileItem[];
  verificationStatus: VerificationStatus;
  limits: UploadLimits;
  units: number;
  revenueCents: number;
};

export default function DropEditor({ drop, files, verificationStatus, limits, units, revenueCents }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [unpubOpen, setUnpubOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const existing = { count: files.length, bytes: files.reduce((n, f) => n + f.sizeBytes, 0) };
  const canEdit = drop.status !== "flagged";
  const patch = (key: string, p: Partial<QueuedFile>) => setQueue((q) => q.map((x) => (x.key === key ? { ...x, ...p } : x)));

  async function run(keys?: string[]) {
    setUploading(true);
    const todo = queue.filter((q) => (keys ? keys.includes(q.key) : q.status === "queued" || q.status === "error"));
    let okCount = 0;
    for (const q of todo) {
      patch(q.key, { status: "uploading", progress: 0, error: undefined });
      const r = await uploadFile(drop.id, q.file, (pct) => patch(q.key, { progress: pct }));
      if (r.ok) { okCount++; patch(q.key, { status: "done", progress: 100 }); }
      else {
        patch(q.key, { status: "error", error: uploadErrorMessage(r) });
        if (r.status === 401) { router.push("/login"); break; }
        if (r.code === "too_many_files" || r.code === "drop_too_large") break;
      }
    }
    setUploading(false);
    if (okCount) {
      toast(`${okCount} file${okCount === 1 ? "" : "s"} uploaded`);
      router.refresh();
      setTimeout(() => setQueue((q) => q.filter((x) => x.status !== "done")), 1200);
    }
  }

  async function unpublish() {
    setBusy(true);
    const res = await api(`/api/drops/${drop.id}/unpublish`, { method: "POST" });
    setBusy(false);
    if (res.ok) { setUnpubOpen(false); toast("Drop unpublished"); router.refresh(); }
    else toast(res.error, "danger");
  }

  const pending = queue.filter((q) => q.status === "queued" || q.status === "error").length;

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{drop.title}</h1>
              <StatusBadge status={drop.status} />
            </div>
            <p className="mt-1 text-lg font-semibold">{usd(drop.priceCents)}</p>
            {drop.description && <p className="mt-2 max-w-prose whitespace-pre-line text-muted">{drop.description}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {drop.status === "published" && (
              <>
                <CopyLinkButton linkId={drop.publicLinkId} />
                <a href={`/u/${drop.publicLinkId}`} target="_blank" rel="noopener" className="inline-flex h-9 items-center gap-2 rounded-md border border-border-strong bg-surface px-3.5 text-sm font-semibold hover:bg-surface-muted">
                  <ExternalIcon className="size-4" /> Public page
                </a>
                <Button size="sm" variant="ghost" onClick={() => setUnpubOpen(true)}>Unpublish</Button>
              </>
            )}
            {(drop.status === "draft" || drop.status === "unpublished") && <Button onClick={() => setPublishOpen(true)}>Publish</Button>}
          </div>
        </div>
        {/* Always render the share path so the link is discoverable even for drafts */}
        <p className="text-sm text-muted">
          {drop.status === "published" ? (
            <>Live at <a className="font-semibold text-primary" href={`/u/${drop.publicLinkId}`}>{shareLabel(drop.publicLinkId)}</a></>
          ) : (
            <>Link (inactive until published): <span className="font-mono text-text">{shareLabel(drop.publicLinkId)}</span></>
          )}
        </p>
        <p className="text-sm text-muted">{STATUS_META[drop.status].hint}</p>
        <dl className="grid grid-cols-3 gap-2 rounded-md bg-surface-muted/70 p-3 text-center text-xs">
          <div><dt className="text-muted">Files</dt><dd className="mt-0.5 text-base font-semibold tabular-nums">{files.length}</dd></div>
          <div><dt className="text-muted">Sold (net)</dt><dd className="mt-0.5 text-base font-semibold tabular-nums">{units}</dd></div>
          <div><dt className="text-muted">Revenue (kept)</dt><dd className="mt-0.5 text-base font-semibold tabular-nums">{usd(revenueCents)}</dd></div>
        </dl>
        {verificationStatus !== "verified" && drop.status !== "published" && (
          <Alert tone="warning" title="Publishing locked">Your identity verification is <b>{verificationStatus.replace("_", " ")}</b>. This stays a draft until you’re verified.</Alert>
        )}
        {drop.status === "flagged" && <Alert tone="danger" title="Under review">This drop is paused while our team reviews it. You can’t edit or publish it right now.</Alert>}
      </Card>

      <section aria-labelledby="files-h">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 id="files-h" className="text-lg font-semibold">Files <span className="text-muted">({files.length}/{limits.maxFilesPerDrop})</span></h2>
          <p className="text-xs text-muted">{formatBytes(existing.bytes)} of {formatBytes(limits.maxTotalBytesPerDrop)}</p>
        </div>
        {files.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border-strong bg-surface p-8 text-center text-sm text-muted">No files yet — add some below.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {files.map((f) => (
              <figure key={f.id} className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/files/${f.id}/preview`} alt={`Blurred preview of ${f.filename}`} className="aspect-square w-full object-cover" />
                <figcaption className="px-2.5 py-2 text-xs">
                  <span className="block truncate font-medium text-text">{f.filename}</span>
                  <span className="text-muted">{formatBytes(f.sizeBytes)}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        )}
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted"><ImageIcon className="size-4" /> This is what buyers see before they pay.</p>
      </section>

      {canEdit && (
        <Card className="flex flex-col gap-4">
          <div><CardTitle>Add files</CardTitle><CardDescription>JPG, PNG or WebP. They’re added to this drop right away.</CardDescription></div>
          <FileDropzone id="more-files" queue={queue} limits={limits} existing={existing} disabled={uploading}
            onPick={(f) => setQueue((q) => addFilesToQueue(q, f, limits, existing))}
            onRemove={(k) => setQueue((q) => q.filter((x) => x.key !== k))}
            onRetry={(k) => run([k])} />
          {pending > 0 && (
            <Button className="self-start" loading={uploading} onClick={() => run()}>Upload {pending} file{pending === 1 ? "" : "s"}</Button>
          )}
        </Card>
      )}

      <PublishDialog open={publishOpen} onClose={() => setPublishOpen(false)} dropId={drop.id} title={drop.title} verification={verificationStatus}
        onPublished={() => { setPublishOpen(false); toast("Published — your link is live"); router.refresh(); }} />
      <Modal open={unpubOpen} onClose={() => setUnpubOpen(false)} title="Unpublish this drop?" description="The link will stop accepting new buyers. You can publish again any time."
        footer={<><Button variant="secondary" onClick={() => setUnpubOpen(false)}>Keep published</Button><Button variant="danger" loading={busy} onClick={unpublish}>Unpublish</Button></>} />
    </div>
  );
}
