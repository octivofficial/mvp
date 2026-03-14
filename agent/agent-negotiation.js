/**
 * Octiv Agent Negotiation — LLM-based natural language communication
 * Enables agents to negotiate tasks, share resources, and coordinate actions
 * using natural language via Anthropic/Groq API
 */
const { getLogger } = require('./logger');
const log = getLogger();

// ── Negotiation message types ──────────────────────────────────────
const MESSAGE_TYPES = {
  REQUEST: 'request',       // Request help/resources from another agent
  OFFER: 'offer',          // Offer help/resources to another agent
  ACCEPT: 'accept',        // Accept a request/offer
  DECLINE: 'decline',      // Decline a request/offer
  INFORM: 'inform',        // Share information (no response expected)
  QUERY: 'query',          // Ask for information
  RESPONSE: 'response',    // Respond to a query
};

// ── Negotiation context templates ──────────────────────────────────
const NEGOTIATION_PROMPTS = {
  request_help: `You are {agentId}, a {role} agent in a Minecraft survival team.
You need help with: {task}
Current situation: {context}
Available agents: {agents}

Generate a natural language request message to ask for help. Be concise and specific.
Format: JSON with fields "to" (agent ID), "message" (your request), "priority" (low/medium/high)`,

  evaluate_request: `You are {agentId}, a {role} agent in a Minecraft survival team.
You received this request: "{message}" from {fromAgent}
Your current status: {status}
Your capabilities: {capabilities}

Should you accept this request? Consider:
1. Your current workload and priorities
2. Your ability to help
3. Team benefit vs individual cost

Respond with JSON: {"decision": "accept" or "decline", "reason": "brief explanation", "conditions": "any conditions for acceptance (optional)"}`,

  coordinate_action: `You are {agentId}, a {role} agent coordinating with {targetAgent}.
Task: {task}
Your role in this task: {myRole}
Their role: {theirRole}
Current progress: {progress}

Generate a coordination message to synchronize actions.
Format: JSON with "message" (coordination instruction), "timing" (when to act), "dependencies" (what you need from them)`,
};

class AgentNegotiation {
  constructor(board, agentId, role, apiClients) {
    this.board = board;
    this.agentId = agentId;
    this.role = role;
    this.apiClients = apiClients;
    this._subscriber = null;
    this._pendingRequests = new Map(); // requestId -> { from, message, timestamp }
    this._activeNegotiations = new Map(); // negotiationId -> { participants, status, history }
    this._messageHandlers = new Map();
  }

  async init() {
    this._subscriber = await this.board.createSubscriber();
    
    // Subscribe to direct messages
    await this._subscriber.subscribe(`octiv:agent:${this.agentId}:negotiate`, async (message) => {
      try {
        const data = JSON.parse(message);
        await this._handleIncomingMessage(data);
      } catch (err) {
        log.error(this.agentId, 'negotiation message parse error', { error: err.message });
      }
    });

    // Subscribe to broadcast negotiations
    await this._subscriber.subscribe('octiv:negotiate:broadcast', async (message) => {
      try {
        const data = JSON.parse(message);
        if (data.from !== this.agentId) {
          await this._handleBroadcastMessage(data);
        }
      } catch (err) {
        log.error(this.agentId, 'broadcast message parse error', { error: err.message });
      }
    });

    log.info(this.agentId, 'negotiation system initialized');
  }

  /**
   * Request help from another agent using LLM-generated natural language
   * @param {string} targetAgent - Agent ID to request help from (or 'broadcast' for all)
   * @param {string} task - Task description
   * @param {object} context - Current situation context
   * @param {string} priority - 'low' | 'medium' | 'high'
   */
  async requestHelp(targetAgent, task, context = {}, priority = 'medium') {
    try {
      // Get list of available agents
      const registry = await this.board.client.hGetAll('octiv:agents:registry');
      const agents = Object.keys(registry).filter(id => id !== this.agentId);

      const prompt = NEGOTIATION_PROMPTS.request_help
        .replace('{agentId}', this.agentId)
        .replace('{role}', this.role)
        .replace('{task}', task)
        .replace('{context}', JSON.stringify(context))
        .replace('{agents}', agents.join(', '));

      // Generate request using LLM
      const response = await this._callLLM(prompt, { temperature: 0.7, maxTokens: 200 });
      const request = JSON.parse(response);

      const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const message = {
        id: requestId,
        type: MESSAGE_TYPES.REQUEST,
        from: this.agentId,
        to: targetAgent === 'broadcast' ? 'all' : targetAgent,
        message: request.message,
        task,
        priority: request.priority || priority,
        timestamp: Date.now(),
      };

      // Store pending request
      this._pendingRequests.set(requestId, message);

      // Publish request
      if (targetAgent === 'broadcast') {
        await this.board.publish('negotiate:broadcast', { author: this.agentId, ...message });
      } else {
        await this.board.publish(`agent:${targetAgent}:negotiate`, { author: this.agentId, ...message });
      }

      log.info(this.agentId, `sent help request to ${targetAgent}`, { task, priority });
      return requestId;
    } catch (err) {
      log.error(this.agentId, 'requestHelp failed', { error: err.message, task });
      throw err;
    }
  }

