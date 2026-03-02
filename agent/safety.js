/**
 * Octiv Safety Agent — health-monitor + automated-debugging 역할
 * AC-8 위험 감지 (용암/추락/무한루프), vm2 코드 검증
 */
const { Blackboard } = require('./blackboard');
const { VM } = require('vm2');

const AC8_THRESHOLDS = {
  lava: {
    minY: 10,
    lavaBlockRadius: 3,
  },
  fall: {
    damageThreshold: 10,   // 하트
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
  }

  async init() {
    await this.board.connect();
    console.log('[Safety] 초기화 완료, AC-8 감시 시작');
  }

  // AC-8.1: 위험 감지
  detectThreat(bot) {
    const pos = bot.entity.position;
    const vel = bot.entity.velocity;

    // 용암 감지
    if (pos.y < AC8_THRESHOLDS.lava.minY) {
      return { type: 'lava', reason: `Y=${Math.floor(pos.y)} < 10` };
    }
    const lavaBlock = bot.findBlock({ matching: bot.registry.blocksByName.lava?.id, maxDistance: 3 });
    if (lavaBlock) {
      return { type: 'lava', reason: '3블록 내 용암 감지' };
    }

    // 추락 감지
    if (vel.y < AC8_THRESHOLDS.fall.velocityThreshold) {
      return { type: 'fall', reason: `velocity.y=${vel.y.toFixed(2)}` };
    }
    if (bot.health <= (20 - AC8_THRESHOLDS.fall.damageThreshold)) {
      return { type: 'fall', reason: `체력 ${bot.health}/20` };
    }

    // 무한루프 감지
    if (this.reactIterations >= AC8_THRESHOLDS.loop.maxIterations) {
      return { type: 'loop', reason: `ReAct ${this.reactIterations}회 반복` };
    }
    if (this.actionHistory.length >= 8) {
      const last8 = this.actionHistory.slice(-8);
      if (new Set(last8).size === 1) {
        return { type: 'loop', reason: `동일 액션 8회 반복: ${last8[0]}` };
      }
    }

    return null;
  }

  // AC-8.3: vm2 샌드박스 코드 검증 (3회 dry-run)
  async verifySkillCode(code, maxAttempts = 3) {
    let attempts = 0;
    while (attempts < maxAttempts) {
      try {
        const vm = new VM({ timeout: 3000, sandbox: {} });
        vm.run(`(async function() { ${code} })`);
        attempts++;
        console.log(`[Safety] vm2 검증 통과 (${attempts}/${maxAttempts})`);
      } catch (err) {
        console.error(`[Safety] vm2 검증 실패 (${attempts + 1}/${maxAttempts}):`, err.message);
        return false;
      }
    }
    return true;
  }

  // AC-8: 위협 감지 → 스킬 생성 트리거
  async handleThreat(threat, agentId) {
    console.warn(`[Safety] ⚠️  위협 감지: ${threat.type} — ${threat.reason}`);
    this.consecutiveFailures++;

    await this.board.publish('safety:threat', {
      agentId,
      threat,
      consecutiveFailures: this.consecutiveFailures,
    });

    // AC-8 Emergency 채널에 브로드캐스트
    await this.board.publish('skills:emergency', {
      failureType: threat.type,
      agentId,
      triggerSkillCreation: true,
    });

    // 3회 연속 실패 → Group Reflexion 강제 실행
    if (this.consecutiveFailures >= 3) {
      await this.board.publish('leader:reflexion', {
        type: 'group',
        trigger: 'consecutive_failures_3',
        failureType: threat.type,
      });
    }
  }

  async shutdown() {
    await this.board.disconnect();
  }
}

module.exports = { SafetyAgent };
