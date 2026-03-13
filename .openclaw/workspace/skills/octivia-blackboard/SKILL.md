---
name: octivia-blackboard
description: Publish events to Octiv's Redis Blackboard (pub/sub message bus). Use when you need to notify the development team of ideas, trigger NotebookLM queries, or signal Google Workspace actions.
user-invocable: false
---

# Octivia Blackboard Bridge

The Octiv system uses a Redis Blackboard at `localhost:6380` (or `BLACKBOARD_REDIS_URL`) for inter-agent communication. Use this skill to publish events from Telegram conversations to the development pipeline.

## Available Channels

| Channel | Purpose | Payload |
|---------|---------|---------|
| `telegram:idea` | New user idea received | `{ author, text, chatId, timestamp }` |
| `vibe:golden` | Completed vibe spec ready | `{ author, spec, chatId, idea, notes, timestamp }` |
| `octivia:build-brief` | BMAD brief compiled and saved | `{ author, brief, chatId, timestamp }` |
| `notebooklm:query` | Query NotebookLM knowledge base | `{ question, context: { chatId, author } }` |
| `google:task` | Google Workspace action | `{ action: 'create_doc', description, context: { chatId, author } }` |

## How to Publish

Use bash to publish via redis-cli:

```bash
redis-cli -p 6380 PUBLISH telegram:idea '{"author":"tony","text":"new idea","chatId":123,"timestamp":"2026-03-12T00:00:00Z"}'
```

Or via Node.js in a tool call — the Blackboard is available at `BLACKBOARD_REDIS_URL` (default: `redis://localhost:6380`).

## Notes

- The Blackboard uses Redis pub/sub on port 6380 (Docker maps 6379→6380)
- Responses from NotebookLM arrive on `notebooklm:answer` channel
- Google Workspace responses arrive on `google:finished` channel
- All payloads are JSON strings
