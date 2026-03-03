/**
 * Builder Navigation — extracted from builder.js
 * Pathfinder setup and goal-based navigation with timeout.
 */
const { Movements } = require('mineflayer-pathfinder');

/**
 * Initialize and cache pathfinder Movements for a bot.
 * Returns the Movements instance (cached on subsequent calls).
 */
function setupPathfinder(bot, cachedMovements) {
  const movements = cachedMovements || new Movements(bot);
  bot.pathfinder.setMovements(movements);
  return movements;
}

/**
 * Navigate bot to a goal with a timeout.
 * @param {object} bot - mineflayer bot
 * @param {object} goal - pathfinder goal (GoalNear, GoalBlock, etc.)
 * @param {number} timeoutMs - max navigation time (default 30s)
 * @returns {Promise<void>}
 */
function goto(bot, goal, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      bot.pathfinder.stop();
      reject(new Error(`Pathfinding timeout after ${timeoutMs}ms`));
    }, timeoutMs);

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
