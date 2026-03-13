/**
 * Octiv Memory Logger — AC-7: Persistent disk logging for agent events
 * Writes JSONL files per agent for post-mortem analysis and cross-session learning.
 * Includes log rotation: files > MAX_FILE_SIZE are rotated, old rotations pruned.
 */
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB per agent log
const MAX_ROTATIONS = 3; // keep up to 3 rotated files (.1, .2, .3)

class MemoryLogger {
  constructor(logDir = LOG_DIR, options = {}) {
    this.logDir = logDir;
    this.maxFileSize = options.maxFileSize || MAX_FILE_SIZE;
    this.maxRotations = options.maxRotations || MAX_ROTATIONS;
    this._sizeCache = new Map(); // agentId → approximate byte count
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  async logEvent(agentId, event) {
    const entry = JSON.stringify({ ts: Date.now(), agentId, ...event }) + '\n';
    const filePath = path.join(this.logDir, `${agentId}.jsonl`);
    try {
      await this._rotateIfNeeded(agentId, filePath);
      await fsp.appendFile(filePath, entry);
      // Update size cache
      const cached = this._sizeCache.get(agentId) || 0;
      this._sizeCache.set(agentId, cached + Buffer.byteLength(entry));
    } catch (err) {
      if (err.code === 'EPERM') {
        // Silently fail on permission errors (read-only filesystem)
        return;
      }
      console.error(`[MemoryLogger] write failed for ${agentId}: ${err.message}`);
    }
  }

  async _rotateIfNeeded(agentId, filePath) {
    // Check size cache first to avoid stat() on every write
    let size = this._sizeCache.get(agentId);
    if (size === undefined) {
      try {
        const stat = await fsp.stat(filePath);
        size = stat.size;
        this._sizeCache.set(agentId, size);
      } catch (err) {
        if (err.code === 'ENOENT') {
          this._sizeCache.set(agentId, 0);
          return; // file doesn't exist yet
        }
        throw err;
      }
    }

    if (size < this.maxFileSize) return;

    // Rotate: .3 → delete, .2 → .3, .1 → .2, current → .1
    for (let i = this.maxRotations; i >= 1; i--) {
      const src = i === 1 ? filePath : `${filePath}.${i - 1}`;
      const dst = `${filePath}.${i}`;
      try {
        if (i === this.maxRotations) {
          await fsp.unlink(dst).catch(() => {}); // delete oldest
        }
        await fsp.rename(src, dst);
      } catch (err) {
        if (err.code !== 'ENOENT') {
          console.error(`[MemoryLogger] rotation error for ${agentId}: ${err.message}`);
        }
      }
    }

    // Reset size cache after rotation
    this._sizeCache.set(agentId, 0);
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
    // Also clean up rotated files
    for (let i = 1; i <= this.maxRotations; i++) {
      try {
        await fsp.unlink(`${filePath}.${i}`);
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
    }
    this._sizeCache.delete(agentId);
  }
}

module.exports = { MemoryLogger };
