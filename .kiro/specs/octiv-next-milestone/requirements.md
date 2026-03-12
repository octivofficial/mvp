# Requirements Document

## Introduction

Octiv 프로젝트는 현재 Phase 7.2를 완료하고 92% 완성도에 도달했습니다. 9-agent 팀, LLM 기반 협상 시스템, isolated-vm 샌드박싱, MCP Orchestrator, Discord 봇 통합이 완료되었으며, 테스트 통과율은 99.4% (1380/1388)입니다.

다음 마일스톤은 프로젝트의 안정성과 품질을 확보하고, Phase 8 (Live Operations)을 완료하며, 남은 Phase 5와 Phase 7.3의 핵심 기능을 구현하는 것을 목표로 합니다. 이를 통해 Octiv는 장기 운영 가능한 자율 AI 에이전트 팀 시스템으로 발전합니다.

## Glossary

- **Test_Suite**: Octiv 프로젝트의 전체 테스트 모음 (1388개 테스트)
- **Builder_Agent**: 나무 수집, 쉘터 건설, 도구 제작을 담당하는 에이전트
- **Isolated_VM_Sandbox**: isolated-vm을 사용한 안전한 코드 실행 환경
- **MCP_Orchestrator**: 멀티 에이전트 조정 및 작업 라우팅 시스템
- **Discord_Bot**: Discord를 통한 실시간 모니터링 및 명령 인터페이스
- **Blackboard**: Redis 기반 공유 메모리 시스템
- **AC_Progress**: Acceptance Criteria 진행 상황 추적 시스템
- **Inventory_System**: 에이전트의 아이템 관리 시스템
- **NotebookLM_MCP**: NotebookLM과의 MCP 통합 서버
- **Gemini_API**: Google Gemini API를 통한 빠른 Q&A 시스템
- **Multi_Server_Support**: 여러 Minecraft 서버 동시 관리 기능
- **KubeJS_Plugin**: KubeJS 기반 플러그인 시스템
- **Heartbeat_Validation**: 에이전트 생존 상태 검증 시스템
- **E2E_Test**: End-to-End 통합 테스트

## Requirements

### Requirement 1: Test Suite Stability

**User Story:** 개발자로서, 모든 테스트가 통과하는 안정적인 코드베이스를 원합니다. 그래야 새로운 기능을 안전하게 추가할 수 있습니다.

#### Acceptance Criteria

1. WHEN builder-shelter door test가 실행되면, THE Test_Suite SHALL 3x3x3 쉘터 구조를 올바르게 검증한다
2. WHEN isolated-vm tests가 Node.js v25에서 실행되면, THE Test_Suite SHALL 모든 샌드박스 보안 테스트를 통과한다
3. WHEN team-orchestrator tests가 실행되면, THE Test_Suite SHALL 에이전트 등록 및 작업 할당을 올바르게 검증한다
4. THE Test_Suite SHALL 1388개 테스트 중 최소 1384개 (99.7%)를 통과한다
5. WHEN 모든 테스트가 실행되면, THE Test_Suite SHALL 30초 이내에 완료된다

### Requirement 2: Documentation and Configuration

**User Story:** 운영자로서, 프로젝트 설정 및 호환성 정보가 명확히 문서화되기를 원합니다. 그래야 배포 환경을 올바르게 구성할 수 있습니다.

#### Acceptance Criteria

1. THE README.md SHALL Node.js 버전 호환성 정보를 포함한다 (v20.0.0 이상, v25 isolated-vm 이슈 명시)
2. THE README.md SHALL isolated-vm 설치 요구사항 (Python, C++ 컴파일러)을 명시한다
3. WHERE Discord 통합이 활성화되면, THE Discord_Bot SHALL config/discord.json.example 파일을 참조한다
4. THE config/discord.json.example SHALL 필수 필드 (token, guildId, channels)를 포함한다
5. THE README.md SHALL 환경 변수 설정 가이드 (.env.example 참조)를 포함한다

### Requirement 3: Agent Health Monitoring

**User Story:** 시스템 관리자로서, 에이전트의 생존 상태를 실시간으로 검증하고 싶습니다. 그래야 장애 발생 시 즉시 대응할 수 있습니다.

