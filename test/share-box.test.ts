/**
 * The share box: the whole bar copies, confirms, and reverts — by mouse and
 * by keyboard.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { wireShareBox } from '../src/browser/share-box.ts';

function makeDocument() {
  function make(tag) {
    const element = {
      tag,
      children: [],
      className: '',
      textContent: '',
      title: '',
      classes: [],
      classList: {
        add: (name) => void (element.classes.includes(name) || element.classes.push(name)),
        remove: (name) => void (element.classes = element.classes.filter((known) => known !== name)),
        contains: (name) => element.classes.includes(name),
      },
      handlers: {},
      addEventListener: (type, listener) => void ((element.handlers[type] ??= []).push(listener)),
      appendChild: (node) => void element.children.push(node),
      append: (...nodes) => void nodes.forEach((node) => void element.children.push(node)),
      replaceChildren: (...nodes) => void (element.children = [...nodes]),
      fire: (type, event = {}) => void (element.handlers[type] ?? []).forEach((fn) => fn(event)),
      ownerDocument: null,
    };
    element.ownerDocument = { createElement: (childTag) => make(childTag) };
    Object.defineProperty(element, 'childNodes', { get: () => element.children });
    return element;
  }
  return { createElement: (tag) => make(tag) };
}

function textOf(element) {
  return element.children.map((child) => child.textContent || textOf(child)).join(' ');
}

function wire(overrides = {}) {
  const document = makeDocument();
  const group = document.createElement('div');
  const icon = document.createElement('span');
  icon.textContent = 'link-icon';
  const input = document.createElement('input');
  input.textContent = 'http://page/?room=r&token=t';
  group.appendChild(icon);
  group.appendChild(input);
  const calls = [];
  const scheduled = [];
  const delays = [];
  const box = wireShareBox(group, () => void calls.push('copy'), {
    schedule: (fn, ms) => {
      scheduled.push(fn);
      delays.push(ms);
    },
    ...overrides,
  });
  return { group, icon, input, calls, scheduled, delays, box };
}

describe('share box', () => {
  it('a click anywhere on the bar copies', () => {
    const { group, calls } = wire();
    group.fire('click', {});
    assert.deepEqual(calls, ['copy']);
  });

  it('Enter and Space copy; other keys are left alone', () => {
    const { group, calls } = wire();
    let prevented = 0;
    group.fire('keydown', { key: 'Enter', preventDefault: () => void (prevented += 1) });
    group.fire('keydown', { key: ' ', preventDefault: () => void (prevented += 1) });
    group.fire('keydown', { key: 'a', preventDefault: () => void (prevented += 1) });
    assert.deepEqual(calls, ['copy', 'copy']);
    assert.equal(prevented, 2);
  });

  it('the confirmation is an overlay: the link stays, then it hides', () => {
    const { group, icon, input, calls, scheduled, delays, box } = wire();
    group.fire('click', {});
    assert.deepEqual(calls, ['copy']);
    box.confirm();
    assert.ok(group.classList.contains('copied'), 'no confirmation state on the bar');
    assert.ok(/Copied/.test(textOf(group)), `no confirmation copy: ${textOf(group)}`);
    assert.ok(group.children.includes(icon), 'the morph moved the icon');
    assert.ok(group.children.includes(input), 'the morph removed the link readout');
    assert.equal(scheduled.length, 1);
    // The design's own stand: `Copied` stands 1.8 s.
    assert.deepEqual(delays, [1800], 'the confirmation stands for a guessed time');
    scheduled[0]();
    assert.ok(!group.classList.contains('copied'), 'the confirmation never reverted');
    assert.ok(group.children.includes(input), 'the link never stayed');
    const overlay = group.children.find((child) => child !== icon && child !== input);
    assert.equal(overlay?.hidden, true, 'the confirmation never hid');
  });
});
