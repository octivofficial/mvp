---
name: obsidian-vault-operations
description: Obsidian vault sync and management for the Octiv command center. Keeps Dashboard.md and Session-Sync.md current, manages reasoning traces, stores NotebookLM knowledge, and provides advanced vault operations.
---

# Obsidian Vault Operations

Complete vault management for the Octiv command center — Dashboard sync, Session state tracking, reasoning trace cleanup, NotebookLM integration, and Dataview query generation.

## When to Use
- Session start: verify vault state matches reality
- Session end: sync Dashboard.md and Session-Sync.md
- After major milestone: update Roadmap, Architecture notes
- When querying NotebookLM: save responses to vault
- When reasoning traces accumulate: cleanup stale files
- Creating Dataview queries for skill dashboards
- Validating vault health and consistency

## Vault Location
`/Users/octiv/Octiv_MVP/vault/` (gitignored, local only)

## Vault Structure
```
vault/
├── 00-Meta/
│   ├── Dashboard.md          # System overview, live stats
│   └── Session-Sync.md        # Real-time session state
├── 01-Projects/
│   └── Octiv-MVP/
├── 02-Agents/
│   ├── Architecture.md
│   └── [agent-role].md
├── 03-Research/
│   └── NotebookLM/
├── 04-Skills/
│   ├── atomic/
│   ├── compound/
│   └── reasoning/             # Timestamped reasoning traces
└── 05-Live/
    └── [real-time-data].md
```

## Commands

### `vault-status`
Check vault health:
1. Count files in `vault/04-Skills/reasoning/` (should be <= 5)
2. Read `vault/Dashboard.md` test count — compare with `npm test`
3. Read `vault/Session-Sync.md` — check for stale dates
4. Report any mismatches

### `vault-sync`
Force-sync Dashboard + Session-Sync:
1. Run `npm test 2>&1 | grep -E 'tests|pass|fail' | tail -1`
2. Run `git log --oneline -1`
3. Use `agent/vault-sync.js` helpers: `syncDashboard(stats)`, `syncSessionState(session)`
4. Or manually update the markdown tables with regex patterns

### `vault-query <topic>`
Query NotebookLM and save to vault:
1. Run `ask_question.py --notebook-id <id> --question "<topic>"`
2. Format response as markdown with YAML frontmatter
3. Save to `vault/03-Research/NotebookLM/{topic-slug}.md`
4. Add wikilinks to related vault notes

### `vault-cleanup`
Clean stale data:
1. Delete timestamped reasoning files: `rm vault/04-Skills/reasoning/*_2026-*.md`
2. Check for stale notes (session date > 7 days old)
3. Verify Dataview field names match frontmatter (successRate not success_rate)

## Dashboard.md Auto-Update Patterns

The `agent/vault-sync.js` module uses these regex patterns:

### TESTS stat card
```regex
/(>\s*>\s*<div[^>]*>)\d+(<\/div>...)\d+ PASS \| \d+ FAIL \| \d+ SKIP/
```

### Session State table
```regex
/(\|\s*\*\*Last Session\*\*\s*\|)\s*[^|]+\|/
/(\|\s*\*\*Last Commit\*\*\s*\|)\s*[^|]+\|/
/(\|\s*\*\*Test Count\*\*\s*\|)\s*[^|]+\|/
```

### Footer
```regex
/(Last Synced: <strong>)\d{4}-\d{2}-\d{2}(<\/strong> \| )\d+( Tests)/
```

## Dataview Compatibility

Skill vault notes use camelCase frontmatter (from `skill-zettelkasten.js`):
- `successRate` (not `success_rate`)
- `error_type`, `compound_of`, `digest_count` — snake_case (historic)

Dataview queries in `Skill-Dashboard.md` must match these field names exactly.

## NotebookLM Knowledge Note Template

```yaml
---
source: notebooklm
notebook: "1기 Master Blueprint"
query: "How should agents coordinate?"
date: 2026-03-05
tags: [research, agents, coordination]
---

# Agent Coordination

> Gemini response with citations...

## Links
- [[02-Agents/Architecture]]
- [[04-Skills/atomic/buildShelter]]
```


## Advanced Operations

