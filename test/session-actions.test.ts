import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { fetchAndSave } from '../src/browser/fetch-download.ts';
import { createInFolder } from '../src/browser/new-entry.ts';
import { DEFAULT_SAVE_SETTLE_MS } from '../src/bridge/index.ts';
import { renameSelf } from '../src/browser/rename.ts';
import { MonacoBinding, ManualTimers, dom, editor, model, workingFolder, engine as roomEngine } from './support/session-binding.ts';

const main = readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8');
const names = ['startDownload', 'openPath', 'createEntry', 'publishFolder', 'removeEntry', 'moveEntry', 'keepEmptiedFolder', 'forgetMadeFolder', 'seatSession', 'goToParticipant', 'followParticipant', 'commitRename'];
const functions = names.map((name) => {
  const start = main.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.notEqual(start, -1);
  return main.slice(start, main.indexOf('\n}', start) + 2);
}).join('\n');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function page() {
  const effects = [];
  const downloaded = [];
  const context = vm.createContext({
    binding: undefined, engine: undefined, hostFolder: undefined, republishGrant: undefined,
    menuPeerId: 'p', selfName: 'Self', selfPeerId: 'self', hostPeerId: undefined,
    renameSelf, endRename: () => effects.push('end rename'), renderMenu: () => effects.push('render menu'), saveDisplayName: () => effects.push('saved name'),
    anchorButton: () => ({ focus: () => effects.push('face focus') }),
    closeMenu: () => effects.push('close menu'), showMenu: () => effects.push('menu'),
    collapseAfterGoTo: () => effects.push('go collapse'),
    nameError: () => undefined, renameTip: () => 'tip',
    drawRoom: () => effects.push('draw room'),
    onNotice: (notice) => effects.push(`notice ${notice.kind}`),
    opening: undefined, saidFetchCosts: false, madeFolders: new Set(),
    fetchAndSave, createInFolder,
    awarenessRenewMs: () => undefined, fetchStandMs: () => 0, FETCH_COSTS_STAND_MS: 5000,
    window: { setTimeout: () => 1, localStorage: {} },
    downloadCostSentence: () => 'fetch cost', fetchingSentence: () => 'fetching',
    stillAskingSentence: () => 'pending', stillEmptySentence: () => 'empty',
    downloadSink: {}, downloadDocument: (path, text) => downloaded.push([path, text]),
    toasts: { downloaded: () => effects.push('toast') },
    announce: () => effects.push('announce'), syncGrant: () => effects.push('grant'),
    collapsePanel: () => effects.push('collapse'), sayListingCut: () => effects.push('cut'),
    failureAlert: { show: () => effects.push('failure') },
    describe: (error) => error.message, leafOf: (path) => path.split('/').at(-1),
    listingNotPublishedSentence: () => 'not published',
  });
  vm.runInContext(stripTypeScriptTypes(functions), context);
  const feedback = Object.fromEntries(['note', 'clear', 'busy', 'idle'].map((name) => [name, () => effects.push(name)]));
  return { context, effects, downloaded, feedback };
}

const turn = () => new Promise((resolve) => setImmediate(resolve));
async function until(predicate, what) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, `timed out waiting for ${what}`);
    await turn();
  }
}

function replacement(context) {
  const calls = [];
  context.binding = {
    grantListing: () => ['notes.txt'],
    hasText: () => true, text: () => 'room B secret', requestText: async () => calls.push('request B'),
    openDocument: async () => calls.push('open B'), stopFollowing: () => {},
    dropDocuments: () => calls.push('drop B'),
  };
  context.engine = { text: () => 'room B engine secret' };
  context.hostFolder = { list: async () => [], move: async () => calls.push('move B') };
  context.republishGrant = async () => calls.push('publish B');
  return calls;
}

