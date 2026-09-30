import { NextResponse } from "next/server";
import { api } from "@/server/http";
import { clearSessionCookie } from "@/server/auth/session";

export const POST = api(async () => {
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
});
