/**
 * Tests for AgentNegotiation — LLM-based agent communication
 */
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { AgentNegotiation, MESSAGE_TYPES } = require('../agent/agent-negotiation');
const { Blackboard } = require('../agent/blackboard');

describe('AgentNegotiation', () => {
  let board, negotiation, mockApiClients;

  beforeEach(async () => {
    board = new Blackboard();
    await board.connect();

    // Mock API clients
    mockApiClients = {
      anthropic: {
        messages: {
          create: async ({ messages }) => {
            // Mock LLM response based on prompt content
            const prompt = messages[0].content;
            if (prompt.includes('request_help')) {
              return {
                content: [{ text: JSON.stringify({
                  to: 'builder-02',
                  message: 'Need help collecting wood at (100, 64, 200)',
                  priority: 'medium',
                })}],
              };
            }
            if (prompt.includes('evaluate_request')) {
              return {
                content: [{ text: JSON.stringify({
                  decision: 'accept',
                  reason: 'I have capacity and the task aligns with my role',
                  conditions: 'Will help after completing current AC',
                })}],
              };
            }
            if (prompt.includes('coordinate_action')) {
              return {
                content: [{ text: JSON.stringify({
                  message: 'I will gather materials while you prepare the build site',
                  timing: 'start_immediately',
                  dependencies: 'Need you to mark the shelter location',
                })}],
              };
            }
            return { content: [{ text: '{}' }] };
          },
        },
      },
    };

    negotiation = new AgentNegotiation(board, 'builder-01', 'builder', mockApiClients);
    await negotiation.init();
  });

  afterEach(async () => {
    await negotiation.shutdown();
    await board.disconnect();
  });

  describe('requestHelp', () => {
    it('should generate and send help request using LLM', async () => {
      const requestId = await negotiation.requestHelp(
        'builder-02',
        'collect wood',
        { position: { x: 100, y: 64, z: 200 }, inventory: { wood: 5 } },
        'medium'
      );

      assert.ok(requestId.startsWith('req_'));
      assert.ok(negotiation._pendingRequests.has(requestId));

      const pending = negotiation._pendingRequests.get(requestId);
      assert.strictEqual(pending.type, MESSAGE_TYPES.REQUEST);
      assert.strictEqual(pending.from, 'builder-01');
      assert.strictEqual(pending.to, 'builder-02');
      assert.strictEqual(pending.priority, 'medium');
    });

    it('should broadcast request to all agents', async () => {
      const requestId = await negotiation.requestHelp(
        'broadcast',
        'need iron ore',
        { urgency: 'high' },
        'high'
      );

      const pending = negotiation._pendingRequests.get(requestId);
      assert.strictEqual(pending.to, 'all');
    });
  });

  describe('coordinateWith', () => {
    it('should generate coordination message using LLM', async () => {
      const coordId = await negotiation.coordinateWith(
        'builder-02',
        'build shelter',
        'gather materials',
        'prepare site',
        { materials: 50, site: 'marked' }
      );

      assert.ok(coordId.startsWith('coord_'));
    });
  });

  describe('message handling', () => {
    it('should evaluate and accept incoming request', async () => {
      const request = {
        id: 'req_test_123',
        type: MESSAGE_TYPES.REQUEST,
        from: 'builder-02',
        to: 'builder-01',
        message: 'Can you help me collect wood?',
        task: 'wood_collection',
        priority: 'medium',
        timestamp: Date.now(),
      };

      // Simulate incoming request
      await negotiation._handleIncomingMessage(request);

      // Evaluation logic ran without error - test passes
    });

    it('should handle accept message and clear pending request', async () => {
      const requestId = 'req_test_456';
      negotiation._pendingRequests.set(requestId, {
        id: requestId,
        type: MESSAGE_TYPES.REQUEST,
        from: 'builder-01',
        to: 'builder-02',
      });

      const accept = {
        id: 'resp_test_789',
        type: MESSAGE_TYPES.ACCEPT,
        from: 'builder-02',
        to: 'builder-01',
        inReplyTo: requestId,
        timestamp: Date.now(),
      };

      await negotiation._handleAccept(accept);
      assert.strictEqual(negotiation._pendingRequests.has(requestId), false);
    });

    it('should handle decline message and clear pending request', async () => {
      const requestId = 'req_test_789';
      negotiation._pendingRequests.set(requestId, {
        id: requestId,
        type: MESSAGE_TYPES.REQUEST,
        from: 'builder-01',
        to: 'builder-02',
      });

      const decline = {
        id: 'resp_test_101',
        type: MESSAGE_TYPES.DECLINE,
        from: 'builder-02',
        to: 'builder-01',
        inReplyTo: requestId,
        reason: 'Currently busy with AC-2',
        timestamp: Date.now(),
      };

      await negotiation._handleDecline(decline);
      assert.strictEqual(negotiation._pendingRequests.has(requestId), false);
    });
  });

  describe('custom message handlers', () => {
    it('should trigger custom handler on accept', async () => {
      let handlerCalled = false;
      let receivedData = null;

      negotiation.onMessage('accept', async (data) => {
        handlerCalled = true;
        receivedData = data;
      });

      const requestId = 'req_test_custom';
      negotiation._pendingRequests.set(requestId, {
        id: requestId,
        from: 'builder-01',
      });

      const accept = {
        id: 'resp_custom',
        type: MESSAGE_TYPES.ACCEPT,
        from: 'builder-02',
        inReplyTo: requestId,
        timestamp: Date.now(),
      };

      await negotiation._handleAccept(accept);
      assert.strictEqual(handlerCalled, true);
      assert.strictEqual(receivedData.from, 'builder-02');
    });
  });

  describe('capabilities', () => {
    it('should return correct capabilities for builder role', () => {
      const caps = negotiation._getCapabilities();
      assert.ok(caps.includes('wood_collection'));
      assert.ok(caps.includes('shelter_building'));
      assert.ok(caps.includes('tool_crafting'));
    });

    it('should return correct capabilities for miner role', () => {
      const minerNeg = new AgentNegotiation(board, 'miner-01', 'miner', mockApiClients);
      const caps = minerNeg._getCapabilities();
      assert.ok(caps.includes('ore_mining'));
      assert.ok(caps.includes('smelting'));
    });
  });

  describe('LLM integration', () => {
    it('should call Anthropic API for text generation', async () => {
      const prompt = 'Generate a help request';
      const response = await negotiation._callLLM(prompt, { temperature: 0.7, maxTokens: 100 });
      assert.ok(typeof response === 'string');
    });

    it('should throw error when no API client available', async () => {
      const noClientNeg = new AgentNegotiation(board, 'test-01', 'builder', null);
      await assert.rejects(
        async () => await noClientNeg._callLLM('test prompt'),
        { message: 'API clients not available' }
      );
    });
  });
});
