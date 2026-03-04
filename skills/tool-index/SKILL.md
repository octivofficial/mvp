---
name: tool-index
description: Master index of ALL tools available in the Octiv project — agents, skills, MCP servers, CLI tools, npm scripts, Docker commands. Use when unsure which tool to use for a task.
---

# Octiv Tool Index — Complete Reference

---

## Agents (13 Claude Subagents)

### Orchestration
| Agent | When | Model |
|-------|------|-------|
| `octiv-orchestrator` | Complex multi-step tasks, unsure where to start | opus |

### Planning & Requirements
| Agent | When | Output |
|-------|------|--------|
| `pm-agent` | Start new AC, prioritize work, strategy decisions | AC brief |
| `planner` | Implementation plan for any feature | Step-by-step plan |
| `architect` | New module, system design change | Architecture doc |

### Implementation
| Agent | When | Output |
|-------|------|--------|
| `dev-agent` | Write actual code | Working code + tests passing |
| `tdd-guide` | Need tests before code | Failing tests + impl guide |

### Quality & Security
| Agent | When | Output |
|-------|------|--------|
| `code-reviewer` | After writing significant code | Review report |
| `security-reviewer` | External input, node:vm, RCON code | Security report |
| `debug-agent` | Tests fail, agent crash, CI red | Debug report + fix |

### DevOps & Sync
| Agent | When | Output |
|-------|------|--------|
| `github-agent` | Commit changes, check CI | Sync report |
| `skill-agent` | Create/update verify skills | Skill maintenance report |

### Knowledge
| Agent | When | Output |
|-------|------|--------|
| `notebooklm-agent` | Query docs/knowledge base | Retrieved content |
| `obsidian-agent` | Vault notes, session docs | Updated vault notes |

---

## Skills (11 Slash Commands)

### Memory (Session Continuity)
| Skill | When |
|-------|------|
| `/session-memory` | **Session START** — always first |
| `/save-memory` | **Session END** — always last |
| `/remember` | Mid-session insight to preserve |

### Verification
| Skill | When |
|-------|------|
| `/verify-implementation` | Before PR — full audit |
| `/verify-redis` | After Redis/Blackboard changes |
| `/verify-agents` | After agent/*.js changes |
| `/manage-skills` | After new code patterns |

### Development
| Skill | When |
|-------|------|
| `/tdd-workflow` | Before any new feature |
| `/security-review` | Before committing sensitive code |

### Project Reference
| Skill | When |
|-------|------|
| `/health-monitor` | Diagnose Redis/PaperMC/agent issues |
| `/mcporter` | Minecraft bot control reference |
| `/dev-tool-belt` | Tests, Docker, git, GitHub CLI |
| `/weather` | Minecraft weather commands |
| `/first-day-survival` | AC definitions and mission spec |
| `/automated-debugging` | Crash investigation guide |
| `/tool-index` | **This file** — find any tool |

---

## MCP Servers (Always-on Tools)

| MCP | Command | When to Use |
|-----|---------|-------------|
| `notebooklm` | npx notebooklm-mcp@latest | Query project knowledge base |
| `github` | @modelcontextprotocol/server-github | PR management, CI status, code search |
| `context7` | @upstash/context7-mcp | Library docs (mineflayer, Redis, Node.js) |

---

## CLI Tools

### npm scripts (project)
| Command | What it does |
|---------|-------------|
| `npm test` | Run all tests (requires Redis:6380) |
| `npm run test:bot` | Run bot.test.js only |
| `npm run test:blackboard` | Run blackboard.test.js only |
| `npm run bot` | Start single bot |
| `npm run team` | Start full team (5 agents) |
| `npm run redis:check` | Ping Redis on port 6380 |
| `npm run status` | Show team status from Redis |

### Docker (infrastructure)
| Command | What it does |
|---------|-------------|
| `docker compose up -d` | Start Redis + PaperMC |
| `docker compose down` | Stop everything |
| `docker compose ps` | Check status |
| `docker compose logs -f` | Follow logs |
| `docker compose up -d redis` | Start Redis only |

### Redis CLI
| Command | What it does |
|---------|-------------|
| `redis-cli -p 6380 ping` | Health check |
| `redis-cli -p 6380 keys 'octiv:*'` | List all Octiv keys |
| `redis-cli -p 6380 monitor` | Live command stream |
| `redis-cli -p 6380 hgetall octiv:team:status:latest` | Team status |

### RCON (Minecraft admin)
| Command | What it does |
|---------|-------------|
| `docker exec octiv-mc rcon-cli gamemode creative OctivBot_builder-01` | Creative mode |
| `docker exec octiv-mc rcon-cli time set day` | Force daytime |
| `docker exec octiv-mc rcon-cli tp OctivBot_builder-01 0 100 0` | Teleport bot |

### Git
| Command | What it does |
|---------|-------------|
| `git status --short` | Quick change summary |
| `git log --oneline -5` | Recent commits |
| `git diff --cached --stat` | What's staged |
| `gh run list --limit 5` | CI run list |
| `gh run view <id>` | CI run details |

---

## Key Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `mineflayer` | ^4.35.0 | Minecraft bot framework |
| `mineflayer-pathfinder` | ^2.4.5 | Pathfinding for bots |
| `redis` | ^5.11.0 | Redis client (Blackboard) |
| `node:vm` | built-in | Sandbox for dynamic skill code (`agent/vm-sandbox.js`) |
| `discord.js` | ^14 | Discord bot (Phase 5.4) |

---

## Key File Locations

| File | Purpose |
|------|---------|
| `agent/OctivBot.js` | Base bot class |
| `agent/blackboard.js` | Redis pub/sub hub |
| `agent/builder.js` | AC-1, AC-3 implementation |
| `agent/safety.js` | AC-8 threat detection |
| `agent/discord-bot.js` | Discord integration (Phase 5.4) |
| `test/*.test.js` | Test suite |
| `.claude/agents/` | All Claude agents (13) |
| `skills/` | Project skills (11) |
| `CLAUDE.md` | Session workflow guide |
| `ROADMAP.md` | 7-phase project roadmap |

---

## Quick Decision Tree

```
What do I need?
├── Write code → dev-agent
├── Debug error → debug-agent
├── Plan something → planner / architect
├── Commit changes → github-agent
├── Find a tool → /tool-index (this file)
├── Verify code → /verify-implementation
├── Session start → /session-memory
├── Session end → /save-memory
├── Don't know → octiv-orchestrator
└── Look up Minecraft/mineflayer docs → context7 MCP or notebooklm-agent
```