  /**
   * Evaluate incoming request and decide whether to accept
   */
  async _evaluateRequest(request) {
    try {
      // Get current status
      const status = await this.board.get(`agent:${this.agentId}:status`);

      const capabilities = this._getCapabilities();
      
      const prompt = NEGOTIATION_PROMPTS.evaluate_request
        .replace('{agentId}', this.agentId)
        .replace('{role}', this.role)
        .replace('{message}', request.message)
        .replace('{fromAgent}', request.from)
        .replace('{status}', JSON.stringify(status))
        .replace('{capabilities}', capabilities.join(', '));

      // Use LLM to evaluate request
      const response = await this._callLLM(prompt, { temperature: 0.5, maxTokens: 150 });
      const evaluation = JSON.parse(response);

      return evaluation;
    } catch (err) {
      log.error(this.agentId, 'request evaluation failed', { error: err.message });
      // Default to decline on error
      return { decision: 'decline', reason: 'evaluation error' };
    }
  }

  /**
   * Coordinate action with another agent
   */
  async coordinateWith(targetAgent, task, myRole, theirRole, progress = {}) {
    try {
      const prompt = NEGOTIATION_PROMPTS.coordinate_action
        .replace('{agentId}', this.agentId)
        .replace('{role}', this.role)
        .replace('{targetAgent}', targetAgent)
        .replace('{task}', task)
        .replace('{myRole}', myRole)
        .replace('{theirRole}', theirRole)
        .replace('{progress}', JSON.stringify(progress));

      const response = await this._callLLM(prompt, { temperature: 0.6, maxTokens: 200 });
      const coordination = JSON.parse(response);

      const message = {
        id: `coord_${Date.now()}`,
        type: MESSAGE_TYPES.INFORM,
        from: this.agentId,
        to: targetAgent,
        message: coordination.message,
        timing: coordination.timing,
        dependencies: coordination.dependencies,
        timestamp: Date.now(),
      };

      await this.board.publish(`agent:${targetAgent}:negotiate`, { author: this.agentId, ...message });
      log.info(this.agentId, `sent coordination to ${targetAgent}`, { task });
      
      return message.id;
    } catch (err) {
      log.error(this.agentId, 'coordination failed', { error: err.message, task });
      throw err;
    }
  }

  /**
   * Handle incoming negotiation message
   */
  async _handleIncomingMessage(data) {
    log.info(this.agentId, `received ${data.type} from ${data.from}`, { message: data.message });

    switch (data.type) {
      case MESSAGE_TYPES.REQUEST:
        await this._handleRequest(data);
        break;
      case MESSAGE_TYPES.OFFER:
        await this._handleOffer(data);
        break;
      case MESSAGE_TYPES.ACCEPT:
        await this._handleAccept(data);
        break;
      case MESSAGE_TYPES.DECLINE:
        await this._handleDecline(data);
        break;
      case MESSAGE_TYPES.INFORM:
        await this._handleInform(data);
        break;
      case MESSAGE_TYPES.QUERY:
        await this._handleQuery(data);
        break;
      case MESSAGE_TYPES.RESPONSE:
        await this._handleResponse(data);
        break;
      default:
        log.warn(this.agentId, `unknown message type: ${data.type}`);
    }

    // Publish to Blackboard for monitoring
    await this.board.publish(`agent:${this.agentId}:negotiate:log`, {
      author: this.agentId,
      ...data,
      handledAt: Date.now(),
    });
  }

  async _handleRequest(request) {
    const evaluation = await this._evaluateRequest(request);
    
    const response = {
      id: `resp_${Date.now()}`,
      type: evaluation.decision === 'accept' ? MESSAGE_TYPES.ACCEPT : MESSAGE_TYPES.DECLINE,
      from: this.agentId,
      to: request.from,
      inReplyTo: request.id,
      reason: evaluation.reason,
      conditions: evaluation.conditions,
      timestamp: Date.now(),
    };

    await this.board.publish(`agent:${request.from}:negotiate`, { author: this.agentId, ...response });
    log.info(this.agentId, `${evaluation.decision} request from ${request.from}`, { reason: evaluation.reason });
  }

