import { NextResponse } from "next/server";
import { api } from "@/server/http";
import { requireAdmin } from "@/server/admin/auth";

export const dynamic = "force-dynamic";
export const GET = api(async () => NextResponse.json({ admin: await requireAdmin() }, { headers: { "Cache-Control": "no-store" } }));
