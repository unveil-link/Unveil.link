import crypto from "node:crypto";
import { config } from "../config";

/**
 * Expiring HMAC-signed URLs for private originals.
 * sig = HMAC-SHA256(secret, "<purpose>:<fileId>:<expUnixSeconds>") (base64url)
 */
/** Fallback when neither platform_settings.download_ttl_seconds nor SIGNED_URL_TTL_SECONDS is set. */
export const FALLBACK_TTL_S = 24 * 60 * 60;

/** TTL precedence: platform_settings.download_ttl_seconds > env SIGNED_URL_TTL_SECONDS > 24 h. */
export function defaultTtlSeconds(settingsTtl?: number | null): number {
  if (settingsTtl && settingsTtl > 0) return settingsTtl;
  return config.signedUrlTtlSeconds;
}

function mac(purpose: string, fileId: string, exp: number): Buffer {
  return crypto
    .createHmac("sha256", config.signedUrlSecret)
    .update(`${purpose}:${fileId}:${exp}`)
    .digest();
}

export function signOriginalUrl(fileId: string, ttlSeconds = defaultTtlSeconds(), nowMs = Date.now()) {
  const exp = Math.floor(nowMs / 1000) + ttlSeconds;
  const sig = mac("original", fileId, exp).toString("base64url");
  const path = `/api/files/${fileId}/original?exp=${exp}&sig=${sig}`;
  return { path, url: `${config.appUrl}${path}`, expiresAt: new Date(exp * 1000).toISOString() };
}

export type VerifyResult = "ok" | "missing" | "malformed" | "expired" | "bad_signature";

export function verifyOriginalSignature(
  fileId: string,
  expRaw: string | null,
  sigRaw: string | null,
  nowMs = Date.now(),
): VerifyResult {
  if (!expRaw || !sigRaw) return "missing";
  if (!/^\d{1,12}$/.test(expRaw)) return "malformed";
  const exp = Number(expRaw);
  const given = Buffer.from(sigRaw, "base64url");
  const expected = mac("original", fileId, exp);
  // Check signature first so unsigned-but-expired probes learn nothing.
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return "bad_signature";
  }
  if (Math.floor(nowMs / 1000) > exp) return "expired";
  return "ok";
}
