/**
 * Octiv Idol Metrics — survival→idol stat mapping
 * Maps Minecraft survival activities to K-pop trainee progression.
 * Each activity earns XP in a specific idol stat category.
 */
const ACTIVITY_MAP = {
  shelter_build:   { stat: 'choreography_sync',    xp: 50, category: 'collaboration' },
  wood_collection: { stat: 'stage_planning',       xp: 10, category: 'resource' },
  tool_crafting:   { stat: 'creative_technique',   xp: 20, category: 'skill' },
  shelter_gather:  { stat: 'team_formation',       xp: 30, category: 'collaboration' },
  ore_mining:      { stat: 'creative_inspiration', xp: 15, category: 'resource' },
  crop_farming:    { stat: 'patience_cultivation', xp: 12, category: 'growth' },
  exploration:     { stat: 'world_awareness',      xp: 8,  category: 'knowledge' },
  threat_survival: { stat: 'stage_presence',       xp: 25, category: 'resilience' },
  reflexion:       { stat: 'self_improvement',     xp: 20, category: 'growth' },
  skill_creation:  { stat: 'creative_output',      xp: 35, category: 'skill' },
};

const LEVELS = [
  { level: 1, name: 'Trainee', xpRequired: 0 },
  { level: 2, name: 'Rookie',  xpRequired: 100 },
  { level: 3, name: 'Regular', xpRequired: 300 },
  { level: 4, name: 'Senior',  xpRequired: 600 },
  { level: 5, name: 'Lead',    xpRequired: 1000 },
  { level: 6, name: 'Center',  xpRequired: 2000 },
];

class IdolMetrics {
  constructor(agentId) {
    this.agentId = agentId;
    this.totalXP = 0;
    this.activities = {};
  }

  /** Convert survival event to idol stat mapping */
  convertSurvivalEvent(activity) {
    if (!activity) return null;
    return ACTIVITY_MAP[activity] || null;
  }

  /** Add XP from a survival activity */
  addXP(activity) {
    const mapping = this.convertSurvivalEvent(activity);
    if (!mapping) return;
    this.totalXP += mapping.xp;
    this.activities[activity] = (this.activities[activity] || 0) + mapping.xp;
  }

  /** Calculate current level based on total XP */
  calculateLevel() {
    let current = LEVELS[0];
    for (const lvl of LEVELS) {
      if (this.totalXP >= lvl.xpRequired) current = lvl;
    }
    return { level: current.level, name: current.name };
  }

  /** Get full stats snapshot */
  getStats() {
    return {
      agentId: this.agentId,
      totalXP: this.totalXP,
      level: this.calculateLevel(),
      activities: { ...this.activities },
    };
  }

  /** Aggregate stats across multiple agents */
  static getTeamOverview(metricsArray) {
    if (!metricsArray.length) {
      return { totalTeamXP: 0, avgLevel: 0, agents: [] };
    }
    const agents = metricsArray.map(m => m.getStats());
    const totalTeamXP = agents.reduce((sum, a) => sum + a.totalXP, 0);
    const avgLevel = agents.reduce((sum, a) => sum + a.level.level, 0) / agents.length;
    return { totalTeamXP, avgLevel, agents };
  }
}

module.exports = { IdolMetrics, ACTIVITY_MAP, LEVELS };
