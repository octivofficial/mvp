const { describe, it, mock, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs/promises');
const path = require('path');
const ObsidianOrganizer = require('../agent/obsidian-agent.js');

describe('ObsidianAgent -> File Handling', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('should write PRD content to vault/01-Requirements', async () => {
    // Mock fs.writeFile and fs.mkdir
    mock.method(fs, 'writeFile', async () => {});
    mock.method(fs, 'mkdir', async () => {});

    const config = { vaultPath: '/tmp/vault', blackboardUrl: 'dummy' };
    const mockBoard = { connect: async () => {}, createSubscriber: async () => ({}) };
    const agent = new ObsidianOrganizer(config, mockBoard);

    const prdData = {
      title: 'Flying Car Spec',
      content: '## Requirements\n- Must fly\n- Must be a car',
      author: 'telegram-bot'
    };

    await agent.handlePRD(prdData);

    assert.strictEqual(fs.writeFile.mock.calls.length, 1);
    
    const callArgs = fs.writeFile.mock.calls[0].arguments;
    // Expected path: /tmp/vault/01-Requirements/flying-car-spec.md
    assert.ok(callArgs[0].includes('01-Requirements'));
    assert.ok(callArgs[0].includes('flying-car-spec.md'));
    assert.ok(callArgs[1].includes('## Requirements'));
    assert.ok(callArgs[1].includes('author: telegram-bot'));
  });
});
