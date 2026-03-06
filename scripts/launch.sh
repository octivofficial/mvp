#!/bin/bash
set -e

echo "Octiv Team Launch"
echo "─────────────────────"
echo ""

# Pre-flight checks
node scripts/preflight.js || exit 1

echo ""
echo "Starting agent team..."
echo "Connect Minecraft Java Edition -> localhost:25565"
echo "  (any username, offline-mode server)"
echo ""

# Launch team — exec replaces shell process for clean signal handling
exec node --env-file-if-exists=.env agent/team.js
