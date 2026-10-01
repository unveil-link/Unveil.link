"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Alert, Button, Checkbox, LockIcon } from "@/components/ui";
import { api } from "@/lib/api";
import { usd } from "@/lib/format";
import { useCountdown } from "@/lib/useCountdown";

/**
 * Buy button + terms confirmation. CHECKOUT IS A STUB: the backend's POST /api/checkout is rate-limited and always
 * answers 501 `not_implemented`. We call it so the real error paths (429 + Retry-After) are exercised, and turn the
 * 501 into a friendly "test mode" message. No payment data is collected anywhere on this page.
 */
export function BuyPanel({ linkId, priceCents }: { linkId: string; priceCents: number }) {
  const [agreed, setAgreed] = useState(false);
  const [showErr, setShowErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<null | { tone: "info" | "danger"; title: string; body: string }>(null);
  const cd = useCountdown();
  const noticeRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (notice) noticeRef.current?.focus(); }, [notice]);

  async function buy() {
    if (!agreed) return setShowErr(true);
    setBusy(true);
    setNotice(null);
    const res = await api("/api/checkout", { method: "POST", json: { linkId } });
    setBusy(false);
    if (res.ok) return; // not reachable until payments exist
    if (res.status === 429) {
      cd.start(res.retryAfter ?? 30);
      return setNotice({ tone: "danger", title: "Please slow down", body: "Too many attempts. You can try again shortly." });
    }
    if (res.code === "not_implemented" || res.status === 501) {
      return setNotice({
        tone: "info",
        title: "Checkout is in test mode",
        body: "Payments aren’t switched on yet, so nothing was charged. Check back soon — this link will work as soon as checkout opens.",
      });
    }
    setNotice({ tone: "danger", title: "Couldn’t start checkout", body: res.network ? res.error : "Something went wrong. Please try again." });
  }

  return (
    <div className="flex flex-col gap-3">
      <Checkbox
        id="agree"
        checked={agreed}
        error={showErr && !agreed}
        onChange={(e) => { setAgreed(e.target.checked); if (e.target.checked) setShowErr(false); }}
        label={<>I agree to the <Link href="/terms" className="text-primary underline">Terms</Link> and understand all sales are final.</>}
      />
      {showErr && !agreed && <p role="alert" className="-mt-1 text-sm font-medium text-danger">Please confirm to continue.</p>}
      <Button size="lg" className="w-full" onClick={buy} loading={busy} disabled={cd.active} data-testid="buy-button">
        <LockIcon className="size-5" />
        {cd.active ? `Try again in ${cd.remaining}s` : `Buy for ${usd(priceCents)}`}
      </Button>
      <p className="text-center text-xs text-muted">Pay by card · No account needed · Instant download</p>
      {notice && (
        <div ref={noticeRef} tabIndex={-1} className="outline-none" data-testid="checkout-notice">
          <Alert tone={notice.tone} title={notice.title}>{notice.body}</Alert>
        </div>
      )}
    </div>
  );
}
