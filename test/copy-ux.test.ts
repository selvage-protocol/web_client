/**
 * Owner batch: copy control behaviour, link privacy, abbreviated host,
 * join button presence, runtime placeholder, and the plain-words copy pass.
 *
 * Each item below failed before its fix (the morph removed the link, the
 * cursor covered the bar only, the page confirmed the copy outside the
 * control, the link
 * read in full at rest, the host showed untruncated, the button was small,
 * the placeholder was a fixed this-page example with no name example).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { wireShareBox } from '../src/browser/share-box.ts';
import { abbreviateHost, displayShareLink, invitePlaceholder } from '../src/browser/share.ts';
import { resolveJoin, validateDisplayName } from '../src/browser/join.ts';
import { describeJoinError } from '../src/browser/transport.ts';

function makeDocument() {
  function make(tag) {
    const element = {
      tag,
      children: [],
      className: '',
      textContent: '',
      title: '',
      hidden: false,
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

function styleOf(html) {
  return html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
}

function textOf(element) {
  return element.children.map((child) => child.textContent || textOf(child)).join(' ');
}

describe('copy morph stays inside the link control', () => {
  it('confirming keeps the link in place and only toggles the overlay', () => {
    const document = makeDocument();
    const group = document.createElement('div');
    const icon = document.createElement('span');
    const input = document.createElement('input');
    group.appendChild(icon);
    group.appendChild(input);
    const scheduled = [];
    const box = wireShareBox(group, () => {}, {
      schedule: (fn) => void scheduled.push(fn),
    });
    box.confirm();
    assert.ok(group.classList.contains('copied'), 'no confirmation state on the bar');
    assert.ok(group.children.includes(icon), 'the morph moved the icon');
    assert.ok(group.children.includes(input), 'the morph removed the link readout');
    const overlay = group.children.find((child) => child !== icon && child !== input);
    assert.ok(overlay && /Link copied/.test(textOf(overlay)), 'no confirmation overlay beside the link');
    assert.equal(scheduled.length, 1);
    scheduled[0]();
    assert.ok(!group.classList.contains('copied'), 'the confirmation never reverted');
    assert.ok(group.children.includes(input), 'the link never stayed');
  });
});

describe('copy cursor', () => {
  it('the bar shows pointer in every state, including the morph', () => {
    const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
    const style = styleOf(html);
    const pointerRules = [];
    const rule = /([^{}]+)\{([^{}]*)\}/g;
    let match;
    while ((match = rule.exec(style)) !== null) {
      if (/cursor:\s*pointer/.test(match[2]) && /#share-group/.test(match[1])) {
        pointerRules.push(match[1]);
      }
    }
    assert.ok(pointerRules.length > 0, 'no pointer rule on the copy control');
    const selectors = pointerRules.join(' ');
    assert.ok(/\*/.test(selectors), 'the pointer skips the controls inside the bar');
    assert.ok(/\.copied/.test(selectors), 'the pointer skips the post-copy morph');
  });
});

describe('no top-right copy sentence', () => {
  it('the page never confirms a copy outside the link control', () => {
    const main = readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8');
    assert.ok(!main.includes('invite link copied'), 'a copy sentence survives in the page');
    assert.ok(!main.includes('anyone holding it'), 'a copy sentence survives in the page');
  });
});

