import { NextResponse } from "next/server";
import { z } from "zod";
import { api, jsonBody } from "@/server/http";
import { enforceIpLimit } from "@/server/ratelimit";
import { config } from "@/server/config";
import { BUYER_COOKIE, createCheckout } from "@/server/payments/checkout";

export const dynamic = "force-dynamic";

// No amount field on purpose: the price always comes from the drop row in the database.
const schema = z
  .object({
    dropId: z.string().uuid().optional(),
    linkId: z.string().regex(/^[A-Za-z0-9_-]{12}$/).optional(),
    email: z.string().trim().email().max(254),
    confirmOver18: z.literal(true, { error: "You must confirm you are 18 or older" }),
  })
  .refine((v) => Boolean(v.dropId) !== Boolean(v.linkId), { message: "Provide exactly one of dropId or linkId" });

function cookieOf(req: Request, name: string): string | null {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/**
 * Guest checkout: validates, prices from the DB, creates a pending transaction + processor session. Rate limited per IP (CHECKOUT).
 * Idempotent for the SAME client only: same `Idempotency-Key`, or the same httpOnly `unveil_buyer` cookie (issued on the first new
 * checkout), gets its existing live session back (200, reused:true). Any other caller - even with the same email + drop - gets its
 * own independent session (201) and never learns somebody else's checkoutUrl.
 */
export const POST = api(async (req) => {
  await enforceIpLimit("CHECKOUT", req);
  const body = schema.parse(await jsonBody(req));
  const { setBuyerToken, ...out } = await createCheckout({
    ...body, idempotencyKey: req.headers.get("idempotency-key"), buyerToken: cookieOf(req, BUYER_COOKIE),
  });
  // 201 for a new checkout, 200 when this client's own existing one is returned.
  const res = NextResponse.json(out, { status: out.reused ? 200 : 201 });
  res.headers.set("Cache-Control", "no-store");
  if (setBuyerToken) {
    res.cookies.set(BUYER_COOKIE, setBuyerToken, { httpOnly: true, sameSite: "lax", secure: config.isProd, path: "/api/checkout", maxAge: 60 * 60 * 24 });
  }
  return res;
});
