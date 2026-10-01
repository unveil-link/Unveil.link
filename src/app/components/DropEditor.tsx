"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, CardTitle } from "@/components/ui";

type FileItem = { id: string; filename: string; sizeBytes: number };
type Props = {
  drop: { id: string; title: string; description: string | null; priceCents: number; status: string; publicLinkId: string };
  files: FileItem[];
  verificationStatus: string;
};

const ATTEST = {
  over18: "Everyone depicted is 18 or older",
  ownsRights: "I own all rights to this content",
  consentOfSubjects: "Everyone depicted consented to its sale",
} as const;

export default function DropEditor({ drop, files, verificationStatus }: Props) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [att, setAtt] = useState({ over18: false, ownsRights: false, consentOfSubjects: false });

  async function upload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const file = (form.elements.namedItem("file") as HTMLInputElement).files?.[0];
    if (!file) return;
    setBusy(true);
    setMsg(null);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/drops/${drop.id}/files`, { method: "POST", body: fd });
    setBusy(false);
    if (res.ok) {
      form.reset();
      router.refresh();
    } else setMsg({ kind: "err", text: (await res.json().catch(() => ({}))).error ?? "Upload failed" });
  }

  async function publish() {
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/drops/${drop.id}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ attestation: att }),
    });
    setBusy(false);
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setMsg({ kind: "ok", text: `Published: ${location.origin}${data.url}` });
      router.refresh();
    } else setMsg({ kind: "err", text: data.error ?? "Publish failed" });
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{drop.title}</h1>
        <p className="mt-1 flex items-center gap-2 text-sm text-muted">
          ${(drop.priceCents / 100).toFixed(2)}
          <Badge data-testid="drop-status" tone={drop.status === "published" ? "success" : "neutral"}>{drop.status}</Badge>
          {drop.status === "published" && <a className="font-medium text-primary underline" href={`/u/${drop.publicLinkId}`}>public page</a>}
        </p>
        {drop.description && <p className="mt-2">{drop.description}</p>}
      </div>

      <Card>
        <CardTitle className="mb-3">Upload image</CardTitle>
        <form onSubmit={upload} className="flex flex-wrap items-center gap-3">
          <input name="file" type="file" accept="image/jpeg,image/png,image/webp" required className="text-sm" />
          <Button type="submit" loading={busy}>Upload</Button>
        </form>
        <p className="mt-2 text-sm text-muted">JPG, PNG or WebP. Originals are stored privately; buyers only see a blurred preview until they pay.</p>
      </Card>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Files — blurred previews (what buyers see)</h2>
        {files.length === 0 ? (
          <p className="text-sm text-muted">No files yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {files.map((f) => (
              <figure key={f.id} className="overflow-hidden rounded-lg border border-border bg-surface">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/files/${f.id}/preview`} alt={`Blurred preview of ${f.filename}`} className="aspect-square w-full object-cover" />
                <figcaption className="truncate px-2 py-1 text-xs text-muted">{f.filename}</figcaption>
              </figure>
            ))}
          </div>
        )}
      </section>

      <Card>
        <CardTitle className="mb-3">Publish</CardTitle>
        <div className="flex flex-col gap-3">
          {verificationStatus !== "verified" && (
            <p className="rounded-md bg-warning-soft p-3 text-sm text-warning">
              Your identity verification is <b>{verificationStatus}</b>. This stays a draft until you&apos;re verified.
            </p>
          )}
          {(Object.keys(ATTEST) as (keyof typeof ATTEST)[]).map((k) => (
            <label key={k} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={att[k]} onChange={(e) => setAtt({ ...att, [k]: e.target.checked })} />
              {ATTEST[k]}
            </label>
          ))}
          <Button className="self-start" onClick={publish} loading={busy} disabled={drop.status === "published"}>Publish</Button>
          {msg && (
            <p role="alert" className={`text-sm font-medium ${msg.kind === "ok" ? "text-success" : "text-danger"}`}>{msg.text}</p>
          )}
        </div>
      </Card>
    </div>
  );
}
