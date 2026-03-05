---
name: doc-sync
description: Auto-update vault markdown files with current metrics after test runs
trigger: After npm test, before session end, before commits
---

# Doc Sync

## Purpose
Prevent documentation drift by automatically updating test counts, commit hashes, and other metrics in vault documents.

## Files to Sync

### vault/Dashboard.md
- Test count (TESTS stat card)
- Last commit hash
- Last synced date

### vault/Session-Sync.md
- Test count
- Last commit
- Session date

### MEMORY.md
- Test count in Project section

## Sync Method

### Manual Trigger
```bash
# Get current metrics
TESTS=$(npm test 2>&1 | grep -oE '[0-9]+ tests' | head -1)
PASS=$(npm test 2>&1 | grep -oE '[0-9]+ pass' | head -1)
COMMIT=$(git log --oneline -1)

# Update files using vault-sync.js
node -e "
const { VaultSync } = require('./agent/vault-sync');
const vs = new VaultSync();
vs.updateDashboard({ tests: '$TESTS', commit: '$COMMIT' });
vs.updateSessionSync({ tests: '$TESTS', commit: '$COMMIT' });
"
```

### Hook-Based Auto-Sync
The PostToolUse hook on `npm test` automatically captures test output and updates vault files.

## Verification
```bash
# After sync, verify counts match
grep -E "\d+" vault/Dashboard.md | head -5
grep "Tests" vault/Session-Sync.md
```
