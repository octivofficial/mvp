# Octiv 프로젝트 로드맵
> **최종 목표**: PaperMC 마인크래프트 서버에서 AI 에이전트 팀이 자율적으로 생존·건축·자원관리를 수행하는 샌드박스 완성
>
> **정신**: 眞善美孝永 — Truth, Goodness, Beauty, Serenity, Eternity
>
> **작성일**: 2026-03-03 | **리드 개발자**: Claude | **사령관**: Octiv

---

## 팀 구성

| 역할 | 담당 | 설명 |
|------|------|------|
| **사령관 (Commander)** | Octiv | 프로젝트 총괄, 방향 결정, NotebookLM 자료 관리 |
| **리드 개발자** | Claude (Cowork) | 코드 구현, 아키텍처, 디버깅, 로드맵 관리 |
| **개발 환경 B** | Anti-Gravity (Google IDE + Gemini) | 병렬 개발, NotebookLM 연동, Gemini 기반 보조 |
| **에이전트 프레임워크** | OpenClaw | 에이전트 런타임, 스킬 시스템, LLM 브릿지 |

---

## 현재 상태 진단 (v0.1 — 2 commits)

### 구현 완료
- [x] 프로젝트 구조 (agent/, skills/, config/, logs/)
- [x] Docker Compose (Redis + PaperMC)
- [x] Blackboard 모듈 (Redis Pub/Sub 공유 메모리)
- [x] bot.js 단일 봇 테스트 (mineflayer 접속, 기본 명령)
- [x] team.js 팀 오케스트레이터 (Leader + Builder×3 + Safety)
- [x] leader.js (모드 결정, 투표, Group Reflexion)
- [x] builder.js (나무 수집 AC-1, 도구 제작 AC-3, ReAct 루프)
- [x] safety.js (위험 감지 AC-8, vm2 샌드박스 검증)
- [x] first-day-survival v1.3.1 스킬 정의 (BMAD 포맷)
- [x] .env + OpenClaw 에이전트 설정

### 미구현 / 미완성
- [ ] AC-2: 대피소 건설 로직 (builder.js에 없음)
- [ ] AC-4: 대피소 내 에이전트 집결 검증
- [ ] AC-5: Self-Improvement 실제 구현 (실패→스킬 생성)
- [ ] AC-6: Group Reflexion → 시스템 프롬프트 주입
- [ ] AC-7: memory.md 기록 로직
- [ ] Leader ↔ Builder ↔ Safety 실제 통합 통신
- [ ] LLM 브릿지 (bridge:8765) 연결 구현
- [ ] NotebookLM ↔ MCP 연동
- [ ] 스킬 라이브러리 동적 로딩
- [ ] HEARTBEAT 대시보드 연동
- [ ] 테스트 코드 전무

---

## Phase 1 — 기반 안정화 (Foundation)
> 목표: 단일 봇이 서버에서 안정적으로 동작하는 것을 확인

### 1.1 인프라 검증
- Docker Compose 정상 기동 확인 (Redis + PaperMC)
- Redis 연결 테스트 (Blackboard → publish/get 동작)
- RCON 명령 실행 확인 (서버 상태 조회)

### 1.2 단일 봇 안정화
- bot.js로 서버 접속 → 스폰 → 기본 동작 검증
- mineflayer + pathfinder 이동/채굴 안정성 테스트
- 에러 핸들링 강화 (재접속, 타임아웃, 예외처리)

### 1.3 Blackboard 통합 테스트
- bot.js → Blackboard에 상태 게시 → Redis에서 확인
- Pub/Sub 채널 구독/발행 검증
- AC 진행도 업데이트 → 조회 사이클 테스트

### 마일스톤
```
✅ docker compose up → Redis PONG, MC서버 MOTD 확인
✅ node agent/bot.js → 봇 스폰, !status !pos 응답
✅ Redis에서 octiv:agent:*:status 키 확인
```

---

## Phase 2 — 핵심 AC 구현 (Core Gameplay)
> 목표: first-day-survival 미션의 AC-1~4 완성

