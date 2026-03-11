# Tasks - Octiv Weaknesses Fix

## Phase 1: Test Infrastructure Setup (30분)

- [x] 1. Test 파일 생성
  - [x] 1.1 `test/builder-shelter.test.js` 생성
  - [x] 1.2 `test/isolated-vm-sandbox.test.js` 생성
  - [x] 1.3 `test/reflexion-real-llm.test.js` skip 해제
  - [x] 1.4 `test/team-orchestrator-integration.test.js` 생성

## Phase 2: US-1 AC-2 쉘터 건설 (2시간)

- [x] 2. AC-2 테스트 작성 (Red)
  - [x] 2.1 Property 1: 30 블록 배치 테스트
  - [x] 2.2 Property 2: 내부 빈 공간 테스트
  - [x] 2.3 Property 3: 문 개구부 테스트
  - [x] 2.4 Blackboard publish 테스트

- [x] 3. AC-2 구현 (Green)
  - [x] 3.1 `_placeBlockAt()` 헬퍼 함수 구현
  - [x] 3.2 바닥 배치 루프 (9블록)
  - [x] 3.3 벽 배치 루프 (12블록, 문 제외)
  - [x] 3.4 지붕 배치 루프 (9블록)
  - [x] 3.5 Blackboard publish 추가

- [x] 4. AC-2 리팩토링
  - [x] 4.1 에러 핸들링 추가
  - [x] 4.2 로깅 개선
  - [x] 4.3 타임아웃 처리

## Phase 3: US-2 isolated-vm 마이그레이션 (4시간)

- [x] 5. isolated-vm 설치
  - [x] 5.1 `npm install isolated-vm` 실행
  - [x] 5.2 네이티브 모듈 빌드 확인
  - [x] 5.3 package.json 업데이트

- [x] 6. IsolatedVMSandbox 테스트 작성 (Red)
  - [x] 6.1 Property 1: Escape prevention 테스트
  - [x] 6.2 Property 2: Timeout enforcement 테스트
  - [x] 6.3 Property 3: Safe code execution 테스트

- [x] 7. IsolatedVMSandbox 구현 (Green)
  - [x] 7.1 `agent/isolated-vm-sandbox.js` 생성
  - [x] 7.2 `run()` 메서드 구현
  - [x] 7.3 Timeout 로직 구현
  - [x] 7.4 에러 핸들링 구현

- [x] 8. vm2 교체
  - [x] 8.1 `safety.js`에서 vm2 → isolated-vm
  - [x] 8.2 `skill-pipeline.js`에서 vm2 → isolated-vm
  - [x] 8.3 기존 테스트 통과 확인
  - [x] 8.4 vm2 의존성 제거 (`package.json`)

## Phase 4: US-3 ReflexionEngine LLM 연결 (2시간)

- [x] 9. LLM 클라이언트 확인
  - [x] 9.1 `api-clients.js` 코드 리뷰
  - [x] 9.2 `team.js` 주입 로직 확인
  - [x] 9.3 환경변수 설정 확인 (ANTHROPIC_API_KEY)

- [x] 10. LLM 테스트 활성화 (Red → Green)
  - [x] 10.1 `test/reflexion.test.js` skip 제거
  - [x] 10.2 Property 1: API client injection 테스트
  - [x] 10.3 Property 2: Cost guardrail 테스트
  - [x] 10.4 Property 3: Fallback chain 테스트

- [x] 11. ReflexionEngine 검증
  - [x] 11.1 실제 API 호출 테스트 (mock 아님)
  - [x] 11.2 비용 추적 로직 확인
  - [x] 11.3 모델 스위칭 확인

## Phase 5: US-4 mcp-orchestrator 통합 (1시간)

- [x] 12. Orchestrator 통합 테스트 작성 (Red)
  - [x] 12.1 Property 1: Registration completeness
  - [x] 12.2 Property 2: Deregistration on shutdown
  - [x] 12.3 Property 3: Registry consistency

- [x] 13. team.js 통합 (Green)
  - [x] 13.1 MCPOrchestrator 초기화 추가
  - [x] 13.2 각 에이전트 init() 후 register() 호출
  - [x] 13.3 각 에이전트 shutdown() 전 deregister() 호출
  - [x] 13.4 Discord `!rc agents` 명령 테스트

## Phase 6: E2E 검증 (2시간)

- [x] 14. 전체 테스트 실행
  - [x] 14.1 `npm test` 실행 (1357+ tests)
  - [x] 14.2 `npm run lint` 실행 (0 warnings)
  - [x] 14.3 실패한 테스트 수정

- [x] 15. Docker E2E 테스트
  - [x] 15.1 `docker-compose up -d` (Redis + PaperMC)
  - [x] 15.2 `node agent/team.js` 실행
  - [x] 15.3 7개 에이전트 spawn 확인
  - [x] 15.4 AC-1~4 완료 확인
  - [x] 15.5 Discord #neostarz-live 모니터링

- [x] 16. 문서 업데이트
  - [x] 16.1 vault/Dashboard.md 동기화
  - [x] 16.2 vault/Session-Sync.md 업데이트
  - [x] 16.3 ROADMAP.md Phase 8 완료 표시
  - [x] 16.4 docs/AUDIT_REPORT.md 업데이트

- [x] 17. Git 커밋 & 푸시
  - [x] 17.1 `git add .`
  - [x] 17.2 `git commit -m "✅ Complete 4 critical weaknesses - AC-2, isolated-vm, LLM, orchestrator"`
  - [x] 17.3 `git push origin main`
  - [x] 17.4 Discord #neostarz-alerts 완료 보고
