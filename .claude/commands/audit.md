---
description: "/audit — Run all verify-* skills in parallel, unified report"
---

# /audit — Full System Audit

Run ALL verification skills in parallel and produce a unified pass/fail report.

## Steps

### 1. Run All Verify Skills in Parallel
Use the `dispatching-parallel-agents` pattern to run these concurrently:
- `verify-tests` — test suite health
- `verify-agents` — agent file syntax and patterns
- `verify-redis` — Redis connection patterns
- `verify-dependencies` — npm audit and outdated
- `verify-mcp` — MCP server configs
- `stale-detector` — dead references and doc drift
- `coverage-audit` — c8 line/branch coverage

### 2. Collect Results
Each skill outputs a pass/fail verdict. Collect all results.

### 3. Unified Report
Output a table:

```
| Check | Status | Details |
|-------|--------|---------|
| Tests | PASS | 585 tests, 0 fail |
| Agents | PASS | All syntax OK |
| Redis | PASS | Port 6380, patterns valid |
| Dependencies | WARN | 4 upstream vulns |
| MCP | PASS | 10/16 active |
| Stale | PASS | 0 dead refs |
| Coverage | PASS | 65% lines |
```

### 4. Verdict
- ALL PASS → "System healthy"
- Any FAIL → List blockers with fix suggestions
