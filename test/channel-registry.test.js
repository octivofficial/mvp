/**
 * Tests for ChannelRegistry — Blackboard channel domain categorization
 * TDD: tests written before implementation
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { ChannelRegistry } = require('../agent/channel-registry');

describe('ChannelRegistry', () => {
  const registry = new ChannelRegistry();

  describe('categorize()', () => {
    const expectedMappings = [
      // survival
      ['agent:builder-01:status', 'survival'],
      ['agent:miner-01:mining:complete', 'survival'],
      ['agent:farmer-01:farming:complete', 'survival'],
      ['builder:shelter', 'survival'],
      ['agent:explorer-01:status', 'survival'],

      // creative
      ['agent:builder-01:idol-stats', 'creative'],
      ['leader:idol-overview', 'creative'],

      // learning
      ['skills:emergency', 'learning'],
      ['skills:library', 'learning'],
      ['zettelkasten:update', 'learning'],
      ['rumination:digest', 'learning'],

      // system
      ['safety:threat', 'system'],
      ['team:status', 'system'],
      ['config:update', 'system'],
      ['leader:mode', 'system'],
      ['leader:system_prompt', 'system'],

      // command
      ['command:builder-01:mission', 'command'],
      ['command:builder-01:prompt_update', 'command'],
      ['rc:cmd:status', 'command'],

      // social
      ['agent:builder-01:chat', 'social'],
      ['agent:builder-01:confess', 'social'],
      ['leader:reflexion', 'social'],
      ['leader:reflexion:result', 'social'],
      ['leader:votes', 'social'],
    ];

    for (const [channel, domain] of expectedMappings) {
      it(`categorizes "${channel}" as "${domain}"`, () => {
        assert.equal(registry.categorize(channel), domain);
      });
    }

    it('returns "unknown" for unrecognized channels', () => {
      assert.equal(registry.categorize('completely:random:channel'), 'unknown');
    });
  });

  describe('getChannelsForRole()', () => {
    it('returns survival + command + social for builder', () => {
      const domains = registry.getDomainsForRole('builder');
      assert.ok(domains.includes('survival'));
      assert.ok(domains.includes('command'));
      assert.ok(domains.includes('social'));
    });

    it('returns all domains for leader', () => {
      const domains = registry.getDomainsForRole('leader');
      assert.ok(domains.length >= 5);
      assert.ok(domains.includes('system'));
      assert.ok(domains.includes('creative'));
    });

    it('returns system + learning + social for safety', () => {
      const domains = registry.getDomainsForRole('safety');
      assert.ok(domains.includes('system'));
      assert.ok(domains.includes('learning'));
      assert.ok(domains.includes('social'));
    });
  });

  describe('isRelevantFor()', () => {
    it('safety:threat is relevant for safety', () => {
      assert.equal(registry.isRelevantFor('safety:threat', 'safety'), true);
    });

    it('agent:builder-01:idol-stats is NOT relevant for safety', () => {
      assert.equal(registry.isRelevantFor('agent:builder-01:idol-stats', 'safety'), false);
    });

    it('command:builder-01:mission is relevant for builder', () => {
      assert.equal(registry.isRelevantFor('command:builder-01:mission', 'builder'), true);
    });
  });

  describe('getDomainsForPhase()', () => {
    it('training phase includes survival + command + system', () => {
      const domains = registry.getDomainsForPhase('training');
      assert.ok(domains.includes('survival'));
      assert.ok(domains.includes('command'));
      assert.ok(domains.includes('system'));
    });

    it('creative phase includes creative + social + learning', () => {
      const domains = registry.getDomainsForPhase('creative');
      assert.ok(domains.includes('creative'));
      assert.ok(domains.includes('social'));
      assert.ok(domains.includes('learning'));
    });
  });
});
