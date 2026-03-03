---
name: verify-implementation
description: Runs all registered verify-* skills sequentially and generates an integrated validation report. Use before PRs, after major feature work, or for periodic codebase audits.
---

# Integrated Verification

## Purpose

Orchestrates all registered verify skills to produce a comprehensive validation report:

1. **Sequential execution** — runs each verify skill in order
2. **Pass/fail tracking** — records results per check
3. **Fix suggestions** — recommends corrections for failures
4. **Re-validation** — confirms fixes resolved issues

## When to Run
- Before creating a pull request
- After implementing a new AC task
- When CI fails and root cause is unclear
- Periodic codebase quality audit

## Target Skills (run in order)

| # | Skill | Description |
|---|-------|-------------|
| 1 | `verify-redis` | Redis port, channels, error handling |
| 2 | `verify-agents` | OctivBot patterns, heartbeat, reconnect |

## Workflow

### Step 1: Introduction

List all skills in the **Target Skills** table above.
If the table is empty: display `ℹ️ No verify skills registered yet. Run /manage-skills to create them.` and stop.

### Step 2: Execute Each Skill Sequentially

For each skill in order:
1. Read its `SKILL.md` from `skills/verify-<name>/SKILL.md`
2. Parse sections: **Workflow**, **Exceptions**, **Related Files**
3. Execute checks using the specified tools (Grep, Glob, Read, Bash)
4. Apply exception patterns to avoid false positives
5. Record result per check:

```markdown
| Check | File | Status | Detail |
|-------|------|--------|--------|
| Redis port is 6380 | agent/blackboard.js | ✅ PASS | port: 6380 found |
| octiv: prefix on channels | agent/blackboard.js | ✅ PASS | |
| heartbeat interval set | agent/OctivBot.js | ❌ FAIL | setInterval not found |
```

### Step 3: Integrated Report

After all skills run:

```markdown
## Integrated Verification Report

**Run**: [timestamp]
**Skills executed**: N
**Total checks**: M
**Pass**: X | **Fail**: Y | **Skipped**: Z

---

### verify-redis: ✅ PASS (3/3)
[table from step 2]

### verify-agents: ⚠️ 1 FAIL (2/3)
[table from step 2]

---

### Issues Summary
1. `agent/OctivBot.js` — heartbeat interval not found → add `setInterval(() => ..., 5000)` in constructor
```

### Step 4: User Action

Ask user:
- `[A]` Auto-fix all issues
- `[R]` Review each fix individually
- `[S]` Skip fixes, report only

### Step 5: Apply Fixes

For approved fixes:
- Read the target file first
- Apply minimal, targeted change
- Note the change in the report

### Step 6: Re-validate

After fixes, re-run affected skills and show before/after:

```markdown
### Re-validation

| Skill | Before | After |
|-------|--------|-------|
| verify-agents | 2/3 ✅ | 3/3 ✅ |
```

## Exceptions

1. **No skills registered** — not an error, just show the info message
2. **File not found** — skip that check, flag as `SKIPPED`
3. **Shell command fails in CI** — note the environment limitation, don't mark as FAIL
