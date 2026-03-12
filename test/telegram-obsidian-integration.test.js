const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const TelegramDevelopmentBot = require('../agent/telegram-bot.js');
const ObsidianOrganizer = require('../agent/obsidian-agent.js');

describe('Pub/Sub Integration', () => {
  it('should propagate board publish failure', async () => {
    const mockBoard = {
      publish: mock.fn(async () => { throw new Error('Redis connection refused'); }),
      connect: mock.fn(async () => {})
    };
    const bot = new TelegramDevelopmentBot({ telegramToken: 'dummy', blackboardUrl: 'dummy' }, mockBoard);
    await assert.rejects(() => bot.publishPRD({ title: 'Test' }), /Redis connection refused/);
  });

  it('should allow Telegram bot to publish PRD to Blackboard', async () => {
    const mockBoard = {
      publish: mock.fn(async () => {}),
      connect: mock.fn(async () => {})
    };

    const config = {
      telegramToken: 'dummy',
      geminiKey: 'dummy',
      blackboardUrl: 'dummy'
    };
    
    // We pass mockBoard to avoid actual Redis connection
    const bot = new TelegramDevelopmentBot(config, mockBoard);
    
    await bot.publishPRD({
      title: 'Dummy PRD',
      content: 'Some context here'
    });

    assert.strictEqual(mockBoard.publish.mock.calls.length, 1);
    const callArgs = mockBoard.publish.mock.calls[0].arguments;
    assert.strictEqual(callArgs[0], 'telegram:prd');
    assert.strictEqual(callArgs[1].title, 'Dummy PRD');
    assert.strictEqual(callArgs[1].author, 'telegram-bot');
  });

  it('should allow Obsidian Agent to subscribe to PRD channel', async () => {
    // Mock subscriber
    const mockSubscriber = {
      subscribe: mock.fn(async (channel, callback) => {
        // immediately trigger the callback for testing
        if (channel === 'octiv:telegram:prd') {
          callback(JSON.stringify({
            title: 'Test PRD',
            content: 'Test content',
            author: 'telegram-bot'
          }));
        }
      })
    };

    const mockBoard = {
      connect: mock.fn(async () => {}),
      createSubscriber: mock.fn(async () => mockSubscriber)
    };

    const agent = new ObsidianOrganizer({ vaultPath: '/tmp' }, mockBoard);
    
    // Spy on the handlePRD method to ensure it gets called
    agent.handlePRD = mock.fn();
    
    await agent.init();
    
    assert.strictEqual(mockBoard.createSubscriber.mock.calls.length, 1);
    // init() subscribes to 2 channels (octiv:telegram:prd + octiv:obsidian:import)
    assert.ok(mockSubscriber.subscribe.mock.calls.length >= 1, 'Should subscribe to at least one channel');
    assert.strictEqual(agent.handlePRD.mock.calls.length, 1);
  });
});
