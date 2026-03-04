# Search First

## Purpose
Before writing new code, systematically search for existing solutions in the codebase,
dependencies, and documentation. Prevents reinventing the wheel.

## The Search-First Protocol

### Step 1: Need Analysis
Before coding, answer:
- What exactly do I need? (function, pattern, utility)
- Is this a common enough need that it likely exists already?
- What would it be called? (brainstorm 3-5 names)

### Step 2: Parallel Search (run concurrently)

**Codebase search:**
```
Grep: pattern for function/class name variations
Glob: **/*.js for related file names
Read: package.json for relevant dependencies
```

**Dependency search:**
```
node_modules/.package-lock.json — check if a dep already provides this
context7 MCP — search library docs for the feature
```

**Pattern search:**
```
Grep: similar patterns already used in codebase
Read: existing utility files (agent/*.js, config/*.js)
```

### Step 3: Evaluate Findings
| Finding | Action |
|---------|--------|
| Exact match in codebase | Use it directly, import/require |
| Similar pattern exists | Extend or adapt it |
| Dependency provides it | Use the dependency's API |
| Nothing found | Proceed to implement |

### Step 4: Decide
- **Reuse**: import existing code, document the dependency
- **Extend**: add to existing module, maintain backward compat
- **Create**: write new code with tests, consider if it belongs in a shared utility

### Step 5: Implement (only if Step 4 = Create)
- Place in the most logical existing module
- Follow existing naming conventions
- Add tests alongside implementation

## Octiv-Specific Search Locations
| What | Where to look |
|------|---------------|
| Bot utilities | `agent/OctivBot.js`, `agent/team.js` |
| Redis operations | `agent/blackboard.js` |
| Logging | `agent/logger.js` |
| Timeout constants | `config/timeouts.js` |
| Safety checks | `agent/safety.js`, `agent/vm-sandbox.js` |
| Test helpers | `test/*.test.js` (shared setup patterns) |

## Activation
Use this skill:
- Before writing any new function >10 lines
- Before adding a new dependency
- When you think "I need a utility for X"
- When implementing a pattern that feels common

## Anti-Patterns
- Writing a helper that duplicates `lodash`/`underscore` functionality
- Creating a new file when the function belongs in an existing module
- Importing a large library for one small function
- Not checking if mineflayer already provides the needed API
