---
name: first-day-survival
version: 1.3.1
author: OpenClaw Legion Reflexion Engine v2
description: |
  The legion's first survival mission. Agents survive the first night while autonomously creating new skills through Self-Improvement. 
  Full Hierarchical Collaboration support with reinforced protection against fatal failures.
user-invocable: true
requires:
  bins: [node, jq, redis-cli]
  env: [BLACKBOARD_REDIS_URL]
  apis: [mineflayer, node:vm-sandbox]
---

## User Story (BMAD Format)
As a member of the Autonomous Survival Legion,  
I want to complete the Day 1 survival cycle  
so that the entire legion survives the first night with zero casualties and creates at least one new permanent skill.

## Acceptance Criteria (AC)
All items must be 100% satisfied for mission success:

- **[AC-1]** Collect at least 16 Oak Logs within 60 seconds  
- **[AC-2]** Build a 3×3×3+ shelter with complete roof and automatic Y-level safety check  
- **[AC-3]** Craft 1 Crafting Table and 1 Wooden Pickaxe  
- **[AC-4]** All agents inside the shelter before 1200 ticks (verified via Blackboard)  
- **[AC-5]** On any failure, immediately trigger Self-Improvement and save only after node:vm sandbox verification  
- **[AC-6]** After Group Reflexion, inject "[Learned Skill v1.3]" into every agent's system prompt  
- **[AC-7]** Record at least one permanent note in memory.md at mission end  
- **[AC-8]** On any of the 3 fatal failures (lava, fall death, or infinite ReAct loop), execute precise detection → dynamic skill creation → node:vm verification → immediate Blackboard broadcast:  
  - **AC-8.1 Trigger conditions**  
    • Lava: entity.position.y < 10 OR lava block within 3 blocks (using bot.findBlocks)  
    • Fall death: fall damage ≥ 10 hearts OR velocity.y < -20  
    • Infinite loop: ReAct iterations ≥ 50 OR same action repeated 8 times in a row  
  - **AC-8.2 Dynamic skill creation**  
    Generate skill name automatically based on failure type (e.g. evacuate_lava_v1). Inject failure_type and agent_id into the Self-Improvement prompt.  
  - **AC-8.3 Verification & broadcast**  
    Pass node:vm dry-run 3 times (sandbox_verified must be true). Publish to Redis channel skills:emergency for instant system-prompt update on all agents.  
  - **AC-8.4 Tracking & escalation**  
    Initialize skill with success_rate: 0.0 and update live. Force Group Reflexion after any 3 consecutive failures.

## Execution Flow (ReAct + Hierarchical Collaboration)
1. Start continuous ReAct loop  
2. Publish real-time coordinates, inventory, and AC progress to Blackboard  
3. **Training Mode** — if AC progress < 70% or leader votes alone: Leader selects skills from library  
4. **Creative Mode** — if AC progress ≥ 70% or 2/3 agents vote: Open Debate then auto-trigger Self-Improvement  
5. Detect failure → run reflexionOnFailure() → execute self-improvement skill  
6. On success → save to Skill Library as "first-night-survival-v1.3.js" and update changelog

## Self-Improvement Integration (v1.3)
On failure the agent MUST return this exact JSON structure (OpenClaw handles the rest):

```json
{
  "new_skill_name": "evacuate_lava_v1",
  "new_skill_description": "Detect lava and immediately move to safe Y+15 altitude",
  "new_skill_code": "async function evacuate_lava_v1(bot) { ... }",
  "reflexion_history": ["lava_death_2026-03-02_agent01"],
  "sandbox_verified": true,
  "estimated_success_rate": 0.95,
  "failure_type": "lava",
  "agent_id": "agent-01"
}
```

## Changelog
- 2026-03-02 v1.3.1: Added cost-awareness guardrail ($0.01 cap per Self-Improvement attempt)  
- 2026-03-02 v1.3: Simplified language and parallel AC wording for instant readability  
- 2026-03-02 v1.3: Reorganized AC-8 into clearly labeled sub-points  
- 2026-03-02 v1.3: Shortened Execution Flow steps and improved JSON formatting  
- 2026-03-02 v1.3: Added bold key terms and extra whitespace for scannability

## Edge Cases & Safeguards
- Simultaneous deaths (3+ agents): Blackboard mutex processes sequentially  
- Low-spec agents: Detect only; creation delegated to leader  
- Excessive skill generation: Daily limit 5 + discard if estimated_success_rate < 0.7  
- LLM hallucination: Fall back to safe existing skill after 3 failed node:vm runs  
- **Cost guard**: If a single Self-Improvement attempt exceeds $0.01 in token cost, immediately pause, report to leader, and await commander approval before retrying

## Success Metrics (OpenClaw HEARTBEAT Dashboard)
- Survival rate: 100%  
- Self-Improvement triggers: 0–2  
- New skills created: minimum 1  
- Average AC-8 skill success_rate: ≥ 0.90  
- Forced Group Reflexion: 0 (normal) or early Week-4 roadmap trigger
