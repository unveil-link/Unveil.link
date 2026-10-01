# QA push: backend/foundation run 1
What changed: added `qa/results-backend-foundation-1.md` (all 106 plan rows rated, 16 bugs), probe scripts `qa/scripts/*`, raw evidence `qa/evidence-*.log`, artifacts `qa/artifacts/`. No app/source files touched.
How to verify: read the results file; re-run per its "Reproducing this run" section (`npm ci && npm run e2e` gives 23/23; probe scripts target a locally started app).
