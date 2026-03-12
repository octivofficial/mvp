const { describe, it, mock, afterEach } = require('node:test');
const assert = require('node:assert');
const TelegramDevelopmentBot = require('../agent/telegram-bot.js');

describe('TelegramBot -> Conversation Manager', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  const config = {
    telegramToken: 'dummy',
    blackboardUrl: 'dummy',
    authorizedUsers: [12345, 67890]
  };
  const mockBoard = {
    connect: async () => {},
    publish: async () => {},
    createSubscriber: async () => ({ subscribe: async () => {} })
  };

  class MockClient {
    constructor() { this.options = { polling: false }; }
    on() {}
    sendMessage(chatId, text) { this.lastSent = { chatId, text }; }
  }

  it('should ignore messages from unauthorized users', async () => {
    const bot = new TelegramDevelopmentBot(config, mockBoard, null, MockClient);
    bot.startPolling();

    let handled = false;
    bot.analyzeFeasibility = async () => { handled = true; return 'test'; };

    await bot._routeMessage({ chat: { id: 99999 }, text: 'Hello' });
    assert.strictEqual(handled, false);
    assert.match(bot.client.lastSent.text, /Unauthorized/);
  });

  it('should respond to /start command without vibe coding', async () => {
    const bot = new TelegramDevelopmentBot(config, mockBoard, null, MockClient);
    bot.startPolling();

    let handled = false;
    bot.analyzeFeasibility = async () => { handled = true; };

    await bot._routeMessage({ chat: { id: 12345 }, text: '/start' });
    assert.strictEqual(handled, false);
    assert.match(bot.client.lastSent.text, /Welcome to Octiv/);
  });

  it('should respond to /help command', async () => {
    const bot = new TelegramDevelopmentBot(config, mockBoard, null, MockClient);
    bot.startPolling();

    await bot._routeMessage({ chat: { id: 12345 }, text: '/help' });
    assert.match(bot.client.lastSent.text, /Available commands:/);
  });

  it('should respond to /reset command', async () => {
    const bot = new TelegramDevelopmentBot(config, mockBoard, null, MockClient);
    bot.startPolling();

    await bot._routeMessage({ chat: { id: 67890 }, text: '/reset' });
    assert.match(bot.client.lastSent.text, /Conversation state reset/);
  });

  it('should route normal text to the existing Vibe Coding pipeline', async () => {
    const bot = new TelegramDevelopmentBot(config, mockBoard, null, MockClient);
    bot.startPolling();
    
    let handledText = '';
    bot.handleMessage = async (text) => { 
      handledText = text; 
      return { title: 'Test PRD' }; 
    };

    await bot._routeMessage({ chat: { id: 12345 }, text: 'Build me a game' });
    assert.strictEqual(handledText, 'Build me a game');
  });
});
