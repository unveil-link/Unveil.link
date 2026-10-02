"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Alert, Button, Checkbox, Field, Input, LockIcon } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDuration, formatDurationLong, usd } from "@/lib/format";
import { SALES_FINAL_TEXT } from "@/lib/purchase-copy";
import { useCountdown } from "@/lib/useCountdown";

/**
 * Buy form against the payments layer's contract: POST /api/checkout { linkId, email, confirmOver18 } (+ Idempotency-Key)
 * -> { checkoutUrl } -> redirect to the hosted checkout. The price always comes from the server; no card data is collected here.
 * Errors: 429 -> countdown on the button (human-readable), anything else -> the server's message.
 */
export function BuyPanel({ linkId, priceCents }: { linkId: string; priceCents: number }) {
  const [email, setEmail] = useState("");
  const [over18, setOver18] = useState(false);
  const [showErr, setShowErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<null | { tone: "info" | "danger"; title: string; body: string }>(null);
  // One key per mounted form: a double click / retried request shares a single checkout session (server-side idempotency).
  const [idemKey] = useState(() => crypto.randomUUID());
  const cd = useCountdown();
  const noticeRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (notice) noticeRef.current?.focus(); }, [notice]);

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!emailOk || !over18) return setShowErr(true);
    setBusy(true);
    setNotice(null);
    const res = await api<{ checkoutUrl?: string }>("/api/checkout", {
      method: "POST",
      headers: { "idempotency-key": idemKey },
      json: { linkId, email: email.trim(), confirmOver18: true },
    });
    if (res.ok && res.data?.checkoutUrl) {
      window.location.href = res.data.checkoutUrl; // keep the button busy while the browser navigates
      return;
    }
    setBusy(false);
    if (res.ok) return setNotice({ tone: "danger", title: "Couldn’t start checkout", body: "Something went wrong. Please try again." });
    if (res.status === 429) {
      const wait = res.retryAfter ?? 30;
      cd.start(wait);
      return setNotice({ tone: "danger", title: "Please slow down", body: `Too many attempts. You can try again in ${formatDurationLong(wait)}.` });
    }
    setNotice({ tone: "danger", title: "Couldn’t start checkout", body: res.network ? res.error : res.error || "Something went wrong. Please try again." });
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3" data-testid="buy-form">
      <Field id="buyer-email" label="Email" error={showErr && !emailOk ? "Enter a valid email address." : undefined}>
        {(a) => (
          <Input {...a} type="email" required maxLength={254} autoComplete="email" inputMode="email" placeholder="you@example.com"
            value={email} onChange={(e) => setEmail(e.target.value)} />
        )}
      </Field>
      <Checkbox
        id="over18"
        data-testid="over18"
        required
        checked={over18}
        error={showErr && !over18}
        onChange={(e) => { setOver18(e.target.checked); if (e.target.checked) setShowErr(false); }}
        label={<>I confirm that I am 18 years of age or older, and I agree to the <Link href="/terms" className="text-primary underline">Terms</Link>.</>}
      />
      {showErr && !over18 && <p role="alert" className="-mt-1 text-sm font-medium text-danger">Please confirm to continue.</p>}
      <Button type="submit" size="lg" className="w-full" loading={busy} disabled={cd.active} data-testid="buy-button">
        <LockIcon className="size-5" />
        {cd.active ? `Try again in ${formatDuration(cd.remaining)}` : `Pay ${usd(priceCents)}`}
      </Button>
      <p className="text-center text-xs text-muted">Pay by card · No account needed</p>
      <p className="rounded-md bg-surface-muted px-3 py-2 text-xs text-muted" data-testid="sales-final">{SALES_FINAL_TEXT}</p>
      {notice && (
        <div ref={noticeRef} tabIndex={-1} className="outline-none" data-testid="checkout-notice">
          <Alert tone={notice.tone} title={notice.title}>{notice.body}</Alert>
        </div>
      )}
    </form>
  );
}
