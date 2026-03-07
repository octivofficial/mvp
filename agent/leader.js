/**
 * Octiv Leader Agent — strategy-engine role
 * Goal decomposition, Training/Creative mode decision, vote aggregation
 */
const { Blackboard } = require('./blackboard');
const { getLogger } = require('./logger');
const { AgentChat } = require('./agent-chat');
const T = require('../config/timeouts');

const log = getLogger();

class LeaderAgent {
  constructor(teamSize = 3, specialists = []) {
    this.id = 'leader';
    this.teamSize = teamSize;
    this.specialists = specialists; // ['miner-01', 'farmer-01']
    this.board = new Blackboard();
    this.votes = [];
    this.mode = 'training'; // training | creative
    this.consecutiveTeamFailures = 0;
    this.logger = null;
    this.skillPipeline = null;
    this.chat = new AgentChat(this.board, this.id, 'leader');
  }

  setLogger(logger) { this.logger = logger; }
  setSkillPipeline(pipeline) { this.skillPipeline = pipeline; }

  async init() {
    await this.board.connect();
    this._startMissionLoop();
    log.info(this.id, `initialized, team size: ${this.teamSize}`);
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
    this.chat.chat('mission_assigned', { ac: mission.ac, agentId, action: mission.action }).catch(() => {});
    if (this.logger) {
      this.logger.logEvent(this.id, { type: 'mission_assigned', agentId, mission }).catch(e => log.error(this.id, 'log persist error', { error: e.message }));
    }
    return mission;
  }

  // Distribute role-specific missions to specialist agents (miner, farmer)
  async distributeSpecialistMission(agentId) {
    const role = agentId.replace(/-\d+$/, ''); // 'miner-01' → 'miner'
    let mission;
    switch (role) {
      case 'miner':
        mission = { ac: 0, action: 'mine', params: { priority: 'iron' } };
        break;
      case 'farmer':
        mission = { ac: 0, action: 'farm', params: {} };
        break;
      default:
        mission = { ac: 0, action: 'idle', params: {} };
    }

    await this.board.publish(`command:${agentId}:mission`, { author: 'leader', ...mission });
    log.info(this.id, `specialist mission: ${agentId} → ${mission.action}`);
    return mission;
  }

  // 3.1: Periodic mission distribution loop
  _startMissionLoop() {
    this._missionTimer = setInterval(async () => {
      try {
        for (let i = 1; i <= this.teamSize; i++) {
          await this.distributeMission(`builder-0${i}`);
        }
        for (const specialistId of this.specialists) {
          await this.distributeSpecialistMission(specialistId);
        }
        await this.decideMode('builder-01');
      } catch (err) {
        log.error(this.id, 'mission loop error', { error: err.message });
      }
    }, T.MISSION_LOOP_INTERVAL_MS);
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
    this.chat.chat('mode_change', { mode: this.mode, progress: Math.floor(progress * 100) }).catch(() => {});
    log.info(this.id, `mode: ${this.mode} (progress: ${Math.floor(progress * 100)}%)`);
    return this.mode;
  }

  // Aggregate team votes
  async collectVote(agentId, vote) {
    this.votes.push({ agentId, vote, ts: Date.now() });
    await this.board.publish('leader:votes', { author: 'leader', votes: this.votes });
    log.info(this.id, `vote received: ${agentId} → ${vote}`);
  }

  // Force Group Reflexion (on 3 consecutive failures)
  async forceGroupReflexion(failureLog) {
    log.warn(this.id, 'forcing Group Reflexion!');
    await this.board.publish('leader:reflexion', {
      author: 'leader',
      type: 'group',
      trigger: 'consecutive_failures',
      failureLog,
    });
  }

  // AC-6: Collect reflexion logs from all builders, synthesize improvements
  async triggerGroupReflexion() {
    log.info(this.id, 'triggering Group Reflexion');
    this.chat.chat('reflexion_triggered', {}).catch(() => {});
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
      this.logger.logEvent(this.id, { type: 'group_reflexion', ...result }).catch(e => log.error(this.id, 'log persist error', { error: e.message }));
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

    this.chat.chat('reflexion_complete', { totalEntries: allErrors.length, recommendation: result.recommendation }).catch(() => {});
    this.chat.confess('reflexion_insight', { totalEntries: allErrors.length, agentCount: this.teamSize, recommendation: result.recommendation }).catch(() => {});
    log.info(this.id, `Group Reflexion complete: ${allErrors.length} entries from ${this.teamSize} agents`);
    return result;
  }

