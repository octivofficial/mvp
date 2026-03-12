/**
 * Octiv PathfindingQueue — Phase 4, Requirement 7
 *
 * FIFO pathfinding queue system for Octiv agents.
 * Wraps bot.pathfinder.goto with dynamic timeout, retry logic, and Blackboard metrics.
 *
 * Public API:
 *   enqueue(goal)                   — add goal { x, y, z, label? } to queue, returns queue length
 *   calculateTimeout(distance)      — baseTimeoutMs + (distance / 50) * 30000
 *   calculateDistance(goal)         — Euclidean distance from bot.entity.position to goal
 *   process()                       — process one item (FIFO), retry up to 3 times on failure
 *   processAll()                    — drain entire queue, return array of results
 *   publishMetrics(metrics)         — write to board.setConfig + board.publish
 *
 * Constructor: new PathfindingQueue({ board, bot, agentId, baseTimeoutMs = 30000 })
 */
const { getLogger } = require('./logger');
const log = getLogger();

class PathfindingQueue {
  /**
   * @param {object} options
   * @param {object} options.board         - Blackboard instance (setConfig / publish)
   * @param {object} options.bot           - mineflayer bot (bot.pathfinder.goto(goal) async)
   * @param {string} options.agentId       - string identifier for this agent
   * @param {number} [options.baseTimeoutMs=30000] - base timeout in ms for pathfinding
   */
  constructor({ board, bot, agentId, baseTimeoutMs = 30000 }) {
    this.board = board;
    this.bot = bot;
    this.agentId = agentId;
    this.baseTimeoutMs = baseTimeoutMs;
    this.queue = [];
    this.metrics = {
      totalGoals: 0,
      successCount: 0,
      failCount: 0,
      totalDistance: 0,
    };
  }

  /**
   * Add a goal to the FIFO queue.
   * @param {{ x: number, y: number, z: number, label?: string }} goal
   * @returns {number} new queue length
   */
  enqueue(goal) {
    this.queue.push(goal);
    return this.queue.length;
  }

  /**
   * Calculate dynamic timeout based on distance.
   * Formula: baseTimeoutMs + (distance / 50) * 30000
   * @param {number} distance - Euclidean distance in blocks
   * @returns {number} timeout in milliseconds
   */
  calculateTimeout(distance) {
    return this.baseTimeoutMs + (distance / 50) * 30000;
  }

  /**
   * Calculate Euclidean distance from bot.entity.position to goal.
   * @param {{ x: number, y: number, z: number }} goal
   * @returns {number} distance in blocks
   */
  calculateDistance(goal) {
    const pos = this.bot.entity.position;
    const dx = goal.x - pos.x;
    const dy = goal.y - pos.y;
    const dz = goal.z - pos.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /**
   * Process ONE item from the front of the queue (FIFO).
   * Retries up to 3 total attempts on failure.
   * On success: increments successCount and publishes metrics.
   * On failure: increments failCount and publishes metrics.
   * @returns {Promise<{ success: boolean, attempts: number, goal: object|null }>}
   */
  async process() {
    if (this.queue.length === 0) {
      return { success: false, attempts: 0, goal: null };
    }

    const goal = this.queue.shift();
    this.metrics.totalGoals += 1;

    const distance = this.calculateDistance(goal);
    this.metrics.totalDistance += distance;

    const maxAttempts = 3;
    let attempts = 0;
    let success = false;

    while (attempts < maxAttempts && !success) {
      attempts += 1;
      try {
        await this.bot.pathfinder.goto(goal);
        success = true;
      } catch (err) {
        log.warn('pathfinding-queue', `goto attempt ${attempts} failed for ${this.agentId}`, {
          goal,
          error: err.message,
        });
      }
    }

    if (success) {
      this.metrics.successCount += 1;
      log.info('pathfinding-queue', `navigation succeeded in ${attempts} attempt(s)`, {
        agentId: this.agentId,
        goal,
        distance,
      });
    } else {
      this.metrics.failCount += 1;
      log.warn('pathfinding-queue', `navigation failed after ${maxAttempts} attempts`, {
        agentId: this.agentId,
        goal,
      });
    }

    await this.publishMetrics(this.metrics);

    return { success, attempts, goal };
  }

  /**
   * Process all queued goals in FIFO order.
   * @returns {Promise<Array<{ success: boolean, attempts: number, goal: object }>>}
   */
  async processAll() {
    const results = [];
    while (this.queue.length > 0) {
      const result = await this.process();
      results.push(result);
    }
    return results;
  }

  /**
   * Publish pathfinding metrics to the Blackboard.
   * 1. Stores metrics under pathfinding:metrics:{agentId} via board.setConfig
   * 2. Publishes update event on pathfinding:metrics:updated
   *
   * @param {object} metrics - metrics object to publish
   */
  async publishMetrics(metrics) {
    const key = `pathfinding:metrics:${this.agentId}`;
    const channel = 'pathfinding:metrics:updated';

    await this.board.setConfig(key, metrics);
    await this.board.publish(channel, {
      agentId: this.agentId,
      ...metrics,
      author: 'pathfinding-queue',
    });

    log.info('pathfinding-queue', 'metrics published', {
      agentId: this.agentId,
      ...metrics,
    });
  }
}

module.exports = { PathfindingQueue };
