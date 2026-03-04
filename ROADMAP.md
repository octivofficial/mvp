# Octiv Project Roadmap
> **Goal**: Complete a sandbox where an AI agent team autonomously survives, builds, and manages resources on a PaperMC Minecraft server.
>
> **Spirit**: Truth, Goodness, Beauty, Serenity, Eternity
>
> **Date**: 2026-03-03 | **Lead Dev**: Claude | **Commander**: Octiv

---

## Team

| Role | Owner | Description |
|------|-------|-------------|
| **Commander** | Octiv | Project direction, NotebookLM resource management |
| **Lead Developer** | Claude (Cowork) | Code, architecture, debugging, roadmap |
| **Dev Environment B** | Anti-Gravity (Google IDE + Gemini) | Parallel dev, NotebookLM integration |
| **Agent Framework** | OpenClaw | Agent runtime, skill system, LLM bridge |

---

## Current Status (Phase 1-6 Complete, Phase 7 In Progress)

### Phase 1 Deliverables
- [x] Project structure (agent/, skills/, config/, logs/)
- [x] Docker Compose (Redis + PaperMC)
- [x] Blackboard module (Redis Pub/Sub shared memory)
- [x] OctivBot base class (spawn, health, heartbeat, exponential backoff)
- [x] Team orchestrator (Leader + Builder x3 + Safety)
- [x] Leader (mode decision, voting, Group Reflexion stub)
- [x] Builder (AC-1 wood collection, AC-3 tool crafting, ReAct loop)
- [x] Safety (AC-8 threat detection, vm2 sandbox validation)
- [x] CI/CD (GitHub Actions, npm test on push)
- [x] 13 Claude agents, 11 skills, 3 MCP servers, 3 hooks
- [x] first-day-survival v1.3.1 skill definition (BMAD format)

---

## Phase 2 — Core Gameplay
> Goal: Complete AC-1 through AC-4 + MCP layer + pathfinding

### 2.1 AC-1: Wood Collection (16 logs) — DONE
- builder.js `collectWood()` with multiple wood types (oak, spruce, birch, jungle)
- 60s timeout + trigger Reflexion on failure
- Files: `agent/builder.js`, `test/bot.test.js`

### 2.2 AC-2: Shelter Construction (3x3x3+) — DONE
- Block placement algorithm (site selection → floor → walls → roof)
- Y-level safety check (flat ground, avoid water/lava)
- Door placement + torch lighting
- Must complete within 10 Minecraft minutes (survival mode)
- Publish `octiv:builder:shelter` with coordinates to Blackboard
- **Acceptance Test**:
  - [x] `buildShelter()` in `agent/builder.js`
  - [x] 3x3x3 hollow structure with door opening
  - [x] Uses wood planks (crafted from collected logs)
  - [x] AC-2 status published to Blackboard
  - [x] `npm test` passes with shelter test
- Files: `agent/builder.js`, `test/bot.test.js`

### 2.3 AC-3: Tool Crafting — DONE
- builder.js `craftBasicTools()` (inventory check → crafting table → craft)
- Auto-collect loop when materials insufficient
- Files: `agent/builder.js`

### 2.4 AC-4: Agent Gathering
- Share shelter coordinates via Blackboard (`octiv:builder:shelter`)
- All agents pathfind to shelter + arrival verification
- 1200 tick timer implementation
- **Acceptance Test**:
  - [x] All 5 agents within 3 blocks of shelter
  - [x] Verified via Blackboard `octiv:team:gathered`
  - [x] Completes before 1200 ticks
- Files: `agent/team.js`, `agent/builder.js`

### 2.5 MCP Tool Server (NEW — from TXT 1.md US3)
- `agent/mcp-server.js`: JSON-RPC 2.0 (`/mcp` POST endpoint)
- Tools: `getStatus`, `moveTo`, `chopTree`, `inventory`
- Blackboard <-> MCP context real-time sync
- **Acceptance Test**:
  - [x] JSON-RPC 2.0 request/response working
  - [x] All 4 tools callable and return valid results
  - [x] Blackboard state reflected in MCP context
- Files: `agent/mcp-server.js`, `test/mcp.test.js`

