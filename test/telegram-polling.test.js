const { describe, it, mock, afterEach } = require('node:test');
const assert = require('node:assert');
const TelegramDevelopmentBot = require('../agent/telegram-bot.js');

describe('TelegramBot -> API Polling', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('should initialize polling client when started', async () => {
    // Mock the telegram bot api module properly as a class
    const mockOn = mock.fn();
    class MockTelegramClient {
      constructor(token, options) {
        this.token = token;
        this.options = options;
      }
      on(event, handler) { mockOn(event, handler); }
    }
    
    const config = { telegramToken: 'dummy_token', blackboardUrl: 'dummy' };
    const mockBoard = {
      connect: async () => {},
      publish: async () => {},
      createSubscriber: async () => ({ subscribe: async () => {} })
    };
    
    // Inject the mock factory class (4th arg = clientFactory)
    const bot = new TelegramDevelopmentBot(config, mockBoard, null, MockTelegramClient);
    
    bot.startPolling();
    
    assert.strictEqual(bot.client.token, 'dummy_token');
    assert.deepStrictEqual(bot.client.options, { polling: true });
    
    assert.strictEqual(mockOn.mock.calls.length, 1);
    assert.strictEqual(mockOn.mock.calls[0].arguments[0], 'message');
  });
});