### `vault-health-check`
Comprehensive vault health validation:
1. Check file count in `vault/04-Skills/reasoning/` (should be <= 5)
2. Verify Dashboard.md test count matches `npm test` output
3. Check Session-Sync.md for stale dates (> 7 days)
4. Validate Dataview field names (camelCase vs snake_case)
5. Check for broken wikilinks
6. Report any inconsistencies

```bash
# Implementation
node -e "
const { gatherStats, syncDashboard } = require('./agent/vault-sync');
const stats = gatherStats();
console.log('Vault Health:', stats);
"
```

### `vault-batch-update`
Batch update multiple vault files:
1. Read all files matching pattern
2. Apply regex transformations
3. Validate changes
4. Write back atomically

```javascript
const fs = require('fs');
const path = require('path');

async function batchUpdateVault(pattern, transform) {
  const vaultPath = '/Users/octiv/Octiv_MVP/vault';
  const files = fs.readdirSync(vaultPath, { recursive: true })
    .filter(f => f.match(pattern));
  
  for (const file of files) {
    const filePath = path.join(vaultPath, file);
    const content = fs.readFileSync(filePath, 'utf8');
    const updated = transform(content);
    fs.writeFileSync(filePath, updated, 'utf8');
  }
}
```

### `vault-wikilink-generator`
Auto-generate wikilinks based on content:
1. Scan file for keywords
2. Match keywords to existing vault notes
3. Insert wikilinks at first occurrence
4. Preserve existing links

```javascript
function generateWikilinks(content, vaultIndex) {
  const keywords = extractKeywords(content);
  const links = new Map();
  
  for (const keyword of keywords) {
    const match = vaultIndex.find(note => 
      note.title.toLowerCase().includes(keyword.toLowerCase())
    );
    if (match) {
      links.set(keyword, `[[${match.path}]]`);
    }
  }
  
  // Replace first occurrence of each keyword
  let updated = content;
  for (const [keyword, link] of links) {
    const regex = new RegExp(`\\b${keyword}\\b`, 'i');
    updated = updated.replace(regex, link);
  }
  
  return updated;
}
```

### `vault-dataview-builder`
Generate Dataview queries for dashboards:

```javascript
// Skill success rate query
const skillSuccessQuery = `
\`\`\`dataview
TABLE successRate as "Success Rate", 
      digest_count as "Uses",
      error_type as "Common Error"
FROM "04-Skills/atomic"
WHERE successRate < 0.8
SORT successRate ASC
\`\`\`
`;

// Agent performance query
const agentPerformanceQuery = `
\`\`\`dataview
TABLE role, health, task, position
FROM "05-Live"
WHERE file.name CONTAINS "agent"
SORT health ASC
\`\`\`
`;

// Recent reasoning traces
const recentReasoningQuery = `
\`\`\`dataview
LIST
FROM "04-Skills/reasoning"
WHERE file.mtime > date(today) - dur(7 days)
SORT file.mtime DESC
LIMIT 10
\`\`\`
`;
```

### `vault-frontmatter-validator`
Validate YAML frontmatter consistency:

```javascript
function validateFrontmatter(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  
  if (!frontmatterMatch) {
    return { valid: false, error: 'No frontmatter found' };
  }
  
  const yaml = frontmatterMatch[1];
  const lines = yaml.split('\n');
  
  // Check for required fields
  const required = ['name', 'description', 'date'];
  const missing = required.filter(field => 
    !lines.some(line => line.startsWith(`${field}:`))
  );
  
  if (missing.length > 0) {
    return { valid: false, error: `Missing fields: ${missing.join(', ')}` };
  }
  
  // Check field name format (camelCase vs snake_case)
  const fieldNames = lines
    .filter(line => line.includes(':'))
    .map(line => line.split(':')[0].trim());
  
  const inconsistent = fieldNames.filter(name => 
    name.includes('_') && name !== name.toLowerCase()
  );
  
  if (inconsistent.length > 0) {
    return { 
      valid: false, 
      error: `Inconsistent field names: ${inconsistent.join(', ')}` 
    };
  }
  
  return { valid: true };
}
```

## Automation Hooks

### Git Commit Hook
```bash
# .git/hooks/post-commit
#!/bin/bash
node scripts/vault-sync-cli.js git
```

### Test Hook
```bash
# After npm test
npm test 2>&1 | node scripts/vault-sync-cli.js test
```

### Roadmap Edit Hook
```bash
# Watch ROADMAP.md for changes
fswatch ROADMAP.md | xargs -n1 -I{} node scripts/vault-sync-cli.js roadmap
```

## Performance Optimization

### Incremental Sync
Only update changed sections:
```javascript
function incrementalSync(filePath, updates) {
  const content = fs.readFileSync(filePath, 'utf8');
  let updated = content;
  
  for (const [pattern, replacement] of Object.entries(updates)) {
    updated = updated.replace(new RegExp(pattern), replacement);
  }
  
  if (updated !== content) {
    fs.writeFileSync(filePath, updated, 'utf8');
    return true;
  }
  
  return false;  // No changes
}
```

### Caching
Cache vault index for fast lookups:
```javascript
const vaultCache = new Map();

