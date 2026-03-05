---
description: "/hygiene — Clean permissions, fix stale docs, scan dead refs"
---

# /hygiene — Codebase Hygiene Sweep

One command to clean accumulated debt across permissions, docs, and dead references.

## Steps

### 1. Permission Hygiene
Check `.claude/settings.local.json` line count:
```bash
wc -l .claude/settings.local.json
```
If > 50 lines, reset to empty `{ "permissions": { "allow": [], "deny": [] } }`.

### 2. Stale Reference Scan
```bash
# Dead library refs
grep -rn "vm2\|isolated-vm\|mongodb" agent/ --include="*.js"

# Outdated comments
grep -rn "TODO\|FIXME\|HACK" agent/ --include="*.js"
```

### 3. Doc Sync
Update test counts in:
- `vault/Dashboard.md`
- `vault/Session-Sync.md`
- `MEMORY.md` (if stale)

Get current count from last test run output.

### 4. Dead File Scan
```bash
# Temp/backup files
find . -type f \( -name "*.bak" -o -name "*.tmp" -o -name "*.orig" \) -not -path "./node_modules/*"
```

### 5. Report
Output summary of what was cleaned and what remains.
