"use client";
import { useState } from "react";
import { Button, Field, Input } from "@/components/ui";

/** Minimal buy hook (UI polish is another workstream): email + 18+ confirmation -> POST /api/checkout -> hosted checkout. */
export default function BuyForm({ linkId, priceLabel }: { linkId: string; priceLabel: string }) {
  const [email, setEmail] = useState("");
  const [over18, setOver18] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ linkId, email, confirmOver18: over18 }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.checkoutUrl) {
      window.location.href = data.checkoutUrl;
      return;
    }
    setBusy(false);
    setError(res.status === 429 ? "Too many attempts. Please wait a moment and try again." : (data.error ?? "Could not start checkout"));
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" data-testid="buy-form">
      <Field id="buyer-email" label="Email (for your receipt)">
        {(a) => <Input {...a} type="email" required maxLength={254} autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />}
      </Field>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" required checked={over18} onChange={(e) => setOver18(e.target.checked)} className="mt-1" data-testid="over18" />
        <span>I confirm that I am 18 years of age or older.</span>
      </label>
      {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}
      <Button type="submit" loading={busy} className="self-start" data-testid="buy-button">Unlock for {priceLabel}</Button>
    </form>
  );
}
