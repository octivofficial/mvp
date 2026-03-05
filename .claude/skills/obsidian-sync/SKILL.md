---
name: obsidian-sync
description: Obsidian vault sync and management for the Octiv command center. Keeps Dashboard.md and Session-Sync.md current, manages reasoning traces, and stores NotebookLM knowledge.
---

# Obsidian Sync Skill

## When to Use
- Session start: verify vault state matches reality
- Session end: sync Dashboard.md and Session-Sync.md
- After major milestone: update Roadmap, Architecture notes
- When querying NotebookLM: save responses to vault
- When reasoning traces accumulate: cleanup stale files

## Vault Location
`/Users/octiv/Octiv_MVP/vault/` (gitignored, local only)

## Commands

### `vault-status`
Check vault health:
1. Count files in `vault/04-Skills/reasoning/` (should be <= 5)
2. Read `vault/Dashboard.md` test count — compare with `npm test`
3. Read `vault/Session-Sync.md` — check for stale dates
4. Report any mismatches

### `vault-sync`
Force-sync Dashboard + Session-Sync:
1. Run `npm test 2>&1 | grep -E 'tests|pass|fail' | tail -1`
2. Run `git log --oneline -1`
3. Use `agent/vault-sync.js` helpers: `syncDashboard(stats)`, `syncSessionState(session)`
4. Or manually update the markdown tables with regex patterns

### `vault-query <topic>`
Query NotebookLM and save to vault:
1. Run `ask_question.py --notebook-id <id> --question "<topic>"`
2. Format response as markdown with YAML frontmatter
3. Save to `vault/03-Research/NotebookLM/{topic-slug}.md`
4. Add wikilinks to related vault notes

### `vault-cleanup`
Clean stale data:
1. Delete timestamped reasoning files: `rm vault/04-Skills/reasoning/*_2026-*.md`
2. Check for stale notes (session date > 7 days old)
3. Verify Dataview field names match frontmatter (successRate not success_rate)

## Dashboard.md Auto-Update Patterns

The `agent/vault-sync.js` module uses these regex patterns:

### TESTS stat card
```regex
/(>\s*>\s*<div[^>]*>)\d+(<\/div>...)\d+ PASS \| \d+ FAIL \| \d+ SKIP/
```

### Session State table
```regex
/(\|\s*\*\*Last Session\*\*\s*\|)\s*[^|]+\|/
/(\|\s*\*\*Last Commit\*\*\s*\|)\s*[^|]+\|/
/(\|\s*\*\*Test Count\*\*\s*\|)\s*[^|]+\|/
```

### Footer
```regex
/(Last Synced: <strong>)\d{4}-\d{2}-\d{2}(<\/strong> \| )\d+( Tests)/
```

## Dataview Compatibility

Skill vault notes use camelCase frontmatter (from `skill-zettelkasten.js`):
- `successRate` (not `success_rate`)
- `error_type`, `compound_of`, `digest_count` — snake_case (historic)

Dataview queries in `Skill-Dashboard.md` must match these field names exactly.

## NotebookLM Knowledge Note Template

```yaml
---
source: notebooklm
notebook: "1기 Master Blueprint"
query: "How should agents coordinate?"
date: 2026-03-05
tags: [research, agents, coordination]
---

# Agent Coordination

> Gemini response with citations...

## Links
- [[02-Agents/Architecture]]
- [[04-Skills/atomic/buildShelter]]
```
