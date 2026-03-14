/**
 * Discord Embed Builders — pure functions that return EmbedBuilder objects.
 * Extracted from discord-bot.js for maintainability.
 *
 * Each builder accepts data and returns an EmbedBuilder (or { embeds, content }).
 * None of them call channel.send() — the caller is responsible for sending.
 */
const { EmbedBuilder } = require('discord.js');

// ── Constants ──────────────────────────────────────────────────────

/** Throttle window for ReAct pulse embeds (ms) */
const REACT_THROTTLE_MS = 30000;

/** Role -> embed color mapping */
const ROLE_COLORS = {
  leader:   0xe74c3c,
  builder:  0x2ecc71,
  safety:   0xe67e22,
  explorer: 0x3498db,
};
const DEFAULT_COLOR = 0x95a5a6;

// ── Pure Helpers ───────────────────────────────────────────────────

/** Extract role name from agent ID string */
function _roleFromAgentId(agentId, explicitRole) {
  return explicitRole || agentId.split('-')[0].replace(/^OctivBot_/, '');
}

/** Get embed color for a role */
function _roleColor(agentId, explicitRole) {
  return ROLE_COLORS[_roleFromAgentId(agentId, explicitRole)] ?? DEFAULT_COLOR;
}

/** Extract agent ID from channel like "octiv:agent:builder-01:react" */
function _extractAgentId(channel) {
  const parts = (channel || '').split(':');
  const agentIdx = parts.indexOf('agent');
  return (agentIdx >= 0 && parts[agentIdx + 1]) ? parts[agentIdx + 1] : 'unknown';
}

/** Resolve agentId from payload — prefers agentId, falls back to author */
function _resolveAgentId(data) {
  return data.agentId || data.author || 'unknown';
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

/** Format position object to readable string */
function formatPos(pos) {
  if (!pos) return 'unknown';
  return `${Math.round(pos.x)}, ${Math.round(pos.y)}, ${Math.round(pos.z)}`;
}

/** Log send errors consistently */
function logSendError(err) {
  const { getLogger } = require('./logger');
  getLogger().error('discord', 'failed to send message', { error: err.message });
}

// ── Embed Builders ─────────────────────────────────────────────────

function buildStatusEmbed(data) {
  const hp = data.health;
  const color = hp != null ? (hp > 10 ? 0x2ecc71 : hp > 5 ? 0xf39c12 : 0xe74c3c) : 0x3498db;
  const fields = [];
  if (data.status) fields.push({ name: 'Status', value: data.status, inline: true });
  if (data.position) fields.push({ name: 'Position', value: formatPos(data.position), inline: true });
  if (hp != null) fields.push({ name: 'Health', value: `${hp}/20`, inline: true });
  if (data.task) fields.push({ name: 'Task', value: data.task, inline: true });

  const embed = new EmbedBuilder()
    .setTitle(`Agent Status: ${_resolveAgentId(data)}`)
    .setColor(color)
    .setTimestamp();
  if (fields.length > 0) embed.addFields(fields);
  return embed;
}

function buildHealthEmbed(data) {
  const hp = data.health || 0;
  const food = data.food || 0;
  const color = hp > 14 ? 0x2ecc71 : hp > 7 ? 0xf39c12 : 0xe74c3c;
  const hpBar = '\u2764'.repeat(Math.ceil(hp / 2)) + '\uD83D\uDDA4'.repeat(10 - Math.ceil(hp / 2));
  const foodBar = '\uD83C\uDF57'.repeat(Math.ceil(food / 2)) + '\uD83E\uDDB4'.repeat(10 - Math.ceil(food / 2));

  return new EmbedBuilder()
    .setTitle(`${data.agentId || 'unknown'} Health`)
    .setColor(color)
    .addFields(
      { name: 'HP', value: `${hpBar} ${hp}/20`, inline: false },
      { name: 'Food', value: `${foodBar} ${food}/20`, inline: false },
      { name: 'Position', value: formatPos(data.position), inline: true }
    )
    .setTimestamp();
}

function buildInventoryEmbed(data) {
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
  return embed;
}

function buildReactEmbed(data) {
  const agentId = data.agentId || 'unknown';
  const embed = new EmbedBuilder()
    .setTitle(`${agentId} Activity`)
    .setColor(0x9b59b6)
    .setDescription(`ReAct iteration #${data.iteration || '?'}`)
    .setTimestamp();

  if (data.action) {
    embed.addFields({ name: 'Action', value: data.action, inline: true });
  }
  return embed;
}

function buildMilestoneEmbed(data) {
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
  return embed;
}

function buildSkillEmbed(data) {
  const embed = new EmbedBuilder()
    .setTitle('New Skill Learned')
    .setColor(0x1abc9c)
    .setDescription(data.skillName || data.name || 'unknown skill')
    .setTimestamp();

  const agentId = _resolveAgentId(data);
  if (agentId !== 'unknown') {
    embed.addFields({ name: 'Agent', value: agentId, inline: true });
  }
  if (data.errorType || data.failureType) {
    embed.addFields({ name: 'Trigger', value: data.errorType || data.failureType, inline: true });
  }
  if (data.trigger) {
    embed.addFields({ name: 'Source', value: data.trigger, inline: true });
  }
  return embed;
}

/**
 * Build an alert embed (threat, reflexion, got).
 * @returns {{ embed: EmbedBuilder, content: string }}
 */
function buildAlertEmbed(type, data) {
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

  const agentId = _resolveAgentId(data);
  if (agentId !== 'unknown') embed.addFields({ name: 'Agent', value: agentId, inline: true });
  const threatType = data.threatType || data.threat?.type;
  if (threatType) embed.addFields({ name: 'Type', value: threatType, inline: true });
  if (data.totalSynergies !== undefined) {
    embed.addFields({ name: 'Synergies', value: `${data.totalSynergies}`, inline: true });
  }
  if (data.totalGaps !== undefined) {
    embed.addFields({ name: 'Gaps', value: `${data.totalGaps}`, inline: true });
  }

  return { embed, content: isUrgent ? '@here' : '' };
}

/**
 * Build a Shinmungo (confession) embed for forum thread.
 * @returns {{ embed: EmbedBuilder, title: string, appliedTags: function }}
 */
function buildShinmungoEmbed(data, forumTagCache) {
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

  const appliedTags = [];
  if (forumTagCache) {
    const tagId = data.tag ? forumTagCache.get(data.tag.toLowerCase()) : undefined;
    if (tagId !== undefined) appliedTags.push(tagId);
  }

  const title = data.title || `${displayName}'s confession`;

  return { embed, title: title.slice(0, 100), appliedTags };
}

function buildChatEmbed(data) {
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
  return embed;
}

module.exports = {
  // Constants
  REACT_THROTTLE_MS,
  ROLE_COLORS,
  DEFAULT_COLOR,
  // Helpers
  _roleFromAgentId,
  _roleColor,
  _extractAgentId,
  _resolveAgentId,
  _anonymousHash,
  formatPos,
  logSendError,
  // Builders
  buildStatusEmbed,
  buildHealthEmbed,
  buildInventoryEmbed,
  buildReactEmbed,
  buildMilestoneEmbed,
  buildSkillEmbed,
  buildAlertEmbed,
  buildShinmungoEmbed,
  buildChatEmbed,
};
