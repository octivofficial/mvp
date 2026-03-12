const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Mock crawlee before requiring CrawlerAgent, since crawler-agent.js
// does `const { PlaywrightCrawler, Dataset } = require('crawlee')` at the top level.
// Node.js native test runner does not support require-time mocks the same way jest does,
// so we use mock.module() which is available in Node 22+.
// For compatibility we also patch the module cache directly.
const Module = require('module');
const originalLoad = Module._load;

// Items storage that tests can control
let mockDatasetItems = [];

const mockCrawlee = {
  PlaywrightCrawler: class MockPlaywrightCrawler {
    constructor(_opts) {}
    async run(_urls) {
      // No-op: no real browser
    }
  },
  Dataset: {
    getData: async () => ({ items: mockDatasetItems }),
    pushData: async (_item) => {}
  }
};

// Intercept require('crawlee') before loading CrawlerAgent
Module._load = function (request, _parent, _isMain) {
  if (request === 'crawlee') {
    return mockCrawlee;
  }
  return originalLoad.apply(this, arguments);
};

// Now safe to require CrawlerAgent (crawlee is mocked)
const { CrawlerAgent } = require('../agent/crawler-agent.js');

// Restore original loader after module is loaded
Module._load = originalLoad;

describe('CrawlerAgent', () => {
  it('constructor initializes with config and board', () => {
    const config = { maxRequests: 5 };
    const board = { publish: async () => {}, createSubscriber: async () => ({ subscribe: () => {} }) };
    const agent = new CrawlerAgent(config, board);
    assert.strictEqual(agent.config, config);
    assert.strictEqual(agent.board, board);
    assert.strictEqual(agent.crawler, null);
  });

  it('constructor works with no arguments (defaults)', () => {
    const agent = new CrawlerAgent();
    assert.deepStrictEqual(agent.config, {});
    assert.strictEqual(agent.board, null);
    assert.strictEqual(agent.crawler, null);
  });

  it('init() subscribes to "crawler:start" channel', async () => {
    let subscribedChannel = null;
    const mockBoard = {
      publish: async () => {},
      createSubscriber: async () => ({
        subscribe: (channel, _cb) => {
          subscribedChannel = channel;
        }
      })
    };
    const agent = new CrawlerAgent({}, mockBoard);
    await agent.init();
    assert.strictEqual(subscribedChannel, 'crawler:start');
  });

  it('init() does nothing when board is null', async () => {
    const agent = new CrawlerAgent({}, null);
    await assert.doesNotReject(() => agent.init());
  });

  it('publishResults publishes to "crawler:finished" with summary when items exist', async () => {
    let publishedChannel = null;
    let publishedData = null;
    const mockBoard = {
      publish: async (channel, data) => {
        publishedChannel = channel;
        publishedData = data;
      },
      createSubscriber: async () => ({ subscribe: () => {} })
    };

    // Set up mock dataset items
    mockDatasetItems = [
      { title: 'Page One', url: 'https://example.com/page1' },
      { title: 'Page Two', url: 'https://example.com/page2' }
    ];

    const agent = new CrawlerAgent({}, mockBoard);
    await agent.publishResults({ topic: 'test research' });

    assert.strictEqual(publishedChannel, 'crawler:finished');
    assert.strictEqual(publishedData.author, 'crawler-agent');
    assert.ok(publishedData.summary.includes('Page One'), 'summary should contain first page title');
    assert.ok(publishedData.summary.includes('Page Two'), 'summary should contain second page title');
    assert.ok(publishedData.summary.includes('https://example.com/page1'), 'summary should contain first URL');
    assert.deepStrictEqual(publishedData.context, { topic: 'test research' });
    assert.ok(typeof publishedData.timestamp === 'string', 'timestamp should be a string');
  });

  it('publishResults summary format is markdown link list', async () => {
    const publishedCalls = [];
    const mockBoard = {
      publish: async (channel, data) => {
        publishedCalls.push({ channel, data });
      },
      createSubscriber: async () => ({ subscribe: () => {} })
    };

    mockDatasetItems = [
      { title: 'Article Title', url: 'https://news.example.com/article' }
    ];

    const agent = new CrawlerAgent({}, mockBoard);
    await agent.publishResults({});

    assert.strictEqual(publishedCalls.length, 1);
    const summary = publishedCalls[0].data.summary;
    assert.strictEqual(summary, '- [Article Title](https://news.example.com/article)');
  });

  it('publishResults does NOT publish when items array is empty', async () => {
    let publishCalled = false;
    const mockBoard = {
      publish: async () => {
        publishCalled = true;
      },
      createSubscriber: async () => ({ subscribe: () => {} })
    };

    // Empty dataset
    mockDatasetItems = [];

    const agent = new CrawlerAgent({}, mockBoard);
    await agent.publishResults({});

    assert.strictEqual(publishCalled, false, 'publish should NOT be called when no items');
  });

  it('publishResults does NOT publish when board is null', async () => {
    // Even with items, no board means no publish (no crash either)
    mockDatasetItems = [
      { title: 'Some Page', url: 'https://example.com' }
    ];
    const agent = new CrawlerAgent({}, null);
    await assert.doesNotReject(() => agent.publishResults({}));
  });

  it('publishResults uses empty context object by default', async () => {
    let publishedData = null;
    const mockBoard = {
      publish: async (_channel, data) => {
        publishedData = data;
      },
      createSubscriber: async () => ({ subscribe: () => {} })
    };

    mockDatasetItems = [
      { title: 'Default Context Page', url: 'https://example.com/default' }
    ];

    const agent = new CrawlerAgent({}, mockBoard);
    await agent.publishResults(); // No context argument — defaults to {}

    assert.deepStrictEqual(publishedData.context, {});
  });
});
