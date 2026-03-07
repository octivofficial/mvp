#!/usr/bin/env node
/**
 * vault-sync-cli.js — Hook entry point for automated vault sync.
 *
 * Usage (from Claude Code hooks):
 *   node scripts/vault-sync-cli.js git              # After git commit
 *   echo "$OUTPUT" | node scripts/vault-sync-cli.js test   # After npm test (stdin = test output)
 *   node scripts/vault-sync-cli.js roadmap           # After ROADMAP.md edit
 *   node scripts/vault-sync-cli.js full              # Full sync (all of the above)
 */
'use strict';

const fs = require('fs');
const {
  gatherStats, syncDashboard, syncSessionState, syncRoadmap,
  parseTestOutput, parseCoverage,
} = require('../agent/vault-sync');

const mode = process.argv[2];

async function main() {
  switch (mode) {
    case 'git': {
      const stats = gatherStats();
      await syncDashboard(stats);
      await syncSessionState(stats);
      console.log(`[VaultSync] Dashboard updated: commit ${stats.lastCommit}`);
      break;
    }

    case 'test': {
      const input = fs.readFileSync('/dev/stdin', 'utf-8');
      const testStats = parseTestOutput(input);
      if (testStats.tests > 0) {
        const stats = { ...gatherStats(), ...testStats };
        const coverage = parseCoverage(input);
        if (coverage) stats.coverage = coverage;
        await syncDashboard(stats);
        await syncSessionState(stats);
        console.log(`[VaultSync] Tests synced: ${testStats.tests} tests, ${testStats.pass} pass`);
      }
      break;
    }

    case 'roadmap': {
      await syncRoadmap();
      console.log('[VaultSync] Roadmap synced from ROADMAP.md');
      break;
    }

    case 'full': {
      const stats = gatherStats();
      await syncDashboard(stats);
      await syncSessionState(stats);
      await syncRoadmap();
      console.log('[VaultSync] Full sync complete');
      break;
    }

    default:
      console.error('Usage: vault-sync-cli.js [git|test|roadmap|full]');
      process.exit(1);
  }
}

main().catch(err => {
  console.error(`[VaultSync] Error: ${err.message}`);
  process.exit(1);
});