  // 4.4: Inject learned skill into team system prompt via Blackboard
  // Task D: Quality filter — check successRate, duplicates, max count
  async injectLearnedSkill(skillName, version = 'v1') {
    // Quality gate: check skill successRate from library
    if (this.skillPipeline) {
      try {
        const library = await this.skillPipeline.getLibrary();
        const skill = library[skillName];
        if (skill && skill.uses >= 3 && skill.successRate < 0.5) {
          log.info(this.id, `skipped low-quality skill: ${skillName} (rate: ${skill.successRate.toFixed(2)})`);
          return { tag: null, totalSkills: 0, rejected: 'low_success_rate' };
        }
      } catch {
        // Library unavailable — proceed without filter
      }
    }

    const tag = `[Learned Skill ${version}] ${skillName}`;
    const current = await this.board.get('leader:system_prompt') || {};
    const skills = current.skills || [];

    // Duplicate check
    if (skills.includes(tag)) {
      return { tag, totalSkills: skills.length, rejected: 'duplicate' };
    }

    // Max skill count limit (10 skills max to avoid prompt bloat)
    if (skills.length >= 10) {
      log.info(this.id, `skill limit reached (${skills.length}/10), skipping: ${skillName}`);
      return { tag: null, totalSkills: skills.length, rejected: 'max_skills_reached' };
    }

    skills.push(tag);

    await this.board.publish('leader:system_prompt', { author: 'leader', skills, updatedAt: Date.now() });
    // Broadcast to all builders
    for (let i = 1; i <= this.teamSize; i++) {
      await this.board.publish(`command:builder-0${i}:prompt_update`, { author: 'leader', skills });
    }
    this.chat.chat('skill_injected', { skill: skillName, version, totalSkills: skills.length }).catch(() => {});
    if (this.logger) {
      this.logger.logEvent(this.id, { type: 'skill_injected', skill: skillName, version, totalSkills: skills.length }).catch(e => log.error(this.id, 'log persist error', { error: e.message }));
    }
    log.info(this.id, `injected: ${tag}`);
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

  // Process GoT reasoning feedback: gaps → skills, synergies → compounds, evolution → log
  async processGoTFeedback(gotResult) {
    if (!gotResult || !gotResult.summary) {
      return { actions: [] };
    }

    const actions = [];
    const { gaps = [], synergies = [], evolutions = [] } = gotResult;
    const { criticalGaps = 0 } = gotResult.summary;

    // Priority 1: Critical gaps → generate skills
    if (this.skillPipeline && criticalGaps > 0) {
      for (const gap of gaps.filter(g => g.severity === 'critical')) {
        try {
          const result = await this.skillPipeline.generateFromFailure({
            error: gap.errorType,
            errorType: gap.errorType,
            agentId: this.id,
            severity: 'critical',
          });
          if (result.success) {
            await this.injectLearnedSkill(result.skill);
            actions.push({ type: 'gap_skill_created', errorType: gap.errorType, skill: result.skill });
          }
        } catch (err) {
          log.error(this.id, 'gap skill generation failed', { error: err.message, errorType: gap.errorType });
        }
      }
    }

    // Priority 2: High synergies → suggest compounds
    const highSynergies = synergies.filter(s => s.score >= 0.6);
    if (highSynergies.length > 0) {
      await this.board.publish('leader:got:compound-suggestion', {
        author: 'leader',
        synergies: highSynergies,
        suggestedAt: Date.now(),
      });
      actions.push({ type: 'compound_suggested', count: highSynergies.length });
    }

    // Priority 3: Evolution insights
    if (evolutions.length > 0 && evolutions[0]) {
      const closest = evolutions[0];
      actions.push({ type: 'evolution_noted', skill: closest.skill, usesToMaster: closest.usesToMaster });
      log.info(this.id, `closest to Master: ${closest.skill} (${closest.usesToMaster} uses)`);
    }

    // Store analysis on Blackboard for dashboard
    await this.board.publish('leader:got:actions', {
      author: 'leader',
      actions,
      summary: gotResult.summary,
      processedAt: Date.now(),
    });

    if (this.logger) {
      this.logger.logEvent(this.id, {
        type: 'got_feedback_processed',
        actionsCount: actions.length,
        criticalGaps,
        highSynergies: highSynergies.length,
      }).catch(e => log.error(this.id, 'log persist error', { error: e.message }));
    }

    log.info(this.id, `GoT feedback: ${actions.length} actions (${criticalGaps} critical gaps, ${highSynergies.length} synergies)`);
    return { actions };
  }

  async shutdown() {
    if (this._missionTimer) clearInterval(this._missionTimer);
    await this.board.disconnect();
  }
}

module.exports = { LeaderAgent };
