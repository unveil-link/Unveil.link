import { NextResponse } from "next/server";
import { z } from "zod";
import { api, jsonBody } from "@/server/http";
import { assertSimulatorEnabled, simulatePayment } from "@/server/payments/dev/simulator";

export const dynamic = "force-dynamic";

const schema = z.object({ sessionId: z.string().min(1).max(100), card: z.string().min(1).max(40) });

/** DEV ONLY (404 in production): the hosted mock checkout page's "Pay" action. See payments/dev/simulator.ts. */
export const POST = api(async (req) => {
  assertSimulatorEnabled();
  const b = schema.parse(await jsonBody(req));
  return NextResponse.json(await simulatePayment(b.sessionId, b.card));
});
