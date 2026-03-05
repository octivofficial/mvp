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

## Skills (21 Slash Commands)

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
| `/verify-tests` | Test count & coverage audit |
| `/verify-dependencies` | Dependency health check |
| `/verify-mcp` | MCP server status audit |
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
| `/capability-registry` | Agent↔MCP↔Skill mapping |
| `/tool-index` | **This file** — find any tool |

---

## MCP Servers (14 configured)

### Active (7 — always available)
| MCP | Purpose | Primary Agents |
|-----|---------|---------------|
| `context7` | Library docs (mineflayer, Redis, discord.js) | dev-agent, architect, planner |
| `sequentialthinking` | Multi-step reasoning, task decomposition | orchestrator, architect, planner, debug-agent |
| `playwright` | Browser automation, E2E testing | notebooklm-agent |
| `notebooklm` | Project knowledge base queries | notebooklm-agent |
| `github` | PR management, CI status, cross-repo search | pm-agent, code-reviewer, security-reviewer, github-agent |
| `memory` | Persistent knowledge graph | orchestrator, architect, pm-agent, skill-agent, obsidian-agent |
| `filesystem` | Local file operations | dev-agent, skill-agent, obsidian-agent |

### Infrastructure-Dependent (2 — require Docker)
| MCP | Purpose | Primary Agents |
|-----|---------|---------------|
| `redis` | Blackboard data inspection | debug-agent |
| `docker` | Container health, logs | debug-agent |

### Token Ready (3 — configured but unused)
| MCP | Purpose | Activation Condition |
|-----|---------|---------------------|
| `supabase` | Database queries (read-only) | When web frontend/DB provisioned |
| `sentry` | Error tracking, performance | When production deployed |
| `vercel` | Deploy, preview environments | When web frontend built |

### Pending (2)
| MCP | Purpose | Blocker |
|-----|---------|---------|
| `serena` | LSP semantic code analysis | Requires `uvx` runtime |
| `figma` | Design spec extraction | Requires Personal Access Token |

> See `capability-registry` skill for full Agent↔MCP↔Skill mapping.

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
├── Write code → dev-agent (+context7, +serena MCP)
├── Debug error → debug-agent (+redis, +docker MCP)
├── Plan something → planner (+sequentialthinking, +serena MCP)
├── Design architecture → architect (+serena, +context7 MCP)
├── Write tests first → tdd-guide (+serena MCP)
├── Review code → code-reviewer (+github, +serena MCP)
├── Check security → security-reviewer (+github MCP)
├── Commit changes → github-agent (+github MCP)
├── Manage skills → skill-agent (+filesystem, +memory MCP)
├── Find a tool → /tool-index (this file)
├── Find agent↔MCP mapping → /capability-registry
├── Verify code → /verify-implementation
├── Session start → /session-memory
├── Session end → /save-memory
├── Don't know → octiv-orchestrator (+sequentialthinking MCP)
└── Look up docs → context7 MCP or notebooklm-agent (+notebooklm MCP)
```
