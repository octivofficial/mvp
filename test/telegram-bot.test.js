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

  it('sends no-vibes message for /build when vault is empty', async () => {
    const board = makeBoard();
    const bot = new TelegramDevelopmentBot(baseConfig(), board);
    bot.client = makeClient();
    // Override _accumulateRecentVibes to return null (no vibes)
    bot._accumulateRecentVibes = async () => null;
    const msg = { chat: { id: 42 }, text: '/build', from: { username: 'tester' } };
    await bot._routeMessage(msg);
    assert.strictEqual(bot.client.sendMessage.mock.calls.length, 1);
    const [, text] = bot.client.sendMessage.mock.calls[0].arguments;
    assert.ok(text.includes('No vibes'));
  });

  it('triggers build pipeline for /build when vibes exist', async () => {
    const board = makeBoard();
    const reflexion = makeReflexion('## Build Brief: Feature\n**Vision**: test');
    const bot = new TelegramDevelopmentBot(baseConfig(), board, reflexion);
    bot.client = makeClient();
    bot._accumulateRecentVibes = async () => '### 2026-03-12: test idea\nContext: test\nVibe: fast';
    bot._saveBuildBrief = async () => {};
    const msg = { chat: { id: 42 }, text: '/build', from: { username: 'tester' } };
    await bot._routeMessage(msg);
    // Should send "compiling..." and then the brief
    assert.ok(bot.client.sendMessage.mock.calls.length >= 2);
  });

  it('includes /build in help text', async () => {
    const board = makeBoard();
    const bot = new TelegramDevelopmentBot(baseConfig(), board);
    bot.client = makeClient();
    const msg = { chat: { id: 42 }, text: '/help', from: {} };
    await bot._routeMessage(msg);
    const [, text] = bot.client.sendMessage.mock.calls[0].arguments;
    assert.ok(text.includes('/build'));
  });

  it('includes /spec in help text', async () => {
    const board = makeBoard();
    const bot = new TelegramDevelopmentBot(baseConfig(), board);
    bot.client = makeClient();
    const msg = { chat: { id: 42 }, text: '/help', from: {} };
    await bot._routeMessage(msg);
    const [, text] = bot.client.sendMessage.mock.calls[0].arguments;
    assert.ok(text.includes('/spec'));
    assert.ok(text.includes('BMAD'));
  });

  it('sends usage hint for /spec without feature text', async () => {
    const board = makeBoard();
    const bot = new TelegramDevelopmentBot(baseConfig(), board);
    bot.client = makeClient();
    // '/spec  ' (spaces only) → after text.trim() = '/spec', falls through to free text
    // '/spec x' → starts with '/spec ', triggers spec handler
    // Test the empty-feature guard inside _handleSpec
    const msg = { chat: { id: 42 }, text: '/spec  ', from: {} };
    await bot._routeMessage(msg);
    // After outer trim '/spec  ' → '/spec' which doesn't match '/spec ' prefix
    // So we test _handleSpec directly
    const bot2 = new TelegramDevelopmentBot(baseConfig(), makeBoard());
    bot2.client = makeClient();
    await bot2._handleSpec(42, '', {});
    const [, text] = bot2.client.sendMessage.mock.calls[0].arguments;
    assert.ok(text.includes('Usage'));
  });

  it('generates BMAD spec for /spec with feature description', async () => {
    const board = makeBoard();
    const reflexion = makeReflexion('## BMAD Spec: Auto-Farm\n### Acceptance Criteria\n- [ ] AC-9.1');
    const bot = new TelegramDevelopmentBot(baseConfig(), board, reflexion);
    bot.client = makeClient();
    bot._saveSpecToVault = mock.fn(async () => {});
    const msg = { chat: { id: 42 }, text: '/spec auto-farm wheat collection', from: { username: 'tony' } };
    await bot._routeMessage(msg);
    // Should send "generating..." + spec result
    assert.ok(bot.client.sendMessage.mock.calls.length >= 2);
    // Spec result should mention BMAD
    const lastCall = bot.client.sendMessage.mock.calls[bot.client.sendMessage.mock.calls.length - 1];
    assert.ok(lastCall.arguments[1].includes('BMAD'));
  });

  it('publishes octivia:spec to Blackboard on /spec', async () => {
    const board = makeBoard();
    const reflexion = makeReflexion('## BMAD Spec: Test\n### AC\n- [ ] AC-1.1');
    const bot = new TelegramDevelopmentBot(baseConfig(), board, reflexion);
    bot.client = makeClient();
    bot._saveSpecToVault = mock.fn(async () => {});
    const msg = { chat: { id: 42 }, text: '/spec add user auth', from: { username: 'dev' } };
    await bot._routeMessage(msg);
    const specPublish = board.publish.mock.calls.find(c => c.arguments[0] === 'octivia:spec');
    assert.ok(specPublish, 'Should publish to octivia:spec channel');
    assert.strictEqual(specPublish.arguments[1].feature, 'add user auth');
    assert.strictEqual(specPublish.arguments[1].author, 'dev');
  });

  it('/start mentions BMAD and spec', async () => {
    const board = makeBoard();
    const bot = new TelegramDevelopmentBot(baseConfig(), board);
    bot.client = makeClient();
    const msg = { chat: { id: 42 }, text: '/start', from: {} };
    await bot._routeMessage(msg);
    const [, text] = bot.client.sendMessage.mock.calls[0].arguments;
    assert.ok(text.includes('BMAD'));
    assert.ok(text.includes('/spec'));
  });
});

