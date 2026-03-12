// agent/telegram-bot.js — Vibe Coder Socratic Catalyst (Blueprint Phase 1)
//
// Blueprint role: "Extract the best ideas from a room of creative people."
// Flow: Idea → Socratic 3-turn → Golden Nuggets → Obsidian vault → Blackboard
// Independence: NO Minecraft dependency. Only needs: Blackboard + LLM (reflexion).
const fs = require('fs');
const path = require('path');
const { getLogger } = require('./logger');
const log = getLogger();

const VAULT_VIBES_DIR = path.join(__dirname, '..', 'vault', '00-Vibes');
const MEMORY_PATH = path.join(__dirname, '..', 'vault', 'MEMORY.md');

class TelegramDevelopmentBot {
  constructor(config = {}, board = null, reflexion = null, clientFactory = null) {
    if (!config || Object.keys(config).length === 0) {
      throw new Error('Missing configuration');
    }
    this.config = config;
    this.board = board;
    this.reflexion = reflexion;
    this.clientFactory = clientFactory;
    this._sessions = new Map(); // chatId → { stage, idea, clarification, taste, author }
    this.client = null;

    if (!this.board) {
      const { Blackboard } = require('./blackboard');
      this.board = new Blackboard(config.blackboardUrl);
    }
  }

  startPolling() {
    let BotApi = this.clientFactory;
    if (!BotApi) {
      BotApi = require('node-telegram-bot-api');
    }
    this.client = new BotApi(this.config.telegramToken, { polling: true });
    this.client.on('message', async (msg) => {
      if (msg.text) await this._routeMessage(msg);
    });
    this.listenForUpdates();
    log.info('telegram-bot', 'Socratic Catalyst polling started');
  }

  // ── Routing ───────────────────────────────────────────────

  async _routeMessage(msg) {
    const chatId = msg.chat.id;
    const text = msg.text.trim();

    const authUsers = this.config.authorizedUsers || [];
    if (authUsers.length > 0 && !authUsers.includes(chatId)) {
      this.client?.sendMessage(chatId, 'Unauthorized.');
      return;
    }

    if (text === '/start') {
      return this.client?.sendMessage(chatId,
        '*Welcome to Octiv Vibe Coder* — Socratic Catalyst\n\n' +
        '아이디어를 자유롭게 말씀해주세요. 소크라테스 대화로 24K 골든 너겟을 추출합니다.\n\n' +
        '`/status` — 현재 시스템 상태\n' +
        '`/context <아이디어>` — 시스템과 교차분석\n' +
        '`/reset` — 대화 초기화',
        { parse_mode: 'Markdown' }
      );
    }

    if (text === '/help') {
      return this.client?.sendMessage(chatId,
        'Available commands:\n/start — 시작\n/status — 시스템 현황\n/context <텍스트> — 아이디어×시스템 교차\n/reset — 세션 초기화\n\n자유 텍스트 → 소크라테스 대화 시작'
      );
    }

    if (text === '/reset') {
      this._sessions.delete(chatId);
      return this.client?.sendMessage(chatId, '✅ Conversation state reset.');
    }

    if (text === '/status') {
      const snap = await this._systemSnapshot();
      return this.client?.sendMessage(chatId, snap, { parse_mode: 'Markdown' });
    }

    if (text.startsWith('/context ')) {
      const idea = text.slice(9).trim();
      this.client?.sendMessage(chatId, '🔍 교차분석 중...');
      const result = await this._crossReference(idea);
      return this.client?.sendMessage(chatId, result, { parse_mode: 'Markdown' });
    }

    // Legacy /vibe command
    if (text.startsWith('/vibe ')) {
      const idea = text.slice(6).trim();
      const prdData = await this.handleMessage(idea);
      return this.client?.sendMessage(chatId, `PRD published.\nTitle: ${prdData.title}`);
    }

    // Default: free text → Socratic dialogue (with LLM) or PRD fallback (without)
    if (!text.startsWith('/')) {
      const author = msg.from?.username || msg.from?.first_name || 'anonymous';
      if (this.reflexion) {
        // Intent-based routing: reflexion intercepts if it can handle directly
        const intentResult = await this.reflexion.handleIntent(text, { author, chatId }).catch(() => null);
        if (intentResult) {
          this.client?.sendMessage(chatId, intentResult);
          return;
        }
        // LLM available → Socratic Catalyst dialogue
        await this._socraticFlow(chatId, text, msg.from);
      } else {
        // No LLM: direct PRD generation (legacy path)
        const prdData = await this.handleMessage(text);
        if (prdData?.title) {
          this.client?.sendMessage(chatId, `PRD published.\nTitle: ${prdData.title}`);
        }
      }
    }
  }

