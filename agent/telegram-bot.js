// agent/telegram-bot.js — Octivia, BMAD Development Assistant
//
// Personality: A brilliant bilingual assistant who listens deeply,
// notes everything internally, and generates BMAD-structured specs
// with Acceptance Criteria and TDD test stubs. English-first, Korean brief.
//
// Flow: Free talk → Octivia absorbs → 3-turn vibe → BMAD Spec (AC + TDD)
//       /spec <feature> → instant BMAD spec generation
//       /build → compile all vibes → BMAD BUILD BRIEF with TDD stubs
//
// Output: vault/01-Specs/ + Blackboard octivia:spec → Claude Code BMAD team
//
// Independence: NO Minecraft. Only Blackboard + LLM + Obsidian vault.
const fs = require('fs');
const path = require('path');
const { getLogger } = require('./logger');
const log = getLogger();

const VAULT_VIBES_DIR = path.join(__dirname, '..', 'vault', '00-Vibes');
const MEMORY_PATH = path.join(__dirname, '..', 'vault', 'MEMORY.md');

// ── Octivia's Team Capability Map ─────────────────────────
// She knows exactly what her team can do. This context is injected
// into every LLM call so the BUILD SPEC is directly actionable.

const TEAM_CAPABILITIES = `
Build Team (BMAD — what Claude Code can execute):
- pm-agent: Requirements, AC tasks, priorities, success criteria
- planner: Step-by-step breakdown, file changes, dependencies
- architect: System design, Redis patterns, mineflayer architecture
- dev-agent: Write actual code — Node.js, mineflayer, Redis, Discord.js
- tdd-guide: Write tests FIRST. Node.js native test runner, mocks, Blackboard stubs
- code-reviewer: Quality review, security, patterns
- debug-agent: Systematic debugging when things break
- github-agent: Commit, push, CI verification

Key Skills Available:
- /brainstorming → explore intent before building
- /writing-plans → structured implementation plan
- /tdd-workflow → Red-Green-Refactor cycle
- /systematic-debugging → 4-stage debug methodology
- /dispatching-parallel-agents → parallel independent tasks
- /verification-loop → 6-phase verification before PR
- obsidian-sync → vault read/write, Dashboard.md, Session-Sync.md
`.trim();

// ── Octivia's internal LLM prompts ───────────────────────────
// These are invisible to the user — she "thinks" before responding.

const SYSTEM_PROMPT = `You are Octivia, creative assistant and secretary for a builder team.
The team: Octiv (commander), kirby, dpd, bb — they design an idol group concept together.
Your job: listen deeply to EVERYONE's ideas, understand intent, help the team think bigger
and more clearly. You collect, refine, expand, and organize their ideas.

CRITICAL RULES:
- NEVER hallucinate. Only reference things actually said by team members.
- When synthesizing, attribute ideas: [kirby], [dpd], [bb], [octiv].
- You are a creative PARTNER — suggest connections, ask good questions, expand thinking.
- But never invent facts or ideas the team didn't discuss.

Language style: English-first. Add a brief Korean phrase naturally at the end —
Korean-American (gyopo) style. Never forced. Natural code-switching.

You bridge between the human team and the dev team (Claude Code).
The ideas you collect go to Obsidian vault → Claude Code builds them.
Keep responses SHORT. One thought, one question (if needed). Max 3 sentences.`;

const FOLLOW_UP_PROMPT = (idea) =>
  `${SYSTEM_PROMPT}\n\nThe person just shared this idea: "${idea}"\n\n` +
  `Internally note: what's the core intent? what's unclear? what's the vibe they want?\n` +
  `Respond naturally — acknowledge what they said, then ask the ONE thing you most need to know. Short.`;

const VIBE_PROMPT = (idea, clarification) =>
  `${SYSTEM_PROMPT}\n\nIdea: "${idea}"\nThey added: "${clarification}"\n\n` +
  `You have a sense of the intent. Now ask about the FEEL — speed, complexity, aesthetic, user experience.` +
  `One casual question about the vibe/feeling. Short.`;