### 2.6 Pathfinder Integration (NEW — from TXT 1.md US1)
- `bot.loadPlugin(pathfinder)` + Movements configuration
- GoalNear/GoalBlock for tree approach
- **Acceptance Test**:
  - [x] Bot navigates to target within 50 blocks in <30s
  - [x] Handles obstacles (water, lava, cliffs)
- Files: `agent/OctivBot.js`

### 2.7 CollectBlock Integration (NEW — from TXT 1.md US2)
- `mineflayer-collectblock` + tool plugin
- Auto-equip best axe from inventory
- Publish collection progress to Blackboard in real-time
- **Acceptance Test**:
  - [x] Collects specified block type within radius
  - [x] Auto-equips appropriate tool
  - [x] Progress published to `octiv:builder:collecting`
- Files: `agent/builder.js`, `package.json`

### Milestone
```
Builder collects 16 wood (within 60s)
3x3x3 shelter auto-built
Crafting table + wooden pickaxe crafted
All agents gathered in shelter (verified via Blackboard)
MCP Tool Server responds to JSON-RPC calls
Pathfinder navigates 50 blocks in <30s
```

---

## Phase 3 — Team Orchestration
> Goal: Real communication and role coordination between Leader-Builder-Safety + Multi-Agent MCP

### 3.1 Leader <-> Builder Integration
- Leader distributes missions → Builder receives → executes
- Training Mode / Creative Mode switch logic working
- Voting system (2/3 majority) implemented

### 3.2 Safety Real-Time Monitoring
- Safety Agent monitors all Builder states via Blackboard
- AC-8 threat detected → immediate warning broadcast
- vm2 validation pipeline working

### 3.3 Group Reflexion
- 3 consecutive failures → Leader forces Group Reflexion
- Reflexion result → team-wide strategy update
- Reflexion history saved (Blackboard + memory.md)

### 3.4 Multi-Agent MCP Orchestrator (NEW — from TXT 1.md US4-7)
- `agent/mcp-orchestrator.js`: Agent Registry (Redis)
- Tools: `assignTask`, `getAllAgents`, `broadcastCommand`
- Blackboard-based Task Routing
- **Acceptance Test**:
  - [x] Register/deregister agents dynamically
  - [x] Assign task to specific agent via MCP
  - [x] Broadcast command reaches all active agents
- Files: `agent/mcp-orchestrator.js`, `test/multi-mcp.test.js`

### 3.5 Role-Based Agent System (NEW — from TXT 3.md)
- `agent/roles/WoodcutterAgent.js` — extends OctivBot, specialized wood gathering
- `agent/roles/BuilderAgent.js` — extends OctivBot, specialized construction
- `agent/roles/ExplorerAgent.js` — extends OctivBot, specialized scouting
- Role registry in Redis: `octiv:agents:registry`
- **Acceptance Test**:
  - [x] Each role agent has specialized behavior
  - [x] Registered in Redis with role metadata
  - [x] Discoverable via `getAllAgents` MCP tool
- Files: `agent/roles/*.js`

### 3.6 Blackboard <-> MCP Sync (NEW — from TXT 1.md US4)
- `agent:{id}:status` → MCP context auto-sync
- MCP Tool Call → Blackboard publish bidirectional
- **Acceptance Test**:
  - [x] Agent status change reflected in MCP within 1s
  - [x] MCP command reflected in Blackboard within 1s

### Milestone
```
Leader switches "training" → "creative" mode
Safety threat detected → team-wide warning within 1s
Group Reflexion executed → strategy change applied
Multi-Agent MCP registers and routes tasks
Role-based agents operate with specialized behaviors
```

---

## Phase 4 — Self-Improvement Engine (AC-5, 6, 8)
> Goal: Automatically generate, validate, and deploy new skills on failure

### 4.1 Self-Improvement Pipeline
- Failure detected → request skill generation from LLM → parse JSON response
- vm2 sandbox 3x dry-run validation
- Blackboard skills:emergency channel broadcast

### 4.2 Dynamic Skill Library Management
- Store/retrieve skills in Redis (Blackboard.saveSkill/getSkill)
- Real-time skill success_rate updates
- Daily limit of 5 + discard if estimated_success_rate < 0.7

