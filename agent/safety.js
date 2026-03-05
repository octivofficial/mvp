/**
 * Octiv Safety Agent — health-monitor + automated-debugging role
 * AC-8 threat detection (lava/fall/infinite-loop), sandbox code validation
 *
 * Sandbox: node:vm with isolated context (replaces vm2 CVE-2023-37466).
 */
const { Blackboard } = require('./blackboard');
const { validateCode } = require('./vm-sandbox');
const T = require('../config/timeouts');
const { getLogger } = require('./logger');
const log = getLogger();

const AC8_THRESHOLDS = {
  lava: {
    minY: 10,
    lavaBlockRadius: 3,
  },
  fall: {
    damageThreshold: 10,   // hearts
    velocityThreshold: -20, // velocity.y
  },
  loop: {
    maxIterations: 50,
    maxRepeatActions: 8,
  },
};

class SafetyAgent {
  constructor() {
    this.id = 'safety';
    this.board = new Blackboard();
    this.actionHistory = [];
    this.reactIterations = 0;
    this.consecutiveFailures = 0;
    this.lastThreatTime = {};
    this.logger = null;
  }

  setLogger(logger) { this.logger = logger; }

  async init() {
    await this.board.connect();
    this.subscriber = await this.board.createSubscriber();
    this._startMonitoring();
    log.info(this.id, 'initialized, AC-8 monitoring started');
  }

  // 3.2: Subscribe to all builder health/status channels
  _startMonitoring() {
    this.subscriber.pSubscribe('octiv:agent:builder-*:health', async (message) => {
      try {
        const data = JSON.parse(message);
        const mockBot = {
          entity: {
            position: data.position || { x: 0, y: 64, z: 0 },
            velocity: data.velocity || { x: 0, y: 0, z: 0 },
          },
          health: data.health || 20,
          findBlock: () => null,
          registry: { blocksByName: {} },
        };
        const threat = this.detectThreat(mockBot);
        if (threat) {
          await this.handleThreat(threat, data.agentId || 'unknown');
        } else if (this.consecutiveFailures > 0) {
          this.consecutiveFailures = 0;
        }
      } catch (err) {
        log.error(this.id, 'health monitor error', { error: err.message });
      }
    });

    this.subscriber.pSubscribe('octiv:agent:builder-*:react', async (message) => {
      try {
        const data = JSON.parse(message);
        this.reactIterations = data.iteration || 0;
      } catch {}
    });
  }

  // AC-8.1: Threat detection
  detectThreat(bot) {
    const pos = bot.entity.position;
    const vel = bot.entity.velocity;

    // Lava detection
    if (pos.y < AC8_THRESHOLDS.lava.minY) {
      return { type: 'lava', reason: `Y=${Math.floor(pos.y)} < 10` };
    }
    const lavaBlock = bot.findBlock({ matching: bot.registry.blocksByName.lava?.id, maxDistance: 3 });
    if (lavaBlock) {
      return { type: 'lava', reason: 'lava detected within 3 blocks' };
    }

    // Fall detection
    if (vel.y < AC8_THRESHOLDS.fall.velocityThreshold) {
      return { type: 'fall', reason: `velocity.y=${vel.y.toFixed(2)}` };
    }
    if (bot.health <= (20 - AC8_THRESHOLDS.fall.damageThreshold)) {
      return { type: 'fall', reason: `health ${bot.health}/20` };
    }

    // Infinite loop detection
    if (this.reactIterations >= AC8_THRESHOLDS.loop.maxIterations) {
      return { type: 'loop', reason: `ReAct iterations: ${this.reactIterations}` };
    }
    if (this.actionHistory.length >= 8) {
      const last8 = this.actionHistory.slice(-8);
      if (new Set(last8).size === 1) {
        return { type: 'loop', reason: `same action repeated 8 times: ${last8[0]}` };
      }
    }

    return null;
  }

  // AC-8.3: Sandbox code validation via node:vm (3x dry-run)
  async verifySkillCode(code, maxAttempts = 3) {
    const result = await validateCode(code, maxAttempts);
    if (!result.valid) {
      log.error(this.id, `sandbox validation failed (${result.attempt}/${maxAttempts})`, { error: result.error });
      return false;
    }
    log.info(this.id, `sandbox validation passed (${maxAttempts}/${maxAttempts})`);
    return true;
  }

  // AC-8: Threat detected → trigger skill creation (debounced per type)
  async handleThreat(threat, agentId) {
    const now = Date.now();
    if (now - (this.lastThreatTime[threat.type] || 0) < T.THREAT_COOLDOWN_MS) return;
    this.lastThreatTime[threat.type] = now;

    log.warn(this.id, `threat detected: ${threat.type} — ${threat.reason}`);
    this.consecutiveFailures++;
    if (this.logger) this.logger.logEvent(this.id, { type: 'threat', agentId, ...threat }).catch(e => log.error(this.id, 'log persist error', { error: e.message }));

    await this.board.publish('safety:threat', {
      author: 'safety',
      agentId,
      threat,
      consecutiveFailures: this.consecutiveFailures,
    });

    // Broadcast to AC-8 emergency channel
    await this.board.publish('skills:emergency', {
      author: 'safety',
      failureType: threat.type,
      agentId,
      triggerSkillCreation: true,
    });

    // 3 consecutive failures → force Group Reflexion
    if (this.consecutiveFailures >= 3) {
      await this.board.publish('leader:reflexion', {
        author: 'safety',
        type: 'group',
        trigger: 'consecutive_failures_3',
        failureType: threat.type,
      });
    }
  }

  // AC-6: Prompt injection detection
  filterPromptInjection(text) {
    const patterns = [
      /ignore\s+(previous|prior|above)\s+(instructions|prompts)/i,
      /system\s+prompt/i,
      /you\s+are\s+now/i,
      /forget\s+(your\s+)?instructions/i,
      /new\s+instructions\s*:/i,
      /\n\s*\n\s*Human\s*:/i,
      /\n\s*\n\s*Assistant\s*:/i,
      /disregard\s+(all\s+)?(previous|prior)/i,
      /override\s+(your\s+)?(rules|instructions)/i,
    ];

    for (const pattern of patterns) {
      if (pattern.test(text)) {
        return {
          safe: false,
          reason: `prompt_injection: ${pattern.source}`,
          sanitized: '',
        };
      }
    }

    return { safe: true, reason: null, sanitized: text };
  }

  async shutdown() {
    if (this.subscriber) {
      await this.subscriber.pUnsubscribe();
      await this.subscriber.disconnect();
    }
    await this.board.disconnect();
  }
}

// Static version for use without SafetyAgent instance
SafetyAgent.filterPromptInjection = SafetyAgent.prototype.filterPromptInjection;

module.exports = { SafetyAgent };
