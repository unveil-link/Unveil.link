"use client";
import { useState } from "react";
import { Button, Field, Input } from "@/components/ui";
import { GENERIC_FAILURE } from "../../../../../lib/purchase-copy";

// Test cards: 4242… approves; …0002 declined; …9995 insufficient funds; …0069 expired; …0127 bad CVC.
export default function MockCheckoutForm({ sessionId, returnPath }: { sessionId: string; returnPath: string }) {
  const [card, setCard] = useState("4242 4242 4242 4242");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/dev/payments/pay", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, card }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    // Buyer-facing text only: the server sends a friendly `message`; raw processor/failure codes are never shown.
    if (res.ok && data.status === "succeeded") { setOk(true); setMsg("Payment succeeded (mock)."); }
    else setMsg(typeof data.message === "string" ? data.message : GENERIC_FAILURE);
  }

  return (
    <form onSubmit={pay} className="flex flex-col gap-4">
      <Field id="card" label="Test card number" help="4242 4242 4242 4242 approves; …0002 declines; …9995 insufficient funds.">
        {(a) => <Input {...a} value={card} onChange={(e) => setCard(e.target.value)} inputMode="numeric" autoComplete="off" />}
      </Field>
      {msg && <p role="status" data-testid="mock-result" className={ok ? "text-sm font-medium" : "text-sm font-medium text-danger"}>{msg}</p>}
      <div className="flex gap-3">
        <Button type="submit" loading={busy} disabled={ok}>Pay (mock)</Button>
        <a href={returnPath} className="self-center text-sm underline">Back to the drop</a>
      </div>
    </form>
  );
}