### 4.3 LLM Bridge Connection
- bridge:8765 endpoint integration
- Cost guardrail ($0.01/attempt)
- Fallback: use existing safe skill if LLM fails

### 4.4 Dynamic System Prompt Injection (AC-6)
- Group Reflexion result → inject "[Learned Skill v1.3]"
- Real-time system prompt update for all agents

### 4.5 ReflexionEngine (NEW — from TXT 2.md)
- `agent/ReflexionEngine.js`: Anthropic SDK (`@anthropic-ai/sdk`)
- Redis config auto-reload (`octiv:config:llm`)
- Dynamic model switching (Sonnet 4.6 default, Opus 4.6 escalation)
- **Acceptance Test**:
  - [x] Generates valid skill JSON from failure context
  - [x] Switches model tier based on failure severity
  - [x] Config changes via Redis applied without restart
- Files: `agent/ReflexionEngine.js`, `test/reflexion.test.js`

### 4.6 Multi-LLM Router (NEW — from TXT 2.md)
- LiteLLM integration: Claude → Groq Qwen3-Coder fallback
- Cost optimization: Claude=accuracy, Groq=speed
- `.env`: `ANTHROPIC_API_KEY`, `GROQ_API_KEY`
- **Acceptance Test**:
  - [x] Routes to Claude by default
  - [x] Falls back to Groq on Claude failure/timeout
  - [x] Cost per call tracked and enforced

### 4.7 OpenClaw MCP Config Tool (NEW — from TXT 2.md)
- `setLLMConfig` Tool: model, temperature, max_tokens real-time change
- Redis `octiv:config:llm` key for persistent storage
- **Acceptance Test**:
  - [x] Config change via MCP reflected immediately
  - [x] Persists across agent restarts via Redis

### Milestone
```
Lava death → evacuate_lava_v1 skill auto-generated
vm2 validation passes → skills:emergency broadcast
New skill used immediately in next ReAct loop
ReflexionEngine switches models based on failure severity
Multi-LLM Router falls back gracefully
```

---

## Phase 5 — Knowledge Bridge + Discord
> Goal: Connect NotebookLM via MCP, enable Claude <-> Anti-Gravity collaboration, Discord real-time monitoring

### 5.1 NotebookLM <-> MCP Integration
- NotebookLM MCP server setup (using existing notebooklm tool)
- Search technical docs/strategy from notebook → reflect in agent behavior
- Auto-sync project progress to NotebookLM

### 5.2 Claude <-> Anti-Gravity Collaboration Protocol
- Shared codebase: Git-based sync
- File ownership rules documented
- Unified commit convention (emoji + English description)

### 5.3 Gemini Skill Integration
- Gemini API connection for fast Q&A, summarization
- Cost optimization (Gemini = fast tasks, Claude = complex reasoning)

### 5.4 Discord Bot Integration (NEW)
- `agent/discord-bot.js`: discord.js v14
- **Channels**:
  - `#octiv-status` — real-time team status (embeds)
  - `#octiv-alerts` — threats, failures, reflexion alerts (@here)
  - `#octiv-commands` — bot commands
- **Blackboard → Discord Bridge**:
  - Subscribe `octiv:*:status` → Discord status embed
  - Safety threat → Discord immediate alert
  - AC completion → Discord auto-report
- **Commands**: `!status`, `!assign <agent> <task>`, `!reflexion`, `!team`
- **Acceptance Test**:
  - [x] Bot connects to Discord and joins guild
  - [x] Blackboard status changes appear in #octiv-status
  - [x] Safety threats trigger @here alert in #octiv-alerts
  - [x] `!status` returns current team state
- Files: `agent/discord-bot.js`, `config/discord.json`, `test/discord.test.js`
- Dependencies: `discord.js@14`

### Milestone
```
Search "optimal wood collection strategy" in NotebookLM → result returned
Code written by Claude → available in Anti-Gravity immediately via Git
Discord bot posts real-time agent status
Safety alert → Discord @here notification within 2s
!status command returns team state embed
```

---

