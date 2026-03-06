/**
 * Octiv Pre-flight Check — verify all required services before launch
 * Exit 0 = ready, Exit 1 = blocker found
 */
const net = require('net');
const fs = require('fs');
const path = require('path');

const REDIS_HOST = process.env.BLACKBOARD_REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.BLACKBOARD_REDIS_PORT || '6380', 10);
const MC_HOST = process.env.MC_HOST || 'localhost';
const MC_PORT = parseInt(process.env.MC_PORT || '25565', 10);
const LM_STUDIO_URL = process.env.LM_STUDIO_URL || 'http://localhost:1234';

let hasBlocker = false;

function pass(msg) { console.log(`\x1b[32m✔\x1b[0m ${msg}`); }
function warn(msg) { console.log(`\x1b[33m⚠\x1b[0m ${msg}`); }
function fail(msg) { console.log(`\x1b[31m✘\x1b[0m ${msg}`); hasBlocker = true; }

/** TCP connect check with timeout */
function checkTcp(host, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    const timer = setTimeout(() => { sock.destroy(); resolve(false); }, timeoutMs);
    sock.once('connect', () => { clearTimeout(timer); sock.destroy(); resolve(true); });
    sock.once('error', () => { clearTimeout(timer); sock.destroy(); resolve(false); });
    sock.connect(port, host);
  });
}

/** HTTP GET check with timeout */
function checkHttp(url, timeoutMs = 3000) {
  const mod = url.startsWith('https') ? require('https') : require('http');
  return new Promise((resolve) => {
    const req = mod.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function main() {
  console.log('Octiv Pre-flight Check');
  console.log('─────────────────────');
  console.log('');

  // 1. Redis
  const redisOk = await checkTcp(REDIS_HOST, REDIS_PORT);
  if (redisOk) {
    pass(`Redis reachable (${REDIS_HOST}:${REDIS_PORT})`);
  } else {
    fail(`Redis unreachable (${REDIS_HOST}:${REDIS_PORT}) — start Redis first`);
  }

  // 2. PaperMC
  const mcOk = await checkTcp(MC_HOST, MC_PORT);
  if (mcOk) {
    pass(`PaperMC reachable (${MC_HOST}:${MC_PORT})`);
  } else {
    fail(`PaperMC unreachable (${MC_HOST}:${MC_PORT}) — start server first`);
  }

  // 3. .env + RCON_PASSWORD
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const rconMatch = envContent.match(/^RCON_PASSWORD=(.+)$/m);
    if (rconMatch && rconMatch[1].trim()) {
      pass('.env exists with RCON_PASSWORD');
    } else {
      fail('.env exists but RCON_PASSWORD is empty or missing');
    }
  } else {
    fail('.env file not found — copy .env.example and fill in values');
  }

  // 4. Optional: ANTHROPIC_API_KEY
  if (process.env.ANTHROPIC_API_KEY) {
    pass('ANTHROPIC_API_KEY set (learning pipeline enabled)');
  } else {
    warn('ANTHROPIC_API_KEY not set (learning pipeline will use fallback)');
  }

  // 5. Optional: LM Studio
  const lmOk = await checkHttp(`${LM_STUDIO_URL}/v1/models`);
  if (lmOk) {
    pass(`LM Studio reachable (${LM_STUDIO_URL})`);
  } else {
    warn(`LM Studio not running (${LM_STUDIO_URL}) — skill generation disabled`);
  }

  // 6. Optional: DISCORD_TOKEN
  if (process.env.DISCORD_TOKEN) {
    pass('DISCORD_TOKEN set (Discord bot enabled)');
  } else {
    warn('DISCORD_TOKEN not set (Discord bot disabled)');
  }

  console.log('');
  if (hasBlocker) {
    console.log('\x1b[31mBlocked — fix critical issues above before launching.\x1b[0m');
    process.exit(1);
  } else {
    console.log('\x1b[32mAll critical checks passed. Ready to launch.\x1b[0m');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Pre-flight error:', err.message);
  process.exit(1);
});
