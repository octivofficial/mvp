/**
 * WorkspaceAgent Tests
 * Tests written with TDD — covering constructor, init, handleTask routing,
 * and unauthenticated guard behavior.
 * Usage: node --test test/workspace-agent.test.js
 *
 * NOTE: googleapis is NOT installed. We inject a fake module into require.cache
 * before requiring workspace-agent so the real googleapis is never loaded.
 */
'use strict';

const { describe, it, mock } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// ── Inject fake googleapis into require cache ─────────────────────────
// This must happen before any require('../agent/workspace-agent').

const fakeGoogleAuth = function (opts) {
  this.opts = opts;
};

const fakeGoogle = {
  auth: { GoogleAuth: fakeGoogleAuth },
  docs: () => ({
    documents: {
      create: async () => ({ data: { documentId: 'test-doc-id' } }),
      batchUpdate: async () => ({}),
    },
  }),
  sheets: () => ({
    spreadsheets: {
      values: { append: async () => ({}) },
    },
  }),
  drive: () => ({
    files: {
      create: async () => ({ data: { id: 'test-folder-id' } }),
    },
  }),
};

// Resolve what googleapis's path *would* be relative to workspace-agent.js
// Since it's not installed we manufacture a fake module object in the cache
// using the key that node would use.
// We override Module._resolveFilename to redirect 'googleapis' to fake module

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, opts) {
  if (request === 'googleapis') {
    return '__fake_googleapis__';
  }
  return origResolve.call(this, request, parent, isMain, opts);
};

// Insert fake module into require cache
require.cache['__fake_googleapis__'] = {
  id: '__fake_googleapis__',
  filename: '__fake_googleapis__',
  loaded: true,
  exports: { google: fakeGoogle },
  children: [],
  parent: null,
  paths: [],
};

// Now it's safe to require the agent
const { WorkspaceAgent } = require('../agent/workspace-agent');

// ── Mock Board Helper ─────────────────────────────────────────────────

function createMockBoard() {
  return {
    publish: mock.fn(async () => {}),
    createSubscriber: async () => ({ subscribe: () => {} }),
  };
}

// ── Constructor ───────────────────────────────────────────────────────

describe('WorkspaceAgent constructor', () => {
  it('initializes with auth=null', () => {
    const agent = new WorkspaceAgent();
    assert.strictEqual(agent.auth, null);
  });

  it('stores the provided config object', () => {
    const config = { foo: 'bar' };
    const agent = new WorkspaceAgent(config, null);
    assert.deepEqual(agent.config, config);
  });

  it('defaults config to {} when not provided', () => {
    const agent = new WorkspaceAgent();
    assert.deepEqual(agent.config, {});
  });

  it('initializes with correct scopes array (3 scopes)', () => {
    const agent = new WorkspaceAgent();
    assert.ok(Array.isArray(agent.scopes));
    assert.strictEqual(agent.scopes.length, 3);
    assert.ok(agent.scopes.includes('https://www.googleapis.com/auth/documents'));
    assert.ok(agent.scopes.includes('https://www.googleapis.com/auth/spreadsheets'));
    assert.ok(agent.scopes.includes('https://www.googleapis.com/auth/drive.file'));
  });

  it('stores the board reference', () => {
    const board = createMockBoard();
    const agent = new WorkspaceAgent({}, board);
    assert.strictEqual(agent.board, board);
  });

  it('accepts null board', () => {
    const agent = new WorkspaceAgent({}, null);
    assert.strictEqual(agent.board, null);
  });
});

// ── init() ────────────────────────────────────────────────────────────

describe('WorkspaceAgent init()', () => {
  it('with no env vars: auth stays null, does not throw', async () => {
    const savedJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    const savedFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;

    const agent = new WorkspaceAgent({}, null);
    await assert.doesNotReject(() => agent.init());
    assert.strictEqual(agent.auth, null);

    if (savedJson !== undefined) process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON = savedJson;
    if (savedFile !== undefined) process.env.GOOGLE_APPLICATION_CREDENTIALS = savedFile;
  });

  it('subscribes to workspace:task when board is provided', async () => {
    const savedJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    const savedFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;

    let subscribedChannel = null;
    const board = {
      publish: mock.fn(async () => {}),
      createSubscriber: async () => ({
        subscribe: (channel, _cb) => {
          subscribedChannel = channel;
        },
      }),
    };

    const agent = new WorkspaceAgent({}, board);
    await agent.init();
    assert.strictEqual(subscribedChannel, 'workspace:task');

    if (savedJson !== undefined) process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON = savedJson;
    if (savedFile !== undefined) process.env.GOOGLE_APPLICATION_CREDENTIALS = savedFile;
  });

  it('does not subscribe or throw when board is null', async () => {
    const savedJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    const savedFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;

    const agent = new WorkspaceAgent({}, null);
    await assert.doesNotReject(() => agent.init());

    if (savedJson !== undefined) process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON = savedJson;
    if (savedFile !== undefined) process.env.GOOGLE_APPLICATION_CREDENTIALS = savedFile;
  });
});

