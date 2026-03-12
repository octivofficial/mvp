const { describe, it } = require('node:test');
const assert = require('node:assert');
const { ReflexionEngine } = require('../agent/ReflexionEngine.js');

describe('ReflexionEngine Librarian (RAG)', () => {
  it('should attempt to retrieve context from Obsidian before starting research', async () => {
    let searchCalled = false;
    const mockBoard = {
      connect: async () => {},
      getConfig: async () => ({ model: 'test' }),
      publish: async (channel, data) => {
        if (channel === 'obsidian:cli:task' && data.action === 'search') {
          searchCalled = true;
        }
      },
      createSubscriber: async () => ({
        subscribe: (channel, cb) => {
            // Mocking the result returning after some time
            if (channel === 'octiv:obsidian:cli:finished') {
                setTimeout(() => cb(JSON.stringify({ status: 'success', results: 'Existing research on topic X' })), 10);
            }
        },
        on: () => {}
      }),
      on: () => {},
      client: { on: () => {} }
    };

    const engine = new ReflexionEngine({});
    engine.board = mockBoard;
    
    // We expect the engine to use a Librarian method to query the vault
    const context = await engine.retrieveKnowledge('topic X');
    
    assert.strictEqual(searchCalled, true, 'Should have triggered a search command via Blackboard');
    assert.ok(context.includes('Existing research'), 'Should have captured the retrieved context');
  });

  it('should inject retrieved knowledge into the prompt', async () => {
    const engine = new ReflexionEngine({});
    const basePrompt = 'Write a PRD for X';
    const knowledge = 'Previous research shows X is popular in 2026.';
    
    const transformed = engine._injectKnowledge(basePrompt, knowledge);
    
    assert.ok(transformed.includes('Knowledge Base:'));
    assert.ok(transformed.includes(knowledge));
  });
});