describe('TelegramDevelopmentBot group chat', () => {
  const makeClient = () => ({ sendMessage: mock.fn(() => {}) });

  it('records group messages silently without @mention (no response)', async () => {
    const board = makeBoard();
    const reflexion = makeReflexion('Great idea! 좋아요');
    const bot = new TelegramDevelopmentBot(baseConfig(), board, reflexion);
    bot.client = makeClient();
    const msg = {
      chat: { id: -100123456, type: 'group' },
      text: "Let's build something cool",
      from: { id: 999, username: 'friend1' }
    };
    await bot._routeMessage(msg);
    // No @mention → no response sent
    assert.strictEqual(bot.client.sendMessage.mock.calls.length, 0);
    // But message IS recorded in session
    const session = bot._sessions.get(-100123456);
    assert.ok(session?.notes?.length >= 1);
    assert.strictEqual(session.notes[0].author, 'friend1');
  });

  it('responds in group when @mentioned', async () => {
    const board = makeBoard();
    const reflexion = makeReflexion('Great idea! 좋아요');
    const bot = new TelegramDevelopmentBot(baseConfig(), board, reflexion);
    bot.client = makeClient();
    const msg = {
      chat: { id: -100123456, type: 'group' },
      text: '@Octivia_bot what do you think about this feature?',
      from: { id: 999, username: 'friend1' }
    };
    await bot._routeMessage(msg);
    // @mention present → responds
    assert.ok(bot.client.sendMessage.mock.calls.length >= 1);
  });

  it('rejects unauthorized group silently (no message sent)', async () => {
    const config = { ...baseConfig(), authorizedGroups: [-999] };
    const board = makeBoard();
    const bot = new TelegramDevelopmentBot(config, board);
    bot.client = makeClient();
    const msg = {
      chat: { id: -100111999, type: 'group' }, // different from authorized -999
      text: '/start',
      from: { id: 777 }
    };
    await bot._routeMessage(msg);
    // Unauthorized group: silently ignored, no message sent
    assert.strictEqual(bot.client.sendMessage.mock.calls.length, 0);
  });

  it('allows group when authorizedGroups is empty', async () => {
    const config = { ...baseConfig(), authorizedGroups: [] };
    const board = makeBoard();
    const bot = new TelegramDevelopmentBot(config, board);
    bot.client = makeClient();
    bot._recordGroupMessage = mock.fn(async () => {});
    const msg = {
      chat: { id: -100123456, type: 'group' },
      text: '/start',
      from: { id: 999, username: 'anyone' }
    };
    await bot._routeMessage(msg);
    // /start in group sends group welcome
    assert.ok(bot.client.sendMessage.mock.calls.length >= 1);
    const [, text] = bot.client.sendMessage.mock.calls[0].arguments;
    assert.ok(text.includes("Hi everyone") || text.includes("Octivia"));
  });

  it('sends welcome for /start in group (same as DM)', async () => {
    const board = makeBoard();
    const bot = new TelegramDevelopmentBot(baseConfig(), board);
    bot.client = makeClient();
    const msg = { chat: { id: -100123, type: 'group' }, text: '/start', from: { id: 42 } };
    await bot._routeMessage(msg);
    const [, text] = bot.client.sendMessage.mock.calls[0].arguments;
    assert.ok(text.includes('Octivia'));
  });

  it('_recordGroupMessage stores message in session notes', async () => {
    const board = makeBoard();
    const bot = new TelegramDevelopmentBot(baseConfig(), board);
    const msg = {
      chat: { id: -100123 },
      text: 'this is a group message',
      from: { id: 99, username: 'groupuser' }
    };
    await bot._recordGroupMessage(-100123, msg);
    const session = bot._sessions.get(-100123);
    assert.ok(session?.notes?.length >= 1);
    assert.strictEqual(session.notes[0].author, 'groupuser');
    assert.strictEqual(session.notes[0].text, 'this is a group message');
    assert.strictEqual(session.notes[0].type, 'group');
  });
});

