/**
 * Octiv Agent Chat & Confession — personality-driven Blackboard messages
 * Publishes to agent:{id}:chat and agent:{id}:confess channels
 * at key lifecycle moments with role-specific templates.
 */
const T = require('../config/timeouts');
const { getLogger } = require('./logger');
const log = getLogger();

// ── Chat templates by role ──────────────────────────────────────────
const CHAT_TEMPLATES = {
  builder: {
    wood_found: [
      'Found {blockType} nearby. Moving in to chop.',
      'Wood spotted at ({x}, {z}). Starting collection.',
      '{blockType} cluster ahead — this should be good.',
    ],
    wood_complete: [
      'AC-1 done. {count} logs collected. Ready for next task.',
      'Wood collection finished — {count} logs in inventory.',
    ],
    wandering: [
      'No trees in sight. Wandering to ({x}, {z})...',
      'Expanding search. Heading ({x}, {z}).',
    ],
    shelter_complete: [
      'Shelter built at ({x}, {y}, {z}). AC-2 complete.',
      '3x3x3 shelter is up. Home sweet home.',
    ],
    arrived_shelter: [
      'Arrived at shelter. AC-4 done.',
      'Made it to base. Reporting in.',
    ],
  },
  leader: {
    mission_assigned: [
      'Assigned AC-{ac} to {agentId}. Execute.',
      '{agentId}: your mission is {action}. Move.',
    ],
    reflexion_triggered: [
      'Too many failures. Triggering Group Reflexion.',
      'Team is struggling — initiating reflexion cycle.',
    ],
    reflexion_complete: [
      'Reflexion complete. {totalEntries} entries analyzed. Focus: {recommendation}.',
      'Group review done. Top issue: {recommendation}.',
    ],
    skill_injected: [
      'New skill deployed: {skill} (v{version}). {totalSkills} active.',
      'Injected [{skill}] into team prompts.',
    ],
    mode_change: [
      'Mode switched to {mode}. Progress: {progress}%.',
      'Entering {mode} mode — {progress}% complete.',
    ],
  },
  safety: {
    threat_detected: [
      'THREAT: {type} — {reason}. Stay alert.',
      'Danger detected: {type}. {reason}.',
    ],
    all_clear: [
      'All clear. Threat level back to normal.',
      'Situation stable. Resuming monitoring.',
    ],
  },
  explorer: {
    discovery: [
      'Scanned area at radius {radius}. Found {resources} resources, {dangers} dangers.',
      'Explored ({x}, {z}). {safe} zone.',
    ],
    danger_spotted: [
      'DANGER: {type} at ({x}, {y}, {z}). Marking on world map.',
      'Found {type} nearby. Avoid this area.',
    ],
  },
};

// ── Confess templates by role ───────────────────────────────────────
const CONFESS_TEMPLATES = {
  builder: {
    repeated_failure: [
      {
        title: 'I keep failing',
        message: "I've wandered {failures} times and still can't find wood. Am I even useful?",
        tag: 'frustration',
        mood: 'defeated',
      },
      {
        title: 'Lost in the wilderness',
        message: "Nothing but empty plains. {failures} attempts. Maybe I'm looking in the wrong direction.",
        tag: 'doubt',
        mood: 'anxious',
      },
    ],
    ac_complete: [
      {
        title: 'We did it',
        message: 'AC-{ac} is done. All those failures were worth it. {count} logs collected.',
        tag: 'pride',
        mood: 'triumphant',
      },
    ],
  },
  leader: {
    reflexion_insight: [
      {
        title: 'Patterns in failure',
        message: 'After analyzing {totalEntries} failures across {agentCount} agents — the root cause is always the same: {recommendation}.',
        tag: 'insight',
        mood: 'contemplative',
      },
      {
        title: 'Carrying the team',
        message: 'Every failure lands on my desk. {totalEntries} reflexion entries. The weight of leadership.',
        tag: 'burden',
        mood: 'weary',
      },
    ],
  },
  safety: {
    near_death: [
      {
        title: 'Too close',
        message: 'Health dropped to {health}. One more hit and {agentId} is gone. I should have caught this sooner.',
        tag: 'guilt',
        mood: 'shaken',
      },
    ],
    consecutive_failures: [
      {
        title: 'Am I failing them?',
        message: '{failures} threats in a row. My detection is working, but the team keeps walking into danger.',
        tag: 'self-doubt',
        mood: 'troubled',
      },
    ],
  },
  explorer: {
    danger_zone: [
      {
        title: 'The map is dangerous',
        message: '{dangerCount} danger zones discovered. This world is hostile. But someone has to chart it.',
        tag: 'courage',
        mood: 'determined',
      },
    ],
    milestone: [
      {
        title: 'The world grows',
        message: '{discoveries} areas scouted. The map is taking shape. Every step reveals something new.',
        tag: 'wonder',
        mood: 'inspired',
      },
    ],
  },
};

class AgentChat {
  constructor(board, agentId, role) {
    this.board = board;
    this.agentId = agentId;
    this.role = role;
    this._lastChat = {};
    this._lastConfess = {};
  }

  /**
   * Publish a chat message (throttled by CHAT_COOLDOWN_MS per event).
   * @returns {Promise<boolean>} true if published, false if throttled
   */
  async chat(event, vars = {}) {
    const now = Date.now();
    if (now - (this._lastChat[event] || 0) < T.CHAT_COOLDOWN_MS) return false;

    const templates = CHAT_TEMPLATES[this.role]?.[event];
    if (!templates || templates.length === 0) return false;

    const template = templates[Math.floor(Math.random() * templates.length)];
    const message = this._fillTemplate(template, vars);

    await this.board.publish(`agent:${this.agentId}:chat`, {
      author: this.agentId,
      role: this.role,
      event,
      message,
      ts: now,
    });
    this._lastChat[event] = now;

    log.info(this.agentId, `chat: ${message}`);
    return true;
  }

  /**
   * Publish a confession (throttled by CONFESS_COOLDOWN_MS per event).
   * @returns {Promise<boolean>} true if published, false if throttled
   */
  async confess(event, vars = {}) {
    const now = Date.now();
    if (now - (this._lastConfess[event] || 0) < T.CONFESS_COOLDOWN_MS) return false;

    const templates = CONFESS_TEMPLATES[this.role]?.[event];
    if (!templates || templates.length === 0) return false;

    const template = templates[Math.floor(Math.random() * templates.length)];
    const confession = {
      title: this._fillTemplate(template.title, vars),
      message: this._fillTemplate(template.message, vars),
      tag: template.tag,
      mood: template.mood,
    };

    await this.board.publish(`agent:${this.agentId}:confess`, {
      author: this.agentId,
      role: this.role,
      event,
      ...confession,
      ts: now,
    });
    this._lastConfess[event] = now;

    log.info(this.agentId, `confess [${confession.mood}]: ${confession.title}`);
    return true;
  }

  /**
   * Replace {key} placeholders with values from vars.
   */
  _fillTemplate(tpl, vars) {
    return tpl.replace(/\{(\w+)\}/g, (_, key) =>
      vars[key] !== undefined ? String(vars[key]) : `{${key}}`
    );
  }
}

module.exports = { AgentChat, CHAT_TEMPLATES, CONFESS_TEMPLATES };
