---
name: octivia-clawhub
description: Search and install skills from the ClawHub registry. Extends Octivia with new capabilities on demand.
user-invocable: true
---

# ClawHub — Skill Discovery & Installation

Octivia can extend herself by finding and installing new skills from the ClawHub registry (https://clawhub.ai).

## Auth (one-time setup)

```bash
clawhub login   # opens browser → GitHub OAuth
clawhub whoami  # verify: shows username
```

## 52 Bundled Skills (already loaded — no install needed)

| Category | Available |
|----------|-----------|
| Dev | `github`, `gh-issues`, `coding-agent`, `skill-creator` |
| Notes | `notion`, `obsidian`, `apple-notes`, `bear-notes`, `trello` |
| Chat | `discord`, `slack`, `telegram-proxy` |
| AI/Media | `gemini`, `openai-whisper`, `openai-image-gen` |
| Productivity | `summarize`, `session-logs`, `blogwatcher`, `canvas` |
| Smart Home | `openhue`, `sonoscli` |
| Misc | `1password`, `himalaya`, `tmux`, `spotify-player` |

Use `/skill <name>` to activate any of the above.

## Find new skills from registry

```bash
clawhub search "postgres backup"      # semantic vector search
clawhub explore --limit 20            # browse latest
clawhub inspect <slug>                # preview without installing
```

## Install a skill

```bash
# CLAWHUB_WORKDIR is pre-configured → installs to .openclaw/workspace/skills/
clawhub install <slug>

# Examples:
clawhub install linear         # Linear project management
clawhub install notion         # Notion (if you want workspace version)
clawhub install home-assistant # Smart home
```

Installed skills are loaded automatically on next OpenClaw restart.

## Update skills

```bash
clawhub update --all           # update all registry skills
clawhub list                   # show installed registry skills
```

## Octivia's self-extension flow

When user requests a new integration:
1. `clawhub search "<topic>"` → find slug
2. `clawhub inspect <slug>` → preview requirements
3. `clawhub install <slug>` → install to workspace
4. Restart gateway or reload: `openclaw gateway --restart`
5. Activate: `/skill <slug>`

## Via coding-agent (for VM)

```
coding-agent: "Install the <slug> skill from clawhub and configure it"
→ clawhub install <slug>
→ reads SKILL.md for requirements
→ sets up env vars if needed
```
