/**
 * Octiv Skill Zettelkasten — Atomic Knowledge Graph for Agent Skills
 *
 * Philosophy (되새김질 — Rumination):
 *   Like a cow with four stomachs, every experience is chewed multiple times.
 *   Like gomguk (곰국), even the bones of failure are boiled down for strength.
 *   Like an RPG, XP accumulates → unlock stronger weapons → become a craftsman.
 *
 * Architecture:
 *   - Atomic Notes: Each skill = one Zettelkasten note with frontmatter
 *   - Wiki-Links: Skills that succeed together get linked ([[skill-A]] → [[skill-B]])
 *   - Compound Skills: Linked clusters that consistently co-occur merge into meta-skills
 *   - XP System: Every use adds XP, XP thresholds unlock skill tiers (Novice→Master)
 *   - Vault Sync: Every mutation persists to Obsidian vault as .md files
 *
 * Storage:
 *   - Redis (octiv:zettelkasten:*) for real-time agent access
 *   - Obsidian vault/04-Skills/*.md for persistence + graph visualization
 *   - JSONL logs for rumination history
 */
const fsp = require('fs').promises;
const path = require('path');
const { Blackboard } = require('./blackboard');
const { getLogger } = require('./logger');
const log = getLogger();

const VAULT_DIR = path.join(__dirname, '..', 'vault', '04-Skills');
const ZK_PREFIX = 'zettelkasten';

// XP tiers — RPG progression
const TIERS = [
  { name: 'Novice',      minXP: 0,    emoji: '🌱' },
  { name: 'Apprentice',  minXP: 10,   emoji: '🔨' },
  { name: 'Journeyman',  minXP: 30,   emoji: '⚒️' },
  { name: 'Expert',      minXP: 70,   emoji: '⚔️' },
  { name: 'Master',      minXP: 150,  emoji: '👑' },
  { name: 'Grandmaster', minXP: 300,  emoji: '🏆' },
];

class SkillZettelkasten {
  constructor(options = {}) {
    this.board = new Blackboard();
    this.vaultDir = options.vaultDir || VAULT_DIR;
    this.logger = options.logger || null;
  }

  async init() {
    await this.board.connect();

    // Ensure vault directories (async)
    for (const sub of ['atomic', 'compound', 'deprecated']) {
      const dir = path.join(this.vaultDir, sub);
      await fsp.mkdir(dir, { recursive: true });
    }

    log.info('zettelkasten', `initialized, vault: ${this.vaultDir}`);
  }

  // ── Atomic Note CRUD ──────────────────────────────────────

  /**
   * Create an atomic skill note (like adding a new card to the Zettelkasten)
   * Every skill starts as a seed — 🌱 Novice tier, 0 XP
   */
  async createNote(skillData) {
    const { name, code, description, errorType, agentId } = skillData;
    if (!name) throw new Error('[Zettelkasten] 眞: skill name required');

    const note = {
      // Identity
      id: this._slugify(name),
      name,
      description: description || '',
      errorType: errorType || 'unknown',
      createdBy: agentId || 'unknown',
      createdAt: Date.now(),

      // Code
      code: code || '',

      // XP System (RPG)
      xp: 0,
      tier: 'Novice',
      uses: 0,
      successes: 0,
      failures: 0,
      successRate: 0,

      // Zettelkasten Links (wiki-links)
      links: [],          // [[other-skill-id]] — skills used together
      backlinks: [],      // skills that link TO this one
      compoundOf: null,   // if compound: array of source skill IDs

      // Rumination (되새김질)
      digestCount: 0,     // how many times this experience has been "chewed"
      lastDigestedAt: null,
      ruminationNotes: [], // insights extracted from repeated digestion

      // Metadata
      tags: [errorType, 'atomic'],
      status: 'active',   // active | dormant | deprecated | compound
    };

    // Save to Redis
    await this.board.setHashField(`${ZK_PREFIX}:notes`, note.id, note);

    // Persist to Obsidian vault
    await this._writeVaultNote(note);

    if (this.logger) {
      this.logger.logEvent('zettelkasten', {
        type: 'note_created',
        skill: note.id,
        tier: note.tier,
      });
    }

    log.info('zettelkasten', `created: ${note.id}`);
    return note;
  }

