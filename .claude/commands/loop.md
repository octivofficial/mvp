# /loop — Rapid Feedback Loop (REPL-style dev cycle)

Ultra-fast edit→test→fix cycle. Keeps iterating until all tests pass or max iterations reached.

## Modes

### `/loop tdd <feature>`
Red-Green-Refactor cycle:
1. **RED**: Write failing test for `<feature>`
2. **GREEN**: Write minimal code to pass
3. **REFACTOR**: Clean up, check patterns.md
4. **VERIFY**: `npm test` — if fail, go to step 2
5. **COMMIT**: Auto-commit with TDD message
- Max iterations: 5
- On each iteration: show diff + test output

### `/loop fix <file>`
Auto-fix loop until syntax + tests pass:
1. `node -c <file>` — syntax check
2. If fail: auto-fix the syntax error
3. `npm test` — run tests
4. If fail: analyze error, apply fix
5. Repeat until pass or max 5 iterations
6. Show summary: iterations, changes made, final status

### `/loop refactor <file>`
Iterative improvement loop:
1. `serena get_file_outline`: Get current structure
2. Identify improvement (dead code, duplication, complexity)
3. Apply ONE improvement
4. `node -c` + `npm test` — verify no regression
5. Repeat until clean or max 3 iterations
6. `git diff --stat` — show total changes

### `/loop deploy`
Deploy verification loop:
1. `npm test` — all tests pass?
2. `node -c agent/*.js` — all syntax ok?
3. `grep secrets` — no secrets in code?
4. Build check (if applicable)
5. If all pass → ready to ship
6. If any fail → fix and restart loop

## Configuration
```
MAX_ITERATIONS=5       # Safety limit
AUTO_COMMIT=true       # Commit after successful loop
VERBOSE=false          # Show full test output each iteration
PAUSE_ON_FAIL=false    # Pause and ask before auto-fixing
```

## Output Format
Each iteration shows:
```
─── Loop iteration 3/5 ───
📝 Change: [description of what was modified]
🧪 Test: ✅ 10 passed | ❌ 1 failed
📊 Coverage: 85%
⏱️  Time: 2.3s
→ Next: fixing test/blackboard.test.js line 42
```

Final summary:
```
═══ Loop Complete ═══
🔄 Iterations: 3
✅ All tests passing
📝 Files changed: 2 (agent/builder.js, test/builder.test.js)
💾 Committed: "🔧 TDD: add inventory tracking"
```

## Safety
- NEVER loop more than MAX_ITERATIONS (prevents infinite loops)
- Each iteration must make progress (different fix than previous)
- If same error repeats 2x, stop and ask user for guidance
- All changes are staged incrementally (easy to revert)
