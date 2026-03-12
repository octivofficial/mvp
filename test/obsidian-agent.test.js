const { describe, it, mock, afterEach } = require('node:test');
const assert = require('node:assert');
// Import fs at top level so mock.method patches affect internal require('fs/promises') calls
// (Node.js module cache means the same object is returned)
const fs = require('fs/promises');
const ObsidianOrganizer = require('../agent/obsidian-agent.js');

// --- helpers ---

const makeBoard = () => ({
  connect: mock.fn(async () => {}),
  disconnect: mock.fn(async () => {}),
  publish: mock.fn(async () => {}),
  createSubscriber: mock.fn(async () => ({
    subscribe: mock.fn(async () => {})
  }))
});

const makeReflexion = (result = 'requirement') => ({
  callLLM: mock.fn(async () => result)
});

const makeWatcherFactory = () => {
  const handlers = {};
  const watcher = {
    on: mock.fn((event, handler) => {
      handlers[event] = handler;
      return watcher;
    })
  };
  const factory = mock.fn(() => watcher);
  return { factory, watcher, handlers };
};

// ============================================================
// Existing tests (constructor validation)
// ============================================================

describe('ObsidianOrganizer', () => {
  it('should throw an error if no vault path is provided', () => {
    assert.throws(() => {
      new ObsidianOrganizer();
    }, /Missing vault path/);
  });

  it('should initialize successfully with valid config', () => {
    const config = {
      vaultPath: '/tmp/dummy-vault',
      blackboardUrl: 'redis://localhost:6380'
    };
    const mockBoard = { connect: async () => {}, createSubscriber: async () => ({}) };
    const agent = new ObsidianOrganizer(config, mockBoard);
    assert.ok(agent);
    assert.strictEqual(agent.vaultPath, '/tmp/dummy-vault');
  });
});

// ============================================================
// classifyFile()
// ============================================================

describe('ObsidianOrganizer.classifyFile()', () => {
  it('returns "uncategorized" when no reflexion is injected', async () => {
    const board = makeBoard();
    const agent = new ObsidianOrganizer({ vaultPath: '/tmp/vault' }, board);
    const result = await agent.classifyFile('some content');
    assert.strictEqual(result, 'uncategorized');
  });

  it('calls reflexion.callLLM with a prompt that contains the content', async () => {
    const reflexion = makeReflexion('requirement');
    const board = makeBoard();
    const agent = new ObsidianOrganizer({ vaultPath: '/tmp/vault' }, board, reflexion);

    await agent.classifyFile('my file content');

    assert.strictEqual(reflexion.callLLM.mock.calls.length, 1);
    const [prompt, severity] = reflexion.callLLM.mock.calls[0].arguments;
    assert.ok(prompt.includes('my file content'), 'prompt should include the content');
    assert.strictEqual(severity, 'normal');
  });

  it('returns normalized (lowercase, trimmed) category string from LLM response', async () => {
    const reflexion = makeReflexion('  DESIGN  ');
    const board = makeBoard();
    const agent = new ObsidianOrganizer({ vaultPath: '/tmp/vault' }, board, reflexion);

    const result = await agent.classifyFile('design document');
    assert.strictEqual(result, 'design');
  });

  it('returns "uncategorized" when LLM throws an error', async () => {
    const reflexion = { callLLM: mock.fn(async () => { throw new Error('LLM error'); }) };
    const board = makeBoard();
    const agent = new ObsidianOrganizer({ vaultPath: '/tmp/vault' }, board, reflexion);

    const result = await agent.classifyFile('some content');
    assert.strictEqual(result, 'uncategorized');
  });

  it('returns "uncategorized" when LLM returns null', async () => {
    const reflexion = makeReflexion(null);
    const board = makeBoard();
    const agent = new ObsidianOrganizer({ vaultPath: '/tmp/vault' }, board, reflexion);

    const result = await agent.classifyFile('some content');
    assert.strictEqual(result, 'uncategorized');
  });
});

// ============================================================
// startWatcher()
// ============================================================

describe('ObsidianOrganizer.startWatcher()', () => {
  it('calls watcherFactory with vaultPath as first argument', () => {
    const board = makeBoard();
    const agent = new ObsidianOrganizer({ vaultPath: '/tmp/vault' }, board);
    const { factory } = makeWatcherFactory();

    agent.startWatcher(factory);

    assert.strictEqual(factory.mock.calls.length, 1);
    assert.strictEqual(factory.mock.calls[0].arguments[0], '/tmp/vault');
  });

  it('registers "add" handler on the watcher', () => {
    const board = makeBoard();
    const agent = new ObsidianOrganizer({ vaultPath: '/tmp/vault' }, board);
    const { factory, handlers } = makeWatcherFactory();

    agent.startWatcher(factory);

    assert.ok(typeof handlers['add'] === 'function', '"add" handler should be registered');
  });

  it('registers "change" handler on the watcher', () => {
    const board = makeBoard();
    const agent = new ObsidianOrganizer({ vaultPath: '/tmp/vault' }, board);
    const { factory, handlers } = makeWatcherFactory();

    agent.startWatcher(factory);

    assert.ok(typeof handlers['change'] === 'function', '"change" handler should be registered');
  });
});