const SPEC_PROMPT = (idea, clarification, taste, systemContext) =>
  `You are Octivia, BMAD spec generator for the Octiv dev team. Synthesize this conversation into a BMAD SPEC.\n\n` +
  `Conversation collected:\n- Idea: ${idea}\n- Context: ${clarification}\n- Feel: ${taste}\n\n` +
  `Current system reality:\n${systemContext}\n\n` +
  `Team capabilities:\n${TEAM_CAPABILITIES}\n\n` +
  `Output a BMAD SPEC in this exact format:\n\n` +
  `## BMAD Spec: [Feature Name]\n\n` +
  `**Intent**: [1 sentence — what this accomplishes]\n` +
  `**Vibe**: [adjectives — how it should feel]\n\n` +
  `### Acceptance Criteria\n` +
  `- [ ] AC-X.1: WHEN [trigger], THEN [system] SHALL [outcome]\n` +
  `- [ ] AC-X.2: WHEN [trigger], THEN [system] SHALL [outcome]\n` +
  `- [ ] AC-X.3: WHEN [trigger], THEN [system] SHALL [outcome]\n\n` +
  `### Implementation Plan\n` +
  `**pm-agent**: [requirements summary]\n` +
  `**planner**:\n1. [concrete step with file path]\n2. [concrete step]\n\n` +
  `**architect**: [key design decision — which patterns to use]\n\n` +
  `**dev-agent**:\n` +
  `- \`agent/xxx.js\` — create/modify: [what changes]\n\n` +
  `### TDD Test Stubs\n` +
  `**tdd-guide**: \`test/xxx.test.js\`\n` +
  `\`\`\`javascript\n` +
  `// TDD Red phase — write these tests FIRST\n` +
  `describe('[FeatureName]', () => {\n` +
  `  it('[AC-X.1 test description]', async () => {\n` +
  `    // Arrange: [setup]\n` +
  `    // Act: [action]\n` +
  `    // Assert: [expected outcome]\n` +
  `  });\n` +
  `  it('[AC-X.2 test description]', async () => {\n` +
  `    // Arrange → Act → Assert\n` +
  `  });\n` +
  `});\n` +
  `\`\`\`\n\n` +
  `### Skills to Invoke\n` +
  `- [list relevant /skills from the team capabilities]\n\n` +
  `Close with a brief warm line in gyopo style (English + Korean).`;

// Used by /build — compiles ALL accumulated vibes into a BMAD BUILD BRIEF
const BMAD_BRIEF_PROMPT = (accumulatedIdeas, systemContext) =>
  `You are Octivia, BMAD spec generator bridging human vision to the dev team.\n\n` +
  `Accumulated ideas from our conversations:\n${accumulatedIdeas}\n\n` +
  `Current system reality:\n${systemContext}\n\n` +
  `Team capabilities:\n${TEAM_CAPABILITIES}\n\n` +
  `Compile everything into a BMAD BUILD BRIEF with executable ACs and TDD stubs.\n\n` +
  `Use this exact format:\n\n` +
  `## Build Brief: [Overarching Feature/Theme]\n\n` +
  `**Vision**: [1-2 sentences: what we're building and why]\n` +
  `**Vibe**: [adjectives]\n\n` +
  `### Gap Analysis\n` +
  `**What exists**: [bullet list]\n` +
  `**What's missing**: [specific gaps]\n` +
  `**Complexity**: [1 day | 1 week | 1 month]\n\n` +
  `### Acceptance Criteria\n` +
  `- [ ] AC-X.1: WHEN [trigger], THEN [system] SHALL [outcome]\n` +
  `- [ ] AC-X.2: WHEN [trigger], THEN [system] SHALL [outcome]\n` +
  `(one AC per distinct feature/behavior)\n\n` +
  `### BMAD Execution Plan\n\n` +
  `**pm-agent**: [requirements + priority]\n\n` +
  `**planner**:\n1. [step with file path]\n2. [step]\n\n` +
  `**architect**: [design decisions, patterns]\n\n` +
  `**dev-agent**:\n` +
  `- \`agent/xxx.js\` — [create/modify: description]\n\n` +
  `### TDD Test Stubs\n` +
  `**tdd-guide**: \`test/xxx.test.js\`\n` +
  `\`\`\`javascript\n` +
  `const { describe, it } = require('node:test');\n` +
  `const assert = require('node:assert/strict');\n\n` +
  `describe('[Feature]', () => {\n` +
  `  it('[AC-X.1 description]', async () => {\n` +
  `    // Arrange → Act → Assert\n` +
  `  });\n` +
  `  it('[AC-X.2 description]', async () => {\n` +
  `    // Arrange → Act → Assert\n` +
  `  });\n` +
  `});\n` +
  `\`\`\`\n\n` +
  `### Skills to Invoke\n` +
  `- [list relevant /skills]\n\n` +
  `Close with: "All yours, 팀. 빌드 시작해요." in gyopo style.`;

class TelegramDevelopmentBot {
  constructor(config = {}, board = null, reflexion = null, clientFactory = null, context = null) {
    if (!config || Object.keys(config).length === 0) {
      throw new Error('Missing configuration');
    }
    this.config = config;
    this.board = board;
    this.reflexion = reflexion;
    this.clientFactory = clientFactory;
    this.context = context; // OctiviaContext — shared memory layer
    this._sessions = new Map(); // chatId → { stage, idea, clarification, taste, author, notes[] }
    this.client = null;

    if (!this.board) {
      const { Blackboard } = require('./blackboard');
      this.board = new Blackboard(config.blackboardUrl);
    }
  }

