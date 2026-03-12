/**
 * Octiv InventoryTracker — Phase 3, Requirement 4
 *
 * Tracks an agent's inventory state by reading from the mineflayer bot,
 * applying consumption/acquisition deltas, and publishing to the Blackboard.
 *
 * Public API:
 *   getInventory()                    — read bot items, update & return this.state
 *   trackConsumption(itemName, count) — decrement state[itemName] (floor at 0)
 *   trackAcquisition(itemName, count) — increment state[itemName]
 *   publish()                         — write state to board.setConfig + board.publish
 *   hasItem(itemName, count=1)        — boolean availability check against this.state
 *
 * Constructor: new InventoryTracker({ board, bot, agentId })
 */
const { getLogger } = require('./logger');
const log = getLogger();

class InventoryTracker {
  /**
   * @param {object} options
   * @param {object} options.board   - Blackboard instance (setConfig / publish)
   * @param {object} options.bot     - mineflayer bot (bot.inventory.items() -> [{name, count}])
   * @param {string} options.agentId - string identifier for this agent
   */
  constructor({ board, bot, agentId }) {
    this.board = board;
    this.bot = bot;
    this.agentId = agentId;
    this.state = {};
  }

  /**
   * Read items from the mineflayer bot and aggregate them by name.
   * Updates this.state with the result.
   * Returns the aggregated inventory object, or {} on error.
   *
   * @returns {Promise<object>} plain object of { itemName: totalCount }
   */
  async getInventory() {
    try {
      const items = this.bot.inventory.items();
      const aggregated = {};
      for (const item of items) {
        aggregated[item.name] = (aggregated[item.name] || 0) + item.count;
      }
      this.state = aggregated;
      return aggregated;
    } catch (err) {
      log.warn('inventory-tracker', 'getInventory failed, returning empty state', {
        agentId: this.agentId,
        error: err.message,
      });
      return {};
    }
  }

  /**
   * Decrement the count of an item in this.state.
   * Count is clamped to a minimum of 0 (never goes negative).
   *
   * @param {string} itemName - item name to consume
   * @param {number} count    - amount consumed
   */
  trackConsumption(itemName, count) {
    const current = this.state[itemName] || 0;
    this.state[itemName] = Math.max(0, current - count);
    log.debug('inventory-tracker', `consumed ${count}x ${itemName}`, {
      agentId: this.agentId,
      remaining: this.state[itemName],
    });
  }

  /**
   * Increment the count of an item in this.state.
   * Creates the key if it does not yet exist.
   *
   * @param {string} itemName - item name acquired
   * @param {number} count    - amount acquired
   */
  trackAcquisition(itemName, count) {
    this.state[itemName] = (this.state[itemName] || 0) + count;
    log.debug('inventory-tracker', `acquired ${count}x ${itemName}`, {
      agentId: this.agentId,
      total: this.state[itemName],
    });
  }

  /**
   * Publish current inventory state to the Blackboard.
   * 1. Stores state under agent:{agentId}:inventory via board.setConfig
   * 2. Publishes change event on agent:{agentId}:inventory:updated
   *
   * The publish payload includes an author field required by Blackboard validation.
   */
  async publish() {
    const key = `agent:${this.agentId}:inventory`;
    const channel = `agent:${this.agentId}:inventory:updated`;

    await this.board.setConfig(key, this.state);
    await this.board.publish(channel, {
      agentId: this.agentId,
      inventory: this.state,
      author: 'inventory-tracker',
    });

    log.info('inventory-tracker', 'inventory published', {
      agentId: this.agentId,
      items: Object.keys(this.state).length,
    });
  }

  /**
   * Check whether this.state contains at least `count` of `itemName`.
   *
   * @param {string} itemName    - item to check
   * @param {number} [count=1]   - minimum required quantity
   * @returns {boolean}
   */
  hasItem(itemName, count = 1) {
    return (this.state[itemName] || 0) >= count;
  }
}

module.exports = { InventoryTracker };
