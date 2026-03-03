# /rc — Remote Control (Discord ↔ Claude Code bridge)

Manage and trigger agent workflows remotely via Discord commands.

## Architecture

```
Discord Bot (!cmd)  →  Redis Pub/Sub  →  Agent System
     ↑                                       |
     └──── Redis response channel ←──────────┘
```

## Discord Commands (remote triggers)

| Discord Cmd | What it triggers | Redis Channel |
|-------------|------------------|---------------|
| `!rc status` | Full system health check | `rc:cmd:status` |
| `!rc test` | Run npm test, report results | `rc:cmd:test` |
| `!rc ac` | Show AC progress matrix | `rc:cmd:ac` |
| `!rc deploy` | Trigger Ship Combo (preview only) | `rc:cmd:deploy` |
| `!rc log <n>` | Last N git commits | `rc:cmd:log` |
| `!rc agents` | List active agents + states | `rc:cmd:agents` |
| `!rc restart <agent>` | Restart specific agent | `rc:cmd:restart` |
| `!rc batch <ops>` | Run /batch remotely | `rc:cmd:batch` |
| `!rc plan <task>` | Trigger Plan Combo | `rc:cmd:plan` |

## Implementation Guide

### 1. Add to discord-bot.js
```javascript
// Remote Control handler
async _cmdRc(msg, args) {
  const [subcmd, ...rest] = args;
  const payload = { subcmd, args: rest, requester: msg.author.tag, ts: Date.now() };

  // Publish to RC channel
  await this.board.publish('rc:cmd:' + subcmd, payload);

  // Wait for response (timeout 30s)
  const response = await this.board.waitFor('rc:response:' + payload.ts, 30000);

  if (response) {
    await msg.reply('```\n' + response.output + '\n```');
  } else {
    await msg.reply('⏱️ Command timed out (30s)');
  }
}
```

### 2. Add RC listener to team.js
```javascript
// In Team.start(), subscribe to rc:cmd:*
async _setupRemoteControl() {
  const cmds = ['status', 'test', 'ac', 'deploy', 'log', 'agents', 'restart', 'batch', 'plan'];
  for (const cmd of cmds) {
    await this.board.subscribe('rc:cmd:' + cmd, async (payload) => {
      const result = await this._executeRcCommand(cmd, payload);
      await this.board.publish('rc:response:' + payload.ts, { output: result });
    });
  }
}
```

### 3. Security Rules
- Only authorized Discord roles can use `!rc` commands
- `!rc restart` and `!rc deploy` require ADMIN role
- All RC commands are logged to `rc:audit` Redis list
- Rate limit: 10 commands per minute per user
- Dangerous commands (restart, deploy) require confirmation emoji (✅)

## Local Usage
When invoked locally via `/rc`, show the RC system status:
1. Check if Discord bot is connected
2. Show last 5 RC commands from audit log
3. Show pending RC responses
