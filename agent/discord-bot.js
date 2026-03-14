/**
 * Octiv Discord Bot — Blackboard <-> Discord bridge
 *
 * Bridges Redis pub/sub events to Discord channels and handles
 * user commands for team monitoring and control.
 *
 * Channels:
 *   #neostarz-live      — real-time bot activity stream (health, movement, actions)
 *   #neostarz-alerts    — threats, failures, reflexion, GoT events
 *   #neostarz-commands  — bot command interface
 *   #neostarz-voice     — agent-to-agent communication (voice channel built-in text chat + TTS)
 *   #meta-shinmoongo    — forum: anonymous agent confessions (Joseon Shinmungo)
 *
 * Commands:
 *   !help             — list all NeoStarz commands
 *   !status           — current team state
 *   !team             — list all agents and roles
 *   !assign <agent> <task> — assign task to agent
 *   !reflexion        — trigger group reflexion
 *   !confess <msg>    — post to the Shinmungo forum
 *   !rc <subcmd>      — remote control (status, test, ac, log, agents)
 */

const { Client, GatewayIntentBits } = require('discord.js');
const { readFileSync } = require('fs');
const { join } = require('path');
const { Blackboard, PREFIX } = require('./blackboard');
const { VoiceManager, Priority } = require('./voice-manager');
const T = require('../config/timeouts');
const { getLogger } = require('./logger');
const log = getLogger();

const {
  REACT_THROTTLE_MS, ROLE_COLORS, DEFAULT_COLOR,
  _roleFromAgentId, _roleColor, _extractAgentId, _resolveAgentId,
  _anonymousHash, formatPos, logSendError,
  buildStatusEmbed, buildHealthEmbed, buildInventoryEmbed,
  buildReactEmbed, buildMilestoneEmbed, buildSkillEmbed,
  buildAlertEmbed, buildShinmungoEmbed, buildChatEmbed,
} = require('./discord-embeds');
const { createCommandHandlers } = require('./discord-commands');

// Load channel config
function loadConfig() {
  try {
    const raw = readFileSync(join(__dirname, '..', 'config', 'discord.json'), 'utf8');
    return JSON.parse(raw);
  } catch {
    return {
      statusChannel: process.env.DISCORD_STATUS_CHANNEL,
      alertsChannel: process.env.DISCORD_ALERTS_CHANNEL,
      commandsChannel: process.env.DISCORD_COMMANDS_CHANNEL,
      forumChannel: process.env.DISCORD_FORUM_CHANNEL
    };
  }
}

