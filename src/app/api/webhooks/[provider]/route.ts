import { NextResponse } from "next/server";
import { api } from "@/server/http";
import { handleWebhook } from "@/server/payments/webhooks";

export const dynamic = "force-dynamic";

/**
 * Processor -> us. The RAW body is read as text before any parsing (the HMAC covers the exact bytes).
 * No session/cookie auth: authenticity is the provider's verifyWebhook(). Duplicates answer 200 so processors stop retrying;
 * bad signatures answer 401 and change no payment state (a `rejected` row lands in webhook_events).
 */
export const POST = api<{ params: Promise<{ provider: string }> }>(async (req, { params }) => {
  const rawBody = await req.text();
  const r = await handleWebhook({ providerName: (await params).provider, rawBody, headers: req.headers, req });
  return NextResponse.json(r.body, { status: r.status });
});
