import { getSettings, type PlatformSettings } from "../services/settings";
import { computeSplit, percentToBps, type SaleSplit } from "./money";
import type { PaymentProvider } from "./types";

export interface PricingRates {
  feePercent: string;
  processingFeePercent: string;
  platformBps: number;
  processingBps: number;
}

/** Platform fee = platform_settings.fee_percent (admin-editable, default 10). Processing fee = platform_settings.processing_fee_percent, else the provider default. */
export function ratesFor(provider: PaymentProvider, s: Pick<PlatformSettings, "fee_percent" | "processing_fee_percent">): PricingRates {
  const feePercent = String(s.fee_percent);
  const processingFeePercent = s.processing_fee_percent != null ? String(s.processing_fee_percent) : provider.processingFeePercent();
  return { feePercent, processingFeePercent, platformBps: percentToBps(feePercent), processingBps: percentToBps(processingFeePercent) };
}

export async function quoteSale(provider: PaymentProvider, grossCents: number): Promise<{ split: SaleSplit; rates: PricingRates }> {
  const rates = ratesFor(provider, await getSettings());
  return { split: computeSplit(grossCents, rates.platformBps, rates.processingBps), rates };
}
