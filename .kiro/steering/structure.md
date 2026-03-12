# Project Structure

## Root Directory Layout

```
Octiv/
├── agent/              # Core agent implementation
├── test/               # Test suite (node:test)
├── server/             # PaperMC server files (gitignored except jar)
├── config/             # Configuration files
├── scripts/            # Utility scripts
├── logs/               # Runtime logs (gitignored)
├── .claude/            # Claude Code workspace config
├── .kiro/              # Kiro steering and specs
├── vault/              # Obsidian vault (gitignored)
├── .env                # Environment variables (gitignored, contains secrets)
└── package.json        # Project manifest
```

## Agent Directory (`agent/`)

Core agent implementation organized by functionality:

### Core Systems
- `bot.js` - Single bot entry point (deprecated, use team.js)
- `team.js` - Multi-agent team orchestrator (primary entry point)
- `OctivBot.js` - Bot class implementation
- `leader.js` - Team leader/coordinator agent

### Role-Based Agents (`agent/roles/`)
Specialized agent implementations for specific tasks:
- Builder, Explorer, Farmer, Miner, Woodcutter roles

### Communication & Coordination
- `blackboard.js` - Redis-based shared memory system
- `agent-chat.js` - Inter-agent communication
- `agent-negotiation.js` - Agent coordination and task negotiation
- `discord-bot.js` - Discord integration
- `channel-registry.js` - Communication channel management

### AI & Reasoning
- `ReflexionEngine.js` - Self-reflection and error recovery
- `rumination-engine.js` - Deep reasoning system
- `got-reasoner.js` - Goal-oriented thinking
- `skill-pipeline.js` - Skill execution pipeline

### Memory & Learning
- `memory-logger.js` - Memory persistence
- `skill-zettelkasten.js` - Knowledge graph integration
- `zettelkasten-hooks.js` - Obsidian integration hooks
- `vault-sync.js` - Vault synchronization
- `obsidian-bridge.js` - Obsidian API bridge

### Minecraft Integration
- `builder.js` - Building automation
- `builder-navigation.js` - Pathfinding and movement
- `builder-shelter.js` - Shelter construction
- `builder-adaptation.js` - Adaptive building strategies

### Infrastructure
- `redis-factory.js` - Redis client factory (standalone/cluster)
- `api-clients.js` - External API clients
- `lm-studio-client.js` - Local LLM integration
- `logger.js` - Logging system
- `safety.js` - Safety checks and validation

### Execution & Sandboxing
- `vm-sandbox.js` - VM-based code execution
- `isolated-vm-sandbox.js` - Isolated VM sandbox
- `mcp-orchestrator.js` - MCP tool orchestration
- `mcp-server.js` - MCP server implementation

### Monitoring & Metrics
- `dashboard.js` - Web dashboard server
- `idol-metrics.js` - Performance metrics
- `skill-auditor.js` - Skill usage auditing

### Voice & TTS
- `tts-engine.js` - Text-to-speech engine
- `voice-manager.js` - Voice channel management

### Documentation
- `SOUL.md` - Agent identity and mission
- `AGENTS.md` - Agent workspace guide
- `TOOLS.md` - Tool documentation
- `IDENTITY.md` - Agent identity definition
- `USER.md` - User context
- `HEARTBEAT.md` - Heartbeat configuration
- `BOOTSTRAP.md` - First-run initialization

## Test Directory (`test/`)

Integration and unit tests following Node.js test runner conventions:

### Test Categories
- **Integration**: `integration.test.js`, `e2e-smoke.test.js`
- **Agent Tests**: `bot.test.js`, `team.test.js`, `leader.test.js`
- **Role Tests**: `builder-*.test.js`, `explorer-agent.test.js`, `farmer-agent.test.js`, etc.
- **System Tests**: `blackboard.test.js`, `redis-factory.test.js`, `safety.test.js`
- **Communication**: `agent-chat.test.js`, `agent-negotiation.test.js`, `discord.test.js`
- **AI/Reasoning**: `reflexion.test.js`, `rumination.test.js`, `got-reasoner.test.js`
- **Memory**: `memory.test.js`, `zettelkasten.test.js`, `vault-sync.test.js`
- **Infrastructure**: `mcp.test.js`, `orchestrator.test.js`, `pipeline.test.js`
- **Live Tests**: `papermc-live.test.js` (requires running server)