describe('deferred actions belong to their initiating session', { timeout: 5000 }, () => {
  for (const action of ['createEntry', 'removeEntry', 'moveEntry']) {
    it(`keeps ${action} on the initiating folder through a deferred listing`, async () => {
      const app = page();
      const listing = deferred();
      const listed = deferred();
      const callsA = [];
      app.context.binding = {
        grantListing: () => ['notes.txt'], currentPath: () => undefined,
        isOpenInRoom: () => false, hasPendingWrites: () => false, dropDocuments: () => callsA.push('drop A'),
        openDocument: async () => callsA.push('open A'),
      };
      app.context.hostFolder = {
        create: async () => ({ kind: 'created', path: 'notes.txt', entry: 'file' }),
        remove: async () => ({ kind: 'removed', path: 'notes.txt', paths: ['notes.txt'] }),
        move: async () => ({ kind: 'moved', to: 'other/notes.txt', paths: ['notes.txt'] }),
        list: () => { listed.resolve(); return listing.promise; },
      };
      app.context.republishGrant = async () => callsA.push('publish A');
      const pending = app.context[action]('notes.txt', action === 'createEntry' ? 'file' : 'other');
      await listed.promise;
      const callsB = replacement(app.context);
      listing.resolve(['notes.txt']);
      await pending;
      assert.deepEqual(callsA, []);
      assert.deepEqual(callsB, []);
      assert.deepEqual(app.effects, []);
    });

    it(`finishes ${action} normally while its session is still current`, async () => {
      const app = page();
      const calls = [];
      app.context.binding = {
        grantListing: () => ['notes.txt'], currentPath: () => undefined,
        isOpenInRoom: () => false, hasPendingWrites: () => false, dropDocuments: () => calls.push('drop'),
        openDocument: async () => calls.push('open'),
      };
      app.context.hostFolder = {
        create: async () => { calls.push('create'); return { kind: 'created', path: 'notes.txt', entry: 'file' }; },
        remove: async () => { calls.push('remove'); return { kind: 'removed', path: 'notes.txt', paths: ['notes.txt'] }; },
        move: async () => { calls.push('move'); return { kind: 'moved', to: 'other/notes.txt', paths: ['notes.txt'] }; },
        list: async () => { calls.push('list'); return ['notes.txt']; },
      };
      app.context.republishGrant = async (paths) => calls.push(['publish', paths]);
      const result = await app.context[action]('notes.txt', action === 'createEntry' ? 'file' : 'other');
      assert.equal(result.kind, { createEntry: 'made', removeEntry: 'removed', moveEntry: 'moved' }[action]);
      assert.deepEqual(calls, [action.replace('Entry', ''), 'list', ['publish', ['notes.txt']], action === 'createEntry' ? 'open' : 'drop']);
      assert.ok(app.effects.includes('grant'), 'the active session did not update its tree');
    });
  }

  it('lets only the latest overlapping open update the page', async () => {
    const app = page();
    const first = deferred();
    const last = deferred();
    app.context.binding = { openDocument: (path) => path === 'first.txt' ? first.promise : last.promise };
    const pendingFirst = app.context.openPath('first.txt');
    const pendingLast = app.context.openPath('last.txt');
    last.resolve(true);
    await pendingLast;
    const before = [...app.effects];
    first.resolve(false);
    await pendingFirst;
    assert.deepEqual(app.effects, before, 'an older open updated the current page');
    assert.equal(app.context.renderedPath, 'last.txt');
  });

  it('does not clear a newer request when the same path is opened again', async () => {
    const app = page();
    const completions = [deferred(), deferred(), deferred()];
    let next = 0;
    app.context.binding = { openDocument: () => completions[next++].promise };
    const first = app.context.openPath('notes.txt');
    const middle = app.context.openPath('other.txt');
    const last = app.context.openPath('notes.txt');
    const latest = app.context.opening;
    completions[0].resolve(false);
    await first;
    assert.equal(app.context.opening, latest);
    assert.deepEqual(app.effects, []);
    completions[1].resolve(false);
    await middle;
    assert.equal(app.context.opening, latest);
    completions[2].resolve(true);
    await last;
    assert.equal(app.context.opening, undefined);
    assert.equal(app.context.renderedPath, 'notes.txt');
    assert.deepEqual(app.effects, ['grant', 'collapse', 'announce']);
  });

  it('does not download replacement-room text when an old fetch completes', async () => {
    const app = page();
    const fetch = deferred();
    let held = false;
    app.context.binding = { hasText: () => held, text: () => 'room A text', requestText: () => fetch.promise };
    app.context.engine = { text: () => 'room A engine text' };
    app.context.startDownload('notes.txt', app.feedback);
    const calls = replacement(app.context);
    const before = [...app.effects];
    held = true;
    fetch.resolve();
    await turn();
    assert.deepEqual(app.downloaded, []);
    assert.deepEqual(app.effects, before);
    assert.deepEqual(calls, []);
  });

  it('does not collapse or report into the new session after an old open completes', async () => {
    const app = page();
    const open = deferred();
    app.context.binding = { openDocument: () => open.promise };
    const pending = app.context.openPath('notes.txt');
    replacement(app.context);
    app.context.opening = 'notes.txt';
    open.resolve();
    await pending;
    assert.deepEqual(app.effects, []);
    assert.equal(app.context.opening, 'notes.txt', 'old finally cleared a successor open');
  });

  it('does not publish, open or paint a create completed after replacement', async () => {
    const app = page();
    const create = deferred();
    const callsA = [];
    app.context.binding = { openDocument: async () => callsA.push('open A') };
    app.context.hostFolder = { create: () => create.promise, list: async () => ['new.txt'] };
    app.context.republishGrant = async () => callsA.push('publish A');
    const pending = app.context.createEntry('new.txt', 'file');
    const callsB = replacement(app.context);
    create.resolve({ kind: 'created', path: 'new.txt', entry: 'file' });
    await pending;
    assert.deepEqual(callsB, []);
    assert.deepEqual(callsA, []);
    assert.deepEqual(app.effects, []);
  });

  it('does not drop successor documents after a deferred remove', async () => {
    const app = page();
    const remove = deferred();
    app.context.binding = {};
    app.context.hostFolder = { remove: () => remove.promise };
    const pending = app.context.removeEntry('notes.txt');
    const calls = replacement(app.context);
    remove.resolve({ kind: 'removed', path: 'notes.txt', paths: ['notes.txt'] });
    await pending;
    assert.deepEqual(calls, []);
    assert.deepEqual(app.effects, []);
  });

  it('does not move after a settle completes in a retired session', async () => {
    const app = page();
    const settle = deferred();
    const callsA = [];
    app.context.binding = {
      grantListing: () => ['notes.txt'], currentPath: () => 'notes.txt',
      isOpenInRoom: () => true, settle: () => settle.promise,
    };
    app.context.hostFolder = { move: async () => { callsA.push('move A'); return { kind: 'moved', to: 'other/notes.txt', paths: ['notes.txt'] }; } };
    const pending = app.context.moveEntry('notes.txt', 'other');
    const callsB = replacement(app.context);
    settle.resolve();
    await pending;
    assert.deepEqual(callsA, []);
    assert.deepEqual(callsB, []);
    assert.deepEqual(app.effects, []);
  });
});

