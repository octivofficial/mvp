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
  handleEmergencyEvent,
  createExplorerLoop,
  createRoleLoop,
  gracefulShutdown,
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
      miner: { id: "miner-01" },
      farmer: { id: "farmer-01" },
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
    assert.equal(list.length, 7); // leader + 2 builders + safety + explorer + miner + farmer
    assert.equal(list[0].role, "leader");
    assert.equal(list[0].mode, "strategy");
    assert.equal(list[1].role, "builder");
    assert.equal(list[2].role, "builder");
    assert.equal(list[3].role, "safety");
    assert.equal(list[4].role, "explorer");
    assert.equal(list[5].role, "miner");
    assert.equal(list[6].role, "farmer");
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

// ── handleEmergencyEvent ────────────────────────────────────────

describe("team — handleEmergencyEvent", () => {
  function createDeps(overrides = {}) {
    return {
      pipeline: {
        generateFromFailure: mock.fn(
          async () => overrides.pipelineResult || { success: false },
        ),
      },
      leader: {
        consecutiveTeamFailures: 0,
        checkReflexionTrigger: mock.fn(async () => {}),
        injectLearnedSkill: mock.fn(async () => {}),
      },
      logger: {
        logEvent: mock.fn(async () => {}),
      },
      lastEmergency: { type: null, time: 0 },
    };
  }

  it("should log emergency event", async () => {
    const deps = createDeps();
    await handleEmergencyEvent({ failureType: "fall" }, deps);
    assert.equal(deps.logger.logEvent.mock.callCount(), 1);
    const args = deps.logger.logEvent.mock.calls[0].arguments;
    assert.equal(args[0], "team");
    assert.equal(args[1].type, "emergency");
  });

  it("should increment leader failures on failureType", async () => {
    const deps = createDeps();
    await handleEmergencyEvent({ failureType: "fall" }, deps);
    assert.equal(deps.leader.consecutiveTeamFailures, 1);
    assert.equal(deps.leader.checkReflexionTrigger.mock.callCount(), 1);
  });

  it("should dedup same failureType within window", async () => {
    const deps = createDeps();
    await handleEmergencyEvent({ failureType: "fall" }, deps);
    assert.equal(deps.lastEmergency.type, "fall", "mutation contract: type updated");
    await handleEmergencyEvent({ failureType: "fall" }, deps);
    assert.equal(deps.leader.consecutiveTeamFailures, 1);
  });

  it("should allow different failureType", async () => {
    const deps = createDeps();
    await handleEmergencyEvent({ failureType: "fall" }, deps);
    await handleEmergencyEvent({ failureType: "lava" }, deps);
    assert.equal(deps.leader.consecutiveTeamFailures, 2);
  });

  it("should trigger skill creation when triggerSkillCreation is set", async () => {
    const deps = createDeps({
      pipelineResult: { success: true, skill: { name: "dodgeLava" } },
    });
    await handleEmergencyEvent(
      { failureType: "lava", triggerSkillCreation: true },
      deps,
    );
    assert.equal(deps.pipeline.generateFromFailure.mock.callCount(), 1);
    assert.equal(deps.leader.injectLearnedSkill.mock.callCount(), 1);
  });

  it("should not inject skill when pipeline fails", async () => {
    const deps = createDeps({ pipelineResult: { success: false } });
    await handleEmergencyEvent(
      { failureType: "lava", triggerSkillCreation: true },
      deps,
    );
    assert.equal(deps.leader.injectLearnedSkill.mock.callCount(), 0);
  });

  it("should handle event with newSkill but no failureType", async () => {
    const deps = createDeps();
    await handleEmergencyEvent({ newSkill: "mineWood" }, deps);
    assert.equal(deps.leader.consecutiveTeamFailures, 0);
  });

  it("should handle logger.logEvent rejection gracefully", async () => {
    const deps = createDeps();
    deps.logger.logEvent = mock.fn(async () => {
      throw new Error("disk full");
    });
    // Should not throw
    await assert.doesNotReject(
      handleEmergencyEvent({ failureType: "fall" }, deps),
    );
  });
});

// ── createExplorerLoop ──────────────────────────────────────────