class OctivDiscordBot {
  constructor(options = {}, reflexion = null) {
    this.token = options.token || process.env.DISCORD_TOKEN;
    this.guildId = options.guildId || process.env.DISCORD_GUILD_ID;
    this.config = options.config || loadConfig();
    this.redisUrl = options.redisUrl || process.env.BLACKBOARD_REDIS_URL || 'redis://localhost:6380';
    this.reflexion = reflexion;

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
      ]
    });

    this.board = null;
    this.subscriber = null;
    this.channels = {};
    this.voice = null;
    this._reactThrottle = new Map();
    this._forumTagCache = new Map();
    this._reconnectAttempts = 0;

    // Inject command handlers (from discord-commands.js)
    Object.assign(this, createCommandHandlers(this));
  }

  async start() {
    // Connect via Blackboard abstraction
    this.board = new Blackboard(this.redisUrl);
    await this.board.connect();
    this.subscriber = await this.board.createSubscriber();

    // Connect Discord
    await this.client.login(this.token);

    this.client.once('ready', () => {
      log.info('discord', `logged in as ${this.client.user.tag}`);
      this._reconnectAttempts = 0;
      this._resolveChannels();
      this._subscribeBlackboard();
    });

    this.client.on('messageCreate', (msg) => this._handleCommand(msg));
    this.client.on('error', (err) => {
      log.error('discord', 'client error', { error: err.message });
    });
    this.client.on('disconnect', () => {
      log.warn('discord', 'disconnected, attempting reconnect');
      this._reconnect();
    });
  }

  async stop() {
    if (this.voice) this.voice.leave();
    if (this.subscriber) await this.subscriber.disconnect();
    if (this.board) await this.board.disconnect();
    if (this.client) this.client.destroy();
    log.info('discord', 'disconnected');
  }

  async shutdown() { return this.stop(); }

  // --- Reconnection ---

  async _reconnect() {
    if (this._reconnectAttempts >= T.MAX_RECONNECT_ATTEMPTS) {
      log.error('discord', 'max reconnect attempts reached, giving up');
      return;
    }
    this._reconnectAttempts++;
    const delay = Math.min(
      T.BASE_RECONNECT_DELAY_MS * Math.pow(2, this._reconnectAttempts - 1),
      30000
    );
    log.info('discord', `reconnect attempt ${this._reconnectAttempts}/${T.MAX_RECONNECT_ATTEMPTS} in ${delay}ms`);
    await new Promise(r => setTimeout(r, delay));
    try {
      await this.client.login(this.token);
      this._reconnectAttempts = 0;
      log.info('discord', 'reconnected successfully');
    } catch (err) {
      log.error('discord', 'reconnect failed', { error: err.message });
      this._reconnect();
    }
  }

  // --- Channel Resolution ---

  _resolveChannels() {
    const guild = this.client.guilds.cache.get(this.guildId);
    if (!guild) {
      log.error('discord', 'guild not found', { guildId: this.guildId });
      return;
    }

    const resolve = (id, name) => {
      const channel = id ? guild.channels.cache.get(id) : null;
      if (!channel) {
        log.warn('discord', `channel "${name}" not configured or not found`, { channelId: id || 'empty' });
      }
      return channel;
    };

    this.channels.status = resolve(this.config.statusChannel, 'status');
    this.channels.alerts = resolve(this.config.alertsChannel, 'alerts');
    this.channels.commands = resolve(this.config.commandsChannel, 'commands');
    this.channels.forum = resolve(this.config.forumChannel, 'forum');

    // Voice channel — auto-join if configured; also used as chat channel
    if (this.config.voiceChannel) {
      this.channels.chat = resolve(this.config.voiceChannel, 'voice-chat');
      this.voice = new VoiceManager(this.client, this.config.voiceChannel, this.guildId);
      this.voice.join();
    }

    // Cache forum tags for matching confessions to tags (clear stale entries on reconnect)
    if (this.channels.forum && this.channels.forum.availableTags) {
      this._forumTagCache.clear();
      for (const tag of this.channels.forum.availableTags) {
        this._forumTagCache.set(tag.name.toLowerCase(), tag.id);
      }
      log.info('discord', 'forum tags cached', {
        tags: Array.from(this._forumTagCache.keys()).join(', ') || 'none'
      });
    }

    log.info('discord', 'channels resolved', {
      channels: Object.entries(this.channels)
        .map(([k, v]) => `${k}=${v ? v.name : 'N/A'}`)
        .join(', ')
    });
  }

  // --- Blackboard -> Discord Bridge ---

  _subscribeBlackboard() {
    // Agent status updates -> #neostarz-live
    this.subscriber.pSubscribe(PREFIX + 'agent:*:status', (message, channel) => {
      try {
        const data = JSON.parse(message);
        data.agentId = data.agentId || _extractAgentId(channel);
        this._postStatusEmbed(channel, data);
      } catch (err) {
        log.error('discord', 'failed to parse status message', { error: err.message });
      }
    });

    // Agent health updates -> #neostarz-live
    this.subscriber.pSubscribe(PREFIX + 'agent:*:health', (message, channel) => {
      try {
        const data = JSON.parse(message);
        data.agentId = data.agentId || _extractAgentId(channel);
        this._postHealthEmbed(data);
      } catch (err) {
        log.error('discord', 'failed to parse health message', { error: err.message });
      }
    });

    // Agent inventory updates -> #neostarz-live
    this.subscriber.pSubscribe(PREFIX + 'agent:*:inventory', (message, channel) => {
      try {
        const data = JSON.parse(message);
        data.agentId = data.agentId || _extractAgentId(channel);
        this._postInventoryEmbed(data);
      } catch (err) {
        log.error('discord', 'failed to parse inventory message', { error: err.message });
      }
    });

    // Agent ReAct pulses -> #neostarz-live (throttled)
    this.subscriber.pSubscribe(PREFIX + 'agent:*:react', (message, channel) => {
      try {
        const data = JSON.parse(message);
        data.agentId = data.agentId || _extractAgentId(channel);
        this._postReactPulse(data);
      } catch (err) {
        log.error('discord', 'failed to parse react message', { error: err.message });
      }
    });

    // Builder arrived at destination -> #neostarz-live + TTS (low priority)
    this.subscriber.subscribe(PREFIX + 'builder:arrived', (message) => {
      try {
        const data = JSON.parse(message);
        this._postMilestoneEmbed(data);
        this._ttsSpeak(
          `${data.agentId || 'Builder'} arrived at shelter`,
          { role: 'builder', priority: Priority.LOW }
        );
      } catch (err) {
        log.error('discord', 'failed to parse arrived message', { error: err.message });
      }
    });

    // Builder collecting resources -> #neostarz-live
    this.subscriber.subscribe(PREFIX + 'builder:collecting', (message) => {
      try {
        this._postMilestoneEmbed(JSON.parse(message));
      } catch (err) {
        log.error('discord', 'failed to parse collecting message', { error: err.message });
      }
    });

    // Safety threats -> #neostarz-alerts + TTS (high priority)
    this.subscriber.subscribe(PREFIX + 'safety:threat', (message) => {
      try {
        const data = JSON.parse(message);
        this._postAlertEmbed('threat', data);
        this._ttsSpeak(
          `Warning! ${data.threatType || 'Threat'} detected near ${data.agentId || 'unknown'}`,
          { role: 'safety', priority: Priority.HIGH }
        );
      } catch (err) {
        log.error('discord', 'failed to parse threat message', { error: err.message });
      }
    });

    // Reflexion events -> #neostarz-alerts + TTS
    this.subscriber.subscribe(PREFIX + 'leader:reflexion', (message) => {
      try {
        const data = JSON.parse(message);
        this._postAlertEmbed('reflexion', data);
        this._ttsSpeak('Group reflexion triggered', { role: 'leader' });
      } catch (err) {
        log.error('discord', 'failed to parse reflexion message', { error: err.message });
      }
    });

    // Emergency skill creation -> #neostarz-alerts + TTS (high priority)
    this.subscriber.subscribe(PREFIX + 'skills:emergency', (message) => {
      try {
        const data = JSON.parse(message);
        this._postSkillEmbed(data);
        this._ttsSpeak(
          `Emergency skill created: ${data.skillName || data.name || 'unknown'}`,
          { priority: Priority.HIGH }
        );
      } catch (err) {
        log.error('discord', 'failed to parse emergency skill message', { error: err.message });
      }
    });

    // GoT reasoning complete -> #neostarz-alerts
    this.subscriber.subscribe(PREFIX + 'got:reasoning-complete', (message) => {
      try {
        this._postAlertEmbed('got', JSON.parse(message));
      } catch (err) {
        log.error('discord', 'failed to parse GoT message', { error: err.message });
      }
    });

    // Agent confessions -> #meta-shinmoongo (forum threads)
    this.subscriber.pSubscribe(PREFIX + 'agent:*:confess', (message, channel) => {
      if (!this.channels.forum) return;
      try {
        const data = JSON.parse(message);
        data.agentId = data.agentId || _extractAgentId(channel);
        this._postShinmungo(data).catch(err =>
          log.error('discord', 'failed to post shinmungo', { error: err.message })
        );
        // Persist for summarization (limit to last 50)
        this.board.client.lPush(PREFIX + 'confessions:recent', JSON.stringify({ ...data, timestamp: Date.now() }))
          .then(() => this.board.client.lTrim(PREFIX + 'confessions:recent', 0, 49))
          .catch(err => log.error('discord', 'failed to persist confession', { error: err.message }));
      } catch (err) {
        log.error('discord', 'failed to parse confess message', { error: err.message });
      }
    });

    // Agent-to-agent chat -> voice channel text chat + TTS
    this.subscriber.pSubscribe(PREFIX + 'agent:*:chat', (message, channel) => {
      try {
        const data = JSON.parse(message);
        data.agentId = data.agentId || _extractAgentId(channel);
        this._postChatMessage(data);
        this._ttsSpeak(`${data.agentId} says: ${data.message || data.text || ''}`, {
          role: _roleFromAgentId(data.agentId, data.role),
        });
      } catch (err) {
        log.error('discord', 'failed to parse chat message', { error: err.message });
      }
    });

    log.info('discord', 'blackboard subscriptions active');
  }

  // --- TTS Helpers ---

  /**
   * Speak text via VoiceManager if available and not muted.
   * @param {string} text - Text to speak
   * @param {object} [options] - { role?, priority?, voice? }
   */
  _ttsSpeak(text, options = {}) {
    if (!this.voice) return;
    this.voice.speak(text, options);
  }

  // --- Embed Methods ---

  _postStatusEmbed(_channel, data) {
    if (!this.channels.status) return;
    this.channels.status.send({ embeds: [buildStatusEmbed(data)] }).catch(logSendError);
  }

  _postHealthEmbed(data) {
    if (!this.channels.status) return;
    this.channels.status.send({ embeds: [buildHealthEmbed(data)] }).catch(logSendError);
  }

  _postInventoryEmbed(data) {
    if (!this.channels.status) return;
    this.channels.status.send({ embeds: [buildInventoryEmbed(data)] }).catch(logSendError);
  }

  _postReactPulse(data) {
    if (!this.channels.status) return;
    const agentId = data.agentId || 'unknown';
    const now = Date.now();
    const last = this._reactThrottle.get(agentId) || 0;
    if (now - last < REACT_THROTTLE_MS) return;
    this._reactThrottle.set(agentId, now);
    this.channels.status.send({ embeds: [buildReactEmbed(data)] }).catch(logSendError);
  }

  _postMilestoneEmbed(data) {
    if (!this.channels.status) return;
    this.channels.status.send({ embeds: [buildMilestoneEmbed(data)] }).catch(logSendError);
  }

  _postSkillEmbed(data) {
    if (!this.channels.alerts) return;
    this.channels.alerts.send({ embeds: [buildSkillEmbed(data)] }).catch(logSendError);
  }

  _postAlertEmbed(type, data) {
    if (!this.channels.alerts) return;
    const { embed, content } = buildAlertEmbed(type, data);
    this.channels.alerts.send({ content, embeds: [embed] }).catch(logSendError);
  }

  async _postShinmungo(data) {
    if (!this.channels.forum) return;
    const { embed, title, appliedTags } = buildShinmungoEmbed(data, this._forumTagCache);
    try {
      await this.channels.forum.threads.create({
        name: title,
        message: { embeds: [embed] },
        appliedTags,
      });
    } catch (err) {
      logSendError(err);
    }
  }

  _postChatMessage(data) {
    if (!this.channels.chat) return;
    this.channels.chat.send({ embeds: [buildChatEmbed(data)] }).catch(logSendError);
  }

  // Command methods (_handleCommand, _cmd*, _waitForRcResponse)
  // are injected via createCommandHandlers(this) in the constructor.
}

module.exports = { OctivDiscordBot, REACT_THROTTLE_MS, ROLE_COLORS, DEFAULT_COLOR, _anonymousHash, _roleColor, _resolveAgentId, _extractAgentId, loadConfig, logSendError, formatPos };

// --- CLI Entry Point ---

if (require.main === module) {
  const bot = new OctivDiscordBot();
  bot.start().catch((err) => {
    log.error('discord', 'failed to start', { error: err.message });
    process.exit(1);
  });

  process.on('SIGINT', async () => {
    await bot.stop();
    process.exit(0);
  });
}
