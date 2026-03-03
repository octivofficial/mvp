/**
 * Octiv Skill Pipeline — Phase 4.1 + 4.2
 * Failure → LLM skill generation → vm2 validation → deploy to library
 * Dynamic skill library with success_rate tracking and daily limits.
 */
const { Blackboard } = require('./blackboard');
const { VM } = require('vm2');

const DAILY_LIMIT = 5;
const MIN_SUCCESS_RATE = 0.7;

class SkillPipeline {
  constructor(llmClient = null) {
    this.board = new Blackboard();
    this.llmClient = llmClient; // injected LLM client (ReflexionEngine)
    this.dailyCount = 0;
    this.dailyResetAt = Date.now() + 86400000;
  }

  async init() {
    await this.board.connect();
    // Load daily count from Redis
    const parsed = await this.board.getConfig('skills:daily_meta');
    if (parsed && parsed.resetAt > Date.now()) {
      this.dailyCount = parsed.count;
      this.dailyResetAt = parsed.resetAt;
    }
    console.log(`[SkillPipeline] initialized, daily: ${this.dailyCount}/${DAILY_LIMIT}`);
  }

  // 4.1: Full pipeline — failure → generate → validate → deploy
  async generateFromFailure(failureContext) {
    this._checkDailyReset();
    if (this.dailyCount >= DAILY_LIMIT) {
      return { success: false, reason: 'daily_limit_reached' };
    }

    // Generate skill via LLM
    let skillJson;
    if (this.llmClient) {
      skillJson = await this.llmClient.generateSkill(failureContext);
    } else {
      // Fallback: create a basic retry skill
      skillJson = this._fallbackSkill(failureContext);
    }

    if (!skillJson || !skillJson.name || !skillJson.code) {
      return { success: false, reason: 'invalid_skill_json' };
    }

    // vm2 3x validation
    const valid = await this.validateSkill(skillJson.code);
    if (!valid) {
      return { success: false, reason: 'vm2_validation_failed' };
    }

    // Deploy to library
    await this.deploySkill(skillJson);
    this.dailyCount++;
    await this._saveDailyMeta();

    // Broadcast emergency channel
    await this.board.publish('skills:emergency', {
      newSkill: skillJson.name,
      trigger: failureContext.error,
    });

    console.log(`[SkillPipeline] deployed: ${skillJson.name} (${this.dailyCount}/${DAILY_LIMIT})`);
    return { success: true, skill: skillJson.name };
  }

  // 4.1: vm2 sandbox validation (3x dry-run)
  async validateSkill(code, attempts = 3) {
    for (let i = 0; i < attempts; i++) {
      try {
        const vm = new VM({ timeout: 3000, sandbox: {} });
        vm.run(`(function() { ${code} })`);
      } catch (err) {
        console.error(`[SkillPipeline] validation failed (${i + 1}/${attempts}): ${err.message}`);
        return false;
      }
    }
    return true;
  }

  // 4.2: Deploy skill to Redis library
  async deploySkill(skillJson) {
    const entry = {
      ...skillJson,
      deployedAt: Date.now(),
      success_rate: 1.0,
      uses: 0,
      successes: 0,
    };
    await this.board.saveSkill(skillJson.name, entry);
    return entry;
  }

  // 4.2: Update skill success rate after use
  async updateSuccessRate(skillName, succeeded) {
    const skill = await this.board.getSkill(skillName);
    if (!skill) return null;

    skill.uses++;
    if (succeeded) skill.successes++;
    skill.success_rate = skill.uses > 0 ? skill.successes / skill.uses : 0;

    // Discard if success rate drops below threshold
    if (skill.uses >= 3 && skill.success_rate < MIN_SUCCESS_RATE) {
      await this.board.deleteHashField('skills:library', skillName);
      console.log(`[SkillPipeline] discarded: ${skillName} (rate: ${skill.success_rate.toFixed(2)})`);
      return { discarded: true, skill: skillName, rate: skill.success_rate };
    }

    await this.board.saveSkill(skillName, skill);
    return { discarded: false, skill: skillName, rate: skill.success_rate };
  }

  // 4.2: Get all skills from library
  async getLibrary() {
    const all = await this.board.getHash('skills:library');
    const result = {};
    for (const [name, raw] of Object.entries(all)) {
      try { result[name] = JSON.parse(raw); } catch {}
    }
    return result;
  }

  _fallbackSkill(context) {
    const errorType = context.errorType || 'unknown';
    return {
      name: `fallback_${errorType}_v1`,
      code: `// Auto-generated fallback for ${errorType}\nconst retry = true;`,
      description: `Fallback skill for ${context.error}`,
      errorType,
    };
  }

  _checkDailyReset() {
    if (Date.now() >= this.dailyResetAt) {
      this.dailyCount = 0;
      this.dailyResetAt = Date.now() + 86400000;
    }
  }

  async _saveDailyMeta() {
    await this.board.setConfig('skills:daily_meta', {
      count: this.dailyCount, resetAt: this.dailyResetAt,
    });
  }

  async shutdown() {
    await this.board.disconnect();
  }
}

module.exports = { SkillPipeline, DAILY_LIMIT, MIN_SUCCESS_RATE };
