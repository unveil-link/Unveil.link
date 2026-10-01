import crypto from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { cookies, headers } from "next/headers";
import { config } from "../config";
import { HttpError } from "../errors";
import { pool, query, queryOne } from "../db";
import { hashPassword, verifyPassword } from "../auth/password";
import { checkPasswordStrength } from "../auth/password-policy";
import { getSessionSellerId } from "../auth/session";
import { hasBadText } from "../input";

/**
 * Admin authentication. A separate principal from sellers (no shared tables, cookie, signing key or role claim):
 *   - credentials: admins.password_hash (bcrypt via the same hashPassword as sellers); admins are created ONLY by the CLI
 *     (scripts/create-admin.ts) - there is no signup route and no default/seeded admin;
 *   - session: JWT (HS256, audience "unveil-admin", key = SHA-256("unveil-admin-session:" + SESSION_SECRET), so a seller token can never
 *     verify as an admin token and vice versa) whose jti is a row in admin_sessions (server-side revocable, 8 h);
 *   - cookie `unveil_admin`: httpOnly, SameSite=Strict, Secure in production.
 * Every authenticated request re-checks the session row AND that the admin is not disabled.
 */
export const ADMIN_COOKIE = "unveil_admin";
export const ADMIN_SESSION_SECONDS = 60 * 60 * 8;
const AUD = "unveil-admin";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const key = () => crypto.createHash("sha256").update(`unveil-admin-session:${config.sessionSecret}`).digest();

export interface Admin { id: string; email: string }

export async function createAdmin(email: string, password: string, opts: { resetIfExists?: boolean } = {}): Promise<{ id: string; created: boolean }> {
  const e = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 254 || hasBadText(e)) throw new Error("invalid email");
  if (hasBadText(password)) throw new Error("password contains invalid characters");
  const weak = checkPasswordStrength(password, { email: e });
  if (weak) throw new Error(weak);
  const hash = await hashPassword(password);
  const existing = await queryOne<{ id: string }>(`SELECT id FROM admins WHERE email = $1`, [e]);
  if (existing) {
    if (!opts.resetIfExists) throw new Error(`admin ${e} already exists (use --reset-password to change the password)`);
    await query(`UPDATE admins SET password_hash = $2, disabled_at = NULL WHERE id = $1`, [existing.id, hash]);
    await query(`UPDATE admin_sessions SET revoked_at = now() WHERE admin_id = $1 AND revoked_at IS NULL`, [existing.id]);
    await query(`INSERT INTO audit_log (admin_id, action, target) VALUES (NULL, 'admin_password_reset_cli', $1)`, [`admin:${existing.id}`]);
    return { id: existing.id, created: false };
  }
  const row = await queryOne<{ id: string }>(`INSERT INTO admins (email, password_hash) VALUES ($1, $2) RETURNING id`, [e, hash]);
  await query(`INSERT INTO audit_log (admin_id, action, target) VALUES (NULL, 'admin_created_cli', $1)`, [`admin:${row!.id}`]);
  return { id: row!.id, created: true };
}

/** Returns a signed session token, or null for ANY failure (unknown email, wrong password, disabled): callers answer a uniform 401. */
export async function loginAdmin(email: string, password: string, userAgent?: string | null): Promise<{ token: string; admin: Admin } | null> {
  if (hasBadText(email) || email.length > 254) return null; // defence in depth (the route already rejects these with 400)
  const a = await queryOne<{ id: string; email: string; password_hash: string | null; disabled_at: string | null }>(
    `SELECT id, email, password_hash, disabled_at FROM admins WHERE email = $1`, [email.trim().toLowerCase()]);
  const ok = await verifyPassword(password, a?.password_hash ?? null); // constant-ish time even when the admin doesn't exist
  if (!a || !ok || a.disabled_at) return null;
  const s = await queryOne<{ id: string }>(
    `INSERT INTO admin_sessions (admin_id, expires_at, user_agent) VALUES ($1, now() + make_interval(secs => $2), $3) RETURNING id`,
    [a.id, ADMIN_SESSION_SECONDS, userAgent?.slice(0, 300) ?? null]);
  await query(`UPDATE admins SET last_login_at = now() WHERE id = $1`, [a.id]);
  await query(`INSERT INTO audit_log (admin_id, action, target) VALUES ($1, 'admin_login', $2)`, [a.id, `admin:${a.id}`]);
  if (Math.random() < 0.02) query(`DELETE FROM admin_sessions WHERE expires_at < now() - interval '1 day'`).catch(() => {});
  const token = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(a.id).setAudience(AUD).setJti(s!.id)
    .setIssuedAt().setExpirationTime(`${ADMIN_SESSION_SECONDS}s`).sign(key());
  return { token, admin: { id: a.id, email: a.email } };
}

async function verifyAdminToken(token: string): Promise<{ adminId: string; sessionId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"], audience: AUD });
    if (typeof payload.sub !== "string" || typeof payload.jti !== "string" || !UUID_RE.test(payload.jti) || !UUID_RE.test(payload.sub)) return null;
    return { adminId: payload.sub, sessionId: payload.jti };
  } catch { return null; }
}

/** Signature + DB check (session live, admin not disabled). */
export async function readAdminToken(token: string): Promise<Admin | null> {
  const t = await verifyAdminToken(token);
  if (!t) return null;
  return queryOne<Admin>(
    `SELECT a.id, a.email FROM admin_sessions s JOIN admins a ON a.id = s.admin_id
      WHERE s.id = $1 AND s.admin_id = $2 AND s.revoked_at IS NULL AND s.expires_at > now() AND a.disabled_at IS NULL`,
    [t.sessionId, t.adminId]);
}

export async function revokeAdminToken(token: string): Promise<boolean> {
  const t = await verifyAdminToken(token);
  if (!t) return false;
  const r = await pool().query(`UPDATE admin_sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL RETURNING admin_id`, [t.sessionId]);
  if (r.rows[0]) await query(`INSERT INTO audit_log (admin_id, action, target) VALUES ($1, 'admin_logout', $2)`, [r.rows[0].admin_id, `admin:${r.rows[0].admin_id}`]);
  return (r.rowCount ?? 0) > 0;
}

export async function setAdminCookie(token: string) {
  (await cookies()).set(ADMIN_COOKIE, token, { httpOnly: true, sameSite: "strict", secure: config.isProd, path: "/", maxAge: ADMIN_SESSION_SECONDS });
}
export async function clearAdminCookie() {
  const jar = await cookies();
  const t = jar.get(ADMIN_COOKIE)?.value;
  if (t) await revokeAdminToken(t);
  jar.set(ADMIN_COOKIE, "", { httpOnly: true, sameSite: "strict", secure: config.isProd, path: "/", maxAge: 0 });
}

export async function getAdmin(): Promise<Admin | null> {
  const t = (await cookies()).get(ADMIN_COOKIE)?.value;
  return t ? readAdminToken(t) : null;
}

/**
 * Guard for every admin route/page. 401 when there is no valid admin session; 403 when the caller is a signed-in SELLER (their
 * seller cookie is not an admin credential and never will be). Never returns or exposes password hashes.
 */
export async function requireAdmin(): Promise<Admin> {
  const a = await getAdmin();
  if (a) return a;
  if (await getSessionSellerId()) throw new HttpError(403, "Forbidden", "forbidden");
  throw new HttpError(401, "Not authenticated", "unauthenticated");
}

export const requestUserAgent = async () => (await headers()).get("user-agent");
