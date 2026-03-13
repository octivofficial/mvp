---
name: octivia-notebook
description: Query the Octiv NotebookLM knowledge bases (1기 Roadmap + 2기 OpenClaw Phase 2). Returns Gemini-sourced, citation-backed answers. Triggered by /notebook command.
user-invocable: true
---

# /notebook — NotebookLM Query

Query Octiv's NotebookLM knowledge bases for source-grounded answers.

## Notebooks

| Name | ID | Role |
|------|-----|------|
| **1기** Octiv Project Roadmap | `ae1281fe-6370-493f-a1bd-afed03263a88` | Director — blueprints, roadmap, architecture |
| **2기** OpenClaw Phase 2 | `4f8bd626-c548-454a-b36b-fb080d335530` | Field deployment planning |

## Usage

```
/notebook What is the current project status and next priorities?
/notebook How does the Redis Blackboard pub/sub pattern work?
/notebook What are the key lessons from recent test failures?
```

## Query Method

Use the cascade query script at `/Users/octiv/Octiv_MVP/scripts/cascade_query.py`:

```bash
python ~/.claude/skills/notebooklm/.venv/bin/python \
  ~/.claude/skills/notebooklm/scripts/ask_question.py \
  --notebook-id ae1281fe-6370-493f-a1bd-afed03263a88 \
  --question "YOUR_QUESTION"
```

Or publish to Blackboard and wait for response:

```bash
redis-cli -p 6380 PUBLISH notebooklm:query '{"question":"YOUR_QUESTION","context":{"chatId":123}}'
```

## Response Format

Return: "📚 NotebookLM:\n\n[answer]"

If the query service is unavailable: "NotebookLM is not available right now. 나중에 다시 해봐요."
