---
name: verify-agents
description: Verifies OctivBot base class patterns, heartbeat, reconnection logic, and AC task implementation across all agent files. Run after modifying any agent/*.js file.
---

# Agent Code Verification

## Purpose

1. **OctivBot patterns** — all bots extend OctivBot with proper constructor usage
2. **Heartbeat** — bots must have active heartbeat for health monitoring
3. **Reconnection** — exponential backoff reconnect must be implemented
4. **AC task coverage** — verify each implemented AC has the expected function
5. **Safety** — no direct unsafe operations without vm2 sandbox

## When to Run
- After modifying any file in `agent/`
- After adding a new AC task implementation
- When bots are silently disconnecting
- Before a PR that touches agent logic

## Related Files

| File | Purpose |
|------|---------|
| `agent/OctivBot.js` | Base bot class (spawn, health, heartbeat, reconnect) |
| `agent/bot.js` | Single bot entry point |
| `agent/team.js` | Multi-agent orchestrator |
| `agent/leader.js` | Strategy, Training/Creative mode, voting |
| `agent/builder.js` | AC-1 wood, AC-3 tools, ReAct loop |
| `agent/safety.js` | AC-8 threat detection, vm2 sandbox |

## Workflow

### Step 1: Verify OctivBot Base Class Exists

```bash
grep -n "class OctivBot\|module.exports" agent/OctivBot.js
```

**PASS:** `class OctivBot` and `module.exports = { OctivBot }` found.
**FAIL:** Class missing or not exported.

### Step 2: Verify Heartbeat Implementation

```bash
grep -n "heartbeat\|setInterval\|health" agent/OctivBot.js
```

**PASS:** `setInterval` used for heartbeat with interval value.
**FAIL:** No heartbeat — bot health cannot be monitored.
**Fix:** Add `this.heartbeatInterval = setInterval(() => this._sendHeartbeat(), 5000)` in constructor.

### Step 3: Verify Reconnection Logic

```bash
grep -n "reconnect\|backoff\|retry\|setTimeout" agent/OctivBot.js
```

**PASS:** Exponential backoff pattern found (reconnect delay doubles on each attempt).
**FAIL:** No reconnect logic — bots will die on disconnect.
**Fix:** Implement reconnect with `Math.min(delay * 2, maxDelay)` pattern.

### Step 4: Verify AC Task Functions (Implemented ACs)

Check that each implemented AC has its expected function:

```bash
# AC-1: collect wood
grep -n "collectWood\|AC-1\|wood" agent/builder.js

# AC-3: craft tools
grep -n "craftBasicTools\|AC-3\|tools" agent/builder.js

# AC-8: threat detection
grep -n "detectThreat\|AC-8\|threat\|lava\|fall" agent/safety.js
```

**PASS:** Each implemented AC has a named function.
**FAIL:** AC marked as implemented but function not found.

### Step 5: Verify vm2 Sandbox for Dynamic Code

```bash
grep -n "vm2\|VM\|sandbox\|new VM" agent/safety.js
```

**PASS:** vm2 is used for executing dynamically generated skill code.
**FAIL:** Dynamic code executed without sandbox — security risk.

### Step 6: Verify Leader Voting Logic

```bash
grep -n "vote\|majority\|2/3\|consensus" agent/leader.js
```

**PASS:** Voting/majority pattern found.
**FAIL:** No voting logic — single point of failure for decisions.

### Step 7: Verify Blackboard Import Pattern

All agents should use Blackboard for communication, not direct Redis:

```bash
grep -n "require.*blackboard\|Blackboard" agent/team.js agent/leader.js agent/builder.js agent/safety.js
```

**PASS:** All agent files require blackboard.
**FAIL:** Agent files communicate directly without Blackboard.

## Output Format

```markdown
| Check | File | Status | Detail |
|-------|------|--------|--------|
| OctivBot class exported | agent/OctivBot.js | ✅ PASS | |
| Heartbeat present | agent/OctivBot.js | ✅ PASS | setInterval 5000ms |
| Exponential backoff | agent/OctivBot.js | ✅ PASS | |
| AC-1 collectWood | agent/builder.js | ✅ PASS | |
| AC-3 craftBasicTools | agent/builder.js | ✅ PASS | |
| AC-8 detectThreat | agent/safety.js | ✅ PASS | |
| vm2 sandbox | agent/safety.js | ✅ PASS | |
| Leader voting | agent/leader.js | ✅ PASS | |
| Blackboard imports | agent/*.js | ✅ PASS | |
```

## Exceptions

1. **bot.js** — entry point, may not extend OctivBot directly
2. **AC tasks marked ❌ in ROADMAP** — not implemented yet, skip their checks
3. **team.js** — orchestrator, doesn't need to extend OctivBot
4. **Test files** — `test/` may mock agent internals; skip for these checks
