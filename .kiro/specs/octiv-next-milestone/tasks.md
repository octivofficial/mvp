# Implementation Plan: Octiv Next Milestone

## Overview

이 구현 계획은 Octiv 프로젝트의 다음 마일스톤을 TDD 접근 방식으로 구현합니다. 각 기능에 대해 "테스트 작성 → 구현 → 리팩토링" 순서를 따르며, property-based tests와 unit tests를 모두 포함합니다.

**구현 우선순위:**
1. Quality & Stability (테스트 안정성, 문서화)
2. Live Operations (헬스 모니터링, 인벤토리 관리, E2E 테스트)
3. Knowledge Bridge (NotebookLM, Gemini 통합)
4. Infrastructure (멀티 서버, KubeJS, 협업 프로토콜)

**기술 스택:** JavaScript (Node.js), fast-check (property-based testing), Jest (unit testing)

**⚠️ Known Issue**: Property-based tests using fast-check are currently skipped on Node.js v25 due to memory issues. Use Node.js v20 LTS for full test coverage.

---

## Phase 1: Quality & Stability

### 1. Test Suite Stability - Shelter Structure Validation

- [ ] 1.1 Write property test for shelter structure validation
  - **Property 1: Shelter Structure Validation**
  - **Validates: Requirements 1.1**
  - Generate arbitrary shelter structures with fast-check
  - Verify 3x3x3 configuration detection (27 blocks)
  - Test door placement validation
  - _File: test/builder-shelter.property.test.js_

- [ ]* 1.2 Write unit tests for shelter structure edge cases
  - Test incomplete shelters (missing walls, roof)
  - Test oversized structures (4x4x4)
  - Test shelters with incorrect door placement
  - _File: test/builder-shelter.test.js (수정)_
  - _Requirements: 1.1_

- [ ] 1.3 Fix shelter structure validation logic
  - Update validateShelterStructure() to correctly identify 3x3x3 configuration
  - Ensure door placement validation works correctly
  - _File: agent/builder-shelter.js (수정)_
  - _Requirements: 1.1_

### 2. Test Suite Stability - Isolated VM Sandbox

- [ ]* 2.1 Write unit tests for Node.js v25 compatibility
  - Test isolated-vm initialization on Node.js v20 and v25
  - Test sandbox security constraints
  - Test code execution timeout
  - _File: test/isolated-vm-sandbox.test.js (수정)_
  - _Requirements: 1.2_

- [ ] 2.2 Fix isolated-vm compatibility issues
  - Update isolated-vm initialization for Node.js v25
  - Add version detection and compatibility warnings
  - _File: agent/isolated-vm-sandbox.js (수정)_
  - _Requirements: 1.2_

### 3. Test Suite Stability - Team Orchestrator

- [ ] 3.1 Write property test for agent registration
  - **Property 2: Agent Registration Heartbeat**
  - **Validates: Requirements 3.1, 3.5**
  - Generate arbitrary agent IDs with fast-check
  - Verify heartbeat timestamp is recorded in Blackboard
  - Verify key format: `agents:heartbeat:{agentId}`
  - _File: test/team-orchestrator.property.test.js_

- [ ]* 3.2 Write unit tests for agent registration and task assignment
  - Test agent registration with specific IDs
  - Test task assignment to registered agents
  - Test agent deregistration
  - _File: test/team-orchestrator-integration.test.js (수정)_
  - _Requirements: 1.3_

- [ ] 3.3 Fix team orchestrator agent registration
  - Update registerAgent() to record heartbeat timestamp
  - Ensure task assignment works correctly
  - _File: agent/mcp-orchestrator.js (수정)_
  - _Requirements: 1.3, 3.1_

### 4. Documentation and Configuration

- [ ] 4.1 Update README.md with Node.js compatibility information
  - Add Node.js version requirements (v20.0.0+)
  - Document Node.js v25 isolated-vm issues
  - Add isolated-vm installation requirements (Python, C++ compiler)
  - Add environment variable setup guide (.env.example reference)
  - _File: README.md (수정)_
  - _Requirements: 2.1, 2.2, 2.5_

