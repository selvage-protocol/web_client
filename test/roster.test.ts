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
    const element = {
      tag,
      children: [],
      className: '',
      textContent: '',
      title: '',
      disabled: false,
      style: {},
      dataset: {},
      classList: { add: (name) => void element.classes.push(name) },
      classes: [],
      replaceChildren: () => void element.children.splice(0),
      append: (...nodes) => void nodes.forEach((node) => void element.children.push(node)),
      appendChild: (node) => void element.children.push(node),
      addEventListener: () => {},
      setAttribute: () => {},
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
      'This is you. There is nowhere to go to',
      "You can't follow yourself.",
      'They are not in a document yet',
    ]);
  });

  it('the self row is a roster row: swatch, name, quiet you, reasoned actions', () => {
    const { list } = render([SAM], { selfColour: '#cba6f7' });
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
    const buttons = [];
    const walk = (element) => {
      if (element.tag === 'button') buttons.push(element);
      for (const child of element.children) walk(child);
    };
    walk(self);
    assert.equal(buttons.length, 2);
    for (const button of buttons) {
      assert.equal(button.disabled, true);
      assert.ok(button.title.length > 0, 'a self action names no reason');
    }
  });

  it('peer colours stay on the swatch, data-driven', () => {
    const { list } = render([SAM]);
    const row = list.children.find((child) => child.classes.includes('peer'));
    const swatch = row.children.find((child) => child.className === 'swatch');
    assert.equal(swatch.style.backgroundColor, '#e06c75');
  });
});