### 2.1 AC-1: 나무 수집 (16개)
- builder.js의 collectWood() 디버그 및 안정화
- 다양한 나무 타입 대응 (oak, spruce, birch, jungle)
- 60초 시간 제한 구현 + 실패 시 Reflexion 트리거

### 2.2 AC-2: 대피소 건설 (3×3×3+)
- 블록 배치 알고리즘 구현 (위치 선정 → 바닥 → 벽 → 지붕)
- Y-level 안전 검사 (평지 확인, 물/용암 회피)
- 문 배치 + 조명 설치

### 2.3 AC-3: 도구 제작
- craftBasicTools() 안정화 (인벤토리 확인 → 조합대 설치 → 제작)
- 재료 부족 시 자동 수집 루프

### 2.4 AC-4: 에이전트 집결
- 대피소 좌표 Blackboard 공유
- 전 에이전트 대피소 이동 + 도착 검증
- 1200 tick 타이머 구현

### 마일스톤
```
✅ Builder가 나무 16개 수집 (60초 이내)
✅ 3×3×3 대피소 자동 건설 완료
✅ 조합대 + 나무 곡괭이 제작
✅ 모든 에이전트 대피소 내 집결 (Blackboard 확인)
```

---

## Phase 3 — 팀 협업 체계 (Team Orchestration)
> 목표: Leader-Builder-Safety 간 실제 통신 및 역할 분담 동작

### 3.1 Leader ↔ Builder 연동
- Leader가 미션 분배 → Builder가 수신 → 실행
- Training Mode / Creative Mode 전환 로직 실동작
- 투표 시스템 (2/3 다수결) 구현

### 3.2 Safety 실시간 감시
- Safety Agent가 모든 Builder 상태를 Blackboard로 모니터링
- AC-8 위협 감지 → 즉시 경고 브로드캐스트
- vm2 검증 파이프라인 실동작

### 3.3 Group Reflexion
- 3회 연속 실패 → Leader가 Group Reflexion 강제 실행
- Reflexion 결과 → 팀 전체 행동 전략 수정
- Reflexion 히스토리 저장 (Blackboard + memory.md)

### 마일스톤
```
✅ Leader가 "training" → "creative" 모드 전환
✅ Safety 위협 감지 → 팀 전체 경고 1초 이내
✅ Group Reflexion 실행 → 전략 변경 적용
```

---

## Phase 4 — Self-Improvement 엔진 (AC-5, 6, 8)
> 목표: 실패 시 자동으로 새 스킬 생성·검증·배포

### 4.1 Self-Improvement 파이프라인
- 실패 감지 → LLM에 스킬 생성 요청 → JSON 응답 파싱
- vm2 sandbox 3회 dry-run 검증
- Blackboard skills:emergency 채널 브로드캐스트

### 4.2 스킬 라이브러리 동적 관리
- Redis에 스킬 저장/조회 (Blackboard.saveSkill/getSkill)
- 스킬 success_rate 실시간 업데이트
- 일일 한도 5개 + estimated_success_rate < 0.7 폐기

### 4.3 LLM 브릿지 연결
- bridge:8765 엔드포인트 연동 (GLM-4.7 / GPT / Gemini)
- 비용 가드레일 ($0.01/attempt)
- 폴백: LLM 실패 시 기존 안전 스킬 사용

### 4.4 시스템 프롬프트 동적 주입 (AC-6)
- Group Reflexion 결과 → "[Learned Skill v1.3]" 주입
- 모든 에이전트 시스템 프롬프트 실시간 업데이트

### 마일스톤
```
✅ 용암 사망 → evacuate_lava_v1 스킬 자동 생성
✅ vm2 검증 통과 → skills:emergency 브로드캐스트
✅ 새 스킬이 다음 ReAct 루프에서 즉시 사용됨
```

---

## Phase 5 — 지식 연동 (Knowledge Bridge)
> 목표: NotebookLM 자료를 MCP로 연결, Claude ↔ Anti-Gravity 양방향 개발

### 5.1 NotebookLM ↔ MCP 연동
- NotebookLM MCP 서버 설정 (기존 notebooklm 도구 활용)
- 노트북에서 기술 자료/전략 문서 검색 → 에이전트 행동에 반영
- 프로젝트 진행 기록을 NotebookLM에 자동 동기화