- [ ] 4.2 Create Discord bot configuration template
  - Create config/discord.json.example with required fields
  - Document token, guildId, channels fields
  - Add configuration instructions
  - _File: config/discord.json.example (신규)_
  - _Requirements: 2.3, 2.4_

---

## Phase 2: Live Operations - Health Monitoring

### 5. Heartbeat Validation System

- [ ] 5.1 Write property test for stale heartbeat detection
  - **Property 3: Stale Heartbeat Detection**
  - **Validates: Requirements 3.3**
  - Generate arbitrary heartbeat ages (0-120 seconds)
  - Verify agents with heartbeat > 60s are marked 'inactive'
  - _File: test/heartbeat-validator.property.test.js_

- [ ] 5.2 Write property test for inactive agent notification
  - **Property 4: Inactive Agent Notification**
  - **Validates: Requirements 3.4**
  - Verify Discord notification is sent when agent becomes inactive
  - Test notification message format
  - _File: test/heartbeat-validator.property.test.js_

- [ ]* 5.3 Write unit tests for heartbeat validation
  - Test specific heartbeat ages (30s, 60s, 90s)
  - Test Discord notification format
  - Test Redis connection failure handling
  - _File: test/heartbeat-validator.test.js_
  - _Requirements: 3.2, 3.3, 3.4_

- [ ] 5.4 Implement HeartbeatValidator class
  - Create HeartbeatValidator with start(), checkAgent(), checkAll() methods
  - Implement 30-second validation loop
  - Implement 60-second timeout detection
  - Add error handling for Redis failures
  - _File: agent/heartbeat-validator.js (신규)_
  - _Requirements: 3.2, 3.3_

- [ ] 5.5 Integrate HeartbeatValidator with MCP Orchestrator
  - Update MCP Orchestrator to start HeartbeatValidator
  - Implement handleInactive() to update agent status
  - _File: agent/mcp-orchestrator.js (수정)_
  - _Requirements: 3.3_

- [ ] 5.6 Add Discord notification for inactive agents
  - Update Discord bot to send alert notifications
  - Format: "Agent {agentId} is inactive (heartbeat {age}ms old)"
  - _File: agent/discord-bot.js (수정)_
  - _Requirements: 3.4_

---

## Phase 3: Live Operations - Inventory Management

### 6. Inventory Tracking System

- [ ] 6.1 Write property test for inventory change tracking
  - **Property 5: Inventory Change Tracking**
  - **Validates: Requirements 4.1, 4.4**
  - Generate arbitrary item acquisitions and consumptions
  - Verify inventory state reflects changes
  - _File: test/inventory-tracker.property.test.js_

- [ ] 6.2 Write property test for inventory state publishing
  - **Property 6: Inventory State Publishing**
  - **Validates: Requirements 4.3, 4.5**
  - Generate arbitrary inventory states
  - Verify published data is valid JSON with correct structure
  - Verify Blackboard key format: `agent:{id}:inventory`
  - _File: test/inventory-tracker.property.test.js_

- [ ]* 6.3 Write unit tests for inventory tracking
  - Test specific crafting recipes (planks, sticks, pickaxe)
  - Test empty inventory and full inventory edge cases
  - Test JSON format validation
  - _File: test/inventory-tracker.test.js_
  - _Requirements: 4.1, 4.3, 4.4, 4.5_

- [ ] 6.4 Implement InventoryTracker class
  - Create InventoryTracker with getInventory(), trackConsumption(), trackAcquisition() methods
  - Implement publish() to update Blackboard
  - Implement hasItem() for availability checks
  - Add error handling for bot inventory API failures
  - _File: agent/inventory-tracker.js (신규)_
  - _Requirements: 4.1, 4.3, 4.4, 4.5_

- [ ] 6.5 Write property test for resource auto-collection
  - **Property 7: Resource Auto-Collection**
  - **Validates: Requirements 4.2**
  - Generate crafting scenarios with insufficient resources
  - Verify auto-collection is triggered
  - _File: test/builder-auto-collect.property.test.js_

- [ ]* 6.6 Write unit tests for resource auto-collection
  - Test specific resource shortage scenarios
  - Test collection priority logic
  - _File: test/builder-auto-collect.test.js_
  - _Requirements: 4.2_

