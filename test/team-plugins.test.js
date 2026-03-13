/**
 * Tests for team-plugins.js — optional agent initialization
 * Usage: node --test --test-force-exit test/team-plugins.test.js
 */
const { describe, it, mock, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// Mock all optional dependencies before require
const mockBoard = {
  connect: mock.fn(async () => {}),
  publish: mock.fn(async () => {}),
  get: mock.fn(async () => null),
  createSubscriber: mock.fn(async () => ({
    subscribe: mock.fn(async () => {}),
    unsubscribe: mock.fn(async () => {}),
    disconnect: mock.fn(async () => {}),
  })),
};

const mockReflexion = {
  addEntry: mock.fn(async () => {}),
};

describe('team-plugins — initPlugins', () => {
  beforeEach(() => {
    // Reset env
    delete process.env.ENABLE_TELEGRAM_BOT;
    delete process.env.TELEGRAM_BOT_TOKEN;
  });

  it('should return all plugin keys even when all fail to init', async () => {
    const { initPlugins } = require('../agent/team-plugins');
    const plugins = await initPlugins({ board: mockBoard, reflexion: mockReflexion });

    // All plugins should be present as keys (null if failed)
    assert.ok('telegramBot' in plugins);
    assert.ok('obsidianAgent' in plugins);
    assert.ok('discordBot' in plugins);
    assert.ok('crawlerAgent' in plugins);
    assert.ok('workspaceAgent' in plugins);
    assert.ok('notebookAgent' in plugins);
    assert.ok('youtubeAgent' in plugins);
    assert.ok('obsidianCliAgent' in plugins);
  });

  it('should skip telegram when ENABLE_TELEGRAM_BOT=false', async () => {
    process.env.ENABLE_TELEGRAM_BOT = 'false';
    const { initPlugins } = require('../agent/team-plugins');
    const plugins = await initPlugins({ board: mockBoard, reflexion: mockReflexion });

    assert.equal(plugins.telegramBot, null);
  });

  it('should not crash when board or reflexion are minimal objects', async () => {
    const { initPlugins } = require('../agent/team-plugins');
    const plugins = await initPlugins({ board: {}, reflexion: {} });

    // Should return an object with all plugin keys — values may be null or initialized
    assert.ok(typeof plugins === 'object', 'Should return plugins object');
    assert.ok('telegramBot' in plugins, 'Should have telegramBot key');
    assert.ok('discordBot' in plugins, 'Should have discordBot key');
  });
});
