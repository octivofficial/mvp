# /learn — Pattern Extraction & Instinct Formation

Analyze the current session to extract reusable patterns and save them as persistent instincts.

## Usage
```
/learn                → analyze current session
/learn <topic>        → focus extraction on specific topic
/learn list           → show all saved instincts
```

## Workflow

### Step 1: Session Analysis
Scan the current conversation for:
- **Repeated patterns**: same approach used 2+ times
- **Debugging insights**: root causes found and their symptoms
- **Architecture decisions**: why X was chosen over Y
- **Tool combos**: effective sequences of tool usage
- **Anti-patterns**: approaches that failed and why

### Step 2: Pattern Detection
For each candidate pattern:
1. Is it generalizable? (not session-specific)
2. Is it novel? (not already in MEMORY.md or patterns.md)
3. Is it actionable? (concrete enough to apply next time)

### Step 3: Instinct Formation
Format each pattern as an instinct:

```markdown
## <Pattern Name>
- **Trigger**: When do you apply this?
- **Action**: What do you do?
- **Rationale**: Why does this work?
- **Source**: Session date + context
```

### Step 4: Save
- Append new instincts to `memory/patterns.md`
- Update `MEMORY.md` if a high-level insight emerges
- Report what was saved

## Difference from `/remember`
| Feature | `/remember` | `/learn` |
|---------|-------------|----------|
| Input | Explicit user insight | Auto-extracted from session |
| Scope | Single fact/decision | Patterns across actions |
| Output | MEMORY.md entry | patterns.md instinct |
| Trigger | Manual | Manual or end-of-session |

## Examples
```
/learn              → "Found 3 patterns: Redis retry, test naming, parallel search"
/learn debugging    → "Found 1 pattern: Redis connection timeout → check Docker first"
/learn list         → shows all saved instincts from patterns.md
```
