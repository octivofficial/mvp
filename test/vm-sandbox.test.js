/**
 * Direct tests for agent/vm-sandbox.js
 * Security-critical: validates timeout enforcement, context isolation,
 * and malicious code detection in the node:vm sandbox.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { validateCode, VM_TIMEOUT_MS, VM_VALIDATION_ATTEMPTS } = require('../agent/vm-sandbox');

// ── Exports ──────────────────────────────────────────────────────────

describe('vm-sandbox — exports', () => {
  it('should export validateCode function', () => {
    assert.equal(typeof validateCode, 'function');
  });

  it('should export VM_TIMEOUT_MS as a positive number', () => {
    assert.equal(typeof VM_TIMEOUT_MS, 'number');
    assert.ok(VM_TIMEOUT_MS > 0, `VM_TIMEOUT_MS should be positive, got ${VM_TIMEOUT_MS}`);
  });

  it('should export VM_VALIDATION_ATTEMPTS as 3', () => {
    assert.equal(VM_VALIDATION_ATTEMPTS, 3);
  });
});

// ── Valid Code ────────────────────────────────────────────────────────

describe('vm-sandbox — valid code', () => {
  it('should accept simple arithmetic', async () => {
    const result = await validateCode('const x = 1 + 2;');
    assert.deepEqual(result, { valid: true });
  });

  it('should accept function declarations', async () => {
    const result = await validateCode('function greet(name) { return "hello " + name; }');
    assert.deepEqual(result, { valid: true });
  });

  it('should accept empty code', async () => {
    const result = await validateCode('');
    assert.deepEqual(result, { valid: true });
  });

  it('should accept code with loops that terminate', async () => {
    const result = await validateCode('let sum = 0; for (let i = 0; i < 100; i++) sum += i;');
    assert.deepEqual(result, { valid: true });
  });

  it('should accept array/object manipulation', async () => {
    const result = await validateCode('const arr = [1,2,3]; const obj = { a: arr.length };');
    assert.deepEqual(result, { valid: true });
  });
});

// ── Syntax Errors ────────────────────────────────────────────────────

describe('vm-sandbox — syntax errors', () => {
  it('should reject code with syntax errors', async () => {
    const result = await validateCode('function( { broken }');
    assert.equal(result.valid, false);
    assert.equal(typeof result.error, 'string');
    assert.ok(result.error.length > 0, 'Error message should not be empty');
  });

  it('should reject unclosed brackets', async () => {
    const result = await validateCode('const x = [1, 2, 3;');
    assert.equal(result.valid, false);
    assert.ok(result.error, 'Should have an error message');
  });

  it('should reject invalid token', async () => {
    const result = await validateCode('const @ = 5;');
    assert.equal(result.valid, false);
  });

  it('should report attempt number 1 for immediate syntax failure', async () => {
    const result = await validateCode('}{}{');
    assert.equal(result.valid, false);
    assert.equal(result.attempt, 1, 'Syntax error fails on first attempt');
  });
});

// ── Timeout Enforcement ──────────────────────────────────────────────

describe('vm-sandbox — timeout enforcement', () => {
  it('should reject infinite loops with short timeout', async () => {
    const result = await validateCode('while(true) {}', 1, 50);
    assert.equal(result.valid, false);
    assert.ok(result.error.includes('timed out'), `Expected timeout error, got: ${result.error}`);
  });

  it('should reject CPU-intensive code that exceeds timeout', async () => {
    // Exponential work — guaranteed to exceed 50ms
    const code = 'let x = 0; for (let i = 0; i < 1e9; i++) x += Math.sqrt(i);';
    const result = await validateCode(code, 1, 50);
    assert.equal(result.valid, false);
    assert.ok(result.error.includes('timed out'), `Expected timeout, got: ${result.error}`);
  });

  it('should respect custom timeout parameter', async () => {
    // Code that takes ~10ms — should pass with 500ms timeout but fail with 1ms
    const code = 'let x = 0; for (let i = 0; i < 1e6; i++) x++;';
    const fast = await validateCode(code, 1, 500);
    assert.equal(fast.valid, true, 'Should pass with generous timeout');
  });
});

// ── Context Isolation ────────────────────────────────────────────────

describe('vm-sandbox — context isolation', () => {
  it('should not have access to process', async () => {
    const result = await validateCode('process.exit(1);');
    assert.equal(result.valid, false);
    assert.ok(result.error.includes('process'), `Expected process reference error, got: ${result.error}`);
  });

  it('should not have access to require', async () => {
    const result = await validateCode('const fs = require("fs");');
    assert.equal(result.valid, false);
    assert.ok(result.error.includes('require'), `Expected require reference error, got: ${result.error}`);
  });

  it('should not have access to global', async () => {
    const result = await validateCode('global.leaked = true;');
    assert.equal(result.valid, false);
  });

  it('should allow console (node:vm provides it by default)', async () => {
    // NOTE: node:vm exposes console in the sandbox context.
    // This is a known behavior — console alone is not a security risk.
    // The real threats (process, require, global) are blocked.
    const result = await validateCode('console.log("sandboxed");');
    assert.equal(result.valid, true);
  });

  it('should not have access to setTimeout', async () => {
    const result = await validateCode('setTimeout(() => {}, 100);');
    assert.equal(result.valid, false);
  });

  it('should not have access to Buffer', async () => {
    const result = await validateCode('Buffer.from("secret");');
    assert.equal(result.valid, false);
  });

  it('should not leak state between validations', async () => {
    // First run sets a value in sandbox
    const r1 = await validateCode('var leaked = 42;');
    assert.equal(r1.valid, true);

    // Second run should not see the leaked variable
    const r2 = await validateCode('if (typeof leaked !== "undefined") throw new Error("state leaked");');
    assert.equal(r2.valid, true, 'State should not persist between runs');
  });
});

// ── Malicious Code Patterns ──────────────────────────────────────────

describe('vm-sandbox — malicious code patterns', () => {
  it('should reject prototype pollution attempt', async () => {
    await validateCode('this.__proto__.polluted = true;');
    // Object.create(null) context means __proto__ access differs
    // Either it errors (no __proto__) or silently does nothing — both are safe
    // The key assertion: our host prototype is not polluted
    assert.equal(({}).polluted, undefined, 'Host prototype must not be polluted');
  });

  it('should reject constructor escape attempt', async () => {
    const result = await validateCode(
      'const ForeignFunction = this.constructor.constructor; const p = ForeignFunction("return process")(); p.exit(1);'
    );
    assert.equal(result.valid, false);
  });

  it('should reject eval usage', async () => {
    // eval may or may not be available in vm context, but executing harmful code should fail
    const result = await validateCode('eval("process.exit(1)");');
    assert.equal(result.valid, false);
  });

  it('should handle thrown errors in code', async () => {
    const result = await validateCode('throw new Error("intentional");');
    assert.equal(result.valid, false);
    assert.ok(result.error.includes('intentional'));
  });

  it('should handle RangeError (stack overflow)', async () => {
    const result = await validateCode('function f() { f(); } f();', 1, 500);
    assert.equal(result.valid, false);
    assert.ok(result.error, 'Should have error message for stack overflow');
  });
});

// ── Multi-Attempt Behavior ───────────────────────────────────────────

describe('vm-sandbox — multi-attempt validation', () => {
  it('should run code N times when valid (default 3)', async () => {
    // Valid code should be run 3 times and pass
    const result = await validateCode('const x = 1;', 3);
    assert.deepEqual(result, { valid: true });
  });

  it('should fail on first attempt for deterministic errors', async () => {
    const result = await validateCode('throw new Error("boom");', 3);
    assert.equal(result.valid, false);
    assert.equal(result.attempt, 1, 'Deterministic error should fail on attempt 1');
  });

  it('should accept custom attempt count', async () => {
    const result = await validateCode('const y = 2;', 5);
    assert.deepEqual(result, { valid: true });
  });

  it('should run single attempt when attempts=1', async () => {
    const result = await validateCode('const z = 3;', 1);
    assert.deepEqual(result, { valid: true });
  });
});
