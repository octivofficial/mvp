/**
 * Octiv Team Plugins — optional agent initialization (Telegram, Discord, Obsidian, etc.)
 * Extracted from team.js for maintainability.
 */
const path = require('node:path');
const { getLogger } = require('./logger');
const log = getLogger();

let botConfig = {};
try {
  botConfig = require('../config/bot-config.json');
} catch (e) {
  // Config optional
}

/**
 * Initialize optional plugin agents (Telegram, Obsidian, Discord, Crawler, etc.)
 * Each plugin is wrapped in try/catch — failure does not block the core team.
 * @param {object} deps - { board, reflexion }
 * @returns {object} All initialized plugin agents (null if disabled)
 */
async function initPlugins(deps) {
  const { board, reflexion } = deps;
  const plugins = {
    telegramBot: null,
    obsidianAgent: null,
    discordBot: null,
    crawlerAgent: null,
    workspaceAgent: null,
    notebookAgent: null,
    youtubeAgent: null,
    obsidianCliAgent: null,
  };

  // Telegram Development Bot
  if (process.env.ENABLE_TELEGRAM_BOT !== 'false') {
    try {
      const TelegramDevelopmentBot = require('./telegram-bot');
      plugins.telegramBot = new TelegramDevelopmentBot({
        telegramToken: process.env.TELEGRAM_BOT_TOKEN,
        telegramChannelUrl: process.env.TELEGRAM_CHANNEL_URL,
        openClawEndpoint: botConfig.openClawEndpoint || process.env.OPENCLAW_ENDPOINT || 'https://api.dantelabs.com/openclaw/1.0',
        blackboardUrl: botConfig.blackboardUrl || process.env.BLACKBOARD_REDIS_URL || 'redis://localhost:6380',
        authorizedUsers: process.env.TELEGRAM_AUTHORIZED_USERS ? JSON.parse(process.env.TELEGRAM_AUTHORIZED_USERS) : []
      }, board, reflexion);
      plugins.telegramBot.startPolling();
      log.info('team', 'TelegramDevelopmentBot initialized and polling');
    } catch (err) {
      log.warn('team', 'TelegramDevelopmentBot disabled — missing configuration or dependencies', { error: err.message });
    }
  } else {
    log.info('team', 'Telegram bot disabled (ENABLE_TELEGRAM_BOT=false)');
  }

  // Obsidian Organizer
  try {
    const ObsidianOrganizer = require('./obsidian-agent');
    plugins.obsidianAgent = new ObsidianOrganizer({
      vaultPath: botConfig.obsidianVaultPath || process.env.OBSIDIAN_VAULT_PATH || './vault',
      blackboardUrl: botConfig.blackboardUrl || process.env.BLACKBOARD_REDIS_URL || 'redis://localhost:6380'
    }, board, reflexion);
    plugins.obsidianAgent.startWatcher();
    log.info('team', 'ObsidianOrganizer initialized and watching vault');
  } catch (err) {
    log.warn('team', 'ObsidianOrganizer disabled — missing configuration or dependencies', { error: err.message });
  }

  // Discord Bot
  try {
    const { OctivDiscordBot } = require('./discord-bot');
    const discordConfig = require('../config/discord.json');
    plugins.discordBot = new OctivDiscordBot({
      token: process.env.DISCORD_TOKEN,
      guildId: process.env.DISCORD_GUILD_ID,
      config: discordConfig
    }, reflexion);
    await plugins.discordBot.start();
    log.info('team', 'OctivDiscordBot initialized');
  } catch (err) {
    log.warn('team', 'OctivDiscordBot disabled — missing configuration or dependencies', { error: err.message });
  }

  // Crawler Agent (dormant — requires external crawl targets)
  if (process.env.ENABLE_CRAWLER === 'true') {
    try {
      const { CrawlerAgent } = require('./crawler-agent');
      plugins.crawlerAgent = new CrawlerAgent({
        blackboardUrl: botConfig.blackboardUrl || process.env.BLACKBOARD_REDIS_URL
      }, board);
      await plugins.crawlerAgent.init();
      log.info('team', 'CrawlerAgent initialized');
    } catch (err) {
      log.warn('team', 'CrawlerAgent failed to init', { error: err.message });
    }
  } else {
    log.info('team', 'CrawlerAgent skipped (ENABLE_CRAWLER !== true)');
  }

  // Workspace Agent (dormant — requires workspace config)
  if (process.env.ENABLE_WORKSPACE === 'true') {
    try {
      const { WorkspaceAgent } = require('./workspace-agent.js');
      plugins.workspaceAgent = new WorkspaceAgent({
        blackboardUrl: botConfig.blackboardUrl || process.env.BLACKBOARD_REDIS_URL
      }, board);
      await plugins.workspaceAgent.init();
      log.info('team', 'WorkspaceAgent initialized');
    } catch (err) {
      log.warn('team', 'WorkspaceAgent failed to init', { error: err.message });
    }
  } else {
    log.info('team', 'WorkspaceAgent skipped (ENABLE_WORKSPACE !== true)');
  }

  // NotebookLM Agent
  try {
    const { NotebookLMAgent } = require('./notebook-lm-agent.js');
    plugins.notebookAgent = new NotebookLMAgent({}, board, reflexion);
    await plugins.notebookAgent.init();
    log.info('team', 'NotebookLMAgent initialized');
  } catch (err) {
    log.warn('team', 'NotebookLMAgent disabled', { error: err.message });
  }

  // YouTube Agent (dormant — requires YouTube API key)
  if (process.env.ENABLE_YOUTUBE === 'true') {
    try {
      const { YouTubeAgent } = require('./youtube-agent.js');
      plugins.youtubeAgent = new YouTubeAgent({}, board, reflexion);
      await plugins.youtubeAgent.init();
      log.info('team', 'YouTubeAgent initialized');
    } catch (err) {
      log.warn('team', 'YouTubeAgent failed to init', { error: err.message });
    }
  } else {
    log.info('team', 'YouTubeAgent skipped (ENABLE_YOUTUBE !== true)');
  }

  // Obsidian CLI Agent
  try {
    const { ObsidianCLIAgent } = require('./obsidian-cli-agent');
    plugins.obsidianCliAgent = new ObsidianCLIAgent({ vaultPath: process.env.OBSIDIAN_VAULT_PATH || path.resolve('.') }, board);
    await plugins.obsidianCliAgent.init();
    log.info('team', 'Obsidian CLI Agent initialized');
  } catch (err) {
    log.warn('team', 'Obsidian CLI Agent disabled', { error: err.message });
  }

  // Summary: which plugins are active vs disabled
  const active = Object.entries(plugins).filter(([, v]) => v !== null).map(([k]) => k);
  const disabled = Object.entries(plugins).filter(([, v]) => v === null).map(([k]) => k);
  log.info('team', `Plugins summary: ${active.length} active, ${disabled.length} disabled`, {
    active: active.join(', ') || 'none',
    disabled: disabled.join(', ') || 'none',
  });

  return plugins;
}

module.exports = { initPlugins };
