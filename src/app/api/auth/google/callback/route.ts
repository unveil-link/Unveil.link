import { NextResponse, type NextRequest } from "next/server";
import { config } from "@/server/config";
import { GOOGLE_FLOW_COOKIE, exchangeCode } from "@/server/auth/google";
import { upsertGoogleSeller } from "@/server/services/sellers";
import { setSessionCookie } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const fail = (code: string) => {
    const r = NextResponse.redirect(`${config.appUrl}/login?error=${code}`);
    r.cookies.delete({ name: GOOGLE_FLOW_COOKIE, path: "/api/auth/google" });
    return r;
  };
  if (!config.google) return fail("google_not_configured");

  const p = req.nextUrl.searchParams;
  if (p.get("error")) return fail("google_denied");
  const code = p.get("code");
  const state = p.get("state");
  let flow: { s: string; n: string; v: string } | null = null;
  try {
    flow = JSON.parse(req.cookies.get(GOOGLE_FLOW_COOKIE)?.value ?? "null");
  } catch {}
  if (!code || !state || !flow || flow.s !== state) return fail("google_state");

  try {
    const profile = await exchangeCode(code, flow.v, flow.n);
    const seller = await upsertGoogleSeller(profile);
    await setSessionCookie(seller.id);
    const r = NextResponse.redirect(`${config.appUrl}/dashboard`);
    r.cookies.delete({ name: GOOGLE_FLOW_COOKIE, path: "/api/auth/google" });
    return r;
  } catch (e) {
    console.error("google oauth failed", e);
    return fail("google_failed");
  }
}
