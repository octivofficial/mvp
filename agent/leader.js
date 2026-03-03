/**
 * Octiv Leader Agent — strategy-engine role
 * Goal decomposition, Training/Creative mode decision, vote aggregation
 */
const { Blackboard } = require('./blackboard');

class LeaderAgent {
  constructor(teamSize = 3) {
    this.id = 'leader';
    this.teamSize = teamSize;
    this.board = new Blackboard();
    this.votes = [];
    this.mode = 'training'; // training | creative
    this.consecutiveTeamFailures = 0;
    this.logger = null;
    this.skillPipeline = null;
  }

  setLogger(logger) { this.logger = logger; }
  setSkillPipeline(pipeline) { this.skillPipeline = pipeline; }

  async init() {
    await this.board.connect();
    this._startMissionLoop();
    console.log('[Leader] initialized, team size:', this.teamSize);
  }

  // 3.1: Distribute missions to builders based on AC progress
  async distributeMission(agentId) {
    const acData = await this.board.getACProgress(agentId);
    const done = new Set();
    for (const [key, val] of Object.entries(acData)) {
      try { if (JSON.parse(val).status === 'done') done.add(key); } catch {}
    }

    let mission;
    if (!done.has('AC-1')) mission = { ac: 1, action: 'collectWood', params: { count: 16 } };
    else if (!done.has('AC-3')) mission = { ac: 3, action: 'craftBasicTools', params: {} };
    else if (!done.has('AC-2')) mission = { ac: 2, action: 'buildShelter', params: {} };
    else if (!done.has('AC-4')) mission = { ac: 4, action: 'gatherAtShelter', params: {} };
    else mission = { ac: 0, action: 'idle', params: {} };

    await this.board.publish(`command:${agentId}:mission`, { author: 'leader', ...mission });
    if (this.logger) {
      this.logger.logEvent(this.id, { type: 'mission_assigned', agentId, mission });
    }
    return mission;
  }

  // 3.1: Periodic mission distribution loop
  _startMissionLoop() {
    this._missionTimer = setInterval(async () => {
      try {
        for (let i = 1; i <= this.teamSize; i++) {
          await this.distributeMission(`builder-0${i}`);
        }
        await this.decideMode('builder-01');
      } catch {}
    }, 10000);
  }

  // Decide mode based on AC progress
  async decideMode(agentId) {
    const acData = await this.board.getACProgress(agentId);
    const total = Object.keys(acData).length;
    const done = Object.values(acData).filter(v => {
      try { return JSON.parse(v).status === 'done'; } catch { return false; }
    }).length;
    const progress = total > 0 ? done / total : 0;

    this.mode = (progress >= 0.7 || this.votes.length >= Math.ceil(this.teamSize * 2 / 3))
      ? 'creative'
      : 'training';

    await this.board.publish('leader:mode', { author: 'leader', mode: this.mode, progress });
    console.log(`[Leader] mode: ${this.mode} (progress: ${Math.floor(progress * 100)}%)`);
    return this.mode;
  }

  // Aggregate team votes
  async collectVote(agentId, vote) {
    this.votes.push({ agentId, vote, ts: Date.now() });
    await this.board.publish('leader:votes', { author: 'leader', votes: this.votes });
    console.log(`[Leader] vote received: ${agentId} → ${vote}`);
  }

  // Force Group Reflexion (on 3 consecutive failures)
  async forceGroupReflexion(failureLog) {
    console.warn('[Leader] ⚠️  forcing Group Reflexion!');
    await this.board.publish('leader:reflexion', {
      author: 'leader',
      type: 'group',
      trigger: 'consecutive_failures',
      failureLog,
    });
  }

  // AC-6: Collect reflexion logs from all builders, synthesize improvements
  async triggerGroupReflexion() {
    console.log('[Leader] triggering Group Reflexion');
    const allErrors = [];
    for (let i = 1; i <= this.teamSize; i++) {
      const entries = await this.board.getListRange(`agent:builder-0${i}:reflexion`);
      for (const raw of entries) {
        try { allErrors.push(JSON.parse(raw)); } catch {}
      }
    }

    // Count error types
    const errorCounts = {};
    for (const entry of allErrors) {
      const errMsg = entry.error || 'unknown';
      errorCounts[errMsg] = (errorCounts[errMsg] || 0) + 1;
    }

    // Find most common failure
    const sorted = Object.entries(errorCounts).sort((a, b) => b[1] - a[1]);
    const topError = sorted[0]?.[0] || 'none';

    const result = {
      commonErrors: errorCounts,
      recommendation: `Focus on resolving: ${topError}`,
      agentCount: this.teamSize,
      totalEntries: allErrors.length,
    };

    await this.board.publish('leader:reflexion:result', { author: 'leader', ...result });
    this.consecutiveTeamFailures = 0;

    if (this.logger) {
      this.logger.logEvent(this.id, { type: 'group_reflexion', ...result });
    }

    // Trigger skill creation for the most common error via pipeline
    if (this.skillPipeline && topError !== 'none') {
      const skillResult = await this.skillPipeline.generateFromFailure({
        error: topError,
        errorType: topError,
        agentId: this.id,
        severity: allErrors.length >= 10 ? 'critical' : 'normal',
      });
      if (skillResult.success) {
        await this.injectLearnedSkill(skillResult.skill);
      }
    }

    console.log(`[Leader] Group Reflexion complete: ${allErrors.length} entries from ${this.teamSize} agents`);
    return result;
  }

  // 4.4: Inject learned skill into team system prompt via Blackboard
  async injectLearnedSkill(skillName, version = 'v1') {
    const tag = `[Learned Skill ${version}] ${skillName}`;
    const current = await this.board.get('leader:system_prompt') || {};
    const skills = current.skills || [];
    if (!skills.includes(tag)) skills.push(tag);

    await this.board.publish('leader:system_prompt', { author: 'leader', skills, updatedAt: Date.now() });
    // Broadcast to all builders
    for (let i = 1; i <= this.teamSize; i++) {
      await this.board.publish(`command:builder-0${i}:prompt_update`, { author: 'leader', skills });
    }
    if (this.logger) {
      this.logger.logEvent(this.id, { type: 'skill_injected', skill: skillName, version, totalSkills: skills.length });
    }
    console.log(`[Leader] injected: ${tag}`);
    return { tag, totalSkills: skills.length };
  }

  // Check if team failures warrant Group Reflexion
  async checkReflexionTrigger() {
    if (this.consecutiveTeamFailures >= 3) {
      await this.triggerGroupReflexion();
      return true;
    }
    return false;
  }

  async shutdown() {
    if (this._missionTimer) clearInterval(this._missionTimer);
    await this.board.disconnect();
  }
}

module.exports = { LeaderAgent };
