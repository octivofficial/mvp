# Requirements Document

## Introduction

The Telegram Bot Integration is a 3-agent AI system that enables frictionless development workflow through natural language interaction. The system consists of: (1) Telegram Bot - a Gemini 3.0 Flash-powered vibe coding translator that converts natural language ideas into PRDs, TDD plans, and implementation specs; (2) Obsidian Agent - a knowledge organizer that maintains clean Zettelkasten structure in the vault; (3) Discord Bot (existing) - an intermediary between humans and Minecraft OpenClaw bots. Together, these agents enable developers to describe features conversationally and receive organized, actionable technical specifications.

## Glossary

- **Telegram_Bot**: Gemini 3.0 Flash-powered AI development partner via Telegram API
- **Obsidian_Agent**: Knowledge organizer that maintains vault structure and prevents chaos
- **Discord_Bot**: Existing intermediary for Minecraft OpenClaw bot communication
- **Vibe_Coding**: Natural language feature description translated to formal specs
- **Gemini_3_Flash**: Google's Gemini 3.0 Flash model for AI reasoning
- **PRD**: Product Requirements Document generated from natural language
- **TDD_Plan**: Test-Driven Development plan with test cases
- **Implementation_Spec**: Technical specification with tasks and acceptance criteria
- **Zettelkasten**: Knowledge graph system in vault/ with atomic/compound/reasoning structure
- **Reasoning_Engine**: ReflexionEngine, RuminationEngine, GoTReasoner collective
- **Blackboard**: Redis-based coordination layer (port 6380)
- **Vault**: Obsidian vault at /Users/octiv/Octiv_MVP/vault/
- **Context_Awareness**: Bot's understanding of Octiv architecture and patterns
- **Clarifying_Question**: Question asked to refine understanding
- **Feasibility_Analysis**: Technical feasibility check using reasoning engines
- **MOC**: Map of Content - index file linking related notes
- **User**: Human developer interacting via Telegram

## Requirements

### Requirement 1: Telegram Bot Connection

**User Story:** As a developer, I want the Telegram bot to connect to Telegram API, so that I can interact via Telegram.

#### Acceptance Criteria

1. THE Telegram_Bot SHALL connect to Telegram API using TELEGRAM_BOT_TOKEN environment variable
2. WHEN token is invalid, THE Telegram_Bot SHALL log error and exit with non-zero status
3. WHEN connection succeeds, THE Telegram_Bot SHALL log bot username
4. THE Telegram_Bot SHALL auto-reconnect on network failures
5. THE Telegram_Bot SHALL gracefully disconnect on SIGTERM

### Requirement 2: Gemini 3.0 Flash API Integration

**User Story:** As a developer, I want the bot to use Gemini 3.0 Flash for reasoning, so that I get fast, high-quality AI responses.

#### Acceptance Criteria

1. THE Telegram_Bot SHALL initialize Gemini_3_Flash client using GEMINI_API_KEY environment variable
2. WHEN API key is missing, THE Telegram_Bot SHALL log error and exit with non-zero status
3. WHEN API request fails, THE Telegram_Bot SHALL retry up to 3 times with exponential backoff
4. THE Telegram_Bot SHALL log token usage for each API call
5. WHEN rate limit is exceeded, THE Telegram_Bot SHALL queue requests and retry after delay

### Requirement 3: Natural Language Conversation Interface

**User Story:** As a developer, I want to describe features in natural language, so that I can communicate ideas without formal syntax.

#### Acceptance Criteria

1. WHEN User sends message, THE Telegram_Bot SHALL acknowledge receipt within 2 seconds
2. THE Telegram_Bot SHALL maintain conversation context across multiple messages
3. WHEN User sends voice message, THE Telegram_Bot SHALL transcribe it to text
4. THE Telegram_Bot SHALL respond in conversational tone matching User's style
5. WHEN User sends code snippet, THE Telegram_Bot SHALL preserve formatting in analysis

### Requirement 4: PRD Generation from Vibe Coding

**User Story:** As a developer, I want vibe coding translated to PRDs, so that I get structured requirements from casual descriptions.

#### Acceptance Criteria

