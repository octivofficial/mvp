# /ingest — 24k Knowledge Pipeline

Parse the subcommand from: $ARGUMENTS

## Subcommands

### `url <URL> [question]`
Full pipeline: fetch URL → extract text → upload to NotebookLM → cascade refine → wikilink auto-wire → vault save.

```bash
cd ~/.claude/skills/notebooklm
.venv/bin/python scripts/run.py knowledge_pipeline.py --url "<URL>" --question "<question>"
```

If no question provided, run ingest-only:
```bash
.venv/bin/python scripts/run.py knowledge_pipeline.py --url "<URL>" --ingest-only
```

### `urls <file> [question]`
Batch ingest from a URL list file (one URL per line).

```bash
cd ~/.claude/skills/notebooklm
.venv/bin/python scripts/run.py knowledge_pipeline.py --urls "<file>" --question "<question>"
```

### `fetch <URL>`
Extract only — fetch URL, show extracted text, no upload.

```bash
cd ~/.claude/skills/notebooklm
.venv/bin/python scripts/run.py web_ingest.py --url "<URL>"
```

### `wire <file>`
Auto-wire wikilinks in a vault markdown file.

```bash
cd ~/.claude/skills/notebooklm
.venv/bin/python scripts/run.py wikilink_wirer.py --file "<file>"
```

### `wire-dry <file>`
Preview wikilink changes without modifying the file.

```bash
cd ~/.claude/skills/notebooklm
.venv/bin/python scripts/run.py wikilink_wirer.py --file "<file>" --dry-run
```

### `status`
Show pipeline status: vault note count, recent cascade files, NotebookLM notebook list.

Run these in parallel:
1. Count vault notes: `find /Users/octiv/Octiv_MVP/vault -name "*.md" | wc -l`
2. Recent cascades: `ls -lt /Users/octiv/Octiv_MVP/vault/03-Research/NotebookLM/Cascade-*.md 2>/dev/null | head -5`
3. Recent pipeline reports: `ls -lt /Users/octiv/Octiv_MVP/vault/03-Research/NotebookLM/Pipeline-Report-*.md 2>/dev/null | head -3`
4. NotebookLM notebooks: `cd ~/.claude/skills/notebooklm && .venv/bin/python scripts/run.py notebook_manager.py list`

Report results in a summary table.

## Pipeline Architecture
```
Internet (URL)
  ↓ web_ingest.py (Playwright fetch + extract)
  ↓
NotebookLM Sources (1기+2기 parallel upload)
  ↓ add_source.py --all
  ↓
Cascade Query (1기 strategic → 2기 operational)
  ↓ cascade_query.py --save-to-vault
  ↓
Wikilink Auto-Wire (vault index scan → [[link]] inject)
  ↓ wikilink_wirer.py
  ↓
24k Zettelkasten Knowledge Graph (vault/)
```

## Cost
- NotebookLM free tier: 50 queries/day
- Cascade: 2 queries per run (1기 + 2기)
- Source uploads: no query limit (UI automation)
- Full pipeline (url + cascade): 2 queries
