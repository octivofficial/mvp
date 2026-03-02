# Octiv 🎮

> AI Agent Sandbox powered by OpenClaw + PaperMC

## 구조
```
Octiv/
├── server/           # PaperMC 1.21.1 서버 파일
│   ├── paper-1.21.1.jar
│   ├── server.properties  (offline-mode=true, RCON ON)
│   └── eula.txt
├── skills/           # 에이전트 스킬 (symlinks)
├── agent/            # OpenClaw octiv 에이전트 workspace
│   └── SOUL.md
├── config/           # 추가 설정
├── logs/             # 로그
├── SKILL.md          # 에이전트 목표 정의
└── start-server.sh   # 서버 시작 스크립트
```

## 빠른 시작
```bash
# 1. 서버 시작
./start-server.sh

# 2. OpenClaw 에이전트로 실행 (별도 터미널)
openclaw --agent octiv gateway

# 3. RCON으로 서버 확인
# password: octiv_rcon_2026, port: 25575
```

## 스킬
- `mcporter` — Minecraft 봇 제어
- `coding-agent` — 코드 자동화
- `health-monitor` — 상태 모니터링
- (+ 8개 추가 스킬)

## 모델
- Primary: GLM-4.7 / bridge (GPT/Gemini)
- Local: LM Studio (추후 연결)
