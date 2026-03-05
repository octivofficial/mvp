/**
 * Octiv Zettelkasten Hooks — Auto-Memory Wiring
 *
 * Connects the Zettelkasten system to the agent lifecycle:
 *   - When a skill is deployed → create atomic note
 *   - When a skill is used → record XP + co-occurrence
 *   - When a skill fails → feed rumination engine
 *   - When group reflexion runs → trigger GoT reasoning cycle
 *   - Periodic → deep rumination + vault sync
 *
 * This file is the glue between:
 *   SkillPipeline → SkillZettelkasten → RuminationEngine → GoTReasoner
 *
 * Usage in team.js:
 *   const hooks = new ZettelkastenHooks(zettelkasten, rumination, got);
 *   hooks.wireToBuilder(builder);
 *   hooks.wireToLeader(leader);
 *   hooks.wireToSkillPipeline(pipeline);
 */
const { Blackboard } = require('./blackboard');
const T = require('../config/timeouts');
const { getLogger } = require('./logger');
const log = getLogger();

class ZettelkastenHooks {
  constructor(zettelkasten, rumination, gotReasoner, options = {}) {
    this.zk = zettelkasten;
    this.rumination = rumination;
    this.got = gotReasoner;
    this.board = new Blackboard();
    this.logger = options.logger || null;

    // Auto GoT reasoning after N rumination cycles
    this.ruminationsSinceReasoning = 0;
    this.reasoningThreshold = options.reasoningThreshold || 5;

    // Deep rumination schedule (every 30 minutes)
    this.deepRuminationInterval = options.deepRuminationIntervalMs || T.DEEP_RUMINATION_INTERVAL_MS;
    this.deepTimer = null;
  }

  async init() {
    await this.board.connect();

    // Subscribe to skill events
    const sub = await this.board.createSubscriber();

    // Listen for skill deployments
    sub.subscribe(Blackboard.PREFIX + 'skills:emergency', async (message) => {
      try {
        const data = JSON.parse(message);
        await this._onSkillDeployed(data);
      } catch (err) {
        log.error('zk-hooks', 'skills:emergency handler error', { error: err.message });
      }
    });

    // Listen for rumination completions
    sub.subscribe(Blackboard.PREFIX + 'rumination:digested', async (message) => {
      try {
        const data = JSON.parse(message);
        await this._onDigestionComplete(data);
      } catch (err) {
        log.error('zk-hooks', 'rumination:digested handler error', { error: err.message });
      }
    });

    // Listen for tier-ups (celebration!)
    sub.subscribe(Blackboard.PREFIX + 'zettelkasten:tier-up', async (message) => {
      try {
        const data = JSON.parse(message);
        await this._onTierUp(data);
      } catch (err) {
        log.error('zk-hooks', 'zettelkasten:tier-up handler error', { error: err.message });
      }
    });

    // Listen for compound creation
    sub.subscribe(Blackboard.PREFIX + 'zettelkasten:compound-created', async (message) => {
      try {
        const data = JSON.parse(message);
        await this._onCompoundCreated(data);
      } catch (err) {
        log.error('zk-hooks', 'zettelkasten:compound-created handler error', { error: err.message });
      }
    });

    // Start deep rumination cycle
    this._startDeepRumination();

    log.info('zk-hooks', 'initialized, listening for skill events');
  }

  // ── Builder Wiring ────────────────────────────────────────

  /**
   * Wire hooks to a BuilderAgent
   * Intercepts skill usage events and feeds the Zettelkasten
   */
  wireToBuilder(builder) {
    const originalTrySkill = builder._tryLearnedSkill?.bind(builder);
    if (!originalTrySkill) {
      log.warn('zk-hooks', 'builder has no _tryLearnedSkill, skipping wire');
      return;
    }

    // Wrap _tryLearnedSkill to capture skill usage
    builder._tryLearnedSkill = async (error) => {
      const result = await originalTrySkill(error);

      // Feed experience to rumination engine
      this.rumination.feed({
        agentId: builder.id,
        errorType: error.message || 'unknown',
        skillUsed: result?.skillName || null,
        succeeded: result?.success || false,
        coSkills: result?.coSkills || [],
        timestamp: Date.now(),
      });

      // Record in Zettelkasten if a skill was used
      if (result?.skillName) {
        try {
          await this.zk.recordUsage(
            this.zk._slugify(result.skillName),
            result.success,
            { coSkills: (result.coSkills || []).map(s => this.zk._slugify(s)) }
          );
        } catch (err) {
          log.error('zk-hooks', 'recordUsage error', { error: err.message });
        }
      }

      return result;
    };

    // Also capture failures that don't involve skills (bone broth material)
    const originalSelfImprove = builder._selfImprove?.bind(builder);
    if (originalSelfImprove) {
      builder._selfImprove = async (error) => {
        this.rumination.feedFailure({
          agentId: builder.id,
          errorType: error.message || 'unknown',
          error: error.toString(),
          timestamp: Date.now(),
        });
        return await originalSelfImprove(error);
      };
    }

    log.info('zk-hooks', `wired to builder: ${builder.id}`);
  }

  // ── Leader Wiring ─────────────────────────────────────────

