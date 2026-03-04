# Autonomous Loops

## Purpose
Theoretical foundation and patterns for automated feedback loops.
Powers the `/loop` command family with structured iteration strategies.

## Loop Patterns

### 1. Sequential Pipeline
```
input → step1 → step2 → step3 → output
         ↑                        |
         └── retry on failure ────┘
```
**Use for**: Build → test → deploy, lint → fix → verify
**Max iterations**: 5 (prevent infinite loops)
**Exit condition**: all steps pass OR max iterations reached

### 2. Red-Green-Refactor (TDD Loop)
```
RED:      write failing test
GREEN:    write minimal code to pass
REFACTOR: improve without changing behavior
VERIFY:   all tests still pass
```
**Use for**: `/loop tdd <feature>`
**Exit condition**: test passes AND code is clean
**Guard**: never skip RED phase

### 3. Fix Loop
```
RUN:    execute check (lint, test, typecheck)
PARSE:  extract error locations and messages
FIX:    apply targeted fixes
VERIFY: re-run check
```
**Use for**: `/loop fix <file>`, auto-lint-fix
**Max iterations**: 5
**Exit condition**: 0 errors OR max iterations
**Strategy**: fix highest-impact errors first

### 4. De-Sloppify Loop
```
SCAN:     find code smells, complexity, duplication
RANK:     prioritize by impact
FIX:      address top issue
VERIFY:   tests pass, metric improved
REPEAT:   until quality threshold met
```
**Use for**: `/loop refactor <file>`
**Metrics**: cyclomatic complexity, duplication %, line count
**Guard**: never break existing tests

### 5. DAG (Directed Acyclic Graph)
```
     ┌─ taskA ──┐
start┤          ├─ taskD → end
     └─ taskB ──┤
        taskC ──┘
```
**Use for**: Complex multi-step tasks with parallelizable branches
**Implementation**: identify dependencies, parallelize independent tasks
**Guard**: topological sort to prevent cycles

## Loop Safety Rules

1. **Max iterations**: Always set a hard limit (default: 5)
2. **Progress check**: If no progress after 2 iterations, stop and report
3. **State tracking**: Log each iteration's input/output for debugging
4. **Rollback**: Keep git state clean — stash before, restore on failure
5. **Exit codes**: 0 = success, 1 = max iterations, 2 = no progress, 3 = error

## Integration with `/loop` Command

| Command | Pattern | Max Iter |
|---------|---------|----------|
| `/loop tdd <feature>` | Red-Green-Refactor | 10 |
| `/loop fix <file>` | Fix Loop | 5 |
| `/loop refactor <file>` | De-Sloppify | 5 |
| `/loop deploy` | Sequential Pipeline | 3 |

## Activation
Use this skill when:
- Designing new automated workflows
- Extending the `/loop` command family
- Debugging infinite loop issues in automation
- Planning complex multi-step operations

## Anti-Patterns
- No max iteration limit (infinite loop risk)
- No progress detection (spinning without improvement)
- Fixing symptoms not causes in fix loops
- Skipping verification step after changes
- Not logging iteration state for debugging
