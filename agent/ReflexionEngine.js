/**
 * Octiv ReflexionEngine — Phase 4.3 + 4.5 + 4.6
 * LLM bridge with multi-model routing, cost guardrails, config auto-reload.
 * Default: Claude Sonnet 4.6 → escalate to Opus 4.6 → fallback Groq.
 */
const { Blackboard } = require('./blackboard');
const { getLogger } = require('./logger');
const log = getLogger();

const DEFAULT_CONFIG = {
  model: process.env.HUB_PRIMARY_MODEL || 'gemini-3.0-flash',
  escalationModel: process.env.HUB_ESCALATION_MODEL || 'claude-sonnet-4-6',
  ultraModel: process.env.HUB_ULTRA_MODEL || 'claude-opus-4-6',
  liteModel: process.env.HUB_LITE_MODEL || 'claude-sonnet-4-5',
  researchModel: process.env.HUB_RESEARCH_MODEL || 'gemini-3.0-pro',
  fallbackModel: process.env.HUB_FALLBACK_MODEL || 'local:qwen/qwen3.5-9b',
  temperature: 0.7,
  maxTokens: 2048,
  costPerAttempt: 0.01,
  maxCostPerDay: 5.00, // Increased for enterprise-grade autonomous work
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
    log.info('reflexion', `initialized, model: ${this.config.model}`);
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

    return null;
  }

  /**
   * Intent-based autonomous routing
   * Routes tasks to Crawler (Research) or Google Agent (Automation)
   */
  async handleIntent(userInput, context = {}) {
    const intentPrompt = `Analyze this user input and decide the next action.
Input: ${userInput}
Context: ${JSON.stringify(context)}

Available Actions:
- RESEARCH: User wants to find information on the web or crawl a URL.
- AUTOMATION: User wants to create a Google Doc, Sheet, or automate a Google product.
- VIBE: User wants to generate code or a PRD.
- CHAT: Regular conversation.

Return ONLY a JSON: { "intent": "RESEARCH"|"AUTOMATION"|"VIBE"|"CHAT", "payload": "extracted details" }`;

    const response = await this.callLLM(intentPrompt, 'normal');
    if (!response) return null;

    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;
      const parsed = JSON.parse(jsonMatch[0]);
      
      if (parsed.intent === 'RESEARCH') {
        await this.board.publish('crawler:start', { url: parsed.payload, context });
        return 'Research started. I will update you once crawling is complete.';
      }
      
      if (parsed.intent === 'AUTOMATION') {
        await this.board.publish('google:task', { action: 'automate', description: parsed.payload });
        return 'Google Automation task queued.';
      }
    } catch (err) {
      log.error('reflexion', 'Intent parsing failed', { error: err.message });
    }
    return null;
  }

  // 4.6: Multi-LLM router with escalation and fallback
  async callLLM(prompt, severity = 'normal') {
    // Cost guardrail
    if (this.dailyCost >= this.config.maxCostPerDay) {
      log.warn('reflexion', 'daily cost limit reached');
      return null;
    }

    // Determine target models based on severity
    const primaryModel = this.config.model;
    let secondaryModel = this.config.escalationModel; 
    let forceLocal = severity === 'local';
    
    if (severity === 'critical') {
      secondaryModel = this.config.ultraModel;
    } else if (severity === 'light') {
      secondaryModel = this.config.liteModel;
    }

    this.totalCalls++;
    this.dailyCost += this.config.costPerAttempt;

    // Phase 18: RAG Retrieval
    let augmentedPrompt = prompt;
    if (!forceLocal && severity !== 'light') {
        const knowledge = await this.retrieveKnowledge(prompt);
        if (knowledge) {
            augmentedPrompt = this._injectKnowledge(prompt, knowledge);
        }
    }

    // Stage 1: Primary (Cloud) - SKIP if forceLocal
    if (!forceLocal) {
      try {
        const result = await this._callModel(primaryModel, augmentedPrompt);
        this._trackUsage(primaryModel);
        return result;
      } catch (err) {
        log.warn('reflexion', `primary (${primaryModel}) failed, falling back to Claude (${secondaryModel})`, { error: err.message });
      }

      // Stage 2: Claude Fallback (Opus/Sonnet/Haiku)
      try {
        const result = await this._callModel(secondaryModel, augmentedPrompt);
        this._trackUsage(secondaryModel);
        log.info('reflexion', `secondary (${secondaryModel}) succeeded`);
        return result;
      } catch (err) {
        log.warn('reflexion', `secondary (${secondaryModel}) failed`, { error: err.message });
      }
    }

    // Stage 3: Local Fallback (or Primary if forceLocal)
    try {
      // For local extraction tasks, we often want deterministic results
      const localOptions = forceLocal ? { temperature: 0 } : {};
      const result = await this._callModel(this.config.fallbackModel, prompt, localOptions);
      this._trackUsage(this.config.fallbackModel);
      log.info('reflexion', `local fallback (${this.config.fallbackModel}) succeeded`);
      return result;
    } catch (err) {
      log.error('reflexion', 'all LLM stages failed (including local)', { error: err.message });
    }

    return null;
  }

  async _callModel(model, prompt, options = {}) {
    const callConfig = { ...this.config, ...options };
    
    if (model.startsWith('google:') && this.apiClients.google) {
      return await this.apiClients.google.call(model.slice(7), prompt, callConfig);
    }
    if (model.startsWith('gemini') && this.apiClients.google) {
      return await this.apiClients.google.call(model, prompt, callConfig);
    }
    if (model.startsWith('local:') && this.apiClients.local) {
      return await this.apiClients.local.call(model.slice(6), prompt, callConfig);
    }
    if (model.startsWith('groq:') && this.apiClients.groq) {
      return await this.apiClients.groq.call(model.slice(5), prompt, callConfig);
    }
    if (this.apiClients.anthropic) {
      return await this.apiClients.anthropic.call(model, prompt, callConfig);
    }
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

  /**
   * Phase 18: Librarian RAG logic
   * Retrieves context from Obsidian vault before research
   */
  async retrieveKnowledge(userInput) {
    if (!this.board) return null;
    
    log.info('reflexion', `Librarian: retrieving context for "${userInput.slice(0, 30)}..."`);
    
    // 1. Extract keywords for search
    const keywords = userInput.split(' ').slice(0, 3).join(' '); // Simple slice for now
    
    // 2. Query Obsidian via Blackboard
    await this.board.publish('obsidian:cli:task', {
        action: 'search',
        query: keywords,
        author: 'reflexion-engine'
    });

    // 3. Wait for result (Short-timeout wait loop or listener)
    return new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(null), 3000);
        this.board.createSubscriber().then(sub => {
            sub.subscribe('octiv:obsidian:cli:finished', (msg) => {
                try {
                    const data = JSON.parse(msg);
                    clearTimeout(timeout);
                    resolve(data.results);
                } catch { resolve(null); }
            });
        });
    });
  }

  _injectKnowledge(prompt, knowledge) {
    return `[Knowledge Base: External context retrieved from Obsidian Vault]\n${knowledge}\n\n[Task]\n${prompt}`;
  }
}

module.exports = { ReflexionEngine, DEFAULT_CONFIG };
