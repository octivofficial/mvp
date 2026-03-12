/**
 * Tests for LoadBalancer — server selection and agent load distribution
 * TDD: tests written before implementation (RED phase)
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { LoadBalancer } = require('../agent/load-balancer');

const makeServers = () => [
  { id: 'srv-1', host: 'localhost', port: 25565, priority: 1, maxAgents: 10 },
  { id: 'srv-2', host: 'mc2.local', port: 25566, priority: 2, maxAgents: 5 },
];

describe('LoadBalancer', () => {
  describe('constructor', () => {
    it('initializes with empty servers map when no config provided', () => {
      const lb = new LoadBalancer({});
      assert.equal(lb.servers.size, 0);
    });

    it('initializes servers with agentCount=0', () => {
      const lb = new LoadBalancer({ servers: makeServers() });
      assert.equal(lb.servers.size, 2);
      assert.equal(lb.servers.get('srv-1').agentCount, 0);
      assert.equal(lb.servers.get('srv-2').agentCount, 0);
    });

    it('preserves server config fields alongside agentCount', () => {
      const lb = new LoadBalancer({ servers: makeServers() });
      const srv = lb.servers.get('srv-1');
      assert.equal(srv.host, 'localhost');
      assert.equal(srv.port, 25565);
      assert.equal(srv.priority, 1);
      assert.equal(srv.maxAgents, 10);
    });

    it('defaults to empty array when servers not provided', () => {
      const lb = new LoadBalancer({ servers: [] });
      assert.equal(lb.servers.size, 0);
    });
  });

  describe('selectServer()', () => {
    let lb;

    beforeEach(() => {
      lb = new LoadBalancer({ servers: makeServers() });
    });

    it('returns a server when all are empty', () => {
      const server = lb.selectServer();
      assert.ok(server !== null, 'should return a server');
      assert.ok(server.id, 'should have an id');
    });

    it('returns server with lowest load ratio', () => {
      // srv-1 has 3/10 = 0.3 load, srv-2 has 0/5 = 0.0 load → pick srv-2
      lb.servers.get('srv-1').agentCount = 3;
      const server = lb.selectServer();
      assert.equal(server.id, 'srv-2');
    });

    it('skips servers at capacity', () => {
      // fill srv-2 to capacity
      lb.servers.get('srv-2').agentCount = 5;
      const server = lb.selectServer();
      assert.equal(server.id, 'srv-1');
    });

    it('returns null when all servers are at capacity', () => {
      lb.servers.get('srv-1').agentCount = 10;
      lb.servers.get('srv-2').agentCount = 5;
      const server = lb.selectServer();
      assert.equal(server, null);
    });

    it('prefers lower priority number on equal load ratio', () => {
      // both at 0% load → prefer priority 1 (srv-1)
      const server = lb.selectServer();
      assert.equal(server.id, 'srv-1');
    });

    it('returns null when no servers configured', () => {
      const emptyLb = new LoadBalancer({ servers: [] });
      assert.equal(emptyLb.selectServer(), null);
    });

    it('selects single available server when only one has capacity', () => {
      // srv-1 full, srv-2 partially filled
      lb.servers.get('srv-1').agentCount = 10;
      lb.servers.get('srv-2').agentCount = 2;
      const server = lb.selectServer();
      assert.equal(server.id, 'srv-2');
    });
  });

  describe('getServerLoad()', () => {
    let lb;

    beforeEach(() => {
      lb = new LoadBalancer({ servers: makeServers() });
    });

    it('returns correct load info for a fresh server', () => {
      const load = lb.getServerLoad('srv-1');
      assert.deepEqual(load, {
        serverId: 'srv-1',
        agentCount: 0,
        maxAgents: 10,
        loadRatio: 0,
      });
    });

    it('returns correct loadRatio after agents added', () => {
      lb.servers.get('srv-2').agentCount = 3;
      const load = lb.getServerLoad('srv-2');
      assert.equal(load.serverId, 'srv-2');
      assert.equal(load.agentCount, 3);
      assert.equal(load.maxAgents, 5);
      assert.equal(load.loadRatio, 0.6);
    });

    it('returns null for unknown server', () => {
      assert.equal(lb.getServerLoad('srv-999'), null);
    });

    it('returns loadRatio=1 when server is at full capacity', () => {
      lb.servers.get('srv-1').agentCount = 10;
      const load = lb.getServerLoad('srv-1');
      assert.equal(load.loadRatio, 1);
    });
  });

  describe('addAgent()', () => {
    let lb;

    beforeEach(() => {
      lb = new LoadBalancer({ servers: makeServers() });
    });

    it('increments agentCount and returns new count', () => {
      const count = lb.addAgent('srv-1');
      assert.equal(count, 1);
      assert.equal(lb.servers.get('srv-1').agentCount, 1);
    });

    it('increments multiple times correctly', () => {
      lb.addAgent('srv-1');
      lb.addAgent('srv-1');
      const count = lb.addAgent('srv-1');
      assert.equal(count, 3);
    });

    it('throws Error for unknown serverId', () => {
      assert.throws(
        () => lb.addAgent('srv-999'),
        (err) => {
          assert.ok(err instanceof Error);
          assert.ok(err.message.includes('srv-999'), `expected message to include server id, got: ${err.message}`);
          return true;
        }
      );
    });

    it('does not affect other servers when adding to one', () => {
      lb.addAgent('srv-1');
      assert.equal(lb.servers.get('srv-2').agentCount, 0);
    });
  });

  describe('removeAgent()', () => {
    let lb;

    beforeEach(() => {
      lb = new LoadBalancer({ servers: makeServers() });
    });

    it('decrements agentCount and returns new count', () => {
      lb.servers.get('srv-1').agentCount = 5;
      const count = lb.removeAgent('srv-1');
      assert.equal(count, 4);
    });

    it('does not go below 0', () => {
      // agentCount is already 0
      const count = lb.removeAgent('srv-1');
      assert.equal(count, 0);
      assert.equal(lb.servers.get('srv-1').agentCount, 0);
    });

    it('throws Error for unknown serverId', () => {
      assert.throws(
        () => lb.removeAgent('srv-999'),
        (err) => {
          assert.ok(err instanceof Error);
          assert.ok(err.message.includes('srv-999'), `expected message to include server id, got: ${err.message}`);
          return true;
        }
      );
    });

    it('does not affect other servers when removing from one', () => {
      lb.servers.get('srv-2').agentCount = 3;
      lb.servers.get('srv-1').agentCount = 2;
      lb.removeAgent('srv-1');
      assert.equal(lb.servers.get('srv-2').agentCount, 3);
    });
  });

  describe('rebalance()', () => {
    let lb;

    beforeEach(() => {
      lb = new LoadBalancer({ servers: makeServers() });
    });

    it('returns empty array when all servers are balanced', () => {
      // both at 0% — no rebalancing needed
      const suggestions = lb.rebalance();
      assert.deepEqual(suggestions, []);
    });

    it('returns empty array when no server exceeds 80% load', () => {
      lb.servers.get('srv-1').agentCount = 7; // 7/10 = 0.7 < 0.8
      lb.servers.get('srv-2').agentCount = 3; // 3/5  = 0.6 < 0.8
      const suggestions = lb.rebalance();
      assert.deepEqual(suggestions, []);
    });

    it('returns empty array when overloaded but no under-50% target exists', () => {
      // srv-1 overloaded, srv-2 also too loaded to accept moves
      lb.servers.get('srv-1').agentCount = 9; // 0.9 > 0.8
      lb.servers.get('srv-2').agentCount = 4; // 4/5 = 0.8, not under 0.5
      const suggestions = lb.rebalance();
      assert.deepEqual(suggestions, []);
    });

    it('suggests moves when a server exceeds 80% load and target under 50% exists', () => {
      lb.servers.get('srv-1').agentCount = 9; // 9/10 = 0.9 → overloaded
      lb.servers.get('srv-2').agentCount = 1; // 1/5  = 0.2 → under 50%
      const suggestions = lb.rebalance();
      assert.ok(Array.isArray(suggestions));
      assert.ok(suggestions.length > 0, 'should have at least one suggestion');
      const s = suggestions[0];
      assert.ok('agentId' in s, 'should have agentId field');
      assert.equal(s.from, 'srv-1');
      assert.equal(s.to, 'srv-2');
    });

    it('suggestion objects have required fields agentId, from, to', () => {
      lb.servers.get('srv-1').agentCount = 9;
      lb.servers.get('srv-2').agentCount = 0;
      const suggestions = lb.rebalance();
      for (const s of suggestions) {
        assert.ok('agentId' in s, 'missing agentId');
        assert.ok('from' in s, 'missing from');
        assert.ok('to' in s, 'missing to');
      }
    });

    it('does not mutate agentCount when generating suggestions', () => {
      lb.servers.get('srv-1').agentCount = 9;
      lb.servers.get('srv-2').agentCount = 0;
      lb.rebalance();
      // rebalance is suggestions only — state must not change
      assert.equal(lb.servers.get('srv-1').agentCount, 9);
      assert.equal(lb.servers.get('srv-2').agentCount, 0);
    });
  });
});
