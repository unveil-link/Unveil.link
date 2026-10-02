# Unveil QA results — `frontend/dashboard` (PR #1) rebased on main, run 3 — **PARTIAL (checkpoint 1: FE-07..FE-11)**

- **Branch / SHA tested:** `origin/frontend/dashboard` @ `e4b5722306f4af37384ed82a2fb905b7dd4245cf` on `origin/main` @ `10c4e65e53c5a5578c482ceb301affd83e996520`.
- Throwaway DB `unveil_qa_fe3`, ports 4331 (limits off, mock on), 4332 (mock disabled), 4333 (default limits); this file is rewritten as the run proceeds.

## Checkpoint 1 results
| Fix | Verdict | Evidence |
|---|---|---|
| FE-07 dashboard = `getEarningsSummary` | FIXED | `fe3-earnings.log` (85 OK / 0 FAIL): UI == `GET /api/earnings` == raw-ledger recompute for Maya, Ned, Sam, Jo |
| FE-08 negative balance | FIXED | Ned: red "Balance owed" -$46.80 + "You owe $46.80" alert |
| FE-09 X-Robots-Tag | FIXED | `fe3-fixes.log`: `noindex, nofollow` on /terms /privacy /dmca /contact |
| FE-10 legal links | FIXED | all four links on landing, login, signup, forgot, reset, buyer, unavailable page, dashboard shell |
| FE-11 upload 429 | FIXED | "59 minutes", "1 hour 12 minutes", ... (new-drop banner and file-upload path) |
| Money-file diff vs main | none | only `next.config.ts` (+2 lines, X-Robots-Tag rule) |
| Suites | pass | tsc clean, app lint clean, build OK, unit 239/239 |
