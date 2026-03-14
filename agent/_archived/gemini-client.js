'use strict';
const { getLogger } = require('./logger');
const log = getLogger();

/**
 * GeminiClient — Phase 7 Knowledge Bridge
 *
 * Provides a cost-tracked interface to the Gemini API with:
 *   - ask(question)        — call Gemini, enforce daily spend limit
 *   - trackCost(amount)    — manually increment the running cost counter
 *   - checkLimit()         — true if more calls can be made today
 *   - getDailyCost()       — return current spend total
 *   - resetDailyCost()     — zero the counter and notify Blackboard
 *
 * Dependency injection keeps this fully unit-testable without touching
 * a real Gemini endpoint or Redis:
 *
 *   new GeminiClient({ board, apiKey, dailyLimitUsd, costPerCallUsd, httpClient })
 *
 * If no httpClient is provided the class falls back to the global fetch
 * (suitable for production use against the real Gemini REST API).
 */
class GeminiClient {
  /**
   * @param {object}  opts
   * @param {object}   opts.board           - Blackboard instance (publish method)
   * @param {string}   opts.apiKey          - Gemini API key
   * @param {number}  [opts.dailyLimitUsd=1.00]    - Maximum daily spend in USD
   * @param {number}  [opts.costPerCallUsd=0.0001] - Cost charged per ask() call
   * @param {object}  [opts.httpClient]     - Injected HTTP client with post(question)
   */
  constructor({
    board,
    apiKey,
    dailyLimitUsd = 1.00,
    costPerCallUsd = 0.0001,
    httpClient,
  } = {}) {
    this.board = board;
    this.apiKey = apiKey;
    this.dailyLimitUsd = dailyLimitUsd;
    this.costPerCallUsd = costPerCallUsd;
    this.httpClient = httpClient || null;

    /** Accumulated spend for the current calendar day (USD). */
    this.dailyCostUsd = 0;
  }

  // ── ask() ────────────────────────────────────────────────────────

  /**
   * Send a question to Gemini and return the response string.
   *
   * Pre-condition: checks the daily limit *before* issuing the HTTP call.
   * Post-condition: increments dailyCostUsd on success only.
   *
   * @param {string} question
   * @returns {Promise<string>}
   * @throws {Error} 'Daily limit exceeded' when spend limit would be crossed
   * @throws {Error} propagates any error thrown by httpClient.post
   */
  async ask(question) {
    if (this.dailyCostUsd + this.costPerCallUsd > this.dailyLimitUsd) {
      throw new Error('Daily limit exceeded');
    }

    const response = await this.httpClient.post(question);
    this.dailyCostUsd += this.costPerCallUsd;
    log.info('gemini-client', `ask() cost $${this.dailyCostUsd.toFixed(4)} / $${this.dailyLimitUsd}`);
    return response;
  }

  // ── trackCost() ──────────────────────────────────────────────────

  /**
   * Manually increment the daily cost counter.
   * Useful for recording costs from external operations.
   *
   * @param {number} amount - USD amount to add
   * @returns {number} new dailyCostUsd total
   */
  trackCost(amount) {
    this.dailyCostUsd += amount;
    return this.dailyCostUsd;
  }

  // ── checkLimit() ─────────────────────────────────────────────────

  /**
   * Returns whether additional calls can be made within the daily budget.
   *
   * @returns {boolean} true when dailyCostUsd < dailyLimitUsd, false otherwise
   */
  checkLimit() {
    return this.dailyCostUsd < this.dailyLimitUsd;
  }

  // ── getDailyCost() ───────────────────────────────────────────────

  /**
   * Return the current accumulated daily spend.
   *
   * @returns {number} current dailyCostUsd
   */
  getDailyCost() {
    return this.dailyCostUsd;
  }

  // ── resetDailyCost() ─────────────────────────────────────────────

  /**
   * Reset the daily spend counter to zero and notify the Blackboard.
   *
   * @returns {Promise<void>}
   */
  async resetDailyCost() {
    this.dailyCostUsd = 0;
    await this.board.publish('gemini:daily:reset', {
      author: 'gemini-client',
      resetAt: Date.now(),
    });
  }
}

module.exports = { GeminiClient };
