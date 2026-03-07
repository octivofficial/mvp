/**
 * Octiv Vault Sync — Programmatic Dashboard & Session State Updates
 *
 * Keeps vault/Dashboard.md and vault/Session-Sync.md in sync with reality.
 * Called by save-memory/session-memory skills and hooks.
 *
 * Note: Real-time live data is handled by obsidian-bridge.js (Redis -> vault/05-Live/).
 * This module handles static session-boundary updates only.
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

    const testCountRe = /(\|\s*\*\*(?:Test Count|Tests)\*\*\s*\|)\s*[^|]+\|/;
    if (testCountRe.test(content) && stats.tests > 0) {
      content = content.replace(testCountRe,
        `$1 ${stats.tests} (${stats.pass} pass, ${stats.fail} fail, ${stats.skip} skip) |`);
      changed = true;
    }

    // Update COVERAGE stat card
    if (stats.coverage) {
      const coverageCardRe = /(>\s*>\s*\[!stat\]\s*COVERAGE\n>\s*>\s*<div[^>]*>)\d+%(<\/div>\n>\s*>\s*<span[^>]*>Lines\s+)[\d.]+\s*\|\s*Branch\s*[\d.]+(<\/span>)/;
      if (coverageCardRe.test(content)) {
        content = content.replace(coverageCardRe,
          `$1${Math.round(stats.coverage.lines)}%$2${stats.coverage.lines} | Branch ${stats.coverage.branches}$3`);
        changed = true;
      }

      const coverageRe = /(\|\s*\*\*Coverage\*\*\s*\|)\s*[^|]+\|/;
      if (coverageRe.test(content)) {
        content = content.replace(coverageRe,
          `$1 ${stats.coverage.lines}% lines, ${stats.coverage.branches}% branches, ${stats.coverage.functions}% functions |`);
        changed = true;
      }
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

// ── Test/Coverage Output Parsers ─────────────────────────────────────

/**
 * Parse Node.js test runner output for test counts.
 * @param {string} text - Raw test output
 * @returns {{ tests: number, pass: number, fail: number, skip: number }}
 */
function parseTestOutput(text) {
  const get = (key) => {
    const m = text.match(new RegExp(`(?:#|ℹ)\\s*${key}\\s+(\\d+)`));
    return m ? parseInt(m[1]) : 0;
  };
  return { tests: get('tests'), pass: get('pass'), fail: get('fail'), skip: get('skipped') };
}

/**
 * Parse coverage output from Node.js native coverage or c8.
 * @param {string} text - Coverage output
 * @returns {{ lines: number, branches: number, functions: number } | null}
 */
function parseCoverage(text) {
  const m = text.match(/all files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/i);
  if (!m) return null;
  return { lines: parseFloat(m[1]), branches: parseFloat(m[2]), functions: parseFloat(m[3]) };
}

// ── ROADMAP Parser ───────────────────────────────────────────────────

/**
 * Determine status from checkbox counts in text.
 * @param {string} text
 * @returns {string}
 */
function checkboxStatus(text) {
  const checked = (text.match(/- \[x\]/g) || []).length;
  const unchecked = (text.match(/- \[ \]/g) || []).length;
  const total = checked + unchecked;
  if (total === 0) return 'Planned';
  if (checked === total) return 'DONE';
  if (checked > 0) return 'IN PROGRESS';
  return 'Planned';
}

/**
 * Parse ROADMAP.md phase status from checkbox completion.
 * @param {string} content - ROADMAP.md content
 * @returns {Array<{id: string, name: string, status: string}>}
 */
function parsePhaseStatus(content) {
  const phases = [];
  const phaseHeaderRe = /^## Phase (\d+)\s*(.*?)$/gm;
  const headers = [...content.matchAll(phaseHeaderRe)];
  const scheduleIdx = content.indexOf('\n## Schedule');
  const endIdx = scheduleIdx !== -1 ? scheduleIdx : content.length;

  for (let i = 0; i < headers.length; i++) {
    const id = headers[i][1];
    const headerText = headers[i][2];

    let name = 'Foundation';
    const nameMatch = headerText.match(/[—–-]\s*(.+?)(?:\s*\(.*?\))?\s*$/);
    if (nameMatch) name = nameMatch[1].trim();

    const sectionStart = headers[i].index + headers[i][0].length;
    const sectionEnd = i + 1 < headers.length ? headers[i + 1].index : endIdx;
    const section = content.slice(sectionStart, sectionEnd);

    if (id === '7') {
      const subRe = /^### (\d+\.\d+)\s+(.+?)$/gm;
      const subs = [...section.matchAll(subRe)];
      for (let j = 0; j < subs.length; j++) {
        const subId = subs[j][1];
        const subName = subs[j][2]
          .replace(/\s*\(NEW[^)]*\)/g, '')
          .replace(/\s*[—–-].*$/g, '')
          .trim();
        const subStart = subs[j].index + subs[j][0].length;
        const subEnd = j + 1 < subs.length ? subs[j + 1].index : section.length;
        phases.push({ id: subId, name: subName, status: checkboxStatus(section.slice(subStart, subEnd)) });
      }
    } else {
      phases.push({ id, name, status: checkboxStatus(section) });
    }
  }
  return phases;
}

/**
 * Sync ROADMAP.md → vault/01-Project/Roadmap.md
 * @param {object} [opts]
 * @param {string} [opts.projectRoot]
 * @returns {boolean}
 */
async function syncRoadmap(opts = {}) {
  const root = opts.projectRoot || path.join(__dirname, '..');
  const roadmapSrc = path.join(root, 'ROADMAP.md');
  const roadmapDst = path.join(VAULT_DIR, '01-Project', 'Roadmap.md');

  try {
    const content = await fsp.readFile(roadmapSrc, 'utf-8');
    const phases = parsePhaseStatus(content);
    const date = new Date().toISOString().slice(0, 10);

    const phaseTable = phases.map(p => {
      const st = p.status === 'DONE' ? 'DONE'
        : p.status === 'IN PROGRESS' ? '**IN PROGRESS**'
        : 'Planned';
      return `| ${p.id} | ${p.name} | ${st} |`;
    }).join('\n');

    // Parse AC items from headers
    const acRe = /###\s+\d+\.\d+\s+(AC-\d+):\s+(.+?)(?:\s*[—–-]\s*DONE)?\s*$/gm;
    const acs = [...content.matchAll(acRe)].map(m => `- [x] ${m[1]}: ${m[2].replace(/\s*\(.*?\)/g, '').trim()}`);

    const output = `---
tags: [project, roadmap]
synced: ${date}
---

# Roadmap

> Auto-synced from [[../../ROADMAP|/ROADMAP.md]] — ${date}

## Phase Status

| Phase | Name | Status |
|-------|------|--------|
${phaseTable}

## Acceptance Criteria

${acs.join('\n')}

> All 8 ACs complete.
`;

    await fsp.writeFile(roadmapDst, output, 'utf-8');
    log.info('vault-sync', `Roadmap synced: ${phases.length} phases, ${acs.length} ACs`);
    return true;
  } catch (err) {
    log.error('vault-sync', `Roadmap sync failed: ${err.message}`);
    return false;
  }
}

module.exports = {
  gatherStats, syncDashboard, syncSessionState, syncRoadmap,
  parseTestOutput, parseCoverage, parsePhaseStatus, checkboxStatus,
  VAULT_DIR, DASHBOARD_PATH, SESSION_SYNC_PATH,
};