1. WHEN User describes feature, THE Telegram_Bot SHALL generate PRD within 30 seconds
2. THE Telegram_Bot SHALL include problem statement, goals, and success metrics in PRD
3. THE Telegram_Bot SHALL identify stakeholders and user personas in PRD
4. WHEN feature description is ambiguous, THE Telegram_Bot SHALL ask Clarifying_Question before generating PRD
5. THE Telegram_Bot SHALL format PRD using markdown with clear section headers

### Requirement 5: TDD Plan Generation

**User Story:** As a developer, I want TDD plans generated from PRDs, so that I have test-first development guidance.

#### Acceptance Criteria

1. WHEN PRD is complete, THE Telegram_Bot SHALL generate TDD_Plan within 45 seconds
2. THE Telegram_Bot SHALL include unit tests, integration tests, and edge cases in TDD_Plan
3. THE Telegram_Bot SHALL specify test data and expected outcomes for each test case
4. THE Telegram_Bot SHALL order tests from simplest to most complex
5. THE Telegram_Bot SHALL identify dependencies between test cases

### Requirement 6: Implementation Spec Generation

**User Story:** As a developer, I want implementation specs generated from TDD plans, so that I have actionable development tasks.

#### Acceptance Criteria

1. WHEN TDD_Plan is complete, THE Telegram_Bot SHALL generate Implementation_Spec within 60 seconds
2. THE Telegram_Bot SHALL break implementation into tasks with acceptance criteria
3. THE Telegram_Bot SHALL identify file paths and function signatures for each task
4. THE Telegram_Bot SHALL estimate complexity for each task as low, medium, or high
5. THE Telegram_Bot SHALL specify task dependencies and execution order

### Requirement 7: Context Awareness

**User Story:** As a developer, I want the bot to understand Octiv architecture, so that suggestions align with existing patterns.

#### Acceptance Criteria

1. THE Telegram_Bot SHALL load Octiv codebase structure on startup
2. THE Telegram_Bot SHALL reference existing agent roles when suggesting implementations
3. WHEN suggesting Redis usage, THE Telegram_Bot SHALL use Blackboard patterns from codebase
4. THE Telegram_Bot SHALL recommend CommonJS module syntax consistent with project
5. THE Telegram_Bot SHALL reference 眞善美孝永 validation patterns when applicable

### Requirement 8: Reasoning Engine Access via Cloud OpenClaw

**User Story:** As a developer, I want the bot to use a cloud-hosted OpenClaw reasoning engine, so that I get deep analysis and feasibility checks without overloading the local machine.

#### Acceptance Criteria

1. THE Telegram_Bot SHALL invoke an external Google Cloud-hosted OpenClaw instance for complex analysis (e.g., Feasibility Analysis, error recovery).
2. THE Telegram_Bot SHALL act as a proxy, forwarding vibe coding requests that require deep reasoning to the OpenClaw API or Webhook.
3. THE Telegram_Bot SHALL invoke local lightweight engines for immediate or simple tasks if connection to Cloud OpenClaw fails.
4. WHEN OpenClaw returns a result, THE Telegram_Bot SHALL incorporate the insights into its response and format it as a PRD or Spec.
5. THE Telegram_Bot SHALL log OpenClaw API invocations with execution time and explicitly state when external reasoning was used.

### Requirement 9: Zettelkasten Read Access

**User Story:** As a developer, I want the bot to read Zettelkasten notes, so that it leverages existing knowledge.

#### Acceptance Criteria

1. THE Telegram_Bot SHALL read files from vault/04-Skills/ directory on startup
2. WHEN User asks about skill, THE Telegram_Bot SHALL search Zettelkasten for relevant notes
3. THE Telegram_Bot SHALL parse markdown links to traverse note connections
4. THE Telegram_Bot SHALL extract code examples from skill notes when applicable
5. WHEN skill note is missing, THE Telegram_Bot SHALL inform User and suggest alternatives

### Requirement 10: Clarifying Questions

**User Story:** As a developer, I want the bot to ask clarifying questions, so that specs match my intent.

#### Acceptance Criteria

