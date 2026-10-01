"use client";
import { useState } from "react";
import { Button, Input } from "@/components/ui";

export default function ClearFlagForm({ sellerId }: { sellerId: string }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!window.confirm("Mark this seller as reviewed and clear the flag? This is recorded in the audit log.")) return;
    setBusy(true); setError(null);
    const res = await fetch(`/api/admin/sellers/${sellerId}/clear-flag`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ note }) });
    if (res.ok) { window.location.reload(); return; }
    const d = await res.json().catch(() => ({}));
    setBusy(false); setError(d.error ?? "Failed");
  }
  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2" data-testid="clear-flag-form">
      <Input aria-label="Review note" placeholder="Review note (required)" required minLength={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      <Button type="submit" variant="secondary" loading={busy} data-testid="clear-flag-button">Mark reviewed / clear flag</Button>
      {error && <span role="alert" className="text-sm text-danger">{error}</span>}
    </form>
  );
}
