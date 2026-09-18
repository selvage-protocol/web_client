/**
 * The join card and the session chrome after the owner's live pass.
 *
 * Four findings from the served page: the confirm button's label sat left and
 * ran large, the card was a page of prose before the one question it asks, the
 * invite link snapped into view and was still too revealing in the bar, and
 * the `#status` element was still there — the fourth time it was called out.
 * The session chrome also gets the same Mocha language as the landing page.
 *
 * Every check below failed before its change.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MonacoBinding } from '../src/browser/editor.ts';
import { peerColour } from '../src/bridge/index.ts';
import { sessionNoteSignal, hostPresent, wireFailureAlert, wireSessionNote } from '../src/browser/notice.ts';
import { displayShareLink } from '../src/browser/share.ts';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
const card = html.slice(html.indexOf('<div id="join">'), html.indexOf('id="workspace"'));

function rule(selector: string): string {
  const found = style.match(new RegExp(`${selector}\\s*\\{[^}]*\\}`));
  assert.ok(found !== null, `no ${selector} rule in the shell`);
  return found[0];
}

/** The token a page colour comes from, so the contrast checks read the CSS. */
function token(name: string): string {
  const found = style.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  assert.ok(found !== null, `no --${name} token in the shell`);
  return found[1] ?? '';
}

function luminance(hex: string): number {
  const channel = (value: number): number => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  const n = parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255)
  );
}

