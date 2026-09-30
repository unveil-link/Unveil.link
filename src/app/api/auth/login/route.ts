import { NextResponse } from "next/server";
import { z } from "zod";
import { api, jsonBody } from "@/server/http";
import { loginWithPassword } from "@/server/services/sellers";
import { setSessionCookie } from "@/server/auth/session";

const schema = z.object({ email: z.string().email(), password: z.string().min(1).max(200) });

export const POST = api(async (req) => {
  const body = schema.parse(await jsonBody(req));
  const seller = await loginWithPassword(body.email, body.password);
  await setSessionCookie(seller.id);
  return NextResponse.json({ seller });
});