#### Acceptance Criteria

1. WHEN 에이전트가 등록되면, THE MCP_Orchestrator SHALL heartbeat 타임스탬프를 기록한다
2. WHILE 에이전트가 활성 상태이면, THE MCP_Orchestrator SHALL 30초마다 heartbeat를 검증한다
3. IF heartbeat가 60초 이상 업데이트되지 않으면, THEN THE MCP_Orchestrator SHALL 에이전트를 'inactive' 상태로 변경한다
4. WHEN 에이전트가 'inactive' 상태로 변경되면, THE MCP_Orchestrator SHALL Discord 알림을 전송한다
5. THE Heartbeat_Validation SHALL Blackboard의 'agents:heartbeat:{agentId}' 키를 사용한다

### Requirement 4: Inventory Management System

**User Story:** Builder 에이전트로서, 아이템을 효율적으로 관리하고 싶습니다. 그래야 자원 부족 없이 작업을 완료할 수 있습니다.

#### Acceptance Criteria

1. WHEN Builder_Agent가 나무판자를 제작하면, THE Inventory_System SHALL 원목 소비량을 추적한다
2. WHEN 아이템이 부족하면, THE Builder_Agent SHALL 필요한 자원을 자동으로 수집한다
3. THE Inventory_System SHALL Blackboard에 실시간 인벤토리 상태를 게시한다 ('agent:{id}:inventory')
4. WHEN 제작이 완료되면, THE Builder_Agent SHALL 제작된 아이템 수량을 Blackboard에 업데이트한다
5. THE Inventory_System SHALL 아이템 타입별 수량을 JSON 형식으로 저장한다

### Requirement 5: End-to-End Survival Verification

**User Story:** 프로젝트 리더로서, AC-1~4가 실제 환경에서 완전히 작동하는지 검증하고 싶습니다. 그래야 첫날 생존 시나리오가 완성되었음을 확인할 수 있습니다.

#### Acceptance Criteria

1. THE E2E_Test SHALL AC-1 (16개 원목 수집) 완료를 검증한다
2. THE E2E_Test SHALL AC-2 (3x3x3 쉘터 건설) 완료를 검증한다
3. THE E2E_Test SHALL AC-3 (기본 도구 제작) 완료를 검증한다
4. THE E2E_Test SHALL AC-4 (모든 에이전트 쉘터 집결) 완료를 검증한다
5. WHEN E2E_Test가 실행되면, THE Test_Suite SHALL 1200 틱 (10분) 이내에 모든 AC를 완료한다
6. THE E2E_Test SHALL Blackboard의 AC_Progress 데이터를 검증한다
7. WHEN E2E_Test가 완료되면, THE Test_Suite SHALL 결과 리포트를 logs/ 디렉토리에 저장한다

### Requirement 6: Performance Optimization

**User Story:** 개발자로서, 에이전트의 경로 탐색 성능을 최적화하고 싶습니다. 그래야 대규모 작업 시 지연이 발생하지 않습니다.

#### Acceptance Criteria

1. THE Builder_Agent SHALL 비동기 경로 탐색 큐를 사용한다
2. WHEN 여러 경로 탐색 요청이 동시에 발생하면, THE Builder_Agent SHALL 요청을 큐에 추가하고 순차 처리한다
3. THE Builder_Agent SHALL 경로 탐색 타임아웃을 거리에 비례하여 동적으로 조정한다 (50블록당 30초)
4. WHEN 경로 탐색이 실패하면, THE Builder_Agent SHALL 대체 경로를 시도한다
5. THE Builder_Agent SHALL 경로 탐색 성능 메트릭 (시간, 거리, 성공률)을 Blackboard에 게시한다

### Requirement 7: NotebookLM Knowledge Integration

**User Story:** 에이전트로서, NotebookLM에 저장된 프로젝트 지식에 접근하고 싶습니다. 그래야 전략 결정 시 과거 학습 내용을 활용할 수 있습니다.

#### Acceptance Criteria