async function seatActual(app, room = roomEngine(), folder = undefined) {
  dom();
  const timers = new ManualTimers();
  const paneEditor = editor();
  const models = [];
  const element = () => ({ hidden: false, textContent: '', href: '', dataset: {}, classList: { add() {} } });
  Object.assign(app.context, {
    sessionVisible: false, renderedPath: undefined, fullShareLink: '', selfName: 'Self',
    SHARE_MASK: 'mask', shareInput: element(), fitReadout: () => {},
    joinMessage: element(), joinPane: element(), previewPane: element(), veilPane: element(),
    sessionBar: element(), workspacePane: element(), editorHost: element(),
    editorOptionsFor: () => ({}), leaveControl: { showRole: () => {} }, treeActions: element(),
    editorStack: { create: () => paneEditor },
    MonacoBinding: class extends MonacoBinding {
      constructor(options) { super({ ...options, timers }); }
    },
    GrantTreeView: class { dispose() {} },
    releaseColours: () => {}, clearTree: () => {}, updateSessionActions: () => {},
    closeCreateForm: () => {}, hideHostCard: () => {}, closeGiveUp: () => {},
    scheduleLayout: () => {}, setSessionIdentity: () => {}, openFirst: async () => {},
    setSelfSeat: () => {}, cancelFollowCollapse: () => {},
    followingIndicator: { update: () => {} },
    connectionNote: element(), status: element(), joinCard: element(), sessionPane: element(),
    shareLink: element(), hostCard: element(), treePane: element(),
    openDirs: new Set(), touchOnly: false,
  });
  app.context.failureAlert.hide = () => {};
  await app.context.seatSession({
    monaco: { editor: {
      create: () => paneEditor, EditorOption: { scrollbar: 1, wordWrap: 2, fontSize: 3 },
      createModel: (text) => { const made = model(text); models.push(made); return made; },
    } },
    engine: room, session: room.session(), displayName: 'Self', shareLink: '',
    folder: folder === undefined ? undefined : { emptyFolders: () => [], ...folder },
  });
  return { binding: app.context.binding, timers, paneEditor, models };
}

describe('assembled page, binding and bridge retirement', { timeout: 5000 }, () => {
  for (const outcome of ['exception', 'refusal']) {
    it(`retires a real bridge remote save ${outcome} without successor notices`, async () => {
      const app = page();
      const blocked = deferred();
      const started = deferred();
      const room = roomEngine(new Map([['notes.txt', 'old']]));
      const old = await seatActual(app, room, {
        layout: () => undefined,
        write: async () => { started.resolve(); return blocked.promise; },
      });
      await old.binding.openDocument('notes.txt');
      room.remote('notes.txt', 'remote edit');
      await until(() => old.timers.hasDelay(DEFAULT_SAVE_SETTLE_MS), 'bridge autosave timer');
      old.timers.fire();
      await started.promise;
      const saveDone = old.binding.save('notes.txt').catch((error) => error);
      old.binding.dispose();
      await seatActual(app);
      app.effects.length = 0;
      if (outcome === 'exception') { blocked.reject(new Error('old folder failed')); }
      else { blocked.resolve({ kind: 'refused', sentence: 'old folder refused' }); }
      assert.ok(await saveDone instanceof Error, 'real save callers still receive the failure');
      await turn();
      assert.deepEqual(app.effects, [], 'retired bridge catch reported into the new page');
      app.context.binding.dispose();
    });
  }
});

describe('assembled bridge-armed remote saves', { timeout: 5000 }, () => {
  it('flushes an armed remote save when the binding is disposed', async () => {
    const app = page();
    const writes = [];
    let disk = 'V0';
    const room = roomEngine(new Map([['notes.txt', disk]]));
    const seated = await seatActual(app, room, {
      layout: () => undefined,
      write: async (_path, text) => { writes.push(text); disk = text; return { kind: 'written' }; },
    });
    await seated.binding.openDocument('notes.txt');
    room.remote('notes.txt', 'remote edit');
    await until(() => seated.timers.hasDelay(DEFAULT_SAVE_SETTLE_MS), 'bridge autosave timer');
    seated.binding.dispose();
    await turn();
    assert.deepEqual(writes, ['remote edit'], 'an armed remote save was dropped with the bridge');
    assert.equal(disk, 'remote edit');
  });

  it('writes an armed remote save before a move copies the disk', async () => {
    const app = page();
    const order = [];
    let disk = 'V0';
    let copied;
    const room = roomEngine(new Map([['notes.txt', disk]]));
    const seated = await seatActual(app, room, {
      layout: () => undefined,
      write: async (_path, text) => { order.push(`write:${text}`); disk = text; return { kind: 'written' }; },
      move: async () => { order.push('move'); copied = disk; return { kind: 'moved', to: 'other/notes.txt', paths: ['notes.txt'] }; },
      list: async () => ['other/notes.txt'],
    });
    await seated.binding.openDocument('notes.txt');
    room.remote('notes.txt', 'remote edit');
    await until(() => seated.timers.hasDelay(DEFAULT_SAVE_SETTLE_MS), 'bridge autosave timer');
    const move = app.context.moveEntry('notes.txt', 'other');
    assert.equal((await move).kind, 'moved');
    assert.equal(copied, 'remote edit', 'the move copied disk ahead of the armed remote save');
    assert.deepEqual(order, ['write:remote edit', 'move'], 'the move ran before the remote save landed');
    seated.binding.dispose();
  });
});

function navigatingRoom(blocks, peerPath = 'b.txt') {
  const room = roomEngine(new Map([['a.txt', 'A'], ['b.txt', 'B']]));
  const open = room.open;
  room.openDocuments = () => [];
  room.open = async (path) => { await blocks.get(path)?.promise; await open(path); };
  room.peers = () => [{ peer_id: 'p', display_name: 'Peer', role: 'guest' }];
  room.presence = () => [{ peer: room.peers()[0], state: { path: peerPath } }];
  return room;
}

