# Tech Debt Refactoring — Handoff for Claude Code

**Date**: 2026-03-13
**Completed by**: Cowork (analysis + code changes)
**Handoff to**: Claude Code (commit, push, token rotation, remaining tasks)

---

## ✅ COMPLETED (ready to commit)

### 1. Security: bot-config.json token removal
- **Files changed**: `config/bot-config.json`, `agent/team.js`
- Removed hardcoded Telegram token, Discord token references
- All secrets now `.env`-only; non-secret defaults remain in JSON
- `bot-config.json` was never committed to git (confirmed: not in history)

### 2. Architecture: team.js module split
- **New files**: `agent/team-plugins.js` (140 lines), `agent/team-rc.js` (93 lines)
- **Modified**: `agent/team.js` (689 → 507 lines, -26%)
- Plugin init extracted to `team-plugins.js`
- Remote Control handler extracted to `team-rc.js`
- `setupRemoteControl` re-exported from team.js for backward compat
- Fixed unhandled promise rejection in `setInterval` (status poll)

### 3. Reliability: Log rotation in memory-logger.js
- **Modified**: `agent/memory-logger.js`
- 5MB max per agent log, 3 rotated generations (.1, .2, .3)
- Size cache avoids stat() on every write
- `clear()` now also removes rotated files
- **New tests**: 3 rotation tests added to `test/memory-logger.test.js`

### 4. Debugging: Empty .catch(() => {}) → log.debug
- **12 files modified**:
  - `agent/builder.js`, `agent/leader.js`, `agent/safety.js`
  - `agent/roles/ExplorerAgent.js`, `agent/roles/MinerAgent.js`, `agent/roles/FarmerAgent.js`, `agent/roles/BaseRole.js`
  - `agent/telegram-bot.js`, `agent/discord-bot.js`
  - `agent/lm-studio-client.js`, `agent/api-clients.js`
  - `agent/team.js` (shutdown handlers)
- Added missing `getLogger` imports to ExplorerAgent, MinerAgent, FarmerAgent

### 5. Cleanup: Legacy files archived
- **Moved**: `telegram-bot.legacy.js`, `octivia.legacy.js` → `agent/_archived/`
- Confirmed: no references from any other file

### 6. New test files
- `test/team-plugins.test.js` — plugin initialization tests
- `test/memory-logger.test.js` — 3 rotation tests added

---

## 🔧 ACTION REQUIRED (Claude Code)

### A. Commit & Push
```bash
# Stage all changes
git add agent/team.js agent/team-plugins.js agent/team-rc.js \
        agent/memory-logger.js agent/builder.js agent/leader.js \
        agent/safety.js agent/roles/ExplorerAgent.js \
        agent/roles/MinerAgent.js agent/roles/FarmerAgent.js \
        agent/roles/BaseRole.js agent/telegram-bot.js \
        agent/discord-bot.js agent/lm-studio-client.js \
        agent/api-clients.js agent/_archived/ \
        config/bot-config.json \
        test/memory-logger.test.js test/team-plugins.test.js \
        test/test-quality.test.js \
        docs/TECH_DEBT_HANDOFF.md

git commit -m "🔧 Phase-2: Tech debt cleanup — security, modularity, log rotation, error visibility

- Remove hardcoded secrets from bot-config.json (env-only)
- Split team.js into team-plugins.js + team-rc.js (-26% lines)
- Add log rotation to memory-logger.js (5MB max, 3 generations)
- Replace 50+ empty .catch(() => {}) with log.debug across 12 files
- Archive legacy telegram-bot/octivia files
- Add rotation tests + team-plugins tests
- Fix unhandled promise rejection in status poll interval"

git push origin main
```

### B. Telegram Token Rotation (MANUAL)
The token in `config/bot-config.json` was never in git history, but it should still be rotated:
1. Go to @BotFather on Telegram
2. `/revoke` the token `8544103104:AAE...`
3. Generate a new token
4. Update `.env` with the new `TELEGRAM_BOT_TOKEN=...`

### C. .env Template Update
Already done — `TELEGRAM_AUTHORIZED_USERS` is in `.env.example`.

---

### 7. Discord bot split (Phase-2 continuation)
- **Modified**: `agent/discord-bot.js` (1037 → 440 lines, -57%)
- **New files**: `agent/discord-embeds.js` (298 lines), `agent/discord-commands.js` (390 lines)
- Embed builders extracted as pure functions (no channel.send)
- Command handlers extracted via `createCommandHandlers(bot)` factory pattern
- All exports preserved for backward compatibility (discord.test.js unchanged)

### 8. Gemini client archived
- **Moved**: `agent/gemini-client.js` → `agent/_archived/gemini-client.js`
- **Moved**: `test/gemini-client.test.js` → `agent/_archived/gemini-client.test.js`
- Orphaned module with 0 production imports (api-clients.js factory superseded it)

---

## 📋 REMAINING TECH DEBT (future sessions)

### Priority: HIGH
1. ~~**Split discord-bot.js**~~ ✅ Done (Phase-2 continuation)
2. ~~**Fix 2 skipped tests**~~ ✅ Done (d2aebb4)
3. ~~**Strengthen weak tests**~~ ✅ 7 assertions strengthened (d2aebb4)

### Priority: MEDIUM
4. ~~**Consolidate LLM client paths**~~ ✅ `gemini-client.js` archived (api-clients.js is canonical)
5. ~~**Flag dormant agents**~~ ✅ ENABLE_CRAWLER/WORKSPACE/YOUTUBE env vars (db85cde)
6. ~~**Config consolidation**~~ N/A — `discord.json` has `.env` fallback already; no change needed

### Priority: LOW
7. ~~**Dependency updates**~~ Assessed: `chokidar` 3→5 (HIGH risk — API breaking), `groq-sdk` 0→1 (LOW risk but optional). Both optional paths, no security vulns. **Deferred.**
8. ~~**Return value validation**~~ ✅ Fixed: defensive `.copy()` check in `isolated-vm-sandbox.js`

---

## 📊 Verification Results

```
Lint:     0 errors, 0 warnings
Tests:    1878 total, 1867 pass, 0 fail, 11 skip
```