1. WHEN feature description lacks technical details, THE Telegram_Bot SHALL ask Clarifying_Question
2. THE Telegram_Bot SHALL limit clarifying questions to 3 per conversation turn
3. THE Telegram_Bot SHALL provide multiple choice options when applicable
4. WHEN User responds to question, THE Telegram_Bot SHALL incorporate answer into spec
5. THE Telegram_Bot SHALL not repeat previously answered questions in same conversation

### Requirement 11: Feasibility Analysis

**User Story:** As a developer, I want feasibility analysis for features, so that I know if ideas are practical.

#### Acceptance Criteria

1. WHEN User requests Feasibility_Analysis, THE Telegram_Bot SHALL evaluate technical constraints
2. THE Telegram_Bot SHALL identify required dependencies and their availability
3. THE Telegram_Bot SHALL estimate development time as hours or days
4. THE Telegram_Bot SHALL flag potential risks and mitigation strategies
5. THE Telegram_Bot SHALL rate feasibility as high, medium, or low with justification

### Requirement 12: Multiple Implementation Approaches

**User Story:** As a developer, I want multiple implementation options, so that I can choose the best approach.

#### Acceptance Criteria

1. WHEN generating Implementation_Spec, THE Telegram_Bot SHALL provide at least 2 approaches
2. THE Telegram_Bot SHALL compare approaches by complexity, performance, and maintainability
3. THE Telegram_Bot SHALL recommend one approach with clear reasoning
4. THE Telegram_Bot SHALL identify tradeoffs for each approach
5. WHEN User selects approach, THE Telegram_Bot SHALL generate detailed spec for that approach

### Requirement 13: Persistent Conversation History

**User Story:** As a developer, I want conversation history persisted, so that I can resume discussions later.

#### Acceptance Criteria

1. THE Telegram_Bot SHALL store conversation messages in Redis with 7 day TTL
2. THE Telegram_Bot SHALL retrieve last 20 messages when User resumes conversation
3. THE Telegram_Bot SHALL include message timestamp and User ID in stored data
4. WHEN Redis is unavailable, THE Telegram_Bot SHALL maintain in-memory history for current session
5. THE Telegram_Bot SHALL clear conversation history when User sends /reset command

### Requirement 14: Vault Directory Monitoring

**User Story:** As a developer, I want the Obsidian agent to monitor vault changes, so that organization happens automatically.

#### Acceptance Criteria

1. THE Obsidian_Agent SHALL watch Vault directory for file system changes
2. WHEN file is created, THE Obsidian_Agent SHALL process it within 5 seconds
3. WHEN file is modified, THE Obsidian_Agent SHALL reprocess it within 5 seconds
4. THE Obsidian_Agent SHALL ignore changes to .obsidian/ directory
5. THE Obsidian_Agent SHALL debounce rapid changes to same file with 2 second window

### Requirement 15: Document Organization by Type

**User Story:** As a developer, I want documents organized by type, so that vault structure stays clean.

#### Acceptance Criteria

1. WHEN PRD is created, THE Obsidian_Agent SHALL move it to vault/01-Requirements/ directory
2. WHEN TDD_Plan is created, THE Obsidian_Agent SHALL move it to vault/02-Tests/ directory
3. WHEN Implementation_Spec is created, THE Obsidian_Agent SHALL move it to vault/03-Implementation/ directory
4. WHEN skill note is created, THE Obsidian_Agent SHALL move it to vault/04-Skills/ directory
5. THE Obsidian_Agent SHALL preserve filename when moving files

### Requirement 16: Zettelkasten Structure Maintenance

**User Story:** As a developer, I want Zettelkasten structure maintained, so that knowledge graph stays navigable.

#### Acceptance Criteria

1. THE Obsidian_Agent SHALL ensure atomic notes have exactly one concept
2. THE Obsidian_Agent SHALL create bidirectional links between related notes
3. WHEN compound note is detected, THE Obsidian_Agent SHALL suggest splitting into atomic notes
4. THE Obsidian_Agent SHALL add tags based on note content and type
5. THE Obsidian_Agent SHALL maintain index notes for each directory

### Requirement 17: Duplicate Prevention

**User Story:** As a developer, I want duplicate notes prevented, so that knowledge stays consolidated.

#### Acceptance Criteria

