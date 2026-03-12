/**
 * Tests for KubeJSPlugin — KubeJS script wrapper for Octiv agents
 * TDD: tests written before implementation (RED phase first)
 */
const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { KubeJSPlugin } = require('../agent/kubejs-plugin');

// Helper: create a mock fs module with configurable file list
const makeFsModule = (files = ['agent_events.js', 'rewards.js']) => ({
  readdirSync: mock.fn(() => files),
});

describe('KubeJSPlugin', () => {
  describe('constructor', () => {
    it('stores default scriptsDir', () => {
      const fs = makeFsModule();
      const plugin = new KubeJSPlugin({ fsModule: fs });
      assert.equal(plugin.scriptsDir, 'server/kubejs/server_scripts');
    });

    it('stores default startupDir', () => {
      const fs = makeFsModule();
      const plugin = new KubeJSPlugin({ fsModule: fs });
      assert.equal(plugin.startupDir, 'server/kubejs/startup_scripts');
    });

    it('stores custom scriptsDir', () => {
      const fs = makeFsModule();
      const plugin = new KubeJSPlugin({ scriptsDir: 'custom/scripts', fsModule: fs });
      assert.equal(plugin.scriptsDir, 'custom/scripts');
    });

    it('stores custom startupDir', () => {
      const fs = makeFsModule();
      const plugin = new KubeJSPlugin({ startupDir: 'custom/startup', fsModule: fs });
      assert.equal(plugin.startupDir, 'custom/startup');
    });

    it('stores the injected fsModule', () => {
      const fs = makeFsModule();
      const plugin = new KubeJSPlugin({ fsModule: fs });
      assert.strictEqual(plugin.fsModule, fs);
    });
  });

  describe('listScripts()', () => {
    let plugin;
    let fs;

    beforeEach(() => {
      fs = makeFsModule(['agent_events.js', 'rewards.js', 'notes.txt']);
      plugin = new KubeJSPlugin({ fsModule: fs });
    });

    it('calls readdirSync on scriptsDir', () => {
      plugin.listScripts();
      assert.equal(fs.readdirSync.mock.calls.length, 1);
      assert.equal(fs.readdirSync.mock.calls[0].arguments[0], 'server/kubejs/server_scripts');
    });

    it('returns only .js files', () => {
      const result = plugin.listScripts();
      assert.deepEqual(result, ['agent_events.js', 'rewards.js']);
    });

    it('returns empty array when no .js files exist', () => {
      const emptyFs = makeFsModule(['readme.txt', 'config.yaml']);
      const p = new KubeJSPlugin({ fsModule: emptyFs });
      assert.deepEqual(p.listScripts(), []);
    });

    it('returns [] on readdirSync error', () => {
      const errorFs = { readdirSync: mock.fn(() => { throw new Error('ENOENT'); }) };
      const p = new KubeJSPlugin({ fsModule: errorFs });
      assert.deepEqual(p.listScripts(), []);
    });

    it('returns empty array when directory is empty', () => {
      const emptyFs = makeFsModule([]);
      const p = new KubeJSPlugin({ fsModule: emptyFs });
      assert.deepEqual(p.listScripts(), []);
    });
  });

  describe('listStartupScripts()', () => {
    let plugin;
    let fs;

    beforeEach(() => {
      fs = makeFsModule(['init.js', 'boot.js', 'notes.md']);
      plugin = new KubeJSPlugin({ fsModule: fs });
    });

    it('calls readdirSync on startupDir', () => {
      plugin.listStartupScripts();
      assert.equal(fs.readdirSync.mock.calls.length, 1);
      assert.equal(fs.readdirSync.mock.calls[0].arguments[0], 'server/kubejs/startup_scripts');
    });

    it('returns only .js files from startupDir', () => {
      const result = plugin.listStartupScripts();
      assert.deepEqual(result, ['init.js', 'boot.js']);
    });

    it('returns [] on readdirSync error', () => {
      const errorFs = { readdirSync: mock.fn(() => { throw new Error('ENOENT'); }) };
      const p = new KubeJSPlugin({ fsModule: errorFs });
      assert.deepEqual(p.listStartupScripts(), []);
    });
  });

  describe('validateScript()', () => {
    let plugin;

    beforeEach(() => {
      plugin = new KubeJSPlugin({ fsModule: makeFsModule() });
    });

    it('returns valid:true for clean script content', () => {
      const content = `
ServerEvents.blockBroken(event => {
  const player = event.player;
  if (!player) return;
});
`;
      const result = plugin.validateScript('agent_events.js', content);
      assert.equal(result.valid, true);
      assert.deepEqual(result.errors, []);
    });

    it('returns valid:false when content contains require(', () => {
      const content = `const fs = require('fs');\nconsole.log('hello');`;
      const result = plugin.validateScript('bad_script.js', content);
      assert.equal(result.valid, false);
    });

    it('includes error message for require( usage', () => {
      const content = `const path = require('path');`;
      const result = plugin.validateScript('bad_script.js', content);
      assert.ok(result.errors.length > 0, 'should have at least one error');
      assert.ok(
        result.errors.some(e => e.includes('require')),
        `expected error mentioning 'require', got: ${JSON.stringify(result.errors)}`
      );
    });

    it('returns valid:false when content contains process.', () => {
      const content = `process.exit(0);`;
      const result = plugin.validateScript('bad_script.js', content);
      assert.equal(result.valid, false);
    });

    it('includes error message for process. usage', () => {
      const content = `const env = process.env.HOME;`;
      const result = plugin.validateScript('bad_script.js', content);
      assert.ok(result.errors.length > 0, 'should have at least one error');
      assert.ok(
        result.errors.some(e => e.includes('process')),
        `expected error mentioning 'process', got: ${JSON.stringify(result.errors)}`
      );
    });

    it('collects multiple errors when both require( and process. are present', () => {
      const content = `const fs = require('fs');\nprocess.exit(1);`;
      const result = plugin.validateScript('bad_script.js', content);
      assert.equal(result.valid, false);
      assert.equal(result.errors.length, 2);
    });

    it('returns object with valid and errors properties', () => {
      const result = plugin.validateScript('any.js', '');
      assert.ok('valid' in result, 'result must have valid property');
      assert.ok('errors' in result, 'result must have errors property');
      assert.ok(Array.isArray(result.errors), 'errors must be an array');
    });

    it('valid script with KubeJS API calls passes validation', () => {
      const content = `
ServerEvents.customCommand('octiv_task_complete', event => {
  const player = event.player;
  player.give(Item.of('minecraft:diamond', 1));
});
`;
      const result = plugin.validateScript('rewards.js', content);
      assert.equal(result.valid, true);
      assert.deepEqual(result.errors, []);
    });
  });

  describe('getAgentFilter()', () => {
    let plugin;

    beforeEach(() => {
      plugin = new KubeJSPlugin({ fsModule: makeFsModule() });
    });

    it('returns the Octiv agent filter expression', () => {
      const filter = plugin.getAgentFilter();
      assert.equal(filter, "player.name.startsWith('Octiv_')");
    });

    it('returns a string', () => {
      assert.equal(typeof plugin.getAgentFilter(), 'string');
    });

    it('filter expression contains Octiv_ prefix check', () => {
      const filter = plugin.getAgentFilter();
      assert.ok(filter.includes('Octiv_'), 'filter must reference Octiv_ prefix');
    });
  });
});
