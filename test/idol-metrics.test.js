/**
 * Tests for IdolMetrics — survival→idol stat mapping
 * TDD: tests written before implementation
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { IdolMetrics } = require('../agent/idol-metrics');

describe('IdolMetrics', () => {
  let metrics;

  beforeEach(() => {
    metrics = new IdolMetrics('agent-01');
  });

  describe('convertSurvivalEvent()', () => {
    it('maps shelter_build to choreography_sync with 50 XP', () => {
      const result = metrics.convertSurvivalEvent('shelter_build');
      assert.equal(result.stat, 'choreography_sync');
      assert.equal(result.xp, 50);
      assert.equal(result.category, 'collaboration');
    });

    it('maps wood_collection to stage_planning with 10 XP', () => {
      const result = metrics.convertSurvivalEvent('wood_collection');
      assert.equal(result.stat, 'stage_planning');
      assert.equal(result.xp, 10);
    });

    it('maps ore_mining to creative_inspiration with 15 XP', () => {
      const result = metrics.convertSurvivalEvent('ore_mining');
      assert.equal(result.stat, 'creative_inspiration');
      assert.equal(result.xp, 15);
    });

    it('maps crop_farming to patience_cultivation with 12 XP', () => {
      const result = metrics.convertSurvivalEvent('crop_farming');
      assert.equal(result.stat, 'patience_cultivation');
      assert.equal(result.xp, 12);
    });

    it('returns null for unknown activity', () => {
      assert.equal(metrics.convertSurvivalEvent('unknown_activity'), null);
    });

    it('handles null/undefined input gracefully', () => {
      assert.equal(metrics.convertSurvivalEvent(null), null);
      assert.equal(metrics.convertSurvivalEvent(undefined), null);
    });
  });

  describe('addXP()', () => {
    it('accumulates XP for an activity', () => {
      metrics.addXP('shelter_build');
      assert.equal(metrics.totalXP, 50);
      metrics.addXP('wood_collection');
      assert.equal(metrics.totalXP, 60);
    });

    it('ignores unknown activities', () => {
      metrics.addXP('nonexistent');
      assert.equal(metrics.totalXP, 0);
    });
  });

  describe('calculateLevel()', () => {
    it('starts at level 1 (Trainee) with 0 XP', () => {
      const level = metrics.calculateLevel();
      assert.equal(level.level, 1);
      assert.equal(level.name, 'Trainee');
    });

    it('reaches level 2 (Rookie) at 100 XP', () => {
      metrics.totalXP = 100;
      assert.equal(metrics.calculateLevel().level, 2);
      assert.equal(metrics.calculateLevel().name, 'Rookie');
    });

    it('reaches level 3 (Regular) at 300 XP', () => {
      metrics.totalXP = 300;
      assert.equal(metrics.calculateLevel().level, 3);
    });

    it('reaches level 6 (Center) at 2000 XP', () => {
      metrics.totalXP = 2000;
      assert.equal(metrics.calculateLevel().level, 6);
      assert.equal(metrics.calculateLevel().name, 'Center');
    });
  });

  describe('getStats()', () => {
    it('returns full stats snapshot', () => {
      metrics.addXP('shelter_build');
      metrics.addXP('reflexion');
      const stats = metrics.getStats();
      assert.equal(stats.agentId, 'agent-01');
      assert.equal(stats.totalXP, 70);
      assert.equal(stats.level.level, 1);
      assert.ok(stats.activities.shelter_build > 0);
      assert.ok(stats.activities.reflexion > 0);
    });
  });

  describe('getTeamOverview() (static)', () => {
    it('aggregates stats across agents', () => {
      const m1 = new IdolMetrics('a1');
      m1.addXP('shelter_build');
      const m2 = new IdolMetrics('a2');
      m2.addXP('wood_collection');
      m2.addXP('wood_collection');

      const overview = IdolMetrics.getTeamOverview([m1, m2]);
      assert.equal(overview.totalTeamXP, 70);
      assert.equal(overview.agents.length, 2);
      assert.ok(overview.avgLevel >= 1);
    });

    it('handles empty array', () => {
      const overview = IdolMetrics.getTeamOverview([]);
      assert.equal(overview.totalTeamXP, 0);
      assert.equal(overview.agents.length, 0);
      assert.equal(overview.avgLevel, 0);
    });
  });
});
