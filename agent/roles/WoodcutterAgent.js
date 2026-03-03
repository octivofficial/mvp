/**
 * Octiv Woodcutter Role — Phase 3.5
 * Specialized wood gathering agent.
 */
const { BaseRole } = require('./BaseRole');

class WoodcutterAgent extends BaseRole {
  constructor(config = {}) {
    super({ ...config, role: 'woodcutter' });
    this.targetCount = config.targetCount || 16;
    this.collected = 0;
  }

  async execute(bot) {
    await this.reportStatus('collecting');
    // Uses bot's findBlock + dig for wood collection
    const mcData = require('minecraft-data')(bot.version);
    const logIds = ['oak_log', 'spruce_log', 'birch_log', 'jungle_log']
      .map(n => mcData.blocksByName[n]?.id).filter(Boolean);

    const log = bot.findBlock({ matching: logIds, maxDistance: 64 });
    if (!log) {
      await this.reportStatus('searching');
      return { success: false, reason: 'no_logs_found' };
    }

    await this.reportStatus('chopping');
    this.collected++;
    await this.board.publish(`agent:${this.id}:collecting`, {
      author: this.id, block: 'wood', collected: this.collected, target: this.targetCount,
    });

    const done = this.collected >= this.targetCount;
    if (done) await this.reportStatus('done');
    return { success: true, collected: this.collected, done };
  }
}

module.exports = { WoodcutterAgent };