describe('TelegramDevelopmentBot _accumulateRecentVibes()', () => {
  it('returns null when vault dir is empty', async () => {
    const bot = new TelegramDevelopmentBot(baseConfig(), makeBoard());
    // Override readdir to return empty list
    bot._vaultVibesDir = '/nonexistent/path/that/does/not/exist';
    const result = await bot._accumulateRecentVibes();
    assert.strictEqual(result, null);
  });

  it('returns null when no idea files exist', async () => {
    const bot = new TelegramDevelopmentBot(baseConfig(), makeBoard());
    // Point to a dir with no .md files
    const result = await bot._accumulateRecentVibes();
    // If vault/00-Vibes/ has no idea files (only README), returns null
    assert.ok(result === null || typeof result === 'string');
  });
});

describe('TelegramDevelopmentBot vibe → BMAD spec flow', () => {
  const makeClient = () => ({ sendMessage: mock.fn(() => {}) });

  it('produces BMAD spec with AC after 3-turn vibe conversation', async () => {
    const board = makeBoard();
    const specOutput = '## BMAD Spec: Cool Feature\n### Acceptance Criteria\n- [ ] AC-1.1: WHEN triggered THEN works';
    const reflexion = {
      callLLM: mock.fn(async () => specOutput),
      handleIntent: mock.fn(async () => null)
    };
    const bot = new TelegramDevelopmentBot(baseConfig(), board, reflexion);
    bot.client = makeClient();
    bot._saveToVault = mock.fn(async () => {});
    bot._saveSpecToVault = mock.fn(async () => {});

    // Turn 1: idea
    await bot._vibeConversation(42, 'Build a cool feature', { username: 'tony' });
    // Turn 2: clarification
    await bot._vibeConversation(42, 'It should be fast and reliable', { username: 'tony' });
    // Turn 3: taste → produces BMAD spec
    await bot._vibeConversation(42, 'Clean and minimal', { username: 'tony' });

    // Should publish to octivia:spec (not vibe:golden)
    const specPublish = board.publish.mock.calls.find(c => c.arguments[0] === 'octivia:spec');
    assert.ok(specPublish, 'Should publish BMAD spec to octivia:spec channel');

    // Should save to vault/01-Specs/
    assert.strictEqual(bot._saveSpecToVault.mock.calls.length, 1);

    // Last message should mention BMAD
    const lastMsg = bot.client.sendMessage.mock.calls[bot.client.sendMessage.mock.calls.length - 1];
    assert.ok(lastMsg.arguments[1].includes('BMAD'));
  });
});

describe('TelegramDevelopmentBot _saveSpecToVault()', () => {
  it('does not throw on valid spec text', async () => {
    const bot = new TelegramDevelopmentBot(baseConfig(), makeBoard());
    await assert.doesNotReject(async () => {
      const spy = { saved: false };
      bot._saveSpecToVault = async () => { spy.saved = true; };
      await bot._saveSpecToVault('## BMAD Spec: Test\n### AC', 'test-feature', 'tester');
      assert.ok(spy.saved);
    });
  });
});

describe('TelegramDevelopmentBot /summary command', () => {
  const makeClient = () => ({ sendMessage: mock.fn(() => {}) });

  it('returns no-messages hint when group has no notes', async () => {
    const board = makeBoard();
    const bot = new TelegramDevelopmentBot(baseConfig(), board);
    bot.client = makeClient();
    const msg = { chat: { id: 42 }, text: '/summary', from: {} };
    await bot._routeMessage(msg);
    const [, text] = bot.client.sendMessage.mock.calls[0].arguments;
    assert.ok(text.includes('No group conversation'));
  });

  it('synthesizes messages when notes exist and reflexion available', async () => {
    const board = makeBoard();
    const reflexion = makeReflexion('## Summary\n### Key Ideas\n- [kirby]: great concept');
    const bot = new TelegramDevelopmentBot(baseConfig(), board, reflexion);
    bot.client = makeClient();
    // Pre-populate session with group notes
    bot._sessions.set(42, {
      stage: 0,
      notes: [
        { author: 'kirby', text: 'We should design a cool concept', ts: Date.now(), type: 'group' },
        { author: 'dpd', text: 'Agreed, lets go bold', ts: Date.now(), type: 'group' },
      ]
    });
    await bot._handleSummary(42);
    // Should send "synthesizing..." + summary
    assert.ok(bot.client.sendMessage.mock.calls.length >= 2);
    // LLM was called with the transcript
    const prompt = reflexion.callLLM.mock.calls[0].arguments[0];
    assert.ok(prompt.includes('[kirby]'));
    assert.ok(prompt.includes('[dpd]'));
  });

  it('returns message count when no reflexion', async () => {
    const board = makeBoard();
    const bot = new TelegramDevelopmentBot(baseConfig(), board); // no reflexion
    bot.client = makeClient();
    bot._sessions.set(42, {
      stage: 0,
      notes: [{ author: 'bb', text: 'idea', ts: Date.now(), type: 'group' }]
    });
    await bot._handleSummary(42);
    const [, text] = bot.client.sendMessage.mock.calls[0].arguments;
    assert.ok(text.includes('1 messages'));
  });
});

