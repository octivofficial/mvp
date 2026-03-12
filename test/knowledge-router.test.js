/**
 * Tests for KnowledgeRouter — Phase 7 Knowledge Bridge
 * TDD: Tests written FIRST, before implementation.
 * Usage: node --test test/knowledge-router.test.js
 */
const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');

const { KnowledgeRouter } = require('../agent/knowledge-router');

// ── Mock Helpers ─────────────────────────────────────────────────────

const makeGemini = (response = 'gemini-answer') => ({
  ask: mock.fn(async () => response),
});

const makeNotebook = (results = []) => ({
  searchDocs: mock.fn(async () => results),
});

const makeClaude = (response = 'claude-answer') => ({
  call: mock.fn(async () => response),
});

// Sample document results for notebooklm mock
const sampleDocs = [
  { title: 'Doc A', content: 'Content A', relevance: 0.9 },
  { title: 'Doc B', content: 'Content B', relevance: 0.8 },
  { title: 'Doc C', content: 'Content C', relevance: 0.7 },
];

// ── Constructor ───────────────────────────────────────────────────────

describe('KnowledgeRouter', () => {
  describe('constructor', () => {
    it('stores geminiClient', () => {
      const gemini = makeGemini();
      const router = new KnowledgeRouter({
        geminiClient: gemini,
        notebookLmClient: makeNotebook(),
        claudeClient: makeClaude(),
      });
      assert.equal(router.geminiClient, gemini, 'geminiClient should be stored');
    });

    it('stores notebookLmClient', () => {
      const notebook = makeNotebook();
      const router = new KnowledgeRouter({
        geminiClient: makeGemini(),
        notebookLmClient: notebook,
        claudeClient: makeClaude(),
      });
      assert.equal(router.notebookLmClient, notebook, 'notebookLmClient should be stored');
    });

    it('stores claudeClient', () => {
      const claude = makeClaude();
      const router = new KnowledgeRouter({
        geminiClient: makeGemini(),
        notebookLmClient: makeNotebook(),
        claudeClient: claude,
      });
      assert.equal(router.claudeClient, claude, 'claudeClient should be stored');
    });
  });

  // ── classifyQuestion() ────────────────────────────────────────────

  describe('classifyQuestion()', () => {
    let router;
    beforeEach(() => {
      router = new KnowledgeRouter({
        geminiClient: makeGemini(),
        notebookLmClient: makeNotebook(),
        claudeClient: makeClaude(),
      });
    });

    // simple cases — short and no complex keywords
    it('classifies short plain question as "simple"', () => {
      const result = router.classifyQuestion('What time is it?');
      assert.equal(result, 'simple', 'short plain question should be "simple"');
    });

    it('classifies very short question as "simple"', () => {
      const result = router.classifyQuestion('Hi there');
      assert.equal(result, 'simple');
    });

    it('classifies a 50-char question with no keywords as "simple"', () => {
      // exactly 50 chars — boundary condition
      const q = 'x'.repeat(50);
      const result = router.classifyQuestion(q);
      assert.equal(result, 'simple', '50-char question should still be simple');
    });

    // document cases
    it('classifies question with "in the doc" as "document"', () => {
      const result = router.classifyQuestion('What is mentioned in the doc?');
      assert.equal(result, 'document', '"in the doc" should route to document');
    });

    it('classifies question with "from the doc" as "document"', () => {
      const result = router.classifyQuestion('Get the summary from the doc');
      assert.equal(result, 'document');
    });

    it('classifies question with "notebook" as "document"', () => {
      const result = router.classifyQuestion('Search notebook for agent config');
      assert.equal(result, 'document');
    });

    it('classifies question with "source" as "document"', () => {
      const result = router.classifyQuestion('What does the source say about Redis?');
      assert.equal(result, 'document');
    });

    it('classifies question with "according to" as "document"', () => {
      const result = router.classifyQuestion('According to the spec, what is the limit?');
      assert.equal(result, 'document');
    });

    // complex cases — long OR has complex keywords
    it('classifies question longer than 50 chars as "complex"', () => {
      const q = 'This is a longer question that goes beyond the fifty character limit set in the spec';
      assert.ok(q.length > 50, 'test pre-condition: question must be >50 chars');
      const result = router.classifyQuestion(q);
      assert.equal(result, 'complex', 'long question should be "complex"');
    });

    it('classifies question with "explain" keyword as "complex"', () => {
      const result = router.classifyQuestion('explain this');
      assert.equal(result, 'complex', '"explain" keyword should make it complex');
    });

    it('classifies question with "analyze" keyword as "complex"', () => {
      const result = router.classifyQuestion('analyze that');
      assert.equal(result, 'complex');
    });

    it('classifies question with "compare" keyword as "complex"', () => {
      const result = router.classifyQuestion('compare these');
      assert.equal(result, 'complex');
    });

    it('classifies question with "why" keyword as "complex"', () => {
      const result = router.classifyQuestion('why does this happen?');
      assert.equal(result, 'complex');
    });

    it('classifies question with "how does" keyword as "complex"', () => {
      const result = router.classifyQuestion('how does it work?');
      assert.equal(result, 'complex');
    });

    it('classifies question with "what is the difference" as "complex"', () => {
      const result = router.classifyQuestion('what is the difference between A and B?');
      assert.equal(result, 'complex');
    });

    it('classifies short question with complex keyword as "complex"', () => {
      // short (<=50) but has "why" — complex keyword wins
      const q = 'why?';
      assert.ok(q.length <= 50, 'test pre-condition: question must be <=50');
      const result = router.classifyQuestion(q);
      assert.equal(result, 'complex', 'complex keyword overrides short length');
    });

    // document keyword takes priority over length check
    it('classifies long question with "notebook" as "document"', () => {
      const q = 'Can you search the notebook for information about the Redis pipeline configuration?';
      assert.ok(q.length > 50);
      const result = router.classifyQuestion(q);
      assert.equal(result, 'document', 'document keyword should win even for long questions');
    });
  });

  // ── route() ───────────────────────────────────────────────────────

  describe('route()', () => {
    let gemini, notebook, claude, router;

    beforeEach(() => {
      gemini = makeGemini('gemini-response');
      notebook = makeNotebook(sampleDocs);
      claude = makeClaude('claude-response');
      router = new KnowledgeRouter({
        geminiClient: gemini,
        notebookLmClient: notebook,
        claudeClient: claude,
      });
    });

    it('routes simple question to geminiClient.ask()', async () => {
      const answer = await router.route('What time?');
      assert.equal(gemini.ask.mock.calls.length, 1, 'gemini.ask should be called once');
      assert.equal(gemini.ask.mock.calls[0].arguments[0], 'What time?', 'question passed to gemini');
      assert.equal(answer, 'gemini-response');
    });

    it('routes document question to notebookLmClient.searchDocs()', async () => {
      const answer = await router.route('What is mentioned in the doc?');
      assert.equal(notebook.searchDocs.mock.calls.length, 1, 'searchDocs should be called once');
      assert.equal(notebook.searchDocs.mock.calls[0].arguments[0], 'What is mentioned in the doc?');
      assert.equal(notebook.searchDocs.mock.calls[0].arguments[1], 3, 'limit should be 3');
    });

    it('returns joined content from document search results', async () => {
      const answer = await router.route('What is mentioned in the doc?');
      const expected = sampleDocs.map(r => r.content).join('\n');
      assert.equal(answer, expected, 'document results should be joined by newline');
    });

    it('routes complex question to claudeClient.call()', async () => {
      const q = 'This is a longer question that definitely exceeds fifty characters in total length';
      const answer = await router.route(q);
      assert.equal(claude.call.mock.calls.length, 1, 'claude.call should be called once');
      assert.equal(claude.call.mock.calls[0].arguments[0], 'claude-haiku-4-5', 'correct model');
      assert.equal(claude.call.mock.calls[0].arguments[1], q, 'question passed to claude');
      assert.deepEqual(claude.call.mock.calls[0].arguments[2], {}, 'empty config object');
      assert.equal(answer, 'claude-response');
    });

    it('does not call other clients for simple question', async () => {
      await router.route('Hello?');
      assert.equal(notebook.searchDocs.mock.calls.length, 0);
      assert.equal(claude.call.mock.calls.length, 0);
    });

    it('does not call other clients for document question', async () => {
      await router.route('Search notebook for config');
      assert.equal(gemini.ask.mock.calls.length, 0);
      assert.equal(claude.call.mock.calls.length, 0);
    });

    it('does not call other clients for complex question', async () => {
      const q = 'explain why the agent fails to navigate around obstacles correctly here';
      await router.route(q);
      assert.equal(gemini.ask.mock.calls.length, 0);
      assert.equal(notebook.searchDocs.mock.calls.length, 0);
    });

    // fallback chain tests
    it('falls back to notebookLm when gemini throws', async () => {
      const failingGemini = { ask: mock.fn(async () => { throw new Error('gemini down'); }) };
      const fallbackNotebook = makeNotebook([{ title: 'X', content: 'fallback content', relevance: 1 }]);
      const routerWithFail = new KnowledgeRouter({
        geminiClient: failingGemini,
        notebookLmClient: fallbackNotebook,
        claudeClient: makeClaude(),
      });
      const answer = await routerWithFail.route('Short?');
      assert.equal(fallbackNotebook.searchDocs.mock.calls.length, 1, 'should try notebookLm after gemini fails');
      assert.equal(answer, 'fallback content');
    });

    it('falls back to claude when gemini and notebookLm both throw', async () => {
      const failingGemini = { ask: mock.fn(async () => { throw new Error('gemini down'); }) };
      const failingNotebook = { searchDocs: mock.fn(async () => { throw new Error('notebook down'); }) };
      const fallbackClaude = makeClaude('claude-fallback');
      const routerWithFail = new KnowledgeRouter({
        geminiClient: failingGemini,
        notebookLmClient: failingNotebook,
        claudeClient: fallbackClaude,
      });
      const answer = await routerWithFail.route('Short?');
      assert.equal(fallbackClaude.call.mock.calls.length, 1, 'should try claude after both fail');
      assert.equal(answer, 'claude-fallback');
    });

    it('throws when all three services fail', async () => {
      const routerAllFail = new KnowledgeRouter({
        geminiClient: { ask: mock.fn(async () => { throw new Error('gemini down'); }) },
        notebookLmClient: { searchDocs: mock.fn(async () => { throw new Error('notebook down'); }) },
        claudeClient: { call: mock.fn(async () => { throw new Error('claude down'); }) },
      });
      await assert.rejects(
        () => routerAllFail.route('Short?'),
        (err) => {
          assert.ok(err instanceof Error, 'should throw an Error');
          return true;
        },
        'should throw when entire fallback chain is exhausted'
      );
    });

    it('returns empty string when document search returns no results', async () => {
      const emptyNotebook = makeNotebook([]);
      const routerEmpty = new KnowledgeRouter({
        geminiClient: makeGemini(),
        notebookLmClient: emptyNotebook,
        claudeClient: makeClaude(),
      });
      const answer = await routerEmpty.route('What is in the doc?');
      assert.equal(answer, '', 'empty results should produce empty string');
    });
  });

  // ── getFallbackChain() ────────────────────────────────────────────

  describe('getFallbackChain()', () => {
    let router;
    beforeEach(() => {
      router = new KnowledgeRouter({
        geminiClient: makeGemini(),
        notebookLmClient: makeNotebook(),
        claudeClient: makeClaude(),
      });
    });

    it('returns an array', () => {
      const chain = router.getFallbackChain();
      assert.ok(Array.isArray(chain), 'should return an array');
    });

    it('returns exactly 3 elements', () => {
      const chain = router.getFallbackChain();
      assert.equal(chain.length, 3, 'fallback chain should have 3 services');
    });

    it('first element is "gemini"', () => {
      const chain = router.getFallbackChain();
      assert.equal(chain[0], 'gemini');
    });

    it('second element is "notebooklm"', () => {
      const chain = router.getFallbackChain();
      assert.equal(chain[1], 'notebooklm');
    });

    it('third element is "claude"', () => {
      const chain = router.getFallbackChain();
      assert.equal(chain[2], 'claude');
    });

    it('returns the correct full chain in order', () => {
      const chain = router.getFallbackChain();
      assert.deepEqual(chain, ['gemini', 'notebooklm', 'claude']);
    });
  });
});
