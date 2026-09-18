/**
 * The slow-load join card: the shell paints from inline HTML before the bundle
 * arrives, so a guest may type ahead of it — and the wiring must never blow
 * that away. Owner defect (2026-09-18): the late bundle overwrote the name
 * field with the remembered name and parked focus pre-load (Firefox: `Layout
 * was forced before the page was fully loaded`).
 */
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DISPLAY_NAME_KEY,
  initJoinCard,
} from '../src/browser/join.ts';
import type { JoinCardElements } from '../src/browser/join.ts';

function elements(over: Partial<JoinCardElements> = {}): JoinCardElements {
  return {
    inviteWrap: { hidden: true },
    inviteInput: { value: '' },
    nameInput: { value: '' },
    ...over,
  };
}

function storageWith(name: string): Pick<Storage, 'getItem'> {
  return { getItem: (key: string) => (key === DISPLAY_NAME_KEY ? name : null) };
}

const emptyStorage: Pick<Storage, 'getItem'> = { getItem: () => null };

describe('initJoinCard preserves typed state under a slow load', () => {
  it('a name typed before the bundle arrives survives the remembered-name prefill', () => {
    const els = elements({ nameInput: { value: 'typed-ahead' } });
    const target = initJoinCard(els, new URLSearchParams('room=r-1&token=tok'), storageWith('remembered'));
    assert.equal(els.nameInput.value, 'typed-ahead');
    assert.equal(target, 'name');
  });

  it('an untouched name field still prefills the remembered name', () => {
    const els = elements();
    initJoinCard(els, new URLSearchParams('room=r-1&token=tok'), storageWith('remembered'));
    assert.equal(els.nameInput.value, 'remembered');
  });

  it('an empty field with no remembered name stays empty, never undefined', () => {
    const els = elements();
    initJoinCard(els, new URLSearchParams('room=r-1&token=tok'), emptyStorage);
    assert.equal(els.nameInput.value, '');
  });

  it('a typed invite on a bare open is kept and focus goes to the name', () => {
    const els = elements({ inviteInput: { value: 'https://edit.example/?room=r-1&token=tok' } });
    const target = initJoinCard(els, new URLSearchParams(), emptyStorage);
    assert.equal(els.inviteInput.value, 'https://edit.example/?room=r-1&token=tok');
    assert.equal(target, 'name');
  });

  it('a bare open shows the paste box; a link open shows nothing but the question', () => {
    const linked = elements();
    initJoinCard(linked, new URLSearchParams('room=r-1&token=tok'), emptyStorage);
    assert.equal(linked.inviteWrap.hidden, true);

    const bare = elements();
    const target = initJoinCard(bare, new URLSearchParams(), emptyStorage);
    assert.equal(bare.inviteWrap.hidden, false);
    assert.equal(target, 'invite');
  });

  it('a room without a token is not a link', () => {
    const els = elements();
    const target = initJoinCard(els, new URLSearchParams('room=r-1'), emptyStorage);
    assert.equal(els.inviteWrap.hidden, false);
    assert.equal(target, 'invite');
  });
});

describe('join card shell in markup', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

  it('the card shell is inline HTML ahead of every script', () => {
    const firstScript = html.indexOf('<script');
    for (const marker of ['id="join-form"', 'id="name"', 'id="invite"', 'id="preview"', 'id="veil"']) {
      const at = html.indexOf(marker);
      assert.ok(at !== -1, `${marker} is not inline HTML`);
      assert.ok(at < firstScript, `${marker} renders only after a script runs`);
    }
  });

  it('the inline style carries the pre-join chrome, so first paint is styled', () => {
    const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
    for (const rule of ['#join', '#preview', '#veil', '#join-error']) {
      assert.ok(style.includes(rule), `no inline ${rule} rule: first paint is unstyled`);
    }
  });

  it('the editor stylesheet never blocks first paint', () => {
    // The noscript fallback is idle while scripting runs; strip it like the parser does.
    const live = html.replace(/<noscript>[\s\S]*?<\/noscript>/g, '');
    const tags = live.match(/<link[^>]*href="app\.css"[^>]*>/g) ?? [];
    assert.ok(tags.length > 0, 'app.css is not wired at all');
    for (const tag of tags) {
      const blocking = tag.includes('rel="stylesheet"') && !tag.includes('media=');
      assert.ok(!blocking, `app.css still loads render-blocking: ${tag}`);
    }
  });

  it('a pre-bundle guard holds early submits instead of navigating away', () => {
    const guard = html.slice(0, html.indexOf('<script type="module"'));
    assert.ok(guard.includes('__selvageJoinArmed'), 'no pre-bundle armed flag');
    assert.ok(guard.includes('__selvagePendingJoin'), 'no held-submit replay flag');
    assert.ok(guard.includes('join-form'), 'guard is not wired to the join form');
  });

  it('a held early submit answers Joining… instead of looking dead', () => {
    const guard = html.slice(0, html.indexOf('<script type="module"'));
    assert.ok(guard.includes('Joining…'), 'held submit shows no feedback');
    assert.ok(guard.includes('join-button'), 'held submit never touches the button');
  });
});

