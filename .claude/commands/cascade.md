# /cascade — Cascading Knowledge Refinement

2-layer NotebookLM pipeline: 1기(Director/전략) → 2기(Field/운용) with context injection.
Each cascade costs 2 queries (of 50/day limit).

Results are saved as Zettelkasten-linked vault notes for knowledge graph integration.

## Subcommands

### `/cascade query <question>`
Execute a 2-layer cascade query:
1. Ask 1기 Director notebook (strategic analysis)
2. Inject 1기 answer as context → ask 2기 Field notebook (operational refinement)
3. Save structured result to `vault/03-Research/NotebookLM/Cascade-{date}-{slug}.md`

```bash
cd ~/.claude/skills/notebooklm
python scripts/run.py cascade_query.py \
  --question "$ARGUMENTS" \
  --save-to-vault \
  --project-root /Users/octiv/Octiv_MVP
```

Output includes Zettelkasten links connecting to ROADMAP, Session-Sync, and related cascade notes.

### `/cascade sync`
Phase completion workflow — sync sources + cascade analysis:
1. Generate status report from git log + test results + MEMORY.md
2. `add_source.py --all` (update 1기+2기 sources in parallel)
3. `cascade_query.py` with auto-generated phase analysis question
4. Save to vault with Zettelkasten links

```bash
cd ~/.claude/skills/notebooklm

# Step 1: Generate status report
PHASE=$(grep -m1 'Phase' /Users/octiv/Octiv_MVP/CLAUDE.md | head -1)
REPORT=$(mktemp)
echo "# Phase Status Report — $(date +%Y-%m-%d)" > "$REPORT"
echo "" >> "$REPORT"
git -C /Users/octiv/Octiv_MVP log --oneline -10 >> "$REPORT"
echo "" >> "$REPORT"
echo "## Test Results" >> "$REPORT"
cd /Users/octiv/Octiv_MVP && npm test 2>&1 | tail -5 >> "$REPORT"
echo "" >> "$REPORT"
head -50 /Users/octiv/Octiv_MVP/CLAUDE.md >> "$REPORT"

# Step 2: Sync sources (parallel — both notebooks)
python scripts/run.py add_source.py --all --source-file "$REPORT"

# Step 3: Cascade analysis
python scripts/run.py cascade_query.py \
  --question "Analyze current phase progress: what has been achieved, what are the key risks, and what should be the next strategic priorities?" \
  --save-to-vault \
  --project-root /Users/octiv/Octiv_MVP

rm "$REPORT"
```

### `/cascade status`
Show recent cascade results:
```bash
ls -la /Users/octiv/Octiv_MVP/vault/03-Research/NotebookLM/Cascade-*.md 2>/dev/null | tail -5
echo "---"
echo "Library status:"
cd ~/.claude/skills/notebooklm && python scripts/run.py notebook_manager.py stats
```

## Usage
```
/cascade query "P8.1 pathfinding 개선의 전략적 의미는?"
/cascade sync
/cascade status
```

## Architecture
```
Question
   │
   ▼
┌─────────────────────────┐
│ Layer 1: 1기 Director    │  ← strategic/architecture analysis
│ (Master Blueprint)       │
└───────────┬─────────────┘
            │ answer (max 3000 chars)
            ▼
┌─────────────────────────┐
│ Layer 2: 2기 Field Ops   │  ← operational refinement + 1기 context
│ (OpenClaw Phase 2)       │
└───────────┬─────────────┘
            │ refined answer
            ▼
┌─────────────────────────┐
│ Vault (Zettelkasten)     │  → vault/03-Research/NotebookLM/Cascade-*.md
│ with [[links]]           │     ↳ linked to ROADMAP, Session-Sync, related notes
└─────────────────────────┘
```

## Error Handling
- Layer 1 fails → Layer 2 gets original question (no context injection)
- Layer 2 fails → Result contains Layer 1 answer only
- Both fail → Error reported, no vault file created
- Notebook auto-detection fails → use `--director-id` / `--field-id` flags
