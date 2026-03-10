/**
 * Octiv Skill Auditor — pre-compilation security layer
 * SHA-256 integrity hashing, banned pattern filtering, audit trail.
 * Sits between LLM output and node:vm compilation.
 */
const crypto = require('node:crypto');
const { getLogger } = require('./logger');
const log = getLogger();

const BANNED_PATTERNS = [
  /\brequire\s*\(/,
  /\bimport\s+/,
  /\bprocess\b/,
  /\bglobal\b/,
  /\beval\s*\(/,
  /\bFunction\s*\(/,
  /\b__proto__\b/,
  /\bconstructor\s*\.\s*constructor\b/,
  /\bchild_process\b/,
  /\bfs\b\.\b(read|write|unlink)/,
];

class SkillAuditor {
  constructor() {
    this._trail = [];
  }

  /** SHA-256 hash of skill code */
  hashSkill(code) {
    return crypto.createHash('sha256').update(code).digest('hex');
  }

  /** Verify code integrity against stored hash */
  verifyIntegrity(code, expectedHash) {
    return this.hashSkill(code) === expectedHash;
  }

  /** Check code against banned patterns before vm.Script compilation */
  filterBannedPatterns(code) {
    for (const pattern of BANNED_PATTERNS) {
      if (pattern.test(code)) {
        log.warn('skill-auditor', `banned pattern detected: ${pattern.source}`);
        return { safe: false, pattern: pattern.source };
      }
    }
    return { safe: true };
  }

  /** Log skill execution to audit trail */
  auditExecution(skillName, hash) {
    this._trail.push({
      skillName,
      hash,
      timestamp: Date.now(),
    });
  }

  /** Get recent audit entries */
  getAuditTrail(limit = 50) {
    if (limit >= this._trail.length) return [...this._trail];
    return this._trail.slice(-limit);
  }
}

module.exports = { SkillAuditor, BANNED_PATTERNS };
