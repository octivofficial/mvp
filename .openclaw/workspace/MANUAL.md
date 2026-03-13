# Octivia Manual

**Octivia** — vibe coding translator running on OpenClaw gateway.
Talk in natural language. She listens, thinks, responds in 1-2 sentences.

---

## Quick Start

```bash
# Start Octivia
node --env-file=.env agent/octivia.js

# Or run gateway directly
openclaw gateway
```

Then open Telegram → find `@Octivia_bot` → start talking.

---

## Custom Commands

| Command | What it does |
|---------|-------------|
| `/build` | Compile accumulated vibes → BMAD build brief |
| `/notebook <q>` | Query NotebookLM knowledge base |
| `/check <idea>` | Cross-reference idea vs codebase |
| `/project` | Show project status |

## Native OpenClaw Commands

| Command | What it does |
|---------|-------------|
| `/status` | Gateway + model info |
| `/context` | Show current context window |
| `/reset` | Reset conversation session |
| `/model <id>` | Switch LLM model |
| `/think:high` | Extended thinking mode |
| `/think:low` | Fast/cheap mode |
| `/skill <name>` | Run a skill directly |
| `/export-session` | Export chat to HTML |
| `/help` | Full command list |

---

## Loaded Skills

### Workspace (Octivia-specific)
| Skill | Trigger |
|-------|---------|
| `octivia-build` | `/build` |
| `octivia-notebook` | `/notebook` |
| `octivia-blackboard` | Auto (Redis events) |

### Bundled (OpenClaw)
| Skill | What it does |
|-------|-------------|
| `coding-agent` | Spawn Claude Code / Codex autonomously |
| `github` | GitHub ops via `gh` CLI |
| `obsidian` | Obsidian vault read/write |
| `clawhub` | Install more skills |
| `gog` | Google Workspace (Gmail, Drive, Calendar) |
| `canvas` | Visual workspace (browser canvas) |
| `session-logs` | Search past conversations |
| `skill-creator` | Create new skills |

Install new skill from registry:
```bash
clawhub login                       # one-time GitHub OAuth
clawhub search "what you need"      # semantic search
clawhub install <slug>              # auto-installs to workspace
```
Total: 52 bundled + unlimited registry skills.

---

## VM Autonomous Build

Octivia can build code herself via `coding-agent`:

```
User: "Build X"
Octivia: [spawns Claude Code with --permission-mode bypassPermissions]
         [Claude Code writes files, runs tests]
         [reports back]
```

Requires: `claude` CLI on PATH (already installed on dev machine).

---

## Config

- Gateway config: `~/.openclaw/openclaw.json` (local, not in git)
- Workspace: `.openclaw/workspace/`
- Model: Haiku (default) → Sonnet (fallback)
- Telegram: `@Octivia_bot`, open DM, group mention not required

## Logs

```bash
tail -f /tmp/openclaw/openclaw-$(date +%Y-%m-%d).log
```
