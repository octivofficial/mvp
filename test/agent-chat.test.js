/**
 * Tests for agent/agent-chat.js — AgentChat class
 */
const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { AgentChat, CHAT_TEMPLATES, CONFESS_TEMPLATES } = require('../agent/agent-chat');

function mockBoard() {
  const calls = [];
  return {
    publish: mock.fn(async (channel, data) => { calls.push({ channel, data }); }),
    calls,
  };
}

describe('AgentChat', () => {
  let board, chat;

  beforeEach(() => {
    board = mockBoard();
    chat = new AgentChat(board, 'builder-01', 'builder');
  });

  // ── Template coverage ─────────────────────────────────────────

  describe('CHAT_TEMPLATES', () => {
    it('builder has all expected events', () => {
      const events = ['wood_found', 'wood_complete', 'wandering', 'shelter_complete', 'arrived_shelter'];
      for (const e of events) {
        assert.ok(CHAT_TEMPLATES.builder[e]?.length > 0, `missing builder.${e}`);
      }
    });

    it('leader has all expected events', () => {
      const events = ['mission_assigned', 'reflexion_triggered', 'reflexion_complete', 'skill_injected', 'mode_change'];
      for (const e of events) {
        assert.ok(CHAT_TEMPLATES.leader[e]?.length > 0, `missing leader.${e}`);
      }
    });

    it('safety has all expected events', () => {
      const events = ['threat_detected', 'all_clear'];
      for (const e of events) {
        assert.ok(CHAT_TEMPLATES.safety[e]?.length > 0, `missing safety.${e}`);
      }
    });

    it('explorer has all expected events', () => {
      const events = ['discovery', 'danger_spotted'];
      for (const e of events) {
        assert.ok(CHAT_TEMPLATES.explorer[e]?.length > 0, `missing explorer.${e}`);
      }
    });
  });

  describe('CONFESS_TEMPLATES', () => {
    it('builder has expected confess events', () => {
      const events = ['repeated_failure', 'ac_complete'];
      for (const e of events) {
        assert.ok(CONFESS_TEMPLATES.builder[e]?.length > 0, `missing builder.${e}`);
        for (const tpl of CONFESS_TEMPLATES.builder[e]) {
          assert.ok(tpl.title, `${e} missing title`);
          assert.ok(tpl.message, `${e} missing message`);
          assert.ok(tpl.tag, `${e} missing tag`);
          assert.ok(tpl.mood, `${e} missing mood`);
        }
      }
    });

    it('leader has expected confess events', () => {
      assert.ok(CONFESS_TEMPLATES.leader.reflexion_insight?.length > 0);
    });

    it('safety has expected confess events', () => {
      const events = ['near_death', 'consecutive_failures'];
      for (const e of events) {
        assert.ok(CONFESS_TEMPLATES.safety[e]?.length > 0, `missing safety.${e}`);
      }
    });

    it('explorer has expected confess events', () => {
      const events = ['danger_zone', 'milestone'];
      for (const e of events) {
        assert.ok(CONFESS_TEMPLATES.explorer[e]?.length > 0, `missing explorer.${e}`);
      }
    });
  });

  // ── _fillTemplate ─────────────────────────────────────────────

  describe('_fillTemplate', () => {
    it('replaces single variable', () => {
      assert.equal(chat._fillTemplate('Hello {name}', { name: 'Alice' }), 'Hello Alice');
    });

    it('replaces multiple variables', () => {
      assert.equal(
        chat._fillTemplate('{a} and {b}', { a: 'X', b: 'Y' }),
        'X and Y',
      );
    });

    it('leaves unknown variables as-is', () => {
      assert.equal(chat._fillTemplate('Hi {unknown}', {}), 'Hi {unknown}');
    });

    it('converts numbers to strings', () => {
      assert.equal(chat._fillTemplate('{n} items', { n: 42 }), '42 items');
    });

    it('handles empty vars', () => {
      assert.equal(chat._fillTemplate('No vars', {}), 'No vars');
    });

    it('handles template with no placeholders', () => {
      assert.equal(chat._fillTemplate('plain text', { x: 1 }), 'plain text');
    });
  });

  // ── chat() ────────────────────────────────────────────────────

  describe('chat()', () => {
    it('publishes to correct channel', async () => {
      const result = await chat.chat('wood_found', { blockType: 'oak_log', x: 10, z: 20 });
      assert.equal(result, true);
      assert.equal(board.publish.mock.callCount(), 1);

      const call = board.calls[0];
      assert.equal(call.channel, 'agent:builder-01:chat');
      assert.equal(call.data.author, 'builder-01');
      assert.equal(call.data.role, 'builder');
      assert.equal(call.data.event, 'wood_found');
      assert.ok(call.data.message.length > 0);
      assert.ok(call.data.ts > 0);
    });

    it('fills template variables in message', async () => {
      await chat.chat('wandering', { x: 100, z: -50 });
      const msg = board.calls[0].data.message;
      assert.ok(msg.includes('100'), `message should contain x: ${msg}`);
      assert.ok(msg.includes('-50'), `message should contain z: ${msg}`);
    });

    it('throttles same event within cooldown', async () => {
      const r1 = await chat.chat('wood_found', { blockType: 'oak_log', x: 0, z: 0 });
      const r2 = await chat.chat('wood_found', { blockType: 'birch_log', x: 1, z: 1 });
      assert.equal(r1, true);
      assert.equal(r2, false);
      assert.equal(board.publish.mock.callCount(), 1);
    });

    it('allows different events simultaneously', async () => {
      await chat.chat('wood_found', { blockType: 'oak_log', x: 0, z: 0 });
      await chat.chat('wandering', { x: 10, z: 10 });
      assert.equal(board.publish.mock.callCount(), 2);
    });

    it('returns false for unknown event', async () => {
      const result = await chat.chat('nonexistent_event', {});
      assert.equal(result, false);
      assert.equal(board.publish.mock.callCount(), 0);
    });

    it('returns false for unknown role events', async () => {
      const leaderChat = new AgentChat(board, 'leader', 'leader');
      const result = await leaderChat.chat('wood_found', {});
      assert.equal(result, false);
    });

    it('allows event again after cooldown expires', async () => {
      const result1 = await chat.chat('wood_found', { blockType: 'oak_log', x: 0, z: 0 });
      assert.equal(result1, true);

      // Manually expire cooldown
      chat._lastChat['wood_found'] = Date.now() - 60000;
      const result2 = await chat.chat('wood_found', { blockType: 'birch_log', x: 1, z: 1 });
      assert.equal(result2, true);
      assert.equal(board.publish.mock.callCount(), 2);
    });
  });

  // ── confess() ─────────────────────────────────────────────────

  describe('confess()', () => {
    it('publishes to correct channel with confession fields', async () => {
      const result = await chat.confess('repeated_failure', { failures: 7 });
      assert.equal(result, true);
      assert.equal(board.publish.mock.callCount(), 1);

      const call = board.calls[0];
      assert.equal(call.channel, 'agent:builder-01:confess');
      assert.equal(call.data.author, 'builder-01');
      assert.equal(call.data.role, 'builder');
      assert.equal(call.data.event, 'repeated_failure');
      assert.ok(call.data.title.length > 0);
      assert.ok(call.data.message.length > 0);
      assert.ok(call.data.tag);
      assert.ok(call.data.mood);
      assert.ok(call.data.ts > 0);
    });

    it('fills template variables in title and message', async () => {
      await chat.confess('ac_complete', { ac: 1, count: 16 });
      const data = board.calls[0].data;
      assert.ok(data.message.includes('16'), `message should contain count: ${data.message}`);
    });

    it('throttles same confess event within cooldown', async () => {
      const r1 = await chat.confess('repeated_failure', { failures: 5 });
      const r2 = await chat.confess('repeated_failure', { failures: 6 });
      assert.equal(r1, true);
      assert.equal(r2, false);
      assert.equal(board.publish.mock.callCount(), 1);
    });

    it('allows different confess events simultaneously', async () => {
      await chat.confess('repeated_failure', { failures: 5 });
      await chat.confess('ac_complete', { ac: 1, count: 16 });
      assert.equal(board.publish.mock.callCount(), 2);
    });

    it('returns false for unknown confess event', async () => {
      const result = await chat.confess('nonexistent', {});
      assert.equal(result, false);
    });

    it('allows confess again after cooldown expires', async () => {
      await chat.confess('repeated_failure', { failures: 5 });
      chat._lastConfess['repeated_failure'] = Date.now() - 600000;
      const r2 = await chat.confess('repeated_failure', { failures: 7 });
      assert.equal(r2, true);
      assert.equal(board.publish.mock.callCount(), 2);
    });
  });

  // ── Miner templates ──────────────────────────────────────────

  describe('CHAT_TEMPLATES — miner', () => {
    it('miner has all expected chat events', () => {
      const events = ['ore_mined', 'searching', 'navigating', 'smelting', 'inventory_full'];
      for (const e of events) {
        assert.ok(CHAT_TEMPLATES.miner[e]?.length > 0, `missing miner.${e}`);
      }
    });
  });

  describe('CONFESS_TEMPLATES — miner', () => {
    it('miner has all expected confess events', () => {
      const events = ['mining_milestone', 'rare_find', 'empty_shaft'];
      for (const e of events) {
        assert.ok(CONFESS_TEMPLATES.miner[e]?.length > 0, `missing miner.${e}`);
        for (const tpl of CONFESS_TEMPLATES.miner[e]) {
          assert.ok(tpl.title, `${e} missing title`);
          assert.ok(tpl.message, `${e} missing message`);
          assert.ok(tpl.tag, `${e} missing tag`);
          assert.ok(tpl.mood, `${e} missing mood`);
        }
      }
    });
  });

  describe('miner chat integration', () => {
    it('miner chat works with miner templates', async () => {
      const minerChat = new AgentChat(board, 'miner-01', 'miner');
      const result = await minerChat.chat('ore_mined', { type: 'iron', total: 5, x: 10, y: 20, z: 30 });
      assert.equal(result, true);
      assert.equal(board.calls[0].data.role, 'miner');
    });

    it('miner confess works with miner templates', async () => {
      const minerChat = new AgentChat(board, 'miner-01', 'miner');
      const result = await minerChat.confess('rare_find', { type: 'diamond', y: 12 });
      assert.equal(result, true);
      assert.equal(board.calls[0].data.mood, 'ecstatic');
    });

    it('miner inventory_full chat fills template vars', async () => {
      const minerChat = new AgentChat(board, 'miner-01', 'miner');
      await minerChat.chat('inventory_full', { total: 32 });
      const msg = board.calls[0].data.message;
      assert.ok(msg.includes('32'), `should contain total: ${msg}`);
    });
  });

  // ── Cross-role ────────────────────────────────────────────────

  describe('cross-role', () => {
    it('leader chat works with leader templates', async () => {
      const leaderChat = new AgentChat(board, 'leader', 'leader');
      const result = await leaderChat.chat('mission_assigned', { ac: 1, agentId: 'builder-01', action: 'collectWood' });
      assert.equal(result, true);
      assert.equal(board.calls[0].data.role, 'leader');
    });

    it('safety confess works with safety templates', async () => {
      const safetyChat = new AgentChat(board, 'safety', 'safety');
      const result = await safetyChat.confess('near_death', { health: 3, agentId: 'builder-01' });
      assert.equal(result, true);
      assert.equal(board.calls[0].data.mood, 'shaken');
    });

    it('explorer chat works with explorer templates', async () => {
      const explorerChat = new AgentChat(board, 'explorer-01', 'explorer');
      const result = await explorerChat.chat('discovery', { radius: 30, resources: 5, dangers: 1 });
      assert.equal(result, true);
      assert.equal(board.calls[0].data.role, 'explorer');
    });
  });

  // ── Edge cases ────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles board publish failure gracefully', async () => {
      const failBoard = {
        publish: mock.fn(async () => { throw new Error('Redis down'); }),
      };
      const failChat = new AgentChat(failBoard, 'builder-01', 'builder');
      await assert.rejects(
        () => failChat.chat('wood_found', { blockType: 'oak_log', x: 0, z: 0 }),
        /Redis down/,
      );
    });

    it('does not poison throttle on publish failure', async () => {
      let callCount = 0;
      const flakyBoard = {
        publish: mock.fn(async () => {
          callCount++;
          if (callCount === 1) throw new Error('Redis down');
        }),
      };
      const flakyChat = new AgentChat(flakyBoard, 'builder-01', 'builder');
      await assert.rejects(() => flakyChat.chat('wood_found', { blockType: 'oak', x: 0, z: 0 }));
      // Second call should succeed (throttle not poisoned by first failure)
      const result = await flakyChat.chat('wood_found', { blockType: 'oak', x: 0, z: 0 });
      assert.equal(result, true);
    });

    it('chat and confess throttles are independent', async () => {
      // Builder doesn't have matching chat/confess event names, but we test independence
      const r1 = await chat.chat('wood_found', { blockType: 'oak_log', x: 0, z: 0 });
      const r2 = await chat.confess('repeated_failure', { failures: 5 });
      assert.equal(r1, true);
      assert.equal(r2, true);
      assert.equal(board.publish.mock.callCount(), 2);
    });

    it('handles undefined vars gracefully', async () => {
      const result = await chat.chat('wood_found', {});
      assert.equal(result, true);
      // Template placeholders remain as {key} when vars are missing
      const msg = board.calls[0].data.message;
      assert.ok(msg.length > 0);
    });
  });
});
