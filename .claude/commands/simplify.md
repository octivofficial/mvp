# /simplify — Smart task shortcuts

One-word shortcuts for common multi-step workflows. Reduces 5+ steps to 1 command.

## Shortcuts

### `/simplify start`
Session startup sequence (replaces manual /session-memory):
1. Load MEMORY.md + session-log.md + debugging.md + patterns.md
2. `git log --oneline -5`
3. `redis-cli -p 6380 ping`
4. `docker ps --format '{{.Names}}: {{.Status}}'`
5. Check session-log "Changes That Need Verification" → run affected tests
6. Report: Phase, last commit, blockers, next task

### `/simplify end`
Session shutdown sequence (replaces manual /save-memory):
1. `/verify-implementation` equivalent — syntax check all agent files
2. `grep -rn 'password\|secret\|key' --include='*.js' --include='*.yml'` — no secrets
3. `git add` changed files + `git commit` with auto-generated message
4. Save MEMORY.md + session-log with "Changes That Need Verification"
5. Report: "Memory saved. Next session picks up from [X]"
6. If phase milestone completed → suggest `/cascade sync` for knowledge refinement

### `/simplify fix <file>`
Quick fix workflow:
1. Read the file
2. `node -c` syntax check
3. If error: show error, suggest fix
4. After fix: re-check, run related tests
5. Stage and report

### `/simplify plan <task>`
Plan Combo shortcut:
1. `sequentialthinking`: Decompose task
2. `serena find_symbol` + `get_file_outline`: Map codebase
3. Generate `plan.md` from template
4. Present for review

### `/simplify ship`
Ship Combo shortcut:
1. Run all tests
2. Syntax check all files
3. Git commit with auto message
4. Push to remote
5. Report deployment status

### `/simplify debug <error>`
Debug Combo shortcut:
1. Search codebase for error message
2. `serena find_symbol` on failing function
3. Analyze with sequentialthinking
4. Suggest fix with code diff

## Usage
```
/simplify start
/simplify end
/simplify fix agent/builder.js
/simplify plan "add inventory management"
/simplify ship
/simplify debug "TypeError: Cannot read property"
```
