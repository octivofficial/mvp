/**
 * Team Orchestrator Tests — monitorGathering, shouldProcessEmergency, setupRemoteControl
 * Usage: node --test --test-force-exit test/team.test.js
 */
const { describe, it, after, mock } = require("node:test");
const assert = require("node:assert/strict");

const {
  monitorGathering,
  shouldProcessEmergency,
  setupRemoteControl,
} = require("../agent/team");

describe("team — monitorGathering", () => {
  const intervals = [];
  after(() => {
    for (const id of intervals) clearInterval(id);
  });

  it("should publish team:ac4 when all builders have AC-4 done", async () => {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("test timeout")),
        2000,
      );

      const board = {
        getACProgress: mock.fn(async () => ({
          "AC-4": JSON.stringify({ status: "done" }),
        })),
        publish: mock.fn(async (channel, data) => {
          clearTimeout(timeout);
          assert.equal(channel, "team:ac4");
          assert.equal(data.status, "done");
          assert.ok(data.message.includes("3"));
          resolve();
        }),
      };

      const id = monitorGathering(board, 3, 20);
      intervals.push(id);
    });
  });

  it("should keep polling when not all builders arrived", async () => {
    let pollCount = 0;

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        assert.ok(pollCount >= 3, `Expected 3+ polls, got ${pollCount}`);
        clearInterval(id);
        resolve();
      }, 200);

      const board = {
        getACProgress: mock.fn(async (agentId) => {
          pollCount++;
          if (agentId === "builder-01") {
            return { "AC-4": JSON.stringify({ status: "done" }) };
          }
          return {};
        }),
        publish: mock.fn(async () => {
          clearTimeout(timeout);
          reject(new Error("Should not publish when not all arrived"));
        }),
      };

      const id = monitorGathering(board, 3, 20);
      intervals.push(id);
    });
  });

  it("should ignore polling errors gracefully", async () => {
    let errorCount = 0;

    await new Promise((resolve) => {
      const board = {
        getACProgress: mock.fn(async () => {
          errorCount++;
          if (errorCount <= 2) throw new Error("Redis timeout");
          return { "AC-4": JSON.stringify({ status: "done" }) };
        }),
        publish: mock.fn(async () => {
          assert.ok(errorCount >= 3, "Should have survived errors");
          resolve();
        }),
      };

      const id = monitorGathering(board, 1, 20);
      intervals.push(id);
    });
  });

  it("should handle missing AC-4 key in progress", async () => {
    let pollCount = 0;

    await new Promise((resolve) => {
      setTimeout(() => {
        clearInterval(id);
        assert.ok(pollCount >= 2, "Should keep polling");
        resolve();
      }, 150);

      const board = {
        getACProgress: mock.fn(async () => {
          pollCount++;
          return { "AC-1": JSON.stringify({ status: "done" }) };
        }),
        publish: mock.fn(async () => {}),
      };

      const id = monitorGathering(board, 3, 20);
      intervals.push(id);
    });
  });

  it("should handle teamSize=1 correctly", async () => {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("test timeout")),
        2000,
      );

      const board = {
        getACProgress: mock.fn(async () => ({
          "AC-4": JSON.stringify({ status: "done" }),
        })),
        publish: mock.fn(async (channel, data) => {
          clearTimeout(timeout);
          assert.equal(channel, "team:ac4");
          assert.ok(data.message.includes("1"));
          resolve();
        }),
      };

      const id = monitorGathering(board, 1, 20);
      intervals.push(id);
    });
  });

  it("should return interval ID for cleanup", () => {
    const board = {
      getACProgress: mock.fn(async () => ({})),
      publish: mock.fn(async () => {}),
    };
    const id = monitorGathering(board, 3, 50000);
    assert.ok(id, "Should return interval ID");
    clearInterval(id);
  });
});

