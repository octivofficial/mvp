/**
 * Vault Sync tests.
 * Tests Dashboard.md and Session-Sync.md auto-update logic.
 */
const { describe, it, beforeEach, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("fs").promises;
const path = require("path");
const os = require("os");

// We test the regex replacement logic by creating temp files
// that mimic the real Dashboard.md / Session-Sync.md structure.

const DASHBOARD_TEMPLATE = `---
tags: [dashboard]
---

## System Vitals

> > [!stat] TESTS
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

describe("vault-sync — gatherStats", () => {
  it("returns stats object with correct fields", () => {
    const { gatherStats } = require("../agent/vault-sync");
    const stats = gatherStats();
    assert.ok(stats.date);
    assert.equal(typeof stats.lastCommit, "string");
    assert.equal(typeof stats.branch, "string");
    assert.equal(typeof stats.tests, "number");
  });

  it("returns today date", () => {
    const { gatherStats } = require("../agent/vault-sync");
    const stats = gatherStats();
    const today = new Date().toISOString().slice(0, 10);
    assert.equal(stats.date, today);
  });

  it("handles git not available gracefully", () => {
    const { gatherStats } = require("../agent/vault-sync");
    // Pass a nonexistent directory — git commands will fail
    const stats = gatherStats({ projectRoot: "/nonexistent/path" });
    assert.equal(stats.lastCommit, "unknown");
    assert.equal(stats.branch, "main"); // default
  });
});

// ── syncDashboard — actual function calls with fs mocks ─────────────

describe("vault-sync — syncDashboard (function)", () => {
  let readMock, writeMock;
  const mod = require("../agent/vault-sync");

  afterEach(() => {
    if (readMock) readMock.mock.restore();
    if (writeMock) writeMock.mock.restore();
  });

  it("updates all fields and writes file", async () => {
    let written = null;
    readMock = mock.method(fsp, "readFile", async () => DASHBOARD_TEMPLATE);
    writeMock = mock.method(fsp, "writeFile", async (_p, content) => {
      written = content;
    });

    const result = await mod.syncDashboard({
      tests: 585,
      pass: 582,
      fail: 0,
      skip: 3,
      lastCommit: "abc1234",
      commitMsg: "test commit",
      date: "2026-03-05",
    });

    assert.equal(result, true);
    assert.ok(written, "should have written file");
    assert.ok(written.includes("585"), "should update TESTS stat card");
    assert.ok(written.includes("582 PASS"), "should update pass count");
    assert.ok(written.includes("2026-03-05"), "should update date");
    assert.ok(
      written.includes("585 (582 pass, 0 fail, 3 skip)"),
      "should update test count table",
    );
  });

  it("returns false when tests=0 (no update)", async () => {
    readMock = mock.method(fsp, "readFile", async () => DASHBOARD_TEMPLATE);
    writeMock = mock.method(fsp, "writeFile", async () => {});

    const result = await mod.syncDashboard({
      tests: 0,
      pass: 0,
      fail: 0,
      skip: 0,
      lastCommit: "abc",
      commitMsg: "msg",
      date: "2026-03-05",
    });

    // Should still update date/commit fields but not test counts
    assert.equal(result, true); // date field still updates
  });

  it("skips commit update when lastCommit is unknown", async () => {
    let written = null;
    readMock = mock.method(fsp, "readFile", async () => DASHBOARD_TEMPLATE);
    writeMock = mock.method(fsp, "writeFile", async (_p, content) => {
      written = content;
    });

    const result = await mod.syncDashboard({
      tests: 500,
      pass: 497,
      fail: 0,
      skip: 3,
      lastCommit: "unknown",
      commitMsg: "",
      date: "2026-03-05",
    });

    assert.equal(result, true);
    // Commit field should NOT be updated
    assert.ok(written.includes("abc1234"), "should keep old commit hash");
  });

  it("returns false on file read error", async () => {
    readMock = mock.method(fsp, "readFile", async () => {
      throw new Error("ENOENT");
    });

    const result = await mod.syncDashboard({
      tests: 500,
      pass: 500,
      fail: 0,
      skip: 0,
      lastCommit: "abc",
      commitMsg: "msg",
      date: "2026-03-05",
    });

    assert.equal(result, false);
  });

  it("returns false when content has no matching patterns", async () => {
    readMock = mock.method(
      fsp,
      "readFile",
      async () => "# Empty dashboard\nNo patterns here.\n",
    );
    writeMock = mock.method(fsp, "writeFile", async () => {});

    const result = await mod.syncDashboard({
      tests: 500,
      pass: 500,
      fail: 0,
      skip: 0,
      lastCommit: "abc",
      commitMsg: "msg",
      date: "2026-03-05",
    });

    assert.equal(result, false); // nothing matched, nothing changed
  });
});

// ── syncSessionState — actual function calls with fs mocks ──────────

describe("vault-sync — syncSessionState (function)", () => {
  let readMock, writeMock;
  const mod = require("../agent/vault-sync");

  afterEach(() => {
    if (readMock) readMock.mock.restore();
    if (writeMock) writeMock.mock.restore();
  });

  it("updates all session fields and writes file", async () => {
    let written = null;
    readMock = mock.method(
      fsp,
      "readFile",
      async () => SESSION_SYNC_TEMPLATE,
    );
    writeMock = mock.method(fsp, "writeFile", async (_p, content) => {
      written = content;
    });

    const result = await mod.syncSessionState({
      tests: 585,
      pass: 582,
      fail: 0,
      skip: 3,
      lastCommit: "def456",
      commitMsg: "new commit",
      branch: "main",
      date: "2026-03-05",
      lint: 0,
    });

    assert.equal(result, true);
    assert.ok(written);
    assert.ok(written.includes("2026-03-05"), "should update date");
    assert.ok(written.includes("def456"), "should update commit");
    assert.ok(written.includes("585 total"), "should update test count");
    assert.ok(written.includes("0 errors"), "should update lint");
    assert.ok(written.includes("`main`"), "should update branch");
  });

  it("skips lint update when lint is undefined", async () => {
    let written = null;
    readMock = mock.method(
      fsp,
      "readFile",
      async () => SESSION_SYNC_TEMPLATE,
    );
    writeMock = mock.method(fsp, "writeFile", async (_p, content) => {
      written = content;
    });

    const result = await mod.syncSessionState({
      tests: 500,
      pass: 497,
      fail: 0,
      skip: 3,
      lastCommit: "aaa",
      commitMsg: "msg",
      branch: "dev",
      date: "2026-03-05",
    });

    assert.equal(result, true);
    assert.ok(written.includes("0 errors"), "lint should keep old value");
  });

  it("skips commit update when lastCommit is unknown", async () => {
    let written = null;
    readMock = mock.method(
      fsp,
      "readFile",
      async () => SESSION_SYNC_TEMPLATE,
    );
    writeMock = mock.method(fsp, "writeFile", async (_p, content) => {
      written = content;
    });

    await mod.syncSessionState({
      tests: 500,
      pass: 497,
      fail: 0,
      skip: 3,
      lastCommit: "unknown",
      commitMsg: "",
      branch: "main",
      date: "2026-03-05",
    });

    assert.ok(written.includes("abc1234"), "should keep old commit");
  });

  it("skips test update when tests=0", async () => {
    let written = null;
    readMock = mock.method(
      fsp,
      "readFile",
      async () => SESSION_SYNC_TEMPLATE,
    );
    writeMock = mock.method(fsp, "writeFile", async (_p, content) => {
      written = content;
    });

    await mod.syncSessionState({
      tests: 0,
      pass: 0,
      fail: 0,
      skip: 0,
      lastCommit: "abc",
      commitMsg: "msg",
      branch: "main",
      date: "2026-03-05",
    });

    // Test count should NOT be updated
    assert.ok(written.includes("408 total"), "should keep old test count");
  });

  it("returns false on file read error", async () => {
    readMock = mock.method(fsp, "readFile", async () => {
      throw new Error("ENOENT");
    });

    const result = await mod.syncSessionState({
      tests: 500,
      pass: 500,
      fail: 0,
      skip: 0,
      lastCommit: "abc",
      commitMsg: "msg",
      branch: "main",
      date: "2026-03-05",
    });

    assert.equal(result, false);
  });

  it("returns false when no patterns match", async () => {
    readMock = mock.method(
      fsp,
      "readFile",
      async () => "# Empty file\nNothing here.\n",
    );
    writeMock = mock.method(fsp, "writeFile", async () => {});

    const result = await mod.syncSessionState({
      tests: 500,
      pass: 500,
      fail: 0,
      skip: 0,
      lastCommit: "abc",
      commitMsg: "msg",
      branch: "main",
      date: "2026-03-05",
    });

    assert.equal(result, false);
  });
});

// ── Regex pattern tests (original) ──────────────────────────────────

describe("vault-sync — syncDashboard (regex)", () => {
  let tmpDir;
  let dashPath;

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "vault-sync-"));
    dashPath = path.join(tmpDir, "Dashboard.md");
    await fsp.writeFile(dashPath, DASHBOARD_TEMPLATE, "utf-8");
  });

  it("updates test count in TESTS stat card", async () => {
    let content = await fsp.readFile(dashPath, "utf-8");
    const testsCardRe =
      /(>\s*>\s*<div[^>]*>)\d+(<\/div>\n>\s*>\s*<span[^>]*>)\d+ PASS \| \d+ FAIL \| \d+ SKIP(<\/span>)/;
    const match = content.match(testsCardRe);
    assert.ok(match, "TESTS card pattern should match template");

    content = content.replace(
      testsCardRe,
      `$1${454}$2${451} PASS | ${0} FAIL | ${3} SKIP$3`,
    );
    assert.ok(content.includes("454"));
    assert.ok(content.includes("451 PASS"));
  });

  it("updates session state table fields", async () => {
    let content = await fsp.readFile(dashPath, "utf-8");

    const sessionRe = /(\|\s*\*\*Last Session\*\*\s*\|)\s*[^|]+\|/;
    assert.ok(sessionRe.test(content));
    content = content.replace(sessionRe, "$1 2026-03-05 |");
    assert.ok(content.includes("2026-03-05"));

    const commitRe = /(\|\s*\*\*Last Commit\*\*\s*\|)\s*[^|]+\|/;
    assert.ok(commitRe.test(content));
    content = content.replace(commitRe, "$1 `xyz789` new msg |");
    assert.ok(content.includes("xyz789"));

    const testCountRe = /(\|\s*\*\*Test Count\*\*\s*\|)\s*[^|]+\|/;
    assert.ok(testCountRe.test(content));
    content = content.replace(
      testCountRe,
      "$1 454 (451 pass, 0 fail, 3 skip) |",
    );
    assert.ok(content.includes("454 (451"));
  });

  it("updates footer timestamp", async () => {
    let content = await fsp.readFile(dashPath, "utf-8");
    const footerRe =
      /(Last Synced: <strong>)\d{4}-\d{2}-\d{2}(<\/strong> \| )\d+( Tests)/;
    assert.ok(footerRe.test(content));
    content = content.replace(footerRe, "$12026-03-05$2454$3");
    assert.ok(content.includes("2026-03-05"));
    assert.ok(content.includes("454 Tests"));
  });
});

describe("vault-sync — syncSessionState (regex)", () => {
  let tmpDir;
  let ssPath;

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "vault-sync-ss-"));
    ssPath = path.join(tmpDir, "Session-Sync.md");
    await fsp.writeFile(ssPath, SESSION_SYNC_TEMPLATE, "utf-8");
  });

  it("matches session date pattern", async () => {
    const content = await fsp.readFile(ssPath, "utf-8");
    const dateRe = /(\|\s*\*\*Session Date\*\*\s*\|)\s*[^|]+\|/;
    assert.ok(dateRe.test(content));
  });

  it("matches commit pattern", async () => {
    const content = await fsp.readFile(ssPath, "utf-8");
    const commitRe = /(\|\s*\*\*Last Commit\*\*\s*\|)\s*[^|]+\|/;
    assert.ok(commitRe.test(content));
  });

  it("matches tests pattern", async () => {
    const content = await fsp.readFile(ssPath, "utf-8");
    const testsRe = /(\|\s*\*\*Tests\*\*\s*\|)\s*[^|]+\|/;
    assert.ok(testsRe.test(content));
  });

  it("matches lint pattern", async () => {
    const content = await fsp.readFile(ssPath, "utf-8");
    const lintRe = /(\|\s*\*\*Lint\*\*\s*\|)\s*[^|]+\|/;
    assert.ok(lintRe.test(content));
  });

  it("matches branch pattern", async () => {
    const content = await fsp.readFile(ssPath, "utf-8");
    const branchRe = /(\|\s*\*\*Branch\*\*\s*\|)\s*[^|]+\|/;
    assert.ok(branchRe.test(content));
  });

  it("replaces all fields correctly", async () => {
    let content = await fsp.readFile(ssPath, "utf-8");

    const replacements = [
      {
        re: /(\|\s*\*\*Session Date\*\*\s*\|)\s*[^|]+\|/,
        val: "$1 2026-03-05 |",
      },
      {
        re: /(\|\s*\*\*Last Commit\*\*\s*\|)\s*[^|]+\|/,
        val: "$1 `def456` — new commit |",
      },
      {
        re: /(\|\s*\*\*Tests\*\*\s*\|)\s*[^|]+\|/,
        val: "$1 460 total (457 pass, 0 fail, 3 skip) |",
      },
      { re: /(\|\s*\*\*Lint\*\*\s*\|)\s*[^|]+\|/, val: "$1 0 errors |" },
      {
        re: /(\|\s*\*\*Branch\*\*\s*\|)\s*[^|]+\|/,
        val: "$1 `main` |",
      },
    ];

    for (const { re, val } of replacements) {
      content = content.replace(re, val);
    }

    assert.ok(content.includes("2026-03-05"));
    assert.ok(content.includes("def456"));
    assert.ok(content.includes("460 total"));
  });
});

describe("vault-sync — parseTestOutput", () => {
  const { parseTestOutput } = require("../agent/vault-sync");

  it("parses standard Node.js test runner output", () => {
    const output = `# tests 1149\n# suites 320\n# pass 1145\n# fail 0\n# cancelled 0\n# skipped 4\n# todo 0\n# duration_ms 12345`;
    const result = parseTestOutput(output);
    assert.equal(result.tests, 1149);
    assert.equal(result.pass, 1145);
    assert.equal(result.fail, 0);
    assert.equal(result.skip, 4);
  });

  it("returns zeros for non-test output", () => {
    const result = parseTestOutput("hello world");
    assert.equal(result.tests, 0);
    assert.equal(result.pass, 0);
    assert.equal(result.fail, 0);
    assert.equal(result.skip, 0);
  });

  it("handles partial output", () => {
    const result = parseTestOutput("# tests 50\n# pass 48");
    assert.equal(result.tests, 50);
    assert.equal(result.pass, 48);
    assert.equal(result.fail, 0);
    assert.equal(result.skip, 0);
  });

  it("parses Node v25 info-symbol format", () => {
    const output = `ℹ tests 1229\nℹ suites 343\nℹ pass 1225\nℹ fail 0\nℹ cancelled 0\nℹ skipped 4\nℹ todo 0\nℹ duration_ms 166279`;
    const result = parseTestOutput(output);
    assert.equal(result.tests, 1229);
    assert.equal(result.pass, 1225);
    assert.equal(result.fail, 0);
    assert.equal(result.skip, 4);
  });
});

