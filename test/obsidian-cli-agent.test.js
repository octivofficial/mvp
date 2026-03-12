const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const { ObsidianCLIAgent } = require('../agent/obsidian-cli-agent.js');

const makeBoard = () => ({
  createSubscriber: mock.fn(async () => ({ subscribe: mock.fn(async () => {}) })),
  publish: mock.fn(async () => {})
});

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

describe('ObsidianCLIAgent init()', () => {
  it('calls createSubscriber when board is provided', async () => {
    const board = makeBoard();
    const agent = new ObsidianCLIAgent({ vaultPath: 'vault' }, board);
    await agent.init();
    assert.strictEqual(board.createSubscriber.mock.calls.length, 1);
  });

  it('registers subscriber for obsidian:cli:task channel', async () => {
    const sub = { subscribe: mock.fn(async () => {}) };
    const board = {
      createSubscriber: mock.fn(async () => sub),
      publish: mock.fn(async () => {})
    };
    const agent = new ObsidianCLIAgent({ vaultPath: 'vault' }, board);
    await agent.init();
    assert.strictEqual(sub.subscribe.mock.calls.length, 1);
    assert.strictEqual(sub.subscribe.mock.calls[0].arguments[0], 'obsidian:cli:task');
  });

  it('does not call createSubscriber when board is null', async () => {
    const agent = new ObsidianCLIAgent({ vaultPath: 'vault' });
    // Should not throw
    await agent.init();
    assert.strictEqual(agent.board, null);
  });

  it('handles malformed JSON in subscriber callback without throwing', async () => {
    let subscriberCallback = null;
    const sub = {
      subscribe: mock.fn(async (channel, cb) => {
        subscriberCallback = cb;
      })
    };
    const board = {
      createSubscriber: mock.fn(async () => sub),
      publish: mock.fn(async () => {})
    };
    const agent = new ObsidianCLIAgent({ vaultPath: 'vault' }, board);
    await agent.init();
    // Trigger callback with invalid JSON — should not throw
    await assert.doesNotReject(async () => {
      await subscriberCallback('not-valid-json');
    });
  });
});

describe('ObsidianCLIAgent execCommand()', () => {
  it('returns status success with command string', async () => {
    const agent = new ObsidianCLIAgent({ vaultPath: 'vault' });
    const result = await agent.execCommand('open', 'MyNote');
    assert.strictEqual(result.status, 'success');
    assert.ok(typeof result.command === 'string');
    assert.ok(result.command.includes('obsidian://open'));
  });

  it('includes the formatted command in the result', async () => {
    const agent = new ObsidianCLIAgent({ vaultPath: 'testvault' });
    const result = await agent.execCommand('search', 'hello world');
    assert.strictEqual(result.status, 'success');
    assert.ok(result.command.includes('obsidian://search'));
    assert.ok(result.command.includes('hello%20world'));
  });

  it('returns success even for unknown action (no external process)', async () => {
    const agent = new ObsidianCLIAgent({ vaultPath: 'vault' });
    const result = await agent.execCommand('unknown-action', 'whatever');
    assert.strictEqual(result.status, 'success');
  });
});

