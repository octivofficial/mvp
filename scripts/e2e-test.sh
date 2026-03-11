#!/bin/bash
# E2E Test Script for Octiv MVP
# Tests full agent team in Docker environment

set -e

echo "🚀 Octiv E2E Test Starting..."
echo ""

# Step 1: Start Docker services
echo "📦 Step 1: Starting Docker services (Redis + PaperMC)..."
docker-compose up -d

# Wait for services to be healthy
echo "⏳ Waiting for Redis..."
timeout 30 bash -c 'until docker exec octiv-redis redis-cli ping 2>/dev/null | grep -q PONG; do sleep 1; done'
echo "✅ Redis is ready"

echo "⏳ Waiting for PaperMC (this may take 2-3 minutes on first run)..."
timeout 180 bash -c 'until docker logs octiv-mc 2>&1 | grep -q "Done"; do sleep 5; done'
echo "✅ PaperMC is ready"

# Step 2: Check connection throttle setting
echo ""
echo "🔧 Step 2: Checking bukkit.yml connection-throttle..."
THROTTLE=$(docker exec octiv-mc cat /data/bukkit.yml | grep "connection-throttle" || echo "not found")
echo "Current setting: $THROTTLE"

if echo "$THROTTLE" | grep -q "connection-throttle: 0"; then
  echo "✅ Connection throttle is already set to 0"
else
  echo "⚠️  Setting connection-throttle to 0 (required for multiple bots)..."
  docker exec octiv-mc sed -i 's/connection-throttle: .*/connection-throttle: 0/' /data/bukkit.yml
  echo "🔄 Restarting Minecraft server..."
  docker restart octiv-mc
  sleep 30
  echo "✅ Connection throttle configured"
fi

# Step 3: Run agent team
echo ""
echo "🤖 Step 3: Starting Octiv Agent Team (9 agents)..."
echo "   - Leader x1"
echo "   - Builder x5"
echo "   - Safety x1"
echo "   - Explorer x1"
echo "   - Miner x1"
echo "   - Farmer x1"
echo ""

# Run team.js in background
node agent/team.js &
TEAM_PID=$!

echo "✅ Team started (PID: $TEAM_PID)"
echo ""

# Step 4: Monitor for 60 seconds
echo "📊 Step 4: Monitoring agent activity (60 seconds)..."
echo "Press Ctrl+C to stop early"
echo ""

sleep 60

# Step 5: Check results
echo ""
echo "📈 Step 5: Checking results..."

# Check Redis for agent status
echo "Checking agent registrations..."
AGENT_COUNT=$(docker exec octiv-redis redis-cli HLEN octiv:agents:registry)
echo "✅ Registered agents: $AGENT_COUNT"

# Check AC progress
echo ""
echo "Checking AC progress..."
for i in {1..5}; do
  AC_STATUS=$(docker exec octiv-redis redis-cli HGET octiv:agent:builder-0$i:ac AC-1 2>/dev/null || echo "null")
  if [ "$AC_STATUS" != "null" ]; then
    echo "  builder-0$i AC-1: $AC_STATUS"
  fi
done

# Cleanup
echo ""
echo "🧹 Cleaning up..."
kill $TEAM_PID 2>/dev/null || true
wait $TEAM_PID 2>/dev/null || true

echo ""
echo "✅ E2E Test Complete!"
echo ""
echo "To stop Docker services: docker-compose down"
echo "To view logs: docker-compose logs -f"