describe("vault-sync — parseCoverage", () => {
  const { parseCoverage } = require("../agent/vault-sync");

  it("parses coverage table output", () => {
    const output = "all files  |   94.41 |   88.52 |   86.85";
    const result = parseCoverage(output);
    assert.deepEqual(result, { lines: 94.41, branches: 88.52, functions: 86.85 });
  });

  it("returns null for non-coverage output", () => {
    assert.equal(parseCoverage("no coverage here"), null);
  });
});

describe("vault-sync — checkboxStatus", () => {
  const { checkboxStatus } = require("../agent/vault-sync");

  it("returns DONE when all checked", () => {
    assert.equal(checkboxStatus("- [x] a\n- [x] b\n- [x] c"), "DONE");
  });

  it("returns IN PROGRESS when partial", () => {
    assert.equal(checkboxStatus("- [x] a\n- [ ] b\n- [ ] c"), "IN PROGRESS");
  });

  it("returns Planned when none checked", () => {
    assert.equal(checkboxStatus("- [ ] a\n- [ ] b"), "Planned");
  });

  it("returns Planned when no checkboxes", () => {
    assert.equal(checkboxStatus("no checkboxes here"), "Planned");
  });
});

describe("vault-sync — parsePhaseStatus", () => {
  const { parsePhaseStatus } = require("../agent/vault-sync");

  it("parses simple phases as DONE", () => {
    const content = `## Phase 1 Deliverables
- [x] item a
- [x] item b

## Phase 2 — Core Gameplay
- [x] AC-1
- [x] AC-2

## Schedule
| Phase | Duration |`;

    const phases = parsePhaseStatus(content);
    assert.equal(phases.length, 2);
    assert.equal(phases[0].id, "1");
    assert.equal(phases[0].status, "DONE");
    assert.equal(phases[1].id, "2");
    assert.equal(phases[1].name, "Core Gameplay");
    assert.equal(phases[1].status, "DONE");
  });

  it("splits Phase 7 into sub-phases", () => {
    const content = `## Phase 7 — Scale & Extend (partial)

### 7.1 Mission Expansion
- [x] Week 2: Ore mining
- [ ] Week 3: Farm automation

### 7.2 Agent Enhancement
- [ ] Expand agents
- [ ] Role specialization

### 7.4 Redis Pipeline Optimization
- [x] Batch operations
- [x] Optimistic locking

## Schedule
done`;

    const phases = parsePhaseStatus(content);
    assert.equal(phases.length, 3);
    assert.equal(phases[0].id, "7.1");
    assert.equal(phases[0].status, "IN PROGRESS");
    assert.equal(phases[1].id, "7.2");
    assert.equal(phases[1].status, "Planned");
    assert.equal(phases[2].id, "7.4");
    assert.equal(phases[2].status, "DONE");
  });

  it("strips (NEW ...) from sub-phase names", () => {
    const content = `## Phase 7 — Scale
### 7.4 Redis Pipeline Optimization (NEW — from TXT 4.md)
- [x] done
## Schedule`;

    const phases = parsePhaseStatus(content);
    assert.equal(phases[0].name, "Redis Pipeline Optimization");
  });
});

