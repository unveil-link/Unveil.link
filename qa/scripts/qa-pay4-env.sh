# source this; starts nothing. Throwaway config for the payments QA worktree.
set -a; . /workspace/qa-pay4/.env; set +a
export NEXT_DIST_DIR=.next-qa
