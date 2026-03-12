/**
 * Octiv Memory Logger — AC-7: Persistent disk logging for agent events
 * Writes JSONL files per agent for post-mortem analysis and cross-session learning.
 */
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');

class MemoryLogger {
  constructor(logDir = LOG_DIR) {
    this.logDir = logDir;
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  async logEvent(agentId, event) {
    const entry = JSON.stringify({ ts: Date.now(), agentId, ...event }) + '\n';
    const filePath = path.join(this.logDir, `${agentId}.jsonl`);
    try {
      await fsp.appendFile(filePath, entry);
    } catch (err) {
      if (err.code === 'EPERM') {
        // Silently fail or track in memory if needed
        return;
      }
      console.error(`[MemoryLogger] write failed for ${agentId}: ${err.message}`);
    }
  }

  async getHistory(agentId) {
    const filePath = path.join(this.logDir, `${agentId}.jsonl`);
    try {
      const data = await fsp.readFile(filePath, 'utf-8');
      return data.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  }

  async getByType(agentId, type) {
    const history = await this.getHistory(agentId);
    return history.filter(e => e.type === type);
  }

  async clear(agentId) {
    const filePath = path.join(this.logDir, `${agentId}.jsonl`);
    try {
      await fsp.unlink(filePath);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }
}

module.exports = { MemoryLogger };