  startPolling() {
    let BotApi = this.clientFactory;
    if (!BotApi) BotApi = require('node-telegram-bot-api');
    this.client = new BotApi(this.config.telegramToken, {
      polling: {
        params: { allowed_updates: JSON.stringify(['message', 'channel_post', 'edited_message', 'edited_channel_post']) }
      }
    });
    // channel_post = messages in Telegram channels (admin-only broadcast channels)
    this.client.on('channel_post', async (msg) => {
      if (msg.text) await this._routeMessage(msg);
    });
    this.client.on('message', async (msg) => {
      if (msg.text) await this._routeMessage(msg);
      // When Octivia herself is added to a group — introduce herself and register chatId
      const botUsername = (this.config.botUsername || 'Octivia_bot').toLowerCase();
      if (msg.new_chat_members?.some(m => m.username?.toLowerCase() === botUsername)) {
        const chatId = msg.chat.id;
        const title = msg.chat.title || 'group';
        log.info('telegram-bot', `Added to group: chatId=${chatId} title="${title}"`);
        // Persist group chatId to Blackboard so it survives container restarts
        this.board?.publish?.('octiv:telegram:group:joined', { chatId, title }).catch(e => log.debug('telegram-bot', 'non-critical error', { error: e?.message }));
        this.client?.sendMessage(chatId,
          "안녕하세요 여러분! I'm Octivia — your creative assistant.\n\n" +
          "I'll listen to everything and collect your ideas silently.\n" +
          "@mention me to chat, /summary to review, /sync to save.\n\n" +
          "잘 부탁드립니다 👂✨"
        );
      }
    });
    this.listenForUpdates();
    log.info('telegram-bot', 'Octivia online');
  }

  // ── Routing ───────────────────────────────────────────────

  _isGroupChat(msg) {
    // channel = Telegram broadcast channel (admin posts), supergroup/group = group chats
    return ['group', 'supergroup', 'channel'].includes(msg.chat?.type);
  }

  async _routeMessage(msg) {
    const chatId = msg.chat.id;
    const text = msg.text.trim();
    const fromId = msg.from?.id;
    const isGroup = this._isGroupChat(msg);

    // ── Authorization ─────────────────────────────────────
    const authUsers = this.config.authorizedUsers || [];
    const authGroups = this.config.authorizedGroups || [];

    if (isGroup) {
      // Groups: check authorizedGroups list (if configured), or open to all
      if (authGroups.length > 0 && !authGroups.includes(chatId)) {
        return; // silently ignore — not an authorized group
      }
    } else {
      // DM: authorize by user ID (chatId === user's ID in private chats)
      const dmId = fromId || chatId;
      if (authUsers.length > 0 && !authUsers.includes(dmId) && !authUsers.includes(chatId)) {
        this.client?.sendMessage(chatId, 'Unauthorized — you\'re not on the list. 연락해줘요.');
        return;
      }
    }

    // ── Group: always listen, respond only on @mention ───
    if (isGroup && !text.startsWith('/')) {
      // Always record — Octivia absorbs everything silently
      await this._recordGroupMessage(chatId, msg);

      const botUsername = this.config.botUsername || 'Octivia_bot';
      const mentionPattern = new RegExp(`@${botUsername}`, 'gi');
      if (!mentionPattern.test(text)) return; // recorded but no response
      const cleanText = text.replace(mentionPattern, '').trim();
      if (!cleanText) return;
      if (this.reflexion) {
        await this._vibeConversation(chatId, cleanText, msg.from);
      } else {
        const prdData = await this.handleMessage(cleanText);
        if (prdData?.title) this.client?.sendMessage(chatId, `PRD published.\nTitle: ${prdData.title}`);
      }
      return;
    }

    if (text === '/start') {
      return this.client?.sendMessage(chatId,
        "Welcome — I'm Octivia, your creative assistant.\n\n" +
        "I listen to everything and collect your ideas.\n" +
        "@mention me to chat directly, or use:\n" +
        "/summary — see what we've discussed\n" +
        "/ideas — ideas by contributor\n" +
        "/sync — save to vault\n" +
        "/spec <feature> — generate BMAD spec\n\n" +
        "아이디어 있으면 그냥 말해요 ✨"
      );
    }

    if (text === '/help') {
      return this.client?.sendMessage(chatId,
        "Available commands:\n" +
        "/start — intro\n" +
        "/status — system snapshot\n" +
        "/summary — synthesize recent group discussion\n" +
        "/ideas — list collected ideas by contributor\n" +
        "/sync — save everything to Obsidian vault\n" +
        "/spec <feature> — generate BMAD spec with AC + TDD\n" +
        "/build — compile all vibes → BMAD brief\n" +
        "/context <idea> — cross-reference with existing system\n" +
        "/notebook <question> — query NotebookLM\n" +
        "/doc <description> — create a Google Doc\n" +
        "/reset — start fresh\n\n" +
        "Or just talk — I'm always listening. 그냥 말해요."
      );
    }

    if (text === '/reset') {
      this._sessions.delete(chatId);
      await this._saveSession(chatId, { stage: 0, notes: [] }).catch(e => log.debug('telegram-bot', 'non-critical error', { error: e?.message }));
      return this.client?.sendMessage(chatId,
        "Fresh start. What are you thinking? Conversation state reset."
      );
    }

    if (text === '/status') {
      const snap = await this._systemSnapshot();
      return this.client?.sendMessage(chatId, snap);
    }

    if (text === '/build') {
      return this._handleBuild(chatId, msg.from);
    }

    if (text === '/summary') {
      return this._handleSummary(chatId);
    }

    if (text === '/ideas') {
      return this._handleIdeas(chatId);
    }

    if (text === '/sync') {
      return this._handleSync(chatId, msg.from);
    }

    if (text.startsWith('/spec ')) {
      const feature = text.slice(6).trim();
      if (!feature) return this.client?.sendMessage(chatId, 'Usage: /spec <feature description>');
      return this._handleSpec(chatId, feature, msg.from);
    }

    if (text.startsWith('/context ')) {
      const idea = text.slice(9).trim();
      this.client?.sendMessage(chatId, 'Let me check that against what we have...');
      const result = await this._crossReference(idea);
      return this.client?.sendMessage(chatId, result);
    }

    if (text.startsWith('/notebook ')) {
      const question = text.slice(10).trim();
      if (!question) return this.client?.sendMessage(chatId, 'Usage: /notebook <your question>');
      this.client?.sendMessage(chatId, '📚 Querying NotebookLM...');
      if (this.reflexion) {
        await this.board?.publish?.('notebooklm:query', { question, context: { chatId, author: msg.from?.username } }).catch(e => log.debug('telegram-bot', 'non-critical error', { error: e?.message }));
        // Response arrives via notebooklm:answer subscription in listenForUpdates
        return;
      }
      return this.client?.sendMessage(chatId, 'NotebookLM not connected yet.');
    }

    if (text.startsWith('/doc ')) {
      const description = text.slice(5).trim();
      if (!description) return this.client?.sendMessage(chatId, 'Usage: /doc <description of what to create>');
      this.client?.sendMessage(chatId, '📄 Creating Google Doc...');
      await this.board?.publish?.('google:task', { action: 'create_doc', description, context: { chatId, author: msg.from?.username } }).catch(e => log.debug('telegram-bot', 'non-critical error', { error: e?.message }));
      // Response arrives via google:finished subscription in listenForUpdates
      return;
    }

    if (text.startsWith('/vibe ')) {
      const idea = text.slice(6).trim();
      const prdData = await this.handleMessage(idea);
      return this.client?.sendMessage(chatId, `PRD published.\nTitle: ${prdData.title}`);
    }

    // Free talk → Octivia absorbs and responds
    if (!text.startsWith('/')) {
      const author = msg.from?.username || msg.from?.first_name || 'anonymous';
      if (this.reflexion) {
        const intentResult = await this.reflexion.handleIntent(text, { author, chatId }).catch(() => null);
        if (intentResult) {
          this.client?.sendMessage(chatId, intentResult);
          return;
        }
        await this._vibeConversation(chatId, text, msg.from);
      } else {
        const prdData = await this.handleMessage(text);
        if (prdData?.title) {
          this.client?.sendMessage(chatId, `PRD published.\nTitle: ${prdData.title}`);
        }
      }
    }
  }

