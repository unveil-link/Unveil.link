import { createHash } from "node:crypto";
import { query, withTx } from "../db";
import { sanitizeForStorage } from "../input";

/**
 * Single writer for audit_log. The table is APPEND-ONLY (migration 011 triggers), so there is no update/delete helper by design.
 * Every value is sanitised (NUL / lone surrogates replaced, truncated) so an audit write can never fail because of hostile text, and
 * NEVER takes a password or hash: callers pass identifiers and reason codes only.
 */
export interface AuditEntry {
  adminId?: string | null;
  /** snapshot of the actor's email (filled from admins by a DB trigger when adminId is given and this is omitted) */
  adminEmail?: string | null;
  action: string;
  target: string;
  ip?: string | null;
  reason?: string | null;
}
type Runner = { query: (text: string, params?: unknown[]) => Promise<unknown> };

export async function writeAudit(run: Runner | null, e: AuditEntry): Promise<void> {
  const sql = `INSERT INTO audit_log (admin_id, admin_email, action, target, ip, reason) VALUES ($1, $2, $3, $4, $5, $6)`;
  const params = [
    e.adminId ?? null,
    e.adminEmail ? sanitizeForStorage(e.adminEmail.trim().toLowerCase(), 254) : null,
    sanitizeForStorage(e.action, 100),
    sanitizeForStorage(e.target, 1000),
    e.ip ? sanitizeForStorage(e.ip, 64) : null,
    e.reason ? sanitizeForStorage(e.reason, 100) : null,
  ];
  if (run) await run.query(sql, params); else await query(sql, params);
}

// ---- failed admin logins ----------------------------------------------------------------------------------------------------------

export type LoginFailReason = "unknown_email" | "bad_password" | "disabled" | "throttled" | "superseded";

/** Tunables (exported for tests). */
export const FAILED_LOGIN_AUDIT = {
  /** repeated identical failures (same ip + reason + attempted email) inside this window are coalesced into a counter */
  windowSec: 600,
  /** an extra summary row is written when a bucket's counter reaches one of these */
  milestones: [10, 100, 1000],
  /** hard cap on failed-login audit rows per clock hour across ALL sources; beyond it ONE 'admin_login_flood' row is written per hour */
  globalPerHour: 200,
};

/**
 * Records a failed admin sign-in without letting an attacker grow audit_log without bound. Called AFTER the per-IP rate limiter
 * (ADMIN_LOGIN_IP), and itself bounded in three more ways:
 *   1. coalescing: identical (ip, reason, attempted email) failures within `windowSec` share a bucket in admin_login_failure_buckets
 *      (a small mutable counter table - NOT part of the trail); only the 1st failure writes a row, plus summary rows at 10/100/1000,
 *      and the first row of the next window states how many repeats were folded into the previous one;
 *   2. a global cap of `globalPerHour` itemised rows/hour, with a single 'admin_login_flood' marker row when it is hit;
 *   3. the bucket table itself can only grow by what passes (2) and is pruned.
 * Never throws: auditing must not turn a 401 into a 500 (errors are logged).
 */
export async function auditFailedAdminLogin(rawEmail: string, reason: LoginFailReason, ip: string): Promise<void> {
  try {
    const email = sanitizeForStorage(rawEmail.trim().toLowerCase(), 100);
    const safeIp = sanitizeForStorage(ip || "unknown", 64);
    const key = createHash("sha256").update(`${safeIp}\n${reason}\n${email}`).digest("hex").slice(0, 32);
    const hourKey = `g:${new Date().toISOString().slice(0, 13)}`;
    await withTx(async (c) => {
      // 1. per-(ip, reason, email) coalescing bucket. The upsert takes the row lock and always returns a row.
      const b = (await c.query<{ n: number; expired: boolean }>(
        `INSERT INTO admin_login_failure_buckets (bucket, n, window_start) VALUES ($1, 0, now())
           ON CONFLICT (bucket) DO UPDATE SET n = admin_login_failure_buckets.n
         RETURNING n, window_start < now() - make_interval(secs => $2) AS expired`,
        [`f:${key}`, FAILED_LOGIN_AUDIT.windowSec])).rows[0];
      let n: number; let folded = 0;
      if (b.expired) {
        folded = Math.max(0, b.n - 1); // n counted the window's first failure, which already has its own row
        n = 1;
        await c.query(`UPDATE admin_login_failure_buckets SET n = 1, window_start = now() WHERE bucket = $1`, [`f:${key}`]);
      } else {
        n = b.n + 1;
        await c.query(`UPDATE admin_login_failure_buckets SET n = $2 WHERE bucket = $1`, [`f:${key}`, n]);
      }
      if (!(n === 1 || FAILED_LOGIN_AUDIT.milestones.includes(n))) return; // folded into the bucket counter: no row
      // 2. global hourly cap on ITEMISED rows (counts rows that would be written, not raw attempts)
      const g = (await c.query<{ n: number }>(
        `INSERT INTO admin_login_failure_buckets (bucket, n) VALUES ($1, 1) ON CONFLICT (bucket) DO UPDATE SET n = admin_login_failure_buckets.n + 1 RETURNING n`, [hourKey])).rows[0].n;
      if (g > FAILED_LOGIN_AUDIT.globalPerHour) {
        if (g === FAILED_LOGIN_AUDIT.globalPerHour + 1) {
          await writeAudit(c, { action: "admin_login_flood", target: `failed admin logins exceeded ${FAILED_LOGIN_AUDIT.globalPerHour} itemised rows/hour; further distinct failures this hour are counted but not itemised`, reason: "flood_cap" });
        }
        return;
      }
      const target = n === 1
        ? `failed admin login${folded ? ` (+${folded} repeat${folded === 1 ? "" : "s"} folded into the previous window)` : ""}`
        : `failed admin login repeated ${n}x within ${FAILED_LOGIN_AUDIT.windowSec}s`;
      await writeAudit(c, { adminEmail: email, action: "admin_login_failed", target, ip: safeIp, reason });
    });
    if (Math.random() < 0.02) {
      query(`DELETE FROM admin_login_failure_buckets WHERE window_start < now() - interval '1 day'`).catch(() => {});
    }
  } catch (e) {
    console.error("audit: failed to record failed admin login:", (e as Error).message);
  }
}
