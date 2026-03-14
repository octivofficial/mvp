/**
 * Discord Command Handlers — factory that creates command methods bound to bot instance.
 * Extracted from discord-bot.js for maintainability.
 *
 * Usage:
 *   const handlers = createCommandHandlers(bot);
 *   Object.assign(bot, handlers);
 */
const { EmbedBuilder } = require('discord.js');
const { PREFIX } = require('./blackboard');
const { SafetyAgent } = require('./safety');
const { VoiceManager } = require('./voice-manager');
const T = require('../config/timeouts');
const { getLogger } = require('./logger');
const log = getLogger();

const { formatPos } = require('./discord-embeds');

/**
 * Create command handler methods bound to a bot instance.
 * @param {import('./discord-bot').OctivDiscordBot} bot
 * @returns {object} Methods to assign onto the bot instance
 */
function createCommandHandlers(bot) {
  return {
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
        case 'summarize':
          return this._cmdSummarize(msg, args);
        default:
          return; // ignore unknown commands
      }
    },

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
          { name: '!summarize', value: 'Summarize recent status/confessions using local intelligence', inline: false },
          { name: '!voice <subcmd>', value: 'Voice: join, leave, say, mute, status', inline: false }
        )
        .setTimestamp();

      msg.reply({ embeds: [embed] });
    },

    async _cmdStatus(msg) {
      try {
        const registry = await bot.board.getHash('agents:registry');
        const statuses = [];

        if (registry && Object.keys(registry).length > 0) {
          for (const id of Object.keys(registry)) {
            const status = await bot.board.get(`agent:${id}:status`);
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
    },

    async _cmdAssign(msg, args) {
      if (args.length < 2) {
        return msg.reply('Usage: `!assign <agentId> <task>`');
      }

      const [agentId, ...taskParts] = args;
      const task = taskParts.join(' ');

      const check = SafetyAgent.filterPromptInjection(task);
      if (!check.safe) {
        return msg.reply(`Blocked: input rejected (${check.reason})`);
      }

      try {
        await bot.board.publish('commands:assign', {
          author: 'discord-bot',
          agentId,
          task: check.sanitized,
        });
        msg.reply(`Task "${check.sanitized}" assigned to ${agentId}`);
      } catch (err) {
        msg.reply(`Error assigning task: ${err.message}`);
      }
    },

    async _cmdReflexion(msg) {
      try {
        await bot.board.publish('commands:reflexion', {
          author: 'discord-bot',
          trigger: 'manual',
          requestedBy: msg.author.tag,
        });
        msg.reply('Group Reflexion triggered.');
      } catch (err) {
        msg.reply(`Error triggering reflexion: ${err.message}`);
      }
    },

    async _cmdConfess(msg, args) {
      if (args.length === 0) {
        return msg.reply('Usage: `!confess <message>` — Post to the Shinmungo forum');
      }
      const text = args.join(' ');
      const check = SafetyAgent.filterPromptInjection(text);
      if (!check.safe) {
        return msg.reply(`Blocked: input rejected (${check.reason})`);
      }
      await bot._postShinmungo({
        agentId: `human:${msg.author.username}`,
        title: `${msg.author.username}'s voice`,
        message: check.sanitized,
        tag: 'thoughts',
      });
      await msg.reply('Your voice has been heard at the Shinmungo.');
    },

    async _cmdTeam(msg) {
      try {
        const registryHash = await bot.board.getHash('agents:registry');
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
    },

    async _cmdVoice(msg, args) {
      const subcmd = (args[0] || '').toLowerCase();
      const supported = ['join', 'leave', 'say', 'mute', 'status'];

      if (!subcmd || !supported.includes(subcmd)) {
        return msg.reply(`Usage: \`!voice <${supported.join('|')}>\``);
      }

      switch (subcmd) {
        case 'join': {
          if (!bot.config.voiceChannel) {
            return msg.reply('Voice channel not configured. Set `voiceChannel` in config/discord.json.');
          }
          if (!bot.voice) {
            bot.voice = new VoiceManager(bot.client, bot.config.voiceChannel, bot.guildId);
          }
          const conn = bot.voice.join();
          return msg.reply(conn ? 'Joined voice channel.' : 'Failed to join voice channel.');
        }
        case 'leave': {
          if (!bot.voice) return msg.reply('Not in a voice channel.');
          bot.voice.leave();
          bot.voice = null;
          return msg.reply('Left voice channel.');
        }
        case 'say': {
          const text = args.slice(1).join(' ');
          if (!text) return msg.reply('Usage: `!voice say <text>`');

          const check = SafetyAgent.filterPromptInjection(text);
          if (!check.safe) {
            return msg.reply(`Blocked: input rejected (${check.reason})`);
          }

          if (!bot.voice) {
            if (!bot.config.voiceChannel) {
              return msg.reply('Voice channel not configured.');
            }
            bot.voice = new VoiceManager(bot.client, bot.config.voiceChannel, bot.guildId);
          }
          const queued = bot.voice.speak(check.sanitized);
          return msg.reply(queued ? `Speaking: "${check.sanitized}"` : 'Failed to queue TTS message.');
        }
        case 'mute': {
          if (!bot.voice) return msg.reply('Not in a voice channel.');
          const muted = bot.voice.toggleMute();
          return msg.reply(muted ? 'Auto-TTS muted.' : 'Auto-TTS unmuted.');
        }
        case 'status': {
          const connected = bot.voice?.isConnected() || false;
          const isMuted = bot.voice?.isMuted() || false;
          const queueLen = bot.voice?.queueLength() || 0;
          const embed = new EmbedBuilder()
            .setTitle('Voice Status')
            .setColor(connected ? 0x2ecc71 : 0xe74c3c)
            .addFields(
              { name: 'Connected', value: connected ? 'Yes' : 'No', inline: true },
              { name: 'Muted', value: isMuted ? 'Yes' : 'No', inline: true },
              { name: 'Queue', value: `${queueLen}`, inline: true }
            )
            .setTimestamp();
          return msg.reply({ embeds: [embed] });
        }
        default:
          return;
      }
    },

    async _cmdSummarize(msg) {
      if (!bot.reflexion) {
        return msg.reply('Summarization not available: Reflexion engine not linked.');
      }

      try {
        const registry = await bot.board.getHash('agents:registry');
        const statuses = [];
        if (registry) {
          for (const id of Object.keys(registry)) {
            const s = await bot.board.get(`agent:${id}:status`);
            if (s) statuses.push(`${s.agentId}: ${s.status} (HP: ${s.health})`);
          }
        }

        const confessionsRaw = await bot.board.client.lRange(PREFIX + 'confessions:recent', 0, 9);
        const confessions = confessionsRaw.map(r => {
          try {
            const d = JSON.parse(r);
            return `- [${d.agentId}]: ${d.message || d.text}`;
          } catch { return null; }
        }).filter(Boolean);

        const prompt = [
          '### TASK: TEAM INTELLIGENCE SUMMARY ###',
          'Analyze the recent activity and anonymous confessions below.',
          'Group confessions by sentiment and provide a 3-line actionable summary.',
          '',
          '**AGENT STATUSES:**',
          statuses.join('\n') || 'None online.',
          '',
          '**ANONYMOUS CONFESSIONS (SHINMUNGO):**',
          confessions.join('\n') || 'No recent confessions.',
          '',
          'Summary (3 lines max):'
        ].join('\n');

        const summary = await bot.reflexion.callLLM(prompt, 'local');

        const embed = new EmbedBuilder()
          .setTitle('Team Summary (Local Intelligence)')
          .setColor(0x1abc9c)
          .setDescription(summary || 'Could not generate summary.')
          .setTimestamp();

        msg.reply({ embeds: [embed] });
      } catch (err) {
        msg.reply(`Summarization error: ${err.message}`);
      }
    },

    async _cmdRc(msg, args) {
      const subcmd = (args[0] || 'status').toLowerCase();
      const supported = ['status', 'test', 'ac', 'log', 'agents'];

      if (!supported.includes(subcmd)) {
        return msg.reply(`Unknown RC subcommand: \`${subcmd}\`. Available: ${supported.join(', ')}`);
      }

      try {
        const requestId = `rc:response:${Date.now()}`;

        await bot.board.publish(`rc:cmd:${subcmd}`, {
          author: 'discord-bot',
          requestId,
          subcmd,
          requestedBy: msg.author?.tag || 'unknown',
        });

        const response = await bot._waitForRcResponse(requestId, T.RC_RESPONSE_TIMEOUT_MS);

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
    },

    async _waitForRcResponse(requestId, timeoutMs) {
      return new Promise(async (resolve) => {
        const timeout = setTimeout(() => {
          if (sub) sub.disconnect().catch(e => log.debug('discord-bot', 'rc subscriber disconnect error', { error: e?.message }));
          resolve(null);
        }, timeoutMs);

        let sub;
        try {
          sub = await bot.board.createSubscriber();
          await sub.subscribe(PREFIX + requestId, (message) => {
            clearTimeout(timeout);
            sub.disconnect().catch(e => log.debug('discord-bot', 'rc subscriber disconnect error', { error: e?.message }));
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
    },
  };
}

module.exports = { createCommandHandlers };
