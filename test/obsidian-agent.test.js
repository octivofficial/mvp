const { describe, it } = require('node:test');
const assert = require('node:assert');
const ObsidianOrganizer = require('../agent/obsidian-agent.js');

describe('ObsidianOrganizer', () => {
  it('should throw an error if no vault path is provided', () => {
    assert.throws(() => {
      new ObsidianOrganizer();
    }, /Missing vault path/);
  });

  it('should initialize successfully with valid config', () => {
    const config = {
      vaultPath: '/tmp/dummy-vault',
      blackboardUrl: 'redis://localhost:6380'
    };
    const mockBoard = { connect: async () => {}, createSubscriber: async () => ({}) };
    const agent = new ObsidianOrganizer(config, mockBoard);
    assert.ok(agent);
    assert.strictEqual(agent.vaultPath, '/tmp/dummy-vault');
  });
});
