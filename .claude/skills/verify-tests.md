# verify-tests

Verify that the Octiv test suite is healthy and all agent files have coverage.

## Steps

1. Run `npm test 2>&1` and parse the output:
   - Extract: total tests, passed, failed, skipped counts
   - Extract: test file count and suite count
   - Flag any test files that had failures

2. Validate thresholds:
   - Total tests ≥ 338
   - Failed = 0
   - Test files ≥ 20

3. Coverage map — verify each agent file has a corresponding test:

| Agent File | Expected Test File |
|---|---|
| agent/OctivBot.js | test/bot.test.js |
| agent/blackboard.js | test/blackboard.test.js |
| agent/team.js | test/team.test.js |
| agent/leader.js | test/leader.test.js |
| agent/builder.js | test/builder.test.js |
| agent/builder-navigation.js | test/builder-modules.test.js |
| agent/builder-shelter.js | test/builder-modules.test.js |
| agent/builder-adaptation.js | test/builder-modules.test.js |
| agent/safety.js | test/safety.test.js |
| agent/skill-pipeline.js | test/pipeline.test.js |
| agent/ReflexionEngine.js | test/reflexion.test.js |
| agent/discord-bot.js | test/discord.test.js |
| agent/memory-logger.js | test/memory.test.js |
| agent/mcp-server.js | test/mcp.test.js |
| agent/mcp-orchestrator.js | test/mcp.test.js |
| agent/dashboard.js | test/dashboard.test.js |
| agent/skill-zettelkasten.js | test/zettelkasten.test.js |
| agent/rumination-engine.js | test/rumination.test.js |
| agent/got-reasoner.js | test/got-reasoner.test.js |
| agent/zettelkasten-hooks.js | test/zettelkasten.test.js |
| agent/vm-sandbox.js | test/safety.test.js |
| agent/logger.js | test/logger.test.js |

4. Report:
```
✅ Tests: 338 pass / 0 fail / 3 skip (20 files)
✅ Coverage: 22/22 agent files have tests
⚠️  Missing: [list any uncovered files]
```
