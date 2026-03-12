// agent/telegram-bot.js — Octivia, Vibe Translator (Blueprint Phase 1)
//
// Personality: A brilliant bilingual assistant who listens deeply,
// notes everything internally, and translates human vibes into
// buildable Claude Code specs. English-first, Korean brief — gyopo culture.
//
// Flow: Free talk → Octivia absorbs + asks one natural follow-up →
//       silently collects → produces Build Spec → vault/00-Vibes/ → Blackboard
//
// Independence: NO Minecraft. Only Blackboard + LLM.
const fs = require('fs');
const path = require('path');
const { getLogger } = require('./logger');
const log = getLogger();

const VAULT_VIBES_DIR = path.join(__dirname, '..', 'vault', '00-Vibes');
const MEMORY_PATH = path.join(__dirname, '..', 'vault', 'MEMORY.md');

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
  `Current system:\n${systemContext}\n\n` +
  `Output a BUILD SPEC in this exact format:\n\n` +
  `## Build Spec: [Feature Name]\n\n` +
  `**Intent**: [what this wants to accomplish — 1 sentence]\n` +
  `**Vibe**: [how it should feel — adjectives]\n` +
  `**Gap**: [what's missing from current system — be specific]\n` +
  `**Approach**: [1-2 sentence implementation plan using existing architecture]\n` +
  `**Files**: [which agent/*.js files to create or modify]\n\n` +
  `Then add a brief warm closing in gyopo style (English + brief Korean).`;

class TelegramDevelopmentBot {
  constructor(config = {}, board = null, reflexion = null, clientFactory = null) {
    if (!config || Object.keys(config).length === 0) {
      throw new Error('Missing configuration');
    }
    this.config = config;
    this.board = board;
    this.reflexion = reflexion;
    this.clientFactory = clientFactory;
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
    });
    this.listenForUpdates();
    log.info('telegram-bot', 'Octivia online');
  }

  // ── Routing ───────────────────────────────────────────────

  async _routeMessage(msg) {
    const chatId = msg.chat.id;
    const text = msg.text.trim();

    const authUsers = this.config.authorizedUsers || [];
    if (authUsers.length > 0 && !authUsers.includes(chatId)) {
      this.client?.sendMessage(chatId, 'Unauthorized — you\'re not on the list. 연락해줘요.');
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
        "/reset — start fresh\n\n" +
        "Or just talk — I'm listening. 그냥 말해요."
      );
    }

    if (text === '/reset') {
      this._sessions.delete(chatId);
      return this.client?.sendMessage(chatId,
        "Fresh start. What are you thinking? Conversation state reset."
      );
    }

    if (text === '/status') {
      const snap = await this._systemSnapshot();
      return this.client?.sendMessage(chatId, snap);
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

  // ── Vibe Conversation (3-turn, no labels) ────────────────

  async _vibeConversation(chatId, text, from) {
    const author = from?.username || from?.first_name || 'anonymous';
    const session = this._sessions.get(chatId) || { stage: 0, notes: [] };

    // Silent notes — Octivia always records everything
    session.notes = session.notes || [];
    session.notes.push({ turn: session.stage, text, ts: Date.now() });

    if (session.stage === 0) {
      session.idea = text;
      session.author = author;
      this._sessions.set(chatId, { ...session, stage: 1 });

      await this.board.publish('telegram:idea', {
        author, text, chatId, timestamp: new Date().toISOString(),
      }).catch(() => {});

      const response = await this._llmCall(FOLLOW_UP_PROMPT(text));
      this.client?.sendMessage(chatId, response);

    } else if (session.stage === 1) {
      session.clarification = text;
      this._sessions.set(chatId, { ...session, stage: 2 });

      const response = await this._llmCall(VIBE_PROMPT(session.idea, text));
      this.client?.sendMessage(chatId, response);

    } else if (session.stage === 2) {
      session.taste = text;
      this._sessions.set(chatId, { stage: 0, notes: [] });

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
      const result = await this.reflexion.callLLM(prompt, 'normal').catch(() => null);
      if (result) return result;
    }
    return "I need a moment to think — no LLM available right now. 잠깐만요.";
  }

  // ── Context & Memory ─────────────────────────────────────

  async _getSystemContext() {
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
    lines.push(`VM: 34.94.165.1 (LA)\n${new Date().toISOString()}`);
    return lines.join('\n\n') || 'System snapshot unavailable.';
  }

  async _crossReference(idea) {
    const memory = await this._getSystemContext();
    if (this.reflexion && memory) {
      const prompt = `${SYSTEM_PROMPT}\n\nUser is checking this idea: "${idea}"\n\nCurrent system:\n${memory}\n\nIn your natural gyopo voice, briefly say:\n- What already exists that helps\n- What's missing (the gap)\n- How hard to build (1 day / 1 week / 1 month)\nKeep it conversational and short.`;
      return await this.reflexion.callLLM(prompt, 'normal').catch(() => `Can't cross-ref right now. 나중에 다시 해봐요.`);
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
        `# ${session.idea}`,
        `> ${date} | @${session.author}`,
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
      const result = await this.reflexion.callLLM(prompt, 'normal');
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
    } catch (err) {
      log.warn('telegram-bot', 'listenForUpdates failed', { error: err.message });
    }
  }
}

module.exports = TelegramDevelopmentBot;