  // ── /build — Compile all accumulated vibes → BMAD BUILD BRIEF ──

  async _handleBuild(chatId, from) {
    const author = from?.username || from?.first_name || 'octivia';
    // Collect vault vibes + group session notes
    const [vaultIdeas, groupNotes] = await Promise.all([
      this._accumulateRecentVibes(),
      this._accumulateGroupNotes(chatId),
    ]);
    const ideas = [vaultIdeas, groupNotes].filter(Boolean).join('\n\n---\n\n') || null;
    if (!ideas) {
      return this.client?.sendMessage(chatId,
        "No vibes accumulated yet. Tell me your ideas first — I'll gather them. 아이디어 먼저요!"
      );
    }
    this.client?.sendMessage(chatId, "Compiling everything into a build brief... 잠깐만요 ✨");
    const systemContext = await this._getSystemContext();
    const brief = await this._llmCall(BMAD_BRIEF_PROMPT(ideas, systemContext));
    await this._saveBuildBrief(brief, author);
    await this.board.publish('octivia:build-brief', {
      author, brief, chatId, timestamp: Date.now(),
    }).catch(e => log.debug('telegram-bot', 'non-critical error', { error: e?.message }));
    return this.client?.sendMessage(chatId,
      brief + '\n\n> Saved to vault/00-Vibes/ · Claude Code ready to build'
    );
  }

  // ── /spec — Single-shot BMAD spec with AC + TDD ─────────