function contrast(foreground: string, background: string): number {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

describe('the status element is gone for good', () => {
  it('the served shell carries no element, no style and no name for it', () => {
    assert.ok(!/id="status"/.test(html), 'the status element is still in the shell');
    assert.ok(!/role="status"/.test(html), 'a status role is still in the shell');
    assert.ok(!/#status/.test(style), 'a status rule is still in the shell');
    assert.ok(!/\bstatus\b/i.test(html), 'the word status survives anywhere in the shell');
  });

  it('no browser source reads or writes it', () => {
    const hits: string[] = [];
    const base = new URL('../src/browser/', import.meta.url);
    for (const file of readdirSync(base)) {
      if (!file.endsWith('.ts')) continue;
      const text = readFileSync(new URL(file, base), 'utf8');
      for (const pattern of [
        /setStatus/,
        /statusLabel/,
        /#status/,
        /getElementById\(\s*['"]status['"]\s*\)/,
        /role="status"/,
      ]) {
        if (pattern.test(text)) hits.push(`${file} matches ${pattern}`);
      }
    }
    assert.deepEqual(hits, [], `status-line residue in src: ${hits.join('; ')}`);
  });

  it('the historical drivers name the new homes instead', () => {
    const hits: string[] = [];
    const base = new URL('../scripts/', import.meta.url);
    for (const file of readdirSync(base)) {
      if (!file.endsWith('.mjs')) continue;
      const text = readFileSync(new URL(file, base), 'utf8');
      for (const pattern of [
        /#status/,
        /setStatus/,
        // Reading the notices by the internal `status` kind is the same lost
        // surface under another name: the page routes those sentences by
        // text, to the session note and the alert, and a driver belongs on
        // the same two homes.
        /kind\s*[!=]==?\s*['"]status['"]/,
        /kind:\s*['"]status['"]/,
      ]) {
        if (pattern.test(text)) hits.push(`${file} matches ${pattern}`);
      }
    }
    assert.deepEqual(hits, [], `driver scripts still address the status line: ${hits.join(', ')}`);
  });

  it('messages with homes of their own have them in the shell', () => {
    // The note is the grace warning, not an interruption: polite, like the
    // status line it replaced — `role="status"` would put the forbidden word
    // back in the shell. The failure alert stays assertive.
    assert.ok(
      /<div id="session-note" aria-live="polite"><\/div>/.test(html),
      'no session note in the chrome',
    );
    assert.ok(!/role="alert"[^>]*session-note|session-note"[^>]*role="alert"/.test(html));
    assert.ok(/<div id="alert" role="alert"><\/div>/.test(html), 'no failure alert in the shell');
    assert.ok(style.includes('#session-note'), 'the session note is unstyled');
    assert.ok(style.includes('#alert'), 'the failure alert is unstyled');
    assert.ok(
      /#session-note:empty/.test(style) && /#alert:empty/.test(style),
      'an empty live region still paints its box',
    );
  });
});

describe('the card is the flow, not a page of prose', () => {
  it('one heading, one name field, one confirm, one paste box', () => {
    assert.match(card, /<h1>Join a shared session<\/h1>/, 'the heading is not the whole instruction');
    assert.equal((html.match(/Join a shared session/g) ?? []).length, 1, 'the heading is repeated');
    assert.ok(card.includes('id="name"'), 'no name field');
    assert.ok(card.includes('id="join-button"'), 'no confirm button');
    assert.ok(card.includes('id="invite"'), 'no paste box for a bare open');
  });

  it('the lede and the invite line are gone, inline copy and all', () => {
    assert.ok(!card.includes('lede'), 'the prose paragraph survives on the card');
    assert.ok(!card.includes('roomline'), 'the invite line survives on the card');
    assert.ok(!card.includes('This page joins a live editing session'), 'the lede copy survives');
    assert.ok(!card.includes('invited to a live session'), 'the invite line copy survives');
    assert.ok(!/\bjoinRoomline\b/.test(readFileSync(new URL('../src/browser/join.ts', import.meta.url), 'utf8')));
    const main = readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8');
    assert.ok(!main.includes('join-roomline'), 'the card wiring still reaches for the invite line');
  });

  it('keeps what the flow is pinned on: the paste schematic, the name example, Enter', () => {
    assert.ok(card.includes('placeholder="Ada"'), 'the name example left the card');
    assert.match(card, /room=…&token=…/, 'the paste schematic left the card');
    assert.ok(card.includes('id="join-form"'), 'no form: Enter would not join');
  });
});

describe('the primary control reads deliberate', () => {
  it('centres its label instead of leaving it left', () => {
    assert.match(rule('#join-button'), /justify-content:\s*center/, 'the Join label is not centred');
  });

  it('drops the type a touch below 1.05em and keeps the control large', () => {
    const button = rule('#join-button');
    assert.ok(!/font-size:\s*1\.05em/.test(style), 'the old oversized Join type survives');
    assert.match(button, /font-size:\s*1em\b/, `Join type is not a touch smaller: ${button}`);
    assert.match(button, /padding:\s*0\.8/, `Join is not padded like a primary: ${button}`);
    assert.match(button, /transition:/, 'no hover transition on Join');
    assert.ok(/#join-button:active/.test(style), 'no active press on Join');
  });

  it('gives the name field the same weight', () => {
    const input = rule('#join input');
    assert.match(input, /font-size:\s*1rem/, `the name field is not a deliberate size: ${input}`);
    assert.match(input, /padding:\s*0\.7em/, `the name field is not generously padded: ${input}`);
  });

  it('keeps a visible focus ring on both', () => {
    assert.match(
      style,
      /button:focus-visible[\s\S]{0,120}outline:\s*2px solid var\(--ring\)/,
      'the focus ring left the page',
    );
    assert.ok(
      !/input:focus\s*\{[^}]*outline:\s*none/.test(style),
      'input focus still swallows the ring',
    );
  });
});

describe('the invite link', () => {
  it('is revealed by a fade instead of snapping', () => {
    const share = rule('#share');
    assert.match(share, /color:\s*transparent/, 'the link is not masked at rest');
    const transition = share.match(/transition:[^;}]*/)?.[0] ?? '';
    assert.match(transition, /color/, `the reveal does not fade the text: ${transition}`);
    assert.match(transition, /text-shadow|opacity/, `the reveal does not fade the mask: ${transition}`);
  });

  it('honours prefers-reduced-motion', () => {
    const at = style.indexOf('prefers-reduced-motion');
    assert.ok(at !== -1, 'no reduced-motion block in the shell');
    const block = style.slice(at);
    assert.ok(block.includes('#share'), 'the reveal keeps animating under reduced motion');
    assert.match(block, /transition:\s*none/, 'reduced motion is not honoured with a cut');
  });

  it('shortens the room id and the token, not just a long host', () => {
    const token32 = '9f2c'.repeat(8);
    const full = `https://edit.example/?room=r-3ab6c4e248c7&token=${token32}`;
    const shown = displayShareLink(full);
    assert.match(shown, /room=r-3ab6…/, `the room id reads whole: ${shown}`);
    assert.match(shown, /token=9f2c9f…/, `the token reads whole: ${shown}`);
    assert.ok(!shown.includes('r-3ab6c4e248c7'), `the whole room id survives: ${shown}`);
    assert.ok(!shown.includes(token32), `the whole token survives: ${shown}`);
    assert.ok(shown.length < full.length, 'the display is as long as the credential');
  });

  it('leaves a short link whole and keeps the whole bytes as title and clipboard', () => {
    assert.equal(
      displayShareLink('https://edit.example/?room=r-1&token=tok'),
      'https://edit.example/?room=r-1&token=tok',
    );
    const main = readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8');
    assert.ok(main.includes('shareInput.title = fullShareLink'), 'the title lost the whole link');
    assert.ok(
      main.includes('navigator.clipboard.writeText(fullShareLink)'),
      'the clipboard lost the whole link',
    );
  });
});

describe('the landing page language', () => {
  it('uses the site tokens, dark only', () => {
    assert.match(style, /color-scheme:\s*dark/, 'the page no longer declares dark only');
    assert.equal(token('background'), '#1e1e2e');
    assert.equal(token('card'), '#181825');
    assert.equal(token('foreground'), '#cdd6f4');
    assert.equal(token('muted-foreground'), '#a6adc8');
    assert.equal(token('primary'), '#cba6f7');
  });

  it('keeps every text colour at or above WCAG AA on its own ground', () => {
    const pairs: Array<[string, string, string]> = [
      ['text on the page', 'foreground', 'background'],
      ['text on the card', 'foreground', 'card'],
      ['subtext on the page', 'muted-foreground', 'background'],
      ['subtext on the card', 'muted-foreground', 'card'],
      ['subtext on the input', 'muted-foreground', 'input'],
      ['the primary button label', 'primary-foreground', 'primary'],
      ['a failure message', 'danger', 'card'],
      ['the paste example', 'placeholder', 'input'],
    ];
    for (const [what, fg, bg] of pairs) {
      const ratio = contrast(token(fg), token(bg));
      assert.ok(ratio >= 4.5, `${what} is ${ratio.toFixed(2)}:1 (${token(fg)} on ${token(bg)})`);
    }
  });

  it('keeps the peer palette legible on every ground it is used on', () => {
    // The peer palette is One Dark's, reached by hashing a peer id, and it is
    // used twice: black initials on the colour (the tree badge) and the colour
    // as text and as the roster swatch on the card. Eight hues is the palette;
    // if that changes, this table has to be verified again rather than left
    // to look covered.
    const colours = new Set<string>();
    for (let index = 0; index < 5000; index += 1) {
      colours.add(peerColour(`peer-${index}`));
    }
    assert.equal(colours.size, 8, `the palette changed shape: ${[...colours].join(', ')}`);
    for (const colour of colours) {
      const initials = contrast('#000000', colour);
      assert.ok(initials >= 4.5, `badge initials on ${colour} are ${initials.toFixed(2)}:1`);
      const asText = contrast(colour, token('card'));
      assert.ok(asText >= 4.5, `${colour} as text on the card is ${asText.toFixed(2)}:1`);
    }
  });

  it('never washes the page with a gradient', () => {
    assert.ok(!/gradient\s*\(/i.test(style), 'a gradient entered the shell');
  });
});

describe('the message homes', () => {
  function makeElement() {
    return {
      textContent: '',
      hidden: false,
      dataset: {} as Record<string, string>,
    };
  }

  it('a failure alert stands a few seconds, then leaves on its own', () => {
    const element = makeElement();
    const scheduled: Array<() => void> = [];
    const cancelled: unknown[] = [];
    const alert = wireFailureAlert(element as unknown as HTMLElement, {
      schedule: (run) => {
        scheduled.push(run);
        return scheduled.length;
      },
      cancel: (handle) => void cancelled.push(handle),
    });
    alert.show('Could not open notes.md: the room refused it');
    assert.equal(element.textContent, 'Could not open notes.md: the room refused it');
    assert.equal(scheduled.length, 1, 'the alert never expires');
    assert.equal(cancelled.length, 0);
    scheduled[0]?.();
    assert.equal(element.textContent, '', 'the alert never left the screen');
    alert.show('Could not follow sam: no such peer');
    alert.show('Select the link and copy it by hand.');
    assert.equal(cancelled.length, 2, 'a later failure never restarted the timer');
    alert.dismiss();
    assert.equal(element.textContent, '', 'the alert survived its dismissal');
  });

  it('the session note carries the host-leave warning and nothing else', () => {
    const element = makeElement();
    const note = wireSessionNote(element as unknown as HTMLElement);
    assert.equal(element.textContent, '', 'an untouched note paints nothing');
    note.show('host left — the room closes in 30s unless the host returns');
    assert.match(element.textContent, /host left/);
    note.hide();
    assert.equal(element.textContent, '');
  });

  it('the end of the room comes back as the card, not as a strip', () => {
    const main = readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8');
    assert.ok(
      main.includes('leaveSession(roomGoneMessage(notice.reason))'),
      'the terminal sentence has no home',
    );
    assert.ok(!main.includes('setStatus'), 'the status line is still called');
  });

  it('action failures reach the alert, never the chrome', () => {
    const main = readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8');
    assert.match(main, /failureAlert\.show\(`Could not open/, 'an open failure goes nowhere');
    assert.match(main, /failureAlert\.show\(`Could not go to/, 'a go-to failure goes nowhere');
    assert.match(main, /failureAlert\.show\(`Could not follow/, 'a follow failure goes nowhere');
    assert.ok(
      main.includes("failureAlert.show('Select the link and copy it by hand.')"),
      'the hand-copy fallback goes nowhere',
    );
  });

  it('drops the chatter instead of moving it', () => {
    const main = readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8');
    for (const gone of [
      'Joined. Waiting for the room to name a document.',
      'is already here',
      'Connection dropped',
      'Reconnected',
      'linkDown',
      'reseated',
    ]) {
      assert.ok(!main.includes(gone), `${gone} survives in the page`);
    }
  });
});

describe('the host leaving and coming back', () => {
  it('only the detach and the return are note signals; the rest is chatter', () => {
    assert.equal(
      sessionNoteSignal('host left — the room closes in 30s unless the host returns'),
      'grace',
    );
    assert.equal(sessionNoteSignal('host demo-host is back'), 'back');
    // The engine's own validation accepts an empty display name, so the
    // all-clear can arrive as two words and a gap.
    assert.equal(sessionNoteSignal('host  is back'), 'back');
    for (const chatter of [
      'Connection dropped. Reconnecting…',
      'disconnected',
      'Reconnected.',
      'room closed: host did not return',
      'Following sam in a.txt',
      "'sam' left the room, so following stopped",
    ]) {
      assert.equal(sessionNoteSignal(chatter), undefined, `${chatter} became a note signal`);
    }
  });

  it('a membership report that names the host is the all-clear too', () => {
    assert.equal(hostPresent([{ role: 'host' }]), true);
    assert.equal(hostPresent([{ role: 'guest' }, { role: 'host' }]), true);
    assert.equal(hostPresent([{ role: 'guest' }, { role: 'guest' }]), false);
    assert.equal(hostPresent([]), false);
  });

  // The binding has no notice kind for either: both arrive as transient text,
  // so the page routes exactly those sentences. This pins the contract the
  // routing reads, so a reworded binding cannot drop the warning (or leave it
  // standing after the host is back) silently.
  it('the binding announces both on the notice channel, and the page routes them', () => {
    globalThis.document = {
      createElement: () => ({ append: () => {}, remove: () => {} }),
      head: { appendChild: () => {} },
    } as unknown as Document;
    const notices: Array<{ kind: string; text?: string }> = [];
    const engine = {
      session: () => ({ role: 'guest', roomId: 'r-test', peer: {}, documents: [] }),
      text: () => '',
      has: () => false,
      open: async () => {},
      close: async () => {},
      openDocuments: () => [],
      insert: () => {},
      delete: () => {},
      setSelection: () => {},
      setAwareness: () => {},
      presence: () => [],
      resolveSelection: () => undefined,
      // The host, unnamed: the room's own membership names it by role, which
      // is what the page reads when the attach frame was missed.
      peers: () => [{ peer_id: 'peer-host', display_name: '', role: 'host' }],
      documents: () => [],
      grantedPaths: () => [],
      on: () => () => {},
    };
    const editor = {
      createDecorationsCollection: () => ({ set: () => {}, clear: () => {} }),
      onDidChangeCursorSelection: () => ({ dispose: () => {} }),
      getSelection: () => null,
      setModel: () => {},
      setPosition: () => {},
      revealPositionInCenter: () => {},
      updateOptions: () => {},
    };
    const binding = new MonacoBinding({
      engine,
      editor,
      onNotice: (notice) => void notices.push(notice),
      createModel: (text: string) => ({ isDisposed: () => false, dispose: () => {}, getValue: () => text }),
    } as never);

    binding.report({ kind: 'hostDetached', graceMs: 30000 } as never);
    const warned = notices.find((notice) => sessionNoteSignal(notice.text ?? '') === 'grace');
    assert.ok(warned, `no host-left signal in ${JSON.stringify(notices)}`);

    binding.report({ kind: 'hostAttached', peer: { display_name: 'demo-host' } } as never);
    const returned = notices.find((notice) => sessionNoteSignal(notice.text ?? '') === 'back');
    assert.ok(returned, `no host-back signal in ${JSON.stringify(notices)}`);

    // The same attach with a name the engine's validation allows to be empty:
    // the sentence is still the all-clear.
    binding.report({ kind: 'hostAttached', peer: { display_name: '' } } as never);
    assert.ok(
      notices.some((notice) => notice.text === 'host  is back'),
      `an unnamed host produced no all-clear: ${JSON.stringify(notices)}`,
    );

    // And the membership the page reads for the same news: the host's role.
    assert.equal(hostPresent(binding.participants()), true, 'the roster hid the host');
    binding.dispose();

    const main = readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8');
    assert.ok(main.includes('sessionNoteSignal(notice.text)'), 'the page routes no note signal');
    assert.ok(main.includes('sessionNote.hide()'), 'the grace warning never clears');
    // Both membership notices carry the host, so both are all-clears: the
    // attach sentence is not the only way the warning comes down.
    for (const kind of ["case 'peers':", "case 'roster':"]) {
      const at = main.indexOf(kind);
      assert.ok(at !== -1, `${kind} left the notice routing`);
      const branch = main.slice(at, main.indexOf('break;', at));
      assert.ok(
        branch.includes('hostPresent('),
        `${kind} does not clear the grace warning when the host is named`,
      );
    }
  });
});