## Phase 6 — Monitoring & Dashboard (Observability)
> Goal: Commander can monitor team status in real time

### 6.1 HEARTBEAT Dashboard
- Web-based real-time dashboard (React or HTML)
- Per-agent position, health, inventory, AC progress display
- Mission timeline visualization

### 6.2 Logging & Alerts
- Structured log system (using logs/ directory)
- Threat events → commander alert (Discord/channel)
- Daily mission report auto-generation

### 6.3 Memory System (AC-7)
- Automatic memory.md logging
- Daily notes (memory/YYYY-MM-DD.md)
- MEMORY.md long-term memory curation

### 6.4 Explorer System (NEW — from TXT 3.md Phase 6)
- `agent/roles/ExplorerAgent.js`: spiral search + danger avoidance
- mineflayer-map + custom pathfinding
- Blackboard world map real-time sharing
- 200-block radius exploration
- **Acceptance Test**:
  - [x] Explores in expanding spiral pattern
  - [x] Avoids lava/water/cliff hazards
  - [x] Shares discovered locations via Blackboard
- Files: `agent/roles/ExplorerAgent.js`

### Milestone
```
http://localhost:3000 in browser → dashboard displayed
Safety warning → Discord alert within 1s
Mission ends → auto-recorded to memory.md
Explorer maps 200-block radius without dying
```

---

## Phase 7 — Scale & Extend (7.4 Complete, others Not Started)
> Goal: Build a long-term operations framework beyond first-night survival

### 7.1 Mission Expansion
- [ ] Week 2: Ore mining + stone tool upgrade
- [ ] Week 3: Farm automation + food self-sufficiency
- [ ] Week 4: Ender Dragon strategy planning

### 7.2 Agent Enhancement
- [ ] Expand agent count (Builder 3→5+)
- [ ] Role specialization (farmer, miner, explorer, architect)
- [ ] Natural language negotiation between agents (LLM-based)

### 7.3 Infrastructure Expansion
- [ ] LM Studio local model integration (cost reduction)
- [ ] Multi-server support
- [ ] Plugin system (KubeJS integration)

### 7.4 Redis Pipeline Optimization (NEW — from TXT 4.md)
- `redis.multi().exec()` batch processing (77% latency reduction)
- Lua Script embedded Pipeline (atomicity guarantee)
- WATCH + Optimistic Locking for concurrent updates
- **Acceptance Test**:
  - [x] Batch operations use MULTI/EXEC
  - [x] WATCH + optimistic locking for atomic read-modify-write
  - [x] Concurrent updates resolved via optimistic locking
- Files: `agent/blackboard.js`

### 7.5 Redis Cluster (NEW — from TXT 4.md, when needed)
- ioredis Cluster client (Hash Slot, Auto Failover)
- Exponential Backoff + Full Jitter reconnection
- Production transition only (current single-node maintained)
- **Acceptance Test**:
  - [ ] Cluster client connects to 3+ nodes
  - [ ] Failover completes within 5s
  - [ ] Reconnection with full jitter avoids thundering herd

---

## Schedule

| Phase | Name | Duration | Prerequisites |
|-------|------|----------|---------------|
| **1** | Foundation | Done | Docker, Node.js environment |
| **2** | Core Gameplay | 3-5 days | Phase 1 complete |
| **3** | Team Orchestration | 3-5 days | Phase 2 complete |
| **4** | Self-Improvement | 5-7 days | Phase 3 + LLM bridge |
| **5** | Knowledge Bridge + Discord | 3-5 days | NotebookLM resources ready |
| **6** | Monitoring | 3-5 days | Can run parallel after Phase 3 |
| **7** | Scale & Extend | Ongoing | After Phase 4 complete |

---

## Working Principles

1. **Session start**: Read ROADMAP.md + recent git log → identify current Phase
2. **Commit convention**: `emoji Phase-N: English description`
3. **Test first**: Write tests before implementing new features
4. **Cost awareness**: Always enforce cost guardrails on LLM calls
5. **Report duty**: Report status to commander when a Phase is complete

---

> _"Read accurately, act safely, build beautifully, report peacefully, sustain eternally."_