### Test Conventions
- Use `node:test` framework with `describe`/`it` blocks
- Real Redis integration (port 6380) for blackboard tests
- Cleanup test keys with `octiv:test:*` prefix
- Use `before`/`after` hooks for setup/teardown
- Strict assertions via `node:assert/strict`

## Configuration (`config/`)

System configuration files:
- `timeouts.js` - Timeout constants (T.SPAWN_TIMEOUT_MS, etc.)
- Other config modules as needed

## Scripts (`scripts/`)

Utility scripts:
- `preflight.js` - System prerequisite checks
- `launch.sh` - Service launcher
- Other automation scripts

## Claude Code Workspace (`.claude/`)

Claude Code configuration and extensions:

### Structure
- `agents/` - Custom agent definitions
- `commands/` - Custom commands
- `skills/` - Skill definitions with SKILL.md files
- `worktrees/` - Git worktrees (gitignored)
- `settings.json` - Global settings
- `settings.local.json` - Local overrides (gitignored)

## Kiro Workspace (`.kiro/`)

Kiro AI assistant configuration:

### Structure
- `steering/` - Steering documents (this file, product.md, tech.md)
- `specs/` - Feature specifications and design docs
- `settings/` - Kiro settings (mcp.json, etc.)

## Server Directory (`server/`)

PaperMC server files (mostly gitignored):
- `paper-1.21.1.jar` - Server executable (version controlled)
- `server.properties` - Server config (gitignored)
- `eula.txt` - EULA acceptance
- `octiv-world/` - World data (gitignored)
- `plugins/` - Server plugins (gitignored)
- `logs/` - Server logs (gitignored)

## Naming Conventions

### Files
- **Modules**: kebab-case (`agent-chat.js`, `redis-factory.js`)
- **Classes**: PascalCase (`OctivBot.js`, `ReflexionEngine.js`)
- **Tests**: `*.test.js` suffix
- **Documentation**: UPPERCASE.md (`SOUL.md`, `AGENTS.md`)

### Code
- **Variables/Functions**: camelCase
- **Classes**: PascalCase
- **Constants**: UPPER_SNAKE_CASE (in config files)
- **Redis Keys**: Prefixed with `octiv:`, lowercase with colons (`octiv:agent:status`)

## Import Patterns

CommonJS module system:
```javascript
// Relative imports
const { OctivBot } = require('./OctivBot');
const { Blackboard } = require('./blackboard');

// Config imports
const T = require('../config/timeouts');

// Node built-ins
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
```

## Key Architectural Patterns

### Blackboard Pattern
Central Redis-based shared memory for agent coordination:
- All agents publish state to blackboard
- Subscribe to relevant channels for coordination
- TTL-based expiration for :latest keys (300s)

### Role-Based Agents
Specialized agents inherit from base role class:
- Each role has specific capabilities and goals
- Coordinated through leader agent
- Communicate via blackboard and agent-chat

### 眞善美孝永 Validation
Five-pillar validation in critical systems:
- 眞 (Truth): Input validation, type checking
- 善 (Goodness): Size limits, safety checks
- 美 (Beauty): Format validation, naming conventions
- 孝 (Serenity): Required fields, author tracking
- 永 (Eternity): Sustainability, resource management

### Memory Hierarchy
- **Blackboard**: Short-term shared state (Redis, TTL-based)
- **Daily Logs**: `agent/memory/YYYY-MM-DD.md` (session logs)
- **Long-term**: `agent/MEMORY.md` (curated memories)
- **Zettelkasten**: Knowledge graph in Obsidian vault
