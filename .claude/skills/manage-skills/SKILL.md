---
name: manage-skills
description: Analyzes session changes, detects missing verify-* skill coverage, creates or updates verification skills, and keeps CLAUDE.md in sync. Run after implementing a new feature or pattern.
argument-hint: "[optional: specific skill name or area to focus on]"
---

# Session-Based Skill Maintenance

## Purpose

Analyze changes made in the current session to detect and fix verification skill drift:

1. **Missing coverage** — changed files not referenced by any verify skill
2. **Invalid references** — skills pointing to deleted or moved files
3. **Missing checks** — new patterns not covered by existing checks
4. **Stale values** — config values or detection commands that no longer match

## When to Run
- After implementing a feature that introduces new patterns or rules
- Before a PR to ensure verify skills cover changed areas
- When a verify run misses issues you expected to catch
- Periodically to align skills with codebase evolution

## Registered Verify Skills

| Skill | Description | Covered File Patterns |
|-------|-------------|----------------------|
| `verify-redis` | Redis connection, port, and channel naming | `agent/blackboard.js`, `agent/*.js` |
| `verify-agents` | OctivBot patterns, heartbeat, reconnect logic | `agent/OctivBot.js`, `agent/*.js` |
| `verify-tests` | Test suite health, count thresholds, agent coverage map | `test/*.test.js`, `agent/*.js` |
| `verify-dependencies` | npm audit vulnerabilities, outdated packages | `package.json`, `package-lock.json` |
| `verify-mcp` | MCP server config vs token availability | `~/.claude/settings.json`, `.mcp.json` |
| `verify-implementation` | Orchestrates all verify-* skills sequentially | all of the above |
| `capability-registry` | Agent↔MCP↔Skill mapping reference | `.claude/agents/*.md`, `.mcp.json` |

## Workflow

### Step 1: Collect Session Changes
```bash
# Uncommitted changes
git diff HEAD --name-only

# Commits on current branch since main
git log --oneline main..HEAD 2>/dev/null

# All changed files since diverging from main
git diff main...HEAD --name-only 2>/dev/null
```

Group files by top-level directory. If an optional argument was passed, filter to relevant files only.

### Step 2: Map Files to Registered Skills

From the **Registered Verify Skills** table above, build a file→skill mapping.
For each skill, read its `SKILL.md` and extract:
- **Related Files** section — file paths and glob patterns
- **Workflow** section — grep/glob commands that reveal file paths

Show the mapping:
```markdown
| Skill | Triggered Files | Action |
|-------|----------------|--------|
| verify-redis | `agent/blackboard.js` | CHECK |
| (none) | `agent/team.js` | UNCOVERED |
```

### Step 3: Analyze Coverage Gaps

For each AFFECTED skill (matched files), read full SKILL.md and check:
1. Missing file references in Related Files
2. Outdated detection commands (run samples to test)
3. Uncovered new patterns in changed files
4. Stale references to deleted files

### Step 4: Decide CREATE vs UPDATE

```
For each uncovered file group:
  IF related to an existing skill's domain:
    → UPDATE existing skill
  ELSE IF 3+ related files share a common rule/pattern:
    → CREATE new verify skill
  ELSE:
    → Mark as exempt
```

### Step 5: Update Existing Skills

For approved updates:
- Add missing file paths to **Related Files** table
- Add detection commands for new patterns
- Remove stale references to deleted files
- **Never remove checks that still work**

### Step 6: Create New Skills

For approved new skills:
1. Confirm name with user — must start with `verify-`, use kebab-case
2. Create `.claude/skills/verify-<name>/SKILL.md` with:
   - Real file paths (verified with `ls`)
   - Working detection commands (tested)
   - PASS/FAIL criteria for each check
   - At least 2-3 realistic exception cases
3. Update **Registered Verify Skills** table in THIS file
4. Update `verify-implementation/SKILL.md` — add to target skill list
5. Update `CLAUDE.md` — add row to Skills table

### Step 7: Validation

After all edits:
1. Re-read all modified SKILL.md files
2. Verify markdown format (closed code blocks, consistent tables)
3. Check no broken file references:
```bash
ls <file-path> 2>/dev/null || echo "MISSING: <file-path>"
```
4. Dry-run one detection command per updated skill

### Step 8: Summary Report

```markdown
## Skill Maintenance Report

### Changed Files Analyzed: N

### Skills Updated: X
- `verify-<name>`: added N checks

### Skills Created: Y
- `verify-<name>`: covers <pattern>

### Updated Related Files:
- `manage-skills/SKILL.md`: registered verify skills table
- `verify-implementation/SKILL.md`: target skills table
- `CLAUDE.md`: Skills table

### Exempt (no skill needed):
- `path/to/file` — config/docs/generated
```

## Exceptions (not violations)

1. Lock files (`package-lock.json`) — no skill needed
2. Docs (`README.md`, `ROADMAP.md`) — not code patterns
3. CI/CD config (`.github/`) — infrastructure, not app patterns
4. Generated files (`dump.rdb`) — not tracked
5. Test fixtures — already covered by test structure
6. `CLAUDE.md` itself — documentation update
