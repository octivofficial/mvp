const { describe, it } = require('node:test');
const assert = require('node:assert');
const { ObsidianCLIAgent } = require('../agent/obsidian-cli-agent.js');

describe('ObsidianCLIAgent', () => {
  it('should initialize with a vault path', () => {
    const config = { vaultPath: '/Users/octiv/my-vault' };
    const agent = new ObsidianCLIAgent(config);
    assert.strictEqual(agent.vaultPath, '/Users/octiv/my-vault');
  });

  it('should format open command correctly', () => {
    const agent = new ObsidianCLIAgent({ vaultPath: 'my-vault' });
    const cmd = agent._formatCommand('open', 'Note Title');
    // Expected: obsidian://open?vault=my-vault&file=Note%20Title
    assert.ok(cmd.includes('obsidian://open'));
    assert.ok(cmd.includes('vault=my-vault'));
    assert.ok(cmd.includes('file=Note%20Title'));
  });

  it('should publish execution results to blackboard', async () => {
    let publishedMsg = null;
    const mockBoard = {
      publish: async (channel, msg) => {
        publishedMsg = { channel, msg };
      },
      createSubscriber: async () => ({ subscribe: () => {} })
    };
    
    const agent = new ObsidianCLIAgent({ vaultPath: 'v' }, mockBoard);
    // Mocking exec logic internally or providing a stub
    agent.execCommand = async () => ({ status: 'success' });
    
    await agent.handleTask({ action: 'open', file: 'Test' });
    
    assert.strictEqual(publishedMsg.channel, 'obsidian:cli:finished');
    assert.strictEqual(publishedMsg.msg.status, 'success');
  });
});
