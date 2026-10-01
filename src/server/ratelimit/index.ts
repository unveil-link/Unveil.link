import crypto from "node:crypto";
import { config } from "../config";
import { query } from "../db";
import { HttpError } from "../errors";

/**
 * Reusable rate limiter. `RateLimitStore` is the seam for a future Redis implementation
 * (INCR + EXPIRE gives the same fixed-window semantics). Shipped stores:
 *   - PostgresStore (default; works across multiple app instances, no extra infra)
 *   - MemoryStore   (single process; used by unit tests / RATE_LIMIT_STORE=memory)
 *
 * Algorithm: fixed window per key. `hit()` atomically increments and reports the count in the
 * current window plus seconds until the window resets.
 */
export interface RateLimitStore {
  hit(key: string, windowSec: number): Promise<{ count: number; retryAfterSec: number }>;
}

export class MemoryStore implements RateLimitStore {
  private m = new Map<string, { start: number; count: number }>();
  constructor(private now: () => number = Date.now) {}
  async hit(key: string, windowSec: number) {
    const t = this.now();
    let e = this.m.get(key);
    if (!e || t >= e.start + windowSec * 1000) {
      e = { start: t, count: 0 };
      this.m.set(key, e);
    }
    e.count++;
    if (this.m.size > 50_000) for (const [k, v] of this.m) if (t >= v.start + 3600_000) this.m.delete(k);
    return { count: e.count, retryAfterSec: Math.max(1, Math.ceil((e.start + windowSec * 1000 - t) / 1000)) };
  }
}

export class PostgresStore implements RateLimitStore {
  async hit(key: string, windowSec: number) {
    // Single atomic upsert; the DB clock is the only clock, so multiple app instances agree.
    const rows = await query<{ count: number; retry: number }>(
      `INSERT INTO rate_limits AS r (key, window_start, count) VALUES ($1, now(), 1)
       ON CONFLICT (key) DO UPDATE SET
         window_start = CASE WHEN r.window_start + make_interval(secs => $2) <= now() THEN now() ELSE r.window_start END,
         count        = CASE WHEN r.window_start + make_interval(secs => $2) <= now() THEN 1     ELSE r.count + 1 END
       RETURNING count, ceil(extract(epoch FROM (window_start + make_interval(secs => $2) - now())))::int AS retry`,
      [key, windowSec],
    );
    if (Math.random() < 0.01) {
      // opportunistic cleanup of long-dead windows (max window is 1 day)
      query("DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'").catch(() => {});
    }
    return { count: rows[0].count, retryAfterSec: Math.max(1, rows[0].retry) };
  }
}

// ---- limits (configurable) -------------------------------------------------

export interface Limit { limit: number; windowSec: number }

/** Defaults. Override any with env RATE_LIMIT_<NAME>="<max>/<windowSeconds>", e.g. RATE_LIMIT_LOGIN_IP=30/900. */
export const DEFAULT_LIMITS = {
  LOGIN_IP: { limit: 20, windowSec: 900 },
  LOGIN_EMAIL: { limit: 10, windowSec: 900 },
  SIGNUP_IP: { limit: 10, windowSec: 3600 },
  FORGOT_IP: { limit: 5, windowSec: 3600 },
  FORGOT_EMAIL: { limit: 3, windowSec: 3600 },
  RESET_IP: { limit: 10, windowSec: 3600 },
  DOWNLOAD: { limit: 60, windowSec: 60 },
  PREVIEW: { limit: 300, windowSec: 60 },
  PUBLIC_LINK: { limit: 120, windowSec: 60 },
  SIGNED_URL: { limit: 60, windowSec: 60 },
  CHECKOUT: { limit: 10, windowSec: 60 },
} satisfies Record<string, Limit>;
export type LimitName = keyof typeof DEFAULT_LIMITS;

export function parseLimit(raw: string | undefined, fallback: Limit): Limit {
  const m = raw?.trim().match(/^(\d{1,9})\s*\/\s*(\d{1,6})$/);
  if (!m || Number(m[1]) < 1 || Number(m[2]) < 1) return fallback;
  return { limit: Number(m[1]), windowSec: Number(m[2]) };
}
export const limitFor = (name: LimitName): Limit => parseLimit(process.env[`RATE_LIMIT_${name}`], DEFAULT_LIMITS[name]);

// ---- store selection -------------------------------------------------------

const g = globalThis as unknown as { __unveilRl?: RateLimitStore };
let override: RateLimitStore | null = null;
/** Test hook / future Redis wiring. */
export function setRateLimitStore(s: RateLimitStore | null) { override = s; }
function store(): RateLimitStore {
  if (override) return override;
  return (g.__unveilRl ??= process.env.RATE_LIMIT_STORE === "memory" ? new MemoryStore() : new PostgresStore());
}

// ---- helpers ---------------------------------------------------------------

/** Client IP: the Nth-from-right X-Forwarded-For entry (N = TRUSTED_PROXY_HOPS, default 1). */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    const hops = Math.max(1, config.trustedProxyHops);
    const ip = parts[Math.max(0, parts.length - hops)];
    if (ip) return ip.slice(0, 64);
  }
  return req.headers.get("x-real-ip")?.slice(0, 64) ?? "unknown";
}

export const hashKeyPart = (s: string) => crypto.createHash("sha256").update(s.trim().toLowerCase()).digest("hex").slice(0, 24);

export interface RateLimitResult { allowed: boolean; remaining: number; retryAfterSec: number }

/** Core check against an explicit store (unit-testable). */
export async function checkLimit(s: RateLimitStore, key: string, l: Limit): Promise<RateLimitResult> {
  const { count, retryAfterSec } = await s.hit(key, l.windowSec);
  return { allowed: count <= l.limit, remaining: Math.max(0, l.limit - count), retryAfterSec };
}

/**
 * Throws HttpError(429, Retry-After) when `name`'s limit is exceeded for `subject`.
 * `subject` is typically `clientIp(req)` or a hashed email. Fails OPEN (logs) if the store errors,
 * so a limiter outage cannot take the site down.
 */
export async function enforceRateLimit(name: LimitName, subject: string): Promise<void> {
  if (!config.rateLimitEnabled) return;
  let r: RateLimitResult;
  try {
    r = await checkLimit(store(), `${name}:${subject}`, limitFor(name));
  } catch (e) {
    console.error("rate limiter error (failing open)", e);
    return;
  }
  if (!r.allowed) {
    throw new HttpError(429, "Too many requests. Please try again later.", "rate_limited", {
      "Retry-After": String(r.retryAfterSec),
    });
  }
}

export const enforceIpLimit = (name: LimitName, req: Request) => enforceRateLimit(name, clientIp(req));