1. WHEN new note is created, THE Obsidian_Agent SHALL check for existing notes with similar content
2. WHEN duplicate is detected with 80 percent similarity, THE Obsidian_Agent SHALL merge notes
3. THE Obsidian_Agent SHALL preserve all links from both notes during merge
4. THE Obsidian_Agent SHALL log merge actions to vault/logs/merges.md
5. WHEN merge is ambiguous, THE Obsidian_Agent SHALL notify User via Telegram_Bot

### Requirement 18: Auto-linking Related Concepts

**User Story:** As a developer, I want related concepts auto-linked, so that knowledge connections are explicit.

#### Acceptance Criteria

1. WHEN note mentions existing concept, THE Obsidian_Agent SHALL create wikilink to that concept
2. THE Obsidian_Agent SHALL scan all notes for linkable terms on startup
3. THE Obsidian_Agent SHALL limit auto-linking to first occurrence per note
4. THE Obsidian_Agent SHALL not create links within code blocks
5. THE Obsidian_Agent SHALL maintain glossary of linkable terms in vault/00-Meta/glossary.md

### Requirement 19: Orphaned File Cleanup

**User Story:** As a developer, I want orphaned files cleaned up, so that vault stays relevant.

#### Acceptance Criteria

1. THE Obsidian_Agent SHALL identify notes with zero incoming links
2. WHEN note has been orphaned for 30 days, THE Obsidian_Agent SHALL move it to vault/archive/
3. THE Obsidian_Agent SHALL exclude index notes and MOCs from orphan detection
4. THE Obsidian_Agent SHALL log cleanup actions to vault/logs/cleanup.md
5. WHEN archiving note, THE Obsidian_Agent SHALL preserve all outgoing links

### Requirement 20: MOC Generation

**User Story:** As a developer, I want MOCs generated automatically, so that I have navigation hubs.

#### Acceptance Criteria

1. WHEN directory contains more than 10 notes, THE Obsidian_Agent SHALL generate MOC
2. THE Obsidian_Agent SHALL group notes by tag in MOC
3. THE Obsidian_Agent SHALL sort notes alphabetically within each group
4. THE Obsidian_Agent SHALL update MOC when new notes are added to directory
5. THE Obsidian_Agent SHALL name MOC as "00-Index.md" in target directory

### Requirement 21: Markdown Validation

**User Story:** As a developer, I want markdown validated, so that notes render correctly.

#### Acceptance Criteria

1. WHEN note is created, THE Obsidian_Agent SHALL validate markdown syntax
2. WHEN broken wikilink is detected, THE Obsidian_Agent SHALL log warning with file path
3. THE Obsidian_Agent SHALL check for malformed headers and fix them
4. THE Obsidian_Agent SHALL ensure code blocks have closing backticks
5. WHEN validation fails, THE Obsidian_Agent SHALL notify User via Telegram_Bot

### Requirement 22: Naming Convention Enforcement

**User Story:** As a developer, I want naming conventions enforced, so that files are consistently named.

#### Acceptance Criteria

1. THE Obsidian_Agent SHALL enforce kebab-case for all note filenames
2. WHEN filename contains spaces, THE Obsidian_Agent SHALL rename with hyphens
3. THE Obsidian_Agent SHALL enforce YYYY-MM-DD prefix for daily notes
4. THE Obsidian_Agent SHALL update all wikilinks when renaming files
5. THE Obsidian_Agent SHALL log rename actions to vault/logs/renames.md

### Requirement 23: Telegram to Obsidian Data Flow

**User Story:** As a developer, I want Telegram conversations saved to Obsidian, so that specs persist in vault.

#### Acceptance Criteria

1. WHEN Telegram_Bot generates PRD, THE Telegram_Bot SHALL publish to Blackboard channel telegram:prd
2. THE Obsidian_Agent SHALL subscribe to telegram:prd channel
3. WHEN message received on telegram:prd, THE Obsidian_Agent SHALL create note in vault/01-Requirements/
4. THE Obsidian_Agent SHALL include conversation context as frontmatter in note
5. THE Obsidian_Agent SHALL complete file creation within 3 seconds of receiving message

### Requirement 24: Obsidian to Telegram Confirmation

**User Story:** As a developer, I want confirmation when notes are saved, so that I know specs are persisted.

#### Acceptance Criteria

