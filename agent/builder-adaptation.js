/**
 * Builder Adaptation — extracted from builder.js
 * AC-5: Self-improvement on failure + learned skill application.
 */
const { getLogger } = require('./logger');
const log = getLogger();

/**
 * Classify error message into a known error type.
 * @param {string} message - error message
 * @returns {string} - error type key
 */
function classifyError(message) {
  const msg = message.toLowerCase();
  if (msg.includes('build site') || msg.includes('flat')) return 'build_site';
  if (msg.includes('path') || msg.includes('goal') || msg.includes('movement')) return 'pathfinding';
  if (msg.includes('inventory') || msg.includes('no oak') || msg.includes('no item')) return 'inventory';
  if (msg.includes('shelter') || msg.includes('coordinates')) return 'shelter';
  return 'unknown';
}

/**
 * AC-5: Self-improvement on failure — adjust adaptations based on error type.
 * @param {object} agent - BuilderAgent instance (needs: id, adaptations, acProgress, board, logger, reactIterations)
 * @param {Error} error - the error that triggered self-improvement
 * @returns {boolean} - whether the agent should retry
 */
async function selfImprove(agent, error) {
  const errorType = classifyError(error.message);
  const retryKey = errorType;
  agent.adaptations.retries[retryKey] = (agent.adaptations.retries[retryKey] || 0) + 1;
  const retryCount = agent.adaptations.retries[retryKey];

  let improvement = null;

  if (errorType === 'build_site' && agent.adaptations.buildSiteRadius < 64) {
    agent.adaptations.buildSiteRadius = Math.min(64, agent.adaptations.buildSiteRadius + 8);
    improvement = { type: 'expand_build_radius', value: agent.adaptations.buildSiteRadius };
  } else if (errorType === 'pathfinding' && agent.adaptations.waitTicks < 100) {
    agent.adaptations.waitTicks = Math.min(100, agent.adaptations.waitTicks + 10);
    improvement = { type: 'increase_wait', value: agent.adaptations.waitTicks };
  } else if (errorType === 'inventory') {
    agent.adaptations.searchRadius = Math.min(128, agent.adaptations.searchRadius + 16);
    improvement = { type: 'expand_search_radius', value: agent.adaptations.searchRadius };
  } else if (errorType === 'unknown') {
    agent.adaptations.waitTicks = Math.min(100, agent.adaptations.waitTicks + 5);
    improvement = { type: 'increase_wait', value: agent.adaptations.waitTicks };
  }

  if (improvement) {
    improvement.retry = retryCount;
    improvement.error = error.message;
    agent.adaptations.improvements.push(improvement);

    await agent.board.publish(`agent:${agent.id}:improvement`, { author: agent.id, ...improvement });
    await agent.board.logReflexion(agent.id, {
      type: 'self_improve',
      errorType,
      improvement,
      iteration: agent.reactIterations,
    });
    if (agent.logger) agent.logger.logEvent(agent.id, { type: 'self_improve', ...improvement }).catch(e => log.error(agent.id, 'log persist error', { error: e.message }));
    log.info(agent.id, `AC-5 self-improve: ${improvement.type} → ${improvement.value}`);

    if (!agent.acProgress[5]) {
      agent.acProgress[5] = true;
      await agent.board.updateAC(agent.id, 5, 'done');
    }
  }

  return retryCount <= agent.adaptations.maxRetries;
}

/**
 * Task B: Try learned skill from library matching the error type.
 * @param {object} agent - BuilderAgent instance (needs: id, skillPipeline, logger)
 * @param {Error} error - the error to find a matching skill for
 * @returns {boolean} - whether a skill was successfully applied
 */
async function tryLearnedSkill(agent, error) {
  if (!agent.skillPipeline) return false;

  const errorType = classifyError(error.message);
  let library;
  try {
    library = await agent.skillPipeline.getLibrary();
  } catch {
    return false;
  }

  const matching = Object.entries(library)
    .filter(([, skill]) => skill.errorType === errorType)
    .sort((a, b) => (b[1].successRate || 0) - (a[1].successRate || 0));

  if (matching.length === 0) return false;

  const [skillName, skill] = matching[0];

  try {
    const valid = await agent.skillPipeline.validateSkill(skill.code, 1);
    if (!valid) {
      await agent.skillPipeline.updateSuccessRate(skillName, false);
      if (agent.logger) agent.logger.logEvent(agent.id, { type: 'skill_applied', skill: skillName, success: false, error: 'validation_failed' }).catch(e => log.error(agent.id, 'log persist error', { error: e.message }));
      log.info(agent.id, `learned skill validation failed: ${skillName}`);
      return false;
    }
    await agent.skillPipeline.updateSuccessRate(skillName, true);
    if (agent.logger) agent.logger.logEvent(agent.id, { type: 'skill_applied', skill: skillName, success: true }).catch(e => log.error(agent.id, 'log persist error', { error: e.message }));
    log.info(agent.id, `applied learned skill: ${skillName}`);
    return true;
  } catch (err) {
    await agent.skillPipeline.updateSuccessRate(skillName, false);
    if (agent.logger) agent.logger.logEvent(agent.id, { type: 'skill_applied', skill: skillName, success: false, error: err.message }).catch(e => log.error(agent.id, 'log persist error', { error: e.message }));
    log.info(agent.id, `learned skill failed: ${skillName} — ${err.message}`);
    return false;
  }
}

module.exports = { classifyError, selfImprove, tryLearnedSkill };
