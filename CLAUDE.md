# Octiv MVP — Claude Code Workflow

## Language Rule
- **Conversation with user**: Korean
- **All code, comments, file content, commits**: English

---

## Session Workflow

### START (ALWAYS — before anything else)
1. `/session-memory` — loads MEMORY.md + debugging.md + patterns.md + session-log + git log
2. Report state: current Phase, last commit, next task, any blockers
3. **VERIFY**: Check session-log.md "Changes That Need Verification" → run affected tests, mark `[x]`

### DURING SESSION
- `/remember` — anytime you discover something worth keeping
- `/tdd-workflow` — before implementing any new feature
- `/security-review` — before committing agent code with external inputs
- `/manage-skills` — after adding new code patterns
- `/verify-implementation` — before PRs; full audit
- `npm test` before every commit (enforced by PreToolUse hook)
- After code changes: update session-log.md "Changes That Need Verification" with items to check

### END (ALWAYS — before closing)
1. `/verify-implementation` — confirm everything passes
2. `grep -rn 'password\|secret\|key' --include='*.js' --include='*.yml' --include='*.md'` — no secrets in tracked files
3. `github-agent` — commit + push all changes
4. `/save-memory` — persist to MEMORY.md + session-log (include "Changes That Need Verification" for next session)
5. Tell user: "Memory saved. Next session picks up from [X]"

---

## Orchestration Patterns (bkit 5)

Choose the right pattern for the task at hand:

| Pattern | When | Flow |
|---------|------|------|
| **Leader** (default) | AC implementation | pm → planner → tdd → dev → review → commit |
| **Council** | Design decisions | architect + security + dev → synthesize |
| **Swarm** | Large-scale parallel work | parallel dev + tdd, then review |
| **Pipeline** | Sequential dependencies | debug → dev → verify → commit |
| **Watchdog** | Safety-critical changes | dev + debug monitor + security monitor |

### Pattern Selection Guide
- AC task (AC-1~8) → **Leader**
- Bug fix / test failure → **Pipeline**
- Architecture decision → **Council**
- Multiple independent files → **Swarm**
- vm2 / RCON / external input → **Watchdog**

---

## Quick Tool Directory — use `/tool-index` for full reference

### When unsure → `octiv-orchestrator`

### Agents (13 total)
| Agent | One-liner |
|-------|-----------|
| `octiv-orchestrator` | **START HERE** for complex tasks |
| `pm-agent` | AC status, requirements, priorities, strategy |
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

### Skills (11 total)
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
| `/dev-tool-belt` | Tests/Docker/git/GitHub CLI |

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
| AC-1 | Collect 16 wood logs | done |
| AC-2 | Build 3x3x3 shelter | done |
| AC-3 | Craft basic tools | done |
| AC-4 | All agents gather in shelter | done |
| AC-5 | Self-improvement on failure | done |
| AC-6 | Group Reflexion → prompt inject | done |
| AC-7 | Memory logging to disk | done |
| AC-8 | Threat detection | done |

---

## Key Infrastructure
- **Redis**: `localhost:6380` (Docker: 6379→6380)
- **PaperMC**: `localhost:25565` (offline-mode)
- **RCON**: `localhost:25575` / pw in `.env`
- **CI**: `.github/workflows/ci.yml`
- **Repo**: https://github.com/octivofficial/mvp (main)