// ── handleTask routing ────────────────────────────────────────────────

describe('WorkspaceAgent handleTask routing', () => {
  it('export_prd: calls exportToDoc and publishes to workspace:finished', async () => {
    const board = createMockBoard();
    const agent = new WorkspaceAgent({}, board);

    agent.exportToDoc = mock.fn(async () => ({
      docUrl: 'http://doc',
      documentId: 'doc-1',
      status: 'success',
    }));

    await agent.handleTask({ action: 'export_prd', taskId: 'task-42', title: 'My PRD', content: 'stuff' });

    assert.strictEqual(agent.exportToDoc.mock.calls.length, 1);
    assert.strictEqual(board.publish.mock.calls.length, 1);

    const [channel, payload] = board.publish.mock.calls[0].arguments;
    assert.strictEqual(channel, 'workspace:finished');
    assert.strictEqual(payload.taskId, 'task-42');
    assert.strictEqual(payload.status, 'success');
    assert.strictEqual(payload.documentId, 'doc-1');
  });

  it('export_prd: publishes result that includes taskId from task data', async () => {
    const board = createMockBoard();
    const agent = new WorkspaceAgent({}, board);

    agent.exportToDoc = mock.fn(async () => ({
      docUrl: 'http://doc',
      documentId: 'doc-99',
      status: 'success',
    }));

    await agent.handleTask({ action: 'export_prd', taskId: 'my-unique-task-id' });

    const [, payload] = board.publish.mock.calls[0].arguments;
    assert.strictEqual(payload.taskId, 'my-unique-task-id');
  });

  it('create_folder: calls createFolder and publishes to workspace:finished', async () => {
    const board = createMockBoard();
    const agent = new WorkspaceAgent({}, board);

    agent.createFolder = mock.fn(async () => ({ folderId: 'folder-xyz', status: 'success' }));

    await agent.handleTask({ action: 'create_folder', name: 'Projects', taskId: 'task-99' });

    assert.strictEqual(agent.createFolder.mock.calls.length, 1);
    assert.strictEqual(agent.createFolder.mock.calls[0].arguments[0], 'Projects');

    assert.strictEqual(board.publish.mock.calls.length, 1);
    const [channel, payload] = board.publish.mock.calls[0].arguments;
    assert.strictEqual(channel, 'workspace:finished');
    assert.strictEqual(payload.taskId, 'task-99');
    assert.strictEqual(payload.folderId, 'folder-xyz');
  });

  it('sync_status: calls syncToSheet', async () => {
    const board = createMockBoard();
    const agent = new WorkspaceAgent({}, board);

    agent.syncToSheet = mock.fn(async () => {});

    await agent.handleTask({ action: 'sync_status', sheetId: 'sheet-1', status: 'ok' });

    assert.strictEqual(agent.syncToSheet.mock.calls.length, 1);
  });

  it('unknown action: does not throw', async () => {
    const board = createMockBoard();
    const agent = new WorkspaceAgent({}, board);
    await assert.doesNotReject(() => agent.handleTask({ action: 'totally_unknown_action' }));
  });
});

// ── exportToDoc ───────────────────────────────────────────────────────

describe('WorkspaceAgent exportToDoc()', () => {
  it('throws Unauthenticated when auth is null', async () => {
    const agent = new WorkspaceAgent({}, null);
    assert.strictEqual(agent.auth, null);
    await assert.rejects(
      () => agent.exportToDoc({ title: 'PRD', content: 'text' }),
      (err) => {
        assert.strictEqual(err.message, 'Unauthenticated');
        return true;
      }
    );
  });
});

// ── createFolder ──────────────────────────────────────────────────────

describe('WorkspaceAgent createFolder()', () => {
  it('throws Unauthenticated when auth is null', async () => {
    const agent = new WorkspaceAgent({}, null);
    assert.strictEqual(agent.auth, null);
    await assert.rejects(
      () => agent.createFolder('MyFolder'),
      (err) => {
        assert.strictEqual(err.message, 'Unauthenticated');
        return true;
      }
    );
  });
});

// ── syncToSheet ───────────────────────────────────────────────────────

describe('WorkspaceAgent syncToSheet()', () => {
  it('returns early without throwing when auth is null', async () => {
    const agent = new WorkspaceAgent({}, null);
    assert.strictEqual(agent.auth, null);
    await assert.doesNotReject(() => agent.syncToSheet({ sheetId: 'sheet-1', status: 'ok' }));
  });

  it('returns early without throwing when sheetId is missing', async () => {
    const agent = new WorkspaceAgent({}, null);
    // auth=null and no sheetId — both guard conditions trigger early return
    await assert.doesNotReject(() => agent.syncToSheet({ status: 'ok' }));
  });
});
