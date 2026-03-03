# /auto-memory — Automatic Context Persistence System

Smart memory that saves and loads without manual intervention.

## How It Works

Auto-memory runs via hooks in `.claude/settings.json`:

### Trigger Points (already wired)
| Hook | When | What it saves |
|------|------|---------------|
| `UserPromptSubmit` | Every prompt | Git state, Redis ping, Docker status |
| `PreCompact` | Before context compaction | Full session state + AC progress |
| `PreToolUse(git commit)` | Before commits | Syntax check all files |

### Memory Layers

**Layer 1: Instant Memory** (hooks — automatic)
- Git commit hash, branch, modified files
- Redis connectivity, Docker container status
- Saved to: hook stdout (visible in session)

**Layer 2: Session Memory** (session-log.md — per session)
- What was done, decisions made, blockers hit
- "Changes That Need Verification" checklist
- Saved to: `~/.claude/projects/.../memory/session-log.md`

**Layer 3: Persistent Memory** (MEMORY.md — cross-session)
- Architecture decisions, patterns discovered
- Bug patterns, solutions that worked
- Saved to: `~/.claude/projects/.../memory/MEMORY.md`

**Layer 4: Knowledge Graph** (memory MCP — permanent)
- Entity relationships (Agent → uses → Blackboard)
- Long-term patterns, preferences
- Saved to: MCP memory server (JSON)

## Auto-Save Triggers

These events trigger automatic memory saves:

| Event | What's saved | Where |
|-------|-------------|-------|
| Session start | Load all layers | → context |
| Every 5th prompt | Session summary | → session-log.md |
| Before compaction | Full state dump | → session-log.md |
| After AC completion | AC status + method | → MEMORY.md |
| After bug fix | Bug pattern + solution | → patterns.md |
| After architecture decision | Decision + rationale | → MEMORY.md |
| Session end | Everything | → all layers |

## Commands

### `/auto-memory status`
Show current memory state:
- Lines in MEMORY.md
- Session-log entries today
- Knowledge graph entity count
- Last auto-save timestamp

### `/auto-memory search <query>`
Search across all memory layers for relevant context.

### `/auto-memory compact`
Compress old session logs:
- Archive logs older than 7 days
- Summarize patterns into patterns.md
- Remove duplicate entries

### `/auto-memory export`
Export full memory state to a single JSON for backup.

## Enhanced Hook (replace current UserPromptSubmit)

The enhanced hook adds context-aware status:
```bash
MEM=~/.claude/projects/-Users-octiv-Octiv-MVP/memory
PROJ=/Users/octiv/Octiv_MVP

# Core status
COMMIT=$(git -C $PROJ log --oneline -1 2>/dev/null)
BRANCH=$(git -C $PROJ branch --show-current 2>/dev/null)
MODIFIED=$(git -C $PROJ diff --name-only 2>/dev/null | wc -l | tr -d ' ')
REDIS=$(redis-cli -p 6380 ping 2>/dev/null || echo 'DOWN')
DOCKER=$(docker ps --format '{{.Names}}' 2>/dev/null | wc -l | tr -d ' ')

# Memory stats
MEM_LINES=$([ -f $MEM/MEMORY.md ] && wc -l < $MEM/MEMORY.md || echo '0')
LOG_LINES=$([ -f $MEM/session-log.md ] && wc -l < $MEM/session-log.md || echo '0')

echo "[Octiv] $BRANCH:${COMMIT:0:7} | Δ${MODIFIED} files | redis:$REDIS | docker:${DOCKER} containers | mem:${MEM_LINES}L log:${LOG_LINES}L"
```
