# Octiv MVP — Claude Code Workflow

## Language Rule
- **Conversation with user**: Korean
- **All code, comments, file content, commits**: English

---

## Session Workflow

### START → `/simplify start` (one command)
1. Load MEMORY.md + debugging.md + patterns.md + session-log + git log
2. Report state: Phase, last commit, next task, blockers
3. **VERIFY**: Check session-log.md "Changes That Need Verification" → run affected tests

### DURING SESSION
- `/batch test,lint,status` — quick health check
- `/loop tdd <feature>` — Red-Green-Refactor until tests pass
- `/loop fix <file>` — auto-fix until clean
- `/simplify plan <task>` — Plan Combo shortcut
- `/remember` — anytime you discover something worth keeping
- `/rc` — check remote control status

### Lead Developer Protocol (every feature/fix — MANDATORY)
1. **New code = new tests** (parallel creation, never 0% coverage)
2. **Agent/skill audit**: After architecture changes, verify configs match reality
3. **Parallel everything**: Independent reads, tests, file writes → concurrent
4. **Auto-push**: Test pass + commit → push (no asking)
5. **Stale kill**: Outdated refs in agents/skills → fix immediately inline

### END → `/simplify end` (one command)
1. Syntax check all files + no secrets scan
2. Auto-commit with generated message
3. Save MEMORY.md + session-log
4. Report: "Memory saved. Next session picks up from [X]"

### Auto-Memory (runs without manual intervention)
- **UserPromptSubmit**: Shows git/redis/docker/memory status on every prompt
- **PostToolUse(git commit)**: Logs commit to session-log automatically
- **PreCompact**: Saves full state before context compaction
- **PreToolUse(git commit)**: Syntax checks all agent files

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
- node:vm / RCON / external input → **Watchdog**

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
| `security-reviewer` | External input / node:vm / RCON |
| `debug-agent` | Failures, crashes, CI red |
| `github-agent` | Commit / push / CI sync |
| `skill-agent` | Skill maintenance |
| `notebooklm-agent` | Knowledge base queries |
| `obsidian-agent` | Vault notes |

### Efficiency Commands (NEW — .claude/commands/)
| Command | What it does |
|---------|-------------|
| `/simplify start` | One-command session startup (replaces 5 manual steps) |
| `/simplify end` | One-command session shutdown |
| `/simplify plan <task>` | Plan Combo → plan.md in one shot |
| `/simplify fix <file>` | Quick fix with auto-verify |
| `/simplify ship` | Test → lint → commit → push |
| `/simplify debug <error>` | Systematic debug with auto-verify |
| `/batch test,lint,status` | Run multiple ops in parallel |
| `/loop tdd <feature>` | Red-Green-Refactor cycle until pass |
| `/loop fix <file>` | Auto-fix loop until clean (max 5 iter) |
| `/loop refactor <file>` | Iterative improvement with verify |
| `/loop deploy` | Build → test → deploy cycle |
| `/rc` | Remote control status / Discord bridge (not yet implemented) |
| `/auto-memory status` | Show all memory layer stats |

