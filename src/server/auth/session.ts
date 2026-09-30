import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { config } from "../config";

export const SESSION_COOKIE = "unveil_session";
const MAX_AGE_S = 60 * 60 * 24 * 7;

const key = () => new TextEncoder().encode(config.sessionSecret);

export async function createSessionToken(sellerId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sellerId)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_S}s`)
    .sign(key());
}

export async function readSessionToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

export async function setSessionCookie(sellerId: string) {
  (await cookies()).set(SESSION_COOKIE, await createSessionToken(sellerId), {
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProd,
    path: "/",
    maxAge: MAX_AGE_S,
  });
}

export async function clearSessionCookie() {
  (await cookies()).set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
}

/** Returns the seller id from the session cookie, or null. */
export async function getSessionSellerId(): Promise<string | null> {
  const t = (await cookies()).get(SESSION_COOKIE)?.value;
  return t ? readSessionToken(t) : null;
}
