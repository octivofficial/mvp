const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const TelegramDevelopmentBot = require('../agent/telegram-bot.js');

const makeBoard = () => ({
  publish: mock.fn(async () => {}),
  createSubscriber: mock.fn(async () => ({ subscribe: mock.fn(() => {}) }))
});

const makeReflexion = (answer = 'PRD content') => ({
  callLLM: mock.fn(async () => answer),
  handleIntent: mock.fn(async () => null)
});

const baseConfig = () => ({
  telegramToken: 'dummy_token',
  geminiKey: 'dummy_key',
  blackboardUrl: 'redis://localhost:6380',
  authorizedUsers: []
});

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

describe('TelegramDevelopmentBot constructor', () => {
  it('throws when config is empty object', () => {
    assert.throws(() => new TelegramDevelopmentBot({}), /Missing configuration/);
  });

  it('stores board reference when provided', () => {
    const board = makeBoard();
    const bot = new TelegramDevelopmentBot(baseConfig(), board);
    assert.strictEqual(bot.board, board);
  });

  it('stores reflexion reference when provided', () => {
    const board = makeBoard();
    const reflexion = makeReflexion();
    const bot = new TelegramDevelopmentBot(baseConfig(), board, reflexion);
    assert.strictEqual(bot.reflexion, reflexion);
  });

  it('stores clientFactory when provided', () => {
    const board = makeBoard();
    const factory = function MockBotApi() {};
    const bot = new TelegramDevelopmentBot(baseConfig(), board, null, factory);
    assert.strictEqual(bot.clientFactory, factory);
  });

  it('stores config properties', () => {
    const board = makeBoard();
    const config = { ...baseConfig(), telegramToken: 'tok-123' };
    const bot = new TelegramDevelopmentBot(config, board);
    assert.strictEqual(bot.config.telegramToken, 'tok-123');
  });
});

describe('TelegramDevelopmentBot analyzeFeasibility()', () => {
  it('calls reflexion.callLLM when reflexion is provided', async () => {
    const board = makeBoard();
    const reflexion = makeReflexion('Analysis result');
    const bot = new TelegramDevelopmentBot(baseConfig(), board, reflexion);
    const result = await bot.analyzeFeasibility('Build a todo app');
    assert.strictEqual(reflexion.callLLM.mock.calls.length, 1);
    assert.strictEqual(result, 'Analysis result');
  });

  it('returns the LLM result from reflexion', async () => {
    const board = makeBoard();
    const reflexion = makeReflexion('Detailed PRD here');
    const bot = new TelegramDevelopmentBot(baseConfig(), board, reflexion);
    const result = await bot.analyzeFeasibility('My idea');
    assert.strictEqual(result, 'Detailed PRD here');
  });

  it('returns fallback string when reflexion returns null', async () => {
    const board = makeBoard();
    const reflexion = makeReflexion(null);
    const bot = new TelegramDevelopmentBot(baseConfig(), board, reflexion);
    const result = await bot.analyzeFeasibility('Build a game');
    assert.ok(result.includes('PRD draft for:'));
    assert.ok(result.includes('Build a game'));
  });

  it('returns PRD draft string when no reflexion and no openClawEndpoint', async () => {
    const board = makeBoard();
    const bot = new TelegramDevelopmentBot(baseConfig(), board);
    const result = await bot.analyzeFeasibility('My feature request');
    assert.ok(result.startsWith('PRD draft for:'));
    assert.ok(result.includes('My feature request'));
  });

  it('passes prompt containing the requestText to callLLM', async () => {
    const board = makeBoard();
    const reflexion = makeReflexion('ok');
    const bot = new TelegramDevelopmentBot(baseConfig(), board, reflexion);
    await bot.analyzeFeasibility('Specific idea text');
    const promptArg = reflexion.callLLM.mock.calls[0].arguments[0];
    assert.ok(promptArg.includes('Specific idea text'));
  });
});

