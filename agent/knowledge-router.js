/**
 * KnowledgeRouter — Phase 7 Knowledge Bridge
 * Routes questions to the appropriate knowledge service based on classification.
 * Fallback chain: Gemini → NotebookLM → Claude
 */
const { getLogger } = require('./logger');
const log = getLogger();

/** Keywords that indicate a "complex" question requiring Claude */
const COMPLEX_KEYWORDS = ['explain', 'analyze', 'compare', 'why', 'how does', 'what is the difference'];

/** Keywords that indicate a "document" question targeting NotebookLM */
const DOCUMENT_KEYWORDS = ['in the doc', 'from the doc', 'notebook', 'source', 'according to'];

class KnowledgeRouter {
  /**
   * @param {object} opts
   * @param {object} opts.geminiClient    - GeminiClient with ask(question) method
   * @param {object} opts.notebookLmClient - NotebookLMMCP with searchDocs(question, limit) method
   * @param {object} opts.claudeClient    - object with call(model, prompt, config) method
   */
  constructor({ geminiClient, notebookLmClient, claudeClient }) {
    this.geminiClient = geminiClient;
    this.notebookLmClient = notebookLmClient;
    this.claudeClient = claudeClient;
  }

  /**
   * Classify a question into 'simple', 'document', or 'complex'.
   *
   * Rules (in priority order):
   *   1. 'document' — if question contains any DOCUMENT_KEYWORDS
   *   2. 'complex'  — if question length > 50 OR contains any COMPLEX_KEYWORDS
   *   3. 'simple'   — everything else (short, no complex keywords)
   *
   * @param {string} question
   * @returns {'simple'|'document'|'complex'}
   */
  classifyQuestion(question) {
    const lower = question.toLowerCase();

    // Document check has highest priority
    for (const kw of DOCUMENT_KEYWORDS) {
      if (lower.includes(kw)) return 'document';
    }

    // Complex keyword check
    for (const kw of COMPLEX_KEYWORDS) {
      if (lower.includes(kw)) return 'complex';
    }

    // Length-based check: >50 chars → complex
    if (question.length > 50) return 'complex';

    return 'simple';
  }

  /**
   * Route the question to the appropriate service based on classification.
   * On service error, falls back through the chain: gemini → notebooklm → claude.
   * Throws if the entire chain is exhausted.
   *
   * @param {string} question
   * @returns {Promise<string>} answer string
   */
  async route(question) {
    const type = this.classifyQuestion(question);
    log.info('knowledge-router', `routing question (type=${type})`);

    // Ordered list of attempts: primary service first, then fallbacks
    const attempts = this._buildAttemptChain(type, question);

    let lastError;
    for (const attempt of attempts) {
      try {
        return await attempt();
      } catch (err) {
        lastError = err;
      }
    }

    throw lastError;
  }

  /**
   * Build an ordered list of async functions to try, primary first then fallbacks.
   * The fallback chain is always: gemini → notebooklm → claude.
   *
   * @private
   */
  _buildAttemptChain(type, question) {
    const geminiCall = () => this.geminiClient.ask(question);
    const notebookCall = async () => {
      const results = await this.notebookLmClient.searchDocs(question, 3);
      return results.map(r => r.content).join('\n');
    };
    const claudeCall = () => this.claudeClient.call(process.env.HUB_PRIMARY_MODEL || 'claude-haiku-4-5-20251001', question, {});

    // Start with the primary service for this type, then append the remaining two
    if (type === 'simple') {
      return [geminiCall, notebookCall, claudeCall];
    }
    if (type === 'document') {
      return [notebookCall, geminiCall, claudeCall];
    }
    // complex
    return [claudeCall, geminiCall, notebookCall];
  }

  /**
   * Returns the canonical fallback order.
   * @returns {string[]} ['gemini', 'notebooklm', 'claude']
   */
  getFallbackChain() {
    return ['gemini', 'notebooklm', 'claude'];
  }
}

module.exports = { KnowledgeRouter };