describe('assembled deferred participant and rename actions', { timeout: 5000 }, () => {
  for (const action of ['goToParticipant', 'followParticipant']) {
    for (const failed of [false, true]) {
      it(`keeps retired ${action} ${failed ? 'failure' : 'completion'} off the successor page`, async () => {
        const app = page();
        const blocked = deferred();
        const room = navigatingRoom(new Map([['b.txt', blocked]]));
        const old = await seatActual(app, room);
        app.context[action]('p');
        old.binding.dispose();
        await seatActual(app);
        app.effects.length = 0;
        if (failed) { blocked.reject(new Error('old open failed')); }
        else { blocked.resolve(); }
        await turn();
        assert.deepEqual(app.effects, []);
        app.context.binding.dispose();
      });
    }
  }
  for (const failed of [false, true]) {
    it(`keeps retired rename ${failed ? 'failure' : 'success'} off the successor page and saved name`, async () => {
      const app = page();
      const blocked = deferred();
      const room = roomEngine();
      room.rename = () => blocked.promise;
      const old = await seatActual(app, room);
      const pending = app.context.commitRename('Old name');
      old.binding.dispose();
      await seatActual(app);
      app.effects.length = 0;
      if (failed) { blocked.reject(new Error('old rename failed')); }
      else { blocked.resolve(); }
      await pending;
      assert.deepEqual(app.effects, []);
      assert.equal(app.context.selfName, 'Self');
      app.context.binding.dispose();
    });
  }
});

describe('assembled page and binding navigation agreement', { timeout: 5000 }, () => {
  for (const action of ['goToParticipant', 'followParticipant']) {
    it(`does not announce an older tree open after ${action} lands elsewhere`, async () => {
      const app = page();
      const blocked = deferred();
      const seated = await seatActual(app, navigatingRoom(new Map([['a.txt', blocked]])));
      const first = app.context.openPath('a.txt');
      app.context[action]('p');
      await until(() => seated.binding.currentPath() === 'b.txt', 'participant landing');
      await turn();
      const before = [...app.effects];
      blocked.resolve();
      await first;
      assert.equal(seated.binding.currentPath(), 'b.txt');
      assert.notEqual(app.context.renderedPath, 'a.txt');
      assert.deepEqual(app.effects, before);
      seated.binding.dispose();
    });

    it(`does not land an older ${action} over a newer open in an A-B-A trace`, async () => {
      const app = page();
      const firstA = deferred();
      const room = navigatingRoom(new Map(), 'a.txt');
      const normalOpen = room.open;
      let first = true;
      room.open = async (path) => {
        if (path === 'a.txt' && first) { first = false; await firstA.promise; }
        await normalOpen(path);
      };
      const seated = await seatActual(app, room);
      app.context[action]('p');
      await app.context.openPath('b.txt');
      await app.context.openPath('a.txt');
      const before = [...app.effects];
      firstA.resolve();
      await turn();
      assert.equal(seated.binding.currentPath(), 'a.txt');
      assert.equal(app.context.renderedPath, 'a.txt');
      assert.deepEqual(app.effects, before, 'the old A landing looked current by path equality');
      seated.binding.dispose();
    });
  }
});

describe('assembled navigation failure and repeated-path identity', { timeout: 5000 }, () => {
  for (const action of ['goToParticipant', 'followParticipant']) {
    it(`allows a new A open after ${action} superseded a pending A`, async () => {
      const app = page();
      const firstA = deferred();
      const room = navigatingRoom(new Map());
      const normalOpen = room.open;
      let first = true;
      room.open = async (path) => {
        if (path === 'a.txt' && first) { first = false; await firstA.promise; }
        await normalOpen(path);
      };
      const seated = await seatActual(app, room);
      const old = app.context.openPath('a.txt');
      app.context[action]('p');
      await until(() => seated.binding.currentPath() === 'b.txt', 'B landing');
      await turn();
      await app.context.openPath('a.txt');
      assert.equal(seated.binding.currentPath(), 'a.txt', 'same-path page dedup blocked the new A');
      const before = [...app.effects];
      firstA.resolve();
      await old;
      assert.deepEqual(app.effects, before);
      seated.binding.dispose();
    });

    it(`ignores a stale open rejection after ${action} landed a newer document`, async () => {
      const app = page();
      const blocked = deferred();
      const seated = await seatActual(app, navigatingRoom(new Map([['a.txt', blocked]])));
      const old = app.context.openPath('a.txt');
      app.context[action]('p');
      await until(() => seated.binding.currentPath() === 'b.txt', 'B landing');
      await turn();
      const before = [...app.effects];
      blocked.reject(new Error('superseded open failed'));
      await old;
      assert.deepEqual(app.effects, before);
      seated.binding.dispose();
    });
  }
});

describe('assembled save prerequisites and bridge reads', { timeout: 5000 }, () => {
  it('moves only after a timer-free active write closes, copying the new disk text', async () => {
    const app = page();
    const blocked = deferred();
    const started = deferred();
    let disk = 'V0';
    let copied;
    const seated = await seatActual(app, roomEngine(new Map([['notes.txt', disk]])), {
      layout: () => undefined,
      write: async (_path, text) => { started.resolve(); await blocked.promise; disk = text; return { kind: 'written' }; },
      move: async () => { copied = disk; return { kind: 'moved', to: 'other/notes.txt', paths: ['notes.txt'] }; },
      list: async () => ['other/notes.txt'],
    });
    await seated.binding.openDocument('notes.txt');
    seated.models[0].edit('V1');
    seated.timers.fire(DEFAULT_SAVE_SETTLE_MS);
    await started.promise;
    const move = app.context.moveEntry('notes.txt', 'other');
    await turn();
    assert.equal(copied, undefined, 'move copied old disk before the outstanding save finished');
    blocked.resolve();
    assert.equal((await move).kind, 'moved');
    assert.equal(copied, 'V1');
    seated.binding.dispose();
  });

  for (const retired of [false, true]) {
    it(`${retired ? 'suppresses retired' : 'reports current'} real bridge granted-read exceptions`, async () => {
      const app = page();
      const blocked = deferred();
      const started = deferred();
      const room = roomEngine();
      const old = await seatActual(app, room, {
        read: async () => { started.resolve(); return blocked.promise; },
      });
      room.documents = () => ['unread.txt'];
      room.emit({ type: 'documentsChanged', documents: ['unread.txt'] });
      await started.promise;
      if (retired) { old.binding.dispose(); await seatActual(app); }
      app.effects.length = 0;
      blocked.reject(new Error('read failed'));
      await turn();
      assert.deepEqual(app.effects, retired ? [] : ['notice status']);
      app.context.binding.dispose();
    });
  }
});

