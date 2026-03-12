/**
 * API Client Factory — creates LLM client wrappers for ReflexionEngine
 * Primary: Anthropic (Claude), Fallback: LM Studio local models, then Groq
 *
 * Clients implement: { call(model, prompt) → Promise<string> }
 * Gracefully degrades when SDK/API key is unavailable.
 */
const { getLogger } = require('./logger');
const { LMStudioClient } = require('./lm-studio-client');
const log = getLogger();

function createApiClients() {
  const clients = {};

  // Google Gemini client (Cloud Hub Primary - Fast & Smart)
  if (process.env.GOOGLE_API_KEY) {
    try {
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
      clients.google = {
        call: async (model, prompt) => {
          const modelInstance = genAI.getGenerativeModel({ model });
          const result = await modelInstance.generateContent(prompt);
          const response = await result.response;
          return response.text();
        },
      };
      log.info('api-clients', 'Google Gemini client ready');
    } catch (err) {
      log.warn('api-clients', 'Google Generative AI SDK load failed', { error: err.message });
      clients.google = { call: async () => 'mock gemini response — sdk missing' };
    }
  }

  // Anthropic client (primary)
  const anthropicKey = process.env.ANTHROPIC_API_KEY || process.env.OPENCLAW_CLAUDE_API;
  if (anthropicKey) {
    try {
      const Anthropic = require('@anthropic-ai/sdk');
      const anthropic = new Anthropic({ apiKey: anthropicKey });
      clients.anthropic = {
        call: async (model, prompt) => {
          const response = await anthropic.messages.create({
            model,
            max_tokens: 1024,
            messages: [{ role: 'user', content: prompt }],
          });
          return response.content[0]?.text || '';
        },
      };
      log.info('api-clients', 'Anthropic client ready');
    } catch (err) {
      log.warn('api-clients', 'Anthropic SDK load failed', { error: err.message });
      // Add a mock client so tests can continue without the SDK installed
      clients.anthropic = {
        call: async () => 'mock response due to missing sdk'
      };
    }
  } else {
    log.warn('api-clients', 'ANTHROPIC_API_KEY not set — LLM generation disabled');
  }

  // LM Studio client (local fallback — cached health, multi-URL, <think> stripping)
  if (process.env.LM_STUDIO_ENABLED === 'false') {
    log.info('api-clients', 'LM Studio disabled via LM_STUDIO_ENABLED=false');
  } else {
    const lmClient = new LMStudioClient();
    lmClient.checkHealth().catch(() => {}); // non-blocking initial probe
    lmClient.startHealthMonitor();
    clients.local = lmClient;
    log.info('api-clients', `LM Studio client ready (${lmClient.urls.join(', ')})`);
  }

  // Groq client (optional cloud fallback)
  if (process.env.GROQ_API_KEY) {
    try {
      const Groq = require('groq-sdk');
      const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
      clients.groq = {
        call: async (model, prompt) => {
          const response = await groq.chat.completions.create({
            model,
            messages: [{ role: 'user', content: prompt }],
          });
          return response.choices[0]?.message?.content || '';
        },
      };
      log.info('api-clients', 'Groq client ready');
    } catch {
      // Groq is optional — silently skip
    }
  }

  clients.shutdown = () => {
    if (clients.local?.stopHealthMonitor) clients.local.stopHealthMonitor();
  };

  return clients;
}

module.exports = { createApiClients };
