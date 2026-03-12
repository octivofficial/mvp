# Octivia Party Mode — 3-Layer Skill Architecture

## When to Use This Skill

Reference this when:
- Starting a new Telegram/Octivia session
- Switching between party mode (idea capture) and build mode (spec execution)
- Understanding which skills belong to which layer
- Designing the vibe → spec → build pipeline

## The Three Layers

```
┌─────────────────────────────────────────────────────────┐
│  LAYER 1: OCTIVIA (Bridge — Party Mode)                 │
│  Role: Tony ↔ Octivia ↔ JARVIS (Claude Code)           │
│  Mode: Always listening, never interrupting              │
│  Output: vault/00-Vibes/*.md → Obsidian → /build        │
├─────────────────────────────────────────────────────────┤
│  LAYER 2: MINECRAFT (Training Ground)                   │
│  Role: Teamwork, survival, skill-building               │
│  Output: Survival skills that TRANSFER to idol career   │
├─────────────────────────────────────────────────────────┤
│  LAYER 3: CLAUDE CODE (Developer Army — Build Mode)     │
│  Role: Read Obsidian → BMAD team builds                 │
│  Output: Tested, committed, deployed code               │
└─────────────────────────────────────────────────────────┘
```

---

## Layer 1: Octivia Skills

### Core Capabilities
| Skill | Purpose | Status |
|-------|---------|--------|
| `obsidian-sync` | Full vault read/write, Dashboard.md, wikilinks | ✅ Active |
| `remember` | Mid-session insight capture to MEMORY.md | ✅ Active |
| `brainstorming` | Explore intent before committing to a direction | ✅ Active |
| `writing-plans` | Convert vibe notes into structured plans | ✅ Active |
| `notebooklm` | Query knowledge base for cross-reference | ✅ Active |
| `session-memory` | Load full project state at session start | ✅ Active |
| `save-memory` | Persist learnings to MEMORY.md at session end | ✅ Active |
| `OctiviaContext` | Aggregates git log, agents, vibes, MEMORY.md | ✅ Active |

### Party Mode Workflow
```
User talks (Telegram)
  → Octivia listens silently, takes notes (session.notes[])
  → Asks ONE natural follow-up question (gyopo style)
  → Collects: idea + context + vibe (3 turns)
  → Generates Build Spec → saves to vault/00-Vibes/
  → Publishes to Redis Blackboard (vibe:golden)

User types /build
  → Octivia compiles last 10 vibes
  → Generates BMAD BUILD BRIEF
  → Saves as BUILD-BRIEF-YYYY-MM-DD.md with frontmatter
  → Publishes to Blackboard (octivia:build-brief)
  → Claude Code picks up and executes
```

### Obsidian Frontmatter (Octivia writes)
```yaml
---
type: vibe          # or: build-brief
status: idea        # or: building | review | shipped
created: 2026-03-12
author: username
tags: [vibe, idea, octivia]
source: telegram
---
```

### SPEC_PROMPT format (3-turn output)
```markdown
## Build Spec: [Feature Name]

**Intent**: [1 sentence — what this accomplishes]
**Vibe**: [adjectives — how it feels]
**Gap**: [what's missing — be specific]
**Approach**: [1-2 sentence plan using existing architecture]
**Files**: [agent/*.js to create or modify]
**Skills**: [/skills to invoke]
```

### BMAD BUILD BRIEF format (/build output)
```markdown
## Build Brief: [Overarching Theme]

**Vision**: [what we're building and why]
**Vibe**: [adjectives]

### Gap Analysis
**What exists**: [bullet list]
**What's missing**: [specific gaps]
**Complexity**: [1 day | 1 week | 1 month]

### BMAD Execution Plan
**pm-agent** — Requirements: [AC tasks]
**planner** — Steps: [numbered]
**architect** — Design: [decisions]
**dev-agent** — Files: [paths]
**tdd-guide** — Tests: [test files]

### Skills to Invoke
- /brainstorming, /writing-plans, /tdd-workflow, etc.
```

---

## Layer 2: Minecraft Skills

