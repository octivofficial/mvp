---
description: "/metrics — Show real coverage + test count + lint + audit"
---

# /metrics — Project Metrics Dashboard

Display all measurable quality metrics in one view.

## Steps

### 1. Test Count
```bash
npm test 2>&1 | tail -5
```

### 2. Code Coverage
```bash
npm run test:coverage 2>&1 | grep -E "(All files|Statements|Branches|Functions|Lines)"
```

### 3. Lint
```bash
npm run lint 2>&1 | tail -3
```

### 4. Dependency Audit
```bash
npm audit --audit-level=moderate 2>&1 | tail -5
```

### 5. Codebase Size
```bash
echo "Agent files: $(ls agent/*.js agent/roles/*.js | wc -l)"
echo "Test files: $(ls test/*.test.js | wc -l)"
echo "Skills: $(ls .claude/skills/*/SKILL.md | wc -l)"
echo "Commands: $(ls .claude/commands/*.md | wc -l)"
```

### 6. Output Table
```
| Metric | Value |
|--------|-------|
| Tests | 588 (585 pass, 0 fail, 3 skip) |
| Line Coverage | 65% |
| Branch Coverage | 42% |
| Function Coverage | 55% |
| Lint Errors | 0 |
| npm Audit | 4 moderate (upstream) |
| Agent Files | 28 |
| Test Files | 27 |
| Skills | 26 |
| Commands | 11 |
```
