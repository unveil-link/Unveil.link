import { NextResponse, after } from "next/server";
import { z } from "zod";
import { api, jsonBody } from "@/server/http";
import { requestPasswordReset } from "@/server/services/password-reset";
import { enforceIpLimit, hashKeyPart } from "@/server/ratelimit";
import { enforceRateLimit } from "@/server/ratelimit";
import { HttpError } from "@/server/errors";

export const dynamic = "force-dynamic";

const schema = z.object({ email: z.string().email().max(254) });

/**
 * Always answers 200 with the same body whether or not the account exists (no user enumeration).
 * The lookup/token/email work runs after the response is sent so timing doesn't leak existence either.
 * Per-IP: 429 + Retry-After. Per-email: silently capped (extra requests send no mail; same 200).
 */
export const POST = api(async (req) => {
  await enforceIpLimit("FORGOT_IP", req);
  const { email } = schema.parse(await jsonBody(req));
  let allowed = true;
  try {
    await enforceRateLimit("FORGOT_EMAIL", hashKeyPart(email));
  } catch (e) {
    if (e instanceof HttpError && e.status === 429) allowed = false;
    else throw e;
  }
  if (allowed) {
    after(async () => {
      try {
        await requestPasswordReset(email);
      } catch (e) {
        console.error("password reset request failed", e);
      }
    });
  }
  return NextResponse.json({ ok: true, message: "If an account exists for that email, a reset link is on its way." });
});