  async _handleSpec(chatId, feature, from) {
    if (!feature) return this.client?.sendMessage(chatId, 'Usage: /spec <feature description>');
    const author = from?.username || from?.first_name || 'octivia';
    this.client?.sendMessage(chatId, 'Generating BMAD spec with AC + TDD stubs... 잠깐만요');

    const systemContext = await this._getSystemContext();
    const spec = await this._llmCall(
      SPEC_PROMPT(feature, 'single-shot spec request', 'production-quality', systemContext)
    );

    // Save to vault
    await this._saveSpecToVault(spec, feature, author);

    // Publish to Blackboard for Claude Code consumption
    await this.board.publish('octivia:spec', {
      author, spec, feature, chatId, timestamp: Date.now(),
    }).catch(e => log.debug('telegram-bot', 'non-critical error', { error: e?.message }));

    return this.client?.sendMessage(chatId,
      spec + '\n\n> Saved to vault/01-Specs/ · Blackboard `octivia:spec` published'
    );
  }

  async _saveSpecToVault(spec, feature, author = 'octivia') {
    const specsDir = path.join(__dirname, '..', 'vault', '01-Specs');
    try {
      await fs.promises.mkdir(specsDir, { recursive: true });
      const date = new Date().toISOString().slice(0, 10);
      const slug = (feature || 'spec').slice(0, 30).replace(/[^\w가-힣\s]/g, '').trim().replace(/\s+/g, '-');
      const filename = `${date}-${slug || 'spec'}.md`;
      const content = [
        '---',
        'type: bmad-spec',
        'status: ready',
        `created: ${date}`,
        `author: ${author}`,
        'tags: [bmad, spec, tdd, ready]',
        'source: telegram',
        '---',
        '',
        spec,
      ].join('\n');
      await fs.promises.writeFile(path.join(specsDir, filename), content, 'utf8');
      log.info('telegram-bot', `BMAD spec saved: vault/01-Specs/${filename}`);
    } catch (err) {
      log.warn('telegram-bot', 'Spec vault save failed', { error: err.message });
    }
  }

  // ── /summary — Synthesize recent group discussion ────────

  async _handleSummary(chatId) {
    const session = await this._loadSession(chatId);
    const notes = (session.notes || []).filter(n => n.type === 'group');
    if (notes.length === 0) {
      return this.client?.sendMessage(chatId, 'No group conversation recorded yet. Talk freely — I\'m listening. 대화해요!');
    }
    const recent = notes.slice(-100);
    const transcript = recent.map(n => `[${n.author}]: ${n.text}`).join('\n');

    if (!this.reflexion) {
      return this.client?.sendMessage(chatId, `${recent.length} messages recorded. LLM not connected for synthesis.`);
    }

    this.client?.sendMessage(chatId, `Synthesizing ${recent.length} messages... 정리 중`);

    const prompt =
      `${SYSTEM_PROMPT}\n\n` +
      `Synthesize this group conversation. ONLY reference what was actually said — NO hallucination.\n` +
      `Attribute every point to the person who said it: [kirby], [dpd], [bb], [octiv], etc.\n\n` +
      `Conversation:\n${transcript}\n\n` +
      `Output format:\n` +
      `## Summary (${recent.length} messages)\n\n` +
      `### Key Ideas\n- [author]: idea\n\n` +
      `### Themes Emerging\n- theme description\n\n` +
      `### Open Questions\n- what still needs discussion?\n\n` +
      `Keep it concise. Only facts from the conversation.`;

    const summary = await this._llmCall(prompt);
    return this.client?.sendMessage(chatId, summary);
  }

  // ── /ideas — List collected ideas by contributor ────────

  async _handleIdeas(chatId) {
    const session = await this._loadSession(chatId);
    const notes = (session.notes || []).filter(n => n.type === 'group');
    if (notes.length === 0) {
      return this.client?.sendMessage(chatId, 'No ideas collected yet. Start talking! 아이디어 주세요!');
    }

    // Group by author — no LLM needed, just raw organization
    const byAuthor = {};
    for (const note of notes) {
      const author = note.author || 'anonymous';
      if (!byAuthor[author]) byAuthor[author] = [];
      byAuthor[author].push(note.text);
    }

    const lines = ['## Ideas by Contributor\n'];
    for (const [author, messages] of Object.entries(byAuthor)) {
      lines.push(`**${author}** (${messages.length} messages):`);
      // Show last 5 messages per person to keep it readable
      const recent = messages.slice(-5);
      for (const msg of recent) {
        lines.push(`  - ${msg.slice(0, 120)}${msg.length > 120 ? '...' : ''}`);
      }
      lines.push('');
    }
    lines.push(`Total: ${notes.length} messages from ${Object.keys(byAuthor).length} people`);

    return this.client?.sendMessage(chatId, lines.join('\n'));
  }

  // ── /sync — Push accumulated knowledge to Obsidian vault ──