describe('link privacy', () => {
  it('the link is masked at rest and reads on hover or focus', () => {
    const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
    const style = styleOf(html);
    assert.ok(/#share\s*\{[^}]*color:\s*transparent/.test(style), 'the link reads in full at rest');
    assert.ok(/#share-group:hover[^{]*#share/.test(style), 'hover never reveals the link');
    assert.ok(/focus-within/.test(style), 'focus never reveals the link');
  });
});

describe('abbreviated host', () => {
  it('short hosts show whole; long tailnet names truncate in the middle', () => {
    assert.equal(abbreviateHost('edit.example'), 'edit.example');
    const long = 'lumi-raspberrypi.muskellunge-yo.ts.net';
    const short = abbreviateHost(long);
    assert.ok(short.length < long.length, `nothing truncated: ${short}`);
    assert.ok(short.includes('…'), `no ellipsis: ${short}`);
    assert.ok(short.startsWith('lumi-rasp'), `head lost: ${short}`);
    assert.ok(short.endsWith('ts.net'), `tail lost: ${short}`);
  });

  it('the display keeps path and query while the full link stays intact', () => {
    const full = 'https://lumi-raspberrypi.muskellunge-yo.ts.net/?room=r-1&token=tok';
    const shown = displayShareLink(full);
    assert.ok(shown.startsWith('https://'), `not a page link: ${shown}`);
    assert.ok(shown.includes('room=r-1') && shown.includes('token=tok'), `query lost: ${shown}`);
    assert.ok(!shown.includes('muskellunge-yo'), `host untruncated: ${shown}`);
    assert.ok(shown.length < full.length, 'display equals the full credential');
  });

  it('the page shows the short form with the full link as title and clipboard bytes', () => {
    const main = readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8');
    assert.ok(main.includes('displayShareLink'), 'the bar shows the raw credential');
    assert.ok(main.includes('shareInput.title'), 'the full link is not kept as the title');
    assert.ok(main.includes('fullShareLink'), 'the clipboard reads the display text');
  });
});

describe('join button', () => {
  it('centres its label, keeps its type below the old 1.05em, and stays the biggest control', () => {
    const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
    const style = styleOf(html);
    const buttonRule = style.match(/#join-button\s*\{[^}]*\}/);
    assert.ok(buttonRule, 'no join-button rule');
    assert.ok(/justify-content:\s*center/.test(buttonRule[0]), `Join label is not centred: ${buttonRule[0]}`);
    assert.ok(/padding:\s*0\.8/.test(buttonRule[0]), `join padding near roster size: ${buttonRule[0]}`);
    assert.ok(/font-size:\s*1em\b/.test(buttonRule[0]), `join text is not below 1.05em: ${buttonRule[0]}`);
    assert.ok(!/font-size:\s*1\.05em/.test(style), 'the oversized Join type survives');
    assert.ok(/transition:/.test(buttonRule[0]), 'no hover transition on Join');
    assert.ok(/#join-button:active/.test(style), 'no active press on Join');
  });
});

describe('placeholders', () => {
  it('the invite example is built from the real page origin, schematic only', () => {
    const shown = invitePlaceholder('https://this-host.example');
    assert.equal(shown, 'https://this-host.example/?room=…&token=…');
    assert.ok(!/ws:\/\//i.test(shown), `wire scheme in the example: ${shown}`);
    assert.ok(!/room=[^…]|token=[^…]/.test(shown), `literal ids in the example: ${shown}`);
    const main = readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8');
    assert.ok(main.includes('invitePlaceholder'), 'the card keeps a fixed example host');
  });

  it('the name field shows a real example', () => {
    const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
    const card = html.slice(html.indexOf('<div id="join">'), html.indexOf('id="workspace"'));
    assert.ok(card.includes('placeholder="Ada"'), 'no name example on the card');
  });
});

describe('plain-words copy', () => {
  it('no failure, validation or invite copy leans on an em dash', () => {
    const outputs = [
      describeJoinError(new Error('the WebSocket reported an error'), 'ws://127.0.0.1:9'),
      describeJoinError(new Error('the socket closed before it opened: 4001 x'), 'ws://h'),
      ...(() => {
        const seen = [];
        for (const fn of [
          () => validateDisplayName('   '),
          () => validateDisplayName('a'.repeat(33)),
          () => resolveJoin(new URLSearchParams(), 'just some words', 'ws://h'),
          () => resolveJoin(new URLSearchParams(), '  ', 'ws://h'),
        ]) {
          try {
            fn();
          } catch (error) {
            seen.push(error.message);
          }
        }
        return seen;
      })(),
    ];
    for (const output of outputs) {
      assert.ok(!output.includes('—'), `em dash does structural work: ${output}`);
    }
  });
});
