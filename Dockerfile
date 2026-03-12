FROM node:22-slim

# Install system dependencies for Playwright and node-gyp
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    curl \
    gnupg \
    procps \
    libnss3 \
    libdbus-1-3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpangocairo-1.0-0 \
    libxshmfence1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --omit=dev

# Install Playwright browsers
RUN npx playwright install --with-deps chromium

# Copy application code
COPY . .

# Remove test files and dev tooling from image
RUN rm -rf test/ .claude/ vault/ .kiro/ npm-cache/ \
    eslint.config.mjs .c8rc.json

# Create vault directory (runtime data)
RUN mkdir -p vault/01-Requirements vault/02-Design vault/03-Implementation vault/04-Skills

# Expose web dashboard port (Minecraft + Redis managed by docker-compose services)
EXPOSE 3000

# Entrypoint: Team orchestrator
CMD ["node", "agent/team.js"]
