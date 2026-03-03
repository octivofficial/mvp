#!/usr/bin/env node
/**
 * Octiv Full Stack Starter
 * Launches all services: team (agents) + dashboard + MCP server
 * Usage: node start.js [--no-dashboard] [--no-mcp]
 *
 * Standalone services are started in the same process.
 * Press Ctrl+C to stop everything gracefully.
 */
const { DashboardServer } = require('./agent/dashboard');
const { MCPServer } = require('./agent/mcp-server');
const { spawn } = require('child_process');

const args = process.argv.slice(2);
const noDashboard = args.includes('--no-dashboard');
const noMCP = args.includes('--no-mcp');

async function main() {
  console.log('');
  console.log('🚀 Octiv Full Stack Starting');
  console.log('═══════════════════════════════════════');

  const services = [];

  // Start Dashboard (port 3000)
  if (!noDashboard) {
    const dashboard = new DashboardServer();
    await dashboard.start();
    services.push({ name: 'Dashboard', instance: dashboard, stop: () => dashboard.stop() });
    console.log('  ✅ Dashboard:  http://localhost:3000');
  }

  // Start MCP Server (port 3001)
  if (!noMCP) {
    const mcp = new MCPServer();
    await mcp.start();
    services.push({ name: 'MCP', instance: mcp, stop: () => mcp.stop() });
    console.log('  ✅ MCP Server: http://localhost:3001');
  }

  // Start team.js as child process (it manages its own Redis + bots)
  const team = spawn('node', ['agent/team.js'], {
    cwd: __dirname,
    stdio: 'inherit',
    env: { ...process.env },
  });

  console.log('  ✅ Team:       spawning agents...');
  console.log('═══════════════════════════════════════');
  console.log('');

  // Graceful shutdown
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n🛑 Stopping all services (${signal})...`);

    // Kill team process
    team.kill('SIGINT');

    // Stop standalone services
    for (const svc of services) {
      try {
        await svc.stop();
        console.log(`  ✅ ${svc.name} stopped`);
      } catch (err) {
        console.error(`  ❌ ${svc.name} stop error: ${err.message}`);
      }
    }

    // Wait for team to exit, then force after 5s
    const forceTimeout = setTimeout(() => {
      console.log('  ⚠️  Force killing team process');
      team.kill('SIGKILL');
      process.exit(1);
    }, 5000);

    team.on('exit', () => {
      clearTimeout(forceTimeout);
      console.log('  ✅ Team stopped');
      console.log('🏁 All services stopped.');
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  team.on('exit', (code) => {
    if (!shuttingDown) {
      console.error(`[Team] exited with code ${code}`);
      shutdown('team-exit');
    }
  });
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
