import { config } from "../config";
import { HttpError } from "../errors";
import { mockProvider } from "./mock";
import type { PaymentProvider } from "./types";

/**
 * Provider registry. To add a processor: implement PaymentProvider in src/server/payments/<name>/index.ts and add it
 * here. Selection: PAYMENT_PROVIDER=<name> (default "mock"). The webhook URL segment must be a registered name.
 */
const PROVIDERS: Record<string, PaymentProvider> = {
  mock: mockProvider,
};

export const registeredProviderNames = () => Object.keys(PROVIDERS);

/** Lookup by name; own-property only so "__proto__"/"constructor" can't resolve. */
export function findProvider(name: string): PaymentProvider | null {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, name) ? PROVIDERS[name] : null;
}

/** The provider used for NEW checkouts. Throws HttpError(503) if it is unknown or unavailable (e.g. mock in production). */
export function activeProvider(): PaymentProvider {
  const p = findProvider(config.payments.provider);
  if (!p) throw new HttpError(503, "Payments are not configured", "payments_unavailable");
  const a = p.availability();
  if (!a.ok) {
    console.error(`payment provider "${p.name}" unavailable: ${a.reason}`);
    throw new HttpError(503, "Payments are not available", "payments_unavailable");
  }
  return p;
}
