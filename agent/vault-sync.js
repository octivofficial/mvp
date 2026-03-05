/**
 * Octiv Vault Sync — Programmatic Dashboard & Session State Updates
 *
 * Keeps vault/Dashboard.md and vault/Session-Sync.md in sync with reality.
 * Called by save-memory/session-memory skills and hooks.
 */
const fsp = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');
const { getLogger } = require('./logger');

const log = getLogger();

const VAULT_DIR = path.join(__dirname, '..', 'vault');
const DASHBOARD_PATH = path.join(VAULT_DIR, 'Dashboard.md');
const SESSION_SYNC_PATH = path.join(VAULT_DIR, 'Session-Sync.md');

/**
 * Gather current system stats from git, npm test output, etc.
 * @param {object} [opts] - Options
 * @param {string} [opts.projectRoot] - Project root directory
 * @returns {object} stats - { tests, pass, fail, skip, lastCommit, commitMsg, branch, date }
 */
function gatherStats(opts = {}) {
  const root = opts.projectRoot || path.join(__dirname, '..');
  const stats = {
    tests: 0,
    pass: 0,
    fail: 0,
    skip: 0,
    lastCommit: 'unknown',
    commitMsg: '',
    branch: 'main',
    date: new Date().toISOString().slice(0, 10),
  };

  try {
    const gitLog = execSync('git log --oneline -1', { cwd: root, encoding: 'utf-8' }).trim();
    const parts = gitLog.split(' ');
    stats.lastCommit = parts[0];
    stats.commitMsg = parts.slice(1).join(' ');
  } catch { /* git not available */ }

  try {
    stats.branch = execSync('git branch --show-current', { cwd: root, encoding: 'utf-8' }).trim();
  } catch { /* git not available */ }

  return stats;
}

/**
 * Update test count in Dashboard.md.
 * Finds the TESTS stat section and replaces the numbers.
 * @param {object} stats - { tests, pass, fail, skip }
 * @returns {boolean} true if updated
 */
async function syncDashboard(stats) {
  try {
    let content = await fsp.readFile(DASHBOARD_PATH, 'utf-8');
    let changed = false;

    // Update TESTS stat card
    const testsCardRe = /(>\s*>\s*\[!stat\]\s*TESTS\n>\s*>\s*<div[^>]*>)\d+(<\/div>\n>\s*>\s*<span[^>]*>)\d+ PASS \| \d+ FAIL \| \d+ SKIP(<\/span>)/;
    const testsMatch = content.match(testsCardRe);
    if (testsMatch && stats.tests > 0) {
      content = content.replace(testsCardRe,
        `$1${stats.tests}$2${stats.pass} PASS | ${stats.fail} FAIL | ${stats.skip} SKIP$3`);
      changed = true;
    }

    // Update Claude Session State table
    const sessionRe = /(\|\s*\*\*Last Session\*\*\s*\|)\s*[^|]+\|/;
    if (sessionRe.test(content)) {
      content = content.replace(sessionRe, `$1 ${stats.date} |`);
      changed = true;
    }

    const commitRe = /(\|\s*\*\*Last Commit\*\*\s*\|)\s*[^|]+\|/;
    if (commitRe.test(content) && stats.lastCommit !== 'unknown') {
      content = content.replace(commitRe, `$1 \`${stats.lastCommit}\` ${stats.commitMsg} |`);
      changed = true;
    }

    const testCountRe = /(\|\s*\*\*Test Count\*\*\s*\|)\s*[^|]+\|/;
    if (testCountRe.test(content) && stats.tests > 0) {
      content = content.replace(testCountRe,
        `$1 ${stats.tests} (${stats.pass} pass, ${stats.fail} fail, ${stats.skip} skip) |`);
      changed = true;
    }

    // Update footer timestamp
    const footerRe = /(Last Synced: <strong>)\d{4}-\d{2}-\d{2}(<\/strong> \| )\d+( Tests)/;
    if (footerRe.test(content) && stats.tests > 0) {
      content = content.replace(footerRe, `$1${stats.date}$2${stats.tests}$3`);
      changed = true;
    }

    if (changed) {
      await fsp.writeFile(DASHBOARD_PATH, content, 'utf-8');
      log.info('vault-sync', `Dashboard updated: ${stats.tests} tests, commit ${stats.lastCommit}`);
    }

    return changed;
  } catch (err) {
    log.error('vault-sync', `Dashboard sync failed: ${err.message}`);
    return false;
  }
}

/**
 * Update Session-Sync.md current state table.
 * @param {object} session - { tests, pass, fail, skip, lastCommit, commitMsg, branch, date, lint }
 * @returns {boolean} true if updated
 */
async function syncSessionState(session) {
  try {
    let content = await fsp.readFile(SESSION_SYNC_PATH, 'utf-8');
    let changed = false;

    // Update Session Date
    const dateRe = /(\|\s*\*\*Session Date\*\*\s*\|)\s*[^|]+\|/;
    if (dateRe.test(content)) {
      content = content.replace(dateRe, `$1 ${session.date} |`);
      changed = true;
    }

    // Update Last Commit
    const commitRe = /(\|\s*\*\*Last Commit\*\*\s*\|)\s*[^|]+\|/;
    if (commitRe.test(content) && session.lastCommit !== 'unknown') {
      content = content.replace(commitRe,
        `$1 \`${session.lastCommit}\` — ${session.commitMsg} |`);
      changed = true;
    }

    // Update Tests
    const testsRe = /(\|\s*\*\*Tests\*\*\s*\|)\s*[^|]+\|/;
    if (testsRe.test(content) && session.tests > 0) {
      content = content.replace(testsRe,
        `$1 ${session.tests} total (${session.pass} pass, ${session.fail} fail, ${session.skip} skip) |`);
      changed = true;
    }

    // Update Lint
    if (session.lint !== undefined) {
      const lintRe = /(\|\s*\*\*Lint\*\*\s*\|)\s*[^|]+\|/;
      if (lintRe.test(content)) {
        content = content.replace(lintRe, `$1 ${session.lint} errors |`);
        changed = true;
      }
    }

    // Update Branch
    const branchRe = /(\|\s*\*\*Branch\*\*\s*\|)\s*[^|]+\|/;
    if (branchRe.test(content)) {
      content = content.replace(branchRe, `$1 \`${session.branch}\` |`);
      changed = true;
    }

    if (changed) {
      await fsp.writeFile(SESSION_SYNC_PATH, content, 'utf-8');
      log.info('vault-sync', `Session-Sync updated: ${session.tests} tests, commit ${session.lastCommit}`);
    }

    return changed;
  } catch (err) {
    log.error('vault-sync', `Session-Sync failed: ${err.message}`);
    return false;
  }
}

module.exports = { gatherStats, syncDashboard, syncSessionState, VAULT_DIR, DASHBOARD_PATH, SESSION_SYNC_PATH };
