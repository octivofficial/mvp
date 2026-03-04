/**
 * Octiv Discord Bot — Blackboard <-> Discord bridge
 *
 * Bridges Redis pub/sub events to Discord channels and handles
 * user commands for team monitoring and control.
 *
 * Channels:
 *   #octiv-status   — real-time team status embeds
 *   #octiv-alerts   — safety threats and failure alerts (@here)
 *   #octiv-commands  — bot command interface
 *
 * Commands:
 *   !status          — current team state
 *   !assign <agent> <task> — assign task to agent
 *   !reflexion       — trigger group reflexion
 *   !team            — list all agents and roles
 */

const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { readFileSync } = require('fs');
const { join } = require('path');
const { Blackboard, PREFIX } = require('./blackboard');
const { SafetyAgent } = require('./safety');
const T = require('../config/timeouts');

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
  }

  async start() {
    // Connect via Blackboard abstraction
    this.board = new Blackboard(this.redisUrl);
    await this.board.connect();
    this.subscriber = await this.board.createSubscriber();

    // Connect Discord
    await this.client.login(this.token);

    this.client.once('ready', () => {
      console.log(`[Discord] Logged in as ${this.client.user.tag}`);
      this._resolveChannels();
      this._subscribeBlackboard();
    });

    this.client.on('messageCreate', (msg) => this._handleCommand(msg));
    this.client.on('error', (err) => console.error('[Discord] Client error:', err.message));
  }

  async stop() {
    if (this.subscriber) await this.subscriber.disconnect();
    if (this.board) await this.board.disconnect();
    if (this.client) this.client.destroy();
    console.log('[Discord] Disconnected');
  }

  // --- Channel Resolution ---

  _resolveChannels() {
    const guild = this.client.guilds.cache.get(this.guildId);
    if (!guild) {
      console.error('[Discord] Guild not found:', this.guildId);
      return;
    }

    const resolve = (id) => id ? guild.channels.cache.get(id) : null;
    this.channels.status = resolve(this.config.statusChannel);
    this.channels.alerts = resolve(this.config.alertsChannel);
    this.channels.commands = resolve(this.config.commandsChannel);

    console.log('[Discord] Channels resolved:',
      Object.entries(this.channels)
        .map(([k, v]) => `${k}=${v ? v.name : 'N/A'}`)
        .join(', ')
    );
  }

  // --- Blackboard -> Discord Bridge ---

  _subscribeBlackboard() {
    // Agent status updates -> #octiv-status
    this.subscriber.pSubscribe(PREFIX + '*:status', (message, channel) => {
      try {
        const data = JSON.parse(message);
        this._postStatusEmbed(channel, data);
      } catch (err) {
        console.error('[Discord] Failed to parse status message:', err.message);
      }
    });

    // Safety threats -> #octiv-alerts
    this.subscriber.subscribe(PREFIX + 'safety:threat', (message) => {
      try {
        const data = JSON.parse(message);
        this._postAlertEmbed('threat', data);
      } catch (err) {
        console.error('[Discord] Failed to parse threat message:', err.message);
      }
    });

    // Reflexion events -> #octiv-alerts
    this.subscriber.subscribe(PREFIX + 'leader:reflexion', (message) => {
      try {
        const data = JSON.parse(message);
        this._postAlertEmbed('reflexion', data);
      } catch (err) {
        console.error('[Discord] Failed to parse reflexion message:', err.message);
      }
    });

    // L-3: Removed dead octiv:ac:* subscription (no publisher exists)

    console.log('[Discord] Blackboard subscriptions active');
  }

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

  _postAlertEmbed(type, data) {
    if (!this.channels.alerts) return;

    const isUrgent = type === 'threat';
    const embed = new EmbedBuilder()
      .setTitle(isUrgent ? 'THREAT DETECTED' : 'Group Reflexion Triggered')
      .setColor(isUrgent ? 0xff0000 : 0xffaa00)
      .setDescription(data.description || data.message || JSON.stringify(data))
      .setTimestamp();

    if (data.agentId) embed.addFields({ name: 'Agent', value: data.agentId, inline: true });
    if (data.threatType) embed.addFields({ name: 'Type', value: data.threatType, inline: true });

    const content = isUrgent ? '@here' : '';
    this.channels.alerts.send({ content, embeds: [embed] }).catch(logSendError);
  }

  // --- Discord Commands ---

  async _handleCommand(msg) {
    if (msg.author.bot) return;
    if (!msg.content.startsWith('!')) return;

    const [cmd, ...args] = msg.content.slice(1).split(/\s+/);

    switch (cmd) {
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
          { id: 'OctivBot_safety-01', role: 'safety' }
        ];
      }

      const embed = new EmbedBuilder()
        .setTitle('Octiv Agent Team')
        .setColor(0x9b59b6)
        .setDescription(agents.map(a => `**${a.id}** — ${a.role}`).join('\n'))
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
  console.error('[Discord] Failed to send message:', err.message);
}

module.exports = { OctivDiscordBot };

// --- CLI Entry Point ---

if (require.main === module) {
  const bot = new OctivDiscordBot();
  bot.start().catch((err) => {
    console.error('[Discord] Failed to start:', err.message);
    process.exit(1);
  });

  process.on('SIGINT', async () => {
    await bot.stop();
    process.exit(0);
  });
}