- [ ] 6.7 Integrate InventoryTracker with Builder agent
  - Update Builder to use InventoryTracker
  - Implement auto-collection trigger on resource shortage
  - Track consumption during crafting operations
  - _File: agent/builder.js (수정)_
  - _Requirements: 4.1, 4.2, 4.4_

---

## Phase 4: Live Operations - Performance Optimization

### 7. Pathfinding Queue System

- [ ] 7.1 Write property test for pathfinding queue FIFO processing
  - **Property 8: Pathfinding Queue FIFO Processing**
  - **Validates: Requirements 6.1, 6.2**
  - Generate arbitrary sequences of pathfinding goals
  - Verify goals are processed in FIFO order
  - _File: test/pathfinding-queue.property.test.js_

- [ ] 7.2 Write property test for dynamic timeout calculation
  - **Property 9: Dynamic Timeout Calculation**
  - **Validates: Requirements 6.3**
  - Generate arbitrary distances (1-1000 blocks)
  - Verify timeout formula: baseTimeout + (distance / 50) * 30000ms
  - _File: test/pathfinding-queue.property.test.js_

- [ ] 7.3 Write property test for pathfinding retry on failure
  - **Property 10: Pathfinding Retry on Failure**
  - **Validates: Requirements 6.4**
  - Simulate pathfinding failures
  - Verify retry with alternative path (up to 3 attempts)
  - _File: test/pathfinding-queue.property.test.js_

- [ ] 7.4 Write property test for pathfinding metrics publishing
  - **Property 11: Pathfinding Metrics Publishing**
  - **Validates: Requirements 6.5**
  - Verify metrics (time, distance, success rate) are published to Blackboard
  - _File: test/pathfinding-queue.property.test.js_

- [ ]* 7.5 Write unit tests for pathfinding queue
  - Test specific distances (10, 50, 100, 500 blocks)
  - Test timeout calculation examples
  - Test retry scenarios (1, 2, 3 attempts)
  - _File: test/pathfinding-queue.test.js_
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [ ] 7.6 Implement PathfindingQueue class
  - Create PathfindingQueue with enqueue(), process() methods
  - Implement FIFO queue processing
  - Implement calculateTimeout() with dynamic formula
  - Implement retry logic with alternative paths (max 3 attempts)
  - Add error handling for bot disconnection
  - _File: agent/pathfinding-queue.js (신규)_
  - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [ ] 7.7 Implement PerformanceMetrics class
  - Create PerformanceMetrics to track pathfinding operations
  - Implement publishMetrics() to update Blackboard
  - _File: agent/performance-metrics.js (신규)_
  - _Requirements: 6.5_

- [ ] 7.8 Integrate PathfindingQueue with Builder agent
  - Update Builder navigation to use PathfindingQueue
  - Replace direct pathfinder calls with queue.enqueue()
  - _File: agent/builder-navigation.js (수정)_
  - _Requirements: 6.1, 6.2, 6.3, 6.4_

---

## Phase 5: Live Operations - E2E Testing

### 8. End-to-End Survival Verification

- [ ]* 8.1 Write E2E test for AC-1 (16 logs collection)
  - Verify 16 oak logs are collected
  - Check Blackboard key: `ac:1:logs`
  - _File: test/e2e-survival.test.js (신규)_
  - _Requirements: 5.1, 5.6_

- [ ]* 8.2 Write E2E test for AC-2 (3x3x3 shelter construction)
  - Verify 27 blocks in 3x3x3 configuration
  - Check Blackboard key: `ac:2:shelter`
  - _File: test/e2e-survival.test.js_
  - _Requirements: 5.2, 5.6_

- [ ]* 8.3 Write E2E test for AC-3 (basic tools crafting)
  - Verify wooden pickaxe, axe, and shovel are crafted
  - Check Blackboard key: `ac:3:tools`
  - _File: test/e2e-survival.test.js_
  - _Requirements: 5.3, 5.6_

