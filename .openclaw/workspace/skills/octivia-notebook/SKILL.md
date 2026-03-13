---
name: octivia-notebook
description: Query the Octiv NotebookLM knowledge bases. Returns Gemini-sourced, citation-backed answers. Triggered by /notebook command.
user-invocable: true
---

# /notebook — NotebookLM Query

Query Octiv's NotebookLM knowledge bases for source-grounded answers.

## Notebooks

| Name | ID | Role |
|------|-----|------|
| **1기** Octiv Master Blueprint | `octiv-neostars-alpha---master-blueprint` | Director — blueprints, roadmap, architecture |
| **2기** OpenClaw Phase 2 | `openclaw-phase-2` | Field deployment planning |
| **3기** Tool Research | `tool-research` | Tool comparisons, tech research |

## Usage

```
/notebook What is the current project status and next priorities?
/notebook How does the Redis Blackboard pub/sub pattern work?
/notebook What are the key lessons from recent test failures?
```

## Query Method

```bash
~/.claude/skills/notebooklm/.venv/bin/python \
  ~/.claude/skills/notebooklm/scripts/ask_question.py \
  --notebook-id octiv-neostars-alpha---master-blueprint \
  --question "YOUR_QUESTION"
```

Or via Blackboard:

```bash
redis-cli -p 6380 PUBLISH notebooklm:query '{"question":"YOUR_QUESTION","context":{"chatId":123}}'
```

## Response Format

Return: "📚 NotebookLM:\n\n[answer]"

If unavailable: "NotebookLM is not available right now."
