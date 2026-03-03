# Octiv MVP — Claude Code Workflow

## Language Rule
- **Conversation with user**: Korean
- **All code, comments, file content, commits**: English

---

## Session Workflow

### START (ALWAYS — before anything else)
1. `/session-memory` — loads MEMORY.md + debugging.md + patterns.md + session-log + git log
2. Report state: current Phase, last commit, next task, any blockers

### DURING SESSION
- `/remember` — anytime you discover something worth keeping
- `/tdd-workflow` — before implementing any new feature
- `/security-review` — before committing agent code with external inputs
- `/manage-skills` — after adding new code patterns
- `/verify-implementation` — before PRs; full audit
- `npm test` before every commit (enforced by PreToolUse hook)

### END (ALWAYS — before closing)
1. `/verify-implementation` — confirm everything passes
2. `github-agent` — commit + push all changes
3. `/save-memory` — persist to MEMORY.md + session-log
4. Tell user: "Memory saved ✅ Next session picks up from [X]"

---

## Quick Tool Directory → use `/tool-index` for full reference

### When unsure → `octiv-orchestrator`

### Agents (13 total)
| Agent | One-liner |
|-------|-----------|
| `octiv-orchestrator` | **START HERE** for complex tasks |
| `pm-agent` | AC status, requirements, priorities |
| `planner` | Implementation step breakdown |
| `architect` | System design decisions |
| `dev-agent` | Write actual code |
| `tdd-guide` | Tests before code |
| `code-reviewer` | Code quality after writing |
| `security-reviewer` | External input / vm2 / RCON |
| `debug-agent` | Failures, crashes, CI red |
| `github-agent` | Commit / push / CI sync |
| `skill-agent` | Skill maintenance |
| `notebooklm-agent` | Knowledge base queries |
| `obsidian-agent` | Vault notes |

### Skills (quick reference)
| Skill | When |
|-------|------|
| `/tool-index` | Find any tool |
| `/session-memory` | **Session start** |
| `/save-memory` | **Session end** |
| `/remember` | Mid-session insight |
| `/verify-implementation` | Before PR — full audit |
| `/verify-redis` | After Blackboard changes |
| `/verify-agents` | After agent/*.js changes |
| `/manage-skills` | After new patterns |
| `/tdd-workflow` | Before new feature |
| `/health-monitor` | Infrastructure issues |
| `/mcporter` | Minecraft bot reference |
| `/dev-tool-belt` | npm/Docker/git commands |

### MCP Servers
| MCP | Purpose |
|-----|---------|
| `notebooklm` | Project knowledge base |
| `github` | PR, CI, code search |
| `context7` | Library docs (mineflayer, Redis) |

---

## Git Rules
- **Format**: `emoji Phase-N: English description`
- **Never commit**: `.env`, `vault/`, `TXT/`, `.obsidian/`, `node_modules/`, `dump.rdb`
- **CI/CD**: GitHub Actions runs `npm test` on every push to `main`

---

## AC Status
| AC | Description | Status |
|----|-------------|--------|
| AC-1 | Collect 16 wood logs | ✅ |
| AC-2 | Build 3×3×3 shelter | ❌ **NEXT** |
| AC-3 | Craft basic tools | ✅ |
| AC-4 | All agents gather in shelter | ❌ |
| AC-5 | Self-improvement on failure | ❌ |
| AC-6 | Group Reflexion → prompt inject | ❌ |
| AC-7 | Memory logging to disk | ❌ |
| AC-8 | Threat detection | ✅ |

---

## Key Infrastructure
- **Redis**: `localhost:6380` (Docker: 6379→6380)
- **PaperMC**: `localhost:25565` (offline-mode)
- **RCON**: `localhost:25575` / pw: `octiv_rcon_2026`
- **CI**: `.github/workflows/ci.yml`
- **Repo**: https://github.com/octivofficial/mvp (main)
