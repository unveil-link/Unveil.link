# Unveil QA results — PR #5 `frontend/polish-1` @ 24b631a (round "FE4") — PARTIAL (checkpoint 1)

- Branch tested: `origin/frontend/polish-1` @ `24b631af57e8a5403c62371f4ef2e2cb2913893e`, branched from `origin/main` @ `206320e135dcc90161c76e79e974272f51b3035c` (2 commits ahead). QA base `origin/qa/test-plan` @ 990104a.
- Env: Node 20.19.2, PG 17, headless Chrome 154; throwaway DBs `unveil_qa_fe4` (branch), `unveil_qa_fe4m` (main 206320e), `unveil_e2e_qafe4`; ports 4400–4403 (branch), 4411–4412 (main). This file is rewritten as the run proceeds.

## Checkpoint 1 (FE-12, FE-13, FE-15, headers, copy audit)
| Item | Verdict | Evidence |
|---|---|---|
| FE-12 balance-owed wording | FIXED | `fe4-fe1213.log`: card hint "Below zero. It will be deducted from future earnings."; alert has no "payout" claim; checked on Ned (desktop+mobile) and the never-paid-out chargeback seller (`fe4-cbhold.log`: Balance owed −$5.00, Pending $15.60, Paid out $0) |
| FE-13 alert tone/role | FIXED | alert `role="alert"`, `border-danger/30 bg-danger-soft`, getByRole('alert') finds it; text contrast 16.0:1, icon 4.9:1 |
| FE-15 per-drop Sold/Revenue | FIXED | Maya Spring 21/$252.00 + Studio 6/$140.00 + Travel 4/$32.00 = **$424.00** = API gross−refunded−charged back = raw-ledger per-drop recompute (`fe4-earnings.log`, 115 OK); edge cases `fe4-perdrop-edge.log` 69 OK |
| `Cache-Control: no-store` on /api/earnings | OK | present on 200 for Maya/Ned/Sam/Jo; header matrix main vs branch `fe4-headers-matrix.txt`: only /api/earnings differs |
