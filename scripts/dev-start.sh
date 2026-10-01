#!/usr/bin/env bash
# Starts the production build on a free-ish port (default 3400) using .env. usage: bash scripts/dev-start.sh [port]
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
NODE_ENV=production exec npx next start -p "${1:-3400}"
