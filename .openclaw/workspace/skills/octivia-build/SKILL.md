---
name: octivia-build
description: Compile all accumulated vibes into a BMAD BUILD BRIEF. Triggered by /build command. Reads recent vault/00-Vibes/ files and generates an actionable build plan for the development team.
user-invocable: true
---

# /build — Vibe Compiler

When the user runs `/build`, compile all accumulated ideas from the vault into a BMAD BUILD BRIEF.

## Steps

1. **Gather vibes**: Read vault/00-Vibes/ directory for recent vibe files (exclude BUILD-BRIEF files)
   ```bash
   ls -1t /Users/octiv/Octiv_MVP/vault/00-Vibes/*.md 2>/dev/null | grep -v BUILD-BRIEF | head -10
   ```

2. **Extract ideas**: For each vibe file, extract:
   - `**Idea**:` line
   - `**Context**:` line
   - `**Vibe**:` line

3. **Compile BUILD BRIEF** in this exact format:

```
## Build Brief: [Overarching Theme]

**Vision**: [1-2 sentences: what we're building and why it matters]
**Vibe**: [adjectives: how it should feel when done]

### Gap Analysis
**What exists**: [bullet list of relevant existing pieces]
**What's missing**: [specific gaps — be surgical]
**Complexity**: [1 day | 1 week | 1 month]

### BMAD Execution Plan

**pm-agent** — Requirements:
- [ ] AC-X: [acceptance criterion]

**planner** — Steps:
1. [concrete step]

**architect** — Design:
- [key design decision]

**dev-agent** — Files:
- `agent/xxx.js` — create/modify

**tdd-guide** — Tests:
- `test/xxx.test.js` — N tests

### Skills to Invoke
- [relevant skills]
```

4. **Save the brief** to `vault/00-Vibes/BUILD-BRIEF-YYYY-MM-DD.md`

5. **Publish to Blackboard** via `octivia-blackboard` skill

6. Close with: "All yours, 팀. 빌드 시작해요." in gyopo style

## If no vibes accumulated

Respond: "No vibes accumulated yet. Tell me your ideas first — I'll gather them. 아이디어 먼저요!"
