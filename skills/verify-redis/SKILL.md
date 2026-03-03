---
name: verify-redis
description: Verifies Redis connection patterns, port configuration, and channel naming conventions in the Octiv codebase. Run after any changes to agent files or Redis-related code.
---

# Redis Verification

## Purpose

1. **Port consistency** — all Redis clients must use port 6380
2. **Channel naming** — all pub/sub channels must use `octiv:` prefix
3. **Error handling** — Redis connections must have error listeners
4. **Connection lifecycle** — clients must be properly connected and closed

## When to Run
- After modifying `agent/blackboard.js`
- After adding new Redis client usage in any agent file
- When CI fails with ECONNREFUSED or WRONGTYPE errors
- Before a PR that touches agent files

## Related Files

| File | Purpose |
|------|---------|
| `agent/blackboard.js` | Redis Blackboard — pub/sub hub |
| `agent/bot.js` | Single bot entry point |
| `agent/team.js` | Multi-agent orchestrator |
| `agent/leader.js` | Strategy agent |
| `agent/builder.js` | Building agent |
| `agent/safety.js` | Safety monitor |

## Workflow

### Step 1: Verify Redis Port is 6380

**Check:** All `createClient` calls must specify port 6380 (host maps container:6379 → host:6380).

```bash
grep -n "createClient\|port.*637\|port.*638" agent/blackboard.js
```

**PASS:** All createClient calls show `port: 6380` or equivalent.
**FAIL:** Any `port: 6379` or missing port (defaults to 6379).
**Fix:** Change `port: 6379` → `port: 6380` in the createClient options.

### Step 2: Verify `octiv:` Channel Prefix

**Check:** All Redis pub/sub channel names must start with `octiv:`.

```bash
grep -n "publish\|subscribe\|channel\|CHANNEL" agent/blackboard.js
```

**PASS:** All channel names contain `octiv:` prefix (e.g., `octiv:cmd:leader`, `octiv:team:status`).
**FAIL:** Channel names like `cmd:leader` without prefix.
**Fix:** Prepend `octiv:` to any bare channel names.

### Step 3: Verify Error Handlers

**Check:** All Redis clients must have `.on('error', ...)` handlers.

```bash
grep -n "\.on('error'\|\.on(\"error\"" agent/blackboard.js
```

**PASS:** At least one error handler per Redis client.
**FAIL:** No error handler — unhandled Redis errors will crash the process.
**Fix:** Add `client.on('error', (err) => console.error('[Redis]', err));`

### Step 4: Verify No Direct Redis in Agent Files

**Check:** Only `blackboard.js` should create Redis clients directly.
Agent files should use the Blackboard abstraction.

```bash
grep -rn "createClient" agent/ --include="*.js"
```

**PASS:** Only `agent/blackboard.js` contains `createClient`.
**FAIL:** Other agent files create Redis clients directly.
**Fix:** Refactor to use Blackboard pub/sub methods.

### Step 5: Spot-check with Running Redis (if available)

```bash
redis-cli -p 6380 ping 2>/dev/null && echo "Redis OK" || echo "Redis not running (skip)"
```

If Redis is running, also check:
```bash
redis-cli -p 6380 client list | wc -l
```

**PASS:** Redis responds to PING, or skipped gracefully.

## Output Format

```markdown
| Check | File | Status | Detail |
|-------|------|--------|--------|
| Port is 6380 | agent/blackboard.js | ✅ PASS | port: 6380 confirmed |
| octiv: prefix | agent/blackboard.js | ✅ PASS | all channels use octiv: |
| Error handler | agent/blackboard.js | ✅ PASS | .on('error') found |
| No direct Redis in agents | agent/*.js | ✅ PASS | only blackboard.js uses createClient |
| Redis connectivity | localhost:6380 | ✅ PASS | PONG |
```

## Exceptions

1. **Redis not running** — connectivity check is skipped, not a FAIL
2. **Test files** — `test/` may create Redis clients for testing purposes
3. **Port in comments/strings** — `// port was 6379` is not a violation; only active code matters
4. **docker-compose.yml** — container-side port 6379 is correct there
