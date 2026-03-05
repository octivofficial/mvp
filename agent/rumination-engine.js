/**
 * Octiv Rumination Engine — 되새김질 (Multi-Stomach Digestion)
 *
 * Philosophy:
 *   A cow has 4 stomachs. It chews the same food multiple times,
 *   extracting more nutrition each pass. Our agents do the same:
 *
 *   Stomach 1 (반추위, Rumen): Raw experience intake → JSONL log
 *   Stomach 2 (벌집위, Reticulum): Pattern filtering → co-occurrence detection
 *   Stomach 3 (겹주름위, Omasum): Insight extraction → strength calculation
 *   Stomach 4 (주름위, Abomasum): Final digestion → compound skill creation
 *
 *   Even bones become gomguk (곰국): failures are boiled down for value.
 *
 * Triggers:
 *   - Periodic (every N minutes): digest recent experiences
 *   - Event-driven: after group reflexion
 *   - Manual: leader requests deep rumination
 */
const { Blackboard } = require('./blackboard');
const T = require('../config/timeouts');
const { getLogger } = require('./logger');
const log = getLogger();

const RUMINATION_INTERVAL = T.RUMINATION_INTERVAL_MS;
const MIN_EXPERIENCES_TO_DIGEST = 3;

class RuminationEngine {
  constructor(zettelkasten, options = {}) {
    this.zk = zettelkasten;  // SkillZettelkasten instance
    this.board = new Blackboard();
    this.logger = options.logger || null;

    // Experience buffer (Stomach 1: raw intake)
    this.rawBuffer = [];
    this.digestTimer = null;
    this.totalDigestions = 0;
  }

  async init() {
    await this.board.connect();
    this._startDigestionCycle();
    log.info('rumination', `initialized, cycle: ${RUMINATION_INTERVAL / 1000}s`);
  }

  // ── Stomach 1: 반추위 (Rumen) — Raw Experience Intake ─────

  /**
   * Feed a raw experience into the rumen
   * Called by builders after every action attempt
   */
  feed(experience) {
    this.rawBuffer.push({
      ...experience,
      ingestedAt: Date.now(),
      digested: false,
    });
  }

  /**
   * Feed a failure (bones for gomguk)
   * Failures have special treatment — they carry MORE nutritional info
   */
  feedFailure(failure) {
    this.feed({
      ...failure,
      type: 'failure',
      nutritionMultiplier: 1.5, // Failures teach more (뼈까지 곰국)
    });
  }

  // ── Stomach 2: 벌집위 (Reticulum) — Pattern Filtering ─────

  /**
   * Filter the raw buffer for digestible patterns
   * Groups experiences by error type and skill usage
   */
  _filterPatterns(experiences) {
    const patterns = {};

    for (const exp of experiences) {
      const key = exp.errorType || exp.skillUsed || 'general';
      if (!patterns[key]) {
        patterns[key] = {
          errorType: key,
          experiences: [],
          successCount: 0,
          failureCount: 0,
          skillsInvolved: new Set(),
        };
      }
      patterns[key].experiences.push(exp);
      if (exp.succeeded) patterns[key].successCount++;
      else patterns[key].failureCount++;
      if (exp.skillUsed) patterns[key].skillsInvolved.add(exp.skillUsed);
      if (exp.coSkills) {
        for (const s of exp.coSkills) patterns[key].skillsInvolved.add(s);
      }
    }

    // Convert Sets to arrays
    for (const p of Object.values(patterns)) {
      p.skillsInvolved = [...p.skillsInvolved];
    }

    return patterns;
  }

  // ── Stomach 3: 겹주름위 (Omasum) — Insight Extraction ────

  /**
   * Extract insights from filtered patterns
   * This is where "nutrition" is actually absorbed
   */
  _extractInsights(patterns) {
    const insights = [];

    for (const [errorType, pattern] of Object.entries(patterns)) {
      const total = pattern.experiences.length;
      if (total < MIN_EXPERIENCES_TO_DIGEST) continue;

      const successRate = total > 0 ? pattern.successCount / total : 0;

      // Insight: which skills work for this error type?
      if (pattern.skillsInvolved.length > 0 && successRate > 0.5) {
        insights.push({
          type: 'effective_skill',
          errorType,
          skills: pattern.skillsInvolved,
          confidence: successRate,
          sampleSize: total,
          insight: `Skills [${pattern.skillsInvolved.join(', ')}] effective for ${errorType} (${(successRate * 100).toFixed(0)}% success, n=${total})`,
        });
      }

      // Insight: co-occurrence pattern (skills used together)
      if (pattern.skillsInvolved.length >= 2 && successRate > 0.6) {
        insights.push({
          type: 'co_occurrence',
          errorType,
          skills: pattern.skillsInvolved,
          strength: successRate,
          sampleSize: total,
          insight: `Skills [${pattern.skillsInvolved.join(' + ')}] synergize for ${errorType}`,
        });
      }

      // Insight from failure patterns (gomguk — bone broth)
      if (pattern.failureCount >= 3 && successRate < 0.3) {
        insights.push({
          type: 'failure_pattern',
          errorType,
          skills: pattern.skillsInvolved,
          failureRate: 1 - successRate,
          sampleSize: total,
          insight: `Persistent failure: ${errorType} (${pattern.failureCount} failures). Current skills insufficient — new approach needed.`,
        });
      }
    }

    return insights;
  }

  // ── Stomach 4: 주름위 (Abomasum) — Final Digestion ───────