describe('join card wiring in main.ts', () => {
  const main = readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8');

  it('never assigns the name field outright', () => {
    assert.ok(!/nameInput\.value\s*=/.test(main), 'main.ts can still wipe a typed name');
  });

  it('never focuses synchronously during bundle evaluation', () => {
    // settleFocus runs past first paint, the share fallback runs on a click,
    // the editor focus runs post-join, and the rejoin card takes the paste box
    // after a session ends — never at eval.
    // Anything else is a top-level focus() forcing layout pre-load again.
    const focuses = main.match(/\w+\.focus\(\)/g) ?? [];
    assert.deepEqual(focuses.sort(), [
      'editor.focus()',
      'field.focus()',
      'inviteInput.focus()',
      'shareInput.focus()',
    ]);
  });

  it('reaches the editor stack only on join, via a dynamic import', () => {
    assert.ok(!/^import (?!type)[^\n]*from '\.\/monaco\.ts';/m.test(main), 'the editor stack still blocks card wiring');
    assert.ok(main.includes("await import('./monaco.ts')"), 'no dynamic editor load on join');
    assert.ok(main.includes('__selvageJoinArmed = true'), 'held early submits are never armed');
  });

  it('Enter joins from the card without relying on implicit submission', () => {
    assert.ok(main.includes("from './join.ts'"), 'join helpers are not wired');
    assert.ok(main.includes('joinOnEnter(event, attemptJoin)'), 'Enter never reaches the join attempt');
    assert.ok(main.includes("joinForm.addEventListener('keydown'"), 'no keydown listener on the join form');
  });

  it('a refused replay hands the card back after a held submit', () => {
    const attempt = main.slice(main.indexOf('function attemptJoin'), main.indexOf('async function join'));
    assert.ok(attempt.includes('joinButton.disabled = false'), 'refused joins never re-enable the button');
    assert.ok(attempt.includes("joinButton.textContent = 'Join'"), 'refused joins never restore the button');
  });

  it('a refused pre-flight hands the card back, not only a refused join', () => {
    // A held early submit disables the button before the bundle lands, so a
    // refusal that never left the page (a blank name, a link that names no
    // session) has to hand it back here — otherwise the only way on is Enter.
    const at = main.indexOf('function attemptJoin');
    assert.ok(at !== -1, 'no attemptJoin in main.ts');
    const attempt = main.slice(at, main.indexOf('async function runJoin', at));
    const restore = attempt.indexOf('joinButton.disabled = false');
    assert.ok(restore !== -1, 'a refused pre-flight leaves the Join button disabled');
    assert.ok(
      restore < attempt.indexOf('const outcome = joinGate.request'),
      'the restore sits on the queued path rather than on the refusal',
    );
    assert.ok(attempt.includes("joinButton.textContent = 'Join'"), 'the button label is not restored');
  });

  it('the join gate is born before the replay that uses it', () => {
    // The replay runs during this module's own evaluation: a gate declared
    // later would still be unborn (temporal dead zone), the replay would
    // throw, and the rest of the module — every listener below it — would
    // never run, leaving the card stuck at Joining… (2026-09-18).
    const armed = main.indexOf('__selvageJoinArmed = true');
    const gate = main.indexOf('const joinGate = createJoinGate');
    assert.ok(gate !== -1, 'no join gate in main.ts');
    assert.ok(armed !== -1, 'no replay arming in main.ts');
    assert.ok(gate < armed, 'the gate is declared after the replay that uses it');
  });

  it('shared-text links never navigate the page', () => {
    assert.ok(main.includes('registerLinkGuard'), 'the link guard is never registered');
    assert.ok(main.includes('StandaloneServices'), 'the guard never reaches the opener service');
    assert.ok(main.includes('IOpenerService'), 'the guard names no opener service');
  });
});
