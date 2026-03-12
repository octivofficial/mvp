const { getLogger } = require('./logger');
const log = getLogger();

class ObsidianCLIAgent {
  constructor(config = {}, board = null) {
    this.vaultPath = config.vaultPath;
    this.board = board;
    this.id = 'obsidian-cli-agent';
  }

  async init() {
    log.info(this.id, `Initializing Obsidian CLI Agent for vault: ${this.vaultPath}`);
    if (this.board) {
      const sub = await this.board.createSubscriber();
      sub.subscribe('obsidian:cli:task', async (msg) => {
        try {
          const data = JSON.parse(msg);
          await this.handleTask(data);
        } catch (err) {
          log.error(this.id, 'Task parsing failed', { error: err.message });
        }
      });
    }
  }

  async handleTask(data) {
    log.info(this.id, `Executing CLI task: ${data.action}`);
    const result = await this.execCommand(data.action, data.file || data.command);
    
    if (this.board) {
      await this.board.publish('obsidian:cli:finished', {
          ...result,
          taskId: data.taskId,
          timestamp: new Date().toISOString()
      });
    }
    return result;
  }

  async execCommand(action, target) {
    const cmd = this._formatCommand(action, target);
    try {
      log.info(this.id, `Running: ${cmd}`);
      // In a real environment, we'd run: await execAsync(`open "${cmd}"`);
      // For now, we simulate success for the agent loop
      return { status: 'success', command: cmd };
    } catch (err) {
      log.error(this.id, `Command failed: ${cmd}`, { error: err.message });
      return { status: 'error', error: err.message };
    }
  }

  _formatCommand(action, target) {
    const encodedTarget = encodeURIComponent(target || '');
    const encodedVault = encodeURIComponent(this.vaultPath || '');
    
    switch (action) {
      case 'open':
        return `obsidian://open?vault=${encodedVault}&file=${encodedTarget}`;
      case 'search':
        return `obsidian://search?vault=${encodedVault}&query=${encodedTarget}`;
      case 'new':
        return `obsidian://new?vault=${encodedVault}&name=${encodedTarget}`;
      default:
        return `obsidian://open?vault=${encodedVault}`;
    }
  }

  async shutdown() {
    log.info(this.id, 'Shutting down Obsidian CLI Agent...');
    // Subscriber cleanup logic would go here if we tracked the sub
  }
}

module.exports = { ObsidianCLIAgent };