  /**
   * Record skill usage — add XP, update success rate, check tier-up
   * This is the core "experience accumulation" mechanism
   */
  async recordUsage(skillId, succeeded, context = {}) {
    const note = await this.getNote(skillId);
    if (!note) return null;

    // Add XP (successes worth more)
    const xpGain = succeeded ? 3 : 1; // Even failures give 1 XP (뼈도 곰국)
    note.xp += xpGain;
    note.uses++;
    if (succeeded) note.successes++;
    else note.failures++;
    note.successRate = note.uses > 0 ? note.successes / note.uses : 0;

    // Check tier-up (RPG level progression)
    const oldTier = note.tier;
    note.tier = this._calculateTier(note.xp);
    const tieredUp = oldTier !== note.tier;

    // Save
    await this.board.setHashField(`${ZK_PREFIX}:notes`, note.id, note);
    await this._writeVaultNote(note);

    if (tieredUp) {
      log.info('zettelkasten', `TIER UP: ${note.id} → ${note.tier} (XP: ${note.xp})`);
      await this.board.publish(`${ZK_PREFIX}:tier-up`, {
        author: 'zettelkasten',
        skill: note.id,
        oldTier,
        newTier: note.tier,
        xp: note.xp,
      });
    }

    // Record co-occurrence with context skills
    if (context.coSkills && context.coSkills.length > 0) {
      await this._recordCoOccurrence(note.id, context.coSkills, succeeded);
    }

    if (this.logger) {
      this.logger.logEvent('zettelkasten', {
        type: 'usage_recorded',
        skill: note.id,
        succeeded,
        xp: note.xp,
        tier: note.tier,
        tieredUp,
      });
    }

    return { note, xpGain, tieredUp };
  }

  /**
   * Get a note by ID
   */
  async getNote(skillId) {
    return await this.board.getHashField(`${ZK_PREFIX}:notes`, skillId);
  }

  /**
   * Get all notes (the full Zettelkasten)
   */
  async getAllNotes() {
    const raw = await this.board.getHash(`${ZK_PREFIX}:notes`);
    const notes = {};
    for (const [id, json] of Object.entries(raw)) {
      try { notes[id] = JSON.parse(json); } catch {}
    }
    return notes;
  }

  // ── Linking (Wiki-Links) ──────────────────────────────────

  /**
   * Record that two skills were used together (co-occurrence → link)
   * After enough co-occurrences, they become candidates for compound skills
   */
  async _recordCoOccurrence(skillId, coSkillIds, succeeded) {
    for (const coId of coSkillIds) {
      if (coId === skillId) continue;

      // Update link weight
      const linkKey = `${ZK_PREFIX}:links:${this._linkKey(skillId, coId)}`;
      const existing = await this.board.getConfig(linkKey);
      const link = existing || {
        a: skillId,
        b: coId,
        coOccurrences: 0,
        coSuccesses: 0,
        strength: 0,
        createdAt: Date.now(),
      };

      link.coOccurrences++;
      if (succeeded) link.coSuccesses++;
      link.strength = link.coOccurrences > 0
        ? link.coSuccesses / link.coOccurrences
        : 0;

      await this.board.setConfig(linkKey, link);

      // Add wiki-link to both notes
      await this._addLink(skillId, coId);
      await this._addLink(coId, skillId);

      // Check if link is strong enough for compound skill
      if (link.coOccurrences >= 5 && link.strength >= 0.7) {
        await this._suggestCompound(skillId, coId, link);
      }
    }
  }

  async _addLink(fromId, toId) {
    const note = await this.getNote(fromId);
    if (!note) return;
    if (!note.links.includes(toId)) {
      note.links.push(toId);
      await this.board.setHashField(`${ZK_PREFIX}:notes`, fromId, note);
    }
    // Add backlink
    const target = await this.getNote(toId);
    if (target && !target.backlinks.includes(fromId)) {
      target.backlinks.push(fromId);
      await this.board.setHashField(`${ZK_PREFIX}:notes`, toId, target);
    }
  }