describe('TelegramDevelopmentBot formatToPRD()', () => {
  it('returns object with title, content, and author', () => {
    const board = makeBoard();
    const bot = new TelegramDevelopmentBot(baseConfig(), board);
    const result = bot.formatToPRD('raw analysis text');
    assert.ok(typeof result === 'object');
    assert.ok('title' in result);
    assert.ok('content' in result);
    assert.ok('author' in result);
  });

  it('sets author to telegram-bot', () => {
    const board = makeBoard();
    const bot = new TelegramDevelopmentBot(baseConfig(), board);
    const result = bot.formatToPRD('some text');
    assert.strictEqual(result.author, 'telegram-bot');
  });

  it('sets content to the provided rawText', () => {
    const board = makeBoard();
    const bot = new TelegramDevelopmentBot(baseConfig(), board);
    const result = bot.formatToPRD('my raw text');
    assert.strictEqual(result.content, 'my raw text');
  });

  it('sets a non-empty title', () => {
    const board = makeBoard();
    const bot = new TelegramDevelopmentBot(baseConfig(), board);
    const result = bot.formatToPRD('text');
    assert.ok(typeof result.title === 'string');
    assert.ok(result.title.length > 0);
  });
});

describe('TelegramDevelopmentBot publishPRD()', () => {
  it('calls board.publish with telegram:prd channel', async () => {
    const board = makeBoard();
    const bot = new TelegramDevelopmentBot(baseConfig(), board);
    await bot.publishPRD({ title: 'T', content: 'C', author: 'x' });
    assert.strictEqual(board.publish.mock.calls.length, 1);
    const [channel] = board.publish.mock.calls[0].arguments;
    assert.strictEqual(channel, 'telegram:prd');
  });

  it('includes author field in published payload', async () => {
    const board = makeBoard();
    const bot = new TelegramDevelopmentBot(baseConfig(), board);
    await bot.publishPRD({ title: 'T', content: 'C' });
    const [, payload] = board.publish.mock.calls[0].arguments;
    assert.strictEqual(payload.author, 'telegram-bot');
  });

  it('spreads all prdData fields into the published payload', async () => {
    const board = makeBoard();
    const bot = new TelegramDevelopmentBot(baseConfig(), board);
    await bot.publishPRD({ title: 'MyTitle', content: 'MyContent' });
    const [, payload] = board.publish.mock.calls[0].arguments;
    assert.strictEqual(payload.title, 'MyTitle');
    assert.strictEqual(payload.content, 'MyContent');
  });
});

describe('TelegramDevelopmentBot handleMessage()', () => {
  it('calls analyzeFeasibility with the text', async () => {
    const board = makeBoard();
    const reflexion = makeReflexion('analysis');
    const bot = new TelegramDevelopmentBot(baseConfig(), board, reflexion);
    await bot.handleMessage('build me something');
    const promptArg = reflexion.callLLM.mock.calls[0].arguments[0];
    assert.ok(promptArg.includes('build me something'));
  });

  it('calls publishPRD once', async () => {
    const board = makeBoard();
    const bot = new TelegramDevelopmentBot(baseConfig(), board);
    await bot.handleMessage('feature idea');
    assert.strictEqual(board.publish.mock.calls.length, 1);
  });

  it('returns prdData with a title property', async () => {
    const board = makeBoard();
    const bot = new TelegramDevelopmentBot(baseConfig(), board);
    const result = await bot.handleMessage('my request');
    assert.ok(result);
    assert.ok('title' in result);
  });

  it('returns prdData with author set to telegram-bot', async () => {
    const board = makeBoard();
    const bot = new TelegramDevelopmentBot(baseConfig(), board);
    const result = await bot.handleMessage('my request');
    assert.strictEqual(result.author, 'telegram-bot');
  });

  it('returns prdData containing the analyzed content', async () => {
    const board = makeBoard();
    const reflexion = makeReflexion('Deep analysis of feature');
    const bot = new TelegramDevelopmentBot(baseConfig(), board, reflexion);
    const result = await bot.handleMessage('feature X');
    assert.strictEqual(result.content, 'Deep analysis of feature');
  });
});

