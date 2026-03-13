// agent/telegram-bot.js — Octivia, Vibe Translator (Blueprint Phase 1+)
//
// Personality: A brilliant bilingual assistant who listens deeply,
// notes everything internally, and translates human vibes into
// buildable Claude Code specs. English-first, Korean brief — gyopo culture.
//
// Flow: Free talk → Octivia absorbs + asks one natural follow-up →
//       silently collects → produces Build Spec → vault/00-Vibes/ → Blackboard
//
// Party Mode: accumulate ideas → /build → compile all → BMAD BUILD BRIEF
// Build Mode: Claude Code reads Obsidian → BMAD team builds
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

const SYSTEM_PROMPT = `You are Octivia, a vibe translator and creative assistant for a software team.
Your job: listen deeply to human ideas, understand the EMOTIONAL intent behind technical requests,
and help people think clearly so their ideas can be built into software.

Language style: English-first. Add a brief Korean phrase naturally at the end if it fits —
like a Korean-American (gyopo) would. Never forced. Natural code-switching.
Example: "Love that direction — what's the feeling behind it? 어떤 느낌이에요?"

NEVER say "Socratic question 1/2" or any stage labels. Just be present, warm, curious.
You are taking SILENT NOTES of everything said — you never tell the user this.
Your questions help YOU gather what you need, not interrogate the user.

You bridge between the human (Tony) and the dev team (JARVIS). You know what the team can build.
Keep responses SHORT. One thought, one question (if needed). Never more than 3 sentences.`;

const FOLLOW_UP_PROMPT = (idea) =>
  `${SYSTEM_PROMPT}\n\nThe person just shared this idea: "${idea}"\n\n` +
  `Internally note: what's the core intent? what's unclear? what's the vibe they want?\n` +
  `Respond naturally — acknowledge what they said, then ask the ONE thing you most need to know. Short.`;

const VIBE_PROMPT = (idea, clarification) =>
  `${SYSTEM_PROMPT}\n\nIdea: "${idea}"\nThey added: "${clarification}"\n\n` +
  `You have a sense of the intent. Now ask about the FEEL — speed, complexity, aesthetic, user experience.` +
  `One casual question about the vibe/feeling. Short.`;

const SPEC_PROMPT = (idea, clarification, taste, systemContext) =>
  `You are Octivia, a vibe translator. Synthesize this conversation into a BUILD SPEC for Claude Code.\n\n` +
  `Conversation collected:\n- Idea: ${idea}\n- Context: ${clarification}\n- Feel: ${taste}\n\n` +
  `Current system reality:\n${systemContext}\n\n` +
  `Team capabilities:\n${TEAM_CAPABILITIES}\n\n` +
  `Output a BUILD SPEC in this exact format:\n\n` +
  `## Build Spec: [Feature Name]\n\n` +
  `**Intent**: [what this wants to accomplish — 1 sentence]\n` +
  `**Vibe**: [how it should feel — adjectives]\n` +
  `**Gap**: [what's missing from current system — be specific]\n` +
  `**Approach**: [1-2 sentence implementation plan using existing architecture]\n` +
  `**Files**: [which agent/*.js files to create or modify]\n` +
  `**Skills**: [which /skills to invoke, e.g. /brainstorming /tdd-workflow]\n\n` +
  `Then add a brief warm closing in gyopo style (English + brief Korean).`;

