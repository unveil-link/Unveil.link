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
}

/** Read live from DB each call so admin changes take effect without a deploy. */
export async function getSettings(): Promise<PlatformSettings> {
  const r = await queryOne<PlatformSettings>(
    `SELECT fee_percent, price_min_cents, price_max_cents,
            max_image_size_bytes::float8 AS max_image_size_bytes,
            max_video_size_bytes::float8 AS max_video_size_bytes,
            max_files_per_drop, max_total_bytes_per_drop::float8 AS max_total_bytes_per_drop,
            download_ttl_seconds, allowed_image_mimes
       FROM platform_settings WHERE id = 1`,
  );
  if (!r) throw new Error("platform_settings row missing; run migrations");
  return r;
}
