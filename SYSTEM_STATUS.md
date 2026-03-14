# Octiv System Status
**Updated**: 2026-03-14 KST  
**Status**: 🟢 ALL SYSTEMS OPERATIONAL

---

## 🌐 Access URLs

### Web Dashboard
- **URL**: http://localhost:3000
- **Purpose**: Real-time agent monitoring, health, inventory, skill lab
- **Features**: 
  - Live agent status (health, food, position, tasks)
  - SSE streams for real-time updates
  - Skill Zettelkasten visualization
  - Event log (last 100 events)

### Discord Server
- **Server**: NeoStarz (Guild ID: 1478342949942333470)
- **Bot**: octiv#1056
- **Channels**:
  - `#neostarz-live` - Real-time agent activity (health, movement, actions)
  - `#neostarz-alerts` - Threats, failures, reflexion, GoT events
  - `#neostarz-commands` - Bot command interface
  - `#neostarz-voice` - Voice channel + agent chat
  - `#meta-shinmoongo` - Forum for agent confessions

### Obsidian Vault
- **Location**: `/Users/octiv/Octiv_MVP/vault/`
- **Live Data**: `vault/05-Live/` (auto-updated via REST API)
- **Skills**: `vault/04-Skills/` (Zettelkasten notes)
- **API Port**: 27124 (Local REST API)

### Minecraft Server
- **Address**: localhost:25565
- **Version**: PaperMC 1.21.11
- **Mode**: Offline (no authentication)
- **RCON**: localhost:25575 (password: changeme)
- **World**: octiv-world

### Redis Blackboard
- **URL**: redis://localhost:6380
- **Purpose**: Shared memory for agent coordination
- **Keys**: `octiv:*` (agent status, missions, chat, etc.)

---

## 🤖 Running Services

| Service | Process ID | Port | Status | Purpose |
|---------|-----------|------|--------|---------|
| PaperMC Server | Terminal 7 | 25565 | 🟢 Running | Minecraft game server |
| Agent Team | Terminal 9 | - | 🟢 Running | Multi-agent orchestrator (5 builders + leader + safety + explorer + miner + farmer) |
| Web Dashboard | Terminal 10 | 3000 | 🟢 Running | Real-time monitoring UI |
| Discord Bot | Terminal 11 | - | 🟢 Running | Discord integration & commands |
| Obsidian Bridge | Terminal 12 | 27124 | 🟢 Running | Vault sync via REST API |
| Redis | System | 6380 | 🟢 Running | Blackboard coordination |

---

## 👥 Active Agents

### Team Composition
- **Leader**: leader-01 (training mode 50%)
- **Builders**: builder-01, builder-02, builder-03, builder-04, builder-05
- **Safety**: safety-01 (AC-8 monitoring)
- **Explorer**: explorer-01 (max radius: 200 blocks)
- **Miner**: miner-01 (specialist role)
- **Farmer**: farmer-01 (specialist role)

### Current Mission
- **AC-1**: Wood Collection (16 logs target)
- **Status**: In progress (agents searching for trees)
- **Training Progress**: 50%

---

## 🎮 Discord Commands

Connect to Discord and use these commands in `#neostarz-commands`:

```
!help              - Show all available commands
!status            - Current team state (HP, tasks, positions)
!team              - List all agents and roles
!assign <agent> <task> - Assign task to specific agent
!reflexion         - Trigger group reflexion cycle
!rc <subcmd>       - Remote control (status, test, ac, log, agents)
!confess <msg>     - Post to Shinmungo forum
!voice <subcmd>    - Voice control (join, leave, say, mute, status)
```

---

## 📊 Monitoring Workflow

### 1. Real-Time Web Dashboard
```bash
# Open in browser
open http://localhost:3000
```
- View live agent health, food, position
- Monitor inventory and resource collection
- Track skill learning and XP progression
- See event stream (last 100 events)

### 2. Discord Monitoring
- Join Discord server (NeoStarz)
- Watch `#neostarz-live` for real-time updates
- Get alerts in `#neostarz-alerts` for threats/failures
- Use commands in `#neostarz-commands`
- Listen to voice channel for TTS announcements