### 5.2 Claude ↔ Anti-Gravity 협업 프로토콜
- 공통 코드베이스: Git 기반 동기화
- 작업 분담 규칙 문서화 (누가 어떤 파일을 담당)
- 커밋 컨벤션 통일 (이모지 + 한글 설명)

### 5.3 Gemini 스킬 연동
- skills/gemini → 실제 Gemini API 연결
- 빠른 Q&A, 요약, 전략 보조로 활용
- 비용 최적화 (Gemini = 빠른 작업, GPT/GLM = 복잡한 추론)

### 마일스톤
```
✅ NotebookLM에서 "나무 수집 최적 전략" 검색 → 결과 반환
✅ Claude에서 작성한 코드가 Git → Anti-Gravity에서 즉시 사용
✅ Gemini 스킬이 에이전트 Q&A에 정상 응답
```

---

## Phase 6 — 모니터링 & 대시보드 (Observability)
> 목표: 사령관이 실시간으로 팀 상태를 파악

### 6.1 HEARTBEAT 대시보드
- 웹 기반 실시간 대시보드 (React or HTML)
- 에이전트별 위치, 체력, 인벤토리, AC 진행도 표시
- 미션 타임라인 시각화

### 6.2 로그 & 알림
- 구조화된 로그 시스템 (logs/ 디렉토리 활용)
- 위험 이벤트 → 사령관 알림 (Discord/채널)
- 일일 미션 보고서 자동 생성

### 6.3 메모리 시스템
- memory.md 자동 기록 (AC-7)
- 일일 노트 (memory/YYYY-MM-DD.md)
- MEMORY.md 장기 기억 큐레이션

### 마일스톤
```
✅ 브라우저에서 http://localhost:3000 → 대시보드 표시
✅ Safety 경고 → Discord 알림 1초 이내
✅ 미션 종료 → memory.md에 자동 기록
```

---

## Phase 7 — 확장 & 고도화 (Scale)
> 목표: 첫 밤 생존을 넘어 장기 운영 체계 구축

### 7.1 미션 확장
- Week 2: 광물 채굴 + 석재 도구 업그레이드
- Week 3: 농장 자동화 + 식량 자급
- Week 4: 엔더 드래곤 전략 수립

### 7.2 에이전트 고도화
- 에이전트 수 확장 (Builder 3→5+)
- 역할 세분화 (농부, 광부, 탐험가, 건축가)
- 에이전트 간 자연어 대화 (LLM 기반 협상)

### 7.3 인프라 확장
- LM Studio 로컬 모델 연결 (비용 절감)
- 멀티 서버 지원
- 플러그인 시스템 (KubeJS 연동)

---

## 일정 요약

| Phase | 이름 | 예상 기간 | 선행 조건 |
|-------|------|----------|----------|
| **1** | 기반 안정화 | 1~2일 | Docker, Node.js 환경 |
| **2** | 핵심 AC 구현 | 3~5일 | Phase 1 완료 |
| **3** | 팀 협업 체계 | 3~5일 | Phase 2 완료 |
| **4** | Self-Improvement | 5~7일 | Phase 3 + LLM 브릿지 |
| **5** | 지식 연동 | 3~5일 | NotebookLM 자료 준비 |
| **6** | 모니터링 | 3~5일 | Phase 3 이후 병렬 가능 |
| **7** | 확장 & 고도화 | 지속적 | Phase 4 완료 후 |

---

## 작업 원칙

1. **매 세션 시작**: ROADMAP.md + 최근 커밋 로그 읽기 → 현재 Phase 파악
2. **커밋 규칙**: `이모지 Phase-N: 한글 설명` (예: `🎮 P2: AC-1 나무 수집 안정화`)
3. **테스트 우선**: 새 기능 구현 전 테스트 코드 먼저
4. **비용 의식**: LLM 호출 시 항상 비용 가드레일 준수
5. **보고 의무**: Phase 완료 시 사령관에게 상태 보고

---

> _"眞善美孝永 — 정확하게 읽고, 안전하게 행동하고, 아름답게 짓고, 평화롭게 보고하고, 영원히 지속한다."_
