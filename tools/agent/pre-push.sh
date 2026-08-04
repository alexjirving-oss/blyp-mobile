#!/usr/bin/env sh
# Optional local git hook: install with
#   cp tools/agent/pre-push.sh .git/hooks/pre-push && chmod +x .git/hooks/pre-push
set -e
echo "Running verified-forward gate..."
npm run verify:forward