describe('ObsidianCLIAgent _formatCommand()', () => {
  it('open action returns obsidian://open with vault and file params', () => {
    const agent = new ObsidianCLIAgent({ vaultPath: 'my vault' });
    const cmd = agent._formatCommand('open', 'Daily Note');
    assert.ok(cmd.startsWith('obsidian://open'));
    assert.ok(cmd.includes('vault=my%20vault'));
    assert.ok(cmd.includes('file=Daily%20Note'));
  });

  it('search action returns obsidian://search with query param', () => {
    const agent = new ObsidianCLIAgent({ vaultPath: 'vault' });
    const cmd = agent._formatCommand('search', 'meeting notes');
    assert.ok(cmd.startsWith('obsidian://search'));
    assert.ok(cmd.includes('query=meeting%20notes'));
    assert.ok(cmd.includes('vault=vault'));
  });

  it('new action returns obsidian://new with name param', () => {
    const agent = new ObsidianCLIAgent({ vaultPath: 'vault' });
    const cmd = agent._formatCommand('new', 'Fresh Note');
    assert.ok(cmd.startsWith('obsidian://new'));
    assert.ok(cmd.includes('name=Fresh%20Note'));
    assert.ok(cmd.includes('vault=vault'));
  });

  it('default/unknown action returns obsidian://open without file param', () => {
    const agent = new ObsidianCLIAgent({ vaultPath: 'vault' });
    const cmd = agent._formatCommand('unknown', 'ignored');
    assert.ok(cmd.startsWith('obsidian://open'));
    assert.ok(!cmd.includes('file='));
  });

  it('handles empty target gracefully', () => {
    const agent = new ObsidianCLIAgent({ vaultPath: 'vault' });
    const cmd = agent._formatCommand('search', '');
    assert.ok(cmd.startsWith('obsidian://search'));
    assert.ok(cmd.includes('query='));
  });

  it('handles undefined target gracefully', () => {
    const agent = new ObsidianCLIAgent({ vaultPath: 'vault' });
    const cmd = agent._formatCommand('new', undefined);
    assert.ok(cmd.startsWith('obsidian://new'));
  });
});

describe('ObsidianCLIAgent handleTask()', () => {
  it('calls execCommand with action and file from task data', async () => {
    const agent = new ObsidianCLIAgent({ vaultPath: 'vault' });
    let capturedAction = null;
    let capturedTarget = null;
    agent.execCommand = async (action, target) => {
      capturedAction = action;
      capturedTarget = target;
      return { status: 'success', command: 'obsidian://open' };
    };
    await agent.handleTask({ action: 'open', file: 'MyNote', taskId: 'task-1' });
    assert.strictEqual(capturedAction, 'open');
    assert.strictEqual(capturedTarget, 'MyNote');
  });

  it('publishes result to board with taskId', async () => {
    const board = makeBoard();
    const agent = new ObsidianCLIAgent({ vaultPath: 'vault' }, board);
    agent.execCommand = async () => ({ status: 'success', command: 'cmd' });
    await agent.handleTask({ action: 'open', file: 'Note', taskId: 'abc-123' });
    assert.strictEqual(board.publish.mock.calls.length, 1);
    const [channel, payload] = board.publish.mock.calls[0].arguments;
    assert.strictEqual(channel, 'obsidian:cli:finished');
    assert.strictEqual(payload.taskId, 'abc-123');
    assert.strictEqual(payload.status, 'success');
  });

  it('uses command field as fallback when file is not provided', async () => {
    const agent = new ObsidianCLIAgent({ vaultPath: 'vault' });
    let capturedTarget = null;
    agent.execCommand = async (action, target) => {
      capturedTarget = target;
      return { status: 'success', command: 'cmd' };
    };
    await agent.handleTask({ action: 'search', command: 'todo items' });
    assert.strictEqual(capturedTarget, 'todo items');
  });

  it('does not publish to board when board is null', async () => {
    const agent = new ObsidianCLIAgent({ vaultPath: 'vault' });
    agent.execCommand = async () => ({ status: 'success', command: 'cmd' });
    const result = await agent.handleTask({ action: 'open', file: 'Note' });
    assert.strictEqual(result.status, 'success');
  });

  it('returns the result of execCommand', async () => {
    const agent = new ObsidianCLIAgent({ vaultPath: 'vault' });
    agent.execCommand = async () => ({ status: 'success', command: 'obsidian://open?vault=vault' });
    const result = await agent.handleTask({ action: 'open', file: 'X' });
    assert.strictEqual(result.status, 'success');
    assert.ok(result.command.includes('obsidian://'));
  });
});

describe('ObsidianCLIAgent shutdown()', () => {
  it('does not throw', async () => {
    const agent = new ObsidianCLIAgent({ vaultPath: 'vault' });
    await assert.doesNotReject(async () => {
      await agent.shutdown();
    });
  });

  it('does not throw when board is attached', async () => {
    const board = makeBoard();
    const agent = new ObsidianCLIAgent({ vaultPath: 'vault' }, board);
    await assert.doesNotReject(async () => {
      await agent.shutdown();
    });
  });
});
