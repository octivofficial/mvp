# Octiv MVP — Claude Code Workflow

## Language Rule
- **Conversation with user**: Korean
- **All code, comments, file content, commits**: English

---

## Session Workflow

### START (ALWAYS — before anything else)
1. `/session-memory` — loads MEMORY.md + debugging.md + patterns.md + session-log + git log
2. Report state to user: current Phase, last commit, next task, any blockers

### DURING SESSION
- `/remember` — anytime you discover something worth keeping (bug fix, decision, pattern)
- `/tdd-workflow` — before implementing any new feature
- `/security-review` — before committing agent code with external inputs
- `/manage-skills` — after adding new code patterns; keeps verify skills in sync
- `/verify-implementation` — before PRs; runs all verify-* skills for full audit
- Always `npm test` before committing (enforced by PreToolUse hook)
- Commit often: small, focused commits with `emoji Phase-N: description`

### END (ALWAYS — before closing)
1. `/save-memory` — updates MEMORY.md + debugging.md + patterns.md + session-log
2. `git push origin main`
3. Tell user: "Memory saved ✅ Next session picks up from [X]"

---

## Available Skills

### Memory Management
| Skill | When |
|-------|------|
| `/session-memory` | **Session start** — load all context |
| `/save-memory` | **Session end** — persist all learnings |
| `/remember` | **Mid-session** — quick save of one insight |

### Verification (kimoring pattern)
| Skill | When |
|-------|------|
| `/verify-implementation` | Before PR — runs all verify-* skills |
| `/verify-redis` | After changing any Redis/Blackboard code |
| `/verify-agents` | After changing any agent/*.js file |
| `/manage-skills` | After adding new patterns — updates verify skills |

### Development
| Skill | When |
|-------|------|
| `/tdd-workflow` | Before implementing any new feature |
| `/security-review` | Before committing security-sensitive code |
| `/coding-standards` | When code quality is unclear |
| `/backend-patterns` | API, Redis, caching design questions |
| `/notebooklm` | Query project knowledge base |

### Project-Specific
| Skill | When |
|-------|------|
| `/health-monitor` | Diagnose Redis/PaperMC/agent issues |
| `/mcporter` | Minecraft bot control reference |
| `/automated-debugging` | Agent crash investigation |
| `/strategy-engine` | AC priority and mode decisions |
| `/dev-tool-belt` | Tests, Docker, git quick reference |
| `/github` | PR, issues, CI status |

---

## Available Agents (Subagents)
| Agent | Trigger |
|-------|---------|
| `debug-agent` | **Tests fail / agent crash / CI red** — systematic debugging |
| `github-agent` | **After any work** — commit, push, verify CI sync |
| `notebooklm-agent` | **Knowledge lookup** — query NotebookLM knowledge base |
| `skill-agent` | **Skill maintenance** — create/update/optimize verify skills |
| `planner` | Before starting any new Phase or complex feature |
| `architect` | Major structural decisions (new modules, system design) |
| `code-reviewer` | After writing significant new code |
| `security-reviewer` | Code that handles external input, vm2, RCON |
| `tdd-guide` | Implementing AC tasks with test coverage |

---

## Git & Commit Rules
- **Format**: `emoji Phase-N: short English description`
- **Examples**:
  - `🎮 P2: add shelter construction (AC-2)`
  - `✅ P1: fix Redis ECONNREFUSED on wrong port`
  - `🔧 P3: integrate Leader-Builder vote system`
  - `🐛 fix: pathfinder stuck on unreachable block`
  - `📋 docs: update ROADMAP.md phase 2 status`
- **Never commit**: `.env`, `vault/`, `TXT/`, `.obsidian/`, `node_modules/`, `dump.rdb`
- **Tests**: `npm test` runs automatically via PreToolUse hook on `git commit`
- **CI**: GitHub Actions runs `npm test` on every push to `main`

---

## Architecture Quick Reference
| File | Role |
|------|------|
| `agent/OctivBot.js` | Base bot (spawn, health, heartbeat, exponential backoff) |
| `agent/blackboard.js` | Redis pub/sub (`octiv:` prefix, port **6380**) |
| `agent/team.js` | Orchestrator: Leader + 3×Builder + Safety |
| `agent/leader.js` | Strategy, Training/Creative mode, 2/3 majority voting |
| `agent/builder.js` | AC-1 wood, AC-3 tools, main ReAct loop |
| `agent/safety.js` | AC-8: lava/fall/loop detection, vm2 sandbox |
| `test/` | Node.js native test runner — requires Redis on 6380 |

---

## AC Status
| AC | Description | Status |
|----|-------------|--------|
| AC-1 | Collect 16 wood logs | ✅ `collectWood()` |
| AC-2 | Build 3×3×3 shelter | ❌ TODO |
| AC-3 | Craft basic tools | ✅ `craftBasicTools()` |
| AC-4 | All agents gather in shelter | ❌ TODO |
| AC-5 | Self-improvement on failure | ❌ stub |
| AC-6 | Group Reflexion → prompt inject | ❌ TODO |
| AC-7 | Memory logging to disk | ❌ TODO |
| AC-8 | Threat detection | ✅ `detectThreat()` |

**Next priority**: AC-2 (shelter construction in `builder.js`)

---

## Memory Files
| File | Purpose | Location |
|------|---------|---------|
| `MEMORY.md` | Main context (auto-loaded, max 200 lines) | `memory/` |
| `session-log.md` | Per-session history (last 10) | `memory/` |
| `debugging.md` | Known bugs and fixes | `memory/` |
| `patterns.md` | Code patterns and conventions | `memory/` |

---

## Key Infrastructure
- **Redis**: `localhost:6380` (Docker: container 6379 → host 6380)
- **PaperMC**: `localhost:25565` (offline-mode, no auth)
- **RCON**: `localhost:25575` / pw: `octiv_rcon_2026`
- **CI/CD**: GitHub Actions (`.github/workflows/ci.yml`) — runs `npm test` on every push
- **MCP servers**: `notebooklm`, `github` (GITHUB_TOKEN from Keychain), `context7`
- **Repo**: https://github.com/octivofficial/mvp (branch: `main`)
