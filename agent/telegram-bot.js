// agent/telegram-bot.js
const { getLogger } = require('./logger');
const log = getLogger();

class TelegramDevelopmentBot {
  constructor(config = {}, board = null, reflexion = null, clientFactory = null) {
    if (!config || Object.keys(config).length === 0) {
      throw new Error('Missing configuration');
    }
    this.config = config;
    this.board = board;
    this.reflexion = reflexion;
    this.clientFactory = clientFactory;
    
    if (!this.board) {
      const { Blackboard } = require('./blackboard');
      this.board = new Blackboard(config.blackboardUrl);
    }
  }

  startPolling() {
    let BotApi = this.clientFactory;
    if (!BotApi) {
      // Lazy load to prevent crash if uninstalled
      BotApi = require('node-telegram-bot-api');
    }

    this.client = new BotApi(this.config.telegramToken, { polling: true });
    
    this.client.on('message', async (msg) => {
      if (msg.text) {
        await this._routeMessage(msg);
      }
    });

    this.listenForUpdates();
  }

  async _routeMessage(msg) {
    const chatId = msg.chat.id;
    const text = msg.text.trim();

    // 1. Authorized user check
    const authUsers = this.config.authorizedUsers || [];
    if (authUsers.length > 0 && !authUsers.includes(chatId)) {
      this.client.sendMessage(chatId, 'Unauthorized: You do not have permission to use this bot.');
      return;
    }

    // 2. Command routing
    if (text.startsWith('/start')) {
      const welcomeMsg = 'Welcome to Octiv Development Bot!\nI am ready to help you vibe-code. Send me your requirements.';
      this.client.sendMessage(chatId, welcomeMsg);
      return;
    }

    if (text.startsWith('/help')) {
      const helpMsg = 'Available commands:\n/start - Start the bot\n/help - Show this message\n/reset - Clear context';
      this.client.sendMessage(chatId, helpMsg);
      return;
    }

    if (text.startsWith('/reset')) {
      const resetMsg = 'Conversation state reset.';
      this.client.sendMessage(chatId, resetMsg);
      return;
    }

    // 3. Normal text → Vibe Coding pipeline
    if (!text.startsWith('/')) {
      const author = msg.from?.username || msg.from?.first_name || 'anonymous';

      // Intent-based autonomous routing via reflexion engine (if available)
      if (this.reflexion) {
        const intentResult = await this.reflexion.handleIntent(text, { author, chatId });
        if (intentResult) {
          this.client.sendMessage(chatId, intentResult);
          return;
        }
      }

      // Log idea to Blackboard, then generate PRD
      await this.board.publish('telegram:idea', {
        author, text, chatId,
        timestamp: new Date().toISOString(),
        chatTitle: msg.chat.title || 'private'
      });
      log.info('telegram-bot', `Routing to vibe coding pipeline: "${text.slice(0, 60)}"`);
      const prdData = await this.handleMessage(text);
      if (prdData?.title) {
        this.client.sendMessage(chatId, `PRD published.\nTitle: ${prdData.title}`);
      }
      return;
    }

    // 4. Explicit /vibe command (legacy path)
    if (text.startsWith('/vibe')) {
      const prdData = await this.handleMessage(text.replace('/vibe', '').trim());
      this.client.sendMessage(chatId, `PRD published to Blackboard.\nTitle: ${prdData.title}`);
    }
  }

  async analyzeFeasibility(requestText) {
    // Primary: use ReflexionEngine if available (no external endpoint needed)
    if (this.reflexion) {
      const prompt = `Analyze feasibility and generate a PRD for this idea:\n\n${requestText}\n\nRespond with: title, scope, and key requirements.`;
      const result = await this.reflexion.callLLM(prompt, 'normal');
      return result || `PRD draft for: ${requestText}`;
    }

    // Fallback: external OpenClaw endpoint
    if (!this.config.openClawEndpoint) {
      return `PRD draft for: ${requestText}`;
    }

    const response = await fetch(this.config.openClawEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: requestText })
    });

    if (!response.ok) {
      throw new Error('Failed to reach OpenClaw reasoning engine');
    }

    const data = await response.json();
    return data.response;
  }

  formatToPRD(rawText) {
    return {
      title: 'Generated PRD',
      content: rawText,
      author: 'telegram-bot'
    };
  }

  async publishPRD(prdData) {
    await this.board.publish('telegram:prd', {
      ...prdData,
      author: 'telegram-bot'
    });
  }

  async listenForUpdates() {
    if (this.board) {
      const sub = await this.board.createSubscriber();
      sub.subscribe('crawler:finished', async (msg) => {
        try {
          const data = JSON.parse(msg);
          if (data.context?.chatId) {
            this.client.sendMessage(data.context.chatId, `🔍 Research Complete:\n${data.summary}`);
          }
        } catch {}
      });

      sub.subscribe('google:finished', async (msg) => {
        try {
          const data = JSON.parse(msg);
          if (data.context?.chatId) {
            this.client.sendMessage(data.context.chatId, `📄 Google Doc Created:\n${data.docUrl}`);
          }
        } catch {}
      });
    }
  }

  async handleMessage(text) {
    const rawResponse = await this.analyzeFeasibility(text);
    const prdData = this.formatToPRD(rawResponse);
    await this.publishPRD(prdData);
    return prdData;
  }
}

module.exports = TelegramDevelopmentBot;
