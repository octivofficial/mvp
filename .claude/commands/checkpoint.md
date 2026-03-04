# /checkpoint — Session State Snapshot

Save a snapshot of the current session state for recovery or reference.

## Usage
```
/checkpoint                → save checkpoint with auto-generated name
/checkpoint <name>         → save checkpoint with custom name
/checkpoint list           → list all checkpoints
/checkpoint restore <name> → describe how to restore from checkpoint
```

## Workflow

### Step 1: Capture State
Collect current state:
```bash
# Git state
git log --oneline -5
git status --short
git stash list

# Test state
npm test 2>&1 | tail -5

# Modified files
git diff --name-only
```

### Step 2: Save Checkpoint
Write to `memory/checkpoints/<name>.md`:

```markdown
## Checkpoint: <name>
- **Time**: <timestamp>
- **Branch**: <branch>
- **Last Commit**: <hash> <message>
- **Uncommitted Changes**: <file list>
- **Test Status**: X pass, Y fail, Z skip
- **Current Task**: <what was being worked on>
- **Next Steps**: <what to do next>
```

### Step 3: Confirmation
Report:
```
Checkpoint saved: <name>
- 3 uncommitted files
- 338 tests passing
- Working on: <task description>
```

## Restore Protocol
Checkpoints are informational — they describe state, not restore it.
To restore:
1. Read the checkpoint file
2. `git log` to find the referenced commit
3. `git stash list` to find any stashed changes
4. Resume work from the described state

## When to Use
- Before risky refactoring
- Before context compaction (`/compact`)
- At natural breakpoints in long sessions
- Before switching tasks mid-session
- When you want to mark "I was here" in a long workflow

## Integration
- Complements `PreCompact` hook (auto-saves before compaction)
- Complements `/simplify end` (end-of-session save)
- More granular than session-log (point-in-time vs continuous)
