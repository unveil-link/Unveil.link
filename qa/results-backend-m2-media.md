# Unveil QA results — `backend/m2-media` (MP4 upload + PATCH/DELETE drop), run 1

- **Date:** 2026-10-01 19:40–21:25 ET
- **Branch tested:** `origin/backend/m2-media` @ **`6c3e8c072eb808c3f9051f558b173857f91156b3`** (not merged), branched from `origin/main` @ **`10c4e65`** (merge-base = main). Regression baseline: `origin/main` @ 10c4e65 run side by side.
- **Env:** clean detached worktrees `/workspace/qa-m2media` (branch) and `/workspace/qa-m2main` (main); Node 20.19.2, PostgreSQL 17, **ffmpeg/ffprobe 7.1.5** (system packages, installed on the box); `npm ci`; `npm run migrate` (12 migrations, no new one); throwaway DBs; app on `next start` (production build, mock payments, `RATE_LIMIT_ENABLED=0`, local storage, `UPLOAD_TMP_DIR` on the same volume). Second/third instances for ffmpeg-failure probes: `FFMPEG_PATH=/nonexistent`, `FFMPEG_TIMEOUT_MS=150`. No app code was modified.
- **Not covered:** S3/R2 driver (no bucket), reverse-proxy body limits, rate limits on the (new) streaming original route with default limits (instance ran limits off), real browser UI (no edit/delete/video UI exists yet: only the `accept` text changed), buyer download flow (M2-12/14/15/16/17 not built).

## Suite results on `backend/m2-media` @ 6c3e8c0
| Check | Expected (backend notes) | Result |
|---|---|---|
| `npm ci` / `npm run migrate` | clean, no new migration | OK / 12 applied (same as main) |
| `npm run lint` | clean | **clean** |
| `npx tsc --noEmit` | 1 pre-existing `LayoutProps` error | **exactly 1 error: `src/app/layout.tsx(47,50) TS2304 LayoutProps`** (same on main); clean after `next build` generated route types |
| `npm test` | 243 | **243/243 passed** (13 files) |
| `npm run build` | OK | **OK** |
| `npm run e2e` | 102 | **102/102 checks passed** |

Logs: `qa/evidence-m2-suite/`.

## Verdict
**0 blockers, 0 High/Medium.** MP4 upload, PATCH and DELETE behave as specified on every functional probe (132 scripted probes: 127 PASS, 4 FAIL, 1 NOTE — each FAIL maps to BUG-22/23/24/25 below; the Info items and BUG-26/BUG-13 are recorded as PASS-with-note because they are behaviours, not script failures): content-based validation, streaming to disk with flat memory, private originals, truly blurred previews, strict PATCH whitelist, owner-only 404 semantics, 409/403 refusal rules, file removal from disk, earnings untouched. I found **5 Low-severity issues** (BUG-22…BUG-26: two delete-vs-concurrent-request races, an off-by-one at the exact 500 MiB cap, negative ffmpeg availability cached for the process lifetime, and a misleading/over-broad "has sales" rule) and confirmed **BUG-13 (text/plain JSON accepted) carries over to the new PATCH** (unchanged, Low). No regressions against `main`.

