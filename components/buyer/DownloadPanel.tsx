import { ButtonLink, Card, DownloadIcon, FileIcon, ImageIcon, VideoIcon } from "@/components/ui";
import { CheckIcon } from "@/components/landing/Icons";
import { formatBytes } from "@/lib/format";

export type DownloadFile = { id: string; filename: string; mime: string; sizeBytes: number; href: string };

/**
 * Post-purchase download list (presentational). NOT wired to a route yet: the backend has no checkout/order flow,
 * so there is nothing that mints per-buyer signed URLs. `href` is expected to be a signed `/api/files/:id/original?exp&sig` URL.
 * Rendered on /design so the design is reviewed and ready.
 */
export function DownloadPanel({ title, seller, files, expiresLabel }: { title: string; seller: string; files: DownloadFile[]; expiresLabel: string }) {
  return (
    <Card className="mx-auto w-full max-w-xl">
      <div className="flex items-start gap-4">
        <span className="grid size-12 shrink-0 place-items-center rounded-full bg-success-soft text-success"><CheckIcon className="size-6" /></span>
        <div>
          <h2 className="text-xl font-bold tracking-tight">Thanks — your files are ready</h2>
          <p className="mt-1 text-sm text-muted">“{title}” by {seller}</p>
        </div>
      </div>
      <ul className="mt-5 divide-y divide-border rounded-lg border border-border">
        {files.map((f) => {
          const Icon = f.mime.startsWith("video/") ? VideoIcon : f.mime.startsWith("image/") ? ImageIcon : FileIcon;
          return (
            <li key={f.id} className="flex items-center gap-3 p-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-md bg-surface-muted text-muted"><Icon className="size-5" /></span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{f.filename}</p>
                <p className="text-xs text-muted">{formatBytes(f.sizeBytes)}</p>
              </div>
              <ButtonLink href={f.href} size="sm" variant="secondary" download aria-label={`Download ${f.filename}`}><DownloadIcon className="size-4" /> Download</ButtonLink>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-xs text-muted">Your download links are private to you and expire {expiresLabel}. Save your files somewhere safe.</p>
    </Card>
  );
}
