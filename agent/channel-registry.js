/**
 * Octiv Channel Registry — Blackboard channel domain categorization
 * Categorizes all pub/sub channels into 6 domains.
 * Read-filter only — no subscriber migration.
 */
/** Channel domain rules (order matters — first match wins) */
const DOMAIN_RULES = [
  // creative (check before survival to catch idol-stats)
  { pattern: /idol-stats$/, domain: 'creative' },
  { pattern: /^leader:idol/, domain: 'creative' },

  // command
  { pattern: /^command:/, domain: 'command' },
  { pattern: /^rc:cmd:/, domain: 'command' },

  // learning
  { pattern: /^skills:/, domain: 'learning' },
  { pattern: /^zettelkasten:/, domain: 'learning' },
  { pattern: /^rumination:/, domain: 'learning' },

  // social
  { pattern: /:chat$/, domain: 'social' },
  { pattern: /:confess$/, domain: 'social' },
  { pattern: /^leader:reflexion/, domain: 'social' },
  { pattern: /^leader:votes$/, domain: 'social' },

  // system
  { pattern: /^safety:/, domain: 'system' },
  { pattern: /^team:/, domain: 'system' },
  { pattern: /^config:/, domain: 'system' },
  { pattern: /^leader:mode$/, domain: 'system' },
  { pattern: /^leader:system_prompt$/, domain: 'system' },
  { pattern: /^leader:got:/, domain: 'system' },
  { pattern: /^infra:/, domain: 'system' },

  // survival (broad catch for agent channels not matched above)
  { pattern: /^agent:/, domain: 'survival' },
  { pattern: /^builder:/, domain: 'survival' },
];

/** Role → allowed domains */
const ROLE_DOMAINS = {
  builder:  ['survival', 'command', 'social'],
  miner:    ['survival', 'command', 'social'],
  farmer:   ['survival', 'command', 'social'],
  explorer: ['survival', 'command', 'social'],
  leader:   ['survival', 'creative', 'learning', 'system', 'command', 'social'],
  safety:   ['system', 'learning', 'social', 'survival'],
};

/** Phase → active domains */
const PHASE_DOMAINS = {
  training: ['survival', 'command', 'system', 'social'],
  creative: ['creative', 'social', 'learning', 'command', 'system', 'survival'],
};

class ChannelRegistry {
  /** Categorize a channel into its domain */
  categorize(channel) {
    for (const rule of DOMAIN_RULES) {
      if (rule.pattern.test(channel)) return rule.domain;
    }
    return 'unknown';
  }

  /** Get allowed domains for a role */
  getDomainsForRole(role) {
    return ROLE_DOMAINS[role] || ['social'];
  }

  /** Check if a channel is relevant for a given role */
  isRelevantFor(channel, role) {
    const domain = this.categorize(channel);
    const allowed = this.getDomainsForRole(role);
    return allowed.includes(domain);
  }

  /** Get active domains for a phase (training/creative) */
  getDomainsForPhase(phase) {
    return PHASE_DOMAINS[phase] || PHASE_DOMAINS.training;
  }
}

module.exports = { ChannelRegistry, DOMAIN_RULES, ROLE_DOMAINS, PHASE_DOMAINS };
