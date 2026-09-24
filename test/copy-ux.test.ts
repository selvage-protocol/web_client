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
import { abbreviateHost, displayShareLink } from '../src/browser/share.ts';
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
  it('the readout carries bullets, not the link, and the field is a real one for the hand copy', () => {
    // The link *is* the room key: it belongs on the clipboard, not on a screen. A blur was the
    // earlier attempt and a reviewer read the room id and the token straight through it, so the
    // value itself is a fixed run of bullets now (`SHARE_MASK`). The words beside it are the
    // affordance instead, and the field stays a real readonly input, because the clipboard-less
    // fallback has to be able to select what is in it.
    const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
    const style = styleOf(html);
    assert.ok(/#share\s*\{[^}]*color:\s*transparent/.test(style), 'the readout paints its value plainly');
    const states = /:(?:hover|focus|focus-visible|focus-within|active)\b|\[aria-pressed/;
    let readoutRules = 0;
    for (const [, selector = '', body = ''] of style.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/#share(?![\w-])/.test(selector)) continue;
      readoutRules += 1;
      if (!states.test(selector)) continue;
      assert.ok(
        !/color:|text-shadow:|filter:|opacity:|-webkit-text-security/.test(body),
        `a hover or focus state reveals the readout: ${selector.trim()} { ${body.trim()} }`,
      );
    }
    // The scan reached the readout's own rules, so a clean result means something.
    assert.ok(readoutRules > 0, 'the scan found no #share rule at all');
    assert.match(html, /<input id="share" readonly/, 'the readout is no longer a field to select');
  });

  it('nothing the readout carries names the link outside a copy in progress', () => {
    // The defect this guard is for was invisible to any style test: the field's `title` held the
    // whole invite, so resting a pointer on the pill for a second showed the room key in a native
    // tooltip. The value and every attribute are checked, not the paint.
    const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
    const main = readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8');
    const shareTag = /<input id="share"[^>]*>/.exec(html)?.[0] ?? '';
    assert.ok(shareTag !== '', 'the readout is not in the shell');
    assert.ok(!/\btitle=/.test(shareTag), 'the readout carries a title in the shell');
    // The full link is never written to the readout outside the fallback: the only two assignments
    // to `shareInput.value` on the page are the mask and the empty state a leave leaves behind, and
    // `shareInput.title` is not assigned at all.
    const valueWrites = [...main.matchAll(/shareInput\.value\s*=\s*([^;]+);/g)].map(([, rhs]) => rhs.trim());
    assert.deepEqual(
      valueWrites.sort(),
      ['SHARE_MASK', "''"].sort(),
      'the readout is written something other than the mask',
    );
    assert.ok(!main.includes('shareInput.title'), 'the room key is back in the readout’s title');
    assert.ok(!main.includes('shareInput.setAttribute'), 'the room key rides an attribute of the readout');
    assert.ok(!/shareGroup\.(?:title|dataset|setAttribute)/.test(main), 'the key rides the pill instead');
    // And the one reveal is the fallback, whose whole purpose is a person copying by hand.
    assert.match(main, /shown:\s*SHARE_MASK\b/, 'a copy hands the readout back something else');
  });
});

describe('abbreviated host', () => {
  it('short hosts show whole; long hostnames truncate in the middle', () => {
    assert.equal(abbreviateHost('edit.example'), 'edit.example');
    const long = 'a-very-long-share-hostname.example.org';
    const short = abbreviateHost(long);
    assert.ok(short.length < long.length, `nothing truncated: ${short}`);
    assert.ok(short.includes('…'), `no ellipsis: ${short}`);
    assert.ok(short.startsWith('a-very-long-'), `head lost: ${short}`);
    assert.ok(short.endsWith('example.org'), `tail lost: ${short}`);
  });

  it('the display keeps path and query while the full link stays intact', () => {
    const full = 'https://a-very-long-share-hostname.example.org/?room=r-1&token=tok';
    const shown = displayShareLink(full);
    assert.ok(shown.startsWith('https://'), `not a page link: ${shown}`);
    assert.ok(shown.includes('room=r-1') && shown.includes('token=tok'), `query lost: ${shown}`);
    assert.ok(!shown.includes('share-hostname'), `host untruncated: ${shown}`);
    assert.ok(shown.length < full.length, 'display equals the full credential');
  });

  it('the page keeps the whole link for the clipboard and shows none of it', () => {
    const main = readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8');
    assert.ok(main.includes('SHARE_MASK'), 'the bar shows the link instead of bullets');
    assert.ok(main.includes('fullShareLink'), 'the clipboard reads something other than the link');
    assert.match(main, /clipboard\.writeText\(fullShareLink\)/, 'the clipboard never gets the link');
  });

  it('the clipboard-less fallback is handed the mask to restore, not the field’s own value', () => {
    // The fallback fields the whole link in the readout and leaves it there only if the copy
    // failed, so what comes back afterwards is the mask — never read off the field, which is
    // holding the link in exactly that case.
    const main = readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8');
    assert.ok(main.includes('handCopy({'), 'the fallback is inlined again');
    assert.match(main, /shown:\s*SHARE_MASK\b/, 'the fallback restores whatever the field holds');
    assert.match(main, /shareInput\.value = SHARE_MASK/, 'nothing puts the mask in the readout at rest');
  });

  it('reveals the readout a narrow bar hides, so the hand copy has something to copy', () => {
    // Below 640 px the readout is `display: none` and the label stands in for it,
    // where `Select the link and copy it by hand.` would point at no link at all.
    const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
    assert.match(
      styleOf(html),
      /#share-group\.hand-copy #share\s*\{[^}]*display:\s*block/,
      'a failed copy leaves the phone with an instruction and no link',
    );
    assert.match(
      styleOf(html),
      /#share-group\.hand-copy \.share-label\s*\{[^}]*display:\s*none/,
      'the label stands over the link it was standing in for',
    );
    const main = readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8');
    assert.match(main, /shareGroup\.classList\.add\('hand-copy'\)/, 'the failure path reveals nothing');
    assert.match(main, /shareGroup\.classList\.remove\('hand-copy'\)/, 'the reveal is never put back');
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
  it('the invite hint is schematic and short enough to show whole', () => {
    // The field is 1rem tall type in a 24rem card: a hint carrying the whole
    // origin was 300 px wide in a 254 px field, so it read as a clipped prefix.
    const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
    const card = html.slice(html.indexOf('<div id="join" class="card-start">'), html.indexOf('id="workspace"'));
    const shown = card.slice(card.indexOf('<input id="invite"')).match(/placeholder="([^"]*)"/)?.[1] ?? '';
    assert.ok(shown.includes('?room=…&token=…'), `no schematic: ${shown}`);
    assert.ok(shown.length <= 24, `the hint would clip again: ${shown}`);
    assert.ok(!/ws:\/\//i.test(shown), `wire scheme in the example: ${shown}`);
    assert.ok(!/room=[^…]|token=[^…]/.test(shown), `literal ids in the example: ${shown}`);
    const main = readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8');
    assert.ok(!main.includes('invitePlaceholder'), 'the card still builds a hint from the origin');
  });

  it('the name field shows a real example', () => {
    const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
    const card = html.slice(html.indexOf('<div id="join" class="card-start">'), html.indexOf('id="workspace"'));
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
          () => resolveJoin(new URLSearchParams(), 'just some words', 'http://127.0.0.1:8080/'),
          () => resolveJoin(new URLSearchParams(), '  ', 'http://127.0.0.1:8080/'),
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
