/**
 * Octivia Standalone — OpenClaw Gateway entry point
 *
 * Runs: OpenClaw Gateway (Telegram + LLM via openclaw.json config)
 *       + ObsidianAgent (vault watcher — optional)
 *       + WorkspaceAgent (Google Docs/Sheets — optional, requires GOOGLE credentials)
 *       + NotebookAgent (NotebookLM — optional, requires NOTEBOOKLM_* env vars)
 * Does NOT start: mineflayer bots, leader, safety, builders, Discord
 *
 * OpenClaw config: ~/.openclaw/openclaw.json
 * Workspace: .openclaw/workspace/ (SOUL.md, AGENTS.md, skills/)
 *
 * Usage:
 *   node --env-file=.env agent/octivia.js
 *   (or via docker-compose on VM)
 */
'use strict';

const path = require('path');
const os = require('os');
const { Blackboard } = require('./blackboard');
const { getLogger } = require('./logger');

const log = getLogger();

const OPENCLAW_CONFIG = path.join(os.homedir(), '.openclaw', 'openclaw.json');

/**
 * Start Octivia standalone service via OpenClaw Gateway.
 * Accepts optional dependency overrides for testing.
 *
 * @param {object} deps - { board, spawn } — injected in tests
 *   deps.spawn: injectable child_process.spawn for unit tests
 *   deps.board: injectable Blackboard instance
 */
async function startOctivia(deps = {}) {
  const redisUrl = process.env.BLACKBOARD_REDIS_URL || 'redis://localhost:6380';

  log.info('octivia', 'Starting Octivia via OpenClaw gateway', { redis: redisUrl });

  // 1. Blackboard (still used by supporting agents)
  const board = deps.board || new Blackboard(redisUrl);
  if (!deps.board) await board.connect();

  // 2. OpenClaw gateway — handles Telegram + LLM routing
  let telegramBot = null; // gateway handle (API-compatible with legacy code)
  try {
    const spawnFn = deps.spawn || require('child_process').spawn;
    const gatewayProcess = spawnFn('openclaw', ['gateway'], {
      stdio: deps.spawn ? 'pipe' : 'inherit',
      env: { ...process.env },
    });

    // Wrap in telegramBot-compatible interface for backward compatibility
    telegramBot = {
      gateway: gatewayProcess,
      startPolling: () => {
        log.info('octivia', 'OpenClaw gateway already running (no-op startPolling)');
      },
      client: {
        stopPolling: async () => new Promise((resolve) => {
          gatewayProcess.once('close', resolve);
          gatewayProcess.kill('SIGTERM');
        }),
      },
    };
    log.info('octivia', 'OpenClaw gateway started', { config: OPENCLAW_CONFIG });
  } catch (err) {
    log.error('octivia', 'OpenClaw gateway failed to start', { error: err.message });
    process.exit(1);
  }

  // 3. Obsidian vault watcher (optional)
  let obsidianAgent = null;
  try {
    const ObsidianOrganizer = require('./obsidian-agent');
    obsidianAgent = new ObsidianOrganizer({
      vaultPath: process.env.OBSIDIAN_VAULT_PATH || '/app/vault',
      blackboardUrl: redisUrl,
    }, board, null);
    obsidianAgent.startWatcher();
    log.info('octivia', 'Vault watcher started');
  } catch (err) {
    log.warn('octivia', 'Vault watcher unavailable', { error: err.message });
  }

  // 4. WorkspaceAgent — Google Docs/Sheets automation (optional)
  let workspaceAgent = null;
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    try {
      const { WorkspaceAgent } = require('./workspace-agent');
      workspaceAgent = new WorkspaceAgent({
        blackboardUrl: redisUrl,
      }, board);
      await workspaceAgent.init();
      log.info('octivia', 'WorkspaceAgent ready (Google Workspace)');
    } catch (err) {
      log.warn('octivia', 'WorkspaceAgent unavailable', { error: err.message });
    }
  } else {
    log.info('octivia', 'WorkspaceAgent skipped (no GOOGLE_APPLICATION_CREDENTIALS)');
  }

  // 5. NotebookAgent — NotebookLM research (optional)
  let notebookAgent = null;
  try {
    const { NotebookLMAgent } = require('./notebook-lm-agent');
    notebookAgent = new NotebookLMAgent({ blackboardUrl: redisUrl }, board, null);
    await notebookAgent.init();
    log.info('octivia', 'NotebookAgent ready');
  } catch (err) {
    log.warn('octivia', 'NotebookAgent unavailable', { error: err.message });
  }

  log.info('octivia', 'Octivia ready. OpenClaw handling Telegram. Ctrl+C to stop.');

  // Graceful shutdown
  const shutdown = async () => {
    log.info('octivia', 'Shutting down...');
    try {
      if (telegramBot?.client) await telegramBot.client.stopPolling();
    } catch (e) { /* ignore */ }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return { telegramBot, obsidianAgent, workspaceAgent, notebookAgent, board };
}

module.exports = { startOctivia };

// Run directly
if (require.main === module) {
  startOctivia().catch(err => {
    log.error('octivia', 'Fatal error', { error: err.message });
    process.exit(1);
  });
}