### Skills (16 total)
| Skill | When |
|-------|------|
| `/tool-index` | Find any tool |
| `/session-memory` | **Session start** (or use `/simplify start`) |
| `/save-memory` | **Session end** (or use `/simplify end`) |
| `/remember` | Mid-session insight |
| `/verify-implementation` | Before PR — full audit |
| `/verify-redis` | After Blackboard changes |
| `/verify-agents` | After agent/*.js changes |
| `/manage-skills` | After new patterns |
| `/tdd-workflow` | Before new feature (or use `/loop tdd`) |
| `/security-review` | After auth, input handling, API changes |
| `/health-monitor` | Infrastructure issues (or use `/batch health`) |
| `/dev-tool-belt` | Tests/Docker/git/GitHub CLI |
| `/mcporter` | MCP server management |
| `/weather` | Minecraft weather/time queries |
| `/first-day-survival` | First night survival strategy |
| `/automated-debugging` | Systematic bug investigation |

### MCP Servers — Scope Strategy

**Global** (`~/.claude/settings.json`) — available in ALL projects:
| MCP | Purpose | Access | When |
|-----|---------|--------|------|
| `context7` | Library docs (mineflayer, Redis, discord.js) | read-only | Any code referencing external libraries |
| `playwright` | Browser testing, E2E automation | read-only | Dashboard testing, web scraping |
| `sequentialthinking` | Extended multi-step reasoning | read-only | Architecture decisions, complex debugging |

**Project** (`.mcp.json`) — Octiv-specific:
| MCP | Purpose | Access | When |
|-----|---------|--------|------|
| `github` | PR, CI, code search, issues | fine-grained PAT | Commits, reviews, CI monitoring |
| `figma` | Design specs, component extraction | read-only token | UI/dashboard implementation |
| `supabase` | Database queries, schema management | `--read-only` flag | Data layer, auth, storage |
| `vercel` | Deploy, preview, environment vars | team-scoped token | Frontend deployment |
| `sentry` | Error tracking, performance monitoring | read scopes only | Production debugging |
| `serena` | LSP semantic code analysis | local workspace | Refactoring, symbol navigation, code planning |
| `filesystem` | Local file operations | project root only | File management |
| `memory` | Persistent knowledge graph | local | Cross-session context |

### MCP Security Policy

**Credentials**:
- ALL tokens via `${ENV_VAR}` references — NEVER hardcode in `.mcp.json`
- Token template: `.env.example` (committed) → `.env` (gitignored, never committed)
- Rotate tokens every 60-90 days
- Prefer secrets managers: `op run --` (1Password), `doppler run --`, `infisical run --`

**Access Levels**:
- `supabase`: ALWAYS `--read-only` in dev. Write access ONLY via migration CLI (`supabase db push`)
- `github`: Fine-grained PAT scoped to `octivofficial/mvp` only. Scopes: `contents:read`, `issues:write`, `pull_requests:write`
- `sentry`: Auth token with `project:read`, `event:read` scopes only. NO `project:write`
- `figma`: Read-only personal access token. View access only
- `vercel`: Team-scoped token. Preview deploys only — production promotion requires manual approval
- `serena`: Local LSP analysis only. No network access. Workspace locked to project root

**Environment Separation**:
- `NODE_ENV=development`: `.env` with dev project refs, `--read-only` supabase
- `NODE_ENV=production`: `.env.production` with prod project refs, restricted token scopes
- NEVER share tokens between environments
- Separate Supabase project refs: `SUPABASE_PROJECT_REF` (dev) vs `SUPABASE_PROD_PROJECT_REF` (prod)

**CLI-First Rule**:
- Database migrations: `supabase db push` (CLI) — NOT via MCP
- Git operations: `git` / `gh` CLI — MCP github for read/search only
- Deployments: `vercel --prod` (CLI) — MCP vercel for preview/status only
- Redis: `redis-cli -p 6380` — NOT via MCP
- Docker: `docker compose` CLI — NOT via MCP

### MCP Combo Workflows

**Plan Combo** — `sequentialthinking` + `serena` → `plan.md`
> Use when: Starting new feature, refactoring, or architecture change
1. `sequentialthinking`: Decompose task into sub-problems, identify dependencies
2. `serena find_symbol`: Map existing codebase symbols (read-only)
3. `serena get_file_outline`: Get structure of files that need changes (read-only)
4. Synthesize into `plan.md` with: affected files, symbol changes, test strategy, risk assessment
5. Human review required before any write operations

**Debug Combo** — `sentry` + `serena` + `sequentialthinking`
> Use when: Production error or complex bug
1. `sentry`: Get error trace, affected users, frequency (read-only)
2. `serena find_symbol`: Locate the failing function and its callers (read-only)
3. `sequentialthinking`: Root cause analysis with full context → fix strategy
4. Fix via dev-agent or CLI — NOT via MCP write tools

**Ship Combo** — `playwright` + `vercel` + `sentry`
> Use when: Deploying changes
1. `playwright`: Run E2E tests on preview (read-only)
2. `vercel`: Deploy to preview ONLY (write, but preview-scoped)
3. Manual approval for production promotion
4. `sentry`: Monitor error rate post-deploy (read-only, 5 min window)

**Design-to-Code Combo** — `figma` + `serena` + `context7`
> Use when: Implementing UI from design specs
1. `figma`: Extract component specs, colors, spacing (read-only)
2. `serena find_symbol`: Find existing similar components (read-only)
3. `context7`: Get library docs for implementation patterns (read-only)
4. Write code via dev-agent with local file tools

**Refactor Combo** — `serena` + `sequentialthinking` + `github`
> Use when: Large-scale code changes
1. `serena get_file_outline`: Map all affected files (read-only)
2. `serena find_symbol`: Find all references to target symbols (read-only)
3. `sequentialthinking`: Plan safe refactoring order (dependency-aware)
4. Apply changes via dev-agent (local file edits)
5. `github`: Create PR with detailed diff summary (write: PR only)

**Tech Debt Combo** — `serena` + `sequentialthinking` + `sentry` + `github`
> Use when: Systematic tech debt reduction
1. `sentry`: Identify recurring errors and performance hotspots (read-only)
2. `serena find_symbol`: Map affected code paths (read-only)
3. `sequentialthinking`: Prioritize fixes by impact and dependency order
4. Apply fixes via dedicated teams (see Team Composition below)
5. `github`: Track progress via issues and PRs

### Parallel MCP Strategy
- **Independent queries** run in parallel (e.g., `context7` docs + `serena` symbols + `sentry` errors)
- **Sequential chains** when output depends on input (e.g., sentry error → serena find → fix)
- **Always** start with `sequentialthinking` for tasks with 3+ steps or unclear scope
- **Read before write**: All combos do read-only analysis first, write operations require explicit approval

### Team Composition for MCP-Powered Workflows

**Feature Team** (new features):
| Role | Agent | MCP Tools |
|------|-------|-----------|
| PM | `pm-agent` | github (issues), sentry (user impact) |
| Planner | `planner` | sequentialthinking, serena (outline) |
| Architect | `architect` | serena (symbols), context7 (docs) |
| Dev | `dev-agent` | serena (navigate), context7 (API docs) |
| TDD | `tdd-guide` | serena (find test targets) |
| Reviewer | `code-reviewer` | github (PR), serena (verify changes) |

**Debug Team** (production issues):
| Role | Agent | MCP Tools |
|------|-------|-----------|
| Triage | `debug-agent` | sentry (errors), serena (locate) |
| Analysis | `debug-agent` | sequentialthinking (root cause) |
| Fix | `dev-agent` | serena (navigate), context7 (docs) |
| Deploy | `github-agent` | github (PR), vercel (preview) |

**Tech Debt Team** (systematic cleanup):
| Role | Agent | MCP Tools |
|------|-------|-----------|
| Scan | `security-reviewer` | sentry (hotspots), serena (complexity) |
| Plan | `planner` | sequentialthinking (prioritize) |
| Execute | `dev-agent` (×3 parallel) | serena (refactor), context7 (docs) |
| Verify | `tdd-guide` + `code-reviewer` | playwright (E2E), github (PR) |

**Design Team** (UI/UX work):
| Role | Agent | MCP Tools |
|------|-------|-----------|
| Spec | `architect` | figma (extract), serena (existing components) |
| Dev | `dev-agent` | context7 (library docs), serena (navigate) |
| Test | `tdd-guide` | playwright (visual tests) |

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
