import { NextResponse } from "next/server";
import { z } from "zod";
import { api, jsonBody } from "@/server/http";
import { signupWithPassword } from "@/server/services/sellers";
import { setSessionCookie } from "@/server/auth/session";
import { enforceIpLimit } from "@/server/ratelimit";
import { PASSWORD_MAX_LENGTH } from "@/server/auth/password-policy";

const schema = z.object({
  email: z.string().email().max(254),
  // length/blocklist/pattern rules are enforced in signupWithPassword (checkPasswordStrength) for a clear message
  password: z.string().max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`),
  displayName: z.string().trim().min(1).max(80),
});

export const POST = api(async (req) => {
  await enforceIpLimit("SIGNUP_IP", req);
  const body = schema.parse(await jsonBody(req));
  const seller = await signupWithPassword(body);
  await setSessionCookie(seller.id);
  return NextResponse.json({ seller }, { status: 201 });
});
