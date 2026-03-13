---
name: verify-tests
description: Verifies the Octiv test suite is healthy — checks pass/fail counts, threshold minimums, and agent-to-test coverage mapping. Run after modifying any agent or test file.
---

# verify-tests

Verify that the Octiv test suite is healthy and all agent files have coverage.

## Steps

1. Run `npm test 2>&1` and parse the output:
   - Extract: total tests, passed, failed, skipped counts
   - Extract: test file count and suite count
   - Flag any test files that had failures

2. Validate thresholds:
   - Total tests >= 1800
   - Failed = 0
   - Test files >= 70

3. Coverage map — verify each agent file has a corresponding test:

| Agent File | Expected Test File |
|---|---|
| agent/OctivBot.js | test/bot.test.js |
| agent/blackboard.js | test/blackboard.test.js |
| agent/team.js | test/team.test.js |
| agent/leader.js | test/orchestrator.test.js |
| agent/builder.js | test/builder-modules.test.js |
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
| agent/zettelkasten-hooks.js | test/zk-hooks.test.js |
| agent/vm-sandbox.js | test/vm-sandbox.test.js |
| agent/isolated-vm-sandbox.js | test/isolated-vm-sandbox.test.js |
| agent/logger.js | test/logger.test.js |
| agent/agent-chat.js | test/agent-chat.test.js |
| agent/agent-negotiation.js | test/agent-negotiation.test.js |
| agent/api-clients.js | test/api-clients.test.js |
| agent/tts-engine.js | test/tts-engine.test.js |
| agent/voice-manager.js | test/tts-engine.test.js |
| agent/vault-sync.js | test/vault-sync.test.js |
| agent/lm-studio-client.js | test/lm-studio-client.test.js |
| agent/redis-factory.js | test/redis-factory.test.js |
| agent/channel-registry.js | test/channel-registry.test.js |
| agent/idol-metrics.js | test/idol-metrics.test.js |
| agent/skill-auditor.js | test/skill-auditor.test.js |
| agent/heartbeat-validator.js | test/heartbeat-validator.test.js |
| agent/inventory-tracker.js | test/inventory-tracker.test.js |
| agent/knowledge-router.js | test/knowledge-router.test.js |
| agent/load-balancer.js | test/load-balancer.test.js |
| agent/pathfinding-queue.js | test/pathfinding-queue.test.js |
| agent/server-manager.js | test/server-manager.test.js |
| agent/gemini-client.js | test/gemini-client.test.js |
| agent/crawler-agent.js | test/crawler-agent.test.js |
| agent/kubejs-plugin.js | test/kubejs-plugin.test.js |
| agent/notebook-lm-agent.js | test/notebook-lm-polling.test.js |
| agent/notebooklm-mcp.js | test/notebooklm-mcp.test.js |
| agent/obsidian-agent.js | test/obsidian-agent.test.js |
| agent/obsidian-bridge.js | test/obsidian-bridge.test.js |
| agent/obsidian-cli-agent.js | test/obsidian-cli-agent.test.js |
| agent/octivia-context.js | test/octivia-context.test.js |
| agent/octivia.js | test/octivia.test.js |
| agent/telegram-bot.js | test/telegram-bot.test.js |
| agent/workspace-agent.js | test/workspace-agent.test.js |
| agent/youtube-agent.js | test/youtube-agent.test.js |
| agent/roles/BaseRole.js | test/base-role.test.js |
| agent/roles/ExplorerAgent.js | test/explorer-agent.test.js |
| agent/roles/WoodcutterAgent.js | test/woodcutter-agent.test.js |
| agent/roles/MinerAgent.js | test/miner-agent.test.js |
| agent/roles/FarmerAgent.js | test/farmer-agent.test.js |

4. Report:
```
Tests: 1899 pass / 0 fail / 13 skip (77 files)
Coverage: 59/59 agent files have tests
Missing: [list any uncovered files]
```
