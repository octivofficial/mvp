# Octiv 🎮

> AI Agent Sandbox powered by OpenClaw + PaperMC

## Recent Updates

### Connection Stability Fix (2026-03-11)
- Fixed keepalive timeout issue causing agents to disconnect after 30 seconds
- Increased `checkTimeoutInterval` to 60 seconds for better PaperMC 1.21.11 compatibility
- Enabled explicit keepalive packets for stable long-running agent connections

## Structure
```
Octiv/
├── server/           # PaperMC 1.21.1 server files
│   ├── paper-1.21.1.jar
│   ├── server.properties  (offline-mode=true, RCON ON)
│   └── eula.txt
├── skills/           # Agent skills (symlinks)
├── agent/            # OpenClaw octiv agent workspace
│   └── SOUL.md
├── config/           # Additional configuration
├── logs/             # Logs
├── SKILL.md          # Agent goal definitions
└── start-server.sh   # Server start script
```

## Quick Start
```bash
# 1. Start the server
./start-server.sh

# 2. Run OpenClaw agent (separate terminal)
openclaw --agent octiv gateway

# 3. Verify via RCON
# password: <RCON_PASSWORD> (set in .env), port: 25575
```

## Skills
- `mcporter` — Minecraft bot control
- `coding-agent` — Code automation
- `health-monitor` — Status monitoring
- (+ 8 additional skills)

## Models
- Primary: GLM-4.7 / bridge (GPT/Gemini)
- Local: LM Studio (future integration)
