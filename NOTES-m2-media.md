# NOTES — backend/m2-media

Branched from `origin/main` @ `10c4e65`. **No migration**: `platform_settings.max_video_size_bytes` (default 500 MiB = 524288000) already existed since 002, and `drop_files.mime/size_bytes`, `ON DELETE CASCADE` on `drop_files`/`reports` and `ON DELETE RESTRICT` on `transactions` were already right. Adds deps: `busboy` (+ `@types/busboy`). New system dependency: **ffmpeg + ffprobe**.

## What changed
| Area | Change | Where |
|---|---|---|
| MP4 upload | Same route/auth/CSRF/ownership/quota as images. Streaming multipart parse; MP4 detected by `ftyp` magic bytes, spooled to a 0600 temp file (never in memory), ffprobe-validated, stored via new streaming `Storage.putFile` | `src/server/upload.ts`, `services/video.ts`, `app/api/drops/[id]/files/route.ts` |
| Video preview | ffmpeg frame (~1 s) → same `makeBlurredPreview` as images → `blurred_preview_key` → existing `/api/files/:id/preview` | `services/video.ts` |
| Limits | 10 files + 2 GB per drop shared by images and videos, still atomic (extracted the locked insert into `insertFileLocked`, used by both); video per-file cap = `max_video_size_bytes`, image cap unchanged | `services/images.ts` |
| Delivery | `/api/files/:id/original` now streams (no `readFile` of 500 MB) and supports `Range` (206/416). Still the only route that returns original bytes | `app/api/files/[id]/original/route.ts`, `services/range.ts` |
| Storage adapters | `putFile`, `size`, `getStream` added to the interface, local and S3 adapters; local `delete` also removes the emptied per-drop dir | `src/server/storage/*` |
| Counts | `summarizeFiles` already counted `video/*`; verified end-to-end. Public API `previews[].kind` was already there. `/api/settings` now also exposes `maxVideoSizeBytes`, `allowedVideoMimes` | |
| PATCH | `PATCH /api/drops/:id` title/description/price (strict whitelist, platform_settings bounds, audit row, no attestation changes) | `services/drops.ts` (`updateDrop`, `dropPatchSchema`), `app/api/drops/[id]/route.ts` |
| DELETE | `DELETE /api/drops/:id` DB delete (cascade) + audit in one tx, then storage cleanup of originals+previews; 409 for drops with sales / open reports | `services/drops.ts` (`deleteDrop`) |
| UI | Dashboard upload accepts `video/mp4` (text only) | `components/DropEditor.tsx` |
| Tooling | `e2e.sh` requires ffmpeg/ffprobe, sets `UPLOAD_TMP_DIR=.e2e/uploads-tmp` | `scripts/e2e.sh` |

## Verified by
- `npm test`: **13 files / 243 tests** (was 11 files / 205): `tests/video.test.ts` (19: MP4 brand sniffing, ffprobe-JSON validation, Range parsing, streaming receiver incl. spoof/caps/8 MB bodies/temp cleanup, real ffmpeg pipeline: preview blurred + no metadata, broken files, ffmpeg-missing → 503) and `tests/db/drops-media.test.ts` (19, throwaway Postgres DB: PATCH/DELETE service rules, ownership, audit, attestation untouched, storage failure, sales/report refusal, video service: mixed 11th file, shared 2 GB cap with parallel uploads, video cap, spoof, cleanup).
- `npm run e2e`: **102/102** (81 before this branch — README said 62, it was stale — plus 21 new `[m2]` checks). Key new checks: generated 4 s 1280×720 H.264/AAC MP4 (`lavfi testsrc2`) with title/GPS-style metadata uploaded; original byte-identical in private storage (0600, not under `public/` or `.next-e2e/static`); preview exists, ≤320 px, high-pass detail 17 % of the raw frame's (limit 25 %), mean |pixel diff| 20 (limit > 5), no EXIF/ICC/XMP/IPTC and the metadata strings absent (`proof/video-raw-frame.png` vs `proof/video-blurred-preview.jpg`); 9 spoofed variants → 415 and nothing stored; 11th file with images+videos mixed → 400 `too_many_files` + parallel burst lands exactly 10 with no orphans; 2 GB cap atomic with videos (setting lowered); per-file video cap lowered → 413 (image cap independent); original unreachable by guessable paths / owner session / bad signature; signed URL streams byte-exact with 4 Range shapes + 416 + expiry 410; second app instance with `FFMPEG_PATH=/nonexistent` → 503 `video_unavailable`, images still OK; PATCH happy/validation (17 invalid bodies)/auth/CSRF/cross-seller; editing a published drop leaves attestation columns identical; DELETE auth/cross-seller (all rows and files survive), owner delete (rows gone, 6 stored objects + per-drop dirs gone, audit row, old signed URL 404), published delete disappears from public page, sales → 409; public page shows `3 files: 2 images, 1 video` → `4 files: 2 images, 2 videos`.
- Memory: a 299 MB MP4 (60 s, 40 Mbit/s 1080p) uploaded through the production build in ~1 s; server RSS before/peak/after = 198 MB / 198 MB / 179 MB (i.e. the body is not buffered); temp dir empty afterwards. (Manual run, not part of the e2e.)
- `npm run lint` clean; `npx tsc --noEmit` has one **pre-existing** error (`LayoutProps` in `src/app/layout.tsx`, same on `origin/main`; `next build` is fine).

