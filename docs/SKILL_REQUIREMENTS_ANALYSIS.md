# Octiv MVP 스킬 요구사항 분석

## 분석 일시
2026-03-10

## 에이전트 역할별 필요 스킬

### 1. Discord 관련 스킬 (필수)

#### 현재 구현된 기능 (agent/discord-bot.js)
- ✅ Discord.js 기반 봇 (976 lines)
- ✅ 5개 채널 관리 (#neostarz-live, #neostarz-alerts, #neostarz-commands, #neostarz-voice, #meta-shinmoongo)
- ✅ Redis Blackboard ↔ Discord 브리지
- ✅ Embed 생성 (status, health, inventory, alerts, confessions)
- ✅ Voice TTS (VoiceManager 통합)
- ✅ Forum 스레드 생성 (Shinmungo 고백)
- ✅ 명령어 처리 (!help, !status, !assign, !reflexion, !team, !confess, !rc, !voice)
- ✅ Prompt injection 필터링 (SafetyAgent 통합)

#### 필요한 스킬
1. **discord-bot-patterns** (신규 생성 필요)
   - Embed 디자인 패턴
   - Voice TTS 큐 관리
   - Forum 태그 매칭
   - 재연결 로직 (exponential backoff)
   - 명령어 파싱 및 검증

2. **discord-voice-automation** (신규 생성 필요)
   - VoiceManager 패턴
   - TTS 우선순위 큐 (Priority.HIGH/NORMAL/LOW)
   - 음성 채널 join/leave
   - Mute/unmute 토글

3. **discord-forum-management** (신규 생성 필요)
   - Forum 스레드 생성
   - 태그 캐싱 및 매칭
   - 익명 해시 생성 (Shinmungo)
   - 스레드 정리 및 아카이빙

### 2. Obsidian 관련 스킬 (필수)

#### 현재 구현된 기능
- ✅ `.claude/skills/obsidian-sync/SKILL.md` 존재
- ✅ `agent/vault-sync.js` 모듈 (Dashboard.md, Session-Sync.md 동기화)
- ✅ `scripts/vault-sync-cli.js` CLI 도구
- ✅ Dataview 호환 frontmatter (camelCase)
- ✅ NotebookLM 지식 노트 템플릿

#### 필요한 스킬 (강화)
1. **obsidian-vault-operations** (기존 obsidian-sync 확장)
   - Vault 상태 검증 (vault-status)
   - Dashboard.md 자동 업데이트 (regex 패턴)
   - Session-Sync.md 동기화
   - Reasoning trace 정리 (stale file cleanup)
   - Dataview 쿼리 생성

2. **obsidian-notebooklm-integration** (신규 생성 필요)
   - NotebookLM 쿼리 실행
   - 응답을 마크다운으로 변환
   - Wikilink 자동 생성
   - YAML frontmatter 생성

3. **obsidian-dataview-patterns** (신규 생성 필요)
   - Dataview 쿼리 작성 패턴
   - Field name 규칙 (camelCase vs snake_case)
   - 스킬 대시보드 쿼리
   - 에이전트 성과 추적 쿼리

### 3. Minecraft/PaperMC 관련 스킬 (필수)

#### 현재 구현된 기능
- ✅ Mineflayer 기반 봇 (agent/bot.js, agent/builder.js, agent/roles/)
- ✅ Pathfinding (mineflayer-pathfinder)
- ✅ Block placement (bot.placeBlock) — AC-2 incomplete
- ✅ Resource collection (wood, ore, crops)
- ✅ Inventory management
- ✅ Combat (safety threat detection)

#### 필요한 스킬
1. **mineflayer-building-patterns** (신규 생성 필요)
   - 4x4 floor 패턴
   - 3-block wall 패턴
   - Roof 패턴
   - bot.placeBlock() API 사용법
   - Shelter 검증 (isValidShelter)

2. **mineflayer-pathfinding-advanced** (신규 생성 필요)
   - GoalBlock, GoalNear, GoalFollow
   - Movements 설정 (canDig, canPlaceOn)
   - Pathfinding 실패 처리
   - 장애물 회피

3. **mineflayer-resource-collection** (신규 생성 필요)
   - bot.findBlock() 패턴
   - bot.dig() 패턴
   - Inventory 최적화
   - Tool tier 관리 (pickaxe, axe)

4. **papermc-rcon-control** (신규 생성 필요)
   - RCON 명령어 실행
   - 서버 상태 확인
   - 플레이어 관리
   - 월드 백업

### 4. 개발자 워크플로우 스킬 (필수)

#### 현재 구현된 기능
- ✅ `.claude/skills/dev-tool-belt/SKILL.md` 존재
- ✅ `.claude/skills/verify-tests/SKILL.md` 존재
- ✅ `.claude/skills/verification-loop/SKILL.md` 존재
- ✅ `.claude/skills/automated-debugging/SKILL.md` 존재

#### 필요한 스킬 (강화)
1. **tdd-workflow-patterns** (신규 생성 필요)
   - Red-Green-Refactor 사이클
   - Test-first 접근법
   - Property-based testing (fast-check)
   - Test fixture 생성

2. **git-workflow-automation** (신규 생성 필요)
   - Commit message 규칙 (emoji P-N: message)
   - Branch 전략
   - PR 생성 및 리뷰
   - CI/CD 통합

3. **docker-compose-patterns** (기존 docker-patterns 확장)
   - Redis + PaperMC 컨테이너 관리
   - Health check 패턴
   - Volume 관리
   - 로그 모니터링

## 현재 보유 스킬 (26개)

### 검증 및 테스트
- ✅ automated-debugging
- ✅ verify-tests
- ✅ verify-implementation
- ✅ verify-agents
- ✅ verify-dependencies
- ✅ verify-mcp
- ✅ verify-redis
- ✅ verification-loop
- ✅ coverage-audit

### 개발 도구
- ✅ dev-tool-belt
- ✅ docker-patterns
- ✅ first-day-survival
- ✅ tool-index

### 문서 및 동기화
- ✅ doc-sync
- ✅ obsidian-sync

### 아키텍처 및 관리
- ✅ capability-registry
- ✅ manage-skills
- ✅ mcporter
- ✅ autonomous-loops
- ✅ health-monitor
- ✅ stale-detector
- ✅ permission-hygiene
- ✅ search-first
- ✅ browser-recovery
- ✅ cost-aware-llm-pipeline
- ✅ weather (예제)

## 누락된 스킬 (우선순위별)

### 🔴 Critical (즉시 필요)
1. **discord-bot-patterns** — Discord 봇 핵심 패턴
2. **mineflayer-building-patterns** — AC-2 shelter 빌드 (현재 incomplete)
3. **obsidian-vault-operations** — 기존 obsidian-sync 확장

### 🟡 High (단기 필요)
4. **discord-voice-automation** — TTS 및 음성 채널 관리
5. **mineflayer-pathfinding-advanced** — 고급 경로 탐색
6. **tdd-workflow-patterns** — TDD 사이클 자동화

### 🟢 Medium (중기 필요)
7. **discord-forum-management** — Forum 스레드 관리
8. **obsidian-notebooklm-integration** — NotebookLM 통합
9. **mineflayer-resource-collection** — 자원 수집 최적화
10. **papermc-rcon-control** — PaperMC 서버 제어

### 🔵 Low (장기 필요)
11. **obsidian-dataview-patterns** — Dataview 쿼리 패턴
12. **git-workflow-automation** — Git 워크플로우 자동화
13. **docker-compose-patterns** — Docker Compose 패턴 확장

## Anthropics/Skills 저장소 참고 스킬

### Creative & Design
- algorithmic-art (p5.js 생성 예술)
- canvas-design (PNG/PDF 시각 예술)

### Development & Technical
- artifacts-builder (React/Tailwind/shadcn 복합 아티팩트)
- webapp-testing (Playwright UI 검증)
- mcp-builder (MCP 서버 생성 가이드)

### Document Skills
- docx, pdf, pptx, xlsx (문서 생성/편집)

## ClawHub 저장소 참고 스킬

### 확인된 스킬
- obsidian (vault 관리, obsidian-cli 자동화)
- obsidian-sync (Clawdbot 에이전트 ↔ vault 동기화)
- obsidian-plugin-patterns (플러그인 개발 패턴)
- obsidian-ops (vault 운영, 버전 관리, 릴리스 워크플로우)

### 설치 방법
```bash
# ClawHub CLI 설치 (npm)
npm install -g clawhub-cli

# 스킬 검색
clawhub search obsidian
clawhub search discord
clawhub search minecraft

# 스킬 설치
clawhub install openclaw/skills/obsidian
clawhub install openclaw/skills/discord-bot

# 로컬 스킬 목록
clawhub list
```

## 다음 단계

### 1단계: Critical 스킬 생성 (2-3시간)
- [ ] discord-bot-patterns 생성
- [ ] mineflayer-building-patterns 생성
- [ ] obsidian-vault-operations 확장

### 2단계: ClawHub 스킬 설치 (30분)
- [ ] uvx 설치 확인 (이미 설치됨: /Users/octiv/.local/bin/uvx)
- [ ] ClawHub CLI 설치 (npm install -g clawhub-cli)
- [ ] 관련 스킬 검색 및 설치

### 3단계: High 우선순위 스킬 생성 (4-5시간)
- [ ] discord-voice-automation 생성
- [ ] mineflayer-pathfinding-advanced 생성
- [ ] tdd-workflow-patterns 생성

### 4단계: Anthropics/Skills 참고 (1-2시간)
- [ ] GitHub 저장소 클론
- [ ] 관련 스킬 템플릿 분석
- [ ] 프로젝트에 맞게 커스터마이징

## 메타인지 체크

### 에이전트 역할 → 스킬 매핑
- **LeaderAgent**: git-workflow, tdd-workflow, obsidian-vault-operations
- **BuilderAgent**: mineflayer-building-patterns, mineflayer-pathfinding-advanced
- **SafetyAgent**: automated-debugging, verify-tests, verification-loop
- **MinerAgent**: mineflayer-resource-collection, papermc-rcon-control
- **FarmerAgent**: mineflayer-resource-collection
- **ExplorerAgent**: mineflayer-pathfinding-advanced
- **Discord Bot**: discord-bot-patterns, discord-voice-automation, discord-forum-management
- **Obsidian Sync**: obsidian-vault-operations, obsidian-notebooklm-integration, obsidian-dataview-patterns
- **Commander (Octiv)**: 모든 스킬 (통합 관리)

### 이심전심 (Telepathic Understanding)
- Discord = 에이전트들의 일터 → discord-* 스킬 필수
- Obsidian = 메인 메모리/커맨드 센터 → obsidian-* 스킬 필수
- Minecraft = 에이전트 실행 환경 → mineflayer-* 스킬 필수
- PaperMC = 서버 인프라 → papermc-* 스킬 필수
- 개발자 (Kiro) = TDD 워크플로우 → tdd-*, git-*, docker-* 스킬 필수

## 결론

**총 13개 스킬 누락** (Critical 3개, High 3개, Medium 4개, Low 3개)

**즉시 조치 필요**:
1. discord-bot-patterns 생성 (Discord 봇 핵심 패턴)
2. mineflayer-building-patterns 생성 (AC-2 shelter 빌드 완성)
3. obsidian-vault-operations 확장 (기존 obsidian-sync 강화)

**ClawHub 활용**:
- openclaw/skills 저장소에서 obsidian, discord 관련 스킬 설치
- 커뮤니티 스킬 5,700+ 개 활용 가능

**Anthropics/Skills 참고**:
- mcp-builder, webapp-testing 등 개발 도구 스킬 템플릿 활용
- SKILL.md 포맷 및 베스트 프랙티스 학습
