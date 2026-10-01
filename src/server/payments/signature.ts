import crypto from "node:crypto";

/**
 * Webhook signing used by the mock processor and available to real providers for "our own HMAC" schemes
 * (Segpay / CCBill document no webhook signatures; see PAYMENTS-NOTES.md).
 *
 * Header value:   t=<unix seconds>,v1=<hex HMAC-SHA256(secret, `${t}.${rawBody}`)>
 *  - the MAC covers the RAW body bytes exactly as received (never a re-serialised parse),
 *  - the timestamp is inside the MAC and must be within `toleranceSec` of now (limits replay of captured requests),
 *  - comparison is constant-time (crypto.timingSafeEqual on equal-length buffers).
 * Replay of a *fresh* captured request inside the tolerance window is handled by event-id dedupe, not here.
 */
export const SIGNATURE_HEADER = "x-unveil-signature";

export type SignatureCheck = "ok" | "no_secret" | "missing" | "malformed" | "bad_signature" | "stale";

export function signPayload(secret: string, rawBody: string, tSec: number): string {
  const mac = crypto.createHmac("sha256", secret).update(`${tSec}.${rawBody}`, "utf8").digest("hex");
  return `t=${tSec},v1=${mac}`;
}

export function verifySignature(opts: {
  secret: string;
  rawBody: string;
  header: string | null | undefined;
  nowSec?: number;
  toleranceSec?: number;
}): SignatureCheck {
  const { secret, rawBody, header } = opts;
  if (!secret) return "no_secret";
  if (!header) return "missing";
  let t: number | null = null;
  const macs: string[] = [];
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    if (i < 0) return "malformed";
    const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
    if (k === "t") {
      if (!/^\d{1,12}$/.test(v)) return "malformed";
      t = Number(v);
    } else if (k === "v1") {
      macs.push(v);
    }
  }
  if (t === null || macs.length === 0) return "malformed";
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`, "utf8").digest();
  let match = false;
  for (const m of macs) {
    // Always run the comparison (on a zero buffer if the candidate is not 32 hex bytes) so timing doesn't reveal why it failed.
    const cand = /^[0-9a-fA-F]{64}$/.test(m) ? Buffer.from(m, "hex") : Buffer.alloc(expected.length);
    const ok = crypto.timingSafeEqual(cand, expected) && /^[0-9a-fA-F]{64}$/.test(m);
    match = match || ok;
  }
  if (!match) return "bad_signature";
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const tol = opts.toleranceSec ?? 300;
  if (Math.abs(now - t) > tol) return "stale";
  return "ok";
}
