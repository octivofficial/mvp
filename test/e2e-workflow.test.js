const { describe, it, mock, afterEach } = require('node:test');
const assert = require('node:assert');
const TelegramDevelopmentBot = require('../agent/telegram-bot.js');

describe('E2E Workflow -> Telegram Loop', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('should process user message, hit OpenClaw, and publish PRD', async () => {
    // 1. Mock OpenClaw Cloud Response
    global.fetch = mock.fn(async () => ({
      ok: true,
      json: async () => ({ response: 'PRD: Implement flying cars' })
    }));

    // 2. Mock Blackboard
    let publishedMsg = null;
    const mockBoard = {
      connect: async () => {},
      publish: mock.fn(async (channel, data) => {
        if (channel === 'telegram:prd') publishedMsg = data;
      })
    };

    const bot = new TelegramDevelopmentBot({
      telegramToken: 'dummy',
      blackboardUrl: 'dummy',
      openClawEndpoint: 'http://cloud.claw'
    }, mockBoard);

    // 3. Act: simulate Telegram message
    await bot.handleMessage('Can we build flying cars?');

    // 4. Assert OpenClaw called
    assert.strictEqual(global.fetch.mock.calls.length, 1);
    
    // 5. Assert PRD published to Blackboard
    assert.strictEqual(mockBoard.publish.mock.calls.length, 1);
    assert.ok(publishedMsg, 'Message should have been published to telegram:prd');
    assert.strictEqual(publishedMsg.content, 'PRD: Implement flying cars');
    assert.strictEqual(publishedMsg.author, 'telegram-bot');
  });

  it('should write file and publish obsidian:confirm', async () => {
    const fs = require('fs/promises');
    const ObsidianOrganizer = require('../agent/obsidian-agent.js');
    
    mock.method(fs, 'mkdir', async () => {});
    mock.method(fs, 'writeFile', async () => {});
    
    let confirmationPub = null;
    const mockBoard = {
      connect: async () => {},
      createSubscriber: async () => ({}),
      publish: mock.fn(async (channel, data) => {
        if (channel === 'obsidian:confirm') confirmationPub = data;
      })
    };

    const agent = new ObsidianOrganizer({ vaultPath: '/tmp/vault' }, mockBoard);
    await agent.handlePRD({ title: 'Flying Car Spec', content: 'content' });

    assert.strictEqual(mockBoard.publish.mock.calls.length, 1);
    assert.strictEqual(mockBoard.publish.mock.calls[0].arguments[0], 'obsidian:confirm');
    assert.ok(confirmationPub);
    assert.ok(confirmationPub.message.includes('flying-car-spec.md'));
  });
});