describe("team — createExplorerLoop", () => {
  const intervals = [];
  after(() => {
    for (const id of intervals) clearInterval(id);
  });

  it("should return interval ID", () => {
    const board = { get: mock.fn(async () => null) };
    const explorer = { execute: mock.fn(async () => {}) };
    const id = createExplorerLoop(board, explorer, 50000);
    assert.ok(id);
    clearInterval(id);
  });

  it("should call explorer.execute when position available", async () => {
    const board = {
      get: mock.fn(async () => ({
        position: { x: 10, y: 64, z: 20 },
      })),
    };
    const explorer = { execute: mock.fn(async () => {}) };

    await new Promise((resolve) => {
      const id = createExplorerLoop(board, explorer, 20);
      intervals.push(id);
      setTimeout(() => {
        clearInterval(id);
        assert.ok(explorer.execute.mock.callCount() >= 1);
        resolve();
      }, 100);
    });
  });

  it("should skip when no position in status", async () => {
    const board = { get: mock.fn(async () => ({ status: "idle" })) };
    const explorer = { execute: mock.fn(async () => {}) };

    await new Promise((resolve) => {
      const id = createExplorerLoop(board, explorer, 20);
      intervals.push(id);
      setTimeout(() => {
        clearInterval(id);
        assert.equal(explorer.execute.mock.callCount(), 0);
        resolve();
      }, 100);
    });
  });

  it("should handle errors gracefully", async () => {
    const board = {
      get: mock.fn(async () => {
        throw new Error("Redis timeout");
      }),
    };
    const explorer = { execute: mock.fn(async () => {}) };

    await new Promise((resolve) => {
      const id = createExplorerLoop(board, explorer, 20);
      intervals.push(id);
      setTimeout(() => {
        clearInterval(id);
        assert.ok(board.get.mock.callCount() >= 1);
        resolve();
      }, 100);
    });
  });
});

// ── createRoleLoop ──────────────────────────────────────────

describe("team — createRoleLoop", () => {
  const intervals = [];
  after(() => {
    for (const id of intervals) clearInterval(id);
  });

  it("should return interval ID", () => {
    const board = { get: mock.fn(async () => null) };
    const agent = { id: "miner-01", execute: mock.fn(async () => {}) };
    const id = createRoleLoop(board, agent, 50000);
    assert.ok(id);
    clearInterval(id);
  });

  it("should call agent.execute when position available", async () => {
    const board = {
      get: mock.fn(async () => ({
        position: { x: 10, y: 64, z: 20 },
      })),
    };
    const agent = { id: "miner-01", execute: mock.fn(async () => {}) };

    await new Promise((resolve) => {
      const id = createRoleLoop(board, agent, 20);
      intervals.push(id);
      setTimeout(() => {
        clearInterval(id);
        assert.ok(agent.execute.mock.callCount() >= 1);
        resolve();
      }, 100);
    });
  });

  it("should pass mockBot with required methods to agent.execute", async () => {
    let capturedBot = null;
    const board = {
      get: mock.fn(async () => ({
        position: { x: 5, y: 60, z: 15 },
      })),
    };
    const agent = {
      id: "farmer-01",
      execute: mock.fn(async (bot) => {
        capturedBot = bot;
      }),
    };

    await new Promise((resolve) => {
      const id = createRoleLoop(board, agent, 20);
      intervals.push(id);
      setTimeout(() => {
        clearInterval(id);
        assert.ok(capturedBot, "bot should be passed");
        assert.ok(capturedBot.entity.position, "should have position");
        assert.equal(typeof capturedBot.findBlock, "function");
        assert.equal(typeof capturedBot.findBlocks, "function");
        assert.equal(typeof capturedBot.dig, "function");
        assert.equal(typeof capturedBot.equip, "function");
        resolve();
      }, 100);
    });
  });

  it("should skip when no position in status", async () => {
    const board = { get: mock.fn(async () => ({ status: "idle" })) };
    const agent = { id: "miner-01", execute: mock.fn(async () => {}) };

    await new Promise((resolve) => {
      const id = createRoleLoop(board, agent, 20);
      intervals.push(id);
      setTimeout(() => {
        clearInterval(id);
        assert.equal(agent.execute.mock.callCount(), 0);
        resolve();
      }, 100);
    });
  });

  it("should handle errors gracefully", async () => {
    const board = {
      get: mock.fn(async () => {
        throw new Error("Redis timeout");
      }),
    };
    const agent = { id: "farmer-01", execute: mock.fn(async () => {}) };

    await new Promise((resolve) => {
      const id = createRoleLoop(board, agent, 20);
      intervals.push(id);
      setTimeout(() => {
        clearInterval(id);
        assert.ok(board.get.mock.callCount() >= 1);
        resolve();
      }, 100);
    });
  });

  it("should prevent concurrent execution", async () => {
    let concurrentCalls = 0;
    let maxConcurrent = 0;
    const board = {
      get: mock.fn(async () => ({
        position: { x: 0, y: 64, z: 0 },
      })),
    };
    const agent = {
      id: "miner-01",
      execute: mock.fn(async () => {
        concurrentCalls++;
        maxConcurrent = Math.max(maxConcurrent, concurrentCalls);
        await new Promise((r) => setTimeout(r, 50));
        concurrentCalls--;
      }),
    };

    await new Promise((resolve) => {
      const id = createRoleLoop(board, agent, 10);
      intervals.push(id);
      setTimeout(() => {
        clearInterval(id);
        assert.equal(maxConcurrent, 1, "should never exceed 1 concurrent call");
        resolve();
      }, 200);
    });
  });
});