- [ ]* 8.4 Write E2E test for AC-4 (all agents gather at shelter)
  - Verify all 9 agents are at shelter location
  - Check Blackboard key: `ac:4:agents`
  - _File: test/e2e-survival.test.js_
  - _Requirements: 5.4, 5.6_

- [ ]* 8.5 Write E2E test timeout and report generation
  - Set 1200 tick (10 minute) timeout
  - Generate JSON report in logs/ directory
  - _File: test/e2e-survival.test.js_
  - _Requirements: 5.5, 5.7_

- [ ] 8.6 Implement E2E test runner script
  - Create e2e-runner.js to execute E2E tests
  - Implement timeout handling (10 minutes)
  - Implement report generation (logs/e2e-{timestamp}.json)
  - Add error handling for test failures
  - _File: scripts/e2e-runner.js (신규)_
  - _Requirements: 5.5, 5.7_

- [ ] 8.7 Checkpoint - Ensure all Phase 2-5 tests pass
  - Run all tests: npm test
  - Verify 99.7% pass rate (1384/1388)
  - Ask user if questions arise

---

## Phase 6: Knowledge Bridge - NotebookLM Integration

### 9. NotebookLM MCP Server

- [ ] 9.1 Write property test for document search results format
  - **Property 12: Document Search Results Format**
  - **Validates: Requirements 7.2, 7.5**
  - Generate arbitrary search queries
  - Verify results have relevance scores (0-1)
  - Verify results are limited to top 5
  - _File: test/notebooklm-mcp.property.test.js_

- [ ]* 9.2 Write unit tests for NotebookLM MCP
  - Test specific search queries
  - Test syncProgress() functionality
  - Test MCP server start/stop
  - _File: test/notebooklm-mcp.test.js_
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [ ] 9.3 Implement NotebookLMMCP class
  - Create NotebookLMMCP with start(), searchDocs(), syncProgress() methods
  - Implement MCP server on configurable port
  - Implement searchDocs tool (query, limit → results[])
  - Implement syncProgress tool (acData → success)
  - Add error handling for API timeouts
  - _File: agent/notebooklm-mcp.js (신규)_
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

---

## Phase 7: Knowledge Bridge - Gemini Integration

### 10. Gemini Fast Q&A System

- [ ] 10.1 Write property test for API cost tracking
  - **Property 14: API Cost Tracking**
  - **Validates: Requirements 8.5**
  - Generate arbitrary sequences of API requests
  - Verify total cost does not exceed $1.00 daily limit
  - _File: test/gemini-client.property.test.js_

- [ ]* 10.2 Write unit tests for Gemini client
  - Test specific Q&A scenarios
  - Test 2-second response time requirement
  - Test cost tracking and daily limit enforcement
  - Test .env GEMINI_API_KEY usage
  - _File: test/gemini-client.test.js_
  - _Requirements: 8.1, 8.2, 8.3, 8.5, 8.6_

- [ ] 10.3 Implement GeminiClient class
  - Create GeminiClient with ask(), trackCost(), checkLimit() methods
  - Use Gemini Flash model for cost optimization
  - Implement cost tracking in Redis (gemini:daily_cost)
  - Implement daily limit enforcement ($1.00)
  - Add error handling for rate limits
  - _File: agent/gemini-client.js (신규)_
  - _Requirements: 8.1, 8.2, 8.3, 8.5, 8.6_

### 11. Knowledge Router

- [ ] 11.1 Write property test for knowledge router fallback
  - **Property 13: Knowledge Router Fallback**
  - **Validates: Requirements 8.4**
  - Generate questions requiring complex reasoning
  - Verify routing to Claude API instead of Gemini
  - _File: test/knowledge-router.property.test.js_

- [ ]* 11.2 Write unit tests for knowledge router
  - Test question classification (simple, document, complex)
  - Test routing to appropriate service
  - Test fallback chain (Gemini → Claude → Cached)
  - _File: test/knowledge-router.test.js_
  - _Requirements: 8.4_

- [ ] 11.3 Implement KnowledgeRouter class
  - Create KnowledgeRouter with route(), classifyQuestion() methods
  - Implement question classification logic
  - Implement routing: simple → Gemini, document → NotebookLM, complex → Claude
  - Implement fallback chain on errors
  - _File: agent/knowledge-router.js (신규)_
  - _Requirements: 8.4_

