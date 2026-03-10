/**
 * Shared vm sandbox validation for skill code.
 * Used by both SkillPipeline and SafetyAgent.
 */
const vm = require('node:vm');
const T = require('../config/timeouts');
const { SkillAuditor } = require('./skill-auditor');

const _auditor = new SkillAuditor();

async function validateCode(code, attempts = 3, timeoutMs = T.VM_TIMEOUT_MS) {
  // Pre-compilation banned pattern check
  const patternCheck = _auditor.filterBannedPatterns(code);
  if (!patternCheck.safe) {
    return { valid: false, error: `banned pattern: ${patternCheck.pattern}`, attempt: 0 };
  }

  for (let i = 1; i <= attempts; i++) {
    try {
      const context = vm.createContext(Object.create(null));
      const script = new vm.Script(`(function() { ${code} })()`, {
        filename: 'sandbox-validation.js',
        timeout: timeoutMs,
      });
      script.runInContext(context, { timeout: timeoutMs });
    } catch (err) {
      return { valid: false, error: err.message, attempt: i };
    }
  }
  return { valid: true };
}

module.exports = { validateCode, VM_TIMEOUT_MS: T.VM_TIMEOUT_MS, VM_VALIDATION_ATTEMPTS: 3 };