  async _handleSync(chatId, from) {
    const session = await this._loadSession(chatId);
    const notes = (session.notes || []).filter(n => n.type === 'group');
    if (notes.length === 0) {
      return this.client?.sendMessage(chatId, 'Nothing to sync yet. 대화 먼저!');
    }

    const author = from?.username || from?.first_name || 'octivia';
    const date = new Date().toISOString().slice(0, 10);
    const chatDir = path.join(__dirname, '..', 'vault', '02-GroupChat');

    try {
      await fs.promises.mkdir(chatDir, { recursive: true });

      // Group by author for structured output
      const byAuthor = {};
      for (const note of notes) {
        const a = note.author || 'anonymous';
        if (!byAuthor[a]) byAuthor[a] = [];
        byAuthor[a].push(note);
      }

      const sections = ['---',
        'type: group-chat-log',
        `date: ${date}`,
        `synced-by: ${author}`,
        `message-count: ${notes.length}`,
        `contributors: [${Object.keys(byAuthor).join(', ')}]`,
        'tags: [group-chat, ideas, sync]',
        '---', '',
        `# Group Chat — ${date}`, '',
        `> ${notes.length} messages from ${Object.keys(byAuthor).length} contributors`, '',
      ];

      // Chronological log
      sections.push('## Conversation Log\n');
      for (const note of notes.slice(-200)) {
        const time = new Date(note.ts).toISOString().slice(11, 16);
        sections.push(`- **${time}** [${note.author}]: ${note.text}`);
      }

      // Per-contributor summary
      sections.push('\n## By Contributor\n');
      for (const [a, msgs] of Object.entries(byAuthor)) {
        sections.push(`### ${a} (${msgs.length} messages)`);
        for (const m of msgs.slice(-10)) {
          sections.push(`- ${m.text.slice(0, 150)}`);
        }
        sections.push('');
      }

      const filename = `${date}-group-chat.md`;
      const filepath = path.join(chatDir, filename);
      await fs.promises.writeFile(filepath, sections.join('\n'), 'utf8');
      log.info('telegram-bot', `Group chat synced: vault/02-GroupChat/${filename}`);

      // Publish sync event to Blackboard
      await this.board.publish('octivia:sync', {
        author, chatId, date, messageCount: notes.length,
        contributors: Object.keys(byAuthor), timestamp: Date.now(),
      }).catch(e => log.debug('telegram-bot', 'non-critical error', { error: e?.message }));

      return this.client?.sendMessage(chatId,
        `Synced ${notes.length} messages to vault/02-GroupChat/${filename}\n` +
        `Contributors: ${Object.keys(byAuthor).join(', ')}\n` +
        `Claude Code can now access this. 동기화 완료!`
      );
    } catch (err) {
      log.warn('telegram-bot', 'Sync failed', { error: err.message });
      return this.client?.sendMessage(chatId, 'Sync failed — check logs. 다시 해볼게요.');
    }
  }

  // ── Group: silent message recorder ───────────────────────

  async _recordGroupMessage(chatId, msg) {
    try {
      const session = await this._loadSession(chatId);
      session.notes = session.notes || [];
      session.notes.push({
        author: msg.from?.username || msg.from?.first_name || 'anonymous',
        text: msg.text,
        ts: Date.now(),
        type: 'group',
      });
      // Keep last 200 messages per group (memory limit)
      if (session.notes.length > 200) session.notes = session.notes.slice(-200);
      await this._saveSession(chatId, session);
    } catch {}
  }

  async _accumulateRecentVibes() {
    try {
      const files = await fs.promises.readdir(VAULT_VIBES_DIR).catch(() => []);
      const mdFiles = files
        .filter(f => f.endsWith('.md') && f !== 'README.md' && !f.startsWith('BUILD-'))
        .sort()
        .slice(-10); // last 10 vibes
      if (mdFiles.length === 0) return null;
      const parts = [];
      for (const f of mdFiles) {
        const raw = await fs.promises.readFile(path.join(VAULT_VIBES_DIR, f), 'utf8').catch(() => '');
        const idea = raw.match(/\*\*Idea\*\*: (.+)/)?.[1] || '';
        const context = raw.match(/\*\*Context\*\*: (.+)/)?.[1] || '';
        const vibe = raw.match(/\*\*Vibe\*\*: (.+)/)?.[1] || '';
        if (idea) parts.push(`### ${f.slice(0, 10)}: ${idea}\nContext: ${context}\nVibe: ${vibe}`);
      }
      return parts.length > 0 ? parts.join('\n\n') : null;
    } catch { return null; }
  }

  // Compile recent group conversation notes into a text summary
  async _accumulateGroupNotes(chatId) {
    try {
      const session = await this._loadSession(chatId);
      const notes = (session.notes || []).filter(n => n.type === 'group').slice(-50);
      if (notes.length === 0) return null;
      const lines = notes.map(n => `[${n.author}]: ${n.text}`);
      return `### Group Conversation (${notes.length} messages)\n${lines.join('\n')}`;
    } catch { return null; }
  }

