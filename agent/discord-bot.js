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

const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { readFileSync } = require('fs');
const { join } = require('path');
const { Blackboard, PREFIX } = require('./blackboard');
const { SafetyAgent } = require('./safety');
const { VoiceManager, Priority } = require('./voice-manager');
const T = require('../config/timeouts');
const { getLogger } = require('./logger');
const log = getLogger();

/** Throttle window for ReAct pulse embeds (ms) */
const REACT_THROTTLE_MS = 30000;

/** Role -> embed color mapping (shared across all embed methods) */
const ROLE_COLORS = {
  leader:   0xe74c3c,
  builder:  0x2ecc71,
  safety:   0xe67e22,
  explorer: 0x3498db,
};
const DEFAULT_COLOR = 0x95a5a6;

/** Extract role name from agent ID string */
function _roleFromAgentId(agentId, explicitRole) {
  return explicitRole || agentId.split('-')[0].replace(/^OctivBot_/, '');
}

/** Get embed color for a role */
function _roleColor(agentId, explicitRole) {
  return ROLE_COLORS[_roleFromAgentId(agentId, explicitRole)] ?? DEFAULT_COLOR;
}

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
  constructor(options = {}) {
    this.token = options.token || process.env.DISCORD_TOKEN;
    this.guildId = options.guildId || process.env.DISCORD_GUILD_ID;
    this.config = options.config || loadConfig();
    this.redisUrl = options.redisUrl || process.env.BLACKBOARD_REDIS_URL || 'redis://localhost:6380';

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

  _postStatusEmbed(channel, data) {
    if (!this.channels.status) return;

    const embed = new EmbedBuilder()
      .setTitle(`Agent Status: ${data.agentId || 'unknown'}`)
      .setColor(data.health > 10 ? 0x00ff00 : 0xff0000)
      .addFields(
        { name: 'Position', value: formatPos(data.position), inline: true },
        { name: 'Health', value: `${data.health || '?'}/20`, inline: true },
        { name: 'Task', value: data.task || 'idle', inline: true }
      )
      .setTimestamp();

    this.channels.status.send({ embeds: [embed] }).catch(logSendError);
  }

  _postHealthEmbed(data) {
    if (!this.channels.status) return;

    const hp = data.health || 0;
    const food = data.food || 0;
    const color = hp > 14 ? 0x2ecc71 : hp > 7 ? 0xf39c12 : 0xe74c3c;
    const hpBar = '\u2764'.repeat(Math.ceil(hp / 2)) + '\uD83D\uDDA4'.repeat(10 - Math.ceil(hp / 2));
    const foodBar = '\uD83C\uDF57'.repeat(Math.ceil(food / 2)) + '\uD83E\uDDB4'.repeat(10 - Math.ceil(food / 2));

    const embed = new EmbedBuilder()
      .setTitle(`${data.agentId || 'unknown'} Health`)
      .setColor(color)
      .addFields(
        { name: 'HP', value: `${hpBar} ${hp}/20`, inline: false },
        { name: 'Food', value: `${foodBar} ${food}/20`, inline: false },
        { name: 'Position', value: formatPos(data.position), inline: true }
      )
      .setTimestamp();

    this.channels.status.send({ embeds: [embed] }).catch(logSendError);
  }

  _postInventoryEmbed(data) {
    if (!this.channels.status) return;

    const items = data.items || [];
    const itemList = items.length > 0
      ? items.map(i => `${i.name} x${i.count}`).join('\n')
      : 'Empty inventory';

    const embed = new EmbedBuilder()
      .setTitle(`${data.agentId || 'unknown'} Inventory`)
      .setColor(0x3498db)
      .setDescription(itemList)
      .setTimestamp();

    if (data.woodCount !== undefined) {
      embed.addFields({ name: 'Wood', value: `${data.woodCount}`, inline: true });
    }
    if (data.tools) {
      embed.addFields({ name: 'Tools', value: data.tools.join(', ') || 'None', inline: true });
    }

    this.channels.status.send({ embeds: [embed] }).catch(logSendError);
  }

  _postReactPulse(data) {
    if (!this.channels.status) return;

    const agentId = data.agentId || 'unknown';
    const now = Date.now();
    const last = this._reactThrottle.get(agentId) || 0;

    if (now - last < REACT_THROTTLE_MS) return;
    this._reactThrottle.set(agentId, now);

    const embed = new EmbedBuilder()
      .setTitle(`${agentId} Activity`)
      .setColor(0x9b59b6)
      .setDescription(`ReAct iteration #${data.iteration || '?'}`)
      .setTimestamp();

    if (data.action) {
      embed.addFields({ name: 'Action', value: data.action, inline: true });
    }

    this.channels.status.send({ embeds: [embed] }).catch(logSendError);
  }

  _postMilestoneEmbed(data) {
    if (!this.channels.status) return;

    const embed = new EmbedBuilder()
      .setTitle(`${data.agentId || 'unknown'} Milestone`)
      .setColor(0xf1c40f)
      .setDescription(data.message || data.description || JSON.stringify(data))
      .setTimestamp();

    if (data.position) {
      embed.addFields({ name: 'Position', value: formatPos(data.position), inline: true });
    }
    if (data.items) {
      embed.addFields({ name: 'Items', value: data.items, inline: true });
    }

    this.channels.status.send({ embeds: [embed] }).catch(logSendError);
  }

  _postSkillEmbed(data) {
    if (!this.channels.alerts) return;

    const embed = new EmbedBuilder()
      .setTitle('New Skill Learned')
      .setColor(0x1abc9c)
      .setDescription(data.skillName || data.name || 'unknown skill')
      .setTimestamp();

    const agentId = data.agentId || data.author;
    if (agentId) {
      embed.addFields({ name: 'Agent', value: agentId, inline: true });
    }
    if (data.errorType || data.failureType) {
      embed.addFields({ name: 'Trigger', value: data.errorType || data.failureType, inline: true });
    }
    if (data.trigger) {
      embed.addFields({ name: 'Source', value: data.trigger, inline: true });
    }

    this.channels.alerts.send({ embeds: [embed] }).catch(logSendError);
  }

  _postAlertEmbed(type, data) {
    if (!this.channels.alerts) return;

    const isUrgent = type === 'threat';
    const titles = {
      threat: 'THREAT DETECTED',
      reflexion: 'Group Reflexion Triggered',
      got: 'GoT Reasoning Complete',
    };
    const colors = {
      threat: 0xff0000,
      reflexion: 0xffaa00,
      got: 0x9b59b6,
    };

    // Build description: prefer explicit message, then threat details, then JSON dump
    let description = data.description || data.message;
    if (!description && type === 'threat' && data.threat) {
      description = `**${data.threat.type}** — ${data.threat.reason || 'unknown cause'}`;
    }
    description = description || JSON.stringify(data);

    const embed = new EmbedBuilder()
      .setTitle(titles[type] || `Alert: ${type}`)
      .setColor(colors[type] || 0x95a5a6)
      .setDescription(description)
      .setTimestamp();

    const agentId = data.agentId || data.author;
    if (agentId) embed.addFields({ name: 'Agent', value: agentId, inline: true });
    const threatType = data.threatType || data.threat?.type;
    if (threatType) embed.addFields({ name: 'Type', value: threatType, inline: true });
    if (data.totalSynergies !== undefined) {
      embed.addFields({ name: 'Synergies', value: `${data.totalSynergies}`, inline: true });
    }
    if (data.totalGaps !== undefined) {
      embed.addFields({ name: 'Gaps', value: `${data.totalGaps}`, inline: true });
    }

    const content = isUrgent ? '@here' : '';
    this.channels.alerts.send({ content, embeds: [embed] }).catch(logSendError);
  }

  /**
   * Post a confession to the Shinmungo forum as a new thread.
   * Agents publish to octiv:agent:<id>:confess with:
   *   { title, message, tag?, anonymous? }
   */
  async _postShinmungo(data) {
    if (!this.channels.forum) return;

    const agent = data.agentId || 'unknown';
    const anonymous = data.anonymous === true;
    const displayName = anonymous ? `Agent #${_anonymousHash(agent)}` : agent;
    const color = anonymous ? DEFAULT_COLOR : _roleColor(agent, data.role);
    const body = (data.message || data.text || '...').slice(0, 4096);

    const embed = new EmbedBuilder()
      .setAuthor({ name: displayName })
      .setColor(color)
      .setDescription(body)
      .setTimestamp();

    if (data.context) {
      embed.addFields({ name: 'Context', value: data.context, inline: false });
    }
    if (!anonymous && data.position) {
      embed.addFields({ name: 'Position', value: formatPos(data.position), inline: true });
    }
    if (data.mood) {
      embed.setFooter({ text: `mood: ${data.mood}` });
    }

    // Match tag name to cached tag ID (single lookup)
    const appliedTags = [];
    const tagId = data.tag ? this._forumTagCache.get(data.tag.toLowerCase()) : undefined;
    if (tagId !== undefined) appliedTags.push(tagId);

    const title = data.title || `${displayName}'s confession`;

    try {
      await this.channels.forum.threads.create({
        name: title.slice(0, 100),
        message: { embeds: [embed] },
        appliedTags,
      });
    } catch (err) {
      logSendError(err);
    }
  }

  _postChatMessage(data) {
    if (!this.channels.chat) return;

    const agent = data.agentId || 'unknown';
    const color = _roleColor(agent, data.role);

    const embed = new EmbedBuilder()
      .setAuthor({ name: agent })
      .setColor(color)
      .setDescription(data.message || data.text || '...')
      .setTimestamp();

    if (data.to) {
      embed.setFooter({ text: `to ${data.to}` });
    }

    this.channels.chat.send({ embeds: [embed] }).catch(logSendError);
  }

  // --- Discord Commands ---

  async _handleCommand(msg) {
    if (msg.author.bot) return;
    if (!msg.content.startsWith('!')) return;

    const [cmd, ...args] = msg.content.slice(1).split(/\s+/);

    switch (cmd) {
      case 'help':
        return this._cmdHelp(msg);
      case 'status':
        return this._cmdStatus(msg);
      case 'assign':
        return this._cmdAssign(msg, args);
      case 'reflexion':
        return this._cmdReflexion(msg);
      case 'team':
        return this._cmdTeam(msg);
      case 'confess':
        return this._cmdConfess(msg, args);
      case 'rc':
        return this._cmdRc(msg, args);
      case 'voice':
        return this._cmdVoice(msg, args);
      default:
        return; // ignore unknown commands
    }
  }

  async _cmdHelp(msg) {
    const embed = new EmbedBuilder()
      .setTitle('NeoStarz Commands')
      .setColor(0x3498db)
      .setDescription('Control and monitor the Octiv bot team')
      .addFields(
        { name: '!help', value: 'Show this help message', inline: false },
        { name: '!status', value: 'Current team state (HP, tasks, positions)', inline: false },
        { name: '!team', value: 'List all agents and their roles', inline: false },
        { name: '!assign <agent> <task>', value: 'Assign a task to an agent', inline: false },
        { name: '!reflexion', value: 'Trigger group reflexion cycle', inline: false },
        { name: '!rc <subcmd>', value: 'Remote control: status, test, ac, log, agents', inline: false },
        { name: '!confess <message>', value: 'Post to the Shinmungo forum', inline: false },
        { name: '!voice <subcmd>', value: 'Voice: join, leave, say, mute, status', inline: false }
      )
      .setTimestamp();

    msg.reply({ embeds: [embed] });
  }

  async _cmdStatus(msg) {
    try {
      // Get agent registry and build status from Blackboard
      const registry = await this.board.getHash('agents:registry');
      const statuses = [];

      if (registry && Object.keys(registry).length > 0) {
        for (const id of Object.keys(registry)) {
          const status = await this.board.get(`agent:${id}:status`);
          if (status) statuses.push(status);
        }
      }

      if (statuses.length === 0) {
        return msg.reply('No agents currently online.');
      }

      const embed = new EmbedBuilder()
        .setTitle('Octiv Team Status')
        .setColor(0x3498db)
        .setTimestamp();

      for (const s of statuses) {
        embed.addFields({
          name: s.agentId || 'unknown',
          value: `HP: ${s.health || '?'}/20 | Task: ${s.task || 'idle'} | Pos: ${formatPos(s.position)}`,
          inline: false
        });
      }

      msg.reply({ embeds: [embed] });
    } catch (err) {
      msg.reply(`Error fetching status: ${err.message}`);
    }
  }

  async _cmdAssign(msg, args) {
    if (args.length < 2) {
      return msg.reply('Usage: `!assign <agentId> <task>`');
    }

    const [agentId, ...taskParts] = args;
    const task = taskParts.join(' ');

    // Sanitize user input against prompt injection
    const check = SafetyAgent.filterPromptInjection(task);
    if (!check.safe) {
      return msg.reply(`Blocked: input rejected (${check.reason})`);
    }

    try {
      await this.board.publish('commands:assign', {
        author: 'discord-bot',
        agentId,
        task: check.sanitized,
      });
      msg.reply(`Task "${check.sanitized}" assigned to ${agentId}`);
    } catch (err) {
      msg.reply(`Error assigning task: ${err.message}`);
    }
  }

  async _cmdReflexion(msg) {
    try {
      await this.board.publish('commands:reflexion', {
        author: 'discord-bot',
        trigger: 'manual',
        requestedBy: msg.author.tag,
      });
      msg.reply('Group Reflexion triggered.');
    } catch (err) {
      msg.reply(`Error triggering reflexion: ${err.message}`);
    }
  }

  async _cmdConfess(msg, args) {
    if (args.length === 0) {
      return msg.reply('Usage: `!confess <message>` — Post to the Shinmungo forum');
    }
    const text = args.join(' ');
    const check = SafetyAgent.filterPromptInjection(text);
    if (!check.safe) {
      return msg.reply(`Blocked: input rejected (${check.reason})`);
    }
    await this._postShinmungo({
      agentId: `human:${msg.author.username}`,
      title: `${msg.author.username}'s voice`,
      message: check.sanitized,
      tag: 'thoughts',
    });
    await msg.reply('Your voice has been heard at the Shinmungo.');
  }

  async _cmdTeam(msg) {
    try {
      const registryHash = await this.board.getHash('agents:registry');
      let agents;

      if (registryHash && Object.keys(registryHash).length > 0) {
        agents = Object.entries(registryHash).map(([id, raw]) => {
          try {
            const data = JSON.parse(raw);
            return { id, role: data.role || 'unknown' };
          } catch {
            return { id, role: 'unknown' };
          }
        });
      } else {
        agents = [
          { id: 'OctivBot_leader-01', role: 'leader' },
          { id: 'OctivBot_builder-01', role: 'builder' },
          { id: 'OctivBot_builder-02', role: 'builder' },
          { id: 'OctivBot_builder-03', role: 'builder' },
          { id: 'OctivBot_safety-01', role: 'safety' },
          { id: 'OctivBot_explorer-01', role: 'explorer' }
        ];
      }

      const embed = new EmbedBuilder()
        .setTitle('Octiv Agent Team')
        .setColor(0x9b59b6)
        .setDescription(agents.map(a => `**${a.id}** \u2014 ${a.role}`).join('\n'))
        .setTimestamp();

      msg.reply({ embeds: [embed] });
    } catch (err) {
      msg.reply(`Error fetching team: ${err.message}`);
    }
  }

  // --- Voice Commands ---

  async _cmdVoice(msg, args) {
    const subcmd = (args[0] || '').toLowerCase();
    const supported = ['join', 'leave', 'say', 'mute', 'status'];

    if (!subcmd || !supported.includes(subcmd)) {
      return msg.reply(`Usage: \`!voice <${supported.join('|')}>\``);
    }

    switch (subcmd) {
      case 'join': {
        if (!this.config.voiceChannel) {
          return msg.reply('Voice channel not configured. Set `voiceChannel` in config/discord.json.');
        }
        if (!this.voice) {
          this.voice = new VoiceManager(this.client, this.config.voiceChannel, this.guildId);
        }
        const conn = this.voice.join();
        return msg.reply(conn ? 'Joined voice channel.' : 'Failed to join voice channel.');
      }
      case 'leave': {
        if (!this.voice) return msg.reply('Not in a voice channel.');
        this.voice.leave();
        this.voice = null;
        return msg.reply('Left voice channel.');
      }
      case 'say': {
        const text = args.slice(1).join(' ');
        if (!text) return msg.reply('Usage: `!voice say <text>`');

        const check = SafetyAgent.filterPromptInjection(text);
        if (!check.safe) {
          return msg.reply(`Blocked: input rejected (${check.reason})`);
        }

        if (!this.voice) {
          if (!this.config.voiceChannel) {
            return msg.reply('Voice channel not configured.');
          }
          this.voice = new VoiceManager(this.client, this.config.voiceChannel, this.guildId);
        }
        const queued = this.voice.speak(check.sanitized);
        return msg.reply(queued ? `Speaking: "${check.sanitized}"` : 'Failed to queue TTS message.');
      }
      case 'mute': {
        if (!this.voice) return msg.reply('Not in a voice channel.');
        const muted = this.voice.toggleMute();
        return msg.reply(muted ? 'Auto-TTS muted.' : 'Auto-TTS unmuted.');
      }
      case 'status': {
        const connected = this.voice?.isConnected() || false;
        const muted = this.voice?.isMuted() || false;
        const queueLen = this.voice?.queueLength() || 0;
        const embed = new EmbedBuilder()
          .setTitle('Voice Status')
          .setColor(connected ? 0x2ecc71 : 0xe74c3c)
          .addFields(
            { name: 'Connected', value: connected ? 'Yes' : 'No', inline: true },
            { name: 'Muted', value: muted ? 'Yes' : 'No', inline: true },
            { name: 'Queue', value: `${queueLen}`, inline: true }
          )
          .setTimestamp();
        return msg.reply({ embeds: [embed] });
      }
      default:
        return;
    }
  }

  // --- Remote Control ---

  async _cmdRc(msg, args) {
    const subcmd = (args[0] || 'status').toLowerCase();
    const supported = ['status', 'test', 'ac', 'log', 'agents'];

    if (!supported.includes(subcmd)) {
      return msg.reply(`Unknown RC subcommand: \`${subcmd}\`. Available: ${supported.join(', ')}`);
    }

    try {
      const requestId = `rc:response:${Date.now()}`;

      // Publish RC command to Blackboard
      await this.board.publish(`rc:cmd:${subcmd}`, {
        author: 'discord-bot',
        requestId,
        subcmd,
        requestedBy: msg.author?.tag || 'unknown',
      });

      // Wait for response with timeout
      const response = await this._waitForRcResponse(requestId, T.RC_RESPONSE_TIMEOUT_MS);

      if (!response) {
        return msg.reply(`RC \`${subcmd}\`: no response (timeout ${T.RC_RESPONSE_TIMEOUT_MS / 1000}s). Is the team running?`);
      }

      const embed = new EmbedBuilder()
        .setTitle(`RC: ${subcmd}`)
        .setColor(0x2ecc71)
        .setDescription(typeof response.data === 'string'
          ? response.data
          : '```json\n' + JSON.stringify(response.data, null, 2).slice(0, 1900) + '\n```')
        .setTimestamp();

      msg.reply({ embeds: [embed] });
    } catch (err) {
      msg.reply(`RC error: ${err.message}`);
    }
  }

  async _waitForRcResponse(requestId, timeoutMs) {
    return new Promise(async (resolve) => {
      const timeout = setTimeout(() => {
        if (sub) sub.disconnect().catch(() => {});
        resolve(null);
      }, timeoutMs);

      let sub;
      try {
        sub = await this.board.createSubscriber();
        await sub.subscribe(PREFIX + requestId, (message) => {
          clearTimeout(timeout);
          sub.disconnect().catch(() => {});
          try {
            resolve(JSON.parse(message));
          } catch {
            resolve({ data: message });
          }
        });
      } catch {
        clearTimeout(timeout);
        resolve(null);
      }
    });
  }
}

// --- Helpers ---

/** Extract agent ID from channel like "octiv:agent:builder-01:react" */
function _extractAgentId(channel) {
  const parts = (channel || '').split(':');
  // Pattern: PREFIX + agent:<id>:<event>
  const agentIdx = parts.indexOf('agent');
  return (agentIdx >= 0 && parts[agentIdx + 1]) ? parts[agentIdx + 1] : 'unknown';
}

/** Generate a stable anonymous number from agent ID (1-99) */
function _anonymousHash(agentId) {
  let hash = 0;
  for (let i = 0; i < agentId.length; i++) {
    hash = ((hash << 5) - hash) + agentId.charCodeAt(i);
    hash |= 0;
  }
  return (Math.abs(hash) % 99) + 1;
}

function formatPos(pos) {
  if (!pos) return 'unknown';
  return `${Math.round(pos.x)}, ${Math.round(pos.y)}, ${Math.round(pos.z)}`;
}

function logSendError(err) {
  log.error('discord', 'failed to send message', { error: err.message });
}

module.exports = { OctivDiscordBot, REACT_THROTTLE_MS, ROLE_COLORS, DEFAULT_COLOR, _anonymousHash, _roleColor };

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
