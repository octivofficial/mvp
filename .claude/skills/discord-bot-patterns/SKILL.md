---
name: discord-bot-patterns
description: Discord.js bot patterns for Octiv — Embed design, Voice TTS queue, Forum management, reconnection logic, and command parsing for the NeoStarz Discord bridge.
---

# Discord Bot Patterns

Essential patterns for building production-grade Discord bots with discord.js v14+.

## When to Use
- Building Discord bot commands and event handlers
- Creating rich embeds with role-based colors
- Managing voice channels and TTS queues
- Handling forum threads and tags
- Implementing reconnection logic with exponential backoff
- Parsing and validating user commands

## Core Patterns

### 1. Embed Design with Role Colors

```javascript
const { EmbedBuilder } = require('discord.js');

// Role -> color mapping
const ROLE_COLORS = {
  leader:   0xe74c3c,  // Red
  builder:  0x2ecc71,  // Green
  safety:   0xe67e22,  // Orange
  explorer: 0x3498db,  // Blue
};
const DEFAULT_COLOR = 0x95a5a6;  // Gray

function createStatusEmbed(agentId, data) {
  const role = agentId.split('-')[0];
  const color = ROLE_COLORS[role] ?? DEFAULT_COLOR;
  
  const embed = new EmbedBuilder()
    .setTitle(`Agent Status: ${agentId}`)
    .setColor(color)
    .setTimestamp();
  
  if (data.health) {
    embed.addFields({ 
      name: 'Health', 
      value: `${data.health}/20`, 
      inline: true 
    });
  }
  
  return embed;
}
```

### 2. Voice TTS Queue Management

```javascript
const { joinVoiceChannel, createAudioPlayer, createAudioResource } = require('@discordjs/voice');

class VoiceManager {
  constructor(client, channelId, guildId) {
    this.client = client;
    this.channelId = channelId;
    this.guildId = guildId;
    this.connection = null;
    this.player = createAudioPlayer();
    this.queue = [];
    this.muted = false;
  }
  
  join() {
    const channel = this.client.channels.cache.get(this.channelId);
    if (!channel) return null;
    
    this.connection = joinVoiceChannel({
      channelId: this.channelId,
      guildId: this.guildId,
      adapterCreator: channel.guild.voiceAdapterCreator,
    });
    
    this.connection.subscribe(this.player);
    return this.connection;
  }
  
  speak(text, options = {}) {
    if (this.muted) return false;
    
    const priority = options.priority || 'NORMAL';
    const message = { text, priority, timestamp: Date.now() };
    
    if (priority === 'HIGH') {
      this.queue.unshift(message);  // High priority to front
    } else {
      this.queue.push(message);
    }
    
    this._processQueue();
    return true;
  }
  
  _processQueue() {
    if (this.queue.length === 0 || this.player.state.status === 'playing') {
      return;
    }
    
    const message = this.queue.shift();
    // Convert text to audio resource (TTS)
    const resource = this._textToSpeech(message.text);
    this.player.play(resource);
  }
  
  toggleMute() {
    this.muted = !this.muted;
    return this.muted;
  }
}
```

### 3. Forum Thread Management

```javascript
async function createForumThread(forumChannel, data) {
  // Cache forum tags for fast lookup
  const tagCache = new Map();
  if (forumChannel.availableTags) {
    for (const tag of forumChannel.availableTags) {
      tagCache.set(tag.name.toLowerCase(), tag.id);
    }
  }
  
  // Match tag name to ID
  const appliedTags = [];
  if (data.tag) {
    const tagId = tagCache.get(data.tag.toLowerCase());
    if (tagId) appliedTags.push(tagId);
  }
  
  const embed = new EmbedBuilder()
    .setAuthor({ name: data.author })
    .setColor(data.color || 0x95a5a6)
    .setDescription(data.message.slice(0, 4096))
    .setTimestamp();
  
  if (data.mood) {
    embed.setFooter({ text: `mood: ${data.mood}` });
  }
  
  await forumChannel.threads.create({
    name: data.title.slice(0, 100),
    message: { embeds: [embed] },
    appliedTags,
  });
}
```

### 4. Reconnection Logic (Exponential Backoff)

```javascript
class DiscordBot {
  constructor() {
    this.client = new Client({ intents: [...] });
    this._reconnectAttempts = 0;
    this.MAX_RECONNECT_ATTEMPTS = 5;
    this.BASE_RECONNECT_DELAY_MS = 1000;
  }
  
  async _reconnect() {
    if (this._reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      console.error('Max reconnect attempts reached, giving up');
      return;
    }
    
    this._reconnectAttempts++;
    const delay = Math.min(
      this.BASE_RECONNECT_DELAY_MS * Math.pow(2, this._reconnectAttempts - 1),
      30000  // Cap at 30 seconds
    );
    
    console.log(`Reconnect attempt ${this._reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS} in ${delay}ms`);
    await new Promise(r => setTimeout(r, delay));
    
    try {
      await this.client.login(this.token);
      this._reconnectAttempts = 0;  // Reset on success
      console.log('Reconnected successfully');
    } catch (err) {
      console.error('Reconnect failed:', err.message);
      this._reconnect();  // Retry
    }
  }
  
  start() {
    this.client.on('disconnect', () => {
      console.warn('Disconnected, attempting reconnect');
      this._reconnect();
    });
    
    this.client.on('error', (err) => {
      console.error('Client error:', err.message);
    });
  }
}
```

