/**
 * MemoryLogger unit tests — coverage for error paths
 * Usage: node --test --test-force-exit test/memory-logger.test.js
 */
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');
const fsp = require('fs/promises');

const { MemoryLogger } = require('../agent/memory-logger');

describe('MemoryLogger — logEvent', () => {
  let logger, tmpDir;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `octiv-memlog-test-${Date.now()}`);
    logger = new MemoryLogger(tmpDir);
  });

  afterEach(async () => {
    try { await fsp.rm(tmpDir, { recursive: true }); } catch {}
  });

  it('should write JSONL entry to file', async () => {
    await logger.logEvent('test-agent', { type: 'test', data: 'hello' });
    const content = await fsp.readFile(path.join(tmpDir, 'test-agent.jsonl'), 'utf-8');
    const entry = JSON.parse(content.trim());
    assert.equal(entry.agentId, 'test-agent');
    assert.equal(entry.type, 'test');
    assert.ok(entry.ts > 0);
  });

  it('should handle write failure gracefully', async () => {
    // Make the log dir read-only to cause write failure
    await fsp.chmod(tmpDir, 0o444);
    // Should not throw
    await logger.logEvent('test-agent', { type: 'fail' });
    // Restore permissions for cleanup
    await fsp.chmod(tmpDir, 0o755);
  });
});

describe('MemoryLogger — getHistory', () => {
  let logger, tmpDir;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `octiv-memlog-test-${Date.now()}`);
    logger = new MemoryLogger(tmpDir);
  });

  afterEach(async () => {
    try { await fsp.rm(tmpDir, { recursive: true }); } catch {}
  });

  it('should return empty array for non-existent agent', async () => {
    const history = await logger.getHistory('nonexistent-agent');
    assert.deepEqual(history, []);
  });

  it('should return parsed entries', async () => {
    await logger.logEvent('test-agent', { type: 'a' });
    await logger.logEvent('test-agent', { type: 'b' });
    const history = await logger.getHistory('test-agent');
    assert.equal(history.length, 2);
    assert.equal(history[0].type, 'a');
    assert.equal(history[1].type, 'b');
  });

  it('should throw on non-ENOENT errors', async () => {
    // Create a directory where the file would be — readFile on directory triggers EISDIR
    const filePath = path.join(tmpDir, 'bad-agent.jsonl');
    fs.mkdirSync(filePath, { recursive: true });
    await assert.rejects(
      () => logger.getHistory('bad-agent'),
      (err) => err.code === 'EISDIR' || err.code === 'ENOTDIR'
    );
  });
});

describe('MemoryLogger — getByType', () => {
  let logger, tmpDir;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `octiv-memlog-test-${Date.now()}`);
    logger = new MemoryLogger(tmpDir);
  });

  afterEach(async () => {
    try { await fsp.rm(tmpDir, { recursive: true }); } catch {}
  });

  it('should filter entries by type', async () => {
    await logger.logEvent('agent', { type: 'alpha' });
    await logger.logEvent('agent', { type: 'beta' });
    await logger.logEvent('agent', { type: 'alpha' });
    const filtered = await logger.getByType('agent', 'alpha');
    assert.equal(filtered.length, 2);
  });
});

describe('MemoryLogger — log rotation', () => {
  let logger, tmpDir;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `octiv-memlog-rotate-${Date.now()}`);
    // Use tiny maxFileSize to trigger rotation quickly
    logger = new MemoryLogger(tmpDir, { maxFileSize: 200, maxRotations: 2 });
  });

  afterEach(async () => {
    try { await fsp.rm(tmpDir, { recursive: true }); } catch {}
  });

  it('should rotate log files when exceeding maxFileSize', async () => {
    // Write enough data to exceed 200 bytes
    for (let i = 0; i < 10; i++) {
      await logger.logEvent('rotate-agent', { type: 'test', i, padding: 'x'.repeat(30) });
    }

    const rotatedFile = path.join(tmpDir, 'rotate-agent.jsonl.1');
    const exists = fs.existsSync(rotatedFile);
    assert.ok(exists, 'Rotated file .1 should exist after exceeding maxFileSize');
  });

  it('should prune oldest rotation beyond maxRotations', async () => {
    // Write lots of data to trigger multiple rotations
    for (let i = 0; i < 30; i++) {
      await logger.logEvent('prune-agent', { type: 'test', i, padding: 'x'.repeat(50) });
    }

    // With maxRotations=2, .3 should NOT exist
    const file3 = path.join(tmpDir, 'prune-agent.jsonl.3');
    assert.ok(!fs.existsSync(file3), 'File .3 should be pruned (maxRotations=2)');

    // Current file should still be writable
    const current = path.join(tmpDir, 'prune-agent.jsonl');
    assert.ok(fs.existsSync(current), 'Current log file should exist');
  });

  it('should clear rotated files too', async () => {
    for (let i = 0; i < 10; i++) {
      await logger.logEvent('clear-agent', { type: 'test', i, padding: 'x'.repeat(30) });
    }

    await logger.clear('clear-agent');

    const current = path.join(tmpDir, 'clear-agent.jsonl');
    const rotated1 = path.join(tmpDir, 'clear-agent.jsonl.1');
    assert.ok(!fs.existsSync(current), 'Current log should be cleared');
    assert.ok(!fs.existsSync(rotated1), 'Rotated log should be cleared');
  });
});

describe('MemoryLogger — clear', () => {
  let logger, tmpDir;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `octiv-memlog-test-${Date.now()}`);
    logger = new MemoryLogger(tmpDir);
  });

  afterEach(async () => {
    try { await fsp.rm(tmpDir, { recursive: true }); } catch {}
  });

  it('should delete agent log file', async () => {
    await logger.logEvent('agent', { type: 'x' });
    await logger.clear('agent');
    const history = await logger.getHistory('agent');
    assert.deepEqual(history, []);
  });

  it('should not throw for non-existent file', async () => {
    await logger.clear('nonexistent');
    // no error = pass
  });
});
