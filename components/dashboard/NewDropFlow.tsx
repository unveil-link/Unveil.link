"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, ButtonLink, Card, CardDescription, CardTitle, ExternalIcon, Field, Input, LinkIcon, Textarea } from "@/components/ui";
import { CheckIcon } from "@/components/landing/Icons";
import { api } from "@/lib/api";
import { formatBytes, formatDurationLong, usd } from "@/lib/format";
import { copyText, shareLabel, shareUrl } from "@/lib/share";
import { uploadErrorMessage, uploadFile } from "@/lib/upload";
import { validatePrice, videoNote, type UploadLimits } from "@/lib/upload-limits";
import { AttestationFields, EMPTY_ATTESTATION, allAttested, type Attestation } from "./AttestationFields";
import { addFilesToQueue, FileDropzone, type QueuedFile } from "./FileDropzone";
import { publishErrorMessage } from "./PublishDialog";
import { VERIFICATION_META, type VerificationStatus } from "./types";

type Phase = "form" | "working" | "done";
type Errors = Partial<Record<"title" | "price" | "description" | "files" | "attest", string>>;
type Created = { id: string; publicLinkId: string; title: string; priceCents: number };

export default function NewDropFlow({ limits, verification }: { limits: UploadLimits; verification: VerificationStatus }) {
  const router = useRouter();
  const verified = verification === "verified";
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [desc, setDesc] = useState("");
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [wantPublish, setWantPublish] = useState(false);
  const [att, setAtt] = useState<Attestation>(EMPTY_ATTESTATION);
  const [errors, setErrors] = useState<Errors>({});
  const [phase, setPhase] = useState<Phase>("form");
  const [created, setCreated] = useState<Created | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [published, setPublished] = useState(false);
  const [publishMsg, setPublishMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const bannerRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const priceRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => { if (banner) bannerRef.current?.focus(); }, [banner]);
  useEffect(() => { if (phase === "done") doneRef.current?.focus(); }, [phase]);
  useEffect(() => () => abort.current?.abort(), []);

  const patch = (key: string, p: Partial<QueuedFile>) => setQueue((q) => q.map((x) => (x.key === key ? { ...x, ...p } : x)));
  const valid = queue.filter((q) => q.status !== "invalid");
  const checkTitle = (v: string) => (!v.trim() ? "Give your drop a title." : v.length > 120 ? "Titles can be up to 120 characters." : undefined);

  function pick(files: File[]) {
    if (!files.length) return;
    setErrors((e) => ({ ...e, files: undefined }));
    setQueue((q) => addFilesToQueue(q, files, limits));
  }

  function validateAll(): Errors {
    const e: Errors = {};
    const t = checkTitle(title); if (t) e.title = t;
    const p = validatePrice(price, limits); if (p) e.price = p;
    if (desc.length > 2000) e.description = "Descriptions can be up to 2,000 characters.";
    if (!valid.length) e.files = queue.length ? "Remove the files with problems, or add valid ones." : "Add at least one file.";
    if (wantPublish && !allAttested(att)) e.attest = "Please confirm all three statements to publish.";
    return e;
  }

  /** Uploads sequentially; resolves to true when every file in this pass succeeded. */
  async function uploadAll(dropId: string, keys?: string[]): Promise<boolean> {
    abort.current = new AbortController();
    const todo = queue.filter((q) => (keys ? keys.includes(q.key) : q.status === "queued" || q.status === "error"));
    let allOk = true;
    for (const q of todo) {
      patch(q.key, { status: "uploading", progress: 0, error: undefined });
      const r = await uploadFile(dropId, q.file, (pct) => patch(q.key, { progress: pct }), abort.current.signal);
      if (r.ok) patch(q.key, { status: "done", progress: 100 });
      else {
        allOk = false;
        patch(q.key, { status: "error", error: uploadErrorMessage(r) });
        if (r.status === 401) { router.push("/login"); return false; }
        // Limits are drop-wide: no point hammering once the drop is full.
        if (r.code === "too_many_files" || r.code === "drop_too_large") break;
      }
    }
    return allOk && queue.filter((q) => q.status === "error" && !todo.includes(q)).length === 0;
  }

  async function finish(dropId: string, c: Created, willPublish: boolean) {
    if (willPublish) {
      const res = await api<{ drop: { status: string } }>(`/api/drops/${dropId}/publish`, { method: "POST", json: { attestation: att } });
      if (res.ok) setPublished(true);
      else setPublishMsg(res.network ? res.error : publishErrorMessage(res.code, res.error));
    }
    setCreated(c);
    setPhase("done");
    router.refresh();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (phase === "working") return;
    setBanner(null);
    const errs = validateAll();
    setErrors(errs);
    if (errs.title) return titleRef.current?.focus();
    if (errs.price) return priceRef.current?.focus();
    if (Object.keys(errs).length) return;

    setPhase("working");
    let c = created;
    if (!c) {
      const res = await api<{ drop: { id: string; public_link_id: string; title: string; price_cents: number } }>("/api/drops", {
        method: "POST",
        json: { title: title.trim(), description: desc.trim() || undefined, priceCents: Math.round(Number(price) * 100) },
      });
      if (!res.ok) {
        setPhase("form");
        if (res.code === "price_out_of_range") setErrors({ price: res.error.replace(/ cents$/, "") });
        else if (res.status === 401) router.push("/login");
        else if (res.status === 429) setBanner(`Too many requests. Please try again in ${formatDurationLong(res.retryAfter ?? 30)}.`);
        else setBanner(res.error);
        return;
      }
      c = { id: res.data.drop.id, publicLinkId: res.data.drop.public_link_id, title: res.data.drop.title, priceCents: res.data.drop.price_cents };
      setCreated(c);
    }
    if (await uploadAll(c.id)) await finish(c.id, c, wantPublish && verified);
  }

  const failed = valid.filter((q) => q.status === "error");
  const settled = phase === "working" && !!created && valid.length > 0 && valid.every((q) => q.status === "done" || q.status === "error");

  async function retry(key: string) {
    if (!created) return;
    const ok = await uploadAll(created.id, [key]);
    // that was the last failing file -> move on
    if (ok && queue.every((q) => q.key === key || q.status === "done" || q.status === "invalid")) await finish(created.id, created, wantPublish && verified);
  }

  async function copy() {
    if (!created) return;
    if (await copyText(shareUrl(created.publicLinkId))) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  // ------------------------------------------------------------------ success
  if (phase === "done" && created) {
    const uploadedCount = valid.filter((q) => q.status === "done").length;
    return (
      <div className="mx-auto max-w-xl" data-testid="drop-created">
        <Card className="text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-full bg-success-soft text-success"><CheckIcon className="size-7" /></span>
          <h2 ref={doneRef} tabIndex={-1} className="mt-4 text-2xl font-bold tracking-tight outline-none">
            {published ? "Your drop is live" : "Draft saved"}
          </h2>
          <p className="mt-1 text-muted">
            “{created.title}” · {usd(created.priceCents)} · {uploadedCount} file{uploadedCount === 1 ? "" : "s"}
          </p>

          <div className="mt-6 rounded-lg border border-border bg-surface-muted/60 p-3 text-left">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">{published ? "Your payment link" : "Your link (live once published)"}</p>
            <div className="mt-1.5 flex items-center gap-2">
              <LinkIcon className="size-5 shrink-0 text-primary" />
              <code className="min-w-0 flex-1 truncate text-sm font-semibold text-text" data-testid="drop-link">{shareLabel(created.publicLinkId)}</code>
              <Button size="sm" variant="secondary" onClick={copy}>{copied ? "Copied" : "Copy"}</Button>
            </div>
          </div>
          <p className="sr-only" role="status">{copied ? "Link copied to clipboard" : ""}</p>

          {publishMsg && <Alert tone="warning" className="mt-4 text-left" title="Saved as a draft">{publishMsg}</Alert>}
          {!published && !publishMsg && (
            <Alert tone="info" className="mt-4 text-left">
              {verified
                ? "This drop is a draft. Open it to confirm the publishing statements and switch the link on."
                : "This drop is saved as a draft. Publishing requires a verified account status."}
            </Alert>
          )}

          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            {published ? (
              <ButtonLink href={`/u/${created.publicLinkId}`} variant="secondary" target="_blank" rel="noopener"><ExternalIcon className="size-4" /> View buyer page</ButtonLink>
            ) : (
              <ButtonLink href={`/dashboard/drops/${created.id}`}>{verified ? "Review & publish" : "Open draft"}</ButtonLink>
            )}
            <ButtonLink href="/dashboard/drops" variant="ghost">Back to drops</ButtonLink>
          </div>
        </Card>
      </div>
    );
  }

  const working = phase === "working";
  const partial = working && failed.length > 0 && settled;

  return (
    <form onSubmit={submit} noValidate className="mx-auto flex max-w-2xl flex-col gap-6">
      {banner && (
        <div ref={bannerRef} tabIndex={-1} className="outline-none"><Alert tone="danger" title="We couldn’t create your drop">{banner}</Alert></div>
      )}

      <Card className="flex flex-col gap-5">
        <div>
          <CardTitle>Details</CardTitle>
          <CardDescription>This is what buyers see on your payment link.</CardDescription>
        </div>
        <Field id="title" label="Title" error={errors.title}>
          {(a) => (
            <Input {...a} ref={titleRef} value={title} disabled={!!created} maxLength={120} placeholder="Spring collection pack" autoComplete="off"
              onChange={(e) => { setTitle(e.target.value); if (errors.title) setErrors((x) => ({ ...x, title: checkTitle(e.target.value) })); }} />
          )}
        </Field>
        <Field id="price" label="Price (USD)" error={errors.price} help={`Between ${usd(limits.priceMinCents)} and ${usd(limits.priceMaxCents)}.`}>
          {(a) => (
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3.5 grid place-items-center text-muted" aria-hidden="true">$</span>
              <Input {...a} ref={priceRef} className="pl-8" inputMode="decimal" value={price} disabled={!!created} placeholder="12.00" autoComplete="off"
                onChange={(e) => { setPrice(e.target.value); if (errors.price) setErrors((x) => ({ ...x, price: validatePrice(e.target.value, limits) ?? undefined })); }}
                onBlur={() => price && setErrors((x) => ({ ...x, price: validatePrice(price, limits) ?? undefined }))} />
            </div>
          )}
        </Field>
        <Field id="description" label="Description" optional error={errors.description} help={`${desc.length}/2000`}>
          {(a) => <Textarea {...a} rows={3} value={desc} disabled={!!created} maxLength={2000} placeholder="Tell buyers what’s included…" onChange={(e) => setDesc(e.target.value)} />}
        </Field>
      </Card>

      <Card className="flex flex-col gap-4">
        <div>
          <CardTitle>Files</CardTitle>
          <CardDescription>Originals are stored privately. Buyers only see a blurred preview until they pay.</CardDescription>
        </div>
        <FileDropzone id="files" queue={queue} limits={limits} disabled={working && !partial}
          error={errors.files}
          onPick={pick}
          onRemove={(k) => setQueue((q) => q.filter((x) => x.key !== k))}
          onRetry={retry} />
        <p className="text-xs text-muted">
          Images (JPG, PNG, WebP) up to {formatBytes(limits.maxImageSizeBytes)} each. {videoNote(limits)}
        </p>
      </Card>

      <Card className="flex flex-col gap-3">
        <div>
          <CardTitle>Publishing</CardTitle>
          <CardDescription>Save as a draft, or switch the link on as soon as the upload finishes.</CardDescription>
        </div>
        {!verified && (
          <Alert tone="warning" title={`Verification: ${VERIFICATION_META[verification].label}`}>
            {VERIFICATION_META[verification].hint}
          </Alert>
        )}
        <label className="flex items-start gap-3 py-1 text-sm">
          <input type="checkbox" className="mt-0.5 size-5 accent-primary" checked={wantPublish && verified} disabled={!verified || !!created}
            onChange={(e) => setWantPublish(e.target.checked)} />
          <span><span className="font-medium text-text">Publish right after upload</span><span className="block text-muted">Otherwise it’s saved as a draft.</span></span>
        </label>
        {wantPublish && verified && (
          <>
            <AttestationFields value={att} onChange={setAtt} idPrefix="new" error={!!errors.attest} />
            {errors.attest && <p role="alert" className="text-sm font-medium text-danger">{errors.attest}</p>}
          </>
        )}
      </Card>

      {partial && (
        <Alert tone="warning" title={`${failed.length} file${failed.length === 1 ? "" : "s"} didn’t upload`}
          action={<Button size="sm" onClick={() => created && finish(created.id, created, wantPublish && verified && valid.some((q) => q.status === "done"))}>Continue without {failed.length === 1 ? "it" : "them"}</Button>}>
          Retry the files above, or continue with what uploaded. The drop is already saved as a draft.
        </Alert>
      )}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <ButtonLink href="/dashboard/drops" variant="ghost">Cancel</ButtonLink>
        <Button type="submit" size="lg" loading={working && !partial} disabled={working}>
          {working ? (partial ? "Waiting…" : "Uploading…") : wantPublish && verified ? "Upload & publish" : "Save draft & upload"}
        </Button>
      </div>
    </form>
  );
}
