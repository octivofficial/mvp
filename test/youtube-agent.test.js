const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { YouTubeAgent } = require('../agent/youtube-agent.js');

describe('YouTubeAgent', () => {
  it('constructor initializes with id="youtube-agent"', () => {
    const agent = new YouTubeAgent();
    assert.strictEqual(agent.id, 'youtube-agent');
    assert.deepStrictEqual(agent.config, {});
    assert.strictEqual(agent.board, null);
    assert.strictEqual(agent.reflexion, null);
  });

  it('constructor stores provided config, board, and reflexion', () => {
    const config = { apiKey: 'test-key' };
    const board = { publish: async () => {}, createSubscriber: async () => ({ subscribe: () => {} }) };
    const reflexion = { callLLM: async () => 'result' };
    const agent = new YouTubeAgent(config, board, reflexion);
    assert.strictEqual(agent.config, config);
    assert.strictEqual(agent.board, board);
    assert.strictEqual(agent.reflexion, reflexion);
  });

  it('init() subscribes to "youtube:task" channel', async () => {
    let subscribedChannel = null;
    const mockBoard = {
      publish: async () => {},
      createSubscriber: async () => ({
        subscribe: (channel, _cb) => {
          subscribedChannel = channel;
        }
      })
    };
    const agent = new YouTubeAgent({}, mockBoard);
    await agent.init();
    assert.strictEqual(subscribedChannel, 'youtube:task');
  });

  it('init() does nothing when board is null', async () => {
    const agent = new YouTubeAgent({}, null);
    // Should not throw
    await assert.doesNotReject(() => agent.init());
  });

  it('handleTask routes "analyze" action to analyzeVideo', async () => {
    let analyzeVideoCalled = false;
    let capturedUrl = null;
    const agent = new YouTubeAgent();
    // Override analyzeVideo to track calls without real I/O
    agent.analyzeVideo = async (url) => {
      analyzeVideoCalled = true;
      capturedUrl = url;
      return { status: 'analyzed', relayed: true, researchTriggered: true };
    };
    const result = await agent.handleTask({ action: 'analyze', url: 'https://youtube.com/watch?v=abc' });
    assert.strictEqual(analyzeVideoCalled, true);
    assert.strictEqual(capturedUrl, 'https://youtube.com/watch?v=abc');
    assert.strictEqual(result.status, 'analyzed');
  });

  it('handleTask returns undefined for unknown action (logs warning)', async () => {
    const agent = new YouTubeAgent();
    const result = await agent.handleTask({ action: 'unknown_action' });
    assert.strictEqual(result, undefined);
  });

  it('analyzeVideo returns error when no reflexion engine', async () => {
    const mockBoard = {
      publish: async () => {},
      createSubscriber: async () => ({ subscribe: () => {} })
    };
    const agent = new YouTubeAgent({}, mockBoard, null);
    const result = await agent.analyzeVideo('https://youtube.com/watch?v=xyz');
    assert.strictEqual(result.status, 'error');
    assert.strictEqual(result.reason, 'No reflexion engine');
  });

  it('analyzeVideo calls reflexion.callLLM with transcript', async () => {
    let llmPrompt = null;
    let llmSeverity = null;
    const publishedCalls = [];

    const mockBoard = {
      publish: async (channel, data) => {
        publishedCalls.push({ channel, data });
      },
      createSubscriber: async () => ({ subscribe: () => {} })
    };
    const mockReflexion = {
      callLLM: async (prompt, severity) => {
        llmPrompt = prompt;
        llmSeverity = severity;
        return 'LLM analysis result';
      }
    };
    const agent = new YouTubeAgent({}, mockBoard, mockReflexion);
    await agent.analyzeVideo('https://youtube.com/watch?v=test');

    assert.ok(llmPrompt !== null, 'callLLM should have been called');
    assert.ok(llmPrompt.includes('[Transcription of the video content...]'), 'prompt should contain transcript');
    assert.strictEqual(llmSeverity, 'normal');
  });

  it('analyzeVideo publishes to notebook:task twice on success', async () => {
    const publishedCalls = [];
    const mockBoard = {
      publish: async (channel, data) => {
        publishedCalls.push({ channel, data });
      },
      createSubscriber: async () => ({ subscribe: () => {} })
    };
    const mockReflexion = {
      callLLM: async () => 'analysis content'
    };
    const agent = new YouTubeAgent({}, mockBoard, mockReflexion);
    await agent.analyzeVideo('https://youtube.com/watch?v=test');

    const notebookCalls = publishedCalls.filter(c => c.channel === 'notebook:task');
    assert.strictEqual(notebookCalls.length, 2);

    const uploadCall = notebookCalls.find(c => c.data.action === 'upload_source');
    assert.ok(uploadCall, 'Should publish upload_source action');
    assert.strictEqual(uploadCall.data.type, 'youtube_transcript');
    assert.strictEqual(uploadCall.data.author, 'youtube-agent');

    const researchCall = notebookCalls.find(c => c.data.action === 'deep_research');
    assert.ok(researchCall, 'Should publish deep_research action');
    assert.deepStrictEqual(researchCall.data.sources, ['youtube_transcript']);
    assert.strictEqual(researchCall.data.author, 'youtube-agent');
  });

  it('analyzeVideo returns { status: "analyzed", relayed: true, researchTriggered: true } on success', async () => {
    const mockBoard = {
      publish: async () => {},
      createSubscriber: async () => ({ subscribe: () => {} })
    };
    const mockReflexion = {
      callLLM: async () => 'analysis content'
    };
    const agent = new YouTubeAgent({}, mockBoard, mockReflexion);
    const result = await agent.analyzeVideo('https://youtube.com/watch?v=success');
    assert.deepStrictEqual(result, { status: 'analyzed', relayed: true, researchTriggered: true });
  });

  it('analyzeVideo uses transcript as content when callLLM returns null', async () => {
    const publishedCalls = [];
    const mockBoard = {
      publish: async (channel, data) => {
        publishedCalls.push({ channel, data });
      },
      createSubscriber: async () => ({ subscribe: () => {} })
    };
    const mockReflexion = {
      callLLM: async () => null
    };
    const agent = new YouTubeAgent({}, mockBoard, mockReflexion);
    await agent.analyzeVideo('https://youtube.com/watch?v=nullresult');

    const uploadCall = publishedCalls.find(
      c => c.channel === 'notebook:task' && c.data.action === 'upload_source'
    );
    assert.ok(uploadCall, 'Should still publish upload_source');
    assert.strictEqual(uploadCall.data.content, '[Transcription of the video content...]');
  });
});