// ============================================================
// onFileUpdate()
// ============================================================

describe('ObsidianOrganizer.onFileUpdate()', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('skips .canvas files and makes no fs calls', async () => {
    mock.method(fs, 'readFile', mock.fn(async () => 'content'));
    const board = makeBoard();
    const agent = new ObsidianOrganizer({ vaultPath: '/tmp/vault' }, board);

    await agent.onFileUpdate('/tmp/vault/diagram.canvas');

    assert.strictEqual(fs.readFile.mock.calls.length, 0, 'readFile should not be called for .canvas files');
  });

  it('reads file content via fs.readFile', async () => {
    mock.method(fs, 'readFile', mock.fn(async () => 'sample content'));
    mock.method(fs, 'mkdir', mock.fn(async () => {}));
    mock.method(fs, 'rename', mock.fn(async () => {}));

    const reflexion = makeReflexion('uncategorized');
    const board = makeBoard();
    const agent = new ObsidianOrganizer({ vaultPath: '/tmp/vault' }, board, reflexion);

    await agent.onFileUpdate('/tmp/vault/notes/myfile.md');

    assert.strictEqual(fs.readFile.mock.calls.length, 1);
    assert.strictEqual(fs.readFile.mock.calls[0].arguments[0], '/tmp/vault/notes/myfile.md');
  });

  it('calls classifyFile with the file content', async () => {
    mock.method(fs, 'readFile', mock.fn(async () => 'classified content'));
    mock.method(fs, 'mkdir', mock.fn(async () => {}));
    mock.method(fs, 'rename', mock.fn(async () => {}));

    const reflexion = makeReflexion('note');
    const board = makeBoard();
    const agent = new ObsidianOrganizer({ vaultPath: '/tmp/vault' }, board, reflexion);

    // Spy on classifyFile
    const original = agent.classifyFile.bind(agent);
    let classifyCalledWith = null;
    agent.classifyFile = async (content) => {
      classifyCalledWith = content;
      return original(content);
    };

    await agent.onFileUpdate('/tmp/vault/notes/test.md');

    assert.strictEqual(classifyCalledWith, 'classified content');
  });

  it('creates destDir and renames file when category matches a known mapping', async () => {
    mock.method(fs, 'readFile', mock.fn(async () => 'requirement content'));
    mock.method(fs, 'mkdir', mock.fn(async () => {}));
    mock.method(fs, 'rename', mock.fn(async () => {}));

    const reflexion = makeReflexion('requirement');
    const board = makeBoard();
    const agent = new ObsidianOrganizer({ vaultPath: '/tmp/vault' }, board, reflexion);

    await agent.onFileUpdate('/tmp/vault/inbox/spec.md');

    assert.strictEqual(fs.mkdir.mock.calls.length, 1);
    const mkdirPath = fs.mkdir.mock.calls[0].arguments[0];
    assert.ok(mkdirPath.includes('01-Requirements'), `mkdir path should include 01-Requirements, got: ${mkdirPath}`);

    assert.strictEqual(fs.rename.mock.calls.length, 1);
    const renameDest = fs.rename.mock.calls[0].arguments[1];
    assert.ok(renameDest.includes('01-Requirements'), `rename dest should include 01-Requirements, got: ${renameDest}`);
    assert.ok(renameDest.includes('spec.md'), 'rename dest should include original filename');
  });

  it('does nothing (no mkdir/rename) when category is "uncategorized"', async () => {
    mock.method(fs, 'readFile', mock.fn(async () => 'random content'));
    mock.method(fs, 'mkdir', mock.fn(async () => {}));
    mock.method(fs, 'rename', mock.fn(async () => {}));

    const reflexion = makeReflexion('uncategorized');
    const board = makeBoard();
    const agent = new ObsidianOrganizer({ vaultPath: '/tmp/vault' }, board, reflexion);

    await agent.onFileUpdate('/tmp/vault/random.md');

    assert.strictEqual(fs.mkdir.mock.calls.length, 0, 'mkdir should not be called for uncategorized');
    assert.strictEqual(fs.rename.mock.calls.length, 0, 'rename should not be called for uncategorized');
  });
});

// ============================================================
// handlePRD()
// ============================================================