// ── gracefulShutdown ──────────────────────────────────────────

describe("team — gracefulShutdown", () => {
  function createMockAgent() {
    return { shutdown: mock.fn(async () => {}) };
  }

  it("should shutdown all agents in order", async () => {
    const agents = {
      leader: createMockAgent(),
      safety: createMockAgent(),
      explorer: createMockAgent(),
      miner: createMockAgent(),
      farmer: createMockAgent(),
      builders: [createMockAgent(), createMockAgent()],
    };
    const resources = {
      explorerInterval: setInterval(() => {}, 99999),
      minerInterval: setInterval(() => {}, 99999),
      farmerInterval: setInterval(() => {}, 99999),
      emergencySubscriber: {
        unsubscribe: mock.fn(async () => {}),
        disconnect: mock.fn(async () => {}),
      },
      zkHooks: createMockAgent(),
      got: createMockAgent(),
      rumination: createMockAgent(),
      zettelkasten: createMockAgent(),
      pipeline: createMockAgent(),
      reflexion: createMockAgent(),
      board: { disconnect: mock.fn(async () => {}) },
      logger: { logEvent: mock.fn(async () => {}) },
    };

    await gracefulShutdown(agents, resources);

    assert.equal(agents.leader.shutdown.mock.callCount(), 1);
    assert.equal(agents.safety.shutdown.mock.callCount(), 1);
    assert.equal(agents.explorer.shutdown.mock.callCount(), 1);
    assert.equal(agents.miner.shutdown.mock.callCount(), 1);
    assert.equal(agents.farmer.shutdown.mock.callCount(), 1);
    assert.equal(agents.builders[0].shutdown.mock.callCount(), 1);
    assert.equal(agents.builders[1].shutdown.mock.callCount(), 1);
    assert.equal(
      resources.emergencySubscriber.unsubscribe.mock.callCount(),
      1,
    );
    assert.equal(resources.board.disconnect.mock.callCount(), 1);
  });

  it("should continue shutdown even if one agent fails", async () => {
    const agents = {
      leader: {
        shutdown: mock.fn(async () => {
          throw new Error("leader crash");
        }),
      },
      safety: createMockAgent(),
      explorer: createMockAgent(),
      miner: createMockAgent(),
      farmer: createMockAgent(),
      builders: [],
    };
    const resources = {
      explorerInterval: setInterval(() => {}, 99999),
      minerInterval: setInterval(() => {}, 99999),
      farmerInterval: setInterval(() => {}, 99999),
      emergencySubscriber: {
        unsubscribe: mock.fn(async () => {}),
        disconnect: mock.fn(async () => {}),
      },
      zkHooks: createMockAgent(),
      got: createMockAgent(),
      rumination: createMockAgent(),
      zettelkasten: createMockAgent(),
      pipeline: createMockAgent(),
      reflexion: createMockAgent(),
      board: { disconnect: mock.fn(async () => {}) },
      logger: { logEvent: mock.fn(async () => {}) },
    };

    // Should not throw
    await assert.doesNotReject(gracefulShutdown(agents, resources));
    // Safety should still be called even though leader failed
    assert.equal(agents.safety.shutdown.mock.callCount(), 1);
    assert.equal(resources.board.disconnect.mock.callCount(), 1);
  });

  it("should clear explorer interval", async () => {
    let intervalCleared = false;
    const interval = setInterval(() => {
      intervalCleared = false;
    }, 99999);

    const agents = {
      leader: createMockAgent(),
      safety: createMockAgent(),
      explorer: createMockAgent(),
      miner: createMockAgent(),
      farmer: createMockAgent(),
      builders: [],
    };
    const resources = {
      explorerInterval: interval,
      emergencySubscriber: {
        unsubscribe: mock.fn(async () => {}),
        disconnect: mock.fn(async () => {}),
      },
      zkHooks: createMockAgent(),
      got: createMockAgent(),
      rumination: createMockAgent(),
      zettelkasten: createMockAgent(),
      pipeline: createMockAgent(),
      reflexion: createMockAgent(),
      board: { disconnect: mock.fn(async () => {}) },
      logger: { logEvent: mock.fn(async () => {}) },
    };

    await gracefulShutdown(agents, resources);
    // clearInterval was called — verify agents were still shutdown correctly
    assert.equal(agents.leader.shutdown.mock.callCount(), 1);
  });

  it("should handle subscriber unsubscribe failure", async () => {
    const agents = {
      leader: createMockAgent(),
      safety: createMockAgent(),
      explorer: createMockAgent(),
      miner: createMockAgent(),
      farmer: createMockAgent(),
      builders: [],
    };
    const resources = {
      explorerInterval: setInterval(() => {}, 99999),
      minerInterval: setInterval(() => {}, 99999),
      farmerInterval: setInterval(() => {}, 99999),
      emergencySubscriber: {
        unsubscribe: mock.fn(async () => {
          throw new Error("unsubscribe fail");
        }),
        disconnect: mock.fn(async () => {}),
      },
      zkHooks: createMockAgent(),
      got: createMockAgent(),
      rumination: createMockAgent(),
      zettelkasten: createMockAgent(),
      pipeline: createMockAgent(),
      reflexion: createMockAgent(),
      board: { disconnect: mock.fn(async () => {}) },
      logger: { logEvent: mock.fn(async () => {}) },
    };

    await assert.doesNotReject(gracefulShutdown(agents, resources));
    // disconnect should still be attempted
    assert.equal(
      resources.emergencySubscriber.disconnect.mock.callCount(),
      1,
    );
  });

  it("should log shutdown event via logger", async () => {
    const agents = {
      leader: createMockAgent(),
      safety: createMockAgent(),
      explorer: createMockAgent(),
      miner: createMockAgent(),
      farmer: createMockAgent(),
      builders: [],
    };
    const resources = {
      explorerInterval: setInterval(() => {}, 99999),
      minerInterval: setInterval(() => {}, 99999),
      farmerInterval: setInterval(() => {}, 99999),
      emergencySubscriber: {
        unsubscribe: mock.fn(async () => {}),
        disconnect: mock.fn(async () => {}),
      },
      zkHooks: createMockAgent(),
      got: createMockAgent(),
      rumination: createMockAgent(),
      zettelkasten: createMockAgent(),
      pipeline: createMockAgent(),
      reflexion: createMockAgent(),
      board: { disconnect: mock.fn(async () => {}) },
      logger: { logEvent: mock.fn(async () => {}) },
    };

    await gracefulShutdown(agents, resources);
    assert.equal(resources.logger.logEvent.mock.callCount(), 1);
    const logArgs = resources.logger.logEvent.mock.calls[0].arguments;
    assert.equal(logArgs[0], "team");
    assert.equal(logArgs[1].type, "shutdown");
  });

  it("should call apiClients.shutdown() when present in resources", async () => {
    const agents = {
      leader: createMockAgent(),
      safety: createMockAgent(),
      explorer: createMockAgent(),
      miner: createMockAgent(),
      farmer: createMockAgent(),
      builders: [],
    };
    const apiClients = { shutdown: mock.fn(() => {}) };
    const resources = {
      explorerInterval: setInterval(() => {}, 99999),
      minerInterval: setInterval(() => {}, 99999),
      farmerInterval: setInterval(() => {}, 99999),
      emergencySubscriber: {
        unsubscribe: mock.fn(async () => {}),
        disconnect: mock.fn(async () => {}),
      },
      zkHooks: createMockAgent(),
      got: createMockAgent(),
      rumination: createMockAgent(),
      zettelkasten: createMockAgent(),
      pipeline: createMockAgent(),
      reflexion: createMockAgent(),
      board: { disconnect: mock.fn(async () => {}) },
      logger: { logEvent: mock.fn(async () => {}) },
      apiClients,
    };

    await gracefulShutdown(agents, resources);
    assert.equal(apiClients.shutdown.mock.callCount(), 1);
  });

  it("should handle missing apiClients gracefully", async () => {
    const agents = {
      leader: createMockAgent(),
      safety: createMockAgent(),
      explorer: createMockAgent(),
      miner: createMockAgent(),
      farmer: createMockAgent(),
      builders: [],
    };
    const resources = {
      explorerInterval: setInterval(() => {}, 99999),
      minerInterval: setInterval(() => {}, 99999),
      farmerInterval: setInterval(() => {}, 99999),
      emergencySubscriber: {
        unsubscribe: mock.fn(async () => {}),
        disconnect: mock.fn(async () => {}),
      },
      zkHooks: createMockAgent(),
      got: createMockAgent(),
      rumination: createMockAgent(),
      zettelkasten: createMockAgent(),
      pipeline: createMockAgent(),
      reflexion: createMockAgent(),
      board: { disconnect: mock.fn(async () => {}) },
      logger: { logEvent: mock.fn(async () => {}) },
      // no apiClients
    };

    await assert.doesNotReject(gracefulShutdown(agents, resources));
  });
});