- [ ] 11.4 Integrate knowledge systems with Leader agent
  - Update Leader agent to use KnowledgeRouter
  - Connect NotebookLMMCP, GeminiClient, and Claude client
  - _File: agent/leader.js (수정)_
  - _Requirements: 7.1, 8.1, 8.4_

---

## Phase 8: Infrastructure - Multi-Server Support

### 12. Server Management System

- [ ] 12.1 Write property test for server selection on agent start
  - **Property 15: Server Selection on Agent Start**
  - **Validates: Requirements 9.2, 9.5**
  - Generate arbitrary server configurations
  - Verify selected server does not exceed max capacity
  - Verify load balancing rules are followed
  - _File: test/server-manager.property.test.js_

- [ ] 12.2 Write property test for server status publishing
  - **Property 16: Server Status Publishing**
  - **Validates: Requirements 9.3**
  - Verify server status is published to Blackboard
  - Verify key format: `servers:{serverId}:status`
  - _File: test/server-manager.property.test.js_

- [ ] 12.3 Write property test for server fallback on offline
  - **Property 17: Server Fallback on Offline**
  - **Validates: Requirements 9.4**
  - Simulate offline servers
  - Verify fallback to next available server by priority
  - _File: test/server-manager.property.test.js_

- [ ]* 12.4 Write unit tests for server manager
  - Test specific server configurations
  - Test connection failure scenarios
  - Test load balancing examples
  - _File: test/server-manager.test.js_
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

- [ ] 12.5 Create server configuration template
  - Create config/servers.json with example servers
  - Document server fields (id, host, port, priority, maxAgents)
  - _File: config/servers.json (신규)_
  - _Requirements: 9.1_

- [ ] 12.6 Implement ServerManager class
  - Create ServerManager with loadServers(), connect(), checkStatus() methods
  - Implement fallback() to try next available server
  - Implement publishStatus() to update Blackboard
  - Add error handling for connection timeouts
  - _File: agent/server-manager.js (신규)_
  - _Requirements: 9.1, 9.2, 9.3, 9.4_

- [ ] 12.7 Implement LoadBalancer class
  - Create LoadBalancer with selectServer(), getServerLoad(), rebalance() methods
  - Implement agent distribution based on server load
  - Respect server priority and maxAgents limits
  - _File: agent/load-balancer.js (신규)_
  - _Requirements: 9.2, 9.5_

- [ ] 12.8 Integrate ServerManager with MCP Orchestrator
  - Update MCP Orchestrator to use ServerManager for agent connections
  - Implement server selection on agent start
  - _File: agent/mcp-orchestrator.js (수정)_
  - _Requirements: 9.2_

---

## Phase 9: Infrastructure - KubeJS Plugin System

### 13. KubeJS Plugin Implementation

- [ ] 13.1 Write property test for block breaking event trigger
  - **Property 18: Block Breaking Event Trigger**
  - **Validates: Requirements 10.3**
  - Generate arbitrary player names and block types
  - Verify events only trigger for Octiv agents (name starts with 'Octiv_')
  - _File: test/kubejs-plugin.property.test.js_

- [ ] 13.2 Write property test for task completion rewards
  - **Property 19: Task Completion Rewards**
  - **Validates: Requirements 10.4**
  - Verify reward items are distributed on task completion
  - _File: test/kubejs-plugin.property.test.js_

- [ ]* 13.3 Write unit tests for KubeJS plugin
  - Test specific block breaking events
  - Test reward distribution examples
  - Test script loading validation
  - _File: test/kubejs-plugin.test.js_
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

- [ ] 13.4 Implement KubeJS agent events script
  - Create agent_events.js to handle block breaking events
  - Filter events by player name (starts with 'Octiv_')
  - Trigger custom events for agent actions
  - _File: server/kubejs/server_scripts/agent_events.js (신규)_
  - _Requirements: 10.2, 10.3_

