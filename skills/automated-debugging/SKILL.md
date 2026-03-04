---
name: automated-debugging
description: Automated error diagnosis and fixing for Octiv agent code. Use when bots crash, Redis fails, pathfinder errors occur, or ReAct loops get stuck.
---

# Automated Debugging Skill

Diagnoses and fixes errors in the Octiv agent system.

## When to Use
- Bot crashes on spawn or during tasks
- Redis connection errors (ECONNREFUSED)
- Pathfinder navigation failures
- node:vm sandbox validation failures
- ReAct loop infinite loops

## Instructions

1. **Identify error source**:
   - Check console output for `[AgentName] error:`
   - Check Redis: `docker exec octiv-redis redis-cli lrange octiv:reflexion:* 0 -1`
   - Check logs: `docker compose logs minecraft --tail 30`

2. **Common fixes**:
   - `ECONNREFUSED 6380`: Redis not running → `docker compose up -d redis`
   - Pathfinder stuck: Increase `maxDistance`, check `GoalNear` vs `GoalBlock`
   - node:vm timeout: Code too complex, simplify the skill
   - Spawn timeout: Server not ready, increase `spawnTimeoutMs`

3. **Run tests** to verify fix: `npm test`

4. **Log to Reflexion** if pattern should be remembered:
   ```javascript
   await board.logReflexion(agentId, { error, fix, iteration });
   ```
