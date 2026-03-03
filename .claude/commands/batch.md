# /batch — Run multiple operations in one shot

Execute a batch of common operations. Argument: comma-separated operation names.

## Available Operations

| Op | What it does |
|----|--------------|
| `test` | `npm test` — run all tests |
| `lint` | `node -c` syntax check on all agent/*.js |
| `status` | `git status` + `git log --oneline -3` |
| `redis` | `redis-cli -p 6380 ping` + key count |
| `docker` | `docker ps` + `docker compose logs --tail=5` |
| `ac` | Show AC progress from Redis |
| `health` | redis + docker + git status combined |
| `diff` | `git diff --stat` |
| `push` | `git add -A && git commit && git push` (asks for message) |
| `memory` | Show MEMORY.md summary + session-log tail |

## Usage Examples

```
/batch test,lint,status
/batch health
/batch test,diff,push
```

## Execution Rules

1. Run all ops in parallel where possible (independent ops)
2. Report results in a summary table
3. If any op fails, continue others and report failures at end
4. For `push`: always ask for commit message before executing

## Implementation

When this command is invoked:
1. Parse the argument as comma-separated operation names
2. For each operation, run the corresponding command
3. Collect all results
4. Present as a summary table: | Op | Status | Output |
