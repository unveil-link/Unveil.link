# Unveil QA results — PR #7 `frontend/copy-accuracy` @ 8681122 (round "FE6") — PARTIAL (checkpoint 1)

Branch `origin/frontend/copy-accuracy` @ 8681122 on main 7014c7e; QA base qa/test-plan. Throwaway DBs `unveil_qa_fe6*`, ports 4600–4603 / 4611–4613. This file is rewritten as the run proceeds.

## Checkpoint 1
| Item | Verdict | Evidence |
|---|---|---|
| tsc / lint / unit | clean / clean / **287/287** (15 files) | `fe6-typecheck.log`, `fe6-lint.log`, `fe6-npm-test.log` (tsc needs a build first for Next's `LayoutProps` type, same as main) |
| FE-17 claim-by-claim | FAQ pay / cost, hold 7 d, $25, fees at sale time, payout paths 404, verification badge, card numbers not stored: **verified** | `fe6-claims.log` |
| **NEW FE-20 (Low-Med)** | **dropzone still says "JPG, PNG, WebP or MP4" and the file picker `accept` offers video/mp4** (not driven by `VIDEO_UPLOAD`); picking an MP4 is then rejected "coming soon" | `FileDropzone.tsx:64,88`; `fe6-mp4ui.log`, `fe6-mp4-dropzone.png`; guard has no `mp4` rule |
| FE-19 | link id = 12 chars base64url of 9 CSPRNG bytes (72 bit); no listing/sitemap/profile; noindex; unlisted claim true | `fe6-claims.log` §F |
| m2-media | **not merged** into main 7014c7e; `VIDEO_UPLOAD=false` matches reality (POST video/mp4 -> 415) | `git merge-base --is-ancestor` |
