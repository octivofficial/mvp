# Cost-Aware LLM Pipeline

## Purpose
Optimize API costs through intelligent model routing, prompt caching, and retry strategies.
Directly addresses the ANTHROPIC_API_KEY credit issue causing 3 skipped tests.

## Model Routing Strategy

### Tier Selection
| Task | Model | Cost |
|------|-------|------|
| Simple classification, formatting | haiku | $0.25/MTok |
| Code generation, analysis | sonnet | $3/MTok |
| Complex reasoning, architecture | opus | $15/MTok |

### Decision Flow
```
1. Estimate task complexity (tokens + reasoning depth)
2. Start with cheapest viable model
3. Escalate on failure or insufficient quality
4. Cache successful prompts for reuse
```

## Prompt Caching
- Use `cache_control: { type: "ephemeral" }` for system prompts >1024 tokens
- Cache hit = 90% cost reduction
- Group related API calls to maximize cache window (5-minute TTL)

## Retry Strategy
```
attempt 1: haiku  (if task is simple)
attempt 2: sonnet (if haiku fails or quality insufficient)
attempt 3: opus   (final escalation)
```

- Exponential backoff: 1s, 2s, 4s
- Rate limit: respect `retry-after` header
- Budget cap: set `max_cost_per_call` in config

## Octiv Integration

### `agent/api-clients.js` — `createApiClients()`
```javascript
// Add model routing to existing API client
function selectModel(task) {
  if (task.tokens < 500 && task.type === 'classify') return 'claude-haiku-4-5-20251001';
  if (task.tokens < 4000) return 'claude-sonnet-4-6';
  return 'claude-opus-4-6';
}
```

### Cost Tracking
- Log each API call: `{ model, input_tokens, output_tokens, cost }`
- Daily budget alert at 80% threshold
- Session summary: total calls, total cost, cache hit rate

## Activation
Use this skill when:
- Making LLM API calls in agent code
- Optimizing existing prompts for cost
- Debugging API credit issues
- Planning batch operations that need many LLM calls

## Anti-Patterns
- Never use opus for simple yes/no classification
- Never retry the same model on rate limit (backoff instead)
- Never skip caching for repeated system prompts
- Never hardcode model IDs — use config constants
