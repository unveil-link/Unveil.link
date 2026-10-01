import { NextResponse } from "next/server";
import { z } from "zod";
import { api, jsonBody } from "@/server/http";
import { loginWithPassword } from "@/server/services/sellers";
import { setSessionCookie } from "@/server/auth/session";
import { enforceIpLimit, enforceRateLimit, hashKeyPart } from "@/server/ratelimit";

const schema = z.object({ email: z.string().email(), password: z.string().min(1).max(200) });

export const POST = api(async (req) => {
  await enforceIpLimit("LOGIN_IP", req);
  const body = schema.parse(await jsonBody(req));
  await enforceRateLimit("LOGIN_EMAIL", hashKeyPart(body.email));
  const seller = await loginWithPassword(body.email, body.password);
  await setSessionCookie(seller.id);
  return NextResponse.json({ seller });
});
