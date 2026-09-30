import { NextResponse } from "next/server";
import { config } from "@/server/config";
import { GOOGLE_FLOW_COOKIE, authorizationUrl, newFlow } from "@/server/auth/google";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!config.google) {
    return NextResponse.json(
      { error: "Google sign-in is not configured (set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)" },
      { status: 501 },
    );
  }
  const flow = newFlow();
  const res = NextResponse.redirect(authorizationUrl(flow));
  res.cookies.set(GOOGLE_FLOW_COOKIE, JSON.stringify({ s: flow.state, n: flow.nonce, v: flow.verifier }), {
    httpOnly: true,
    sameSite: "lax", // must be sent on the top-level redirect back from Google
    secure: config.isProd,
    path: "/api/auth/google",
    maxAge: 600,
  });
  return res;
}
