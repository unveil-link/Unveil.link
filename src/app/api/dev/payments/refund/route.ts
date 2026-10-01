import { NextResponse } from "next/server";
import { z } from "zod";
import { api, jsonBody } from "@/server/http";
import { assertSimulatorEnabled, simulateRefund } from "@/server/payments/dev/simulator";

export const dynamic = "force-dynamic";

const schema = z.object({ transactionId: z.string().uuid(), amountCents: z.number().int().positive().optional() });

/** DEV ONLY (404 in production): request a refund and play the mock processor's refund webhook. */
export const POST = api(async (req) => {
  assertSimulatorEnabled();
  const b = schema.parse(await jsonBody(req));
  return NextResponse.json(await simulateRefund(b.transactionId, b.amountCents));
});
