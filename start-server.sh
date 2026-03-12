#!/bin/bash
# Octiv PaperMC Server Start Script
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_DIR="$SCRIPT_DIR/server"
JAR="paper-1.21.11.jar"

# Add OpenJDK 21 to PATH (Homebrew installation)
export PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"

echo "🦞 Starting Octiv PaperMC Server..."
echo "   Port: 25565 | RCON: 25575 | Mode: offline"
echo ""

cd "$SERVER_DIR" && java \
  -Xms2G -Xmx4G \
  -XX:+UseG1GC \
  -XX:+ParallelRefProcEnabled \
  -XX:MaxGCPauseMillis=200 \
  -jar "$JAR" \
  --nogui
