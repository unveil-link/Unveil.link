import { NextResponse } from "next/server";
import { z } from "zod";
import { api, jsonBody } from "@/server/http";
import { resetPassword } from "@/server/services/password-reset";
import { enforceIpLimit } from "@/server/ratelimit";
import { PASSWORD_MAX_LENGTH } from "@/server/auth/password-policy";

export const dynamic = "force-dynamic";

const schema = z.object({ token: z.string().min(1).max(200), password: z.string().max(PASSWORD_MAX_LENGTH) });

/** Consumes a single-use token, sets the password and revokes every existing session of the account. */
export const POST = api(async (req) => {
  await enforceIpLimit("RESET_IP", req);
  const { token, password } = schema.parse(await jsonBody(req));
  await resetPassword(token, password);
  return NextResponse.json({ ok: true });
});
