/**
 * Roster rows: names with no path text under them, the self row, and one
 * stop control owned by the follow banner — never the roster.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { renderRoster } from '../src/browser/roster.ts';
import type { RosterPeer } from '../src/browser/roster.ts';

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
      value: '',
      maxLength: undefined,
      type: '',
      spellcheck: undefined,
      autocomplete: undefined,
      focused: false,
      disabled: false,
      style: {},
      dataset: {},
      classList: { add: (name) => void element.classes.push(name) },
      classes: [],
      replaceChildren: () => void element.children.splice(0),
      append: (...nodes) => void nodes.forEach((node) => void element.children.push(node)),
      appendChild: (node) => void element.children.push(node),
      addEventListener: (type, listener) => void ((listeners[type] ??= []).push(listener)),
      /** Fires what a real element fires, so a test drives the control it drew. */
      fire: (type, event = {}) => void (listeners[type] ?? []).forEach((run) => run(event)),
      setAttribute: (name, value) => void (attributes[name] = value),
      getAttribute: (name) => attributes[name],
      focus: () => void (element.focused = true),
    };
    elements.push(element);
    return element;
  }
  return {
    elements,
    createElement: (tag) => make(tag),
  };
}

function textOf(element) {
  return element.children.map((child) => child.textContent || textOf(child)).join(' ');
}

const SAM = { peerId: 'peer-sam', displayName: 'sam', role: 'guest', colour: '#e06c75', path: 'notes.md' };
const JO = { peerId: 'peer-jo', displayName: 'jo', role: 'host', colour: '#61afef', path: undefined };

function render(peers, overrides = {}) {
  const document = makeDocument();
  globalThis.document = document;
  const list = document.createElement('ul');
  const calls = [];
  renderRoster(list, peers, {
    followedPeerId: undefined,
    selfName: 'me',
    onGoTo: (peerId) => void calls.push(['go', peerId]),
    onFollow: (peerId) => void calls.push(['follow', peerId]),
    ...overrides,
  });
  return { list, calls, document };
}

/** Every element of a class under `element`, the row's own parts. */
function withClass(element, name) {
  const found = [];
  const walk = (node) => {
    if (node.className === name) found.push(node);
    for (const child of node.children) walk(child);
  };
  walk(element);
  return found;
}

/** Every button under an element, so a row's verbs can be read in order. */
function buttonsIn(element) {
  const found = [];
  const walk = (node) => {
    if (node.tag === 'button') found.push(node);
    for (const child of node.children) walk(child);
  };
  walk(element);
  return found;
}

/** The row whose name element carries `name`. */
function rowNamed(list, name) {
  return list.children.find((row) =>
    withClass(row, 'name').some((element) => element.textContent === name),
  );
}