### 5. Command Parsing and Validation

```javascript
async function handleCommand(msg) {
  if (msg.author.bot) return;
  if (!msg.content.startsWith('!')) return;
  
  const [cmd, ...args] = msg.content.slice(1).split(/\s+/);
  
  // Command registry
  const commands = {
    help: { minArgs: 0, handler: cmdHelp },
    status: { minArgs: 0, handler: cmdStatus },
    assign: { minArgs: 2, handler: cmdAssign },
    reflexion: { minArgs: 0, handler: cmdReflexion },
  };
  
  const command = commands[cmd];
  if (!command) return;  // Ignore unknown commands
  
  // Validate argument count
  if (args.length < command.minArgs) {
    return msg.reply(`Usage: \`!${cmd}\` requires at least ${command.minArgs} arguments`);
  }
  
  // Execute command
  try {
    await command.handler(msg, args);
  } catch (err) {
    msg.reply(`Error executing command: ${err.message}`);
  }
}

async function cmdAssign(msg, args) {
  const [agentId, ...taskParts] = args;
  const task = taskParts.join(' ');
  
  // Sanitize input (prevent prompt injection)
  const sanitized = task.replace(/[<>@#]/g, '');
  
  // Publish to Redis Blackboard
  await board.publish('commands:assign', {
    author: 'discord-bot',
    agentId,
    task: sanitized,
  });
  
  msg.reply(`Task "${sanitized}" assigned to ${agentId}`);
}
```

### 6. Health Bar Visualization

```javascript
function createHealthBar(hp, maxHp = 20) {
  const filled = Math.ceil(hp / 2);
  const empty = 10 - filled;
  
  const hpBar = '❤️'.repeat(filled) + '🖤'.repeat(empty);
  return `${hpBar} ${hp}/${maxHp}`;
}

function createFoodBar(food, maxFood = 20) {
  const filled = Math.ceil(food / 2);
  const empty = 10 - filled;
  
  const foodBar = '🍗'.repeat(filled) + '🦴'.repeat(empty);
  return `${foodBar} ${food}/${maxFood}`;
}
```

## Best Practices

### Error Handling
- Always use `.catch()` on channel.send() to prevent unhandled rejections
- Log errors with context (channel name, message type)
- Implement graceful degradation (skip if channel not found)

### Rate Limiting
- Throttle frequent events (e.g., ReAct pulses every 30 seconds)
- Use Map to track last send time per agent/event
- Respect Discord API rate limits (50 requests per second)

### Security
- Sanitize all user input before publishing to Blackboard
- Filter prompt injection patterns (SafetyAgent.filterPromptInjection)
- Validate command arguments before execution

### Performance
- Cache forum tags on reconnect (avoid repeated API calls)
- Use optimistic locking for throttle maps
- Batch multiple embeds when possible

## Integration with Octiv

### Redis Blackboard Subscriptions
```javascript
// Subscribe to agent status updates
subscriber.pSubscribe('octiv:agent:*:status', (message, channel) => {
  const data = JSON.parse(message);
  postStatusEmbed(data);
});

// Subscribe to safety threats
subscriber.subscribe('octiv:safety:threat', (message) => {
  const data = JSON.parse(message);
  postAlertEmbed('threat', data);
  ttsSpeak(`Warning! ${data.threatType} detected`, { priority: 'HIGH' });
});
```

### Channel Configuration
```json
{
  "statusChannel": "1234567890",
  "alertsChannel": "1234567891",
  "commandsChannel": "1234567892",
  "voiceChannel": "1234567893",
  "forumChannel": "1234567894"
}
```

## Testing

### Mock Discord Client
```javascript
const mockClient = {
  guilds: {
    cache: new Map([
      ['guild-id', {
        channels: {
          cache: new Map([
            ['channel-id', { send: jest.fn() }]
          ])
        }
      }]
    ])
  }
};
```

### Test Embed Creation
```javascript
test('createStatusEmbed with builder role', () => {
  const embed = createStatusEmbed('builder-01', { health: 15 });
  expect(embed.data.color).toBe(0x2ecc71);  // Green
  expect(embed.data.title).toContain('builder-01');
});
```

## References
- [discord.js Guide](https://discordjs.guide/)
- [@discordjs/voice Documentation](https://discordjs.guide/voice/)
- [Discord API Rate Limits](https://discord.com/developers/docs/topics/rate-limits)
- Octiv: `agent/discord-bot.js`, `agent/voice-manager.js`