  // ── Compound Skills (Meta-Notes) ──────────────────────────

  /**
   * Suggest a compound skill when two atomics consistently succeed together
   * Like upgrading your weapon in an RPG — two skills fuse into something stronger
   */
  async _suggestCompound(skillIdA, skillIdB, link) {
    const compoundId = `compound_${skillIdA}_${skillIdB}`;

    // Check if already exists
    const existing = await this.getNote(compoundId);
    if (existing) return existing;

    const noteA = await this.getNote(skillIdA);
    const noteB = await this.getNote(skillIdB);
    if (!noteA || !noteB) return null;

    const compound = await this.createNote({
      name: compoundId,
      code: `// Compound: ${noteA.name} + ${noteB.name}\n${noteA.code}\n${noteB.code}`,
      description: `Compound skill: ${noteA.description} + ${noteB.description}`,
      errorType: `compound:${noteA.errorType}+${noteB.errorType}`,
      agentId: 'zettelkasten',
    });

    // Mark as compound
    compound.compoundOf = [skillIdA, skillIdB];
    compound.tags = [...compound.tags.filter(t => t !== 'atomic'), 'compound'];
    compound.status = 'compound';
    // Inherit partial XP from parents (50% each)
    compound.xp = Math.floor((noteA.xp + noteB.xp) * 0.5);
    compound.tier = this._calculateTier(compound.xp);

    await this.board.setHashField(`${ZK_PREFIX}:notes`, compound.id, compound);
    await this._writeVaultNote(compound, 'compound');

    // Publish compound creation event
    await this.board.publish(`${ZK_PREFIX}:compound-created`, {
      author: 'zettelkasten',
      compound: compound.id,
      sources: [skillIdA, skillIdB],
      inheritedXP: compound.xp,
      tier: compound.tier,
      linkStrength: link.strength,
    });

    log.info('zettelkasten', `COMPOUND: ${compound.id} (${noteA.name} + ${noteB.name}, XP: ${compound.xp})`);
    return compound;
  }

  // ── Deprecation (Natural Decay) ───────────────────────────

  /**
   * Deprecate a skill that consistently fails
   * Like a weapon that breaks — move to deprecated vault
   */
  async deprecateNote(skillId, reason = 'low_success_rate') {
    const note = await this.getNote(skillId);
    if (!note) return null;

    note.status = 'deprecated';
    note.deprecatedAt = Date.now();
    note.deprecationReason = reason;

    await this.board.setHashField(`${ZK_PREFIX}:notes`, skillId, note);

    // Move vault file to deprecated/
    const oldPath = path.join(this.vaultDir,
      note.compoundOf ? 'compound' : 'atomic', `${skillId}.md`);
    const newPath = path.join(this.vaultDir, 'deprecated', `${skillId}.md`);
    try {
      await fsp.access(oldPath);
      await fsp.rename(oldPath, newPath);
    } catch {
      // File doesn't exist — skip
    }
    await this._writeVaultNote(note, 'deprecated');

    log.info('zettelkasten', `deprecated: ${skillId} (${reason})`);
    return note;
  }

  // ── Query & Stats ─────────────────────────────────────────

  /**
   * Get skills by tier (find all Masters, all Experts, etc.)
   */
  async getByTier(tierName) {
    const all = await this.getAllNotes();
    return Object.values(all).filter(n => n.tier === tierName && n.status === 'active');
  }

  /**
   * Get strongest links (candidates for new compounds)
   */
  async getStrongestLinks(minStrength = 0.6, limit = 10) {
    // Scan all link keys
    const links = [];
    const allNotes = await this.getAllNotes();
    const noteIds = Object.keys(allNotes);

    for (let i = 0; i < noteIds.length; i++) {
      for (let j = i + 1; j < noteIds.length; j++) {
        const key = `${ZK_PREFIX}:links:${this._linkKey(noteIds[i], noteIds[j])}`;
        const link = await this.board.getConfig(key);
        if (link && link.strength >= minStrength) {
          links.push(link);
        }
      }
    }

    return links
      .sort((a, b) => b.strength - a.strength)
      .slice(0, limit);
  }

