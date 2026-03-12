# Octiv Collaboration Protocol

## Overview

This document defines the collaboration workflow between Claude (AI lead developer) and
Anti-Gravity (human collaborators) on the Octiv MVP project.

## Git Workflow

### Branch Strategy

- `main` — production-ready code (protected, all tests must pass)
- `dev` — integration branch for feature development
- `feature/*` — individual features (e.g., `feature/heartbeat-validator`)

### Commit Convention

Format: `emoji Phase-N: English description`

| Prefix | Use case |
|--------|----------|
| `feat:` | New feature |
| `fix:` | Bug fix |
| `test:` | Test additions/changes |
| `refactor:` | Code restructuring |
| `docs:` | Documentation only |
| `chore:` | Build/tooling/config |

Examples:
- `feat: HeartbeatValidator — agent liveness monitoring (Phase 2)`
- `fix: ReflexionEngine critical severity routing to skip Gemini`
- `test: Add property tests for shelter structure validation`

## File Ownership (CODEOWNERS)

See `.github/CODEOWNERS` for authoritative ownership rules.

| Owner | Domain |
|-------|--------|
| Claude | `agent/`, `test/`, `config/`, core infrastructure |
| Anti-Gravity | `server/kubejs/`, game design, Minecraft configs |
| Shared | `docs/`, `README.md`, `.github/workflows/` |

## Conflict Resolution

1. **Automated**: GitHub Actions runs `npm test` on every push — failing tests block merges
2. **Communication**: Use GitHub Issues for design discussions before implementation
3. **Escalation**: Architecture decisions → create GitHub Issue with `architecture` label
4. **TDD First**: All new features require tests before implementation (Red → Green → Refactor)

## Pull Request Process

1. Create feature branch from `dev`
2. Implement with TDD (tests first)
3. Ensure `npm test` passes locally (0 fail)
4. Open PR to `dev` (not `main`)
5. CI must be green before merge
6. Squash merge to keep history clean

## Code Review Checklist

- [ ] Tests written before implementation
- [ ] All tests pass (`npm test` → 0 fail)
- [ ] No console.log in agent files (use `log.info/warn/error`)
- [ ] board.publish() includes `author` field
- [ ] No hardcoded credentials or API keys
- [ ] New agent files follow structured logger pattern

## Sync Workflow

- **Session end**: `git push origin main` — all work pushed, CI validates
- **Knowledge sync**: Major milestones → NotebookLM source update (`add_source.py --all`)
- **Vault sync**: Auto-triggered by PostToolUse hooks on commit/test

## Contact

- GitHub: https://github.com/octivofficial/mvp
- Discord: NeoStarz server (`#neostarz-commands` for bot control)