1. THE NotebookLM_MCP SHALL MCP 서버로 실행된다
2. WHEN 에이전트가 기술 문서를 검색하면, THE NotebookLM_MCP SHALL NotebookLM API를 통해 결과를 반환한다
3. THE NotebookLM_MCP SHALL 'searchDocs' 도구를 제공한다
4. THE NotebookLM_MCP SHALL 'syncProgress' 도구를 제공하여 프로젝트 진행 상황을 NotebookLM에 동기화한다
5. WHEN 검색 결과가 반환되면, THE NotebookLM_MCP SHALL 관련성 점수와 함께 상위 5개 결과를 반환한다

### Requirement 8: Gemini Fast Q&A Integration

**User Story:** 에이전트로서, 빠른 질문에 대한 즉각적인 답변을 원합니다. 그래야 간단한 의사결정을 신속하게 처리할 수 있습니다.

#### Acceptance Criteria

1. THE Gemini_API SHALL Google Gemini API에 연결된다
2. WHEN 에이전트가 간단한 질문을 하면, THE Gemini_API SHALL 2초 이내에 응답한다
3. THE Gemini_API SHALL 비용 최적화를 위해 Gemini Flash 모델을 사용한다
4. WHERE 복잡한 추론이 필요하면, THE Gemini_API SHALL Claude API로 폴백한다
5. THE Gemini_API SHALL API 호출 비용을 추적하고 일일 한도 ($1.00)를 적용한다
6. THE Gemini_API SHALL .env 파일의 GEMINI_API_KEY를 사용한다

### Requirement 9: Multi-Server Infrastructure

**User Story:** 시스템 관리자로서, 여러 Minecraft 서버를 동시에 관리하고 싶습니다. 그래야 다양한 환경에서 에이전트를 테스트할 수 있습니다.

#### Acceptance Criteria

1. THE Multi_Server_Support SHALL config/servers.json 파일에서 서버 목록을 로드한다
2. WHEN 에이전트가 시작되면, THE Multi_Server_Support SHALL 대상 서버를 선택한다
3. THE Multi_Server_Support SHALL 서버별 연결 상태를 Blackboard에 게시한다 ('servers:{serverId}:status')
4. WHERE 서버가 오프라인이면, THE Multi_Server_Support SHALL 다음 사용 가능한 서버로 폴백한다
5. THE Multi_Server_Support SHALL 서버별 에이전트 분산을 지원한다 (로드 밸런싱)

### Requirement 10: KubeJS Plugin System

**User Story:** 개발자로서, KubeJS를 통해 Minecraft 서버 동작을 커스터마이징하고 싶습니다. 그래야 에이전트 작업에 최적화된 환경을 구축할 수 있습니다.

#### Acceptance Criteria

1. THE KubeJS_Plugin SHALL PaperMC 서버에 설치된다
2. THE KubeJS_Plugin SHALL server_scripts/ 디렉토리에서 스크립트를 로드한다
3. WHERE 에이전트가 특정 블록을 파괴하면, THE KubeJS_Plugin SHALL 커스텀 이벤트를 트리거한다
4. THE KubeJS_Plugin SHALL 에이전트 작업 완료 시 보상 아이템을 지급한다
5. THE KubeJS_Plugin SHALL 서버 시작 시 초기화 스크립트를 실행한다

### Requirement 11: Anti-Gravity Collaboration Protocol

**User Story:** 개발자로서, Claude와 Anti-Gravity (Google IDE + Gemini) 간 협업 프로토콜을 원합니다. 그래야 두 환경에서 동시에 개발할 수 있습니다.

#### Acceptance Criteria

1. THE Anti_Gravity_Protocol SHALL Git 기반 코드 동기화를 사용한다
2. THE Anti_Gravity_Protocol SHALL 파일 소유권 규칙을 docs/collaboration.md에 문서화한다
3. THE Anti_Gravity_Protocol SHALL 통합 커밋 컨벤션 (emoji + 영문 설명)을 정의한다
4. WHERE 파일 충돌이 발생하면, THE Anti_Gravity_Protocol SHALL 충돌 해결 가이드를 제공한다
5. THE Anti_Gravity_Protocol SHALL 브랜치 전략 (main, dev, feature/*)을 정의한다

