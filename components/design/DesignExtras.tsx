"use client";
import { useState } from "react";
import {
  Alert, Badge, Button, Card, CardDescription, CardTitle, Checkbox, ChartIcon, ClockIcon, CoinIcon, EmptyState, ImageIcon, Modal, PlusIcon,
  Progress, Skeleton, StatCard, Table, TBody, Td, Th, THead, Tr, Tabs, ToastViewport, WalletIcon,
} from "@/components/ui";
import { PasswordStrength } from "@/components/auth/PasswordStrength";
import { DownloadPanel } from "@/components/buyer/DownloadPanel";

function Block({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="py-8">
      <h2 id={id} className="mb-5 text-2xl font-bold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

/** App-surface components added with the dashboard (Alert, Progress, StatCard, Table, Tabs, Modal, Toast, Checkbox, EmptyState, Skeleton…). */
export function DesignExtras() {
  const [tab, setTab] = useState("all");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Block id="alerts" title="Alerts">
        <div className="grid gap-3 md:grid-cols-2">
          <Alert tone="info" title="Heads up">Informational message with supporting detail.</Alert>
          <Alert tone="success" title="Published">Your link is live.</Alert>
          <Alert tone="warning" title="Verification pending">You can save drafts until you’re verified.</Alert>
          <Alert tone="danger" title="Couldn’t save" role="presentation">Something went wrong. Please try again.</Alert>
        </div>
      </Block>

      <Block id="stats" title="Stat cards">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Gross sales" value="$1,240.00" hint="48 sales" icon={<ChartIcon />} tone="primary" />
          <StatCard label="Your 90%" value="$1,116.00" hint="After the 10% platform fee" icon={<CoinIcon />} tone="accent" />
          <StatCard label="Available" value="$820.50" icon={<WalletIcon />} />
          <StatCard label="Pending" value="$0.00" loading icon={<ClockIcon />} />
        </div>
      </Block>

      <Block id="progress" title="Progress & skeleton">
        <Card className="space-y-4">
          <div><p className="mb-1.5 text-sm font-medium">beach-01.jpg · 38%</p><Progress value={38} label="Upload progress for beach-01.jpg" /></div>
          <div><p className="mb-1.5 text-sm font-medium">beach-02.jpg · done</p><Progress value={100} tone="success" label="Upload progress for beach-02.jpg" /></div>
          <div><p className="mb-1.5 text-sm font-medium">beach-03.jpg · failed</p><Progress value={62} tone="danger" label="Upload progress for beach-03.jpg" /></div>
          <div className="flex items-center gap-3"><Skeleton className="size-12" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-1/2" /><Skeleton className="h-3 w-1/3" /></div></div>
        </Card>
      </Block>

      <Block id="tabs-table" title="Tabs & table">
        <Tabs idBase="demo" label="Demo filter" value={tab} onChange={setTab} className="mb-4"
          items={[{ id: "all", label: "All", count: 3 }, { id: "published", label: "Published", count: 2 }, { id: "draft", label: "Drafts", count: 1 }]} />
        <div id="demo-panel" role="tabpanel" aria-labelledby={`demo-tab-${tab}`}>
          <Table caption="Demo table">
            <THead><tr><Th>Drop</Th><Th>Status</Th><Th className="text-right">Price</Th><Th className="text-right">Sold</Th></tr></THead>
            <TBody>
              {[["Spring collection", "Published", "success", "$12.00", 14], ["Studio pack", "Draft", "neutral", "$25.00", 0], ["Travel set", "Unpublished", "warning", "$8.00", 3]].map(([n, st, tone, price, sold]) => (
                <Tr key={String(n)}><Td className="font-semibold">{n}</Td><Td><Badge tone={tone as "success"}>{st}</Badge></Td><Td className="text-right tabular-nums">{price}</Td><Td className="text-right tabular-nums">{sold}</Td></Tr>
              ))}
            </TBody>
          </Table>
        </div>
      </Block>

      <Block id="modal-toast" title="Modal, toast, checkbox">
        <div className="grid gap-5 md:grid-cols-2">
          <Card className="space-y-3">
            <Button onClick={() => setOpen(true)}>Open modal</Button>
            <Modal open={open} onClose={() => setOpen(false)} title="Unpublish this drop?" description="The link will stop accepting new buyers."
              footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button variant="danger" onClick={() => setOpen(false)}>Unpublish</Button></>} />
            <Checkbox id="d-cb1" label="Everyone in this content is 18 or older" description="Anyone who appears in your files is an adult." defaultChecked />
            <Checkbox id="d-cb2" label="Unchecked with error" error />
          </Card>
          <ToastViewport inline items={[{ id: 1, tone: "success", text: "Link copied to clipboard" }, { id: 2, tone: "danger", text: "Upload failed — please retry" }]} />
        </div>
      </Block>

      <Block id="empty" title="Empty state">
        <EmptyState icon={<ImageIcon />} title="No drops yet" description="A drop is a set of files with a price and a shareable link." action={<Button><PlusIcon className="size-4" /> Create your first drop</Button>} />
      </Block>

      <Block id="password" title="Password strength">
        <div className="grid gap-5 md:grid-cols-2">
          <Card><PasswordStrength id="d-pw1" password="short" /></Card>
          <Card><PasswordStrength id="d-pw2" password="correct-horse-battery-staple" /></Card>
        </div>
      </Block>

      <Block id="download" title="Post-purchase download panel">
        <DownloadPanel title="Spring collection pack" seller="Maya Lin" expiresLabel="in 24 hours"
          files={[{ id: "1", filename: "spring-01.jpg", mime: "image/jpeg", sizeBytes: 2_400_000, href: "#" }, { id: "2", filename: "spring-02.png", mime: "image/png", sizeBytes: 5_100_000, href: "#" }]} />
        <Card className="mx-auto mt-4 max-w-xl"><CardTitle>Not wired yet</CardTitle><CardDescription>No checkout/order backend exists, so there is no live download route. See docs/frontend-dashboard-notes.md.</CardDescription></Card>
      </Block>
    </>
  );
}
