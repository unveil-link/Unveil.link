import crypto from "node:crypto";
import { config } from "../config";
import { HttpError } from "../errors";

/** Constant-time string equality (hash both sides first so the compare is fixed length whatever the input). */
export function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * Authorises an internal cron request: `Authorization: Bearer <CRON_SECRET>` (what Vercel Cron sends when CRON_SECRET is set).
 * CRON_SECRET unset / < 32 chars => 503 (feature disabled, never "open"). Wrong or missing token => 401.
 */
export function requireCronAuth(req: Request, secret: string | null = config.cronSecret): void {
  if (!secret) throw new HttpError(503, "Cron trigger is disabled", "cron_disabled");
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer (.+)$/.exec(h);
  if (!m || !safeEqual(m[1].trim(), secret)) {
    throw new HttpError(401, "Unauthorized", "unauthorized", { "WWW-Authenticate": "Bearer" });
  }
}