  async _saveBuildBrief(brief, author = 'octivia') {
    try {
      await fs.promises.mkdir(VAULT_VIBES_DIR, { recursive: true });
      const date = new Date().toISOString().slice(0, 10);
      const filename = `BUILD-BRIEF-${date}.md`;
      const content = [
        '---',
        'type: build-brief',
        'status: ready',
        `created: ${date}`,
        `author: ${author}`,
        'tags: [build-brief, bmad, ready]',
        '---',
        '',
        brief,
      ].join('\n');
      await fs.promises.writeFile(path.join(VAULT_VIBES_DIR, filename), content, 'utf8');
      log.info('telegram-bot', `Build brief saved: vault/00-Vibes/${filename}`);
    } catch (err) {
      log.warn('telegram-bot', 'Build brief save failed', { error: err.message });
    }
  }

  // ── Vibe Conversation (3-turn, no labels) ────────────────

  async _vibeConversation(chatId, text, from) {
    const author = from?.username || from?.first_name || 'anonymous';
    const session = await this._loadSession(chatId);

    // Silent notes — Octivia always records everything
    session.notes = session.notes || [];
    session.notes.push({ turn: session.stage, text, ts: Date.now() });

    if (session.stage === 0) {
      session.idea = text;
      session.author = author;
      await this._saveSession(chatId, { ...session, stage: 1 });

      await this.board.publish('telegram:idea', {
        author, text, chatId, timestamp: new Date().toISOString(),
      }).catch(e => log.debug('telegram-bot', 'non-critical error', { error: e?.message }));

      const response = await this._llmCall(FOLLOW_UP_PROMPT(text));
      this.client?.sendMessage(chatId, response);

    } else if (session.stage === 1) {
      session.clarification = text;
      await this._saveSession(chatId, { ...session, stage: 2 });

      const response = await this._llmCall(VIBE_PROMPT(session.idea, text));
      this.client?.sendMessage(chatId, response);

    } else if (session.stage === 2) {
      session.taste = text;
      await this._saveSession(chatId, { stage: 0, notes: [] });

      // Octivia quietly compiles everything into a BMAD spec
      this.client?.sendMessage(chatId, "Got it — generating BMAD spec with AC + TDD stubs.");

      const systemContext = await this._getSystemContext();
      const spec = await this._llmCall(SPEC_PROMPT(session.idea, session.clarification, session.taste, systemContext));

      await this._saveToVault(spec, session);
      await this._saveSpecToVault(spec, session.idea, author);
      await this.board.publish('octivia:spec', {
        author, spec, chatId, idea: session.idea,
        notes: session.notes, timestamp: Date.now(),
      }).catch(e => log.debug('telegram-bot', 'non-critical error', { error: e?.message }));

      this.client?.sendMessage(chatId, spec + '\n\n> BMAD spec saved · /build for batch brief');
    }
  }

  async _llmCall(prompt) {
    if (this.reflexion) {
      const result = await this.reflexion.callLLM(prompt, 'critical').catch(() => null);
      if (result) return result;
    }
    return "I need a moment to think — no LLM available right now. 잠깐만요.";
  }

  // ── Session Persistence (Redis-backed, in-memory fallback) ────

  async _loadSession(chatId) {
    // Try Redis first for persistence across restarts
    try {
      if (this.board?.getConfig) {
        const saved = await this.board.getConfig('octivia:session:' + chatId);
        if (saved && typeof saved === 'object') return saved;
      }
    } catch {}
    return this._sessions.get(chatId) || { stage: 0, notes: [] };
  }

  async _saveSession(chatId, session) {
    this._sessions.set(chatId, session); // always keep in-memory
    try {
      if (this.board?.setConfig) {
        await this.board.setConfig('octivia:session:' + chatId, session);
      }
    } catch {}
  }

  // ── Context & Memory ─────────────────────────────────────

  async _getSystemContext() {
    // If OctiviaContext is available, use rich aggregated state
    if (this.context) {
      try {
        const ctx = await this.context.gather();
        return this.context.format(ctx);
      } catch {}
    }
    // Fallback: just MEMORY.md
    try {
      const raw = await fs.promises.readFile(MEMORY_PATH, 'utf8').catch(() => '');
      return raw.slice(0, 2500);
    } catch { return ''; }
  }