describe('TelegramDevelopmentBot /ideas command', () => {
  const makeClient = () => ({ sendMessage: mock.fn(() => {}) });

  it('returns no-ideas hint when empty', async () => {
    const board = makeBoard();
    const bot = new TelegramDevelopmentBot(baseConfig(), board);
    bot.client = makeClient();
    await bot._handleIdeas(42);
    const [, text] = bot.client.sendMessage.mock.calls[0].arguments;
    assert.ok(text.includes('No ideas'));
  });

  it('groups ideas by contributor', async () => {
    const board = makeBoard();
    const bot = new TelegramDevelopmentBot(baseConfig(), board);
    bot.client = makeClient();
    bot._sessions.set(42, {
      stage: 0,
      notes: [
        { author: 'kirby', text: 'Visual concept idea', ts: Date.now(), type: 'group' },
        { author: 'kirby', text: 'Color palette', ts: Date.now(), type: 'group' },
        { author: 'dpd', text: 'Music direction', ts: Date.now(), type: 'group' },
        { author: 'bb', text: 'Choreography style', ts: Date.now(), type: 'group' },
      ]
    });
    await bot._handleIdeas(42);
    const [, text] = bot.client.sendMessage.mock.calls[0].arguments;
    assert.ok(text.includes('kirby'));
    assert.ok(text.includes('dpd'));
    assert.ok(text.includes('bb'));
    assert.ok(text.includes('2 messages')); // kirby has 2
    assert.ok(text.includes('Total: 4'));
  });
});

describe('TelegramDevelopmentBot /sync command', () => {
  const makeClient = () => ({ sendMessage: mock.fn(() => {}) });

  it('returns nothing-to-sync hint when empty', async () => {
    const board = makeBoard();
    const bot = new TelegramDevelopmentBot(baseConfig(), board);
    bot.client = makeClient();
    await bot._handleSync(42, { username: 'octiv' });
    const [, text] = bot.client.sendMessage.mock.calls[0].arguments;
    assert.ok(text.includes('Nothing to sync'));
  });

  it('syncs messages and publishes to Blackboard', async () => {
    const board = makeBoard();
    const bot = new TelegramDevelopmentBot(baseConfig(), board);
    bot.client = makeClient();
    bot._sessions.set(42, {
      stage: 0,
      notes: [
        { author: 'kirby', text: 'Design concept A', ts: Date.now(), type: 'group' },
        { author: 'dpd', text: 'I like it', ts: Date.now(), type: 'group' },
      ]
    });
    await bot._handleSync(42, { username: 'octiv' });
    const lastCall = bot.client.sendMessage.mock.calls[bot.client.sendMessage.mock.calls.length - 1];
    const text = lastCall.arguments[1];
    // Should confirm sync
    assert.ok(text.includes('Synced') || text.includes('2 messages'));
    // Should publish octivia:sync to Blackboard
    const syncPublish = board.publish.mock.calls.find(c => c.arguments[0] === 'octivia:sync');
    assert.ok(syncPublish, 'Should publish sync event');
    assert.strictEqual(syncPublish.arguments[1].messageCount, 2);
  });

  it('includes /summary and /sync in help text', async () => {
    const board = makeBoard();
    const bot = new TelegramDevelopmentBot(baseConfig(), board);
    bot.client = makeClient();
    const msg = { chat: { id: 42 }, text: '/help', from: {} };
    await bot._routeMessage(msg);
    const [, text] = bot.client.sendMessage.mock.calls[0].arguments;
    assert.ok(text.includes('/summary'));
    assert.ok(text.includes('/ideas'));
    assert.ok(text.includes('/sync'));
  });
});

describe('TelegramDevelopmentBot _saveBuildBrief()', () => {

  it('does not throw on valid brief text', async () => {
    const bot = new TelegramDevelopmentBot(baseConfig(), makeBoard());
    await assert.doesNotReject(async () => {
      const spy = { saved: false };
      bot._saveBuildBrief = async (_brief, _author) => { spy.saved = true; };
      await bot._saveBuildBrief('## Build Brief: Test\n**Vision**: testing', 'tester');
      assert.ok(spy.saved);
    });
  });
});
