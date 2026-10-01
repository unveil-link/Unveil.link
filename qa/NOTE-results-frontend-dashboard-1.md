# QA push: frontend/dashboard (faa38d4, PR #1) run 1
What changed: added `qa/results-frontend-dashboard-1.md` (106 rows re-rated against main@94af2c0 results; 30 PASS / 1 FAIL / 73 BLOCKED incl. M5-16 BLOCKED-ON-LEGAL / 2 NOT RUN), probe scripts `qa/scripts/qa-fe1-*.mjs`, evidence `qa/evidence-fe1-*.log` + `qa/evidence-fe1-suite/`, 45 screenshots in `qa/artifacts/frontend-dashboard/`.
Findings: FE-01 Medium (earnings cards: fees not itemised, "Your 90%" label ≠ 85% net), FE-02..FE-06 Low, BUG-21 Low (pre-existing e2e [#13] flake). No backend/migration/package changes on the branch.
How to verify: read the results file; reproduction block at the bottom.
