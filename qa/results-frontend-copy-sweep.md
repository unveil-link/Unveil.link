# Unveil QA results — PR #6 `frontend/copy-sweep` @ 6c22f05 (round "FE5") — PARTIAL (checkpoint 1)

- Branch tested: `origin/frontend/copy-sweep` @ `6c22f05` on `origin/main` @ `82a68b5` (= merge of PR #5). QA base `origin/qa/test-plan` @ 5042fe4. Throwaway DBs `unveil_qa_fe5` / `unveil_qa_fe5m` / `unveil_e2e_qafe5`, ports 4500–4504 (branch) and 4511–4513 (main). This file is rewritten as the run proceeds.

## Checkpoint 1
| Item | Verdict | Evidence |
|---|---|---|
| FE-14R wording on all pages | FIXED (leftovers acceptable, see final report) | `fe5-copy.log` 95 OK / 0 FAIL, `fe5-copyaudit-copy-sweep.log`, `fe5-grep-ui.txt` |
| FE-16 labels / note / Gross hint | FIXED | `fe5-copy.log` §2 (Maya, Ned, Sam, never-paid seller; desktop + 390 px) |
| alert `role=status`, still red | OK | `fe5-fe1213.log` 34 OK |
| tsc / lint | clean | `fe5-typecheck.log`, `fe5-lint.log` |
| Header diff vs main (41 routes) | identical | `fe5-headers-diff.txt` |
| copy-guard test | **weak: 11 of 18 injected promises bypass it** (incl. the ORIGINAL "Instant delivery" AuthShell line) | `fe5-guard-mutation.log` |
| Seller-side claims | "Payouts straight to your bank", FAQ payout answer, "photos and videos", "identity- and age-verified" are not true today | `fe5-sellerclaims.log` |
