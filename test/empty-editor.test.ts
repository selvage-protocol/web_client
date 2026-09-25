/**
 * The editor pane with no document in front of it (design §7).
 *
 * Each empty state names the one next act and puts the control for it where the
 * step is: a host whose folder is empty is told what sharing a file means and
 * given the two acts, a guest whose host has shared nothing is told whose room it
 * is and that nothing is loading, and either — with files to pick from — is told
 * the one act, in the same words. On a device with no hover the panel is the
 * act, because a phone keeps it shut and nothing else on screen opens it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { emptyEditorActionLabel, emptyEditorFor, renderEmptyEditor } from '../src/browser/empty-editor.ts';

/** The facts every case starts from, overridden per test. */
function facts(over = {}) {
  return { host: false, folder: '', files: 0, hostName: 'vscodium', phone: false, panelOpen: false, ...over };
}

/** Every action of the state, in the order the blocks carry them. */
function actions(state) {
  return state.blocks.flatMap((block) => block.actions);
}

describe('what the pane says with nothing open', () => {
  it('tells a host whose folder is empty what sharing means, and offers the two acts', () => {
    const state = emptyEditorFor(facts({ host: true, folder: 'demo-app' }));
    assert.equal(state.blocks.length, 1);
    const [block] = state.blocks;
    assert.equal(block.lead, 'Your folder “demo-app” is empty.');
    assert.match(block.text ?? '', /shared by name/);
    assert.match(block.text ?? '', /text reaches the room when it is opened/);
    assert.deepEqual(block.actions, ['new-file', 'copy-invite']);
  });

  it('tells either role with files to pick from the one act, in the same words', () => {
    // The two roles were told different things — a host that opening a file is what shares it, a
    // guest what opening one costs the room — and neither belongs before the first click: which
    // files the room carries is the tree beside the pane. What genuinely separates the roles is
    // the empty folder above, and that is where they part.
    const host = emptyEditorFor(facts({ host: true, folder: 'demo-app', files: 3 }));
    const guest = emptyEditorFor(facts({ files: 2 }));
    assert.deepEqual(actions(host), []);
    assert.equal(host.blocks[0].lead, undefined, 'a sentence nobody asked for leads the pane');
    assert.equal(host.blocks[0].text, 'Open a file to start editing.');
    assert.deepEqual(host, guest, 'the two roles are told the same state in different words');
    for (const block of host.blocks) {
      assert.ok(
        !/asks the host|receives it|reaches the room/i.test(block.text ?? ''),
        `the pane explains the fetch before the first click: ${block.text ?? ''}`,
      );
    }
  });

  it('names the host to a guest whose room shares nothing, and loads nothing', () => {
    const state = emptyEditorFor(facts({ hostName: 'vscodium' }));
    const [block] = state.blocks;
    assert.equal(block.lead, 'vscodium hasn\u2019t shared any files yet.');
    assert.equal(block.text, 'They\u2019ll appear in Shared as soon as the host\u2019s folder has some.');
    assert.deepEqual(block.actions, [], 'a desktop is offered an act it already has in the tree');
  });

  it('falls back to the role where the roster has not named a host yet', () => {
    assert.equal(emptyEditorFor(facts({ hostName: '' })).blocks[0].lead, 'The host hasn\u2019t shared any files yet.');
    assert.equal(emptyEditorFor(facts({ hostName: '  ' })).blocks[0].lead, 'The host hasn\u2019t shared any files yet.');
  });

  it('offers the panel on a phone, where it is shut and nothing else opens it', () => {
    // §7.6: the file strip names the panel, and the pane is the other way in.
    const guest = emptyEditorFor(facts({ files: 2, phone: true }));
    assert.deepEqual(actions(guest), ['browse-files']);
    // An empty host folder is the exception: creating is the act that state is about, and `New
    // file` opens the panel itself.
    const host = emptyEditorFor(facts({ host: true, folder: 'demo-app', phone: true }));
    assert.deepEqual(actions(host), ['new-file', 'copy-invite']);
  });

  it('offers nothing on a phone whose panel is already open', () => {
    // The other half of the same act: a phone whose room names no document opens the panel itself
    // (`main.ts`, `openFirst`), and a `Browse files` there opens what is already open — the only
    // control in the pane, doing nothing visible. The pane is a read of the room, so it says
    // nothing about the panel where the panel is already saying it.
    for (const host of [false, true]) {
      const open = emptyEditorFor(facts({ host, files: host ? 2 : 0, phone: true, panelOpen: true }));
      assert.deepEqual(
        actions(open),
        [],
        `the pane offers an act that opens the panel it is already open in (host: ${String(host)})`,
      );
    }
    // The sentence still stands: what went is the act, not the state it was about.
    const room = emptyEditorFor(facts({ files: 0, phone: true, panelOpen: true }));
    assert.match(room.blocks[0].lead ?? '', /shared any files yet/);
  });

  it('offers the peer that is already in a file, and the follow is the state it is in', () => {
    const peer = { peerId: 'peer-1', name: 'vscodium', path: 'src/main.rs' };
    const state = emptyEditorFor(facts({ files: 2, peer }));
    const block = state.blocks.at(-1);
    assert.equal(block?.text, 'vscodium is in src/main.rs');
    assert.deepEqual(block?.actions, ['go-to', 'follow']);
    assert.equal(block?.peerId, 'peer-1', 'the acts are not about the peer the line names');
    const following = emptyEditorFor(facts({ files: 2, peer, following: 'peer-1' }));
    assert.deepEqual(following.blocks.at(-1)?.actions, ['go-to', 'stop-follow']);
    // Following someone else is not this peer's state: the toggle still offers the follow.
    assert.deepEqual(
      emptyEditorFor(facts({ files: 2, peer, following: 'peer-2' })).blocks.at(-1)?.actions,
      ['go-to', 'follow'],
    );
  });
});

