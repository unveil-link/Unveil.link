import { NextResponse } from "next/server";
import { api, requireSeller } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = api(async () => NextResponse.json({ seller: await requireSeller() }));