| Skill | Minecraft Purpose | Idol Transfer |
|-------|-------------------|---------------|
| `first-day-survival` | Collect wood, build shelter, survive night | Resource gathering, platform building |
| `weather` | Schedule daylight activities | Timing content drops, event planning |
| `mcporter` | Control bots via mineflayer | Team coordination, execution |
| `mineflayer-building-patterns` | 4x4 floors, 3-block walls, AC-2 shelter | Construction discipline, perfectionism |
| Mining skills | Deep work, resource extraction | Research, learning, content creation |
| Farming skills | Sustainable growth, patience | Fan engagement, sustainable career |
| Team coordination (AC-4) | All agents gather in shelter | Group performance, synchronization |

### The Transfer Principle
```
Minecraft Survival  →  Idol Career
────────────────────────────────────
Wood collection     →  Content creation (raw material gathering)
Shelter building    →  Platform/brand building (safe base)
Mining              →  Deep research & skill-building (go underground)
Farming             →  Fan farming, sustainable growth
Team gathering      →  Group performance, stage synchronization
Threat detection    →  Crisis management, negative PR response
Self-improvement    →  Continuous practice, skill refinement
```

---

## Layer 3: Claude Code Developer Skills

### BMAD Team Capabilities
| Agent | Role | Key Skills |
|-------|------|-----------|
| `pm-agent` | Requirements, AC tasks | github (issues), sentry (user impact) |
| `planner` | Step breakdown, dependencies | sequentialthinking, serena |
| `architect` | System design, patterns | serena (symbols), context7 (docs) |
| `dev-agent` | Write actual code | serena (navigate), context7 (API) |
| `tdd-guide` | Tests before code | mocks, Blackboard stubs |
| `code-reviewer` | Quality, security | github (PR), serena |
| `debug-agent` | Systematic debugging | sentry, serena (locate) |
| `github-agent` | Commit, push, CI | github, vercel |

### Developer Skills (always available)
| Skill | When |
|-------|------|
| `/tdd-workflow` | Before any new feature |
| `/systematic-debugging` | When things break |
| `/dispatching-parallel-agents` | Multiple independent tasks |
| `/verification-loop` | Before claiming done |
| `/writing-plans` | Multi-step implementation |
| `/brainstorming` | Before major design decisions |
| `verify-tests` | After modifying agents |
| `verify-redis` | After Redis changes |
| `search-first` | Before writing new code |
| `cost-aware-llm-pipeline` | LLM routing decisions |

---

## The Full Pipeline

```
PARTY MODE (Octivia active):
  Telegram message
    → _vibeConversation() [3 turns]
    → vault/00-Vibes/YYYY-MM-DD-slug.md [frontmatter + spec]
    → Redis publish(vibe:golden)

  /build command
    → _accumulateRecentVibes() [reads last 10 vibes]
    → BMAD_BRIEF_PROMPT [LLM compiles]
    → BUILD-BRIEF-YYYY-MM-DD.md [Obsidian with frontmatter]
    → Redis publish(octivia:build-brief)

BUILD MODE (Claude Code active):
  Read Obsidian vault/00-Vibes/BUILD-BRIEF-*.md
    → pm-agent reads AC tasks
    → planner breaks down steps
    → architect designs system
    → dev-agent implements (TDD)
    → code-reviewer checks quality
    → github-agent commits + pushes

KNOWLEDGE LOOP:
  Session end → /save-memory → MEMORY.md
  Major milestone → /cascade sync → NotebookLM → Obsidian Zettelkasten
```

---

## Octivia's Full Permission Scope

Octivia has access to:
- ✅ **Telegram** — polling, send/receive messages
- ✅ **vault/00-Vibes/** — read/write idea notes + BUILD BRIEFs
- ✅ **vault/MEMORY.md** — read system context
- ✅ **Redis Blackboard** — publish/subscribe (vibe:golden, telegram:idea, octivia:build-brief)
- ✅ **Git log** — read recent commits (via OctiviaContext)
- ✅ **agents:registry** — read active agents (via OctiviaContext)
- ✅ **LLM** — call via ReflexionEngine (haiku/sonnet routing)
- ✅ **Obsidian** — writes to vault/ which IS the Obsidian vault root

With `OctiviaContext`, she aggregates all of the above on every session.

---

## Skill Gap Detection

When generating a Build Spec, Octivia should check:
1. Does the **Gap** reference something in MEMORY.md?
2. Which **BMAD agents** are needed for this?
3. Which **skills** should be invoked?
4. Is there a **verify-* skill** for the changed component?
5. Does a **new skill** need to be created?

If a skill is missing, add it to `.claude/skills/` and register in CLAUDE.md.