  // ── Socratic 3-Stage Flow (Blueprint Phase 1) ─────────────

  async _socraticFlow(chatId, text, from) {
    const author = from?.username || from?.first_name || 'anonymous';
    const session = this._sessions.get(chatId) || { stage: 0 };

    if (session.stage === 0) {
      // Stage 0: Received raw idea → ask clarifying question
      session.idea = text;
      session.author = author;
      this._sessions.set(chatId, { ...session, stage: 1 });

      await this.board.publish('telegram:idea', {
        author, text, chatId, timestamp: new Date().toISOString(),
      }).catch(() => {});

      const q = await this._askClarifyingQuestion(text);
      this.client?.sendMessage(chatId, `💬 *소크라테스 질문 1/2*\n\n${q}`, { parse_mode: 'Markdown' });

    } else if (session.stage === 1) {
      // Stage 1: Received clarification → ask about taste/feel
      session.clarification = text;
      this._sessions.set(chatId, { ...session, stage: 2 });
      this.client?.sendMessage(chatId,
        '🎨 *소크라테스 질문 2/2*\n\n이 기능의 *느낌*이 어때야 하나요?\n(예: 빠른/느긋한, 단순/풍부한, 자동/수동, 조용한/활발한)',
        { parse_mode: 'Markdown' }
      );

    } else if (session.stage === 2) {
      // Stage 2: Received taste → synthesize Golden Nuggets
      session.taste = text;
      this._sessions.set(chatId, { ...session, stage: 0 });
      this.client?.sendMessage(chatId, '⚙️ *골든 너겟 추출 중...*', { parse_mode: 'Markdown' });

      const nuggets = await this._extractGoldenNuggets(session);
      await this._saveToVault(nuggets, session);
      await this.board.publish('vibe:golden', {
        author, nuggets, chatId, idea: session.idea, timestamp: Date.now(),
      }).catch(() => {});

      this._sessions.delete(chatId);
      this.client?.sendMessage(chatId,
        `✅ *Golden Nuggets 추출 완료*\n\n${nuggets}\n\n_vault/00-Vibes/ 에 저장됨_`,
        { parse_mode: 'Markdown' }
      );
    }
  }

  async _askClarifyingQuestion(idea) {
    if (this.reflexion) {
      const prompt = `You are a Socratic interviewer for a software team. The user shared this idea: "${idea}"\nAsk ONE concise clarifying question in Korean to understand what core problem this solves. Be specific, not generic.`;
      const result = await this.reflexion.callLLM(prompt, 'normal').catch(() => null);
      if (result) return result;
    }
    return `"${idea.slice(0, 50)}" — 이 아이디어로 어떤 구체적인 문제를 해결하려는 건가요?`;
  }

  async _extractGoldenNuggets(session) {
    const { idea, clarification, taste } = session;
    const crossRef = await this._crossReference(idea).catch(() => '교차분석 불가');

    if (this.reflexion) {
      const prompt = `You are a system architect. Synthesize into Golden Nuggets in Korean:\n\nIdea: ${idea}\nClarification: ${clarification}\nTaste/Feel: ${taste}\nSystem context: ${crossRef}\n\nFormat exactly:\n## Golden Nuggets\n- [핵심 요구사항들]\n\n## 시스템 갭\n- [현재 없는 것들]\n\n## 빌드 플랜\n[2-3문장 구체적 구현 계획]`;
      const result = await this.reflexion.callLLM(prompt, 'normal').catch(() => null);
      if (result) return result;
    }
    return `## Golden Nuggets\n- 아이디어: ${idea}\n- 취향: ${taste}\n\n## 시스템 갭\n추가 분석 필요\n\n## 빌드 플랜\n${crossRef}`;
  }