### 3. Obsidian Vault
```bash
# Open vault in Obsidian
open vault/
```
- Live agent data: `05-Live/agents/*.md`
- System vitals: `05-Live/system.md`
- Event log: `05-Live/events.md`
- Skills: `04-Skills/atomic/*.md`, `04-Skills/compound/*.md`
- GoT traces: `05-Live/got-traces.md`

### 4. Redis Blackboard
```bash
# Check team status
redis-cli -p 6380 hgetall octiv:team:status:latest

# List all agent keys
redis-cli -p 6380 keys "octiv:agent:*"

# Get specific agent status
redis-cli -p 6380 get octiv:agent:builder-01:status:latest
```

---

## 🔄 System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     User Interfaces                          │
├─────────────────────────────────────────────────────────────┤
│  Web Dashboard  │  Discord Bot  │  Obsidian Vault           │
│  (port 3000)    │  (octiv#1056) │  (REST API 27124)         │
└────────┬────────┴───────┬───────┴──────────┬────────────────┘
         │                │                   │
         └────────────────┼───────────────────┘
                          │
                ┌─────────▼─────────┐
                │  Redis Blackboard  │
                │   (port 6380)      │
                └─────────┬─────────┘
                          │
         ┌────────────────┼────────────────┐
         │                │                │
    ┌────▼────┐     ┌────▼────┐     ┌────▼────┐
    │ Leader  │     │Builders │     │ Safety  │
    │ Agent   │     │ (x5)    │     │ Agent   │
    └────┬────┘     └────┬────┘     └────┬────┘
         │               │               │
         └───────────────┼───────────────┘
                         │
                ┌────────▼────────┐
                │  PaperMC Server │
                │  (port 25565)   │
                └─────────────────┘
```

---

## 🧠 Learning Pipeline

```
Agent Experience
      ↓
ReflexionEngine (Claude Haiku)
      ↓
SkillPipeline (daily: 0/5)
      ↓
Zettelkasten (vault/04-Skills/)
      ↓
RuminationEngine (cycle: 300s)
      ↓
GoTReasoner (synergy detection)
      ↓
ZettelkastenHooks (auto-wiring)
```

**Current Status**:
- Rumination digestion #12: 32 experiences
- Skills learned: 0 (waiting for failures to trigger learning)
- Zettelkasten vault initialized

---

## 📈 Next Steps

### Immediate (Next 10 minutes)
1. Monitor AC-1 wood collection progress via dashboard
2. Check Discord `#neostarz-live` for agent updates
3. Verify agents are finding trees and collecting wood
4. Watch for pathfinding timeout issues

### Short-term (Next 30 minutes)
1. Wait for AC-1 completion (16 logs collected)
2. Monitor AC-2 shelter construction start
3. Track agent coordination via Blackboard
4. Observe skill learning from failures

### Medium-term (Next 2 hours)
1. Complete AC-1 through AC-4 (first-day survival)
2. Verify all agents gather at shelter
3. Review learned skills in Zettelkasten
4. Analyze rumination cycles and GoT reasoning

---

## 🛠️ Troubleshooting

### If Dashboard not loading
```bash
# Check if process is running
curl http://localhost:3000

# Restart dashboard
# (Stop Terminal 10 and restart)
node --env-file-if-exists=.env agent/dashboard.js
```

### If Discord bot offline
```bash
# Check Discord bot logs
# Terminal 11 should show "logged in as octiv#1056"

# Verify token in .env
grep DISCORD_TOKEN .env
```

### If Obsidian not syncing
```bash
# Check Obsidian Bridge logs
# Terminal 12 should show "started { port: 27124 }"

# Verify API key
grep OBSIDIAN_API_KEY .env

# Check vault directory exists
ls -la vault/05-Live/
```

### If agents stuck
```bash
# Check Redis connection
redis-cli -p 6380 ping

# Check agent status
redis-cli -p 6380 keys "octiv:agent:*:status"

# Trigger reflexion via Discord
# In #neostarz-commands: !reflexion
```

---

## 📝 Logs Location

- **Agent logs**: Console output (Terminal 9)
- **Server logs**: `server/logs/latest.log`
- **Memory logs**: `agent/memory/2026-03-11.md`
- **Event logs**: Redis Blackboard + Obsidian `05-Live/events.md`

---

**System Health**: ✅ All systems operational  
**Mission Status**: 🟡 AC-1 in progress (wood collection)  
**Team Morale**: 🟢 High (training mode 50%)