describe("vault-sync — syncRoadmap", () => {
  let readMock, writeMock;
  const mod = require("../agent/vault-sync");

  afterEach(() => {
    if (readMock) readMock.mock.restore();
    if (writeMock) writeMock.mock.restore();
  });

  it("generates vault Roadmap.md from ROADMAP.md", async () => {
    let written = null;
    readMock = mock.method(fsp, "readFile", async () => `## Phase 1 Deliverables
- [x] item

## Phase 2 — Core Gameplay
- [x] AC-1

### 2.1 AC-1: Wood Collection (16 logs) — DONE

## Schedule`);
    writeMock = mock.method(fsp, "writeFile", async (_p, content) => {
      written = content;
    });

    const result = await mod.syncRoadmap();
    assert.equal(result, true);
    assert.ok(written);
    assert.ok(written.includes("| 1 | Foundation | DONE |"));
    assert.ok(written.includes("| 2 | Core Gameplay | DONE |"));
    assert.ok(written.includes("Auto-synced from"));
    assert.ok(written.includes("AC-1"));
  });

  it("returns false on file read error", async () => {
    readMock = mock.method(fsp, "readFile", async () => {
      throw new Error("ENOENT");
    });
    const result = await mod.syncRoadmap();
    assert.equal(result, false);
  });
});

