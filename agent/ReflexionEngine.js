/**
 * Octiv ReflexionEngine — Phase 4.3 + 4.5 + 4.6
 * LLM bridge with multi-model routing, cost guardrails, config auto-reload.
 * Default: Claude Sonnet 4.6 → escalate to Opus 4.6 → fallback Groq.
 */
const { Blackboard } = require('./blackboard');

const DEFAULT_CONFIG = {
  model: 'claude-sonnet-4-6-20250514',
  escalationModel: 'claude-opus-4-6-20250514',
  fallbackModel: 'groq:qwen3-coder',
  temperature: 0.7,
  maxTokens: 1024,
  costPerAttempt: 0.01,
  maxCostPerDay: 0.50,
};

class ReflexionEngine {
  constructor(apiClients = {}) {
    this.board = new Blackboard();
    this.config = { ...DEFAULT_CONFIG };
    this.apiClients = apiClients; // { anthropic, groq } — injected
    this.dailyCost = 0;
    this.totalCalls = 0;
    this.modelUsage = {};
  }

  async init() {
    await this.board.connect();
    // Load config from Redis
    await this.reloadConfig();
    console.log(`[ReflexionEngine] initialized, model: ${this.config.model}`);
  }

  // 4.5: Reload config from Redis (hot reload)
  async reloadConfig() {
    const saved = await this.board.getConfig('config:llm');
    if (saved) {
      Object.assign(this.config, saved);
    }
    return this.config;
  }

  // 4.5: Save config to Redis
  async saveConfig(updates) {
    Object.assign(this.config, updates);
    await this.board.setConfig('config:llm', this.config);
    await this.board.publish('config:llm:updated', { author: 'reflexion-engine', ...this.config });
    return this.config;
  }

  // 4.5: Generate skill JSON from failure context
  async generateSkill(failureContext) {
    const prompt = this._buildPrompt(failureContext);
    const response = await this.callLLM(prompt, failureContext.severity || 'normal');

    if (!response) return null;

    try {
      // Parse JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
    } catch {}

    return null;
  }

  // 4.6: Multi-LLM router with escalation and fallback
  async callLLM(prompt, severity = 'normal') {
    // Cost guardrail
    if (this.dailyCost >= this.config.maxCostPerDay) {
      console.warn('[ReflexionEngine] daily cost limit reached');
      return null;
    }

    const model = severity === 'critical'
      ? this.config.escalationModel
      : this.config.model;

    this.totalCalls++;
    this.dailyCost += this.config.costPerAttempt;

    // Try primary model
    try {
      const result = await this._callModel(model, prompt);
      this._trackUsage(model);
      return result;
    } catch (primaryErr) {
      console.warn(`[ReflexionEngine] primary (${model}) failed: ${primaryErr.message}`);
    }

    // Fallback to Groq
    try {
      const result = await this._callModel(this.config.fallbackModel, prompt);
      this._trackUsage(this.config.fallbackModel);
      return result;
    } catch (fallbackErr) {
      console.error(`[ReflexionEngine] fallback failed: ${fallbackErr.message}`);
    }

    return null;
  }

  async _callModel(model, prompt) {
    if (model.startsWith('groq:') && this.apiClients.groq) {
      return await this.apiClients.groq.call(model.slice(5), prompt);
    }
    if (this.apiClients.anthropic) {
      return await this.apiClients.anthropic.call(model, prompt);
    }
    // Mock response for testing
    throw new Error(`No API client for model: ${model}`);
  }

  _buildPrompt(context) {
    return [
      'Generate a Minecraft bot skill to handle this failure.',
      `Error: ${context.error}`,
      `Error type: ${context.errorType || 'unknown'}`,
      `Agent: ${context.agentId || 'unknown'}`,
      'Return a JSON object with: { name, code, description, errorType }',
      'The code must be safe, synchronous JavaScript.',
    ].join('\n');
  }

  _trackUsage(model) {
    this.modelUsage[model] = (this.modelUsage[model] || 0) + 1;
  }

  getStats() {
    return {
      totalCalls: this.totalCalls,
      dailyCost: this.dailyCost,
      modelUsage: { ...this.modelUsage },
      config: { ...this.config },
    };
  }

  async shutdown() {
    await this.board.disconnect();
  }
}

module.exports = { ReflexionEngine, DEFAULT_CONFIG };
