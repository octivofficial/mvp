---
name: permission-hygiene
description: Clean accumulated one-shot permissions from settings.local.json
trigger: When settings.local.json exceeds 50 lines, periodic hygiene
---

# Permission Hygiene

## Purpose
Claude Code accumulates one-shot permission entries in `.claude/settings.local.json` over time. These grow unbounded and create security debt. This skill cleans them.

## Strategy

### 1. Audit Current State
```bash
wc -l .claude/settings.local.json
```

### 2. The Right Architecture
- **Wildcard patterns** go in `.claude/settings.json` (project-level, committed)
- **One-shot entries** in `settings.local.json` should be temporary
- When a pattern is used 3+ times, promote it to a wildcard in settings.json

### 3. Clean settings.local.json
Reset to empty:
```json
{
  "permissions": {
    "allow": [],
    "deny": []
  }
}
```

### 4. Verify Wildcards Cover Common Patterns
Check `.claude/settings.json` has patterns for:
- `Bash(npm test*)` — test runs
- `Bash(npm run *)` — npm scripts
- `Bash(git *)` — git operations
- `Bash(docker *)` — container ops
- `Bash(redis-cli *)` — Redis ops

### 5. Promote Frequent Patterns
If after cleaning, the same permission gets requested 3+ times in a session, add it as a wildcard to `settings.json`.

## Threshold
- **Alert**: settings.local.json > 50 lines
- **Critical**: settings.local.json > 200 lines
