# Octiv MVP 약점 보완 Feature

## Overview
Octiv MVP의 4가지 Critical/High 약점을 TDD 방식으로 완성하여 production-ready 상태로 만든다.

## Feature Name
`octiv-weaknesses-fix`

## Problem Statement
현재 Octiv MVP는 85% production-quality이지만 15%의 미완성/취약 코드로 인해:
1. AC-2 쉘터를 실제로 지을 수 없음 (게임 로직 미완성)
2. vm2 보안 취약점 (CVE-2023-37466)으로 악의적 코드 실행 가능
3. ReflexionEngine이 LLM 없이 작동 불가 (스킬 생성 실패)
4. mcp-orchestrator가 연결되지 않아 동적 에이전트 관리 불가

## Goals
- **Primary**: 4가지 약점을 완전히 제거하여 MVP를 production-ready로 만든다
- **Secondary**: 모든 수정사항에 대해 테스트를 먼저 작성하여 기술부채 방지
- **Tertiary**: 옵시디언 vault와 실시간 동기화하여 진행상황 투명화

## Success Criteria
1. ✅ AC-2 쉘터 건설이 실제 마인크래프트에서 작동
2. ✅ isolated-vm으로 마이그레이션 완료, 보안 테스트 통과
3. ✅ ReflexionEngine이 실제 LLM API 호출 성공
4. ✅ mcp-orchestrator가 team.js와 통합되어 7개 에이전트 등록
5. ✅ 모든 테스트 통과 (1357+ tests)
6. ✅ 0 lint 경고
7. ✅ E2E 테스트: 전체 팀 spawn → AC-1~4 완료 → Discord 보고

## User Stories

### US-1: AC-2 쉘터 건설 완성
**As a** Builder agent  
**I want to** build a 3x3x3 shelter with actual block placement  
**So that** I can complete AC-2 and provide team shelter

**Acceptance Criteria**:
- [ ] `buildShelter()` places 30 blocks (9 floor + 12 walls + 9 roof)
- [ ] Door opening (2 blocks) is left empty
- [ ] Shelter coordinates published to Blackboard
- [ ] Test: mock bot verifies all `placeBlock()` calls
- [ ] Test: shelter structure is hollow inside
- [ ] Test: AC-2 status = "done" after completion

**Correctness Properties**:
```javascript
// Property 1: Block count invariant
∀ shelter: buildShelter(bot) → bot.placeBlock.callCount === 30

// Property 2: Hollow structure
∀ (x,y,z) ∈ interior: bot.blockAt(x,y,z) === null

// Property 3: Door opening
∀ (x,y,z) ∈ doorway: bot.placeBlock NOT called
```

### US-2: vm2 → isolated-vm 보안 마이그레이션
**As a** Safety agent  
**I want to** validate untrusted code in a secure sandbox  
**So that** malicious skill code cannot escape and harm the system

**Acceptance Criteria**:
- [ ] `isolated-vm` 패키지 설치 및 설정
- [ ] `IsolatedVMSandbox` 클래스 구현
- [ ] `safety.js`에서 vm2 → isolated-vm 교체
- [ ] `skill-pipeline.js`에서 vm2 → isolated-vm 교체
- [ ] Test: sandbox escape 시도 차단
- [ ] Test: 정상 코드는 실행 허용
- [ ] Test: timeout 작동 (3초)
- [ ] vm2 의존성 제거

**Correctness Properties**:
```javascript
// Property 1: Escape prevention
∀ malicious_code: sandbox.run(malicious_code) → throws SecurityError

// Property 2: Timeout enforcement
∀ infinite_loop: sandbox.run(infinite_loop, {timeout: 3000}) → throws TimeoutError

// Property 3: Safe code execution
∀ safe_code: sandbox.run(safe_code) → returns result
```

### US-3: ReflexionEngine LLM 클라이언트 연결
**As a** ReflexionEngine  
**I want to** call Anthropic/Groq APIs for skill generation  
**So that** agents can learn from failures and create new skills

**Acceptance Criteria**:
- [ ] `api-clients.js`에서 Anthropic/Groq 클라이언트 생성 확인
- [ ] `team.js`에서 ReflexionEngine에 apiClients 주입 확인
- [ ] Test: 실제 Anthropic API 호출 성공 (skip 해제)
- [ ] Test: Groq fallback 작동
- [ ] Test: 비용 가드레일 (daily limit) 작동
- [ ] Test: 모델 스위칭 (Haiku → Sonnet) 작동
- [ ] 현재 skip된 4개 LLM 테스트 활성화

