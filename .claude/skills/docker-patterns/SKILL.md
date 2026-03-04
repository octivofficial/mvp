# Docker Patterns

## Purpose
Best practices for Docker configuration in the Octiv project.
Covers PaperMC server, Redis, and development environment.

## Current Infrastructure
- **Redis**: Docker container, port 6379 -> 6380 (host)
- **PaperMC**: localhost:25565 (offline-mode)
- **RCON**: localhost:25575

## Docker Compose Best Practices

### Health Checks
```yaml
services:
  redis:
    image: redis:7-alpine
    ports:
      - "6380:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 3
      start_period: 5s
    restart: unless-stopped
```

### Volume Strategy
```yaml
volumes:
  redis-data:
    driver: local

services:
  redis:
    volumes:
      - redis-data:/data           # persistent data
      - ./redis.conf:/etc/redis/redis.conf:ro  # read-only config
```

### Security Hardening
- Use `read_only: true` for containers that don't need write access
- Set `security_opt: [no-new-privileges:true]`
- Drop all capabilities, add only needed: `cap_drop: [ALL]`
- Use non-root users in Dockerfiles
- Pin image versions (never use `latest` in production)

### Multi-Stage Builds (for future Node.js containerization)
```dockerfile
# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --production

# Runtime stage
FROM node:20-alpine
RUN addgroup -S octiv && adduser -S octiv -G octiv
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY . .
USER octiv
CMD ["node", "agent/team.js"]
```

### Environment Separation
```yaml
# docker-compose.override.yml (dev only, gitignored)
services:
  redis:
    ports:
      - "6380:6379"  # exposed for local dev
    command: redis-server --loglevel debug

# docker-compose.prod.yml
services:
  redis:
    ports: []  # no host exposure
    command: redis-server --requirepass ${REDIS_PASSWORD}
```

## Octiv-Specific Patterns

### Redis Container Management
```bash
# Start Redis for development
docker compose up -d redis

# Check health
docker compose ps
redis-cli -p 6380 ping

# View logs
docker logs octiv-redis --tail 50

# Graceful shutdown (preserves data)
docker compose stop redis
```

### PaperMC Container (future)
```yaml
services:
  papermc:
    image: itzg/minecraft-server
    environment:
      TYPE: PAPER
      VERSION: "1.21.1"
      EULA: "TRUE"
      ONLINE_MODE: "FALSE"
      ENABLE_RCON: "TRUE"
      RCON_PASSWORD: ${RCON_PASSWORD}
    ports:
      - "25565:25565"
      - "25575:25575"
    volumes:
      - mc-data:/data
```

## Activation
Use this skill when:
- Modifying `docker-compose.yml`
- Adding new containers to the stack
- Debugging container connectivity issues
- Planning production deployment

## Anti-Patterns
- Using `latest` tag in production
- Storing secrets in Dockerfile or docker-compose.yml
- Running containers as root
- Not setting resource limits in production
- Using `docker run` instead of `docker compose` for multi-container setups