  /**
   * Get overall Zettelkasten stats (the "character sheet")
   */
  async getStats() {
    const all = await this.getAllNotes();
    return SkillZettelkasten.computeStats(all);
  }

  static computeStats(all) {
    const notes = Object.values(all);
    const active = notes.filter(n => n.status === 'active');
    const compounds = notes.filter(n => n.status === 'compound');

    const totalXP = notes.reduce((sum, n) => sum + n.xp, 0);
    const tierCounts = {};
    for (const tier of TIERS) tierCounts[tier.name] = 0;
    for (const note of active) tierCounts[note.tier] = (tierCounts[note.tier] || 0) + 1;

    return {
      totalNotes: notes.length,
      activeSkills: active.length,
      compoundSkills: compounds.length,
      deprecatedSkills: notes.filter(n => n.status === 'deprecated').length,
      totalXP,
      averageXP: active.length > 0 ? Math.floor(totalXP / active.length) : 0,
      tierDistribution: tierCounts,
      highestTier: active.reduce((best, n) =>
        (n.xp > (best?.xp || 0)) ? n : best, null),
      totalLinks: notes.reduce((sum, n) => sum + n.links.length, 0) / 2,
    };
  }

  // ── Vault Persistence (Obsidian .md) ──────────────────────

  /**
   * Write a Zettelkasten note to the Obsidian vault as a .md file
   * with proper frontmatter for Dataview queries and graph visualization
   */
  async _writeVaultNote(note, subdir = null) {
    const dir = subdir
      ? path.join(this.vaultDir, subdir)
      : path.join(this.vaultDir, note.compoundOf ? 'compound' : 'atomic');

    await fsp.mkdir(dir, { recursive: true });

    const tierInfo = TIERS.find(t => t.name === note.tier) || TIERS[0];
    const links = note.links.map(l => `[[${l}]]`).join(', ');
    const backlinks = note.backlinks.map(l => `[[${l}]]`).join(', ');

    const md = `---
id: "${note.id}"
name: "${note.name}"
tier: "${note.tier}"
xp: ${note.xp}
uses: ${note.uses}
successes: ${note.successes}
failures: ${note.failures}
successRate: ${note.successRate.toFixed(3)}
status: "${note.status}"
error_type: "${note.errorType}"
created_by: "${note.createdBy}"
created_at: ${note.createdAt}
tags: [${note.tags.map(t => `"${t}"`).join(', ')}]
compound_of: ${note.compoundOf ? JSON.stringify(note.compoundOf) : 'null'}
digest_count: ${note.digestCount}
---

# ${tierInfo.emoji} ${note.name}

> **Tier**: ${note.tier} | **XP**: ${note.xp} | **Success Rate**: ${(note.successRate * 100).toFixed(1)}%

## Description
${note.description}

## Links
${links || '_No links yet_'}

## Backlinks
${backlinks || '_No backlinks yet_'}

${note.compoundOf ? `## Compound Sources\n${note.compoundOf.map(s => `- [[${s}]]`).join('\n')}` : ''}

## Code
\`\`\`js
${note.code}
\`\`\`

## Rumination Notes
${note.ruminationNotes.length > 0
  ? note.ruminationNotes.map(r => `- [${new Date(r.ts).toISOString().slice(0, 10)}] ${r.insight}`).join('\n')
  : '_Not yet digested_'}

---
*Auto-generated by Octiv Skill Zettelkasten*
`;

    await fsp.writeFile(path.join(dir, `${note.id}.md`), md, 'utf-8');
  }

  // ── Helpers ───────────────────────────────────────────────

  _slugify(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  _linkKey(a, b) {
    return [a, b].sort().join('::');
  }

  _calculateTier(xp) {
    let tier = TIERS[0].name;
    for (const t of TIERS) {
      if (xp >= t.minXP) tier = t.name;
    }
    return tier;
  }

  async shutdown() {
    await this.board.disconnect();
  }
}

module.exports = { SkillZettelkasten, TIERS };
