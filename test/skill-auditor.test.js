/**
 * Tests for SkillAuditor — pre-compilation security layer
 * TDD: tests written before implementation
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { SkillAuditor } = require('../agent/skill-auditor');

describe('SkillAuditor', () => {
  let auditor;

  beforeEach(() => {
    auditor = new SkillAuditor();
  });

  describe('hashSkill()', () => {
    it('returns consistent SHA-256 hash for same code', () => {
      const code = 'const x = 1;';
      const h1 = auditor.hashSkill(code);
      const h2 = auditor.hashSkill(code);
      assert.equal(h1, h2);
      assert.equal(h1.length, 64); // SHA-256 hex = 64 chars
    });

    it('returns different hash for different code', () => {
      const h1 = auditor.hashSkill('const x = 1;');
      const h2 = auditor.hashSkill('const y = 2;');
      assert.notEqual(h1, h2);
    });
  });

  describe('verifyIntegrity()', () => {
    it('returns true when hash matches', () => {
      const code = 'const x = 1;';
      const hash = auditor.hashSkill(code);
      assert.equal(auditor.verifyIntegrity(code, hash), true);
    });

    it('returns false when code was tampered', () => {
      const hash = auditor.hashSkill('const x = 1;');
      assert.equal(auditor.verifyIntegrity('const x = 999;', hash), false);
    });
  });

  describe('filterBannedPatterns()', () => {
    const bannedCodes = [
      ['require("fs")', 'require()'],
      ['import foo from "bar"', 'import'],
      ['process.exit(1)', 'process'],
      ['global.something', 'global'],
      ['eval("code")', 'eval()'],
      ['new Function("return 1")', 'Function()'],
      ['obj.__proto__.x = 1', '__proto__'],
      ['x.constructor.constructor("code")()', 'constructor.constructor'],
      ['require("child_process")', 'child_process'],
      ['fs.readFileSync("x")', 'fs.read/write'],
      ['fs.writeFileSync("x", "y")', 'fs.read/write'],
      ['fs.unlinkSync("x")', 'fs.unlink'],
    ];

    for (const [code, label] of bannedCodes) {
      it(`rejects banned pattern: ${label}`, () => {
        const result = auditor.filterBannedPatterns(code);
        assert.equal(result.safe, false, `Expected "${code}" to be rejected`);
        assert.ok(result.pattern, 'should include matching pattern');
      });
    }

    const safeCodes = [
      'const x = 1;',
      'const add = (a, b) => a + b;',
      'function hello() { return "world"; }',
      'const arr = [1, 2, 3].map(x => x * 2);',
      'if (true) { const y = 42; }',
    ];

    for (const code of safeCodes) {
      it(`allows safe code: ${code.slice(0, 30)}`, () => {
        const result = auditor.filterBannedPatterns(code);
        assert.equal(result.safe, true, `Expected "${code}" to pass`);
      });
    }
  });

  describe('auditExecution()', () => {
    it('logs entry with timestamp and skill name', () => {
      auditor.auditExecution('test_skill', 'abc123');
      const trail = auditor.getAuditTrail();
      assert.equal(trail.length, 1);
      assert.equal(trail[0].skillName, 'test_skill');
      assert.equal(trail[0].hash, 'abc123');
      assert.ok(trail[0].timestamp > 0);
    });

    it('accumulates multiple entries', () => {
      auditor.auditExecution('skill_a', 'h1');
      auditor.auditExecution('skill_b', 'h2');
      auditor.auditExecution('skill_c', 'h3');
      assert.equal(auditor.getAuditTrail().length, 3);
    });
  });

  describe('getAuditTrail()', () => {
    it('returns recent entries respecting limit', () => {
      for (let i = 0; i < 20; i++) {
        auditor.auditExecution(`skill_${i}`, `h${i}`);
      }
      const trail = auditor.getAuditTrail(5);
      assert.equal(trail.length, 5);
      assert.equal(trail[0].skillName, 'skill_15');
    });

    it('returns all entries when limit exceeds count', () => {
      auditor.auditExecution('only_one', 'h1');
      const trail = auditor.getAuditTrail(100);
      assert.equal(trail.length, 1);
    });
  });
});
