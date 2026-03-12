const { describe, it } = require('node:test');
const assert = require('node:assert');
const TelegramDevelopmentBot = require('../agent/telegram-bot.js');

describe('TelegramDevelopmentBot', () => {
  it('should throw an error if no config is provided', () => {
    assert.throws(() => {
      new TelegramDevelopmentBot();
    }, /Missing configuration/);
  });

  it('should initialize successfully with valid config', () => {
    const config = {
      telegramToken: 'dummy_token',
      geminiKey: 'dummy_key',
      blackboardUrl: 'redis://localhost:6380',
      authorizedUsers: ['12345']
    };
    const mockBoard = { connect: async () => {}, publish: async () => {} };
    const bot = new TelegramDevelopmentBot(config, mockBoard);
    assert.ok(bot);
    assert.strictEqual(bot.config.telegramToken, 'dummy_token');
  });
});