describe('assembled explicit navigation retires old participant intent', { timeout: 5000 }, () => {
  for (const action of ['goToParticipant', 'followParticipant']) {
    it(`does not revive superseded ${action} on the next room frame`, async () => {
      const app = page();
      const blocked = deferred();
      const room = navigatingRoom(new Map([['a.txt', blocked]]), 'a.txt');
      const seated = await seatActual(app, room);
      app.context[action]('p');
      await app.context.openPath('b.txt');
      blocked.resolve();
      await turn();
      const before = [...app.effects];
      room.emit({ type: 'presenceChanged' });
      await turn();
      assert.equal(seated.binding.currentPath(), 'b.txt');
      assert.deepEqual(app.effects.filter((effect) => effect !== 'notice roster'), before.filter((effect) => effect !== 'notice roster'));
      seated.binding.dispose();
    });
  }
});

describe('assembled current actions and queued failures', { timeout: 5000 }, () => {
  for (const action of ['goToParticipant', 'followParticipant']) {
    it(`keeps queued terminal ${action} failure in its original session`, async () => {
      const app = page();
      const room = roomEngine();
      const old = await seatActual(app, room);
      room.emit({ type: 'roomGone', reason: 'room_unknown' });
      app.context[action]('p');
      old.binding.dispose();
      await seatActual(app);
      // seatSession is synchronous before its final await; the old promise catch may run during it.
      assert.equal(app.effects.includes('failure'), false);
      app.context.binding.dispose();
    });

    it(`still completes current ${action} and reports current open errors`, async () => {
      const app = page();
      const room = navigatingRoom(new Map());
      const seated = await seatActual(app, room);
      app.effects.length = 0;
      app.context[action]('p');
      await turn();
      assert.equal(seated.binding.currentPath(), 'b.txt');
      assert.ok(app.effects.includes('collapse'));
      room.open = async () => { throw new Error('current open failed'); };
      app.effects.length = 0;
      // A fresh path forces I/O rather than re-showing the already fronted model.
      room.presence = () => [{ peer: room.peers()[0], state: { path: 'unread.txt' } }];
      app.context[action]('p');
      await turn();
      assert.ok(app.effects.includes('failure'));
      seated.binding.dispose();
    });
  }

  it('still applies and remembers a current rename and reports its refusal', async () => {
    const app = page();
    const room = roomEngine();
    const calls = [];
    room.rename = async (name) => { calls.push(name); };
    const seated = await seatActual(app, room);
    app.effects.length = 0;
    await app.context.commitRename('New name');
    assert.deepEqual(calls, ['New name']);
    assert.equal(app.context.selfName, 'New name');
    assert.ok(app.effects.includes('saved name'));
    room.rename = async () => { throw new Error('rename refused'); };
    app.effects.length = 0;
    await app.context.commitRename('Refused name');
    assert.equal(app.context.selfName, 'New name');
    assert.ok(app.effects.includes('failure'));
    assert.equal(app.effects.includes('saved name'), false);
    seated.binding.dispose();
  });
});
describe('assembled aggregate folder move drains', { timeout: 5000 }, () => {
  for (const edit of ['remote', 'local']) {
    it(`revisits an already-settled sibling after ${edit} ingress while B writes`, async () => {
      const app = page();
      const started = deferred();
      const blocked = deferred();
      const paths = ['src/a.txt', 'src/b.txt'];
      const texts = new Map(paths.map((path) => [path, 'V0']));
      const disk = workingFolder(texts);
      const room = roomEngine(new Map(texts));
      room.grantedPaths = () => paths;
      await disk.folder.list();
      for (const path of paths) { assert.equal((await disk.folder.read(path)).kind, 'text'); }
      let moves = 0;
      const seated = await seatActual(app, room, {
        layout: (path) => disk.folder.layout(path),
        read: (path) => disk.folder.read(path),
        write: async (path, text) => {
          if (path === paths[1]) { started.resolve(); await blocked.promise; }
          return disk.folder.write(path, text);
        },
        move: async (from, to) => { moves++; return disk.folder.move(from, to); },
        list: () => disk.folder.list(),
      });
      app.context.openPath = async () => {};
      try {
        for (const path of paths) { await seated.binding.openDocument(path); }
        if (edit === 'local') { await seated.binding.openDocument(paths[0]); }
        for (const path of paths) { room.remote(path, 'V1'); }
        await until(() => paths.every((path) => seated.binding.text(path) === 'V1'), 'both V1 models');
        const moving = app.context.moveEntry('src', 'other');
        await started.promise;
        assert.equal(disk.files.get(paths[0]).text, 'V1', 'A must already have settled');
        assert.equal(moves, 0);
        if (edit === 'remote') { room.remote(paths[0], 'V2'); }
        else { seated.paneEditor.front().edit('V2'); }
        await until(() => seated.binding.text(paths[0]) === 'V2', 'A ingress before B drain finishes');
        blocked.resolve();
        assert.equal((await moving).kind, 'moved');
        assert.equal(disk.files.get('other/src/a.txt').text, 'V2', 'production folder copy lost the already-settled sibling edit');
        assert.equal(disk.files.get('other/src/b.txt').text, 'V1');
        assert.equal(moves, 1);
        assert.equal(seated.binding.text(paths[0]), undefined);
        assert.equal(seated.binding.text(paths[1]), undefined);
        assert.deepEqual(disk.writes, [
          [paths[0], 'V1'], [paths[1], 'V1'], [paths[0], 'V2'],
          ['other/src/a.txt', 'V2'], ['other/src/b.txt', 'V1'],
        ]);
        assert.ok(paths.every((path) => !disk.files.has(path)));
      } finally { blocked.resolve(); seated.binding.dispose(); }
    });
  }
  it('joins an active save on an already-settled sibling before production copy', async () => {
    const app = page();
    const bStarted = deferred();
    const bBlocked = deferred();
    const aStarted = deferred();
    const aBlocked = deferred();
    const paths = ['src/a.txt', 'src/b.txt'];
    const texts = new Map(paths.map((path) => [path, 'V0']));
    const disk = workingFolder(texts);
    const room = roomEngine(new Map(texts));
    room.grantedPaths = () => paths;
    await disk.folder.list();
    for (const path of paths) { await disk.folder.read(path); }
    let moves = 0;
    const seated = await seatActual(app, room, {
      layout: (path) => disk.folder.layout(path),
      read: (path) => disk.folder.read(path),
      write: async (path, text) => {
        if (path === paths[1]) { bStarted.resolve(); await bBlocked.promise; }
        if (path === paths[0] && text === 'V2') { aStarted.resolve(); await aBlocked.promise; }
        return disk.folder.write(path, text);
      },
      move: async (from, to) => { moves++; return disk.folder.move(from, to); },
      list: () => disk.folder.list(),
    });
    app.context.openPath = async () => {};
    try {
      for (const path of paths) { await seated.binding.openDocument(path); }
      for (const path of paths) { room.remote(path, 'V1'); }
      await until(() => paths.every((path) => seated.binding.text(path) === 'V1'), 'both V1 models');
      const moving = app.context.moveEntry('src', 'other');
      await bStarted.promise;
      assert.equal(disk.files.get(paths[0]).text, 'V1');
      room.remote(paths[0], 'V2');
      await until(() => seated.binding.text(paths[0]) === 'V2' && seated.timers.hasDelay(DEFAULT_SAVE_SETTLE_MS), 'A V2 bridge timer');
      seated.timers.fire();
      await aStarted.promise;
      bBlocked.resolve();
      await until(() => disk.files.get(paths[1])?.text === 'V1', 'B drain completes with A still active');
      assert.equal(moves, 0, 'copy started while an earlier sibling was still writing');
      aBlocked.resolve();
      assert.equal((await moving).kind, 'moved');
      assert.equal(disk.files.get('other/src/a.txt').text, 'V2');
      assert.equal(disk.files.get('other/src/b.txt').text, 'V1');
      assert.equal(moves, 1);
    } finally { aBlocked.resolve(); bBlocked.resolve(); seated.binding.dispose(); }
  });
  for (const outcome of ['refusal', 'exception']) {
    for (const background of [false, true]) {
      it(`aborts without copy or drop on revisited A ${outcome}${background ? ' after a background failure' : ''}, then retries identical text`, async () => {
        const app = page();
        const started = deferred();
        const blocked = deferred();
        const paths = ['src/a.txt', 'src/b.txt'];
        const texts = new Map(paths.map((path) => [path, 'V0']));
        const disk = workingFolder(texts);
        const room = roomEngine(new Map(texts));
        room.grantedPaths = () => paths;
        await disk.folder.list();
        for (const path of paths) { assert.equal((await disk.folder.read(path)).kind, 'text'); }
        const attempts = [];
        const failures = [];
        const active = new Set();
        let writable = false;
        let moves = 0;
        let publishes = 0;
        app.context.failureAlert.show = (sentence) => failures.push(sentence);
        const seated = await seatActual(app, room, {
          layout: (path) => disk.folder.layout(path),
          read: (path) => disk.folder.read(path),
          write: async (path, text) => {
            assert.equal(active.has(path), false, 'writes to one path overlapped');
            active.add(path);
            attempts.push([path, text]);
            try {
              if (path === paths[1]) { started.resolve(); await blocked.promise; }
              if (path === paths[0] && text === 'V2' && !writable) {
                if (outcome === 'exception') { throw new Error('revisited A write failed'); }
                return { kind: 'refused', sentence: 'revisited A write refused' };
              }
              return await disk.folder.write(path, text);
            } finally { active.delete(path); }
          },
          move: async (from, to) => { moves++; return disk.folder.move(from, to); },
          list: () => disk.folder.list(),
        });
        app.context.republishGrant = async () => { publishes++; };
        app.context.openPath = async () => {};
        try {
          for (const path of paths) { await seated.binding.openDocument(path); }
          for (const path of paths) { room.remote(path, 'V1'); }
          await until(() => paths.every((path) => seated.binding.text(path) === 'V1'), 'both V1 models');
          const moving = app.context.moveEntry('src', 'other');
          await started.promise;
          assert.equal(disk.files.get(paths[0]).text, 'V1');
          room.remote(paths[0], 'V2');
          await until(() => seated.binding.text(paths[0]) === 'V2' && seated.timers.hasDelay(DEFAULT_SAVE_SETTLE_MS), 'A V2 bridge ingress');
          if (background) {
            seated.timers.fire();
            await until(() => app.effects.includes('notice failure'), 'failed background A save while B is blocked');
          }
          assert.equal(moves, 0);
          blocked.resolve();
          const result = await moving;
          assert.equal(moves, 0, `a failed revisit authorized the filesystem move (${result.kind})`);
          assert.equal(result.kind, 'refused');
          assert.match(result.sentence, /revisited A write (failed|refused)/);
          assert.deepEqual(failures, [result.sentence]);
          assert.equal(publishes, 0);
          assert.equal(seated.binding.text(paths[0]), 'V2');
          assert.equal(seated.binding.text(paths[1]), 'V1');
          assert.equal(seated.binding.currentPath(), paths[1]);
          assert.ok(seated.models.every((model) => !model.isDisposed()), 'failed revisit dropped a model');
          assert.equal(disk.files.get(paths[0]).text, 'V1');
          assert.equal(disk.files.get(paths[1]).text, 'V1');
          assert.equal(disk.directories.has('other/src'), false);
          assert.deepEqual(disk.removed, []);
          assert.deepEqual(attempts.filter(([path]) => path === paths[0]), [
            [paths[0], 'V1'], ...Array.from({ length: background ? 2 : 1 }, () => [paths[0], 'V2']),
          ], 'the failed explicit revisit retried itself');
          writable = true;
          assert.equal((await app.context.moveEntry('src', 'other')).kind, 'moved');
          assert.equal(moves, 1);
          assert.equal(publishes, 1);
          assert.equal(disk.files.get('other/src/a.txt').text, 'V2');
          assert.equal(disk.files.get('other/src/b.txt').text, 'V1');
          assert.deepEqual(attempts.at(-1), [paths[0], 'V2'], 'retry did not write the identical unsaved text');
          assert.ok(paths.every((path) => !disk.files.has(path) && seated.binding.text(path) === undefined));
        } finally { blocked.resolve(); seated.binding.dispose(); }
      });
    }
  }
});

