"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, Button, ButtonLink, EmptyState, ImageIcon, Modal, PlusIcon, Table, TBody, Td, Th, THead, Tr, Tabs, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDate, usd } from "@/lib/format";
import { shareLabel } from "@/lib/share";
import { CopyLinkButton } from "./CopyLinkButton";
import { PublishDialog } from "./PublishDialog";
import { STATUS_META, type DropRow, type DropStatus, type VerificationStatus } from "./types";

function Thumb({ row, className = "size-12" }: { row: DropRow; className?: string }) {
  return row.thumbFileId ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`/api/files/${row.thumbFileId}/preview`} alt="" className={`${className} shrink-0 rounded-md object-cover`} />
  ) : (
    <span className={`${className} grid shrink-0 place-items-center rounded-md bg-surface-muted text-muted`}><ImageIcon className="size-5" /></span>
  );
}

export function StatusBadge({ status }: { status: DropStatus }) {
  const m = STATUS_META[status];
  return <Badge tone={m.tone} data-testid="drop-status">{m.label}</Badge>;
}

export function DropList({
  drops, verification, filterable = false, emptyAction = true,
}: {
  drops: DropRow[]; verification: VerificationStatus; filterable?: boolean; emptyAction?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [tab, setTab] = useState("all");
  const [publishing, setPublishing] = useState<DropRow | null>(null);
  const [unpublishing, setUnpublishing] = useState<DropRow | null>(null);
  const [busy, setBusy] = useState(false);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: drops.length, published: 0, draft: 0, unpublished: 0, flagged: 0 };
    drops.forEach((d) => (c[d.status] += 1));
    return c;
  }, [drops]);
  const shown = tab === "all" ? drops : drops.filter((d) => d.status === tab);

  async function unpublish() {
    if (!unpublishing) return;
    setBusy(true);
    const res = await api(`/api/drops/${unpublishing.id}/unpublish`, { method: "POST" });
    setBusy(false);
    if (res.ok) {
      toast(`“${unpublishing.title}” is unpublished`);
      setUnpublishing(null);
      router.refresh();
    } else toast(res.error, "danger");
  }

  if (drops.length === 0) {
    return (
      <EmptyState
        icon={<ImageIcon />}
        title="No drops yet"
        description="A drop is a set of files with a price and a shareable link. Create your first one — it only takes a minute."
        action={emptyAction ? <ButtonLink href="/dashboard/drops/new"><PlusIcon className="size-4" /> Create your first drop</ButtonLink> : undefined}
      />
    );
  }

  function Actions({ d }: { d: DropRow }) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {d.status === "published" && <CopyLinkButton linkId={d.publicLinkId} />}
        {d.status === "published" && (
          <Button size="sm" variant="ghost" onClick={() => setUnpublishing(d)}>Unpublish</Button>
        )}
        {(d.status === "draft" || d.status === "unpublished") && (
          <Button size="sm" onClick={() => setPublishing(d)}>Publish</Button>
        )}
        <ButtonLink href={`/dashboard/drops/${d.id}`} size="sm" variant={d.status === "published" ? "ghost" : "secondary"}>
          {d.status === "flagged" ? "View" : "Manage"}
        </ButtonLink>
      </div>
    );
  }

  return (
    <div>
      {filterable && (
        <Tabs
          idBase="drops"
          label="Filter drops by status"
          value={tab}
          onChange={setTab}
          className="mb-4"
          items={[
            { id: "all", label: "All", count: counts.all },
            { id: "published", label: "Published", count: counts.published },
            { id: "draft", label: "Drafts", count: counts.draft },
            ...(counts.unpublished ? [{ id: "unpublished", label: "Unpublished", count: counts.unpublished }] : []),
            ...(counts.flagged ? [{ id: "flagged", label: "Under review", count: counts.flagged }] : []),
          ]}
        />
      )}
      <div id="drops-panel" role={filterable ? "tabpanel" : undefined} aria-labelledby={filterable ? `drops-tab-${tab}` : undefined}>
        {shown.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border-strong bg-surface p-8 text-center text-sm text-muted">No drops with this status.</p>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block">
              <Table caption="Your drops">
                <THead>
                  <tr>
                    <Th>Drop</Th><Th>Status</Th><Th className="text-right">Price</Th><Th className="text-right">Files</Th>
                    <Th className="text-right">Sold</Th><Th className="text-right">Revenue</Th><Th><span className="sr-only">Actions</span></Th>
                  </tr>
                </THead>
                <TBody>
                  {shown.map((d) => (
                    <Tr key={d.id} data-testid="drop-row">
                      <Td>
                        <Link href={`/dashboard/drops/${d.id}`} className="flex items-center gap-3 rounded-md">
                          <Thumb row={d} />
                          <span className="min-w-0">
                            <span className="block max-w-56 truncate font-semibold text-text">{d.title}</span>
                            <span className="block text-xs text-muted">
                              {d.status === "published" ? shareLabel(d.publicLinkId) : `Created ${formatDate(d.createdAt)}`}
                            </span>
                          </span>
                        </Link>
                      </Td>
                      <Td><StatusBadge status={d.status} /></Td>
                      <Td className="text-right tabular-nums">{usd(d.priceCents)}</Td>
                      <Td className="text-right tabular-nums">{d.fileCount}</Td>
                      <Td className="text-right tabular-nums">{d.units}</Td>
                      <Td className="text-right font-semibold tabular-nums">{usd(d.revenueCents)}</Td>
                      <Td><Actions d={d} /></Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </div>
            {/* Mobile cards */}
            <ul className="flex flex-col gap-3 md:hidden">
              {shown.map((d) => (
                <li key={d.id} className="rounded-lg border border-border bg-surface p-4 shadow-card" data-testid="drop-row">
                  <Link href={`/dashboard/drops/${d.id}`} className="flex items-start gap-3 rounded-md">
                    <Thumb row={d} className="size-14" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-text">{d.title}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2"><StatusBadge status={d.status} /><span className="text-sm font-semibold tabular-nums">{usd(d.priceCents)}</span></div>
                    </div>
                  </Link>
                  <dl className="mt-3 grid grid-cols-3 gap-2 rounded-md bg-surface-muted/70 p-2.5 text-center text-xs">
                    <div><dt className="text-muted">Files</dt><dd className="mt-0.5 text-sm font-semibold tabular-nums">{d.fileCount}</dd></div>
                    <div><dt className="text-muted">Sold</dt><dd className="mt-0.5 text-sm font-semibold tabular-nums">{d.units}</dd></div>
                    <div><dt className="text-muted">Revenue</dt><dd className="mt-0.5 text-sm font-semibold tabular-nums">{usd(d.revenueCents)}</dd></div>
                  </dl>
                  <div className="mt-3"><Actions d={d} /></div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {publishing && (
        <PublishDialog
          open
          onClose={() => setPublishing(null)}
          dropId={publishing.id}
          title={publishing.title}
          verification={verification}
          onPublished={() => { toast("Published — your link is live"); setPublishing(null); router.refresh(); }}
        />
      )}
      <Modal
        open={!!unpublishing}
        onClose={() => setUnpublishing(null)}
        title="Unpublish this drop?"
        description={unpublishing ? `“${unpublishing.title}” will stop accepting new buyers. You can publish it again any time.` : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setUnpublishing(null)}>Keep published</Button>
            <Button variant="danger" onClick={unpublish} loading={busy}>Unpublish</Button>
          </>
        }
      />
    </div>
  );
}

