# Design Document

## System Architecture

### Overview

The Telegram Bot Integration is a 3-agent system enabling frictionless development workflow through natural language interaction. The system consists of:

1. **Telegram Bot** - Gemini 3.0 Flash-powered vibe coding translator
2. **Obsidian Agent** - Knowledge organizer maintaining vault structure
3. **Discord Bot** - Existing Minecraft OpenClaw bot intermediary

All agents communicate via Redis Blackboard (port 6380) for loose coupling and scalability.

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                         User Layer                           │
├─────────────────────────────────────────────────────────────┤
│  Telegram Client  │  Discord Client  │  Obsidian App        │
└────────┬──────────┴──────────┬───────┴──────────┬───────────┘
         │                     │                   │
    ┌────▼─────────┐     ┌────▼──────────┐   ┌───▼──────────┐
    │ Telegram Bot │     │ Discord Bot   │   │ Obsidian     │
    │ (Gemini 3.0) │     │ (Existing)    │   │ Agent        │
    └────┬─────────┘     └────┬──────────┘   └───┬──────────┘
         │                     │                   │
         └─────────────────────┼───────────────────┘
                               │
                      ┌────────▼─────────┐
                      │ Redis Blackboard │
                      │   (port 6380)    │
                      └────────┬─────────┘
                               │
         ┌─────────────────────┼─────────────────────┐
         │                     │                     │
    ┌────▼────────┐    ┌──────▼──────┐    ┌────────▼────────┐
    │ Gemini API  │    │ Zettelkasten│    │ Minecraft Server│
    │ (3.0 Flash) │    │   (Vault)   │    │  (PaperMC)      │
    └─────────────┘    └─────────────┘    └─────────────────┘
```

## Component Design

### Telegram Bot (agent/telegram-bot.js)

**Purpose**: AI development partner that translates natural language to technical specs

**Class**: `TelegramDevelopmentBot`

**Dependencies**:
- `node-telegram-bot-api` - Telegram API client
- `@google/generative-ai` - Gemini 3.0 Flash SDK
- `./blackboard.js` - Redis coordination
- `./ReflexionEngine.js` - Error analysis
- `./rumination-engine.js` - Deep reasoning
- `./got-reasoner.js` - Multi-step planning
- `./skill-zettelkasten.js` - Knowledge graph access

**Key Methods**:

```javascript
async init() {
  await this.board.connect();
  this.gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  this.model = this.gemini.getGenerativeModel({ model: 'gemini-3.0-flash' });
  this.bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
  this.setupMessageHandlers();
  this.loadZettelkasten();
}

async handleMessage(msg) {
  const chatId = msg.chat.id;
  const text = msg.text;
  
  // Store conversation history
  await this.storeConversation(chatId, text);
  
  // Get AI response from Gemini
  const response = await this.generateResponse(text);
  
  // Send to user
  await this.bot.sendMessage(chatId, response);
}

async generatePRD(vibeCoding) {
  // Use Gemini 3.0 Flash to generate PRD
  const prompt = this.buildPRDPrompt(vibeCoding);
  const result = await this.model.generateContent(prompt);
  const prd = result.response.text();
  
  // Publish to Blackboard
  await this.board.publish('telegram:prd', { content: prd, author: this.userId });
  
  return prd;
}

async generateTDD(prd) {
  // Generate TDD plan from PRD
  const prompt = this.buildTDDPrompt(prd);
  const result = await this.model.generateContent(prompt);
  const tdd = result.response.text();
  
  await this.board.publish('telegram:tdd', { content: tdd, author: this.userId });
  
  return tdd;
}

async generateSpec(tdd) {
  // Generate implementation spec from TDD
  const prompt = this.buildSpecPrompt(tdd);
  const result = await this.model.generateContent(prompt);
  const spec = result.response.text();
  
  await this.board.publish('telegram:spec', { content: spec, author: this.userId });
  
  return spec;
}
```

**Configuration**:
- Environment: TELEGRAM_BOT_TOKEN, GEMINI_API_KEY
- Redis: BLACKBOARD_REDIS_URL (default: redis://localhost:6380)
- Authorized users: TELEGRAM_AUTHORIZED_USERS

### Obsidian Agent (agent/obsidian-agent.js)

**Purpose**: Knowledge organizer maintaining vault structure

**Class**: `ObsidianOrganizer`

**Dependencies**:
- `chokidar` - File system watcher
- `remark` - Markdown parser
- `./blackboard.js` - Redis coordination

**Key Methods**:

```javascript
async init() {
  await this.board.connect();
  this.setupBlackboardSubscriptions();
  this.startVaultWatcher();
}

startVaultWatcher() {
  this.watcher = chokidar.watch(this.vaultPath, {
    ignored: /(^|[\/\\])\../,
    persistent: true,
    ignoreInitial: false
  });
  
  this.watcher
    .on('add', path => this.handleFileAdded(path))
    .on('change', path => this.handleFileChanged(path));
}

async handleFileAdded(filePath) {
  const content = await fs.readFile(filePath, 'utf8');
  const type = this.detectDocumentType(content);
  
  // Organize by type
  const targetDir = this.getTargetDirectory(type);
  await this.moveFile(filePath, targetDir);
  
  // Validate and enhance
  await this.validateMarkdown(filePath);
  await this.autoLinkConcepts(filePath);
  await this.checkDuplicates(filePath);
}

async organizeDocument(doc) {
  // Determine document type
  if (doc.includes('## Requirements')) return 'requirements';
  if (doc.includes('## Test Cases')) return 'tests';
  if (doc.includes('## Implementation')) return 'implementation';
  return 'misc';
}