describe("team — shouldProcessEmergency", () => {
  it("should process first emergency of any type", () => {
    const state = { type: null, time: 0 };
    assert.equal(shouldProcessEmergency(state, "fall", 3000), true);
    assert.equal(state.type, "fall");
  });

  it("should reject duplicate emergency within dedup window", () => {
    const state = { type: "fall", time: Date.now() };
    assert.equal(shouldProcessEmergency(state, "fall", 3000), false);
  });

  it("should allow same type after dedup window expires", () => {
    const state = { type: "fall", time: Date.now() - 5000 };
    assert.equal(shouldProcessEmergency(state, "fall", 3000), true);
  });

  it("should allow different type within dedup window", () => {
    const state = { type: "fall", time: Date.now() };
    assert.equal(shouldProcessEmergency(state, "lava", 3000), true);
    assert.equal(state.type, "lava");
  });

  it("should update timestamp on successful process", () => {
    const state = { type: null, time: 0 };
    const before = Date.now();
    shouldProcessEmergency(state, "explosion", 3000);
    assert.ok(state.time >= before, "time should be updated");
  });
});

// ── setupRemoteControl — all 5 RC commands ─────────────────────────

describe("team — setupRemoteControl", () => {
  function createMockBoard() {
    const handlers = {};
    return {
      handlers,
      createSubscriber: mock.fn(async () => ({
        subscribe: mock.fn(async (channel, handler) => {
          handlers[channel] = handler;
        }),
        unsubscribe: mock.fn(async () => {}),
        disconnect: mock.fn(async () => {}),
      })),
      get: mock.fn(async () => ({
        status: "running",
        mission: "first-day-survival",
        startedAt: new Date(Date.now() - 60000).toISOString(),
      })),
      getACProgress: mock.fn(async () => ({
        "AC-1": JSON.stringify({ status: "done" }),
        "AC-2": JSON.stringify({ status: "in_progress" }),
      })),
      client: {
        publish: mock.fn(async () => {}),
      },
    };
  }

  function createMockAgents() {
    return {
      leader: { id: "leader-01", mode: "strategy" },
      safety: { id: "safety-01" },
      builders: [{ id: "builder-01" }, { id: "builder-02" }],
      explorer: { id: "explorer-01" },
    };
  }

  it("should subscribe to all 5 RC commands", async () => {
    const board = createMockBoard();
    const agents = createMockAgents();

    const subscriber = await setupRemoteControl(board, agents);

    assert.ok(board.handlers["octiv:rc:cmd:status"], "status handler");
    assert.ok(board.handlers["octiv:rc:cmd:agents"], "agents handler");
    assert.ok(board.handlers["octiv:rc:cmd:ac"], "ac handler");
    assert.ok(board.handlers["octiv:rc:cmd:log"], "log handler");
    assert.ok(board.handlers["octiv:rc:cmd:test"], "test handler");
    assert.ok(subscriber, "should return subscriber");
  });

  it("RC status — returns team status with uptime", async () => {
    const board = createMockBoard();
    const agents = createMockAgents();
    await setupRemoteControl(board, agents);

    const msg = JSON.stringify({ requestId: "req-status-1" });
    await board.handlers["octiv:rc:cmd:status"](msg);

    assert.equal(board.client.publish.mock.callCount(), 1);
    const [channel, payload] = board.client.publish.mock.calls[0].arguments;
    assert.equal(channel, "octiv:req-status-1");
    const parsed = JSON.parse(payload);
    assert.equal(parsed.requestId, "req-status-1");
    assert.equal(parsed.data.status, "running");
    assert.equal(parsed.data.mission, "first-day-survival");
    assert.equal(parsed.data.builders, 2);
    assert.ok(parsed.data.uptime.endsWith("s"), "uptime should end with s");
  });

  it("RC agents — returns full agent roster", async () => {
    const board = createMockBoard();
    const agents = createMockAgents();
    await setupRemoteControl(board, agents);

    const msg = JSON.stringify({ requestId: "req-agents-1" });
    await board.handlers["octiv:rc:cmd:agents"](msg);

    const [, payload] = board.client.publish.mock.calls[0].arguments;
    const parsed = JSON.parse(payload);
    const list = parsed.data;
    assert.equal(list.length, 5); // leader + 2 builders + safety + explorer
    assert.equal(list[0].role, "leader");
    assert.equal(list[0].mode, "strategy");
    assert.equal(list[1].role, "builder");
    assert.equal(list[2].role, "builder");
    assert.equal(list[3].role, "safety");
    assert.equal(list[4].role, "explorer");
  });

  it("RC ac — returns AC progress matrix", async () => {
    const board = createMockBoard();
    const agents = createMockAgents();
    await setupRemoteControl(board, agents);

    const msg = JSON.stringify({ requestId: "req-ac-1" });
    await board.handlers["octiv:rc:cmd:ac"](msg);

    const [, payload] = board.client.publish.mock.calls[0].arguments;
    const parsed = JSON.parse(payload);
    assert.ok(parsed.data["builder-01"], "should have builder-01");
    assert.ok(parsed.data["builder-02"], "should have builder-02");
    assert.equal(parsed.data["builder-01"]["AC-1"], "done");
    assert.equal(parsed.data["builder-01"]["AC-2"], "in_progress");
  });

  it("RC log — returns status string", async () => {
    const board = createMockBoard();
    const agents = createMockAgents();
    await setupRemoteControl(board, agents);

    const msg = JSON.stringify({ requestId: "req-log-1" });
    await board.handlers["octiv:rc:cmd:log"](msg);

    const [, payload] = board.client.publish.mock.calls[0].arguments;
    const parsed = JSON.parse(payload);
    assert.ok(parsed.data.includes("running"), "should include status");
    assert.ok(
      parsed.data.includes("first-day-survival"),
      "should include mission",
    );
  });

  it("RC test — returns confirmation message", async () => {
    const board = createMockBoard();
    const agents = createMockAgents();
    await setupRemoteControl(board, agents);

    const msg = JSON.stringify({ requestId: "req-test-1" });
    await board.handlers["octiv:rc:cmd:test"](msg);

    const [, payload] = board.client.publish.mock.calls[0].arguments;
    const parsed = JSON.parse(payload);
    assert.ok(parsed.data.includes("RC connection OK"));
  });

  it("should ignore messages without requestId", async () => {
    const board = createMockBoard();
    const agents = createMockAgents();
    await setupRemoteControl(board, agents);

    const msg = JSON.stringify({ noRequestId: true });
    await board.handlers["octiv:rc:cmd:test"](msg);

    assert.equal(board.client.publish.mock.callCount(), 0);
  });

  it("should handle JSON parse errors gracefully", async () => {
    const board = createMockBoard();
    const agents = createMockAgents();
    await setupRemoteControl(board, agents);

    // Invalid JSON — should not throw
    await board.handlers["octiv:rc:cmd:status"]("not-json");
    assert.equal(board.client.publish.mock.callCount(), 0);
  });

  it("RC status — handles missing team status", async () => {
    const board = createMockBoard();
    board.get = mock.fn(async () => null);
    const agents = createMockAgents();
    await setupRemoteControl(board, agents);

    const msg = JSON.stringify({ requestId: "req-null-1" });
    await board.handlers["octiv:rc:cmd:status"](msg);

    const [, payload] = board.client.publish.mock.calls[0].arguments;
    const parsed = JSON.parse(payload);
    assert.equal(parsed.data.status, "unknown");
    assert.equal(parsed.data.uptime, "unknown");
  });

  it("RC ac — handles unparseable AC values", async () => {
    const board = createMockBoard();
    board.getACProgress = mock.fn(async () => ({
      "AC-1": "not-json-string",
    }));
    const agents = createMockAgents();
    await setupRemoteControl(board, agents);

    const msg = JSON.stringify({ requestId: "req-ac-bad" });
    await board.handlers["octiv:rc:cmd:ac"](msg);

    const [, payload] = board.client.publish.mock.calls[0].arguments;
    const parsed = JSON.parse(payload);
    // Should fall through to raw value
    assert.equal(parsed.data["builder-01"]["AC-1"], "not-json-string");
  });

  it("RC log — handles null team status", async () => {
    const board = createMockBoard();
    board.get = mock.fn(async () => null);
    const agents = createMockAgents();
    await setupRemoteControl(board, agents);

    const msg = JSON.stringify({ requestId: "req-log-null" });
    await board.handlers["octiv:rc:cmd:log"](msg);

    const [, payload] = board.client.publish.mock.calls[0].arguments;
    const parsed = JSON.parse(payload);
    assert.ok(parsed.data.includes("unknown"));
  });
});
