/**
 * Octiv GoT Reasoner — Graph of Thought for Skill Combination Discovery
 *
 * Unlike Chain-of-Thought (linear) or Tree-of-Thought (branching),
 * GoT explores a non-linear GRAPH of possibilities:
 *
 *   Node = a skill or skill combination
 *   Edge = co-occurrence, similarity, or complementarity
 *   Path = a sequence of skills that solve a complex problem
 *
 * The GoT Reasoner walks the Zettelkasten graph to discover:
 *   1. Hidden synergies between skills that haven't been tried together
 *   2. Optimal "skill builds" (like RPG character builds)
 *   3. Missing skills (gaps in the graph)
 *   4. Evolution paths (Novice → Master trajectories)
 *
 * Integration:
 *   - Reads from SkillZettelkasten (the graph)
 *   - Uses RuminationEngine insights as edge weights
 *   - Outputs to Obsidian as reasoning traces (.md files)
 *   - Can request LLM via ReflexionEngine for deep analysis
 */
const fsp = require('fs').promises;
const path = require('path');
const { Blackboard } = require('./blackboard');
const { getLogger } = require('./logger');
const log = getLogger();

const VAULT_DIR = path.join(__dirname, '..', 'vault', '04-Skills', 'reasoning');

class GoTReasoner {
  constructor(zettelkasten, options = {}) {
    this.zk = zettelkasten;
    this.board = new Blackboard();
    this.llmClient = options.llmClient || null; // ReflexionEngine
    this.logger = options.logger || null;
    this.vaultDir = options.vaultDir || VAULT_DIR;
  }

  async init() {
    await this.board.connect();
    await fsp.mkdir(this.vaultDir, { recursive: true });
    log.info('got', 'initialized');
  }

  // ── Graph Construction ────────────────────────────────────

  /**
   * Build the full thought graph from Zettelkasten
   * Returns { nodes, edges, adjacency }
   */
  async buildGraph() {
    const allNotes = await this.zk.getAllNotes();
    const notes = Object.values(allNotes).filter(n => n.status !== 'deprecated');

    const nodes = {};
    const edges = [];
    const adjacency = {};

    // Nodes
    for (const note of notes) {
      nodes[note.id] = {
        id: note.id,
        name: note.name,
        tier: note.tier,
        xp: note.xp,
        successRate: note.successRate,
        errorType: note.errorType,
        tags: note.tags,
        isCompound: note.status === 'compound',
      };
      adjacency[note.id] = [];
    }

    // Edges from wiki-links
    for (const note of notes) {
      for (const linkId of note.links) {
        if (nodes[linkId]) {
          // Get link strength
          const linkKey = `zettelkasten:links:${this.zk._linkKey(note.id, linkId)}`;
          const linkData = await this.board.getConfig(linkKey);
          const weight = linkData ? linkData.strength : 0.1;

          edges.push({
            from: note.id,
            to: linkId,
            weight,
            coOccurrences: linkData ? linkData.coOccurrences : 0,
          });
          adjacency[note.id].push({ target: linkId, weight });
        }
      }
    }

    return { nodes, edges, adjacency };
  }

  // ── Reasoning Strategies ──────────────────────────────────

  /**
   * Strategy 1: Discover Hidden Synergies
   * Find skill pairs that share error types or tags but haven't been linked yet
   */
  async discoverSynergies() {
    const graph = await this.buildGraph();
    const nodeList = Object.values(graph.nodes);
    const synergies = [];

    for (let i = 0; i < nodeList.length; i++) {
      for (let j = i + 1; j < nodeList.length; j++) {
        const a = nodeList[i];
        const b = nodeList[j];

        // Skip if already linked
        const isLinked = graph.adjacency[a.id]?.some(e => e.target === b.id);
        if (isLinked) continue;

        // Calculate potential synergy score
        let score = 0;

        // Same error type family → high synergy potential
        if (a.errorType && b.errorType) {
          const aType = a.errorType.split(':')[0];
          const bType = b.errorType.split(':')[0];
          if (aType === bType) score += 0.4;
        }

        // Shared tags
        const sharedTags = a.tags.filter(t => b.tags.includes(t));
        score += sharedTags.length * 0.15;

        // Complementary tiers (expert + novice might teach)
        if ((a.tier === 'Expert' || a.tier === 'Master') && a.tier !== b.tier) {
          score += 0.1;
        }

        // Both have good success rates → likely to work together
        if (a.successRate >= 0.7 && b.successRate >= 0.7) {
          score += 0.2;
        }

        if (score >= 0.4) {
          synergies.push({
            skillA: a.id,
            skillB: b.id,
            score,
            reason: this._explainSynergy(a, b, sharedTags),
          });
        }
      }
    }

    // Sort by score
    synergies.sort((a, b) => b.score - a.score);

    // Save reasoning trace
    await this._saveReasoningTrace('synergy-discovery', {
      totalNodes: nodeList.length,
      synergiesFound: synergies.length,
      top5: synergies.slice(0, 5),
    });

    log.info('got', `synergy discovery: ${synergies.length} potential synergies`);
    return synergies.slice(0, 20);
  }

