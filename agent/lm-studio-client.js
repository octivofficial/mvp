/**
 * LMStudioClient — cached health, multi-URL failover, <think> stripping, retry
 *
 * Replaces inline closure in api-clients.js with:
 * - Periodic health polling (configurable interval, default 30s)
 * - Multi-URL failover (LM_STUDIO_URLS comma-separated)
 * - Qwen <think> tag stripping via cleanResponse()
 * - Retry once on transient failure, then try next URL
 * - Optional Blackboard health publishing
 *
 * Interface: { call(model, prompt) → Promise<string> }
 */
const { getLogger } = require('./logger');
const T = require('../config/timeouts');

const log = getLogger();

class LMStudioClient {
  /**
   * @param {Object} [options]
   * @param {string[]} [options.urls] - LM Studio base URLs
   * @param {Object} [options.board] - Blackboard instance with publish()
   */
  constructor(options = {}) {
    this.config = options.config || {};
    this.urls = options.urls
      || (process.env.LM_STUDIO_URLS
        ? process.env.LM_STUDIO_URLS.split(',').map(u => u.trim()).filter(Boolean)
        : [process.env.LM_STUDIO_URL || 'http://localhost:1234']);
    this._board = options.board || null;
    this._healthy = false;
    this._activeUrl = null;
    this._lastHealthCheck = 0;
    this._models = [];
    this._healthInterval = null;
  }

  /**
   * Strip Qwen <think>...</think> reasoning tags from response
   * @param {string} text
   * @returns {string}
   */
  static cleanResponse(text) {
    if (!text) return '';
    return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  }

  /**
   * Probe URLs in order, set _activeUrl to first healthy one
   */
  async checkHealth() {
    for (const url of this.urls) {
      try {
        const res = await fetch(`${url}/v1/models`, {
          signal: AbortSignal.timeout(T.LM_STUDIO_HEALTH_CHECK_MS),
        });
        if (!res.ok) continue;

        const data = await res.json();
        this._models = (data.data || []).map(m => m.id);
        this._activeUrl = url;
        this._healthy = true;
        this._lastHealthCheck = Date.now();
        log.info('lm-studio', `Healthy: ${url}`, { models: this._models });
        this._publishHealth(true);
        return;
      } catch {
        // Try next URL
      }
    }

    // All URLs failed
    this._healthy = false;
    this._activeUrl = null;
    this._models = [];
    this._lastHealthCheck = Date.now();
    // Suppress warning if LM Studio is intentionally disabled (e.g. cloud VM)
    if (process.env.LM_STUDIO_ENABLED !== 'false') {
      log.warn('lm-studio', 'All URLs unreachable', { urls: this.urls });
    }
    this._publishHealth(false);
  }

  /**
   * Call LM Studio inference with retry and failover
   * @param {string} model
   * @param {string} prompt
   * @returns {Promise<string>}
   */
  async call(model, prompt) {
    // If not healthy, try a quick health check first
    if (!this._healthy || !this._activeUrl) {
      await this.checkHealth();
      if (!this._healthy) {
        throw new Error('LM Studio not reachable — all URLs down');
      }
    }

    // Try active URL with one retry
    const triedUrls = new Set();
    let lastError;

    // First: try _activeUrl (with retry)
    try {
      return await this._tryUrlWithRetry(this._activeUrl, model, prompt);
    } catch (err) {
      lastError = err;
      triedUrls.add(this._activeUrl);
    }

    // Failover: try remaining URLs
    for (const url of this.urls) {
      if (triedUrls.has(url)) continue;
      try {
        const result = await this._inference(url, model, prompt);
        this._activeUrl = url; // promote on success
        return LMStudioClient.cleanResponse(result);
      } catch (err) {
        lastError = err;
        triedUrls.add(url);
      }
    }

    throw lastError;
  }

  /**
   * Try a URL with one retry after delay
   * @private
   */
  async _tryUrlWithRetry(baseUrl, model, prompt) {
    try {
      const result = await this._inference(baseUrl, model, prompt);
      return LMStudioClient.cleanResponse(result);
    } catch (firstErr) {
      log.debug('lm-studio', 'Transient failure, retrying', { error: firstErr.message, url: baseUrl });
      await new Promise(r => setTimeout(r, T.LM_STUDIO_RETRY_DELAY_MS));
      const result = await this._inference(baseUrl, model, prompt);
      return LMStudioClient.cleanResponse(result);
    }
  }

  /**
   * POST /v1/chat/completions to a specific URL
   * @private
   */
  async _inference(baseUrl, model, prompt) {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: this.config?.maxTokens || 1024,
        temperature: this.config?.temperature !== undefined ? this.config.temperature : 0.7,
      }),
      signal: AbortSignal.timeout(T.LM_STUDIO_INFERENCE_TIMEOUT_MS),
    });

    if (!res.ok) {
      throw new Error(`LM Studio ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  }

  /**
   * Start periodic health polling
   */
  startHealthMonitor() {
    if (this._healthInterval) return; // idempotent
    this._healthInterval = setInterval(
      () => this.checkHealth().catch(() => {}),
      T.LM_STUDIO_HEALTH_INTERVAL_MS,
    );
    // Don't hold process open
    if (this._healthInterval.unref) this._healthInterval.unref();
  }

  /**
   * Stop periodic health polling
   */
  stopHealthMonitor() {
    if (this._healthInterval) {
      clearInterval(this._healthInterval);
      this._healthInterval = null;
    }
  }

  /**
   * Publish health status to Blackboard (optional)
   * @private
   */
  _publishHealth(healthy) {
    if (!this._board) return;
    this._board.publish('infra:lm-studio:health', {
      author: 'lm-studio-client',
      healthy,
      activeUrl: this._activeUrl,
      models: this._models,
      timestamp: Date.now(),
    }).catch(() => {}); // non-critical, suppress unhandled rejection
  }
}

module.exports = { LMStudioClient };