## How to verify
```bash
git checkout backend/m2-media && npm ci && npm run migrate
apt-get install -y ffmpeg           # needed for video + the e2e
npm test && npm run e2e             # 243 tests; 102/102 checks
# manual
curl -b jar -F 'file=@clip.mp4;type=video/mp4' localhost:3000/api/drops/$DROP/files
curl -b jar -X PATCH -H 'content-type: application/json' -d '{"priceCents":2500}' localhost:3000/api/drops/$DROP
curl -b jar -X DELETE localhost:3000/api/drops/$DROP
curl -r 0-99 "localhost:3000$(curl -sb jar -X POST localhost:3000/api/files/$FILE/signed-url | jq -r .path)" -o /dev/null -w '%{http_code}\n'   # 206
```

## Design decisions / deviations
- **Delete vs. sales.** Spec says deleting needn't revoke purchased downloads, but no purchases exist yet; `transactions.drop_id` is `RESTRICT` (deliberately, money history), so a hard delete of a drop with transactions is **refused with 409 `drop_has_sales`** (unpublish instead). The intended later behaviour (soft delete that keeps files for buyers) is documented in the README ("Editing and deleting drops"). Also refused: open/reviewing abuse report (evidence) 409, flagged 403.
- **PATCH of ownership** returns 404 (not 403) for other sellers' drops, like every other drop route. Price accepted as `priceCents` or `price_cents`; unknown keys (incl. `status`, `attestation`) → 400 rather than silently ignored.
- **Video validation is two-stage** (ftyp brand then ffprobe `mov/mp4` demuxer + real video stream); QuickTime (`qt  `), HEIC/AVIF, 3GP, M4A brands are rejected although they share the container. ffmpeg/ffprobe run with `-f mov -protocol_whitelist file` (no playlist/network tricks) and a 60 s timeout.
- **Audit**: `audit_log` is admin-oriented (`admin_id` nullable); seller actions are written with `admin_id NULL` and a `drop:<id> seller:<id> …` target (`drop_edited`, `drop_deleted`, `drop_storage_orphans`). No schema change.
- A missing `file` part, a second file part, or a non-multipart body → 400 (previously the `formData()` parser; messages differ slightly, codes `bad_form`/`missing_file`).
- `[m2]` preview "detail" metric: the photo check uses total gradient; on the synthetic test pattern (flat areas + hard edges) total variation is blur-insensitive, so the video check uses a high-pass energy (image − Gaussian(image)) instead.
- e2e `os_tmpdir()` helper and `UPLOAD_TMP_DIR` make the "no leftover temp file" assertion deterministic.

## Caveats / not tested
- **ffmpeg is a system dependency.** Dev/CI/e2e hosts and the future Docker image/deploy must install `ffmpeg` (tested with Debian's 7.1.5 incl. libx264). There is no Dockerfile yet.
- **S3/R2 `putFile`/`getStream`/`size` are untested** (no bucket), like the rest of the S3 adapter. `putFile` is a single streamed `PutObject` (fine up to 5 GB; the cap is 500 MB). The S3 `delete` of a missing key is a no-op in S3 semantics.
- Only H.264/AAC MP4 was exercised; other codecs inside MP4 (HEVC, AV1, odd rotations/variable-frame-rate, files with moov at the end of a 500 MB file) rely on ffmpeg and weren't tested. A video whose first second can't be decoded falls back to frame 0, and otherwise fails 415.
- A 500 MB upload was not run end-to-end (largest tested: 299 MB manually; the 500 MiB cap is only tested with the setting lowered). No transcoding / playback: originals can only be downloaded via the signed URL.
- Behind a reverse proxy: body size limit (~520 MB), disabled request buffering and long timeouts must be configured; serverless platforms with small body limits can't take 500 MB uploads (a presigned direct-to-bucket flow would be needed — not built).
- Nothing scans videos for malware / CSAM / NSFW (unchanged from images — still a launch blocker per README).
- Signed URLs remain stateless and unrevocable; after DELETE they 404 because the file is gone.
- Concurrency: the delete takes the same drop row lock as uploads, but an upload that has already written its objects to storage while the drop is being deleted gets 404 from `insertFileLocked` and cleans up its objects itself (covered by logic, not by a dedicated race test).
- Dashboard UI: only the upload `accept` attribute/text changed; no edit/delete buttons were added in the UI (API only).
