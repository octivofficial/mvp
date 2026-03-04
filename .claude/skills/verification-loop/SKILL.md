# Verification Loop

## Purpose
Systematic 6-phase verification before any PR or claiming work is complete.
Produces a definitive READY / NOT READY verdict.

## The 6 Phases

### Phase 1: Build
```bash
node -c agent/*.js agent/roles/*.js  # syntax check all source
```
- PASS: all files parse without error
- FAIL: fix syntax errors before proceeding

### Phase 2: Type Check (optional)
- If JSDoc types are present, verify with `tsc --noEmit --allowJs`
- Skip if no type annotations exist

### Phase 3: Lint
```bash
npm run lint
```
- PASS: 0 problems (0 errors, 0 warnings)
- FAIL: fix lint issues before proceeding

### Phase 4: Test
```bash
npm test
```
- PASS: all tests pass (skip count stable or decreasing)
- FAIL: fix failing tests before proceeding
- Track: total count, pass count, skip count, fail count

### Phase 5: Security Scan
```bash
# Check for secrets in staged files
git diff --cached --name-only | xargs grep -lE '(ANTHROPIC_API_KEY|DISCORD_TOKEN|RCON_PASSWORD|sk-ant-|ghp_|xoxb-)' || echo "CLEAN"

# Check .env not staged
git diff --cached --name-only | grep -E '\.env$' && echo "BLOCKED: .env staged" || echo "CLEAN"
```
- PASS: no secrets found, no .env files staged
- FAIL: remove secrets before proceeding

### Phase 6: Diff Review
```bash
git diff --cached --stat  # summary of changes
git diff --cached          # full diff for review
```
- Verify: changes match intent
- Verify: no unrelated changes included
- Verify: no debug code (console.log, debugger) left in

## Verdict Template

```
## Verification Report
- Build:    [PASS/FAIL]
- Type:     [PASS/FAIL/SKIP]
- Lint:     [PASS/FAIL]
- Test:     [PASS/FAIL] (X pass, Y fail, Z skip)
- Security: [PASS/FAIL]
- Diff:     [PASS/FAIL]

Verdict: [READY / NOT READY]
Blockers: [list if NOT READY]
```

## Activation
Use this skill:
- Before creating a commit
- Before opening a PR
- Before claiming a task is complete
- After `/simplify ship` but before push

## Integration with Existing Skills
- Combines with `verify-tests` (Phase 4 detail)
- Combines with `security-review` (Phase 5 detail)
- Feeds into `verification-before-completion` (superpowers)
