# Tech Stack

## Runtime & Language

- **Node.js**: >=20.0.0 (CommonJS modules)
- **JavaScript**: ES2022 syntax
- **Module System**: CommonJS (`require`/`module.exports`)

## Core Dependencies

### Minecraft Integration
- `mineflayer` (^4.35.0) - Minecraft bot framework
- `mineflayer-pathfinder` (^2.4.5) - Navigation and pathfinding
- `mineflayer-collectblock` (^1.6.0) - Block collection automation
- `minecraft-data` (^3.105.0) - Minecraft game data
- `vec3` (^0.1.10) - 3D vector math

### AI & LLM
- `@anthropic-ai/sdk` (^0.78.0) - Claude API client
- `groq-sdk` (^0.37.0) - Groq API client (optional)

### Communication
- `discord.js` (^14.16.0) - Discord bot integration (optional)
- `@discordjs/voice` (^0.19.0) - Voice channel support
- `@discordjs/opus` (^0.10.0) - Audio codec
- `node-edge-tts` (^1.2.10) - Text-to-speech engine

### Data & State Management
- `redis` (^5.11.0) - Shared memory/blackboard system
- `isolated-vm` (^6.1.0) - Sandboxed code execution

### Security
- `sodium-native` (^5.0.10) - Cryptographic operations

## Development Tools

- `eslint` (^10.0.2) - Code linting
- `@eslint/js` (^10.0.1) - ESLint base config
- `c8` (^11.0.0) - Code coverage reporting

## Testing

- **Framework**: Node.js built-in test runner (`node:test`)
- **Assertion**: `node:assert/strict`
- **Pattern**: Integration tests with real Redis (port 6380)

## Infrastructure

### Redis
- **Port**: 6380 (default for Blackboard)
- **Mode**: Standalone or cluster (configurable via `REDIS_CLUSTER_NODES`)
- **Purpose**: Agent coordination, shared memory, state persistence

### Minecraft Server
- **Type**: PaperMC 1.21.1
- **Port**: 25565 (Minecraft protocol)
- **RCON Port**: 25575 (remote console)
- **Mode**: Offline (no authentication)

### Web Services
- **Dashboard**: Port 3000 (HTTP server for monitoring)
- **MCP Server**: Port 3001 (Model Context Protocol)

## Common Commands

### Testing
```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test
npm run test:bot
npm run test:blackboard
```

### Development
```bash
# Lint code
npm run lint

# Check Redis connection
npm run redis:check

# Check system prerequisites
npm run preflight
```

### Running Services
```bash
# Start Minecraft server only
npm run server

# Start bot (single agent, deprecated)
npm run bot

# Start agent team (multi-agent orchestrator)
npm run team

# Start full stack (team + dashboard + MCP)
npm start

# Launch script (alternative)
npm run launch
```

### Monitoring
```bash
# Check team status
npm run status
```

## Build System

- No build step required (pure Node.js/CommonJS)
- Direct execution via `node` command
- Environment variables loaded via `--env-file-if-exists=.env`

## Environment Variables

Key variables (defined in `.env`):
- `MC_HOST` - Minecraft server host (default: localhost)
- `MC_PORT` - Minecraft server port (default: 25565)
- `MC_VERSION` - Minecraft version (default: 1.21.11)
- `RCON_PASSWORD` - RCON authentication password
- `BLACKBOARD_REDIS_URL` - Redis connection URL (default: redis://localhost:6380)
- `REDIS_CLUSTER_NODES` - Redis cluster nodes (if using cluster mode)
- `DISCORD_TOKEN` - Discord bot token (optional)
- `ANTHROPIC_API_KEY` - Claude API key
- `GROQ_API_KEY` - Groq API key (optional)

## Code Style

- **Indentation**: 2 spaces
- **Quotes**: Single quotes preferred
- **Semicolons**: Optional (not enforced)
- **Line Length**: No strict limit
- **Naming**: camelCase for variables/functions, PascalCase for classes
- **Unused vars**: Prefix with `_` to ignore warnings
- **Empty catch blocks**: Allowed (common for cleanup/fallback logic)