  async _saveToVault(nuggets, session) {
    try {
      await fs.promises.mkdir(VAULT_VIBES_DIR, { recursive: true });
      const date = new Date().toISOString().slice(0, 10);
      const slug = session.idea.slice(0, 30).replace(/[^\w가-힣\s]/g, '').trim().replace(/\s+/g, '-');
      const filename = `${date}-${slug || 'vibe'}.md`;
      const content = [
        `# ${session.idea}`,
        `> ${date} | ${session.author}`,
        '',
        '## 아이디어',
        session.idea,
        '',
        '## 명확화',
        session.clarification,
        '',
        '## 느낌/취향',
        session.taste,
        '',
        nuggets,
      ].join('\n');
      await fs.promises.writeFile(path.join(VAULT_VIBES_DIR, filename), content, 'utf8');
      log.info('telegram-bot', `Golden Nuggets saved: vault/00-Vibes/${filename}`);
    } catch (err) {
      log.warn('telegram-bot', 'Vault save failed', { error: err.message });
    }
  }

  // ── System Context (MC-independent) ──────────────────────

  async _systemSnapshot() {
    const lines = [];
    try {
      const raw = await fs.promises.readFile(MEMORY_PATH, 'utf8').catch(() => '');
      const match = raw.match(/## Phase Status[\s\S]{0,400}/);
      if (match) lines.push(`📊 *Phase Status*\n\`\`\`\n${match[0].slice(0, 300)}\n\`\`\``);
    } catch {}

    try {
      const reg = await this.board.get('agents:registry');
      if (reg) lines.push(`🤖 *Active agents*: ${Object.keys(reg).join(', ')}`);
    } catch {}

    lines.push(`🌐 *VM* 34.94.165.1 (LA, us-west2-a)`);
    lines.push(`🕐 ${new Date().toISOString()}`);
    return lines.join('\n\n') || '시스템 상태 읽기 실패.';
  }

  async _crossReference(idea) {
    let memory = '';
    try {
      memory = await fs.promises.readFile(MEMORY_PATH, 'utf8');
      memory = memory.slice(0, 2000);
    } catch {}

    if (this.reflexion && memory) {
      const prompt = `System architect analyzing feasibility. Idea: "${idea}"\n\nCurrent system (from MEMORY.md):\n${memory}\n\nAnswer in Korean:\n1. **이미 구현된 것**: (what exists that helps)\n2. **갭 (없는 것)**: (what's missing)\n3. **도입 가능성**: (effort: 1일/1주/1달, blockers)`;
      return await this.reflexion.callLLM(prompt, 'normal').catch(() => `분석 실패. 아이디어: ${idea}`);
    }
    return `교차분석: "${idea}" — LLM 또는 MEMORY.md 없음`;
  }

  // ── Legacy API (backward-compatible with existing tests) ──

  async analyzeFeasibility(requestText) {
    if (this.reflexion) {
      const prompt = `Analyze feasibility and generate a PRD for this idea:\n\n${requestText}\n\nRespond with: title, scope, and key requirements.`;
      const result = await this.reflexion.callLLM(prompt, 'normal');
      return result || `PRD draft for: ${requestText}`;
    }
    if (!this.config.openClawEndpoint) {
      return `PRD draft for: ${requestText}`;
    }
    const response = await fetch(this.config.openClawEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: requestText }),
    });
    if (!response.ok) throw new Error('Failed to reach OpenClaw reasoning engine');
    const data = await response.json();
    return data.response;
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
            this.client?.sendMessage(data.context.chatId, `🔍 Research Complete:\n${data.summary}`);
          }
        } catch {}
      });
      sub.subscribe('google:finished', async (msg) => {
        try {
          const data = JSON.parse(msg);
          if (data.context?.chatId) {
            this.client?.sendMessage(data.context.chatId, `📄 Google Doc Created:\n${data.docUrl}`);
          }
        } catch {}
      });
    } catch (err) {
      log.warn('telegram-bot', 'listenForUpdates failed', { error: err.message });
    }
  }
}

module.exports = TelegramDevelopmentBot;
