#!/usr/bin/env bash
# Runtime / flakiness of the copy guard: 10 sequential runs, 5 shuffled runs, 4 parallel runs, run from another cwd. usage: WT=/workspace/qa-fe8 bash qa-fe8-guard-flaky.sh
cd ${WT:?}
t() { local s=$(date +%s%N); "$@" >/tmp/gf.$$.out 2>&1; local rc=$?; local e=$(date +%s%N); local d=$(grep -oE "Duration +[0-9.]+m?s" /tmp/gf.$$.out | head -1 | tr -s ' '); local n=$(grep -oE "Tests +[0-9]+ passed( \([0-9]+\))?" /tmp/gf.$$.out | head -1 | tr -s ' '); echo "rc=$rc wall=$(( (e - s) / 1000000 ))ms $d | $n"; }
echo "== 10 sequential runs: tests/copy-guard.test.ts + tests/copy-guard-mutation.test.ts"
for i in $(seq 1 10); do t npx vitest run tests/copy-guard.test.ts tests/copy-guard-mutation.test.ts; done
echo "== 5 shuffled runs (--sequence.shuffle)"
for i in $(seq 1 5); do t npx vitest run tests/copy-guard.test.ts tests/copy-guard-mutation.test.ts --sequence.shuffle; done
echo "== 4 parallel runs"
for i in 1 2 3 4; do ( t npx vitest run tests/copy-guard.test.ts tests/copy-guard-mutation.test.ts ) & done; wait
echo "== from another cwd (/tmp) using --root"
cd /tmp && t npx --prefix ${WT} vitest run --root ${WT} tests/copy-guard.test.ts
