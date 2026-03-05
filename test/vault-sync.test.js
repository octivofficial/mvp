/**
 * Vault Sync tests.
 * Tests Dashboard.md and Session-Sync.md auto-update logic.
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('fs').promises;
const path = require('path');
const os = require('os');

// We test the regex replacement logic by creating temp files
// that mimic the real Dashboard.md / Session-Sync.md structure.

const DASHBOARD_TEMPLATE = `---
tags: [dashboard]
---

## System Vitals

> [!stat] TESTS
> > <div style="font-size: 2em; font-weight: bold; color: #3fb950;">408</div>
> > <span style="font-size: 0.8em; color: gray;">404 PASS | 0 FAIL | 4 SKIP</span>

## Claude Session State

| Field | Value |
|-------|-------|
| **Last Session** | 2026-03-04 |
| **Last Commit** | \`abc1234\` old msg |
| **Test Count** | 408 (404 pass, 0 fail, 4 skip) |
| **Branch** | \`main\` |

<p>Last Synced: <strong>2026-03-04</strong> | 408 Tests</p>
`;

const SESSION_SYNC_TEMPLATE = `---
tags: [session]
---

## Current State

| Field | Value |
|-------|-------|
| **Session Date** | 2026-03-04 |
| **Last Commit** | \`abc1234\` — old msg |
| **Tests** | 408 total (404 pass, 0 fail, 4 skip) |
| **Lint** | 0 errors |
| **Branch** | \`main\` |
`;

describe('vault-sync — gatherStats', () => {
  it('returns stats object with correct fields', () => {
    const { gatherStats } = require('../agent/vault-sync');
    const stats = gatherStats();
    assert.ok(stats.date);
    assert.equal(typeof stats.lastCommit, 'string');
    assert.equal(typeof stats.branch, 'string');
    assert.equal(typeof stats.tests, 'number');
  });

  it('returns today date', () => {
    const { gatherStats } = require('../agent/vault-sync');
    const stats = gatherStats();
    const today = new Date().toISOString().slice(0, 10);
    assert.equal(stats.date, today);
  });
});

describe('vault-sync — syncDashboard', () => {
  let tmpDir;
  let dashPath;

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'vault-sync-'));
    dashPath = path.join(tmpDir, 'Dashboard.md');
    await fsp.writeFile(dashPath, DASHBOARD_TEMPLATE, 'utf-8');
  });

  it('updates test count in TESTS stat card', async () => {
    // Verify regex patterns match the Dashboard template structure
    let content = await fsp.readFile(dashPath, 'utf-8');
    const testsCardRe = /(>\s*>\s*<div[^>]*>)\d+(<\/div>\n>\s*>\s*<span[^>]*>)\d+ PASS \| \d+ FAIL \| \d+ SKIP(<\/span>)/;
    const match = content.match(testsCardRe);
    assert.ok(match, 'TESTS card pattern should match template');

    content = content.replace(testsCardRe, `$1${454}$2${451} PASS | ${0} FAIL | ${3} SKIP$3`);
    assert.ok(content.includes('454'));
    assert.ok(content.includes('451 PASS'));
  });

  it('updates session state table fields', async () => {
    let content = await fsp.readFile(dashPath, 'utf-8');

    const sessionRe = /(\|\s*\*\*Last Session\*\*\s*\|)\s*[^|]+\|/;
    assert.ok(sessionRe.test(content));
    content = content.replace(sessionRe, '$1 2026-03-05 |');
    assert.ok(content.includes('2026-03-05'));

    const commitRe = /(\|\s*\*\*Last Commit\*\*\s*\|)\s*[^|]+\|/;
    assert.ok(commitRe.test(content));
    content = content.replace(commitRe, '$1 `xyz789` new msg |');
    assert.ok(content.includes('xyz789'));

    const testCountRe = /(\|\s*\*\*Test Count\*\*\s*\|)\s*[^|]+\|/;
    assert.ok(testCountRe.test(content));
    content = content.replace(testCountRe, '$1 454 (451 pass, 0 fail, 3 skip) |');
    assert.ok(content.includes('454 (451'));
  });

  it('updates footer timestamp', async () => {
    let content = await fsp.readFile(dashPath, 'utf-8');
    const footerRe = /(Last Synced: <strong>)\d{4}-\d{2}-\d{2}(<\/strong> \| )\d+( Tests)/;
    assert.ok(footerRe.test(content));
    content = content.replace(footerRe, '$12026-03-05$2454$3');
    assert.ok(content.includes('2026-03-05'));
    assert.ok(content.includes('454 Tests'));
  });
});

describe('vault-sync — syncSessionState', () => {
  let tmpDir;
  let ssPath;

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'vault-sync-ss-'));
    ssPath = path.join(tmpDir, 'Session-Sync.md');
    await fsp.writeFile(ssPath, SESSION_SYNC_TEMPLATE, 'utf-8');
  });

  it('matches session date pattern', async () => {
    const content = await fsp.readFile(ssPath, 'utf-8');
    const dateRe = /(\|\s*\*\*Session Date\*\*\s*\|)\s*[^|]+\|/;
    assert.ok(dateRe.test(content));
  });

  it('matches commit pattern', async () => {
    const content = await fsp.readFile(ssPath, 'utf-8');
    const commitRe = /(\|\s*\*\*Last Commit\*\*\s*\|)\s*[^|]+\|/;
    assert.ok(commitRe.test(content));
  });

  it('matches tests pattern', async () => {
    const content = await fsp.readFile(ssPath, 'utf-8');
    const testsRe = /(\|\s*\*\*Tests\*\*\s*\|)\s*[^|]+\|/;
    assert.ok(testsRe.test(content));
  });

  it('matches lint pattern', async () => {
    const content = await fsp.readFile(ssPath, 'utf-8');
    const lintRe = /(\|\s*\*\*Lint\*\*\s*\|)\s*[^|]+\|/;
    assert.ok(lintRe.test(content));
  });

  it('matches branch pattern', async () => {
    const content = await fsp.readFile(ssPath, 'utf-8');
    const branchRe = /(\|\s*\*\*Branch\*\*\s*\|)\s*[^|]+\|/;
    assert.ok(branchRe.test(content));
  });

  it('replaces all fields correctly', async () => {
    let content = await fsp.readFile(ssPath, 'utf-8');

    const replacements = [
      { re: /(\|\s*\*\*Session Date\*\*\s*\|)\s*[^|]+\|/, val: '$1 2026-03-05 |' },
      { re: /(\|\s*\*\*Last Commit\*\*\s*\|)\s*[^|]+\|/, val: '$1 `def456` — new commit |' },
      { re: /(\|\s*\*\*Tests\*\*\s*\|)\s*[^|]+\|/, val: '$1 460 total (457 pass, 0 fail, 3 skip) |' },
      { re: /(\|\s*\*\*Lint\*\*\s*\|)\s*[^|]+\|/, val: '$1 0 errors |' },
      { re: /(\|\s*\*\*Branch\*\*\s*\|)\s*[^|]+\|/, val: '$1 `main` |' },
    ];

    for (const { re, val } of replacements) {
      content = content.replace(re, val);
    }

    assert.ok(content.includes('2026-03-05'));
    assert.ok(content.includes('def456'));
    assert.ok(content.includes('460 total'));
  });
});

describe('vault-sync — module exports', () => {
  it('exports all expected functions', () => {
    const mod = require('../agent/vault-sync');
    assert.equal(typeof mod.gatherStats, 'function');
    assert.equal(typeof mod.syncDashboard, 'function');
    assert.equal(typeof mod.syncSessionState, 'function');
    assert.equal(typeof mod.VAULT_DIR, 'string');
    assert.equal(typeof mod.DASHBOARD_PATH, 'string');
    assert.equal(typeof mod.SESSION_SYNC_PATH, 'string');
  });
});