describe('the controls the pane draws', () => {
  function makeDocument() {
    const elements = [];
    function make(tag) {
      const listeners = {};
      const attributes = {};
      const element = {
        tag,
        children: [],
        className: '',
        textContent: '',
        title: '',
        hidden: false,
        dataset: {},
        type: '',
        classes: [],
        replaceChildren: () => void element.children.splice(0),
        append: (...nodes) => void nodes.forEach((node) => void element.children.push(node)),
        appendChild: (node) => void element.children.push(node),
        addEventListener: (type, listener) => void ((listeners[type] ??= []).push(listener)),
        fire: (type) => void (listeners[type] ?? []).forEach((run) => run({})),
        setAttribute: (name, value) => void (attributes[name] = value),
        getAttribute: (name) => attributes[name],
      };
      elements.push(element);
      return element;
    }
    return { elements, createElement: (tag) => make(tag) };
  }

  /** Every element of a class anywhere under `element`. */
  function withClass(element, name) {
    const found = [];
    const walk = (node) => {
      if (node.className === name) found.push(node);
      for (const child of node.children) walk(child);
    };
    walk(element);
    return found;
  }

  it('draws one control per action, and a press runs the action with its peer', () => {
    const document = makeDocument();
    globalThis.document = document;
    const pane = document.createElement('div');
    const ran = [];
    const peer = { peerId: 'peer-1', name: 'vscodium', path: 'src/main.rs' };
    renderEmptyEditor(
      pane,
      emptyEditorFor(facts({ host: true, folder: 'demo-app', files: 0, peer })),
      (action, peerId) => ran.push([action, peerId]),
    );
    assert.equal(pane.hidden, false);
    const buttons = [...withClass(pane, 'empty-actions')[0].children, ...withClass(pane, 'empty-actions')[1].children];
    assert.deepEqual(
      buttons.map((button) => button.textContent),
      ['New file', 'Copy invite link', 'Go to', 'Follow'],
    );
    // The one act the state is about is the one that leads.
    assert.equal(buttons[0].className, 'primary');
    assert.equal(buttons[1].className, '');
    // The follow control is the roster's toggle, in both states: a button that becomes a toggle on
    // its press is announced as one before the press too.
    assert.equal(buttons.at(-1).getAttribute('aria-pressed'), 'false');
    assert.equal(buttons.at(-2).getAttribute('aria-pressed'), undefined, 'Go to is not a toggle');
    buttons[0].fire('click');
    buttons.at(-1).fire('click');
    assert.deepEqual(ran, [
      ['new-file', undefined],
      ['follow', 'peer-1'],
    ]);
    // And pressed, it says so.
    const pressed = makeDocument();
    globalThis.document = pressed;
    const pane2 = pressed.createElement('div');
    renderEmptyEditor(
      pane2,
      emptyEditorFor(facts({ files: 2, peer, following: 'peer-1' })),
      () => {},
    );
    const toggles = [...withClass(pane2, 'empty-actions')[0].children].filter(
      (button) => button.getAttribute('aria-pressed') !== undefined,
    );
    assert.deepEqual(toggles.map((button) => [button.textContent, button.getAttribute('aria-pressed')]), [
      ['Following ✓', 'true'],
    ]);
  });

  it('takes the pane away when a document is open, and every act reads its own words', () => {
    const document = makeDocument();
    globalThis.document = document;
    const pane = document.createElement('div');
    renderEmptyEditor(pane, emptyEditorFor(facts()), () => {});
    assert.equal(pane.hidden, false);
    renderEmptyEditor(pane, undefined, () => {});
    assert.equal(pane.hidden, true);
    assert.deepEqual(pane.children, [], 'the last room’s sentences were left standing');
    for (const [action, label] of [
      ['new-file', 'New file'],
      ['copy-invite', 'Copy invite link'],
      ['browse-files', 'Browse files'],
      ['go-to', 'Go to'],
      ['follow', 'Follow'],
      ['stop-follow', 'Following ✓'],
    ]) {
      assert.equal(emptyEditorActionLabel(action), label, `the ${action} control reads something else`);
    }
  });
});
