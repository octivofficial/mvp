/**
 * Builder Navigation — extracted from builder.js
 * Pathfinder setup and goal-based navigation with timeout.
 */
const { Movements } = require('mineflayer-pathfinder');
const T = require('../config/timeouts');

/**
 * Initialize and cache pathfinder Movements for a bot.
 * Returns the Movements instance (cached on subsequent calls).
 */
function setupPathfinder(bot, cachedMovements) {
  if (cachedMovements) {
    bot.pathfinder.setMovements(cachedMovements);
    return cachedMovements;
  }
  const movements = new Movements(bot);
  movements.allowSprinting = true;
  movements.canOpenDoors = false;
  movements.maxDropDown = 4;
  bot.pathfinder.setMovements(movements);
  return movements;
}

/**
 * Navigate bot to a goal with a distance-aware timeout.
 * Scales: min 30s, +500ms per block distance, max 120s.
 * @param {object} bot - mineflayer bot
 * @param {object} goal - pathfinder goal (GoalNear, GoalBlock, GoalXZ, etc.)
 * @param {number} timeoutMs - base timeout override (default from config)
 * @returns {Promise<void>}
 */
function goto(bot, goal, timeoutMs = T.PATHFINDER_TIMEOUT_MS) {
  // Scale timeout by distance to goal (when position available)
  let effectiveTimeout = timeoutMs;
  const pos = bot.entity?.position;
  if (pos) {
    const dx = (goal.x != null ? goal.x : pos.x) - pos.x;
    const dy = (goal.y != null ? goal.y : pos.y) - pos.y;
    const dz = (goal.z != null ? goal.z : pos.z) - pos.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const scaledTimeout = Math.min(120000, Math.max(30000, dist * 500));
    effectiveTimeout = Math.max(timeoutMs, scaledTimeout);
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      bot.pathfinder.stop();
      reject(new Error(`Pathfinding timeout after ${effectiveTimeout}ms`));
    }, effectiveTimeout);

    bot.pathfinder.goto(goal).then(() => {
      clearTimeout(timer);
      resolve();
    }).catch((err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

module.exports = { setupPathfinder, goto };