  async _handleOffer(offer) {
    // Simple acceptance logic for now — can be enhanced with LLM evaluation
    const response = {
      id: `resp_${Date.now()}`,
      type: MESSAGE_TYPES.ACCEPT,
      from: this.agentId,
      to: offer.from,
      inReplyTo: offer.id,
      timestamp: Date.now(),
    };

    await this.board.publish(`agent:${offer.from}:negotiate`, { author: this.agentId, ...response });
  }

  async _handleAccept(accept) {
    const pending = this._pendingRequests.get(accept.inReplyTo);
    if (pending) {
      log.info(this.agentId, `request accepted by ${accept.from}`, { conditions: accept.conditions });
      this._pendingRequests.delete(accept.inReplyTo);
      
      // Trigger custom handler if registered
      const handler = this._messageHandlers.get('accept');
      if (handler) await handler(accept);
    }
  }

  async _handleDecline(decline) {
    const pending = this._pendingRequests.get(decline.inReplyTo);
    if (pending) {
      log.info(this.agentId, `request declined by ${decline.from}`, { reason: decline.reason });
      this._pendingRequests.delete(decline.inReplyTo);
      
      // Trigger custom handler if registered
      const handler = this._messageHandlers.get('decline');
      if (handler) await handler(decline);
    }
  }

  async _handleInform(inform) {
    log.info(this.agentId, `received info from ${inform.from}`, { message: inform.message });
    
    // Trigger custom handler if registered
    const handler = this._messageHandlers.get('inform');
    if (handler) await handler(inform);
  }

  async _handleQuery(query) {
    // Respond with current status
    const status = await this.board.get(`agent:${this.agentId}:status`);
    const response = {
      id: `resp_${Date.now()}`,
      type: MESSAGE_TYPES.RESPONSE,
      from: this.agentId,
      to: query.from,
      inReplyTo: query.id,
      data: status,
      timestamp: Date.now(),
    };

    await this.board.publish(`agent:${query.from}:negotiate`, { author: this.agentId, ...response });
  }

  async _handleResponse(response) {
    log.info(this.agentId, `received response from ${response.from}`);
    
    // Trigger custom handler if registered
    const handler = this._messageHandlers.get('response');
    if (handler) await handler(response);
  }

  async _handleBroadcastMessage(data) {
    // Only handle broadcast requests
    if (data.type === MESSAGE_TYPES.REQUEST) {
      await this._handleRequest(data);
    }
  }

  /**
   * Register custom message handler
   */
  onMessage(type, handler) {
    this._messageHandlers.set(type, handler);
  }

  /**
   * Get agent capabilities based on role
   */
  _getCapabilities() {
    const capabilities = {
      builder: ['wood_collection', 'shelter_building', 'tool_crafting', 'block_placement'],
      miner: ['ore_mining', 'stone_collection', 'smelting', 'deep_exploration'],
      farmer: ['crop_farming', 'animal_breeding', 'food_production', 'resource_gathering'],
      explorer: ['world_mapping', 'danger_detection', 'resource_scouting', 'pathfinding'],
      leader: ['task_assignment', 'strategy_planning', 'team_coordination', 'reflexion'],
      safety: ['threat_detection', 'health_monitoring', 'code_validation', 'emergency_response'],
    };

    return capabilities[this.role] || ['general_assistance'];
  }

  /**
   * Call LLM for negotiation text generation
   */
  async _callLLM(prompt, options = {}) {
    if (!this.apiClients) {
      throw new Error('API clients not available');
    }

    const { temperature = 0.7, maxTokens = 200 } = options;

    try {
      // Try Anthropic first
      if (this.apiClients.anthropic) {
        const response = await this.apiClients.anthropic.messages.create({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: maxTokens,
          temperature,
          messages: [{ role: 'user', content: prompt }],
        });
        return response.content[0].text;
      }

      // Fallback to Groq
      if (this.apiClients.groq) {
        const response = await this.apiClients.groq.chat.completions.create({
          model: 'llama-3.3-70b-versatile',
          temperature,
          max_tokens: maxTokens,
          messages: [{ role: 'user', content: prompt }],
        });
        return response.choices[0].message.content;
      }

      throw new Error('No LLM client available');
    } catch (err) {
      log.error(this.agentId, 'LLM call failed', { error: err.message });
      throw err;
    }
  }

  async shutdown() {
    if (this._subscriber) {
      try { await this._subscriber.unsubscribe(); } catch (e) { log.debug('negotiation', 'unsubscribe cleanup error', { error: e.message }); }
      try { await this._subscriber.disconnect(); } catch (e) { log.debug('negotiation', 'disconnect cleanup error', { error: e.message }); }
    }
    this._pendingRequests.clear();
    this._activeNegotiations.clear();
    this._messageHandlers.clear();
  }
}

module.exports = { AgentNegotiation, MESSAGE_TYPES };
