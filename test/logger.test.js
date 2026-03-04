/**
 * Tests for agent/logger.js — Structured Logger
 */
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { Logger } = require('../agent/logger');

describe('Logger', () => {
  describe('constructor', () => {
    it('creates with default options', () => {
      const logger = new Logger({ persist: false });
      assert.ok(logger);
      assert.equal(logger.consoleEnabled, true);
      assert.equal(logger.persistEnabled, false);
    });

    it('respects minLevel option', () => {
      const logger = new Logger({ minLevel: 'warn', persist: false });
      assert.equal(logger.minRank, 2); // warn = rank 2
    });

    it('respects console=false option', () => {
      const logger = new Logger({ console: false, persist: false });
      assert.equal(logger.consoleEnabled, false);
    });

    it('creates MemoryLogger when persist=true', () => {
      const logger = new Logger({ persist: true, logDir: '/tmp/test-logger' });
      assert.ok(logger.memoryLogger);
    });

    it('does not create MemoryLogger when persist=false', () => {
      const logger = new Logger({ persist: false });
      assert.equal(logger.memoryLogger, null);
    });

    it('accepts custom MemoryLogger instance', () => {
      const mockML = { logEvent: async () => {} };
      const logger = new Logger({ memoryLogger: mockML });
      assert.equal(logger.memoryLogger, mockML);
    });
  });

  describe('level filtering', () => {
    it('filters out debug when minLevel=info', () => {
      const logs = [];
      const logger = new Logger({
        minLevel: 'info',
        persist: false,
        console: false,
      });
      // Monkey-patch to capture calls
      logger._log = function(level, agentId, msg, data) {
        const levelDef = { debug: { rank: 0 }, info: { rank: 1 }, warn: { rank: 2 }, error: { rank: 3 } };
        if (levelDef[level].rank >= this.minRank) {
          logs.push({ level, agentId, msg });
        }
      };
      logger.debug('test', 'should not appear');
      logger.info('test', 'should appear');
      assert.equal(logs.length, 1);
      assert.equal(logs[0].level, 'info');
    });

    it('allows all levels when minLevel=debug', () => {
      const logs = [];
      const logger = new Logger({
        minLevel: 'debug',
        persist: false,
        console: false,
      });
      logger._log = function(level, agentId, msg) {
        const levelDef = { debug: { rank: 0 }, info: { rank: 1 }, warn: { rank: 2 }, error: { rank: 3 } };
        if (levelDef[level].rank >= this.minRank) {
          logs.push({ level });
        }
      };
      logger.debug('a', 'msg');
      logger.info('a', 'msg');
      logger.warn('a', 'msg');
      logger.error('a', 'msg');
      assert.equal(logs.length, 4);
    });

    it('only allows error when minLevel=error', () => {
      const logs = [];
      const logger = new Logger({
        minLevel: 'error',
        persist: false,
        console: false,
      });
      logger._log = function(level, agentId, msg) {
        const levelDef = { debug: { rank: 0 }, info: { rank: 1 }, warn: { rank: 2 }, error: { rank: 3 } };
        if (levelDef[level].rank >= this.minRank) {
          logs.push({ level });
        }
      };
      logger.debug('a', 'msg');
      logger.info('a', 'msg');
      logger.warn('a', 'msg');
      logger.error('a', 'msg');
      assert.equal(logs.length, 1);
      assert.equal(logs[0].level, 'error');
    });
  });

  describe('console output', () => {
    let originalLog, originalWarn, originalError;
    let captured;

    beforeEach(() => {
      captured = [];
      originalLog = console.log;
      originalWarn = console.warn;
      originalError = console.error;
      console.log = (...args) => captured.push({ fn: 'log', args });
      console.warn = (...args) => captured.push({ fn: 'warn', args });
      console.error = (...args) => captured.push({ fn: 'error', args });
    });

    // Restore console after each test
    afterEach(() => {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
    });

    it('formats info output as [INFO] [agentId] message', () => {
      const logger = new Logger({ persist: false, minLevel: 'debug' });
      logger.info('bot-01', 'spawned successfully');
      assert.equal(captured.length, 1);
      assert.equal(captured[0].fn, 'log');
      assert.ok(captured[0].args[0].includes('[INFO]'));
      assert.ok(captured[0].args[0].includes('[bot-01]'));
      assert.ok(captured[0].args[0].includes('spawned successfully'));
    });

    it('formats warn output with console.warn', () => {
      const logger = new Logger({ persist: false, minLevel: 'debug' });
      logger.warn('safety', 'threat detected');
      assert.equal(captured.length, 1);
      assert.equal(captured[0].fn, 'warn');
      assert.ok(captured[0].args[0].includes('[WARN]'));
    });

    it('formats error output with console.error', () => {
      const logger = new Logger({ persist: false, minLevel: 'debug' });
      logger.error('leader', 'failed');
      assert.equal(captured.length, 1);
      assert.equal(captured[0].fn, 'error');
      assert.ok(captured[0].args[0].includes('[ERROR]'));
    });

    it('includes data object when provided', () => {
      const logger = new Logger({ persist: false, minLevel: 'debug' });
      logger.info('bot-01', 'status', { health: 20 });
      assert.equal(captured.length, 1);
      assert.equal(captured[0].args.length, 2); // prefix+msg, data
      assert.deepEqual(captured[0].args[1], { health: 20 });
    });

    it('omits data when empty object', () => {
      const logger = new Logger({ persist: false, minLevel: 'debug' });
      logger.info('bot-01', 'idle', {});
      assert.equal(captured.length, 1);
      assert.equal(captured[0].args.length, 1); // no data arg
    });

    it('does not output when console=false', () => {
      const logger = new Logger({ persist: false, console: false });
      logger.info('bot-01', 'silent');
      assert.equal(captured.length, 0);
    });
  });

  describe('persistence', () => {
    it('calls memoryLogger.logEvent with structured data', async () => {
      const events = [];
      const mockML = {
        logEvent: async (agentId, event) => {
          events.push({ agentId, event });
        },
      };
      const logger = new Logger({ memoryLogger: mockML, console: false });
      logger.info('bot-01', 'test message', { key: 'val' });

      // Wait for async fire-and-forget
      await new Promise(r => setTimeout(r, 10));
      assert.equal(events.length, 1);
      assert.equal(events[0].agentId, 'bot-01');
      assert.equal(events[0].event.type, 'log');
      assert.equal(events[0].event.level, 'info');
      assert.equal(events[0].event.message, 'test message');
      assert.equal(events[0].event.key, 'val');
    });

    it('handles memoryLogger errors gracefully', async () => {
      const mockML = {
        logEvent: async () => { throw new Error('disk full'); },
      };
      const logger = new Logger({ memoryLogger: mockML, console: false });
      // Should not throw
      logger.error('bot-01', 'test');
      await new Promise(r => setTimeout(r, 10));
      // No assertion needed — just verifying it doesn't crash
    });
  });

  describe('convenience methods', () => {
    it('has debug, info, warn, error methods', () => {
      const logger = new Logger({ persist: false, console: false });
      assert.equal(typeof logger.debug, 'function');
      assert.equal(typeof logger.info, 'function');
      assert.equal(typeof logger.warn, 'function');
      assert.equal(typeof logger.error, 'function');
    });
  });

  describe('getLogger singleton', () => {
    const { getLogger } = require('../agent/logger');

    beforeEach(() => {
      getLogger.reset();
    });

    afterEach(() => {
      getLogger.reset();
    });

    it('returns a Logger instance', () => {
      const logger = getLogger();
      assert.ok(logger instanceof Logger);
    });

    it('returns the same instance on subsequent calls', () => {
      const a = getLogger();
      const b = getLogger();
      assert.equal(a, b);
    });

    it('reset() causes next call to create a new instance', () => {
      const a = getLogger();
      getLogger.reset();
      const b = getLogger();
      assert.notEqual(a, b);
    });

    it('configure() replaces the singleton with custom options', () => {
      const logger = getLogger.configure({ minLevel: 'error', persist: false });
      assert.ok(logger instanceof Logger);
      assert.equal(logger.minRank, 3); // error = rank 3
      assert.equal(getLogger(), logger); // same instance returned
    });

    it('configure() overrides a previously created singleton', () => {
      const first = getLogger();
      const second = getLogger.configure({ minLevel: 'warn', persist: false });
      assert.notEqual(first, second);
      assert.equal(getLogger(), second);
    });

    it('getLogger() takes no options parameter', () => {
      // Verify the function signature — length should be 0
      assert.equal(getLogger.length, 0);
    });
  });
});
