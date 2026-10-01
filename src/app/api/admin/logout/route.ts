import { NextResponse } from "next/server";
import { api } from "@/server/http";
import { clearAdminCookie } from "@/server/admin/auth";

export const dynamic = "force-dynamic";
export const POST = api(async () => {
  await clearAdminCookie();
  return NextResponse.json({ ok: true });
});
