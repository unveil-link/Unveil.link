import { NextResponse } from "next/server";
import { z } from "zod";
import { api, jsonBody } from "@/server/http";
import { enforceIpLimit } from "@/server/ratelimit";
import { createCheckout } from "@/server/payments/checkout";

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

/** Guest checkout (honours an `Idempotency-Key` header; identical concurrent requests share one session): validates, prices from the DB, creates a pending transaction + processor session. Rate limited per IP (CHECKOUT). */
export const POST = api(async (req) => {
  await enforceIpLimit("CHECKOUT", req);
  const body = schema.parse(await jsonBody(req));
  const out = await createCheckout({ ...body, idempotencyKey: req.headers.get("idempotency-key") });
  // 201 for a new checkout, 200 when an existing one is returned (same Idempotency-Key / identical live pending checkout).
  return NextResponse.json(out, { status: out.reused ? 200 : 201 });
});