1. WHEN Obsidian_Agent creates note, THE Obsidian_Agent SHALL publish confirmation to Blackboard channel obsidian:confirm
2. THE Telegram_Bot SHALL subscribe to obsidian:confirm channel
3. WHEN confirmation received, THE Telegram_Bot SHALL send message to User with vault file path
4. THE Telegram_Bot SHALL include clickable obsidian:// URI in confirmation message
5. WHEN file creation fails, THE Obsidian_Agent SHALL publish error to obsidian:error channel

### Requirement 25: Redis Blackboard Coordination

**User Story:** As a developer, I want agents coordinated via Redis, so that system is loosely coupled.

#### Acceptance Criteria

1. THE Telegram_Bot SHALL connect to Blackboard on port 6380
2. THE Obsidian_Agent SHALL connect to Blackboard on port 6380
3. THE Telegram_Bot SHALL publish messages with octiv:telegram: key prefix
4. THE Obsidian_Agent SHALL publish messages with octiv:obsidian: key prefix
5. WHEN Blackboard connection fails, THE Telegram_Bot SHALL retry connection every 5 seconds

### Requirement 26: Frictionless Workflow

**User Story:** As a developer, I want frictionless workflow from idea to spec, so that I stay in flow state.

#### Acceptance Criteria

1. THE Telegram_Bot SHALL complete full workflow from vibe coding to Implementation_Spec in under 2 minutes
2. THE Telegram_Bot SHALL not require User to switch applications during workflow
3. WHEN workflow step completes, THE Telegram_Bot SHALL automatically proceed to next step
4. THE Telegram_Bot SHALL allow User to interrupt workflow with /stop command
5. WHEN workflow completes, THE Telegram_Bot SHALL send summary with links to all generated documents

### Requirement 27: Configuration Management

**User Story:** As a developer, I want configuration via environment variables, so that deployment is flexible.

#### Acceptance Criteria

1. THE Telegram_Bot SHALL load configuration from .env file on startup
2. THE Telegram_Bot SHALL validate required environment variables and exit if missing
3. THE Telegram_Bot SHALL log configuration values on startup excluding secrets
4. WHEN environment variable is invalid, THE Telegram_Bot SHALL log descriptive error
5. THE Telegram_Bot SHALL support TELEGRAM_BOT_TOKEN, GEMINI_API_KEY, and BLACKBOARD_REDIS_URL variables

### Requirement 28: Error Handling and Resilience

**User Story:** As a developer, I want robust error handling, so that system recovers from failures.

#### Acceptance Criteria

1. WHEN unhandled exception occurs, THE Telegram_Bot SHALL log stack trace and continue operation
2. THE Telegram_Bot SHALL implement circuit breaker for Gemini_3_Flash API with 5 failure threshold
3. WHEN circuit breaker opens, THE Telegram_Bot SHALL notify User and queue requests
4. THE Telegram_Bot SHALL retry failed Redis operations up to 3 times
5. WHEN critical error occurs, THE Telegram_Bot SHALL send alert to configured admin user

### Requirement 29: Logging and Observability

**User Story:** As a developer, I want comprehensive logging, so that I can debug issues.

#### Acceptance Criteria

1. THE Telegram_Bot SHALL log all incoming messages with timestamp and User ID
2. THE Telegram_Bot SHALL log all API calls with latency and token usage
3. THE Telegram_Bot SHALL write logs to logs/telegram-bot-YYYY-MM-DD.log file
4. THE Telegram_Bot SHALL rotate log files daily and retain for 30 days
5. THE Telegram_Bot SHALL log at INFO level by default with DEBUG level configurable via LOG_LEVEL variable

### Requirement 30: Graceful Shutdown

**User Story:** As a developer, I want graceful shutdown, so that no data is lost on restart.

#### Acceptance Criteria

1. WHEN SIGTERM received, THE Telegram_Bot SHALL stop accepting new messages
2. THE Telegram_Bot SHALL complete in-flight API requests before shutdown
3. THE Telegram_Bot SHALL flush pending Redis writes before shutdown
4. THE Telegram_Bot SHALL disconnect from Telegram API and Blackboard cleanly
5. THE Telegram_Bot SHALL complete shutdown within 10 seconds or force exit