  /**
   * Full digestion cycle — process all 4 stomachs
   * This is the "chewing the cud" moment
   */
  async digest() {
    if (this.rawBuffer.length < MIN_EXPERIENCES_TO_DIGEST) {
      return { digested: 0, insights: [], actions: [] };
    }

    this.totalDigestions++;
    const batch = this.rawBuffer.splice(0); // drain buffer
    const actions = [];

    log.info('rumination', `digestion #${this.totalDigestions}: ${batch.length} experiences`);

    // Stomach 2: Filter patterns
    const patterns = this._filterPatterns(batch);

    // Stomach 3: Extract insights
    const insights = this._extractInsights(patterns);

    // Stomach 4: Act on insights
    for (const insight of insights) {
      switch (insight.type) {
        case 'co_occurrence': {
          // Record co-occurrences in Zettelkasten (strengthens links)
          for (let i = 0; i < insight.skills.length; i++) {
            for (let j = i + 1; j < insight.skills.length; j++) {
              const result = await this.zk.recordUsage(insight.skills[i], true, {
                coSkills: [insight.skills[j]],
              });
              if (result) actions.push({ action: 'link_strengthened', skills: [insight.skills[i], insight.skills[j]] });
            }
          }
          break;
        }

        case 'effective_skill': {
          // Add XP to effective skills
          for (const skillId of insight.skills) {
            await this.zk.recordUsage(skillId, true, {});
            actions.push({ action: 'xp_added', skill: skillId, reason: 'effective_pattern' });
          }
          break;
        }

        case 'failure_pattern': {
          // Add rumination note to involved skills
          for (const skillId of insight.skills) {
            const note = await this.zk.getNote(skillId);
            if (note) {
              note.digestCount++;
              note.lastDigestedAt = Date.now();
              note.ruminationNotes.push({
                ts: Date.now(),
                insight: insight.insight,
                digestionNumber: this.totalDigestions,
              });
              await this.zk.board.setHashField('zettelkasten:notes', skillId, note);
              await this.zk._writeVaultNote(note);
            }
          }

          // Signal for new skill creation (the bones become gomguk)
          actions.push({
            action: 'new_skill_needed',
            errorType: insight.errorType,
            failureRate: insight.failureRate,
            currentSkills: insight.skills,
          });
          break;
        }
      }
    }

    // Publish digestion results
    if (insights.length > 0) {
      await this.board.publish('rumination:digested', {
        author: 'rumination-engine',
        digestionNumber: this.totalDigestions,
        experienceCount: batch.length,
        insightCount: insights.length,
        actionCount: actions.length,
      });
    }

    if (this.logger) {
      this.logger.logEvent('rumination', {
        type: 'digestion_complete',
        number: this.totalDigestions,
        experiences: batch.length,
        insights: insights.length,
        actions: actions.length,
      });
    }

    return { digested: batch.length, insights, actions };
  }

  /**
   * Deep rumination — re-process all existing notes for new patterns
   * Like boiling bones overnight for the richest gomguk
   */
  async deepRuminate() {
    log.info('rumination', 'deep rumination (gomguk mode)...');

    const allNotes = await this.zk.getAllNotes();
    const notes = Object.values(allNotes).filter(n => n.status === 'active');
    const discoveries = [];

    // Find all pairs that are linked but NOT yet compound
    for (let i = 0; i < notes.length; i++) {
      for (let j = i + 1; j < notes.length; j++) {
        const a = notes[i];
        const b = notes[j];

        // Check if they share links and both have decent success rates
        if (a.links.includes(b.id) && a.successRate >= 0.6 && b.successRate >= 0.6) {
          // Check link strength
          const linkKey = `zettelkasten:links:${this.zk._linkKey(a.id, b.id)}`;
          const link = await this.board.getConfig(linkKey);

          if (link && link.strength >= 0.65 && link.coOccurrences >= 3) {
            // Not yet compound? Suggest it
            const compoundId = `compound_${a.id}_${b.id}`;
            const existing = await this.zk.getNote(compoundId);
            if (!existing) {
              discoveries.push({
                type: 'compound_candidate',
                skillA: a.id,
                skillB: b.id,
                combinedXP: a.xp + b.xp,
                linkStrength: link.strength,
              });
            }
          }
        }
      }
    }

    // Also find dormant skills that deserve another chance
    const dormant = notes.filter(n =>
      n.uses >= 5 && n.successRate < 0.5 && n.digestCount < 3
    );
    for (const note of dormant) {
      note.digestCount++;
      note.lastDigestedAt = Date.now();
      note.ruminationNotes.push({
        ts: Date.now(),
        insight: `Deep rumination #${note.digestCount}: skill has ${note.uses} uses but only ${(note.successRate * 100).toFixed(0)}% success. Consider refactoring.`,
        digestionNumber: this.totalDigestions,
      });
      await this.zk.board.setHashField('zettelkasten:notes', note.id, note);
      await this.zk._writeVaultNote(note);
    }

    log.info('rumination', `deep rumination: ${discoveries.length} compound candidates, ${dormant.length} re-digested`);
    return { discoveries, reDigested: dormant.length };
  }

  // ── Periodic Cycle ────────────────────────────────────────

  _startDigestionCycle() {
    this.digestTimer = setInterval(async () => {
      try {
        await this.digest();
      } catch (err) {
        log.error('rumination', 'digestion error', { error: err.message });
      }
    }, RUMINATION_INTERVAL);
  }

  getStats() {
    return {
      bufferSize: this.rawBuffer.length,
      totalDigestions: this.totalDigestions,
    };
  }

  async shutdown() {
    if (this.digestTimer) clearInterval(this.digestTimer);
    await this.board.disconnect();
  }
}

module.exports = { RuminationEngine, RUMINATION_INTERVAL };