describe('TelegramDevelopmentBot _routeMessage()', () => {
  const makeClient = () => ({
    sendMessage: mock.fn(() => {})
  });

  it('sends unauthorized message for blocked chatId', async () => {
    const board = makeBoard();
    const config = { ...baseConfig(), authorizedUsers: [99999] };
    const bot = new TelegramDevelopmentBot(config, board);
    bot.client = makeClient();
    const msg = { chat: { id: 12345 }, text: 'hello', from: {} };
    await bot._routeMessage(msg);
    assert.strictEqual(bot.client.sendMessage.mock.calls.length, 1);
    const [, text] = bot.client.sendMessage.mock.calls[0].arguments;
    assert.ok(text.includes('Unauthorized'));
  });

  it('sends welcome message for /start command', async () => {
    const board = makeBoard();
    const bot = new TelegramDevelopmentBot(baseConfig(), board);
    bot.client = makeClient();
    const msg = { chat: { id: 42 }, text: '/start', from: {} };
    await bot._routeMessage(msg);
    assert.strictEqual(bot.client.sendMessage.mock.calls.length, 1);
    const [, text] = bot.client.sendMessage.mock.calls[0].arguments;
    assert.ok(text.includes('Welcome'));
  });

  it('sends help message for /help command', async () => {
    const board = makeBoard();
    const bot = new TelegramDevelopmentBot(baseConfig(), board);
    bot.client = makeClient();
    const msg = { chat: { id: 42 }, text: '/help', from: {} };
    await bot._routeMessage(msg);
    assert.strictEqual(bot.client.sendMessage.mock.calls.length, 1);
    const [, text] = bot.client.sendMessage.mock.calls[0].arguments;
    assert.ok(text.includes('Available commands'));
  });

  it('sends reset message for /reset command', async () => {
    const board = makeBoard();
    const bot = new TelegramDevelopmentBot(baseConfig(), board);
    bot.client = makeClient();
    const msg = { chat: { id: 42 }, text: '/reset', from: {} };
    await bot._routeMessage(msg);
    assert.strictEqual(bot.client.sendMessage.mock.calls.length, 1);
    const [, text] = bot.client.sendMessage.mock.calls[0].arguments;
    assert.ok(text.includes('reset'));
  });

  it('calls handleMessage for regular text (no slash command)', async () => {
    const board = makeBoard();
    const reflexion = makeReflexion('analysis');
    const bot = new TelegramDevelopmentBot(baseConfig(), board, reflexion);
    bot.client = makeClient();
    const msg = { chat: { id: 42 }, text: 'Build a cool app', from: { username: 'tester' } };
    await bot._routeMessage(msg);
    // board.publish called: once for telegram:idea and once for telegram:prd
    assert.ok(board.publish.mock.calls.length >= 1);
  });

  it('sends PRD title to client for regular text message', async () => {
    const board = makeBoard();
    const bot = new TelegramDevelopmentBot(baseConfig(), board);
    bot.client = makeClient();
    const msg = { chat: { id: 42 }, text: 'I want a feature', from: { first_name: 'Alice' } };
    await bot._routeMessage(msg);
    // client.sendMessage should be called with PRD title
    assert.strictEqual(bot.client.sendMessage.mock.calls.length, 1);
    const [, text] = bot.client.sendMessage.mock.calls[0].arguments;
    assert.ok(text.includes('PRD published'));
  });

  it('allows all users when authorizedUsers is empty', async () => {
    const board = makeBoard();
    const config = { ...baseConfig(), authorizedUsers: [] };
    const bot = new TelegramDevelopmentBot(config, board);
    bot.client = makeClient();
    const msg = { chat: { id: 999 }, text: '/start', from: {} };
    await bot._routeMessage(msg);
    const [, text] = bot.client.sendMessage.mock.calls[0].arguments;
    assert.ok(text.includes('Welcome'));
  });

  it('uses reflexion.handleIntent when reflexion is provided and returns truthy', async () => {
    const board = makeBoard();
    const reflexion = {
      callLLM: mock.fn(async () => 'x'),
      handleIntent: mock.fn(async () => 'Intent handled response')
    };
    const bot = new TelegramDevelopmentBot(baseConfig(), board, reflexion);
    bot.client = makeClient();
    const msg = { chat: { id: 42 }, text: 'do something smart', from: { username: 'user' } };
    await bot._routeMessage(msg);
    assert.strictEqual(reflexion.handleIntent.mock.calls.length, 1);
    assert.strictEqual(bot.client.sendMessage.mock.calls.length, 1);
    const [, text] = bot.client.sendMessage.mock.calls[0].arguments;
    assert.strictEqual(text, 'Intent handled response');
  });
});