describe('assembled remote-save move drains', { timeout: 5000 }, () => {
  it('B1 includes a second remote edit arriving during the first drained write', async () => {
    const app = page();
    const started = deferred();
    const blocked = deferred();
    const writes = [];
    let disk = 'V0';
    let copied;
    const room = roomEngine(new Map([['notes.txt', disk]]));
    const seated = await seatActual(app, room, {
      layout: () => undefined,
      write: async (_path, text) => {
        writes.push(text);
        if (writes.length === 1) { started.resolve(); await blocked.promise; }
        disk = text;
        return { kind: 'written' };
      },
      move: async () => { copied = disk; return { kind: 'moved', to: 'other/notes.txt', paths: ['notes.txt'] }; },
      list: async () => ['other/notes.txt'],
    });
    try {
      await seated.binding.openDocument('notes.txt');
      room.remote('notes.txt', 'V1');
      await until(() => seated.timers.hasDelay(DEFAULT_SAVE_SETTLE_MS), 'V1 bridge timer');
      const moving = app.context.moveEntry('notes.txt', 'other');
      await started.promise;
      room.remote('notes.txt', 'V2');
      await until(() => seated.paneEditor.front()?.getValue() === 'V2', 'V2 applied to the live model');
      blocked.resolve();
      assert.equal((await moving).kind, 'moved');
      assert.equal(copied, 'V2', 'the move lost the remote edit that landed during its drain');
    } finally { blocked.resolve(); seated.binding.dispose(); }
  });
  for (const edit of ['remote', 'local']) {
    it(`B1 includes a ${edit} edit during the last follow-up of a joined active write`, async () => {
      const app = page();
      const passes = [deferred(), deferred()];
      const writes = [];
      let writing = false;
      let disk = 'V0';
      let copied;
      const room = roomEngine(new Map([['notes.txt', disk]]));
      const seated = await seatActual(app, room, {
        layout: () => undefined,
        write: async (_path, text) => {
          assert.equal(writing, false, 'folder writes overlapped');
          writing = true;
          writes.push(text);
          await passes[writes.length - 1]?.promise;
          disk = text;
          writing = false;
          return { kind: 'written' };
        },
        move: async () => { copied = disk; return { kind: 'moved', to: 'other/notes.txt', paths: ['notes.txt'] }; },
        list: async () => ['other/notes.txt'],
      });
      try {
        await seated.binding.openDocument('notes.txt');
        room.remote('notes.txt', 'V1');
        await until(() => seated.timers.hasDelay(DEFAULT_SAVE_SETTLE_MS), 'V1 bridge timer');
        seated.timers.fire();
        await until(() => writes.length === 1, 'active bridge save');
        const moving = app.context.moveEntry('notes.txt', 'other');
        room.remote('notes.txt', 'V2');
        await until(() => seated.binding.text('notes.txt') === 'V2', 'V2 during active V1');
        assert.equal(copied, undefined);
        passes[0].resolve();
        await until(() => writes.length === 2, 'V2 follow-up write');
        assert.equal(copied, undefined, 'move did not join the follow-up write');
        if (edit === 'remote') { room.remote('notes.txt', 'V3'); }
        else { seated.paneEditor.front().edit('V3'); }
        await until(() => seated.binding.text('notes.txt') === 'V3', 'V3 during last follow-up');
        passes[1].resolve();
        assert.equal((await moving).kind, 'moved');
        assert.equal(copied, 'V3', 'the move lost an edit during its last follow-up');
        assert.deepEqual(writes, ['V1', 'V2', 'V3']);
      } finally { passes.forEach((pass) => pass.resolve()); seated.binding.dispose(); }
    });
  }
  for (const outcome of ['refusal', 'exception']) {
    for (const active of [false, true]) {
      for (const path of ['notes.txt', 'src']) {
        it(`B2 refuses a ${path} move after ${active ? 'active' : 'armed'} remote save ${outcome} and retries identical text`, async () => {
          const app = page();
          const live = path === 'src' ? 'src/notes.txt' : path;
          const to = `other/${live}`;
          const blocked = deferred();
          const started = deferred();
          const writes = [];
          const failures = [];
          app.context.failureAlert.show = (sentence) => failures.push(sentence);
          let writable = false;
          let moves = 0;
          let publishes = 0;
          let disk = 'V0';
          let copied;
          const room = roomEngine(new Map([[live, disk]]));
          room.grantedPaths = () => [live];
          const seated = await seatActual(app, room, {
            layout: () => undefined,
            write: async (_path, text) => {
              writes.push(text);
              if (writes.length === 1) { started.resolve(); await blocked.promise; }
              if (!writable) {
                if (outcome === 'exception') { throw new Error('source write failed'); }
                return { kind: 'refused', sentence: 'source write refused' };
              }
              disk = text;
              return { kind: 'written' };
            },
            move: async () => { moves++; copied = disk; return { kind: 'moved', to, paths: [live] }; },
            list: async () => [to],
          });
          app.context.republishGrant = async () => { publishes++; };
          try {
            await seated.binding.openDocument(live);
            room.remote(live, 'V1');
            await until(() => seated.timers.hasDelay(DEFAULT_SAVE_SETTLE_MS), 'V1 bridge timer');
            if (active) { seated.timers.fire(); await started.promise; }
            const moving = app.context.moveEntry(path, 'other');
            await started.promise;
            const waiters = Promise.allSettled([seated.binding.save(live), seated.binding.save(live)]);
            blocked.resolve();
            const result = await moving;
            assert.equal(moves, 0, `a failed drain authorized moving the unsaved document (${result.kind})`);
            assert.equal(result.kind, 'refused');
            assert.match(result.sentence, /source write (failed|refused)/);
            assert.deepEqual(failures, [result.sentence], 'the explicit move failure was not said on its page');
            assert.equal(publishes, 0);
            assert.equal(disk, 'V0');
            assert.equal(seated.binding.text(live), 'V1');
            assert.equal(seated.binding.currentPath(), live);
            const settled = await waiters;
            assert.equal(settled.length, 2);
            assert.ok(settled.every((waiter) => waiter.status === 'rejected'));
            assert.equal(settled[0].reason, settled[1].reason, 'save waiters received different failures');
            if (active) {
              await until(() => app.effects.includes('notice failure'), 'background bridge failure report');
            }
            assert.deepEqual(writes, ['V1'], 'a refused drain retried itself');
            writable = true;
            assert.equal((await app.context.moveEntry(path, 'other')).kind, 'moved');
            assert.deepEqual(writes, ['V1', 'V1'], 'retry skipped the unchanged unsaved text');
            assert.equal(copied, 'V1');
            assert.equal(moves, 1);
            assert.equal(publishes, 1);
            assert.equal(seated.binding.text(live), undefined, 'successful move kept the old buffer');
          } finally { blocked.resolve(); seated.binding.dispose(); }
        });
      }
    }
  }
  for (const outcome of ['refusal', 'exception']) {
    it(`B2 stops a move on a joined follow-up ${outcome} and retries the latest identical text`, async () => {
      const app = page();
      const passes = [deferred(), deferred()];
      const writes = [];
      let writable = false;
      let disk = 'V0';
      let copied;
      const room = roomEngine(new Map([['notes.txt', disk]]));
      const seated = await seatActual(app, room, {
        layout: () => undefined,
        write: async (_path, text) => {
          writes.push(text);
          const pass = writes.length;
          await passes[pass - 1]?.promise;
          if (pass === 2 && !writable) {
            if (outcome === 'exception') { throw new Error('follow-up write failed'); }
            return { kind: 'refused', sentence: 'follow-up write refused' };
          }
          disk = text;
          return { kind: 'written' };
        },
        move: async () => { copied = disk; return { kind: 'moved', to: 'other/notes.txt', paths: ['notes.txt'] }; },
        list: async () => ['other/notes.txt'],
      });
      try {
        await seated.binding.openDocument('notes.txt');
        room.remote('notes.txt', 'V1');
        await until(() => seated.timers.hasDelay(DEFAULT_SAVE_SETTLE_MS), 'V1 bridge timer');
        seated.timers.fire();
        await until(() => writes.length === 1, 'active bridge save');
        const moving = app.context.moveEntry('notes.txt', 'other');
        room.remote('notes.txt', 'V2');
        await until(() => seated.binding.text('notes.txt') === 'V2', 'latest remote text');
        const waiters = Promise.allSettled([seated.binding.save('notes.txt'), seated.binding.save('notes.txt')]);
        passes[0].resolve();
        await until(() => writes.length === 2, 'latest follow-up write');
        assert.equal(copied, undefined);
        passes[1].resolve();
        assert.equal((await moving).kind, 'refused');
        assert.equal(copied, undefined, 'failed follow-up authorized moving');
        assert.equal(disk, 'V1');
        assert.equal(seated.binding.text('notes.txt'), 'V2');
        assert.ok((await waiters).every((waiter) => waiter.status === 'rejected'));
        assert.deepEqual(writes, ['V1', 'V2'], 'failed follow-up retried itself');
        writable = true;
        assert.equal((await app.context.moveEntry('notes.txt', 'other')).kind, 'moved');
        assert.equal(copied, 'V2');
        assert.deepEqual(writes, ['V1', 'V2', 'V2']);
      } finally { passes.forEach((pass) => pass.resolve()); seated.binding.dispose(); }
    });
  }
  for (const outcome of ['refusal', 'exception']) {
    it(`B2 keeps a retired explicit drain ${outcome} off the successor page`, async () => {
      const app = page();
      const blocked = deferred();
      const started = deferred();
      let moves = 0;
      const room = roomEngine(new Map([['notes.txt', 'V0']]));
      const old = await seatActual(app, room, {
        layout: () => undefined,
        write: async () => { started.resolve(); return blocked.promise; },
        move: async () => { moves++; return { kind: 'moved', to: 'other/notes.txt', paths: ['notes.txt'] }; },
      });
      try {
        await old.binding.openDocument('notes.txt');
        room.remote('notes.txt', 'V1');
        await until(() => old.timers.hasDelay(DEFAULT_SAVE_SETTLE_MS), 'remote save owed');
        const moving = app.context.moveEntry('notes.txt', 'other');
        await started.promise;
        old.binding.dispose();
        await seatActual(app);
        app.effects.length = 0;
        if (outcome === 'exception') { blocked.reject(new Error('old write failed')); }
        else { blocked.resolve({ kind: 'refused', sentence: 'old write refused' }); }
        assert.equal((await moving).kind, 'refused');
        assert.equal(moves, 0);
        assert.deepEqual(app.effects, [], 'old explicit drain failure reached the successor');
      } finally { blocked.resolve({ kind: 'written' }); app.context.binding.dispose(); }
    });
  }
});
