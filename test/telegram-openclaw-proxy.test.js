const { describe, it, mock, afterEach } = require('node:test');
const assert = require('node:assert');
const TelegramDevelopmentBot = require('../agent/telegram-bot.js');

describe('TelegramBot -> Cloud OpenClaw Proxy', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('should forward complex requests to OpenClaw via fetch', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        response: 'Feasibility Report: High - We can build a flying car in Minecraft.'
      })
    };
    global.fetch = mock.fn(async () => mockResponse);

    const config = {
      telegramToken: 'dummy',
      blackboardUrl: 'redis://localhost:6380',
      openClawEndpoint: 'https://cloud-run.google.com/openclaw/webhook'
    };
    const mockBoard = { connect: async () => {}, publish: async () => {} };
    const bot = new TelegramDevelopmentBot(config, mockBoard);

    const result = await bot.analyzeFeasibility('I want a new flying car feature');

    assert.strictEqual(global.fetch.mock.calls.length, 1);
    const callArgs = global.fetch.mock.calls[0].arguments;
    
    assert.strictEqual(callArgs[0], 'https://cloud-run.google.com/openclaw/webhook');
    assert.strictEqual(callArgs[1].method, 'POST');
    assert.ok(callArgs[1].body.includes('flying car'));
    
    assert.strictEqual(result, 'Feasibility Report: High - We can build a flying car in Minecraft.');
  });

  it('should parse OpenClaw response back to PRD structure', () => {
    const config = { telegramToken: 'dummy', blackboardUrl: 'dummy' };
    const mockBoard = { connect: async () => {}, publish: async () => {} };
    const bot = new TelegramDevelopmentBot(config, mockBoard);

    const rawResponse = "Here is your PRD text...";
    const prd = bot.formatToPRD(rawResponse);

    assert.strictEqual(prd.title, 'Generated PRD');
    assert.strictEqual(prd.content, 'Here is your PRD text...');
    assert.strictEqual(prd.author, 'telegram-bot');
  });
});
