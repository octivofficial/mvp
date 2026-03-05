---
name: coverage-audit
description: Run c8 line/branch/function coverage, enforce minimums, report gaps
trigger: After test runs, before PRs, periodic audits
---

# Coverage Audit

## Purpose
Measure actual code coverage with c8, not just test counts. Enforces minimum thresholds and identifies uncovered critical paths.

## Steps

### 1. Run Coverage
```bash
npm run test:coverage
```

### 2. Check Thresholds
The `.c8rc.json` enforces:
- Lines: >= 60%
- Branches: >= 40%
- Functions: >= 50%

If thresholds fail, c8 exits non-zero.

### 3. Identify Gaps
```bash
# Open HTML report
open coverage/index.html

# Find uncovered files
npx c8 report --reporter=text | grep -E '^\s+\d' | sort -t'|' -k2 -n | head -20
```

### 4. Priority Files
Focus coverage on:
1. `agent/blackboard.js` — core pub/sub
2. `agent/builder.js` — ReAct loop
3. `agent/leader.js` — strategy engine
4. `agent/safety.js` — threat detection
5. `agent/vm-sandbox.js` — code validation

### 5. Report
Output coverage summary to stdout. If running in CI, coverage is enforced automatically.

## Thresholds (ratchet up over time)
| Metric | Current Min | Target |
|--------|------------|--------|
| Lines | 60% | 80% |
| Branches | 40% | 60% |
| Functions | 50% | 70% |