describe('ObsidianOrganizer.handlePRD()', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('creates 01-Requirements directory with recursive:true', async () => {
    mock.method(fs, 'mkdir', mock.fn(async () => {}));
    mock.method(fs, 'writeFile', mock.fn(async () => {}));

    const board = makeBoard();
    const agent = new ObsidianOrganizer({ vaultPath: '/tmp/vault' }, board);

    await agent.handlePRD({ title: 'Feature Request', content: 'details', author: 'user' });

    assert.ok(fs.mkdir.mock.calls.length >= 1);
    const mkdirArgs = fs.mkdir.mock.calls[0].arguments;
    assert.ok(mkdirArgs[0].includes('01-Requirements'));
    assert.deepStrictEqual(mkdirArgs[1], { recursive: true });
  });

  it('writes file with correct markdown frontmatter including title and author', async () => {
    mock.method(fs, 'mkdir', mock.fn(async () => {}));
    mock.method(fs, 'writeFile', mock.fn(async () => {}));

    const board = makeBoard();
    const agent = new ObsidianOrganizer({ vaultPath: '/tmp/vault' }, board);

    await agent.handlePRD({ title: 'My PRD', content: 'body text', author: 'alice' });

    assert.strictEqual(fs.writeFile.mock.calls.length, 1);
    const writtenContent = fs.writeFile.mock.calls[0].arguments[1];
    assert.ok(writtenContent.includes('title: My PRD'), 'content should have title in frontmatter');
    assert.ok(writtenContent.includes('author: alice'), 'content should have author in frontmatter');
    assert.ok(writtenContent.includes('type: requirement'), 'content should have type in frontmatter');
    assert.ok(writtenContent.includes('body text'), 'content should include the body');
  });

  it('publishes to board.publish("obsidian:confirm") with author field', async () => {
    mock.method(fs, 'mkdir', mock.fn(async () => {}));
    mock.method(fs, 'writeFile', mock.fn(async () => {}));

    const board = makeBoard();
    const agent = new ObsidianOrganizer({ vaultPath: '/tmp/vault' }, board);

    await agent.handlePRD({ title: 'Board Test', content: 'test', author: 'bot' });

    assert.strictEqual(board.publish.mock.calls.length, 1);
    const [channel, data] = board.publish.mock.calls[0].arguments;
    assert.strictEqual(channel, 'obsidian:confirm');
    assert.strictEqual(data.author, 'obsidian-agent');
    assert.ok(data.message.includes('board-test.md'), `message should include slug, got: ${data.message}`);
  });

  it('does not publish when board is null', async () => {
    mock.method(fs, 'mkdir', mock.fn(async () => {}));
    mock.method(fs, 'writeFile', mock.fn(async () => {}));

    const agent = new ObsidianOrganizer({ vaultPath: '/tmp/vault' }, makeBoard());
    // Replace board with null after construction
    agent.board = null;

    await assert.doesNotReject(() =>
      agent.handlePRD({ title: 'No Board', content: 'test', author: 'x' })
    );
  });
});

// ============================================================
// handleImport()
// ============================================================

describe('ObsidianOrganizer.handleImport()', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('creates 04-Skills/background directory with recursive:true', async () => {
    mock.method(fs, 'mkdir', mock.fn(async () => {}));
    mock.method(fs, 'writeFile', mock.fn(async () => {}));

    const board = makeBoard();
    const agent = new ObsidianOrganizer({ vaultPath: '/tmp/vault' }, board);

    await agent.handleImport({ title: 'Research', content: 'findings', author: 'notebooklm' });

    assert.ok(fs.mkdir.mock.calls.length >= 1);
    const mkdirPath = fs.mkdir.mock.calls[0].arguments[0];
    assert.ok(mkdirPath.includes('04-Skills'), `mkdir path should include 04-Skills, got: ${mkdirPath}`);
    assert.ok(mkdirPath.includes('background'), `mkdir path should include background, got: ${mkdirPath}`);
  });

  it('writes file with correct frontmatter (type: research, tags: [external, notebooklm])', async () => {
    mock.method(fs, 'mkdir', mock.fn(async () => {}));
    mock.method(fs, 'writeFile', mock.fn(async () => {}));

    const board = makeBoard();
    const agent = new ObsidianOrganizer({ vaultPath: '/tmp/vault' }, board);

    await agent.handleImport({ title: 'My Research', content: 'the findings', author: 'nb' });

    assert.strictEqual(fs.writeFile.mock.calls.length, 1);
    const writtenContent = fs.writeFile.mock.calls[0].arguments[1];
    assert.ok(writtenContent.includes('type: research'), 'should include type: research');
    assert.ok(writtenContent.includes('tags: [external, notebooklm]'), 'should include tags');
  });

  it('includes data.content in the written file', async () => {
    mock.method(fs, 'mkdir', mock.fn(async () => {}));
    mock.method(fs, 'writeFile', mock.fn(async () => {}));

    const board = makeBoard();
    const agent = new ObsidianOrganizer({ vaultPath: '/tmp/vault' }, board);

    await agent.handleImport({ title: 'Topic', content: 'unique content string 12345', author: 'src' });

    const writtenContent = fs.writeFile.mock.calls[0].arguments[1];
    assert.ok(writtenContent.includes('unique content string 12345'), 'written file should include data.content');
  });
});

// ============================================================
// init()
// ============================================================

describe('ObsidianOrganizer.init()', () => {
  it('calls board.connect()', async () => {
    const board = makeBoard();
    const agent = new ObsidianOrganizer({ vaultPath: '/tmp/vault' }, board);

    await agent.init();

    assert.strictEqual(board.connect.mock.calls.length, 1);
  });

  it('calls board.createSubscriber()', async () => {
    const board = makeBoard();
    const agent = new ObsidianOrganizer({ vaultPath: '/tmp/vault' }, board);

    await agent.init();

    assert.strictEqual(board.createSubscriber.mock.calls.length, 1);
  });
});
