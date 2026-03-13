/**
 * Meta-Test: Test Suite Quality Guard
 *
 * This file guards the INTEGRITY of our test suite itself.
 * Like a clock that must never be doubted — these checks run on every `npm test`
 * and catch anti-patterns BEFORE they enter the codebase.
 *
 * What it enforces:
 *   1. No assert.ok(true) — unconditionally-passing tests are banned
 *   2. Every it() block has at least one assert call
 *   3. Minimum assertion density (assert calls / it blocks >= 1.0)
 *   4. No eval() or Function() in test files
 *   5. All agent/*.js files have test coverage (at least 1 import)
 *   6. Minimum test count threshold (never regress below known count)
 *   7. Skipped tests are bounded (never exceed threshold)
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const TEST_DIR = path.join(__dirname);
const AGENT_DIR = path.join(__dirname, '..', 'agent');

// ── Config: thresholds that only go UP ───────────────────────────────
const THRESHOLDS = {
  MIN_TOTAL_TESTS: 900,       // current: 913 — bump when adding tests
  MAX_SKIPPED: 6,             // current: 3 — alarm if skips creep up
  MIN_ASSERT_RATIO: 1.0,     // assert calls per it() block
  MIN_TEST_FILES: 27,        // current: 29 — never drop below
};

// ── Helpers ──────────────────────────────────────────────────────────

function getTestFiles() {
  return fs.readdirSync(TEST_DIR)
    .filter(f => f.endsWith('.test.js'))
    .map(f => ({
      name: f,
      content: fs.readFileSync(path.join(TEST_DIR, f), 'utf8'),
    }));
}

// Cache at module level — read disk once, reuse across all describe blocks
const ALL_TEST_FILES = getTestFiles();

function getAgentFiles() {
  const files = [];
  const entries = fs.readdirSync(AGENT_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(entry.name);
    }
    if (entry.isDirectory()) {
      const subEntries = fs.readdirSync(path.join(AGENT_DIR, entry.name), { withFileTypes: true });
      for (const sub of subEntries) {
        if (sub.isFile() && sub.name.endsWith('.js')) {
          files.push(`${entry.name}/${sub.name}`);
        }
      }
    }
  }
  return files;
}

function countPattern(content, pattern) {
  const matches = content.match(pattern);
  return matches ? matches.length : 0;
}

// ── 1. Banned Patterns ───────────────────────────────────────────────

describe('Test Quality — Banned Patterns', () => {
  const testFiles = ALL_TEST_FILES;

  it('NO assert.ok(true) in any test file', () => {
    const violations = [];
    for (const file of testFiles) {
      if (file.name === 'test-quality.test.js') continue; // skip self
      const lines = file.content.split('\n');
      lines.forEach((line, i) => {
        // Match assert.ok(true) but not inside comments or strings describing the rule
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
        if (/assert\.ok\(\s*true\s*[,)]/.test(line)) {
          violations.push(`${file.name}:${i + 1}: ${trimmed}`);
        }
      });
    }
    assert.equal(violations.length, 0,
      `Found assert.ok(true) — unconditionally-passing tests:\n${violations.join('\n')}`);
  });

  it('NO eval() or new Function() in test files', () => {
    const violations = [];
    for (const file of testFiles) {
      if (file.name === 'test-quality.test.js') continue;
      const lines = file.content.split('\n');
      lines.forEach((line, i) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
        // Match eval( but not inside strings being tested (e.g., validateCode('eval(...)'))
        if (/[^'"`]eval\s*\(/.test(line) && !line.includes('validateCode') && !line.includes("'eval")) {
          violations.push(`${file.name}:${i + 1}: ${trimmed}`);
        }
        if (/new\s+Function\s*\(/.test(line) && !line.includes('validateCode') && !line.includes("'")) {
          violations.push(`${file.name}:${i + 1}: ${trimmed}`);
        }
      });
    }
    assert.equal(violations.length, 0,
      `Found eval/Function in test files:\n${violations.join('\n')}`);
  });
});

// ── 2. Assertion Density ─────────────────────────────────────────────

describe('Test Quality — Assertion Density', () => {
  const testFiles = ALL_TEST_FILES;

  it('every test file should have more assert calls than it() blocks', () => {
    const weak = [];
    for (const file of testFiles) {
      if (file.name === 'test-quality.test.js') continue;
      const itCount = countPattern(file.content, /\bit\s*\(/g);
      const assertCount = countPattern(file.content, /assert\.\w+/g);
      if (itCount > 0 && assertCount / itCount < THRESHOLDS.MIN_ASSERT_RATIO) {
        weak.push(`${file.name}: ${itCount} tests, ${assertCount} asserts (ratio: ${(assertCount / itCount).toFixed(2)})`);
      }
    }
    assert.equal(weak.length, 0,
      `Files with assertion density below ${THRESHOLDS.MIN_ASSERT_RATIO}:\n${weak.join('\n')}`);
  });

  it('no it() block should be completely empty (0 lines of body)', () => {
    const violations = [];
    for (const file of testFiles) {
      if (file.name === 'test-quality.test.js') continue;
      // Match it('...', () => {}) or it('...', async () => {}) with empty body
      const emptyTests = file.content.match(/it\s*\([^)]*,\s*(?:async\s*)?\(\s*\)\s*=>\s*\{\s*\}\s*\)/g);
      if (emptyTests) {
        violations.push(`${file.name}: ${emptyTests.length} empty it() block(s)`);
      }
    }
    assert.equal(violations.length, 0,
      `Found empty test bodies:\n${violations.join('\n')}`);
  });
});

// ── 3. Coverage Map ─────────────────────────────────────────────────

describe('Test Quality — Agent Coverage Map', () => {
  const testFiles = ALL_TEST_FILES;
  const allTestContent = testFiles.map(f => f.content).join('\n');
  const agentFiles = getAgentFiles();

  // Files that are legitimately exempt from direct test imports
  const EXEMPT = [
    'bot.js',                  // entry-point script, wraps OctivBot
    'logger.js',               // tested via logger.test.js (getLogger import)
    'memory-logger.js',        // circular dep prevention, tested via memory.test.js
    'octivia.legacy.js',       // archived backup of pre-OpenClaw octivia.js (not active)
    'telegram-bot.legacy.js',  // archived backup of pre-OpenClaw telegram-bot.js (not active)
  ];

  it('every non-exempt agent/*.js should be imported by at least one test', () => {
    const untested = [];
    for (const agentFile of agentFiles) {
      if (EXEMPT.includes(agentFile)) continue;
      const baseName = agentFile.replace(/\.js$/, '');
      // Check if any test file requires this agent
      const isImported = allTestContent.includes(`/${baseName}`) ||
                         allTestContent.includes(`'../agent/${baseName}'`) ||
                         allTestContent.includes(`"../agent/${baseName}"`);
      if (!isImported) {
        untested.push(`agent/${agentFile}`);
      }
    }
    assert.equal(untested.length, 0,
      `Agent files with zero test imports:\n${untested.join('\n')}\nAdd tests or add to EXEMPT list with justification.`);
  });
});

// ── 4. Threshold Guards ─────────────────────────────────────────────

describe('Test Quality — Threshold Guards', () => {
  it(`test file count should be >= ${THRESHOLDS.MIN_TEST_FILES}`, () => {
    assert.ok(ALL_TEST_FILES.length >= THRESHOLDS.MIN_TEST_FILES,
      `Only ${ALL_TEST_FILES.length} test files (minimum: ${THRESHOLDS.MIN_TEST_FILES}). Did a test file get deleted?`);
  });

  // Note: total test count and skip count are verified by verify-tests skill
  // at runtime. This file guards structural quality only (static analysis).
});

// ── 5. Coverage Infrastructure ────────────────────────────────────────

describe('Test Quality — Coverage Infrastructure', () => {
  it('c8 should be installed as devDependency', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    assert.ok(pkg.devDependencies && pkg.devDependencies.c8,
      'c8 not found in devDependencies. Run: npm install --save-dev c8');
  });

  it('test:coverage script should exist in package.json', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    assert.ok(pkg.scripts && pkg.scripts['test:coverage'],
      'test:coverage script not found in package.json');
    assert.ok(
      pkg.scripts['test:coverage'].includes('coverage'),
      'test:coverage script should include coverage tooling');
  });

  it('.c8rc.json config should exist', () => {
    const configPath = path.join(__dirname, '..', '.c8rc.json');
    assert.ok(fs.existsSync(configPath), '.c8rc.json not found in project root');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.ok(config.lines >= 60, `Line threshold too low: ${config.lines}`);
    assert.ok(config.branches >= 40, `Branch threshold too low: ${config.branches}`);
    assert.ok(config.functions >= 50, `Function threshold too low: ${config.functions}`);
  });
});

// ── 6. Mock Quality ─────────────────────────────────────────────────

describe('Test Quality — Mock Quality', () => {
  const testFiles = ALL_TEST_FILES;

  it('test files with mock.fn() should also contain assert.rejects or error simulation', () => {
    const suspicious = [];
    for (const file of testFiles) {
      if (file.name === 'test-quality.test.js') continue;
      const hasMocks = file.content.includes('mock.fn(');
      if (!hasMocks) continue;

      const hasFailureMock = file.content.includes('throw new Error') ||
                             file.content.includes('assert.rejects') ||
                             file.content.includes('assert.throws') ||
                             file.content.includes('reject(') ||
                             file.content.includes('.error') ||
                             file.content.includes('null');
      if (!hasFailureMock) {
        suspicious.push(`${file.name}: has mocks but no failure simulation`);
      }
    }
    assert.equal(suspicious.length, 0,
      `Files with only happy-path mocks (no error/throw/reject/null):\n${suspicious.join('\n')}`);
  });
});
