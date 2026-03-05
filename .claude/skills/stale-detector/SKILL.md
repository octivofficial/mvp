---
name: stale-detector
description: Scan for outdated comments, counts, dead references, and documentation drift
trigger: Before PRs, after major changes, periodic hygiene
---

# Stale Detector

## Purpose
Find and fix stale references before they accumulate into technical debt. Prevents documentation drift and ghost comments.

## Checks

### 1. Dead Library References
```bash
# vm2 was replaced by node:vm — should have zero references
grep -rn "vm2" agent/ test/ --include="*.js" | grep -v node_modules
```

### 2. Test Count Drift
```bash
# Get actual test count from last run
npm test 2>&1 | grep -E "tests.*pass"

# Check Dashboard.md and Session-Sync.md match
grep -E "\d+ (Tests|tests|PASS)" vault/Dashboard.md vault/Session-Sync.md
```

### 3. Stale Comments
```bash
# Find TODO/FIXME/HACK markers
grep -rn "TODO\|FIXME\|HACK\|XXX" agent/ --include="*.js"

# Find comments referencing removed features
grep -rn "vm2\|isolated-vm\|mongodb" agent/ --include="*.js"
```

### 4. Dead Exports
```bash
# Find exports that no test imports
node -e "
const fs = require('fs');
const agentFiles = fs.readdirSync('agent').filter(f => f.endsWith('.js'));
const testContent = fs.readdirSync('test').filter(f => f.endsWith('.test.js'))
  .map(f => fs.readFileSync('test/' + f, 'utf8')).join('');
agentFiles.forEach(f => {
  const base = f.replace('.js', '');
  if (!testContent.includes(base)) console.log('Untested:', f);
});
"
```

### 5. Config Drift
```bash
# Check MEMORY.md test count matches reality
grep "tests" ~/.claude/projects/-Users-octiv-Octiv-MVP/memory/MEMORY.md

# Check agent count in CLAUDE.md
grep -c "agent/" CLAUDE.md
ls agent/*.js | wc -l
```

## Output
List all stale items with file:line references. Fix inline or create tasks.
