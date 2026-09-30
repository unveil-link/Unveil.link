import crypto from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { config } from "../config";

/**
 * Google OAuth 2.0 authorization-code flow with PKCE + state + nonce.
 * NOTE: not tested against live Google (needs real credentials). Logic follows
 * https://developers.google.com/identity/openid-connect/openid-connect
 */
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

export const GOOGLE_FLOW_COOKIE = "unveil_google_flow";

export const redirectUri = () => `${config.appUrl}/api/auth/google/callback`;

export function newFlow() {
  const b64 = (n: number) => crypto.randomBytes(n).toString("base64url");
  const verifier = b64(48);
  return {
    state: b64(24),
    nonce: b64(24),
    verifier,
    challenge: crypto.createHash("sha256").update(verifier).digest("base64url"),
  };
}

export function authorizationUrl(f: ReturnType<typeof newFlow>): string {
  const g = config.google;
  if (!g) throw new Error("Google OAuth not configured");
  const u = new URL(AUTH_URL);
  u.search = new URLSearchParams({
    client_id: g.clientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: "openid email profile",
    state: f.state,
    nonce: f.nonce,
    code_challenge: f.challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return u.toString();
}

export interface GoogleProfile {
  sub: string;
  email: string;
  name: string;
  picture: string | null;
}

export async function exchangeCode(code: string, verifier: string, nonce: string): Promise<GoogleProfile> {
  const g = config.google;
  if (!g) throw new Error("Google OAuth not configured");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: g.clientId,
      client_secret: g.clientSecret,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new Error(`google token exchange failed (${res.status})`);
  const { id_token } = (await res.json()) as { id_token?: string };
  if (!id_token) throw new Error("google response missing id_token");
  const { payload } = await jwtVerify(id_token, JWKS, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: g.clientId,
  });
  if (payload.nonce !== nonce) throw new Error("nonce mismatch");
  if (payload.email_verified !== true || typeof payload.email !== "string") {
    throw new Error("google email not verified");
  }
  return {
    sub: String(payload.sub),
    email: payload.email.toLowerCase(),
    name: typeof payload.name === "string" ? payload.name : payload.email.split("@")[0],
    picture: typeof payload.picture === "string" ? payload.picture : null,
  };
}
