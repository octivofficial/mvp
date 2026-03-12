const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const ObsidianOrganizer = require('../agent/obsidian-agent.js');

describe('ObsidianAgent -> Vault Watcher', () => {
  it('should initialize watcher on vaultPath', async () => {
    const mockWatcher = {
      on: mock.fn(() => mockWatcher)
    };
    const mockWatcherFactory = mock.fn(() => mockWatcher);

    const config = { vaultPath: '/tmp/vault' };
    const mockBoard = { connect: async () => {}, createSubscriber: async () => ({}) };
    
    // Inject mock watcher factory via startWatcher parameter
    const agent = new ObsidianOrganizer(config, mockBoard);
    agent.startWatcher(mockWatcherFactory);

    assert.strictEqual(mockWatcherFactory.mock.calls.length, 1);
    assert.strictEqual(mockWatcherFactory.mock.calls[0].arguments[0], '/tmp/vault');
    assert.ok(mockWatcher.on.mock.calls.length >= 2, 'Should listen to add and change events');
  });
});
