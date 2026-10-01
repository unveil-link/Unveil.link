import { SignJWT, jwtVerify } from "jose";
import { cookies, headers } from "next/headers";
import { config } from "../config";
import type { PoolClient } from "pg";
import { pool, query, queryOne } from "../db";

export const SESSION_COOKIE = "unveil_session";
const MAX_AGE_S = 60 * 60 * 24 * 7;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const key = () => new TextEncoder().encode(config.sessionSecret);

/**
 * Sessions are server-side revocable: the JWT's `jti` is a row in `sessions`.
 * Every authenticated request verifies the signature AND that the row is not revoked/expired.
 * Tokens without a jti (issued before migration 003) are rejected.
 */
export async function createSession(sellerId: string, userAgent?: string | null): Promise<string> {
  if (Math.random() < 0.02) query("DELETE FROM sessions WHERE expires_at < now() - interval '1 day'").catch(() => {});
  const row = await queryOne<{ id: string }>(
    `INSERT INTO sessions (seller_id, expires_at, user_agent)
     VALUES ($1, now() + make_interval(secs => $2), $3) RETURNING id`,
    [sellerId, MAX_AGE_S, userAgent?.slice(0, 300) ?? null],
  );
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sellerId)
    .setJti(row!.id)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_S}s`)
    .sign(key());
}

async function verifyToken(token: string): Promise<{ sellerId: string; sessionId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string" || typeof payload.jti !== "string" || !UUID_RE.test(payload.jti)) return null;
    return { sellerId: payload.sub, sessionId: payload.jti };
  } catch {
    return null;
  }
}

/** Signature + DB check. Returns the seller id only for a live (non-revoked, unexpired) session. */
export async function readSessionToken(token: string): Promise<string | null> {
  const t = await verifyToken(token);
  if (!t) return null;
  const row = await queryOne<{ seller_id: string }>(
    `SELECT seller_id FROM sessions
      WHERE id = $1 AND seller_id = $2 AND revoked_at IS NULL AND expires_at > now()`,
    [t.sessionId, t.sellerId],
  );
  return row?.seller_id ?? null;
}

export async function revokeSessionToken(token: string): Promise<boolean> {
  const t = await verifyToken(token);
  if (!t) return false;
  const rows = await query(
    "UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL RETURNING id",
    [t.sessionId],
  );
  return rows.length > 0;
}

/** Revokes every live session of a seller (password reset, "log out everywhere"). */
export async function revokeAllSessions(sellerId: string, exec?: Pick<PoolClient, "query">): Promise<number> {
  const sql = "UPDATE sessions SET revoked_at = now() WHERE seller_id = $1 AND revoked_at IS NULL";
  const r = exec ? await exec.query(sql, [sellerId]) : await pool().query(sql, [sellerId]);
  return r.rowCount ?? 0;
}

export async function setSessionCookie(sellerId: string) {
  const ua = (await headers()).get("user-agent");
  (await cookies()).set(SESSION_COOKIE, await createSession(sellerId, ua), {
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProd,
    path: "/",
    maxAge: MAX_AGE_S,
  });
}

/** Clears the cookie AND revokes the session server-side, so a captured cookie stops working immediately. */
export async function clearSessionCookie() {
  const jar = await cookies();
  const t = jar.get(SESSION_COOKIE)?.value;
  if (t) await revokeSessionToken(t);
  jar.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: config.isProd, path: "/", maxAge: 0 });
}

/** Returns the seller id from the session cookie, or null. */
export async function getSessionSellerId(): Promise<string | null> {
  const t = (await cookies()).get(SESSION_COOKIE)?.value;
  return t ? readSessionToken(t) : null;
}