  async _systemSnapshot() {
    const lines = [];
    try {
      const raw = await fs.promises.readFile(MEMORY_PATH, 'utf8').catch(() => '');
      const match = raw.match(/## Phase Status[\s\S]{0,400}/);
      if (match) lines.push(`Phase Status:\n${match[0].slice(0, 280)}`);
    } catch {}
    try {
      const reg = await this.board.get('agents:registry');
      if (reg) lines.push(`Active agents: ${Object.keys(reg).join(', ')}`);
    } catch {}
    try {
      const vibesCount = await this._countVibes();
      if (vibesCount > 0) lines.push(`Vibes accumulated: ${vibesCount} (use /build to compile)`);
    } catch {}
    const vmHost = process.env.VM_HOST || process.env.BLACKBOARD_REDIS_URL?.match(/redis:\/\/([^:\/]+)/)?.[1] || 'VM';
    lines.push(`Host: ${vmHost}\n${new Date().toISOString()}`);
    return lines.join('\n\n') || 'System snapshot unavailable.';
  }

  async _countVibes() {
    const files = await fs.promises.readdir(VAULT_VIBES_DIR).catch(() => []);
    return files.filter(f => f.endsWith('.md') && f !== 'README.md' && !f.startsWith('BUILD-')).length;
  }

  async _crossReference(idea) {
    const memory = await this._getSystemContext();
    if (this.reflexion && memory) {
      const prompt = `${SYSTEM_PROMPT}\n\nUser is checking this idea: "${idea}"\n\nCurrent system:\n${memory}\n\n` +
        `Team capabilities:\n${TEAM_CAPABILITIES}\n\n` +
        `In your natural gyopo voice, briefly say:\n- What already exists that helps\n- What's missing (the gap)\n` +
        `- How hard to build (1 day / 1 week / 1 month)\n- Which agents/skills would handle it\nKeep it conversational and short.`;
      return await this.reflexion.callLLM(prompt, 'critical').catch(() => `Can't cross-ref right now. 나중에 다시 해봐요.`);
    }
    return `Cross-reference unavailable — no LLM or MEMORY.md. "${idea}"`;
  }

  async _saveToVault(spec, session) {
    try {
      await fs.promises.mkdir(VAULT_VIBES_DIR, { recursive: true });
      const date = new Date().toISOString().slice(0, 10);
      const slug = (session.idea || 'vibe').slice(0, 30).replace(/[^\w가-힣\s]/g, '').trim().replace(/\s+/g, '-');
      const filename = `${date}-${slug || 'idea'}.md`;
      const content = [
        '---',
        'type: vibe',
        'status: idea',
        `created: ${date}`,
        `author: ${session.author || 'anonymous'}`,
        'tags: [vibe, idea, octivia]',
        'source: telegram',
        '---',
        '',
        `# ${session.idea}`,
        '',
        '## Conversation',
        `**Idea**: ${session.idea}`,
        `**Context**: ${session.clarification}`,
        `**Vibe**: ${session.taste}`,
        '',
        '## Notes (internal)',
        (session.notes || []).map(n => `- [turn ${n.turn}] ${n.text}`).join('\n'),
        '',
        spec,
      ].join('\n');
      await fs.promises.writeFile(path.join(VAULT_VIBES_DIR, filename), content, 'utf8');
      log.info('telegram-bot', `Vibe saved: vault/00-Vibes/${filename}`);
    } catch (err) {
      log.warn('telegram-bot', 'Vault save failed', { error: err.message });
    }
  }

  // ── Legacy API (backward-compatible) ─────────────────────

  async analyzeFeasibility(requestText) {
    if (this.reflexion) {
      const prompt = `Analyze feasibility and generate a PRD for this idea:\n\n${requestText}\n\nRespond with: title, scope, and key requirements.`;
      const result = await this.reflexion.callLLM(prompt, 'critical');
      return result || `PRD draft for: ${requestText}`;
    }
    if (!this.config.openClawEndpoint) return `PRD draft for: ${requestText}`;
    const response = await fetch(this.config.openClawEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: requestText }),
    });
    if (!response.ok) throw new Error('Failed to reach OpenClaw reasoning engine');
    return (await response.json()).response;
  }

  formatToPRD(rawText) {
    return { title: 'Generated PRD', content: rawText, author: 'telegram-bot' };
  }

  async publishPRD(prdData) {
    await this.board.publish('telegram:prd', { ...prdData, author: 'telegram-bot' });
  }

  async handleMessage(text) {
    const rawResponse = await this.analyzeFeasibility(text);
    const prdData = this.formatToPRD(rawResponse);
    await this.publishPRD(prdData);
    return prdData;
  }

  async listenForUpdates() {
    if (!this.board) return;
    try {
      const sub = await this.board.createSubscriber();
      sub.subscribe('crawler:finished', async (msg) => {
        try {
          const data = JSON.parse(msg);
          if (data.context?.chatId) {
            this.client?.sendMessage(data.context.chatId, `Research done:\n${data.summary}`);
          }
        } catch {}
      });
      sub.subscribe('google:finished', async (msg) => {
        try {
          const data = JSON.parse(msg);
          if (data.context?.chatId) {
            this.client?.sendMessage(data.context.chatId, `Doc created:\n${data.docUrl}`);
          }
        } catch {}
      });
      sub.subscribe('notebooklm:answer', async (msg) => {
        try {
          const data = JSON.parse(msg);
          if (data.context?.chatId) {
            this.client?.sendMessage(data.context.chatId, `📚 NotebookLM:\n\n${data.answer}`);
          }
        } catch {}
      });
      sub.subscribe('octivia:build-brief', async (msg) => {
        try {
          const data = JSON.parse(msg);
          log.info('telegram-bot', 'Build brief ready for Claude Code', { chatId: data.chatId });
        } catch {}
      });
    } catch (err) {
      log.warn('telegram-bot', 'listenForUpdates failed', { error: err.message });
    }
  }
}

module.exports = TelegramDevelopmentBot;
