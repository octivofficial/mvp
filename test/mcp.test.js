/**
 * MCP Tool Server Tests — Phase 2.5
 * Usage: node --test test/mcp.test.js
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

describe('MCPServer — JSON-RPC 2.0 (Phase 2.5)', () => {
    let MCPServer;
    let server;
    let redisClient;
    const PORT = 3099; // test port

    before(async () => {
        const { createClient } = require('redis');
        redisClient = createClient({ url: 'redis://localhost:6380' });
        await redisClient.connect();

        MCPServer = require('../agent/mcp-server').MCPServer;
        server = new MCPServer(PORT);
        await server.start();

        // Pre-seed some Blackboard data
        await redisClient.set('octiv:team:status:latest', JSON.stringify({
            ts: Date.now(), status: 'running', mission: 'test',
        }));
        await redisClient.set('octiv:agent:builder-01:inventory:latest', JSON.stringify({
            ts: Date.now(), wood: 16,
        }));
    });

    after(async () => {
        await server.stop();
        const keys = await redisClient.keys('octiv:command:*');
        if (keys.length > 0) await redisClient.del(keys);
        await redisClient.disconnect();
    });

    function rpcCall(method, params = {}) {
        return new Promise((resolve, reject) => {
            const body = JSON.stringify({
                jsonrpc: '2.0', method, params, id: 1,
            });
            const req = http.request({
                hostname: 'localhost', port: PORT, path: '/mcp',
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
            }, (res) => {
                let data = '';
                res.on('data', chunk => { data += chunk; });
                res.on('end', () => resolve(JSON.parse(data)));
            });
            req.on('error', reject);
            req.write(body);
            req.end();
        });
    }

    it('Should return team status via getStatus', async () => {
        const res = await rpcCall('getStatus');
        assert.equal(res.jsonrpc, '2.0');
        assert.ok(res.result.team, 'Should have team status');
        assert.equal(res.result.team.status, 'running');
        assert.equal(res.id, 1);
    });

    it('Should dispatch moveTo command', async () => {
        const res = await rpcCall('moveTo', { agentId: 'builder-01', x: 10, y: 64, z: -20 });
        assert.equal(res.result.command, 'moveTo');
        assert.equal(res.result.status, 'dispatched');
        assert.deepEqual(res.result.target, { x: 10, y: 64, z: -20 });
    });

    it('Should dispatch chopTree command', async () => {
        const res = await rpcCall('chopTree', { agentId: 'builder-01' });
        assert.equal(res.result.command, 'chopTree');
        assert.equal(res.result.status, 'dispatched');
    });

    it('Should return agent inventory', async () => {
        const res = await rpcCall('inventory', { agentId: 'builder-01' });
        assert.ok(res.result.inventory);
        assert.equal(res.result.inventory.wood, 16);
    });

    it('Should return error for unknown method', async () => {
        const res = await rpcCall('unknownMethod');
        assert.ok(res.error);
        assert.equal(res.error.code, -32601);
    });

    it('Should return error for invalid JSON-RPC', async () => {
        const res = await new Promise((resolve, reject) => {
            const body = JSON.stringify({ method: 'getStatus' }); // missing jsonrpc
            const req = http.request({
                hostname: 'localhost', port: PORT, path: '/mcp',
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
            }, (res) => {
                let data = '';
                res.on('data', chunk => { data += chunk; });
                res.on('end', () => resolve(JSON.parse(data)));
            });
            req.on('error', reject);
            req.write(body);
            req.end();
        });
        assert.ok(res.error);
        assert.equal(res.error.code, -32600);
    });

    it('Should return 404 for non-/mcp paths', async () => {
        const res = await new Promise((resolve, reject) => {
            const req = http.request({
                hostname: 'localhost', port: PORT, path: '/other',
                method: 'POST',
            }, (res) => {
                resolve(res.statusCode);
            });
            req.on('error', reject);
            req.end();
        });
        assert.equal(res, 404);
    });

    it('Should return error for missing required params', async () => {
        const res = await rpcCall('moveTo', { agentId: 'builder-01' }); // missing x,y,z
        assert.ok(res.error);
        assert.equal(res.error.code, -32000);
    });
});

describe('MCPServer — Unit Tests (no Redis)', () => {
    const { MCPServer } = require('../agent/mcp-server');

    function createServerWithMockBoard() {
        const server = new MCPServer(39999);
        // Replace the real Blackboard with a mock
        server.board = {
            connect: async () => {},
            disconnect: async () => {},
            get: async () => null,
            publish: async () => {},
            getACProgress: async () => null,
            getConfig: async () => null,
            setConfig: async () => {},
            createSubscriber: async () => ({
                pSubscribe: async () => {},
                pUnsubscribe: async () => {},
                disconnect: async () => {},
            }),
        };
        return server;
    }

    it('getSyncedState returns empty object initially', () => {
        const server = createServerWithMockBoard();
        server.syncedState = {};
        const state = server.getSyncedState();
        assert.deepEqual(state, {});
    });

    it('_validateAgentId throws for empty string', () => {
        const server = createServerWithMockBoard();
        assert.throws(
            () => server._validateAgentId(''),
            /Required: agentId/
        );
    });

    it('_validateAgentId throws for null', () => {
        const server = createServerWithMockBoard();
        assert.throws(
            () => server._validateAgentId(null),
            /Required: agentId/
        );
    });

    it('_validateAgentId throws for special characters', () => {
        const server = createServerWithMockBoard();
        assert.throws(
            () => server._validateAgentId('builder@01!'),
            /Invalid agentId/
        );
    });

    it('_validateAgentId accepts valid id with colons and dashes', () => {
        const server = createServerWithMockBoard();
        assert.doesNotThrow(() => server._validateAgentId('builder-01:status'));
        assert.doesNotThrow(() => server._validateAgentId('agent_01'));
    });

    it('_validateCoordinate throws for NaN', () => {
        const server = createServerWithMockBoard();
        assert.throws(
            () => server._validateCoordinate(NaN, 'x'),
            /must be a finite number/
        );
    });

    it('_validateCoordinate throws for Infinity', () => {
        const server = createServerWithMockBoard();
        assert.throws(
            () => server._validateCoordinate(Infinity, 'y'),
            /must be a finite number/
        );
    });

    it('_validateCoordinate throws for out-of-range values', () => {
        const server = createServerWithMockBoard();
        assert.throws(
            () => server._validateCoordinate(31_000_000, 'z'),
            /out of Minecraft range/
        );
        assert.throws(
            () => server._validateCoordinate(-31_000_000, 'z'),
            /out of Minecraft range/
        );
    });

    it('_validateCoordinate accepts valid in-range coordinate', () => {
        const server = createServerWithMockBoard();
        assert.doesNotThrow(() => server._validateCoordinate(0, 'x'));
        assert.doesNotThrow(() => server._validateCoordinate(29_999_999, 'x'));
        assert.doesNotThrow(() => server._validateCoordinate(-29_999_999, 'x'));
    });

    it('_dispatch returns error for invalid jsonrpc version', async () => {
        const server = createServerWithMockBoard();
        const result = await server._dispatch({ jsonrpc: '1.0', method: 'getStatus', id: 1 });
        assert.ok(result.error);
        assert.equal(result.error.code, -32600);
    });

    it('_dispatch returns error for missing method', async () => {
        const server = createServerWithMockBoard();
        const result = await server._dispatch({ jsonrpc: '2.0', id: 1 });
        assert.ok(result.error);
        assert.equal(result.error.code, -32600);
    });

    it('_errorResponse returns correct JSON-RPC error shape', () => {
        const server = createServerWithMockBoard();
        const resp = server._errorResponse(42, -32601, 'Method not found');
        assert.equal(resp.jsonrpc, '2.0');
        assert.equal(resp.id, 42);
        assert.equal(resp.error.code, -32601);
        assert.equal(resp.error.message, 'Method not found');
    });

    it('_errorResponse uses null id when id is falsy', () => {
        const server = createServerWithMockBoard();
        const resp = server._errorResponse(null, -32700, 'Parse error');
        assert.equal(resp.id, null);
    });

    it('_getStatus with agentId queries board.get and getACProgress', async () => {
        const server = createServerWithMockBoard();
        const statusData = { author: 'builder', health: 20 };
        const acData = { 'AC-1': { status: 'done' } };
        server.board.get = async (key) => key.includes('status') ? statusData : null;
        server.board.getACProgress = async () => acData;

        const result = await server._getStatus({ agentId: 'builder-01' });
        assert.equal(result.agentId, 'builder-01');
        assert.deepEqual(result.status, statusData);
        assert.deepEqual(result.ac, acData);
    });

    it('_getStatus without agentId queries team:status', async () => {
        const server = createServerWithMockBoard();
        const teamData = { status: 'running' };
        server.board.get = async () => teamData;

        const result = await server._getStatus({});
        assert.deepEqual(result.team, teamData);
    });

    it('_startSync wires pSubscribe and updates syncedState on valid message', async () => {
        const server = createServerWithMockBoard();
        server.syncedState = {};

        let capturedHandler;
        server.subscriber = {
            pSubscribe: async (pattern, handler) => {
                capturedHandler = handler;
            },
        };

        server._startSync();

        assert.ok(capturedHandler, 'pSubscribe handler should be registered');

        // Simulate a valid status message
        const msg = JSON.stringify({ health: 20, task: 'idle' });
        capturedHandler(msg, 'octiv:agent:builder-01:status');

        assert.ok(server.syncedState['builder-01'], 'syncedState should be updated');
        assert.equal(server.syncedState['builder-01'].health, 20);
        assert.ok(server.syncedState['builder-01'].syncedAt);
    });

    it('_startSync ignores malformed JSON messages silently', async () => {
        const server = createServerWithMockBoard();
        server.syncedState = {};

        let capturedHandler;
        server.subscriber = {
            pSubscribe: async (pattern, handler) => {
                capturedHandler = handler;
            },
        };

        server._startSync();

        // Should not throw
        assert.doesNotThrow(() => capturedHandler('not-valid-json', 'octiv:agent:bot:status'));
        assert.deepEqual(server.syncedState, {});
    });
});