async preventDuplicates(newFile) {
  const existing = await this.findSimilarNotes(newFile);
  if (existing.length > 0) {
    const similarity = this.calculateSimilarity(newFile, existing[0]);
    if (similarity > 0.8) {
      await this.mergeNotes(newFile, existing[0]);
    }
  }
}

async generateMOC(directory) {
  const files = await this.getFilesInDirectory(directory);
  const grouped = this.groupByTag(files);
  
  const moc = this.buildMOCContent(grouped);
  await fs.writeFile(`${directory}/00-Index.md`, moc);
}
```

**Directory Structure**:
```
vault/
├── 00-Meta/
│   └── glossary.md
├── 01-Requirements/
│   └── *.md (PRDs)
├── 02-Tests/
│   └── *.md (TDD plans)
├── 03-Implementation/
│   └── *.md (Specs)
├── 04-Skills/
│   ├── atomic/
│   ├── compound/
│   └── reasoning/
├── 05-Live/
│   └── agents/*.md
├── archive/
│   └── *.md (orphaned files)
└── logs/
    ├── merges.md
    ├── cleanup.md
    └── renames.md
```

## Data Models

### PRD Document
```javascript
{
  type: 'prd',
  title: string,
  author: string,
  timestamp: number,
  content: {
    problem: string,
    goals: string[],
    stakeholders: string[],
    requirements: string[]
  }
}
```

### TDD Plan
```javascript
{
  type: 'tdd',
  title: string,
  author: string,
  timestamp: number,
  content: {
    unitTests: TestCase[],
    integrationTests: TestCase[],
    edgeCases: TestCase[]
  }
}
```

### Implementation Spec
```javascript
{
  type: 'spec',
  title: string,
  author: string,
  timestamp: number,
  content: {
    tasks: Task[],
    dependencies: string[],
    files: string[]
  }
}
```

## Redis Blackboard Channels

### Published by Telegram Bot
- `octiv:telegram:prd` - PRD documents
- `octiv:telegram:tdd` - TDD plans
- `octiv:telegram:spec` - Implementation specs
- `octiv:telegram:question` - Clarifying questions

### Published by Obsidian Agent
- `octiv:obsidian:confirm` - File creation confirmations
- `octiv:obsidian:error` - Error notifications
- `octiv:obsidian:duplicate` - Duplicate detection alerts

## Error Handling Strategy

### Telegram Bot Errors
1. **Gemini API Failure**: Retry 3x with exponential backoff, fallback to cached response
2. **Rate Limit**: Queue requests, notify user of delay
3. **Invalid Input**: Ask clarifying question, provide examples
4. **Blackboard Disconnect**: Buffer messages, reconnect automatically

### Obsidian Agent Errors
1. **File System Error**: Log error, retry operation, notify via Blackboard
2. **Duplicate Detection**: Prompt user for merge decision via Telegram
3. **Validation Failure**: Fix automatically if possible, otherwise log warning
4. **Blackboard Disconnect**: Continue file operations, sync when reconnected

## Security Considerations

1. **Authentication**: Validate TELEGRAM_AUTHORIZED_USERS before processing
2. **API Keys**: Never log GEMINI_API_KEY or TELEGRAM_BOT_TOKEN
3. **Input Validation**: Sanitize all user input before processing
4. **File System**: Restrict vault operations to configured OBSIDIAN_VAULT_PATH
5. **Redis**: Use authentication if BLACKBOARD_REDIS_URL includes credentials

## Performance Optimization

1. **Caching**: Cache Zettelkasten index in memory, refresh every 5 minutes
2. **Batching**: Batch Blackboard publishes when multiple documents generated
3. **Debouncing**: Debounce file system events with 2 second window
4. **Connection Pooling**: Reuse Redis connections across operations
5. **Lazy Loading**: Load reasoning engines only when needed

## Deployment Architecture

```
┌─────────────────────────────────────────┐
│         Production Environment           │
├─────────────────────────────────────────┤
│  Process Manager: PM2                   │
│  ├── telegram-bot (agent/telegram-bot.js)│
│  ├── obsidian-agent (agent/obsidian-agent.js)│
│  └── discord-bot (agent/discord-bot.js) │
├─────────────────────────────────────────┤
│  Redis: localhost:6380                  │
│  Vault: /Users/octiv/Octiv_MVP/vault/  │
└─────────────────────────────────────────┘
```

**Startup Order**:
1. Redis Blackboard
2. Obsidian Agent (subscribes to channels)
3. Telegram Bot (starts accepting messages)
4. Discord Bot (already running)

**Health Checks**:
- Telegram Bot: Ping Telegram API every 60s
- Obsidian Agent: Check vault directory exists every 30s
- Blackboard: Redis PING command every 10s

## Testing Strategy

### Unit Tests
- Test each method in isolation with mocked dependencies
- Use `node:test` framework
- Mock Gemini API responses
- Mock file system operations

### Integration Tests
- Test Telegram → Blackboard → Obsidian flow
- Use real Redis on port 6380
- Use temporary test vault directory
- Clean up test data after each run

### E2E Tests
- Send real Telegram message
- Verify PRD/TDD/Spec generation
- Verify file creation in vault
- Verify confirmation message received

## Monitoring and Observability

### Metrics to Track
- Message processing latency (p50, p95, p99)
- Gemini API token usage per request
- File creation success rate
- Duplicate detection rate
- Error rate by type

### Logging
- Structured JSON logs
- Log levels: DEBUG, INFO, WARN, ERROR
- Correlation IDs for request tracing
- Daily log rotation

### Alerts
- Gemini API quota exceeded
- Redis connection lost
- Vault directory inaccessible
- High error rate (>5% in 5 minutes)