describe('roster rows', () => {
  it('names the peer with no path text under it', () => {
    const { list } = render([SAM]);
    const rows = list.children.filter((child) => child.tag === 'li');
    assert.equal(rows.length, 2);
    const row = rows.find((child) => child.classes.includes('peer'));
    assert.ok(textOf(row).includes('sam'), `name missing: ${textOf(row)}`);
    assert.ok(!textOf(row).includes('notes.md'), `path text under the name: ${textOf(row)}`);
    assert.ok(!textOf(row).includes('no shared document'), `placeholder text under the name: ${textOf(row)}`);
  });

  it('marks the followed row Following with no stop of its own', () => {
    const { list } = render([SAM], { followedPeerId: 'peer-sam' });
    const row = list.children.find((child) => child.classes.includes('peer'));
    const buttons = [];
    const walk = (element) => {
      if (element.tag === 'button') buttons.push(element);
      for (const child of element.children) walk(child);
    };
    walk(row);
    assert.equal(buttons.length, 2);
    const follow = buttons[1];
    assert.ok(textOf(follow).includes('Following'), `follow toggle lost: ${textOf(follow)}`);
    assert.equal(follow.disabled, true);
    for (const button of buttons) {
      assert.ok(!/^stop\b/i.test(textOf(button).trim()), `a second stop control: ${textOf(button)}`);
    }
  });

  it('an unfollowed peer offers Go to and Follow', () => {
    const { list, calls } = render([SAM]);
    const row = list.children.find((child) => child.classes.includes('peer'));
    const buttons = [];
    const walk = (element) => {
      if (element.tag === 'button') buttons.push(element);
      for (const child of element.children) walk(child);
    };
    walk(row);
    assert.ok(textOf(buttons[0]).includes('Go to'));
    assert.ok(textOf(buttons[1]).includes('Follow'));
    assert.ok(!textOf(buttons[1]).includes('Following'));
    assert.equal(calls.length, 0);
  });

  it('Go to is unavailable while the peer is in no document, with the reason', () => {
    const { list } = render([JO]);
    const row = list.children.find((child) => child.classes.includes('peer'));
    const buttons = [];
    const walk = (element) => {
      if (element.tag === 'button') buttons.push(element);
      for (const child of element.children) walk(child);
    };
    walk(row);
    assert.equal(buttons[0].disabled, true);
    assert.ok(buttons[0].title.length > 0, 'a peer Go to is disabled with no reason');
  });

  it('keeps every disabled action reasoned, peer row and self row alike', () => {
    const { list } = render([JO, SAM]);
    const dead = [];
    const walk = (element) => {
      if (element.tag === 'button' && element.disabled) dead.push(element);
      for (const child of element.children) walk(child);
    };
    walk(list);
    assert.ok(dead.length > 0, 'nothing is disabled: the check covers nothing');
    for (const button of dead) {
      assert.ok(button.title.length > 0, `a disabled action names no reason: ${textOf(button)}`);
    }
  });

  it('says a dead verb’s reason in the row too, for the finger that cannot hover it', () => {
    const { list } = render([JO, SAM], { followedPeerId: 'peer-jo' });
    const reasons = [];
    const walk = (element) => {
      if (element.className === 'why') reasons.push(element.textContent);
      for (const child of element.children) walk(child);
    };
    walk(list);
    // The self row's two dead verbs, and the host's unavailable go-to: the same
    // sentences the `titles` carry, on screen for a phone (`#roster .why`).
    assert.deepEqual(reasons, [
      'This is you.',
      "You can't follow yourself.",
      'They have not opened a file yet.',
    ]);
  });

  it('the self row is a roster row: swatch, name, quiet you, reasoned actions', () => {
    const { list } = render([SAM], { selfColour: '#cba6f7', onRename: () => {} });
    const self = list.children[0];
    assert.ok(self.classes.includes('self'), 'self row is not first');
    assert.ok(textOf(self).includes('me'), `own name missing: ${textOf(self)}`);
    assert.ok(/you/i.test(textOf(self)), `you marker missing: ${textOf(self)}`);
    const swatch = self.children.find((child) => child.className === 'swatch');
    assert.ok(swatch !== undefined, 'self row carries no swatch');
    assert.equal(swatch.style.backgroundColor, '#cba6f7');
    const you = [];
    const walkYou = (element) => {
      if (element.className === 'you') you.push(element);
      for (const child of element.children) walkYou(child);
    };
    walkYou(self);
    assert.equal(you.length, 1);
    // Go to and Follow are dead with their reasons; the row's own third verb — the one thing
    // about this row a person can act on — is live.
    const buttons = buttonsIn(self);
    assert.equal(buttons.length, 3);
    for (const button of buttons.slice(0, 2)) {
      assert.equal(button.disabled, true);
      assert.ok(button.title.length > 0, 'a self action names no reason');
    }
    assert.equal(buttons[2].disabled, false, 'the rename control is dead');
  });

  it('marks the host, and only the host', () => {
    // The room names each seat's role (`§13.4`) and the page's own design note has the roster
    // draw it: `guest` is the room's ordinary seat, where a badge on every row but one is noise.
    const { list } = render([SAM, JO]);
    const jo = rowNamed(list, 'jo');
    const sam = rowNamed(list, 'sam');
    assert.ok(jo !== undefined && sam !== undefined, 'a peer row went missing');
    const marks = withClass(jo, 'role');
    assert.equal(marks.length, 1, 'the host row carries no marker');
    assert.equal(marks[0].textContent, 'host');
    assert.equal(withClass(sam, 'role').length, 0, 'a guest is marked as something');
  });

  it('marks the own row when this connection is the host', () => {
    // The room's peer list never carries this connection's own seat (`§13.4`), so a host alone
    // in a room has no other row that could say who is hosting.
    const { list } = render([], { selfRole: 'host' });
    const self = list.children[0];
    const marks = withClass(self, 'role');
    assert.equal(marks.length, 1, 'the own row of a host says nothing about it');
    assert.equal(marks[0].textContent, 'host');
    // A guest's own row is unmarked, and a row with no role at all is too.
    assert.equal(withClass(render([]).list.children[0], 'role').length, 0);
    assert.equal(withClass(render([], { selfRole: 'guest' }).list.children[0], 'role').length, 0);
  });

  it('your own row offers the rename control, in the shared words', () => {
    const calls = [];
    const { list } = render([SAM], { onRename: () => void calls.push('rename') });
    const self = list.children[0];
    const edit = buttonsIn(self).find((button) => textOf(button).includes('Rename'));
    assert.ok(edit !== undefined, 'the own row has no rename control');
    assert.equal(edit.title, 'Set the name other participants see', 'the intent lost its words');
    edit.fire('click');
    assert.deepEqual(calls, ['rename'], 'the control opens nothing');
    // A page with no name to change draws no control rather than a dead one.
    assert.equal(
      buttonsIn(render([SAM]).list.children[0]).length,
      2,
      'a rename control is offered with no handler',
    );
  });

  it('the open edit replaces the name with the field it is about', () => {
    const events = [];
    const { list } = render([], {
      selfName: 'me',
      onRename: () => {},
      renaming: {
        value: 'me',
        maxLength: 32,
        commit: (value) => void events.push(['commit', value]),
        cancel: () => void events.push(['cancel']),
      },
    });
    const self = list.children[0];
    const fields = withClass(self, 'rename');
    assert.equal(fields.length, 1, 'no field where the name was');
    const field = fields[0];
    assert.equal(field.tag, 'input');
    assert.equal(field.value, 'me', 'the field does not open on the current name');
    assert.equal(field.maxLength, 32, 'the field offers more than the room takes');
    assert.equal(field.getAttribute('aria-label'), 'The name other participants see');
    assert.equal(field.focused, true, 'the field the person asked for does not take focus');
    // The name is the field while the edit is open: one thing asks the question, not two.
    assert.equal(withClass(self, 'name').length, 0, 'the old name stands beside the field');
    assert.equal(
      buttonsIn(self).some((button) => textOf(button).includes('Rename')),
      false,
      'a second rename control opens a second field',
    );
    field.value = 'ada';
    field.fire('keydown', { key: 'Enter', preventDefault: () => {} });
    assert.deepEqual(events, [['commit', 'ada']], 'Enter does not send the typed name');
    field.fire('keydown', { key: 'Escape', preventDefault: () => {} });
    field.fire('blur', { relatedTarget: null });
    assert.deepEqual(events, [['commit', 'ada'], ['cancel'], ['cancel']], 'the ways out went wrong');

    // The visible pair: a field that only answers Enter is an action with no button, so a
    // confirm and a cancel stand beside it for a person who does not know the keys.
    const save = withClass(self, 'rename-save')[0];
    const cancel = withClass(self, 'rename-cancel')[0];
    assert.ok(save !== undefined && cancel !== undefined, 'the edit offers no visible confirm or cancel');
    assert.equal(save.textContent, 'Save', 'the confirm control is not named');
    assert.equal(cancel.textContent, 'Cancel', 'the cancel control is not named');
    save.fire('click');
    assert.deepEqual(events.at(-1), ['commit', 'ada'], 'the confirm control does not send the name');
    cancel.fire('click');
    assert.deepEqual(events.at(-1), ['cancel'], 'the cancel control sends something');

    // Focus moving into the edit's own controls is not leaving it: a press on Save or Cancel
    // must not have the edit cancelled out from under it first, or the press lands on nothing.
    const before = events.length;
    field.fire('blur', { relatedTarget: save });
    field.fire('blur', { relatedTarget: cancel });
    assert.equal(events.length, before, 'a press on one of the edit\u2019s own controls cancels first');
    // A browser that does not focus a button on mousedown reports no `relatedTarget` at all, so
    // the press is recorded on the way down too and the button's own click still lands.
    save.fire('mousedown');
    field.fire('blur', { relatedTarget: null });
    assert.equal(events.length, before, 'a mousedown on a control cancels the edit instead of pressing it');
    // Anywhere else is leaving it, and it dismisses exactly as Cancel does.
    field.fire('blur', { relatedTarget: null });
    assert.deepEqual(events.at(-1), ['cancel'], 'a click outside the edit does not dismiss it');
  });

  it('peer colours stay on the swatch, data-driven', () => {
    const { list } = render([SAM]);
    const row = list.children.find((child) => child.classes.includes('peer'));
    const swatch = row.children.find((child) => child.className === 'swatch');
    assert.equal(swatch.style.backgroundColor, '#e06c75');
  });
});