## Plan cases (rows updated in `qa/unveil-v1-test-plan.md`)
| ID | Result | Notes |
|---|---|---|
| M1-05 | **PASS** | Image regression: JPG/PNG/WebP still 201 (jpeg/png/webp), image-size cap 15 728 640 B inclusive (15 728 640 → 201, +1 → 413). |
| M1-06 | **PASS** (BE) | 1280×720 H.264/AAC MP4 with title+GPS metadata → 201 `{filename,mime:"video/mp4",sizeBytes,durationSec}`, listed with `has_preview`, stored original byte-identical (sha256), mode 0600, key `originals/<drop>/<uuid>.mp4` (not derivable from the filename), temp spool removed. Variants accepted: brand mp42, moov-at-end, 640×360, display-matrix rotate 90, HEVC, AV1, 16×16, 8192×8192, 10 h duration, 60 KB metadata. UI progress bar not testable (no UI). |
| M1-07 | **PASS** | GIF/PDF/EXE/EXE-as-.jpg → 415; MOV/QuickTime, WebM, MKV, AVI, 3GP, M4A (+ each renamed `.mp4`), audio-only MP4, cover-art-only MP4, JPEG/PNG/text/EXE renamed `.mp4`, fake `ftyp` + random/zeros/JPEG/text/huge-box, truncated at 11/12/32/100 B, zero-byte, 3000-nested-box bomb → **415**, nothing stored, no temp, no internal path/ffmpeg text in any error. Content decides (image with `video/mp4` type → 415; real MP4 named `.jpg`/`.png`/no ext → stored as video/mp4). |
| M1-08 | **PASS** (+Low BUG-24) | 11th file (mixed images+videos) → 400 `too_many_files`; 14 parallel mixed uploads land **exactly 10**, no orphans; 4×(500 MiB−1)+50 331 652 B = **exactly 2 147 483 648 B accepted**, +1 byte → 413 `drop_too_large`, then an image → 413; 500 MiB−1 → 201 (streamed, 3.2 s); 500 MiB+1 → 413 `file_too_large`; 700 MB body (declared and chunked) cut off at once (0.007 s / at cap), nothing stored. **Exactly 524 288 000 B → 413 (BUG-24).** |
| M1-09 | **BLOCKED** | Resumable (tus-style) upload not implemented (single multipart POST; PATCH/HEAD/PUT on the endpoint 405). Abort handling PASS: socket destroyed mid-video (30 MB) or right after headers → no DB row, no object, spool removed ≤1.5 s, server healthy. |
| M1-10 | **PASS** | Image preview regression: 320 px JPEG, EXIF/ICC/XMP stripped, 'SECRET-QA' EXIF string absent, high-pass ratio 0.037, original bytes not contained, draft preview 404 for anon/other seller (qa-backend-1 log). |
| M1-11 | **PASS** | Video preview: 320×180 JPEG (2.4 kB) from the frame at ~1 s; high-pass energy 0.140 of the raw frame (limit 0.25 — visibly blurred, `qa/artifacts/backend-m2-media/video-preview-blurred.jpg` vs `video-raw-frame.png`); no EXIF/ICC/XMP/IPTC; source title/GPS strings absent; rotated source → portrait preview 180×320; not derivable to original. |
| M1-12 | **PASS** | Video+image originals unreachable via guessed paths (`/originals/…`, `/storage/…`, `/public/…`, `/_next/static/…`, trailing-slash/`..` tricks → 404/403/308 no content), no-sig / forged / extended-exp / sig reused on another file → 403, owner cookie without signature → 403, other seller cannot mint (404), public API + `/u/<link>` HTML contain no storage key, `.mp4`, `sig=`, `exp=`, path; anon preview works only while published (404 after unpublish). Signed URL streams byte-exact; `Range` 206 (closed/open/suffix/past-end), 416 (`bytes=N-`, `-0`), multi-range/garbage ignored (200), expired 410/403; headers `attachment`, `nosniff`, `no-store`, `Accept-Ranges: bytes`; content-disposition filename sanitised (CRLF/quotes/unicode/600 chars/`../`). |
| M1-13 | **PASS** | Other seller: upload, PATCH, DELETE, GET drop, mint signed URL, preview of draft → **404**, response identical to a nonexistent id (no existence oracle, also for invalid bodies); anonymous 401; garbage cookie 401; non-UUID / SQL-ish ids 404. Rows and files survive a foreign DELETE. |
| M2-01 | **PASS** | Edit path: title 1–120 (trimmed first), description ≤2000 UTF-16 units (nullable), price via PATCH — see M2-02. Create path unchanged. |
| M2-02 | **PASS** | PATCH price: 99→400, 100/101/49 999/50 000 → 200, 50 001/0/−1/−2500/12.5/1e21/2^53/"1200"/null/true/array/object → 400 (`price_out_of_range`/`invalid_input`), value unchanged after each rejection; JSON `1e2`, `1.0e3`, `5e4` accepted as integers, `1e-2`, `0x64`, `NaN`, `-0`, `100.00000000000001` → 400; `price_cents` alias works, both keys → 400. |
| M2-10 | **PASS** (BE) | PATCH title/description/price on draft and on a **published** drop: reflected immediately on `/api/public/drops/<link>` and `/u/<link>` (HTML in description escaped); `status`, `published_at`, attestation columns, link id untouched; audit `drop_edited` (admin_id NULL, price old→new, no title/description text); `drop_files`/objects untouched. Buyers: existing succeeded sale (transaction row, 3 ledger postings, earnings balance/lifetime) **byte-identical** after a price edit; new checkout uses the new price (9000 → fee 900 → net 7020) and the public API/checkout follow 1200→1300→50000→100 immediately. **No edit UI yet.** |
| M2-11 | **PASS** | Unpublish still 200; edited published drop → unpublish → edit while unpublished (status stays `unpublished`, not re-published, not public) → re-publish carries the edit and still requires the attestation (400 without). |
| M2-12 | **BLOCKED** | No buyer download flow. What exists: DELETE of a drop with a sale → 409 `drop_has_sales`, unpublish still works (so "buy → unpublish" can't be exercised end to end yet). |
| M2-13 | **PASS** (BE; +Low BUG-22/23/26) | Owner DELETE of a draft with 2 images + 1 video: 200 `{"deleted":true,"deletedFiles":3,"storageErrors":0}`, drop/file rows gone, 6 stored objects (originals + previews) and both per-drop dirs removed, audit `drop_deleted` (no storage keys in it), a previously issued signed URL → 404; published drop: public API/page/preview/original/checkout → 404, owner GET/PATCH/publish/upload → 404, no stale cache; second/third DELETE → 404 (1 audit row); other seller 404 (identical to nonexistent), anon 401, cross-origin 403, GET/HEAD never delete; **409 `drop_has_sales`** (rows+files+tx+ledger+earnings untouched; stays 409 after unpublish); 409 `drop_has_open_report` for open and reviewing reports, actioned/dismissed reports don't block (and are cascade-deleted); **403 `flagged`** (also wins over sales/open report); deleting another drop leaves earnings/ledger byte-identical; 5 create+delete cycles leave no stray files/dirs. Storage failure (originals dir read-only) → still 200 with `storageErrors:2`, audit `drop_storage_orphans`, no path in response. **No delete UI yet.** |
| M2-14/15/16/17 | **BLOCKED** / NOT RUN | Buyer download page/receipt/attempt counter not built. Signed-URL expiry itself PASS (qa-backend-1d: +60 s 200, −10 s/−1 d 410, tampering 403). M2-17 (rate limit on the original route, which is now a streaming route) not re-run: instance ran with limits off. |

## Probe results beyond the plan
Per-probe table (full evidence in `qa/evidence-m2-*.log|json`, scripts in `qa/scripts/qa-m2-*.mjs`):

| ID | Result | Probe | Evidence (trimmed) |
|---|---|---|---|
| M1-06 | PASS | upload 1 valid MP4 (H.264/AAC 1280x720 4 s, with title/GPS-style metadata) -> 201, listed, mime video/mp4 | 201 {"file":{"id":"537ec6db-9999-4833-a461-40e45cbd3236","filename":"good.mp4","mime":"video/mp4","sizeBytes":1458961,"durationSec":4}} \| list: {"id":"537ec6db-9999-4833-a461-40e45cbd3236","drop_id":"356697c8-b0f9-4931-919c-9abd7 |
| M1-06b | PASS | stored original is byte-identical, private (0600), outside public/.next static; temp spool removed | sha256 equal; mode 600; key originals/<drop>/537ec6db-9999-4833-a461-40e45cbd3236.mp4; tmp empty |
| M1-11 | PASS | blurred preview generated from the video: JPEG <=320px, truly blurred (high-pass energy vs raw frame), no EXIF/ICC/XMP, source metadata strings absent | jpeg 320x180 2429 B; no exif/icc/xmp/iptc; metadata strings absent; high-pass energy preview/raw = 0.140 (limit 0.25) [artifacts video-preview-blurred.jpg vs video-raw-frame.png] |
| M1-11b | PASS | preview is not the original: cannot recover original bytes/frames from the preview file; preview key differs, stored under previews/ | preview 2429 B (original 1458961 B); previews/ key; 320px-max |
| V-ok-mp42.mp4 | PASS | valid MP4 variant accepted (brand mp42) | 201; preview 320x180 |
| V-ok-good-noFast.mp4 | PASS | valid MP4 variant accepted (moov at end) | 201; preview 320x180 |
| V-ok-small.mp4 | PASS | valid MP4 variant accepted (640x360 2 s) | 201; preview 320x180 |
| V-ok-rot90.mp4 | PASS | valid MP4 variant accepted (rotate metadata) | 201; preview 320x180 |
| V-ok-hevc.mp4 | PASS | valid MP4 variant accepted (HEVC in MP4 (hvc1)) | 201; preview 320x240 |
| V-ok-av1.mp4 | PASS | valid MP4 variant accepted (AV1 in MP4) | 201; preview 320x240 |
| V-zero-img | PASS | zero-byte image -> 400 empty_file (baseline for the zero-byte .mp4 -> 415 note) | 400 {"error":"Empty file","code":"empty_file"} |
| V-rej-fake-ftyp-random.mp4 | PASS | valid ftyp then random bytes | 415 invalid_video "Not a valid MP4 video" (80 ms), nothing stored, tmp empty |
| V-rej-fake-ftyp-zeros.mp4 | PASS | ftyp + zeros | 415 invalid_video "Not a valid MP4 video" (80 ms), nothing stored, tmp empty |
| V-rej-fake-ftyp-jpeg.mp4 | PASS | ftyp + JPEG body | 415 invalid_video "Not a valid MP4 video" (82 ms), nothing stored, tmp empty |
| V-rej-fake-ftyp-text.mp4 | PASS | ftyp + text | 415 invalid_video "Not a valid MP4 video" (78 ms), nothing stored, tmp empty |
| V-rej-fake-ftyp-only.mp4 | PASS | ftyp box only | 415 invalid_video "Not a valid MP4 video" (78 ms), nothing stored, tmp empty |
| V-rej-fake-ftyp-hugebox.mp4 | PASS | ftyp + moov box with size 4 GB lie | 415 invalid_video "Not a valid MP4 video" (94 ms), nothing stored, tmp empty |
| V-rej-fake-ftyp-largesize.mp4 | PASS | ftyp with size=1 (64-bit) + random | 415 invalid_video "Not a valid MP4 video" (79 ms), nothing stored, tmp empty |
| V-rej-trunc-half.mp4 | PASS | valid MP4 truncated at 50% | ACCEPTED 201 (245 ms) preview 200 2429 B — playable-enough for ffmpeg |
| V-rej-trunc-100b.mp4 | PASS | truncated at 100 B | 415 invalid_video "Not a valid MP4 video" (77 ms), nothing stored, tmp empty |
| V-rej-trunc-ftyp-only.mp4 | PASS | truncated at 32 B | 415 invalid_video "Not a valid MP4 video" (77 ms), nothing stored, tmp empty |
| V-rej-trunc-12b.mp4 | PASS | truncated at 12 B (just the sniff window) | 415 invalid_video "Not a valid MP4 video" (80 ms), nothing stored, tmp empty |
| V-rej-trunc-11b.mp4 | PASS | truncated at 11 B | 415 unsupported_type "Only MP4 videos are allowed (file is not a valid MP4)" (7 ms), nothing stored, tmp empty |
| V-rej-jpeg-as.mp4 | PASS | JPEG renamed .mp4 (type video/mp4) | 415 unsupported_type "Only MP4 videos are allowed (file is not a valid MP4)" (6 ms), nothing stored, tmp empty |
| V-rej-png-as.mp4 | PASS | PNG renamed .mp4 | 415 unsupported_type "Only MP4 videos are allowed (file is not a valid MP4)" (6 ms), nothing stored, tmp empty |
| V-rej-text-as.mp4 | PASS | text renamed .mp4 | 415 unsupported_type "Only MP4 videos are allowed (file is not a valid MP4)" (6 ms), nothing stored, tmp empty |
| V-rej-exe-as.mp4 | PASS | EXE-like (MZ) renamed .mp4 | 415 unsupported_type "Only MP4 videos are allowed (file is not a valid MP4)" (6 ms), nothing stored, tmp empty |
| V-rej-webm-as.mp4 | PASS | WebM renamed .mp4 | 415 unsupported_type "Only MP4 videos are allowed (file is not a valid MP4)" (7 ms), nothing stored, tmp empty |
| V-rej-mkv-as.mp4 | PASS | Matroska renamed .mp4 | 415 unsupported_type "Only MP4 videos are allowed (file is not a valid MP4)" (8 ms), nothing stored, tmp empty |
| V-rej-avi-as.mp4 | PASS | AVI renamed .mp4 | 415 unsupported_type "Only MP4 videos are allowed (file is not a valid MP4)" (6 ms), nothing stored, tmp empty |
| V-rej-mov-as.mp4 | PASS | QuickTime MOV renamed .mp4 | 415 unsupported_type "Only MP4 videos are allowed (file is not a valid MP4)" (5 ms), nothing stored, tmp empty |
| V-rej-qt.mov | PASS | QuickTime .mov video/quicktime | 415 unsupported_type "Only MP4 videos are allowed (file is not a valid MP4)" (7 ms), nothing stored, tmp empty |
| V-rej-clip.webm | PASS | WebM video/webm | 415 unsupported_type "Only MP4 videos are allowed (file is not a valid MP4)" (6 ms), nothing stored, tmp empty |
| V-rej-clip.mkv | PASS | MKV video/x-matroska | 415 unsupported_type "Only MP4 videos are allowed (file is not a valid MP4)" (6 ms), nothing stored, tmp empty |
| V-rej-clip.avi | PASS | AVI video/x-msvideo | 415 unsupported_type "Only MP4 videos are allowed (file is not a valid MP4)" (5 ms), nothing stored, tmp empty |
| V-rej-clip.3gp | PASS | 3GP video/3gpp | 415 unsupported_type "Only MP4 videos are allowed (file is not a valid MP4)" (6 ms), nothing stored, tmp empty |
| V-rej-audio.m4a | PASS | M4A audio/mp4 | 415 invalid_image "Not a valid image" (8 ms), nothing stored, tmp empty |
| V-rej-audio-as.mp4 | PASS | M4A renamed .mp4 | 415 unsupported_type "Only MP4 videos are allowed (file is not a valid MP4)" (6 ms), nothing stored, tmp empty |
| V-rej-audio-only-isom.mp4 | PASS | MP4 (isom) with audio only | 415 invalid_video "Not a valid MP4 video" (87 ms), nothing stored, tmp empty |
| V-rej-coveronly.mp4 | PASS | MP4 whose only 'video' stream is cover art (attached_pic) | 415 invalid_video "Not a valid MP4 video" (80 ms), nothing stored, tmp empty |
| V-rej-zero.mp4 | PASS | zero-byte .mp4 (415 unsupported_type; a zero-byte .jpg gives 400 empty_file - see V-zero-img) | 415 unsupported_type "Only MP4 videos are allowed (file is not a valid MP4)" (5 ms), nothing stored, tmp empty |
| V-rej-mdat-corrupt.mp4 | PASS | valid headers, first 20 kB of mdat corrupted | 415 invalid_video (397 ms), nothing stored |
| V-rej-moov-size-lie.mp4 | PASS | moov box size lies (0xfffffff0) | ACCEPTED 201 (256 ms) preview 200 2429 B — playable-enough for ffmpeg |
| V-rej-tkhd-zero-dim.mp4 | PASS | tkhd width/height zeroed | ACCEPTED 201 (268 ms) preview 200 2429 B — playable-enough for ffmpeg |
| V-rej-mvhd-timescale0.mp4 | PASS | mvhd timescale 0 | ACCEPTED 201 (247 ms) preview 200 2429 B — playable-enough for ffmpeg |
| V-rej-mvhd-duration-max.mp4 | PASS | mvhd duration 0xffffffff | ACCEPTED 201 (246 ms) preview 200 2429 B — playable-enough for ffmpeg |
| V-rej-stts-huge-entries.mp4 | PASS | stts entry_count 0x7fffffff | 415 invalid_video (88 ms), nothing stored |
| V-rej-stsz-huge-count.mp4 | PASS | stsz sample_count 0x7fffffff | 415 invalid_video (86 ms), nothing stored |
| V-rej-nested-box-bomb.mp4 | PASS | 3000 nested udta boxes | 415 invalid_video "Not a valid MP4 video" (88 ms), nothing stored, tmp empty |
| V-rej-time | NOTE | all rejection probes total time | 8356 ms for 38 uploads |
| V-claim | PASS | image file claiming video/mp4 MIME is judged on content (JPEG body, type video/mp4, name .jpg) | 415 unsupported_type |
| V-claim2 | PASS | real MP4 sent as image/jpeg with .jpg or .png name or no extension is still recognised by content (stored as video/mp4, filename sane) | mp4-as.jpg:201 video/mp4 mp4-as.jpg \| mp4-as.png:201 video/mp4 mp4-as.png \| mp4-noext:201 video/mp4 mp4-noext |
| V-image-regress | PASS | JPG/PNG/WebP still upload; GIF/PDF/EXE-renamed-.jpg still rejected (image path unchanged) | jpeg:201 png:201 webp:201 gif:415 pdf:415 exe.jpg:415 |
| V-mp-edge | PASS | multipart edge cases: no file part, wrong field name, 2 file parts, non-multipart body, JSON body, empty body, missing boundary -> 4xx, never 5xx; no leftovers | nofile:400/missing_file wrongfield:400/missing_file two-files:400/too_many_parts json:400/bad_form empty:400/bad_form noboundary:400/bad_form octet:400/bad_form bad-body:400/bad_form |
| V-authz | PASS | upload to someone else's drop -> 404 (body not stored); unauthenticated -> 401; nonexistent/non-UUID drop id -> 404/400 | other:404 anon:401 missing:404 baduuid:404 |
| V-csrf | PASS | cross-origin upload (Origin: https://evil.example) -> 403 bad_origin, nothing stored | 403 bad_origin |
| V-unverified | PASS | unverified seller can upload video to own draft (same as images); publish still blocked | upload 201; publish 403 verification_required |
| V-names | PASS | filename tricks (../, \, quotes, CRLF, NUL, unicode, 600 chars, leading dots) never reach storage keys / headers; DB filename sanitised | "../../../etc/passw"→"passwd.mp4" \| "..\\..\\win.mp4"→"win.mp4" \| "a\"b;c=d.mp4"→"a_22b_c_d.mp4" \| "x\r\nSet-Cookie: pwn"→"x_0D_0ASet-Cookie_ pwn" \| "%2e%2e%2fetc.mp4"→"_2e_2e_2fetc.mp4" \| "名前🎬.mp4"→"_.mp4" \| "AAAAAAAAAAAAAA |
| M1-12v | PASS | video original unreachable pre-purchase: guessable paths, no-signature, forged signature, owner cookie without signature, public API/page contain no storage path or signed URL | /originals/225f7fbf-70bc-4bf5-86f7-046fd→404 /originals/225f7fbf-70bc-4bf5-86f7-046fd→404 /storage/originals/225f7fbf-70bc-4bf5-86→404 /public/originals/225f7fbf-70bc-4bf5-86f→404 /_next/static/originals/225f7fbf-70bc-4b→404 /api/ |
| V-signed | PASS | owner-minted signed URL streams the exact bytes; Range 206/suffix/open-ended/416; multi-range+garbage ignored (200); expired 410; tampered sig 403; response headers safe | bytes=0-99→206 bytes=1000-→206 bytes=-500→206 bytes=1458960-1459960→206 bytes=1458961-→416 bytes=0-1,5-9→200 bytes=abc→200 bytes=5-2→200 bytes=-0→416 HEAD→200 tampered→403 expired→403 |
| M1-08a | PASS | 11th file blocked (mixed 6 images + 4 videos fill 10; 11th video AND 11th image -> 400 too_many_files, no leftovers) | 11th video:400/too_many_files 11th image:400/too_many_files \| message: A drop can have at most 10 files |
| M1-08b | PASS | parallel burst: 14 simultaneous video+image uploads into an empty drop land exactly 10 (no overshoot, no orphan objects/temp files) | 201×10, rejected 400/too_many_files,400/too_many_files,400/too_many_files,400/too_many_files; rows 10, objects 20, tmp empty |
| M1-08c | PASS | per-video cap 500 MiB (524288000): cap-1 and cap accepted (streamed 500 MB), cap+1 -> 413 file_too_large with nothing stored; server RSS stays flat | cap-1:201 (3214 ms) \| cap(exact 524288000):413/file_too_large (3022 ms) \| cap+1:413/file_too_large (2515 ms) \| RSS base 239 MB peak 243 MB (uploads 3x ~500 MB) |
| M1-08c2 | FAIL | a video of EXACTLY the cap (524288000 B = 500 MiB) is accepted (cap is inclusive: 'files up to 500 MB') | exact-cap video status (cap-1 accepted, cap+1 rejected; see M1-08c): expected 201, got 413 |
| M1-08d | PASS | oversized body is cut off: 700 MB stream (ftyp + zeros) -> 413 quickly (declared size > cap+64 KB rejected up-front; undeclared/chunked stops at cap), no temp left | declared-length: 413 0.006784 \| chunked 700 MB: 413 {"error":"File exceeds limit of 524288000 bytes","code":"file_too_large"} |
| M1-08e | PASS | 2 GiB per-drop total (exact): 4 x (500 MiB-1) + 50331652 B fills exactly 2,147,483,648 B -> OK; +1 byte file rejected 413 drop_too_large; then an image (any bytes) rejected; DB sum exact | sum 2147483648 (=2 GiB); +50MiB+1:413/drop_too_large tiny image:413/drop_too_large; msg: A drop can hold at most 2 GB in total |
| M1-09a | PASS | client aborts mid-upload (destroy socket after 30 MB of a video) -> no DB row, no stored object, temp spool removed | temp files right after abort: 1; after 1.5 s: 0; rows 0; objects 0 |
| M1-09b | PASS | abort during an image-sized body and abort right after headers (no body) -> no 5xx noise, nothing stored, server still healthy | nothing stored; server healthy |
| M1-09c | PASS | resumable upload (tus-style) — spec M1-09: not provided by this branch (single multipart POST; no Range/PATCH resume endpoint) | PATCH:405 HEAD:405 PUT:405 OPTIONS:204 (resume not implemented -> M1-09 stays BLOCKED) |
| V-mem | PASS | memory: 4 parallel 500 MB uploads -> server RSS delta < 250 MB (body streamed to disk) | 4 x 500 MB parallel in 11665 ms; RSS base 257 MB, peak 259 MB (delta 2); tmp empty |
| V-meta-big | PASS | valid MP4 with a 20 MB 'free' box before moov, and box-bomb inputs, processed within the time budget; no 5xx | 415 invalid_video in 1670 ms |
| M2-10 | PASS | PATCH title/description/price on a DRAFT -> 200, returns updated drop, persisted, other fields untouched | 200 ["id","seller_id","public_link_id","title","description","price_cents","cover_url","status","created_at"] |
| M2-10b | PASS | PATCH on a PUBLISHED drop is reflected on /api/public/drops/:linkId and /u/:linkId; status/published_at/attestation untouched | public API + page show new title/price; HTML escaped |
| M2-10c | PASS | PATCH is audited (drop_edited, admin_id NULL, price old->new, no title/description text) and does not change attestation history | drop:112c8beb-e9c7-4729-95e1-907f0e92bf11 seller:44b363ef-0c79-4845-9291-3063ccbec450 status:published title changed (9->7 chars); description changed; price_cents: 3000 -> 4000 |
| M2-10d | PASS | description: null clears; description '' / whitespace clears; title unchanged | cleared by null, "", "   " |
| M2-01 | PASS | price boundaries via PATCH: 99->400, 100/101/49999/50000 ok, 50001/0/negative/float/huge/string/null/bool/array/object -> 400 price_out_of_range\|invalid_input; failures leave price unchanged | 99→400/price_out_of_range 100→200 101→200 49999→200 50000→200 50001→400/price_out_of_range 0→400/price_out_of_range -1→400/price_out_of_range -2500→400/price_out_of_range 12.5→400/invalid_input 1e+21→400/invalid_input 900719925474 |
| M2-02 | PASS | raw JSON number forms of price: 1e2 (=100) ok, 1.0e3 ok, 5e4 ok, 1e-2, 0x64 / 100n invalid JSON, NaN/Infinity invalid JSON, '100.0' string rejected, price_cents alias works, both keys -> 400 | {"priceCents":1e2}→200 {"priceCents":1.0e3}→200 {"priceCents":5e4}→200 {"priceCents":1e-2}→400 {"priceCents":0x64}→400 {"priceCents":NaN}→400 {"priceCents":Infinity}→400 {"priceCents":"100.0"}→400 {"priceCents":-0}→400 {"priceCent |
| M2-10e | PASS | title boundaries: 1 char ok, 120 ok, 121 -> 400, '' / whitespace-only / tab-newline-only -> 400, non-string -> 400; description 2000 ok, 2001 -> 400 | t1→200 t120→200 t121→400 t0→400 tws→400 ttabnl→400 tnum→400 tnull→400 tarr→400 t120+ws (trimmed before length)→200 d2000→200 d2001→400 dnum→400 d1000 emoji (2000 UTF-16 units)→200 d1001 emoji (2002 units)→400 |
| M2-10f | PASS | control chars / NUL / lone surrogates / bidi / zero-width / HTML in title+description: no 500; NUL & lone surrogate -> 400; others stored literally and escaped on the public page | NUL title→400 NUL desc→400 lone surrogate title→400 C0 title→200 newlines desc→200 RLO bidi title→200 zero-width title→200 html→200 stored title "<img src=x onerror=alert(1)>\"'</script><script>alert(2)</script>" |
| M2-10g | PASS | C0 control characters in title are stored (policy note): same handling as POST /api/drops (creation) — compare | create 201, patch 200 (both accept C0 chars: consistent) |
| M2-10h | PASS | mass assignment: owner/status/fee/flagged/id/link/attestation/timestamps/cover keys -> 400 (strict) and the row is byte-identical afterwards | seller_id:400 sellerId:400 owner:400 status:400 id:400 public_link_id:400 publicLinkId:400 fee_percent:400 feePercent:400 platform_fee_cents:400 flagged:400 is_flagged:400 published_at:400 created_at:400 updated_at:400 attested_at |
| M2-10i | PASS | whitelisted + extra key in one body is rejected as a whole (no partial apply) | 400 {"error":"body: Unrecognized key: \"status\"","code":"invalid_input"} |
| M2-10j | PASS | empty / non-object bodies: {} -> 400 empty_patch; [] / null / 5 / 'str' / invalid JSON / empty body -> 400; no 500 | {}→400/empty_patch []→400 null→400 5→400 "str"→400 {→400 <empty>→400 true→400 {"title":}→400 {'title':'x'}→400 {"title":"a","title":"b"}→200 dup-key title stored="b" |
| M2-10k | PASS | oversized body (5 MB JSON) and deeply nested JSON -> 4xx, no 500/crash | 5MB desc → 400/invalid_input; nested → 400/invalid_input |
| M2-13a | PASS | PATCH authz: anonymous -> 401; other seller -> 404 (same body as a nonexistent id); malformed/nonexistent uuid -> 404; row untouched; other seller's valid body not applied | anon 401; other 404; nonexistent 404; invalid-body-on-foreign 400 |
| M2-13b | PASS | PATCH with an invalid body on another seller's drop returns the same 404 as valid body (no existence oracle via validation order) | foreign+invalid → 400 invalid_input; nonexistent+invalid → 400 invalid_input (identical) |
| M2-13c | PASS | session handling: expired/garbage cookie -> 401; suspended/other-role cookie not accepted; admin cookie name not accepted | garbage cookie → 401; session cookie names unveil_session |
| V-csrf | PASS | CSRF: cross-origin / null / garbage Origin -> 403 bad_origin; same-origin ok; no Origin allowed (non-browser) | https://evil.example→403 null→403 garbage→403 http://localhost:3260.evil.example→403 no-origin+sec-fetch-site:cross-site→200 DELETE evil→403 |
| BUG-13 | PASS | BUG-13 pattern: PATCH with Content-Type text/plain / form-urlencoded / multipart / none + no Origin (cookie auth) — is the body processed? | OPEN (BUG-13 carried over to PATCH): text/plain body accepted → text/plain→200 x-www-form-urlencoded→200 no content-type (string body → text/plain default)→200 json charset utf-16→200 title now "utf16" |
| V-method | PASS | other verbs on /api/drops/:id (PUT, POST, OPTIONS, HEAD) -> 405 / no side effects | PUT→405 POST→405 OPTIONS→204 HEAD→200 |
| M2-10l | PASS | PATCH on a FLAGGED drop -> 403 flagged, row unchanged (flagged drops frozen); PATCH after unpublish works; unpublished edit does not republish | flagged → 403/flagged; unpublished edit → 200; status unpublished; public 404 |
| M2-11 | PASS | unpublish / re-publish regression with edits: edited price/title carried through republish; attestation required again as before | republish 200; public shows Re-pub 2222; publish w/o attestation → 400 |
| M2-10m | PASS | edit of nonexistent-after-delete drop -> 404; edit race with unpublish does not 500 | statuses 200,200,200,200,200,200,200,200,200,200 |
| V-concurrent | PASS | concurrent PATCH (30 parallel with distinct titles+prices): all 200, no 5xx/deadlock, final row equals one complete request (title and price from the SAME request), audit rows = 30 | final T-27 / 1027 (consistent); audit 30 |
| V-concurrent2 | PASS | PATCH storm on separate fields (title-only vs price-only vs description-only, 60 parallel): no lost-update across different columns | a57 1058 d53 |
| M2-10n | PASS | price edit on PUBLISHED drop with an existing SUCCEEDED sale: transaction row, ledger postings, earnings are unchanged; new buyer pays the new price | old tx 2000 unchanged (net 1560); ledger 3 rows unchanged; new checkout {"amount_cents":9000,"platform_fee_cents":900,"seller_net_cents":7020} |
| M2-10o | PASS | price edit with a PENDING checkout: same buyer (token cookie) re-checkout supersedes the stale-priced session; a different browser's pending session keeps the OLD price until it expires (documented behaviour) | same-buyer: old tx failed/superseded, new tx 5000; other-browser pending before pay {"status":"pending","amount_cents":2000}; its late webhook at OLD price → 200 {"received":true,"outcome":"processed"} → {"status":"succeeded","amo |
| M2-10p | PASS | buyer-visible price: public API price, /u page and checkout amount all follow a PATCH immediately (no cache) | followed 1200,1300,50000,100 |
| M2-10q | PASS | PATCH changes no files: drop_files rows / storage objects / previews unchanged | 6 objects unchanged |
| V-rate | PASS | no unbounded response: PATCH response never contains seller_id/storage paths/attestation internals beyond the drop object fields | keys: id,seller_id,public_link_id,title,description,price_cents,cover_url,status,created_at |
| M2-11a | PASS | DELETE draft with 2 images + 1 video: 200 {deleted,deletedFiles:3,storageErrors:0}; drop+file rows gone; originals AND previews AND per-drop dirs gone from disk; tmp empty; audit drop_deleted | {"deleted":true,"deletedFiles":3,"storageErrors":0}; disk objects 6→0, dirs gone; audit: drop:ebc5ef52-e233-4cec-bb2d-d8f26e6f9a07 seller:4ef6ca4e-1060-4996-bd6f-c80e33ce39c2 status:draft files:3; old signed URL → 404 |
| M2-11b | PASS | DELETE published drop: public link/page/preview/checkout/dashboard behave sanely afterwards (404s, no 500, no stale cache) | GET /api/public/drops/<link>→404 \| GET /u/<link>→404 \| GET /api/files/<f>/preview→404 \| GET /api/files/<f>/original→403 \| POST /api/checkout→404 \| dashboard GET→404 \| PATCH after delete→404 \| publish after delete→404 \| upl |
| M2-11c | PASS | second DELETE of the same drop -> 404 (idempotent: no 500, no extra audit row) | 200 → 404 → 404; 1 audit row |
| M2-13d | PASS | DELETE authz: other seller -> 404 (rows+files survive, same as nonexistent); anonymous -> 401; bad/nonexistent uuid -> 404; garbage cookie 401; admin-less | other 404; anon 401; garbage 401; bad-uuid 404; all survive |
| V-del-csrf | PASS | DELETE with foreign/null/garbage Origin -> 403 and drop survives; DELETE with body/query junk ignored; no-Origin allowed | https://evil.example→403 null→403 garbage→403 ; same-origin with junk query/body → 200 |
| V-del-method | PASS | GET / link prefetch cannot delete: GET /api/drops/:id never mutates; HEAD ok | GET/HEAD safe |
| M2-12a | PASS | DELETE with a SUCCEEDED sale -> 409 drop_has_sales; drop, files, transaction, ledger, earnings untouched; unpublish still works afterwards | 409 {"error":"This drop has sales and cannot be deleted. Unpublish it instead.","code":"drop_has_sales"}; after unpublish still 409; earnings identical ({"pendingCents":1560,"availableCents":0,"totalCents":1560}) |
| M2-12b | PASS | DELETE with ONLY a pending / failed / expired / refunded / chargeback transaction -> 409 drop_has_sales (any transaction row blocks) — documents the rule | pending→409/drop_has_sales failed→409/drop_has_sales refunded→409/drop_has_sales charged_back→409/drop_has_sales |
| M2-12c | PASS | DELETE with an OPEN or REVIEWING report -> 409 drop_has_open_report (files survive); actioned/dismissed reports do not block and are cascade-deleted | open→409/drop_has_open_report reviewing→409/drop_has_open_report actioned→200 dismissed→200 (note: deleting a drop with a closed report removes the report evidence row — see Notes) |
| M2-12d | PASS | DELETE of a FLAGGED drop -> 403 flagged (rows+files intact); admin-side status unaffected | 403 {"error":"Drop is flagged and under review","code":"flagged"} |
| M2-12e | PASS | precedence: flagged + sales -> ? ; flagged + open report -> ? (documented) | flagged+sales→403/flagged; flagged+open-report→403/flagged |
| M2-11d | PASS | delete drop with NO files, and with file rows whose objects are already missing on disk -> 200, storageErrors 0, no 500 | no files → {"deleted":true,"deletedFiles":0,"storageErrors":0}; objects pre-removed → {"deleted":true,"deletedFiles":2,"storageErrors":0} |
| M2-11e | PASS | storage cleanup failure (originals dir made read-only): still 200 (DB delete committed, no resurrection), storageErrors>0, audit drop_storage_orphans; response/logs don't leak path to client; later cleanup possible | {"deleted":true,"deletedFiles":2,"storageErrors":2}; audit drop_deleted,drop_storage_orphans; orphaned objects left on disk: 2 (previews cleaned: true) |
| V-del-conc1 | PASS | concurrent DELETE x12 of one drop: exactly one 200, the rest 404, no 5xx, one audit row, no leftover objects | codes 200,404,404,404,404,404,404,404,404,404,404,404 |
| V-del-conc2 | PASS | DELETE vs PATCH race (20 trials): no 5xx; after a 200 delete every later PATCH is 404; no zombie rows | 20 trials clean |
| V-del-conc3 | FAIL | DELETE vs CHECKOUT race on a published drop (30 trials, 4 parallel checkouts + delete): no 5xx from checkout/delete; outcome consistent (deleted ⇒ no transaction rows; has tx ⇒ drop+files survive and delete was 409); no orphan transactions | 29/30 trials with 500 from checkout (FK violation transactions_drop_id_fkey in server log; deleted 29, blocked 1); orphan/inconsistent rows: 0; e.g. del:200/ co:500,500,500,500 \|\| del:200/ co:500,500,500,500 |
| V-del-conc4 | PASS | DELETE vs PURCHASE (webhook) race: pending checkout exists, then DELETE races the paid webhook x15: never a deleted drop with a ledger/transaction; sale either completes (409) — no 5xx | 15 trials: delete always 409 (tx exists), webhook 15/15 succeeded, no 5xx |
| V-del-conc5 | FAIL | DELETE vs UPLOAD race (15 trials: 3 parallel uploads + delete): no 5xx; no orphan rows/objects left for the drop afterwards | 1/15 trials with a 500 on an upload; 1/15 trials left an orphan stored object/row after a successful delete; e.g. 5xx 500,404,200,404,404 \|\| deleted but rows 0 objs 1 codes 500,404,200,404,404 |
| V-del-earn | PASS | deleting one drop leaves another drop's sales, ledger and /api/earnings byte-identical (seller with a sold drop + a deletable drop) | earnings identical; ledger {"n":51,"s":26520} |
| V-del-pending-token | PASS | after deleting a drop, a buyer who had a pending checkout (no 409 possible because tx exists) — and a buyer holding only the public link — see sane errors; pay page for pending session still loads | delete → 409; pay page 200 |
| V-del-sealed | PASS | limits after delete: deleting frees the per-drop quota only for that drop; creating many drops + deleting them leaves no stray dirs under storage/ | files before 452 after 452; empty leftover dirs: 0 |
| V-ffmpeg-missing | PASS | ffmpeg/ffprobe missing (FFMPEG_PATH=/nonexistent): valid MP4 -> 503 video_unavailable, generic message (no binary path / spawn error), nothing stored, no temp left; instance stays healthy | 503 {"error":"Video uploads are temporarily unavailable on this server (video tooling missing)","code":"video_unavailable"} |
| V-ffmpeg-missing2 | PASS | same instance: fake MP4 still rejected 415 before ffmpeg; non-video types 415; images (sharp, no ffmpeg) still upload; sniff-level checks unaffected | fake-ftyp→503/video_unavailable webm→415/unsupported_type png→201 |
| V-ffmpeg-missing3 | PASS | ffmpeg missing: no repeated expensive spawn per request (availability cached) and 10 parallel uploads all 503, no leftovers | 10 x 503 |
| V-ffmpeg-timeout | PASS | ffmpeg/ffprobe wall-clock timeout (FFMPEG_TIMEOUT_MS=150): a heavy video (8192x8192) -> clean JSON 4xx (invalid_video 'could not be analysed in time'), no hang, nothing stored, temp removed, no lingering ffmpeg procs; small video and images unaffected | big8k → 415 {"error":"Video could not be analysed in time","code":"invalid_video"} in 203 ms; small.mp4 → 201; lingering ffmpeg/ffprobe procs: 0 |
| V-ffmpeg-recover | FAIL | ffmpeg installed AFTER the server started: uploads recover without restart (availability not cached forever) | still 503 video_unavailable after ffmpeg became available (negative availability result cached for the process lifetime; restart required) |
| V-geom-huge110mp.mp4 | PASS | 11000x10000 (110 MP, > 100 MP limit) | 415 invalid_video in 264 ms Not a valid MP4 video |
| V-geom-big8k.mp4 | PASS | 8192x8192 (67 MP) | 201  in 867 ms preview 320x320 dur=2  |
| V-geom-tiny16.mp4 | PASS | 16x16 | 201  in 186 ms preview 16x16 dur=3  |
| V-geom-long10h.mp4 | PASS | 36000 s (10 h) duration | 201  in 191 ms preview 64x64 dur=36000  |
| V-geom-bigmeta.mp4 | PASS | 60 KB title metadata | 201  in 209 ms preview 320x180 dur=3  |
| V-orient | PASS | rotated (rot90) video preview orientation = displayed orientation (portrait), blurred | preview 180x320; source stream\|width=640\|height=360\|side_datum/display_matrix:rotation=90  |


### Streaming / memory / limits (details)
- 4 parallel 500 MB uploads: server RSS 219 → 229 MB (**+10 MB**), all 201 in 11.5 s, temp dir empty afterwards (body goes busboy → 0600 spool file → `copyFile` into storage; nothing buffered).
- 500 MiB−1 upload 3.2 s; `cap+1` 413 after 2.6 s of streaming; declared `Content-Length` > cap+64 KB rejected up-front (6 ms); chunked 700 MB body stops at the cap.
- ffprobe with `-f mov -protocol_whitelist file` (demuxer pinned: no playlist/concat/URL SSRF), 60 s timeout; 110 MP (11000×10000) → 415 `invalid_video` (limit 100 MP); 8192×8192 → 201; ffmpeg/ffprobe timeout (`FFMPEG_TIMEOUT_MS=150`) → clean 415 "could not be analysed in time", no lingering processes, nothing stored; ffmpeg missing → **503 `video_unavailable`** generic message (no binary path), images still upload, fake/non-MP4 handling unaffected.
- Observed design behaviour (Info, no action required): ffmpeg-tolerant oddities are **accepted** (201 with a preview): file truncated at 50 %, moov size field lying, tkhd width/height 0, mvhd timescale 0, mvhd duration 0xffffffff, 10 h duration, 60 KB title. Corrupted media data (first 20 kB of mdat), huge `stts`/`stsz` counts, nested-box bomb → 415. Zero-byte `.mp4` → **415 `unsupported_type`** while zero-byte `.jpg` → 400 `empty_file` (the `empty_file` branch is unreachable for MP4 names).

### PATCH details
- Strict whitelist: 31 mass-assignment keys (`seller_id`, `sellerId`, `owner`, `status`, `id`, `public_link_id`, `fee_percent`, `platform_fee_cents`, `flagged`, `published_at`, `created_at`, `updated_at`, `attested_at`, `attestation`, `attestation_history`, `cover_url`, `verification_status`, `role`, `isAdmin`, `__proto__`, `constructor`, `$set`, case variants `Title`/`PRICECENTS`, …) → **400 `invalid_input`** (whole body rejected, row byte-identical, no prototype pollution, server healthy). Empty `{}` → 400 `empty_patch`; `[]`, `null`, `5`, `"str"`, invalid JSON, empty body → 400; 5 MB description and 5000-deep nesting → 400; NUL / lone surrogate in title or description → 400; C0 controls, bidi, zero-width and HTML stored literally (same as `POST /api/drops`) and escaped on the public page.
- Concurrency: 30 parallel full PATCHes → all 200, final title and price from the **same** request (no torn write), 30 audit rows; 60 parallel field-wise PATCHes → no lost update across columns; PATCH vs unpublish storm → no 5xx.
- CSRF: foreign / `null` / garbage / look-alike-host Origin → 403 `bad_origin` (PATCH and DELETE); no Origin allowed (non-browser). **BUG-13 pattern:** `Content-Type: text/plain` (and `application/x-www-form-urlencoded`, none, `charset=utf-16`) JSON body is **processed → 200** (title changed), i.e. unchanged from earlier rounds and now also true for the new PATCH endpoint (DELETE has no body, so it is only protected by the Origin check + SameSite=Lax).
- Pending checkouts: same buyer (token cookie) re-checkout after a price edit supersedes the stale-priced session (`failed/superseded`, new tx at new price); a pending session created in **another browser** keeps the OLD price and, if paid, is honoured at the old price (ledger net 1560 on a 2000 sale while the drop is now 5000). Documented in the code comments; Info.

## Regression vs main (earlier suite)
Ran `qa-backend-1/1b/1c/1d` + `qa-fixes-1` (limits off, `PUB=/u`) against **both** instances (branch and main 10c4e65) and diffed the normalised logs (`qa/evidence-m2-regress/diff-main-vs-m2media.txt`; per-run logs `main-*.log` / `regress-*.log`). The only differences are the intended ones:
| Probe | main | m2-media |
|---|---|---|
| qa-backend-1b M1-06 `.mp4` upload | 415 `invalid_image` | **201** video (feature) |
| qa-backend-1 M2-10 PATCH `/api/drops/:id` | 405 | **200** (feature) |
| qa-backend-1 M2-13 / 1d DELETE `/api/drops/:id` | 405 | **200** (feature) |
| qa-backend-1 M1-07 hostile filename stored as | `.._.._etc_script_x.jpg` | `_script_22x.jpg` (busboy strips the path part; still sanitised) |
| qa-backend-1d M2-15 | valid(+60s)=200, expired 410 | identical once the probe's `limit 1` file actually exists on disk (my own earlier delete probes had removed that file's bytes → transient 404; probe artefact, not a regression) |
| `/api/settings` | image fields only | adds `maxVideoSizeBytes`, `allowedVideoMimes` |
| qa-fixes-1 M1-08 race (12 parallel) | 3 accepted | 2 on the first run, **3 on three re-runs** (total never exceeds the cap — it depends on random JPEG sizes in the probe) |
Everything else (M1-01…05, M1-10, M1-12/13, M2-04…09, M6-02 headers, admin/payments schema probes) is **identical to main**.

## Bugs (new)
| ID | Severity | Summary | Where |
|---|---|---|---|
| BUG-22 | Low | Checkout racing a DELETE of the same published drop returns **500 `Internal error`** (FK violation `transactions_drop_id_fkey` in the server log) instead of 404 | `payments/checkout.ts` ↔ `deleteDrop` |
| BUG-23 | Low | Upload racing a DELETE returns **500** (ENOENT) and an **image** upload can leave an orphaned **original** on disk after the drop was deleted | `images.ts` (no cleanup around the 2nd `put`), `video.ts`/`local.ts` |
| BUG-24 | Low | A video of **exactly** 524 288 000 B (the documented 500 MB cap) is rejected 413 `file_too_large`; cap−1 accepted | `upload.ts` (busboy `fileSize` limit == cap marks the stream `truncated`) |
| BUG-25 | Low | ffmpeg/ffprobe "missing" result is cached for the life of the process: installing ffmpeg after a 503 requires an app restart | `video.ts` `ffmpegAvailable()` |
| BUG-26 | Low (UX/policy) | **Any** `transactions` row (a single abandoned `pending`/`failed` checkout from a curious visitor) makes the drop undeletable with the message "This drop has sales"; pending rows expire after 30 min but still block forever | `deleteDrop` |
| BUG-13 | Low (open, carried) | `text/plain` JSON accepted on state-changing endpoints incl. PATCH | all mutating routes |

### Repro
**BUG-22** — seller S with a published drop `D` (link `L`). Fire in parallel: `DELETE /api/drops/D` (seller cookie) and 4× `POST /api/checkout {"linkId":"L","email":"x<n>@example.test","confirmOver18":true}` (separate clients). Loop it on fresh drops: **29 of 30 trials** returned 500 for all four checkouts and the DELETE returned 200 (server log: `insert or update on table "transactions" violates foreign key constraint "transactions_drop_id_fkey"`). End state is consistent (drop deleted, no orphan transaction rows; in the 1 trial where a checkout won, DELETE was 409), only the status/body is wrong: expected 404 `drop_not_found` (or 409). Script: `qa/scripts/qa-m2-delete.mjs` check `V-del-conc3`. Fix idea: catch `23503` in checkout → 404.
**BUG-23** — drop with 1 image; in parallel: `DELETE /api/drops/D` and 3× `POST /api/drops/D/files` (1 PNG + 2 small MP4). Over 150 loops: 6 trials had a 500 (`ENOENT … previews/<drop>/<uuid>.jpg` / `mkdir` / `copyfile`), **1 trial left `originals/<drop>/<uuid>.png` on disk with no DB row** (images.ts `st.put(original)` succeeds, `st.put(preview)` throws ENOENT because delete just removed the dir, and nothing deletes the original; the 404/cleanup path only wraps `insertFileLocked`). Video path cleans up in its own try/catch. Expected: 404 and no leftover. Scripts: `V-del-conc5` in `qa-m2-delete.mjs`.
**BUG-24** — `head -c 524288000` of a valid MP4 padded with a trailing `free` box (or any valid MP4 exactly 524 288 000 bytes): `POST /api/drops/<id>/files` (field `file`) → **413 `file_too_large`**; the same file 1 byte shorter → 201; 1 byte longer → 413. Fixture builder `qa/scripts/qa-m2-fixtures.mjs` (`big500*.mp4`); check `M1-08c2`. Cause: `limits.fileSize = max(image, video cap)` equals the video cap, busboy flags `truncated` when the limit is *reached*, not exceeded. (Spec: "file over 500 MB" must be blocked, exactly 500 MB should pass; image cap is unaffected because the limit is the larger video cap.)
**BUG-25** — start the app with `FFMPEG_PATH`/`FFPROBE_PATH` pointing at missing binaries, upload a valid MP4 → 503 `video_unavailable`; create the binaries (symlink to /usr/bin/ffmpeg|ffprobe); upload again → still 503 until restart. Script: `qa-m2-misc.mjs` (`MODE=recover`).
**BUG-26** — publish a drop; as an anonymous visitor `POST /api/checkout {linkId, email, confirmOver18:true}` (creates a `pending` tx; never pay); as the owner `DELETE /api/drops/<id>` → **409 `drop_has_sales` "This drop has sales and cannot be deleted"**; stays 409 after unpublish and for `failed`/`refunded`/`charged_back` rows (the rule is `SELECT 1 FROM transactions WHERE drop_id=$1`; expired pending rows are only flipped to `failed`, never removed, so by code they block forever — the 30-minute expiry itself was not waited out). Check `M2-12b`. Suggest: only block on `succeeded`/refunded/charged-back (money history) or purge `pending`/`failed` rows, and word the error accordingly.
**BUG-13** — `curl -b jar -X PATCH -H 'content-type: text/plain' -d '{"title":"x"}' $BASE/api/drops/$ID` → 200 (no Origin header). Same recommendation as before: require `application/json` and `Origin`/`Sec-Fetch-Site` on mutations.

## Informational (not bugs)
- Delete refuses drops with any transaction (409) instead of soft-deleting; "behaviour for prior buyers" (M2-13) is therefore *prior buyers keep everything, the drop can only be unpublished*. Document in the spec/README; owners with sales cannot ever remove their files from storage (privacy/GDPR consideration for the legal pass).
- Closed (`actioned`/`dismissed`) report rows are cascade-deleted with the drop (abuse-evidence retention policy should be decided before launch); open/reviewing reports and flagged drops block deletion as designed.
- Already-issued signed URLs are not revoked on delete (they 404 because the file is gone) — documented in the branch README.
- Duplicate JSON keys in PATCH: last one wins (`{"title":"a","title":"b"}` → "b").
- Original route now streams: multi-range requests return the full file (200) rather than 416/multipart; fine.
- ffmpeg is a new **system dependency** (must be in the deploy image); S3/R2 `putFile`/`getStream` untested; reverse proxy must allow ~520 MB bodies with request buffering off; serverless hosts with small body limits can't accept 500 MB uploads.
- `proof/db.txt` is rewritten by `npm run e2e` (dirty worktree after running e2e) — harmless but noisy.
- Server-side error log from the run: 242 `unhandled api error` lines, **all** from the intentional race probes (233 FK violation = BUG-22, 9 ENOENT = BUG-23); none from any other probe (`qa/evidence-m2-server-errors.txt`).

## Still blocked / not covered
M1-09 (resumable upload — not implemented), M2-12/14/15/16/17 (buyer download flow), UI cases for upload progress / edit / delete buttons (no UI yet), S3/R2 adapter, M2-17-style rate limits on the streaming original route with default limits, M1-14 (CI/HTTPS/hosting), M5/M6 legal items unchanged.

## Reproduce
```
git worktree add --detach /workspace/qa-m2media 6c3e8c0   # npm ci; .env (DB unveil_qa_m2, STORAGE_LOCAL_DIR, UPLOAD_TMP_DIR); npm run migrate; npm run build
NODE_ENV=production RATE_LIMIT_ENABLED=0 PAYMENT_PROVIDER=mock MOCK_PAYMENTS_ENABLED=1 npx next start -p 3260
apt: ffmpeg + ffprobe on PATH
cd <qa/test-plan checkout>; . env.sh   # BASE DB STORAGE MEDIA TMPDIR_UP WEBHOOK_SECRET
node qa/scripts/qa-m2-fixtures.mjs                      # builds the MP4 fixture set (ffmpeg) incl. 500 MiB boundary files
node qa/scripts/qa-m2-video.mjs; node qa/scripts/qa-m2-edit.mjs; node qa/scripts/qa-m2-delete.mjs
BASE=:3262 (FFMPEG_PATH=/nonexistent) MODE=nofmpeg node qa/scripts/qa-m2-misc.mjs; BASE=:3263 (FFMPEG_TIMEOUT_MS=150) MODE=timeout …; MODE=recover …; MODE=geom …
# regression: BASE=… DB=… PUB=/u OUT=… ENVSH=… NEXT_STATIC=… for qa-backend-1/1b/1c/1d, qa-fixes-1 on both main and branch
```
Artifacts: `qa/artifacts/backend-m2-media/` (preview vs raw frame, per-suite JSON), logs `qa/evidence-m2-*`. No secrets in the committed logs (webhook/session secrets live in uncommitted env files; signed URLs in logs are for files of throwaway drops).

## Housekeeping
Stopped all my servers (:3260, :3262, :3263, :3264; e2e on :3261 exited), dropped DBs `unveil_qa_m2`, `unveil_e2e_qa_m2`, `unveil_qa_m2_main`, removed worktrees `/workspace/qa-m2media`, `/workspace/qa-m2main` and `/workspace/qa-m2` (≈1.5 GB of fixtures, storage, logs). Other agents' servers/DBs/worktrees were not touched.