  /**
   * Wire hooks to LeaderAgent
   * After group reflexion → trigger GoT reasoning
   */
  wireToLeader(leader) {
    const originalGroupReflexion = leader.triggerGroupReflexion?.bind(leader);
    if (!originalGroupReflexion) return;

    leader.triggerGroupReflexion = async () => {
      const result = await originalGroupReflexion();

      // Trigger GoT reasoning after group reflexion
      try {
        const gotResult = await this.got.fullReasoningCycle();
        if (this.logger) {
          this.logger.logEvent('zettelkasten-hooks', {
            type: 'got_triggered_by_reflexion',
            synergies: gotResult.summary.totalSynergies,
            gaps: gotResult.summary.totalGaps,
          });
        }
      } catch (err) {
        log.error('zk-hooks', 'GoT reasoning failed', { error: err.message });
      }

      return result;
    };

    log.info('zk-hooks', 'wired to leader');
  }

  // ── SkillPipeline Wiring ──────────────────────────────────

  /**
   * Wire hooks to SkillPipeline
   * When a new skill is deployed → create Zettelkasten note
   */
  wireToSkillPipeline(pipeline) {
    const originalDeploy = pipeline.deploySkill?.bind(pipeline);
    if (!originalDeploy) return;

    pipeline.deploySkill = async (skillJson) => {
      const result = await originalDeploy(skillJson);

      // Create atomic Zettelkasten note for the new skill
      try {
        await this.zk.createNote({
          name: skillJson.name,
          code: skillJson.code,
          description: skillJson.description,
          errorType: skillJson.errorType,
          agentId: 'skill-pipeline',
        });
      } catch (err) {
        log.error('zk-hooks', 'note creation failed', { error: err.message });
      }

      return result;
    };

    // Wire updateSuccessRate to Zettelkasten
    const originalUpdateRate = pipeline.updateSuccessRate?.bind(pipeline);
    if (originalUpdateRate) {
      pipeline.updateSuccessRate = async (skillName, succeeded) => {
        const result = await originalUpdateRate(skillName, succeeded);

        // Mirror success tracking to Zettelkasten
        try {
          const slugId = this.zk._slugify(skillName);
          await this.zk.recordUsage(slugId, succeeded, {});

          // If pipeline discarded the skill, deprecate in Zettelkasten too
          if (result?.discarded) {
            await this.zk.deprecateNote(slugId, 'low_success_rate');
          }
        } catch (err) {
          log.error('zk-hooks', 'updateSuccessRate mirror error', { error: err.message });
        }

        return result;
      };
    }

    log.info('zk-hooks', 'wired to skill pipeline');
  }

  // ── Event Handlers ────────────────────────────────────────

  async _onSkillDeployed(data) {
    if (!data.newSkill) return; // safety alerts don't have newSkill
    log.info('zk-hooks', `new skill deployed: ${data.newSkill}`);
    // Note already created by pipeline wire, just log
    if (this.logger) {
      this.logger.logEvent('zettelkasten-hooks', {
        type: 'skill_deployed_to_zk',
        skill: data.newSkill,
      });
    }
  }

  async _onDigestionComplete(_data) {
    this.ruminationsSinceReasoning++;

    // After enough digestions, trigger GoT reasoning
    if (this.ruminationsSinceReasoning >= this.reasoningThreshold) {
      this.ruminationsSinceReasoning = 0;
      log.info('zk-hooks', 'triggering GoT reasoning after rumination cycle');
      try {
        await this.got.fullReasoningCycle();
      } catch (err) {
        log.error('zk-hooks', 'GoT reasoning failed', { error: err.message });
      }
    }
  }

  async _onTierUp(data) {
    log.info('zk-hooks', `TIER UP: ${data.skill} → ${data.newTier} (XP: ${data.xp})`);

    // Publish celebration to all agents
    await this.board.publish('team:celebration', {
      author: 'zettelkasten-hooks',
      event: 'tier_up',
      skill: data.skill,
      tier: data.newTier,
      xp: data.xp,
    });

    if (this.logger) {
      this.logger.logEvent('zettelkasten-hooks', {
        type: 'tier_up',
        skill: data.skill,
        oldTier: data.oldTier,
        newTier: data.newTier,
        xp: data.xp,
      });
    }
  }

  async _onCompoundCreated(data) {
    log.info('zk-hooks', `COMPOUND FORGED: ${data.compound}`);

    if (this.logger) {
      this.logger.logEvent('zettelkasten-hooks', {
        type: 'compound_created',
        compound: data.compound,
        sources: data.sources,
        inheritedXP: data.inheritedXP,
      });
    }
  }

  // ── Deep Rumination Schedule ──────────────────────────────

  _startDeepRumination() {
    this.deepTimer = setInterval(async () => {
      try {
        log.info('zk-hooks', 'scheduled deep rumination...');
        await this.rumination.deepRuminate();
      } catch (err) {
        log.error('zk-hooks', 'deep rumination failed', { error: err.message });
      }
    }, this.deepRuminationInterval);
  }

  // ── Stats ─────────────────────────────────────────────────

  async getFullStats() {
    const zkStats = await this.zk.getStats();
    const rumStats = this.rumination.getStats();

    return {
      zettelkasten: zkStats,
      rumination: rumStats,
      ruminationsSinceReasoning: this.ruminationsSinceReasoning,
      reasoningThreshold: this.reasoningThreshold,
    };
  }

  async shutdown() {
    if (this.deepTimer) clearInterval(this.deepTimer);
    await this.board.disconnect();
  }
}

module.exports = { ZettelkastenHooks };