function getVaultIndex(force = false) {
  if (!force && vaultCache.has('index')) {
    return vaultCache.get('index');
  }
  
  const index = buildVaultIndex();
  vaultCache.set('index', index);
  return index;
}
```

## Error Recovery

### Backup Before Sync
```javascript
function backupVault() {
  const timestamp = new Date().toISOString().replace(/:/g, '-');
  const backupPath = `/Users/octiv/Octiv_MVP/vault-backups/${timestamp}`;
  
  fs.cpSync('/Users/octiv/Octiv_MVP/vault', backupPath, { recursive: true });
  return backupPath;
}
```

### Rollback on Failure
```javascript
async function safeSync(syncFn) {
  const backup = backupVault();
  
  try {
    await syncFn();
  } catch (err) {
    console.error('Sync failed, rolling back:', err.message);
    fs.rmSync('/Users/octiv/Octiv_MVP/vault', { recursive: true });
    fs.cpSync(backup, '/Users/octiv/Octiv_MVP/vault', { recursive: true });
    throw err;
  }
}
```

## Integration Examples

### Dashboard Auto-Update
```javascript
// After test run
const testOutput = execSync('npm test 2>&1').toString();
const testStats = parseTestOutput(testOutput);

await syncDashboard({
  tests: testStats.tests,
  pass: testStats.pass,
  fail: testStats.fail,
  skip: testStats.skip,
  lastCommit: execSync('git log --oneline -1').toString().trim(),
});
```

### Session State Tracking
```javascript
// On session start
await syncSessionState({
  sessionStart: new Date().toISOString(),
  agentCount: 7,
  redisStatus: 'connected',
  paperMCStatus: 'healthy',
});
```

### NotebookLM Query
```javascript
// Query and save to vault
const response = await queryNotebookLM('How should agents coordinate?');

const notePath = 'vault/03-Research/NotebookLM/agent-coordination.md';
const content = `---
source: notebooklm
notebook: "1기 Master Blueprint"
query: "How should agents coordinate?"
date: ${new Date().toISOString().split('T')[0]}
tags: [research, agents, coordination]
---

# Agent Coordination

${response}

## Links
- [[02-Agents/Architecture]]
- [[04-Skills/atomic/buildShelter]]
`;

fs.writeFileSync(notePath, content, 'utf8');
```

## Best Practices

1. **Always backup before bulk operations**
2. **Use incremental sync for performance**
3. **Validate frontmatter consistency**
4. **Cache vault index for repeated lookups**
5. **Use atomic writes (write to temp, then rename)**
6. **Log all sync operations for debugging**
7. **Test regex patterns on sample data first**
8. **Use Dataview field naming conventions (camelCase)**

## Troubleshooting

### Dashboard not updating
- Check `agent/vault-sync.js` regex patterns
- Verify Dashboard.md structure matches patterns
- Run `vault-status` to see current state

### Stale reasoning traces
- Run `vault-cleanup` to remove old files
- Check `vault/04-Skills/reasoning/` file count
- Adjust retention policy in cleanup script

### Broken wikilinks
- Run `vault-wikilink-generator` to auto-fix
- Manually verify link targets exist
- Use Obsidian's "Check for broken links" feature
