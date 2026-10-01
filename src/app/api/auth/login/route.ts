import { NextResponse } from "next/server";
import { z } from "zod";
import { api, jsonBody } from "@/server/http";
import { loginWithPassword } from "@/server/services/sellers";
import { setSessionCookie } from "@/server/auth/session";
import { enforceIpLimit, enforceRateLimit, hashKeyPart } from "@/server/ratelimit";
import { enforceLoginDelay, getLoginDelayConfig, resetLoginThrottle } from "@/server/ratelimit/login-throttle";

const schema = z.object({ email: z.string().email(), password: z.string().min(1).max(200) });

export const POST = api(async (req) => {
  await enforceIpLimit("LOGIN_IP", req);
  const body = schema.parse(await jsonBody(req));
  // Progressive per-email delay (replaces the old LOGIN_EMAIL lockout). Same behaviour for unknown emails.
  // During a delay we answer 429 + Retry-After WITHOUT evaluating the password; those rejections are not counted anywhere,
  // so an attacker flooding an email cannot extend the delay or push the owner into the burst limiter.
  await enforceLoginDelay(body.email);
  // Per-email burst limiter (same mechanism as before, but now only a safety valve: it counts attempts that were admitted,
  // which the delay schedule already throttles, and its window is clamped to the delay cap so it can never be a lockout).
  await enforceRateLimit("LOGIN_EMAIL", hashKeyPart(body.email), { maxWindowSec: (await getLoginDelayConfig()).capSec });
  const seller = await loginWithPassword(body.email, body.password);
  await resetLoginThrottle(body.email);
  await setSessionCookie(seller.id);
  return NextResponse.json({ seller });
});