  /**
   * Strategy 2: Find Optimal Skill Builds
   * Like RPG character builds — which combination of skills is strongest?
   */
  async findOptimalBuilds(maxBuildSize = 4) {
    const graph = await this.buildGraph();
    const nodeList = Object.values(graph.nodes)
      .filter(n => !n.isCompound && n.successRate >= 0.5)
      .sort((a, b) => b.xp - a.xp);

    const builds = [];

    // Start from each high-XP skill and build outward
    for (const root of nodeList.slice(0, 10)) {
      const build = [root];
      const used = new Set([root.id]);

      // Greedy expansion: add best connected neighbor
      while (build.length < maxBuildSize) {
        let bestNeighbor = null;
        let bestScore = 0;

        for (const current of build) {
          for (const edge of (graph.adjacency[current.id] || [])) {
            if (used.has(edge.target)) continue;
            const neighbor = graph.nodes[edge.target];
            if (!neighbor) continue;

            // Score: link weight + neighbor success + XP bonus
            const score = edge.weight * 0.4
              + neighbor.successRate * 0.3
              + Math.min(neighbor.xp / 100, 0.3);

            if (score > bestScore) {
              bestScore = score;
              bestNeighbor = neighbor;
            }
          }
        }

        if (!bestNeighbor) break;
        build.push(bestNeighbor);
        used.add(bestNeighbor.id);
      }

      if (build.length >= 2) {
        const totalXP = build.reduce((s, n) => s + n.xp, 0);
        const avgSuccess = build.reduce((s, n) => s + n.successRate, 0) / build.length;

        builds.push({
          skills: build.map(n => n.id),
          totalXP,
          averageSuccess: avgSuccess,
          buildStrength: totalXP * avgSuccess,
          tiers: build.map(n => n.tier),
        });
      }
    }

    builds.sort((a, b) => b.buildStrength - a.buildStrength);

    await this._saveReasoningTrace('optimal-builds', {
      buildsEvaluated: builds.length,
      top3: builds.slice(0, 3),
    });

    log.info('got', `optimal builds: ${builds.length} builds evaluated`);
    return builds.slice(0, 5);
  }

  /**
   * Strategy 3: Identify Skill Gaps
   * Find error types that have NO associated skills or only weak ones
   */
  async identifyGaps() {
    const graph = await this.buildGraph();
    const nodeList = Object.values(graph.nodes);

    // Collect all error types and their best skill
    const errorCoverage = {};
    for (const node of nodeList) {
      const errType = node.errorType;
      if (!errType || errType === 'unknown') continue;

      if (!errorCoverage[errType]) {
        errorCoverage[errType] = { bestSkill: null, bestXP: 0, skillCount: 0 };
      }
      errorCoverage[errType].skillCount++;
      if (node.xp > errorCoverage[errType].bestXP) {
        errorCoverage[errType].bestSkill = node.id;
        errorCoverage[errType].bestXP = node.xp;
      }
    }

    const gaps = [];

    // Weak coverage (only novice-level skills)
    for (const [errType, coverage] of Object.entries(errorCoverage)) {
      if (coverage.bestXP < 10 || coverage.skillCount < 2) {
        gaps.push({
          errorType: errType,
          severity: coverage.skillCount === 0 ? 'critical' : 'moderate',
          currentBest: coverage.bestSkill,
          currentBestXP: coverage.bestXP,
          recommendation: coverage.skillCount === 0
            ? `No skill exists for ${errType}. Create one urgently.`
            : `Only ${coverage.skillCount} weak skill(s) for ${errType}. Needs reinforcement.`,
        });
      }
    }

    gaps.sort((a, _b) => (a.severity === 'critical' ? -1 : 1));

    await this._saveReasoningTrace('gap-analysis', {
      errorTypesAnalyzed: Object.keys(errorCoverage).length,
      gapsFound: gaps.length,
      criticalGaps: gaps.filter(g => g.severity === 'critical').length,
    });

    log.info('got', `gap analysis: ${gaps.length} gaps (${gaps.filter(g => g.severity === 'critical').length} critical)`);
    return gaps;
  }

