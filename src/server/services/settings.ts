import { queryOne } from "../db";

export interface PlatformSettings {
  fee_percent: string;
  price_min_cents: number;
  price_max_cents: number;
  max_image_size_bytes: number;
  max_video_size_bytes: number;
  max_files_per_drop: number;
  max_total_bytes_per_drop: number;
  download_ttl_seconds: number | null;
  allowed_image_mimes: string[];
  /** NULL => the active payment provider's default (env for the mock). */
  processing_fee_percent: string | null;
  payout_hold_days: number;
  min_payout_cents: number;
  chargeback_fee_cents: number;
  checkout_session_ttl_minutes: number;
  checkout_late_success_grace_minutes: number;
  chargeback_flag_threshold: number;
  chargeback_flag_window_days: number;
}

/** Read live from DB each call so admin changes take effect without a deploy. */
export async function getSettings(): Promise<PlatformSettings> {
  const r = await queryOne<PlatformSettings>(
    `SELECT fee_percent, price_min_cents, price_max_cents,
            max_image_size_bytes::float8 AS max_image_size_bytes,
            max_video_size_bytes::float8 AS max_video_size_bytes,
            max_files_per_drop, max_total_bytes_per_drop::float8 AS max_total_bytes_per_drop,
            download_ttl_seconds, allowed_image_mimes,
            processing_fee_percent, payout_hold_days, min_payout_cents, chargeback_fee_cents,
            checkout_session_ttl_minutes, checkout_late_success_grace_minutes,
            chargeback_flag_threshold, chargeback_flag_window_days
       FROM platform_settings WHERE id = 1`,
  );
  if (!r) throw new Error("platform_settings row missing; run migrations");
  return r;
}