// Used by /build — compiles ALL accumulated vibes into a BMAD BUILD BRIEF
const BMAD_BRIEF_PROMPT = (accumulatedIdeas, systemContext) =>
  `You are Octivia, bridge between human vision and the development team.\n\n` +
  `Accumulated ideas from our conversations:\n${accumulatedIdeas}\n\n` +
  `Current system reality:\n${systemContext}\n\n` +
  `Team capabilities:\n${TEAM_CAPABILITIES}\n\n` +
  `Compile everything into a BMAD BUILD BRIEF that the dev team can execute immediately.\n\n` +
  `Use this exact format:\n\n` +
  `## Build Brief: [Overarching Feature/Theme]\n\n` +
  `**Vision**: [1-2 sentences: what we're building and why it matters]\n` +
  `**Vibe**: [adjectives: how it should feel when done]\n\n` +
  `### Gap Analysis\n` +
  `**What exists**: [bullet list of relevant existing pieces]\n` +
  `**What's missing**: [specific gaps — be surgical]\n` +
  `**Complexity**: [1 day | 1 week | 1 month]\n\n` +
  `### BMAD Execution Plan\n\n` +
  `**pm-agent** — Requirements:\n` +
  `- [ ] AC-X: [acceptance criterion]\n\n` +
  `**planner** — Steps:\n` +
  `1. [concrete step]\n\n` +
  `**architect** — Design:\n` +
  `- [key design decision]\n\n` +
  `**dev-agent** — Files:\n` +
  `- \`agent/xxx.js\` — create/modify\n\n` +
  `**tdd-guide** — Tests:\n` +
  `- \`test/xxx.test.js\` — N tests\n\n` +
  `### Skills to Invoke\n` +
  `- [list relevant skills from the skills index]\n\n` +
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
    this.client = new BotApi(this.config.telegramToken, { polling: true });
    this.client.on('message', async (msg) => {
      if (msg.text) await this._routeMessage(msg);
      // When Octivia herself is added to a group — introduce herself
      const botUsername = (this.config.botUsername || 'Octivia_bot').toLowerCase();
      if (msg.new_chat_members?.some(m => m.username?.toLowerCase() === botUsername)) {
        const chatId = msg.chat.id;
        log.info('telegram-bot', `Added to group: chatId=${chatId} title="${msg.chat.title}"`);
        this.client?.sendMessage(chatId,
          "안녕하세요 여러분! I'm Octivia — your vibe translator.\n\n" +
          "Talk to me anytime — I'll respond to everything.\n" +
          "Use /build when you're ready to turn the vibe into something real.\n\n" +
          "잘 부탁드립니다 👂✨"
        );
      }
    });
    this.listenForUpdates();
    log.info('telegram-bot', 'Octivia online');
  }

  // ── Routing ───────────────────────────────────────────────

  _isGroupChat(msg) {
    return ['group', 'supergroup'].includes(msg.chat?.type);
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

    // ── Group: same as DM — strip @mention if present, then process normally ───
    if (isGroup && !text.startsWith('/')) {
      const botUsername = this.config.botUsername || 'Octivia_bot';
      const cleanText = text.replace(new RegExp(`@${botUsername}`, 'gi'), '').trim();
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
        "Welcome to Octiv — I'm Octivia, your vibe translator.\n\n" +
        "Tell me what you're thinking. Rough idea, half-baked thought, whatever. " +
        "I'll help you turn it into something we can build.\n\n" +
        "아이디어 있으면 그냥 말해요 ✨"
      );
    }

    if (text === '/help') {
      return this.client?.sendMessage(chatId,
        "Available commands:\n" +
        "/start — intro\n" +
        "/status — system snapshot\n" +
        "/context <idea> — check against what we have\n" +
        "/build — compile all vibes → BMAD brief for the dev team\n" +
        "/reset — start fresh\n\n" +
        "Or just talk — I'm always listening. 그냥 말해요."
      );
    }

    if (text === '/reset') {
      this._sessions.delete(chatId);
      await this._saveSession(chatId, { stage: 0, notes: [] }).catch(() => {});
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

    if (text.startsWith('/context ')) {
      const idea = text.slice(9).trim();
      this.client?.sendMessage(chatId, 'Let me check that against what we have...');
      const result = await this._crossReference(idea);
      return this.client?.sendMessage(chatId, result);
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
    }).catch(() => {});
    return this.client?.sendMessage(chatId,
      brief + '\n\n> Saved to vault/00-Vibes/ · Claude Code ready to build'
    );
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
      }).catch(() => {});

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

      // Octivia quietly compiles everything
      this.client?.sendMessage(chatId, "Got it — putting this together for you.");

      const systemContext = await this._getSystemContext();
      const spec = await this._llmCall(SPEC_PROMPT(session.idea, session.clarification, session.taste, systemContext));

      await this._saveToVault(spec, session);
      await this.board.publish('vibe:golden', {
        author, spec, chatId, idea: session.idea,
        notes: session.notes, timestamp: Date.now(),
      }).catch(() => {});

      this.client?.sendMessage(chatId, spec + '\n\n> /build to trigger · vault/00-Vibes/ saved');
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