describe("vault-sync — syncDashboard with coverage", () => {
  let readMock, writeMock;
  const mod = require("../agent/vault-sync");

  const DASHBOARD_WITH_COVERAGE = `> > [!stat] COVERAGE
> > <div style="font-size: 2em; font-weight: bold; color: #3fb950;">90%</div>
> > <span style="font-size: 0.8em; color: gray;">Lines 90.5 | Branch 85.3</span>

| **Coverage** | 90.5% lines, 85.3% branches, 80.0% functions |
| **Last Session** | 2026-03-04 |`;

  afterEach(() => {
    if (readMock) readMock.mock.restore();
    if (writeMock) writeMock.mock.restore();
  });

  it("updates coverage stat card and table", async () => {
    let written = null;
    readMock = mock.method(fsp, "readFile", async () => DASHBOARD_WITH_COVERAGE);
    writeMock = mock.method(fsp, "writeFile", async (_p, content) => {
      written = content;
    });

    const result = await mod.syncDashboard({
      tests: 0,
      pass: 0,
      fail: 0,
      skip: 0,
      lastCommit: "unknown",
      commitMsg: "",
      date: "2026-03-07",
      coverage: { lines: 94.41, branches: 88.52, functions: 86.85 },
    });

    assert.equal(result, true);
    assert.ok(written.includes("94%"), "should update coverage card percentage");
    assert.ok(written.includes("Lines 94.41 | Branch 88.52"), "should update coverage card details");
    assert.ok(
      written.includes("94.41% lines, 88.52% branches, 86.85% functions"),
      "should update coverage table",
    );
  });
});

describe("vault-sync — module exports", () => {
  it("exports all expected functions", () => {
    const mod = require("../agent/vault-sync");
    assert.equal(typeof mod.gatherStats, "function");
    assert.equal(typeof mod.syncDashboard, "function");
    assert.equal(typeof mod.syncSessionState, "function");
    assert.equal(typeof mod.syncRoadmap, "function");
    assert.equal(typeof mod.parseTestOutput, "function");
    assert.equal(typeof mod.parseCoverage, "function");
    assert.equal(typeof mod.parsePhaseStatus, "function");
    assert.equal(typeof mod.checkboxStatus, "function");
    assert.equal(typeof mod.VAULT_DIR, "string");
    assert.equal(typeof mod.DASHBOARD_PATH, "string");
    assert.equal(typeof mod.SESSION_SYNC_PATH, "string");
  });
});
