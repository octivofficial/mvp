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
const { createClient } = require('redis');
const { readFileSync } = require('fs');
const { join } = require('path');
const { SafetyAgent } = require('./safety');

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

    this.redis = null;
    this.subscriber = null;
    this.channels = {};
  }

  async start() {
    // Connect Redis
    this.redis = createClient({ url: this.redisUrl });
    this.subscriber = this.redis.duplicate();

    await this.redis.connect();
    await this.subscriber.connect();

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
    if (this.subscriber) await this.subscriber.quit();
    if (this.redis) await this.redis.quit();
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
    this.subscriber.pSubscribe('octiv:*:status', (message, channel) => {
      try {
        const data = JSON.parse(message);
        this._postStatusEmbed(channel, data);
      } catch (err) {
        console.error('[Discord] Failed to parse status message:', err.message);
      }
    });

    // Safety threats -> #octiv-alerts
    this.subscriber.subscribe('octiv:safety:threat', (message) => {
      try {
        const data = JSON.parse(message);
        this._postAlertEmbed('threat', data);
      } catch (err) {
        console.error('[Discord] Failed to parse threat message:', err.message);
      }
    });

    // Reflexion events -> #octiv-alerts
    this.subscriber.subscribe('octiv:leader:reflexion', (message) => {
      try {
        const data = JSON.parse(message);
        this._postAlertEmbed('reflexion', data);
      } catch (err) {
        console.error('[Discord] Failed to parse reflexion message:', err.message);
      }
    });

    // AC completion -> #octiv-status
    this.subscriber.pSubscribe('octiv:ac:*', (message, channel) => {
      try {
        const data = JSON.parse(message);
        this._postACEmbed(channel, data);
      } catch (err) {
        console.error('[Discord] Failed to parse AC message:', err.message);
      }
    });

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

  _postACEmbed(channel, data) {
    if (!this.channels.status) return;

    const embed = new EmbedBuilder()
      .setTitle(`AC Update: ${data.ac || channel}`)
      .setColor(data.status === 'done' ? 0x00ff00 : 0x3498db)
      .addFields(
        { name: 'Status', value: data.status || 'unknown', inline: true },
        { name: 'Agent', value: data.agentId || 'unknown', inline: true }
      )
      .setTimestamp();

    this.channels.status.send({ embeds: [embed] }).catch(logSendError);
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
      default:
        return; // ignore unknown commands
    }
  }

  async _cmdStatus(msg) {
    try {
      // Use SCAN instead of KEYS to avoid blocking Redis in production
      const statuses = [];
      for await (const key of this.redis.scanIterator({ MATCH: 'octiv:agent:*:status', COUNT: 50 })) {
        const raw = await this.redis.get(key);
        if (raw) {
          try {
            statuses.push(JSON.parse(raw));
          } catch { /* skip malformed */ }
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
      await this.redis.publish('octiv:commands:assign', JSON.stringify({ agentId, task: check.sanitized }));
      msg.reply(`Task "${check.sanitized}" assigned to ${agentId}`);
    } catch (err) {
      msg.reply(`Error assigning task: ${err.message}`);
    }
  }

  async _cmdReflexion(msg) {
    try {
      await this.redis.publish('octiv:commands:reflexion', JSON.stringify({
        trigger: 'manual',
        requestedBy: msg.author.tag
      }));
      msg.reply('Group Reflexion triggered.');
    } catch (err) {
      msg.reply(`Error triggering reflexion: ${err.message}`);
    }
  }

  async _cmdTeam(msg) {
    try {
      // Registry is stored as a Redis Hash (hSet), so use hGetAll
      const registryHash = await this.redis.hGetAll('octiv:agents:registry');
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