**Correctness Properties**:
```javascript
// Property 1: API client injection
∀ engine: engine.apiClients.anthropic !== null

// Property 2: Cost guardrail
∀ engine: engine.dailyCost > maxCostPerDay → throws CostLimitError

// Property 3: Fallback chain
anthropic.fail() → groq.call() → local.call()
```

### US-4: mcp-orchestrator 실제 연결
**As a** Team orchestrator  
**I want to** register all agents in mcp-orchestrator  
**So that** I can dynamically manage agent lifecycle and task routing

**Acceptance Criteria**:
- [ ] `team.js`에 MCPOrchestrator 초기화 추가
- [ ] 각 에이전트 시작 시 자동 등록
- [ ] 각 에이전트 종료 시 자동 해제
- [ ] Test: 7개 에이전트 모두 등록 확인
- [ ] Test: 에이전트 종료 시 registry에서 제거
- [ ] Test: `getAllAgents` MCP tool 작동
- [ ] Discord `!rc agents` 명령으로 확인 가능

**Correctness Properties**:
```javascript
// Property 1: Registration completeness
∀ agent ∈ team: agent.init() → registry.has(agent.id)

// Property 2: Deregistration on shutdown
∀ agent ∈ team: agent.shutdown() → !registry.has(agent.id)

// Property 3: Registry consistency
registry.size === activeAgents.length
```

## Non-Goals
- ❌ 새로운 기능 추가 (오직 미완성 기능 완성만)
- ❌ 성능 최적화 (기능 완성 우선)
- ❌ UI/UX 개선 (백엔드 안정화 우선)

## Technical Constraints
- Node.js >= 20.0.0
- Redis 6380 포트 사용
- PaperMC 1.21.11 호환
- 기존 1357개 테스트 모두 통과 유지
- 0 lint 경고 유지

## Dependencies
- `isolated-vm`: ^5.0.0 (신규 설치)
- `@anthropic-ai/sdk`: ^0.78.0 (이미 설치됨)
- `groq-sdk`: ^0.37.0 (이미 설치됨)
- `mineflayer`: ^4.35.0 (이미 설치됨)

## Risks & Mitigations
| Risk | Impact | Mitigation |
|------|--------|------------|
| isolated-vm 설치 실패 (네이티브 모듈) | High | Docker 환경에서 빌드, fallback 전략 |
| Anthropic API 비용 초과 | Medium | 비용 가드레일 강화, 테스트는 mock 사용 |
| AC-2 블록 배치 로직 복잡도 | Medium | 단계별 테스트 (바닥→벽→지붕) |
| 기존 테스트 깨짐 | High | 각 수정 후 즉시 `npm test` 실행 |

## Timeline
- **Phase 1**: Spec + Test 작성 (1시간) ← 지금
- **Phase 2**: US-1 구현 (2시간)
- **Phase 3**: US-2 구현 (4시간)
- **Phase 4**: US-3 구현 (2시간)
- **Phase 5**: US-4 구현 (1시간)
- **Phase 6**: E2E 검증 (2시간)
- **Total**: 12시간

## Definition of Done
- [ ] 모든 User Story의 Acceptance Criteria 충족
- [ ] 모든 Correctness Properties 테스트 통과
- [ ] `npm test` 1357+ tests pass, 0 fail
- [ ] `npm run lint` 0 warnings
- [ ] E2E 테스트: Docker compose → 7 agents spawn → AC-1~4 완료
- [ ] Discord #neostarz-alerts에 완료 보고
- [ ] 옵시디언 vault/Dashboard.md 업데이트
- [ ] ROADMAP.md Phase 8 완료 표시
- [ ] Git commit + push to main

## References
- [AUDIT_REPORT.md](../../docs/AUDIT_REPORT.md)
- [ROADMAP.md](../../ROADMAP.md)
- [vault/Dashboard.md](../../vault/Dashboard.md)
- [Anthropic API Docs](https://docs.anthropic.com/claude/reference/messages_post)
- [isolated-vm GitHub](https://github.com/laverdet/isolated-vm)
- [Mineflayer Block Placement](https://github.com/PrismarineJS/mineflayer/blob/master/docs/api.md#botplaceblockblock-faceVector-cb)
