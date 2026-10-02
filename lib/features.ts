/**
 * Single place for "is this feature live?" flags that user-facing copy depends on. Words must not promise features that are not live.
 * Flip a flag only when the backend ships the feature (and QA has seen it work); every sentence below follows automatically.
 */

/** MP4 upload. Backend: only images are accepted today (`POST /api/drops/:id/files` answers 415 for video/mp4; backend/m2-media not merged). */
export const VIDEO_UPLOAD = false;

/** What sellers can sell, as a noun phrase for marketing copy. */
export const SELLABLE = VIDEO_UPLOAD ? "photos and videos" : "photos";
export const SELLABLE_CAP = SELLABLE.charAt(0).toUpperCase() + SELLABLE.slice(1);
export const SELLABLE_NOTE = VIDEO_UPLOAD ? "" : " (video is coming soon)";

/** Defaults of platform_settings (payout_hold_days / min_payout_cents). The dashboard itself always shows the live values from GET /api/earnings. */
export const PAYOUT_HOLD_DAYS = 7;
export const MIN_PAYOUT_USD = 25;