- [ ] 13.5 Implement KubeJS rewards script
  - Create rewards.js to distribute task completion rewards
  - Define reward items for different task types
  - _File: server/kubejs/server_scripts/rewards.js (신규)_
  - _Requirements: 10.4_

- [ ] 13.6 Implement KubeJS initialization script
  - Create init.js to run on server startup
  - Initialize plugin configuration
  - _File: server/kubejs/startup_scripts/init.js (신규)_
  - _Requirements: 10.1, 10.5_

- [ ] 13.7 Document KubeJS plugin installation
  - Add KubeJS installation instructions to README.md
  - Document PaperMC server requirements
  - Document script directory structure
  - _File: README.md (수정)_
  - _Requirements: 10.1_

---

## Phase 10: Infrastructure - Collaboration Protocol

### 14. Anti-Gravity Collaboration Protocol

- [ ] 14.1 Create collaboration protocol documentation
  - Document Git-based code synchronization workflow
  - Define file ownership rules (CODEOWNERS format)
  - Define commit convention (emoji + 영문 설명)
  - Define branch strategy (main, dev, feature/*)
  - Document conflict resolution guide
  - _File: docs/collaboration.md (신규)_
  - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

- [ ] 14.2 Create CODEOWNERS file
  - Define file ownership rules for Claude and Anti-Gravity
  - _File: .github/CODEOWNERS (신규)_
  - _Requirements: 11.2_

- [ ] 14.3 Create Git sync workflow
  - Create GitHub Actions workflow for code synchronization
  - Implement automatic conflict detection
  - _File: .github/workflows/sync.yml (신규)_
  - _Requirements: 11.1_

- [ ] 14.4 Update README.md with collaboration guidelines
  - Add link to docs/collaboration.md
  - Document commit convention examples
  - _File: README.md (수정)_
  - _Requirements: 11.3_

---

## Phase 11: Final Integration and Testing

### 15. Integration and Wiring

- [ ] 15.1 Wire all components together in MCP Orchestrator
  - Integrate HeartbeatValidator, InventoryTracker, PathfindingQueue
  - Integrate ServerManager, LoadBalancer
  - Integrate KnowledgeRouter with NotebookLM and Gemini
  - _File: agent/mcp-orchestrator.js (수정)_
  - _Requirements: All_

- [ ] 15.2 Update package.json with new dependencies
  - Add fast-check for property-based testing
  - Add any new dependencies for NotebookLM, Gemini, etc.
  - _File: package.json (수정)_

- [ ]* 15.3 Run full test suite
  - Execute: npm test
  - Verify 99.7% pass rate (1384/1388)
  - Verify all property tests pass (100%)
  - Verify test execution time < 30 seconds for unit tests
  - _Requirements: 1.4, 1.5_

- [ ] 15.4 Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise

---

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests validate universal correctness properties (19 properties total)
- Unit tests validate specific examples and edge cases
- TDD approach: Write tests first, then implement, then refactor
- Checkpoints ensure incremental validation
- Parallel execution: Tasks within the same phase can be executed in parallel if they don't have dependencies

## Test Execution Commands

```bash
# Run all tests
npm test

# Run only unit tests
npm test -- --testPathPattern="test/.*\\.test\\.js" --testNamePattern="^((?!property).)*$"

# Run only property tests
npm test -- --testNamePattern="property"

# Run E2E tests
npm test -- test/e2e-survival.test.js

# Run specific test file
npm test -- test/heartbeat-validator.test.js
```

## Success Criteria

- ✅ Test suite stability: 99.7% pass rate (1384/1388 tests)
- ✅ All 19 correctness properties validated with property-based tests
- ✅ Documentation complete (README.md, config examples, collaboration.md)
- ✅ Health monitoring operational (heartbeat validation, Discord alerts)
- ✅ Inventory management operational (tracking, auto-collection)
- ✅ Performance optimization complete (pathfinding queue, metrics)
- ✅ E2E survival test passes (AC-1 through AC-4)
- ✅ Knowledge integration operational (NotebookLM, Gemini, routing)
- ✅ Multi-server infrastructure operational (server manager, load balancer)
- ✅ KubeJS plugin system operational (event handling, rewards)
- ✅ Collaboration protocol documented and implemented
