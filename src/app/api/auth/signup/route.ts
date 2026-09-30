import { NextResponse } from "next/server";
import { z } from "zod";
import { api, jsonBody } from "@/server/http";
import { signupWithPassword } from "@/server/services/sellers";
import { setSessionCookie } from "@/server/auth/session";

const schema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(200),
  displayName: z.string().trim().min(1).max(80),
});

export const POST = api(async (req) => {
  const body = schema.parse(await jsonBody(req));
  const seller = await signupWithPassword(body);
  await setSessionCookie(seller.id);
  return NextResponse.json({ seller }, { status: 201 });
});
