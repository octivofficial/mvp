---
name: tool-index
description: Master index of ALL tools available in the Octiv project — agents, skills, MCP servers, CLI tools, npm scripts, Docker commands. Use when unsure which tool to use for a task. Your Swiss Army knife directory.
---

# Octiv Tool Index — Complete Reference

> Like a pharmacist's labeled drawers: everything has a place, everything is labeled, nothing is wasted.

---

## 🤖 Agents (Claude Subagents)

### Orchestration
| Agent | When | Model |
|-------|------|-------|
| `octiv-orchestrator` | Complex multi-step tasks, unsure where to start | opus |

### Planning & Requirements
| Agent | When | Output |
|-------|------|--------|
| `pm-agent` | Start new AC, prioritize work | AC brief |
| `planner` | Implementation plan for any feature | Step-by-step plan |
| `architect` | New module, system design change | Architecture doc |

### Implementation
| Agent | When | Output |
|-------|------|--------|
| `dev-agent` | Write actual code | Working code + tests passing |
| `tdd-guide` | Need tests before code | Failing tests → impl guide |

### Quality & Security
| Agent | When | Output |
|-------|------|--------|
| `code-reviewer` | After writing significant code | Review report |
| `security-reviewer` | External input, vm2, RCON code | Security report |
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

## 🔧 Skills (Slash Commands)

### Memory (Session Continuity)
| Skill | When | Time |
|-------|------|------|
| `/session-memory` | **Session START** — always first | ~10s |
| `/save-memory` | **Session END** — always last | ~15s |
| `/remember` | Mid-session insight to preserve | ~5s |

### Verification (kimoring pattern)
| Skill | When | Checks |
|-------|------|--------|
| `/verify-implementation` | Before PR — full audit | All verify-* skills |
| `/verify-redis` | After Redis/Blackboard changes | Port, prefix, handlers |
| `/verify-agents` | After agent/*.js changes | Patterns, heartbeat, AC |
| `/manage-skills` | After new code patterns | Auto-updates verify skills |

### Development
| Skill | When |
|-------|------|
| `/tdd-workflow` | Before any new feature |
| `/security-review` | Before committing sensitive code |
| `/coding-standards` | When code quality unclear |
| `/backend-patterns` | API, Redis, caching design |

### Project Reference
| Skill | When |
|-------|------|
| `/health-monitor` | Diagnose Redis/PaperMC/agent issues |
| `/mcporter` | Minecraft bot control reference |
| `/automated-debugging` | Crash investigation guide |
| `/strategy-engine` | AC priority and mode decisions |
| `/dev-tool-belt` | Tests, Docker, git commands |
| `/github` | PR, issues, CI status |
| `/tool-index` | **This file** — find any tool |

---

## 🔌 MCP Servers (Always-on Tools)

| MCP | Command | When to Use |
|-----|---------|-------------|
| `notebooklm` | npx notebooklm-mcp@latest | Query project knowledge base |
| `github` | @modelcontextprotocol/server-github | PR management, CI status, code search |
| `context7` | @upstash/context7-mcp | Library docs (mineflayer, Redis, Node.js) |

---

## 🛠 CLI Tools

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
| `docker compose logs minecraft` | Minecraft server logs only |
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

## 🏗 GitHub Actions (CI/CD)

| Trigger | What runs | Location |
|---------|-----------|---------|
| Push to main | `npm test` with Redis 6380 | `.github/workflows/ci.yml` |
| PR to main | Same as above | Same |

---

## 📦 Key Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `mineflayer` | ^4.35.0 | Minecraft bot framework |
| `mineflayer-pathfinder` | ^2.4.5 | Pathfinding for bots |
| `redis` | ^5.11.0 | Redis client (Blackboard) |
| `vm2` | ^3.10.5 | Sandbox for dynamic skill code |

---

## 🗂 Key File Locations

| File | Purpose |
|------|---------|
| `agent/OctivBot.js` | Base bot class |
| `agent/blackboard.js` | Redis pub/sub hub |
| `agent/builder.js` | AC-1, AC-3 implementation |
| `agent/safety.js` | AC-8 threat detection |
| `test/*.test.js` | Test suite |
| `.claude/agents/` | All Claude agents |
| `skills/` | Project skills |
| `~/.claude/skills/` | Global skills |
| `memory/MEMORY.md` | Persistent context |
| `CLAUDE.md` | Session workflow guide |

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