  /**
   * Strategy 4: Predict Evolution Paths
   * For each skill, predict the path to Master tier
   */
  async predictEvolutionPaths() {
    const graph = await this.buildGraph();
    const nodeList = Object.values(graph.nodes)
      .filter(n => !n.isCompound && n.tier !== 'Master' && n.tier !== 'Grandmaster');

    const paths = [];

    for (const node of nodeList) {
      const currentXP = node.xp;
      const xpPerUse = node.successRate >= 0.5 ? 3 : 1;
      const usesToMaster = Math.ceil((150 - currentXP) / xpPerUse);

      // Find potential compound partners
      const partners = (graph.adjacency[node.id] || [])
        .filter(e => e.weight >= 0.5)
        .map(e => ({
          skillId: e.target,
          linkStrength: e.weight,
          partnerXP: graph.nodes[e.target]?.xp || 0,
        }))
        .sort((a, b) => b.linkStrength - a.linkStrength);

      paths.push({
        skill: node.id,
        currentTier: node.tier,
        currentXP,
        usesToMaster,
        estimatedGamestoMaster: Math.ceil(usesToMaster / 3), // ~3 uses per game session
        compoundPotential: partners.slice(0, 3),
        bottleneck: node.successRate < 0.5 ? 'low_success_rate' : 'needs_more_usage',
      });
    }

    paths.sort((a, b) => a.usesToMaster - b.usesToMaster);

    await this._saveReasoningTrace('evolution-paths', {
      skillsAnalyzed: paths.length,
      closestToMaster: paths[0],
      averageUsesToMaster: Math.floor(
        paths.reduce((s, p) => s + p.usesToMaster, 0) / Math.max(paths.length, 1)
      ),
    });

    return paths;
  }

  /**
   * Full GoT Reasoning Cycle
   * Run all strategies and produce a comprehensive analysis
   */
  async fullReasoningCycle() {
    log.info('got', 'Full Reasoning Cycle started');

    const synergies = await this.discoverSynergies();
    const builds = await this.findOptimalBuilds();
    const gaps = await this.identifyGaps();
    const evolutions = await this.predictEvolutionPaths();

    const result = {
      timestamp: Date.now(),
      synergies: synergies.slice(0, 5),
      optimalBuilds: builds.slice(0, 3),
      gaps,
      evolutions: evolutions.slice(0, 5),
      summary: {
        totalSynergies: synergies.length,
        totalBuilds: builds.length,
        totalGaps: gaps.length,
        criticalGaps: gaps.filter(g => g.severity === 'critical').length,
        closestToMaster: evolutions[0]?.skill || 'none',
      },
    };

    // Save full reasoning trace
    await this._saveReasoningTrace('full-cycle', result);

    // Publish to Blackboard
    await this.board.publish('got:reasoning-complete', {
      author: 'got-reasoner',
      ...result.summary,
    });

    log.info('got', 'Reasoning Complete');
    return result;
  }

  // ── Vault Persistence ─────────────────────────────────────

  async _saveReasoningTrace(strategy, data) {
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    const filename = `${strategy}_${timestamp}.md`;
    const filepath = path.join(this.vaultDir, filename);

    const md = `---
strategy: "${strategy}"
timestamp: ${Date.now()}
date: "${new Date().toISOString().slice(0, 10)}"
tags: ["got", "reasoning", "${strategy}"]
---

# GoT Reasoning: ${strategy}

## Results
\`\`\`json
${JSON.stringify(data, null, 2)}
\`\`\`

---
*Auto-generated by Octiv GoT Reasoner*
`;

    await fsp.writeFile(filepath, md, 'utf-8');
  }

  // ── Helpers ───────────────────────────────────────────────

  _explainSynergy(a, b, sharedTags) {
    const reasons = [];
    if (sharedTags.length > 0) reasons.push(`shared tags: ${sharedTags.join(', ')}`);
    if (a.errorType === b.errorType) reasons.push(`same error type: ${a.errorType}`);
    if (a.successRate >= 0.7 && b.successRate >= 0.7) reasons.push('both highly successful');
    return reasons.join('; ') || 'complementary skills';
  }

  async shutdown() {
    await this.board.disconnect();
  }
}

module.exports = { GoTReasoner };
