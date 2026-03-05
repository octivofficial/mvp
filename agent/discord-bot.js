/**
 * Octiv Discord Bot — Blackboard <-> Discord bridge
 *
 * Bridges Redis pub/sub events to Discord channels and handles
 * user commands for team monitoring and control.
 *
 * Channels:
 *   #neostarz-live    — real-time bot activity stream (health, movement, actions)
 *   #neostarz-alerts  — threats, failures, reflexion, GoT events
 *   #neostarz-commands — bot command interface
 *
 * Commands:
 *   !help             — list all NeoStarz commands
 *   !status           — current team state
 *   !team             — list all agents and roles
 *   !assign <agent> <task> — assign task to agent
 *   !reflexion        — trigger group reflexion
 *   !rc <subcmd>      — remote control (status, test, ac, log, agents)
 */

const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { readFileSync } = require('fs');
const { join } = require('path');
const { Blackboard, PREFIX } = require('./blackboard');
const { SafetyAgent } = require('./safety');
const T = require('../config/timeouts');
const { getLogger } = require('./logger');
const log = getLogger();

/** Throttle window for ReAct pulse embeds (ms) */
const REACT_THROTTLE_MS = 30000;

// Load channel config
function loadConfig() {
  try {
    const raw = readFileSync(join(__dirname, '..', 'config', 'discord.json'), 'utf8');
    return JSON.parse(raw);
  } catch {
    return {
      statusChannel: process.env.DISCORD_STATUS_CHANNEL,
      alertsChannel: process.env.DISCORD_ALERTS_CHANNEL,
      commandsChannel: process.env.DISCORD_COMMANDS_CHANNEL
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
        GatewayIntentBits.MessageContent
      ]
    });

    this.board = null;
    this.subscriber = null;
    this.channels = {};
    this._reactThrottle = new Map();
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

    log.info('discord', 'channels resolved', {
      channels: Object.entries(this.channels)
        .map(([k, v]) => `${k}=${v ? v.name : 'N/A'}`)
        .join(', ')
    });
  }

  // --- Blackboard -> Discord Bridge ---

  _subscribeBlackboard() {
    // Agent status updates -> #neostarz-live
    this.subscriber.pSubscribe(PREFIX + '*:status', (message, channel) => {
      try {
        const data = JSON.parse(message);
        this._postStatusEmbed(channel, data);
      } catch (err) {
        log.error('discord', 'failed to parse status message', { error: err.message });
      }
    });

    // Agent health updates -> #neostarz-live
    this.subscriber.pSubscribe(PREFIX + 'agent:*:health', (message) => {
      try {
        this._postHealthEmbed(JSON.parse(message));
      } catch (err) {
        log.error('discord', 'failed to parse health message', { error: err.message });
      }
    });

    // Agent inventory updates -> #neostarz-live
    this.subscriber.pSubscribe(PREFIX + 'agent:*:inventory', (message) => {
      try {
        this._postInventoryEmbed(JSON.parse(message));
      } catch (err) {
        log.error('discord', 'failed to parse inventory message', { error: err.message });
      }
    });

    // Agent ReAct pulses -> #neostarz-live (throttled)
    this.subscriber.pSubscribe(PREFIX + 'agent:*:react', (message) => {
      try {
        this._postReactPulse(JSON.parse(message));
      } catch (err) {
        log.error('discord', 'failed to parse react message', { error: err.message });
      }
    });

    // Builder arrived at destination -> #neostarz-live
    this.subscriber.subscribe(PREFIX + 'builder:arrived', (message) => {
      try {
        this._postMilestoneEmbed(JSON.parse(message));
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

    // Safety threats -> #neostarz-alerts
    this.subscriber.subscribe(PREFIX + 'safety:threat', (message) => {
      try {
        this._postAlertEmbed('threat', JSON.parse(message));
      } catch (err) {
        log.error('discord', 'failed to parse threat message', { error: err.message });
      }
    });

    // Reflexion events -> #neostarz-alerts
    this.subscriber.subscribe(PREFIX + 'leader:reflexion', (message) => {
      try {
        this._postAlertEmbed('reflexion', JSON.parse(message));
      } catch (err) {
        log.error('discord', 'failed to parse reflexion message', { error: err.message });
      }
    });

    // Emergency skill creation -> #neostarz-alerts
    this.subscriber.subscribe(PREFIX + 'skills:emergency', (message) => {
      try {
        this._postSkillEmbed(JSON.parse(message));
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

    log.info('discord', 'blackboard subscriptions active');
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

    if (data.agentId) {
      embed.addFields({ name: 'Agent', value: data.agentId, inline: true });
    }
    if (data.errorType) {
      embed.addFields({ name: 'Error Type', value: data.errorType, inline: true });
    }
    if (data.trigger) {
      embed.addFields({ name: 'Trigger', value: data.trigger, inline: true });
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

    const embed = new EmbedBuilder()
      .setTitle(titles[type] || `Alert: ${type}`)
      .setColor(colors[type] || 0x95a5a6)
      .setDescription(data.description || data.message || JSON.stringify(data))
      .setTimestamp();

    if (data.agentId) embed.addFields({ name: 'Agent', value: data.agentId, inline: true });
    if (data.threatType) embed.addFields({ name: 'Type', value: data.threatType, inline: true });
    if (data.totalSynergies !== undefined) {
      embed.addFields({ name: 'Synergies', value: `${data.totalSynergies}`, inline: true });
    }
    if (data.totalGaps !== undefined) {
      embed.addFields({ name: 'Gaps', value: `${data.totalGaps}`, inline: true });
    }

    const content = isUrgent ? '@here' : '';
    this.channels.alerts.send({ content, embeds: [embed] }).catch(logSendError);
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
      case 'rc':
        return this._cmdRc(msg, args);
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
        { name: '!rc <subcmd>', value: 'Remote control: status, test, ac, log, agents', inline: false }
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

function formatPos(pos) {
  if (!pos) return 'unknown';
  return `${Math.round(pos.x)}, ${Math.round(pos.y)}, ${Math.round(pos.z)}`;
}

function logSendError(err) {
  log.error('discord', 'failed to send message', { error: err.message });
}

module.exports = { OctivDiscordBot, REACT_THROTTLE_MS };

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
