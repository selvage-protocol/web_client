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
import {
  graceWording,
  hostBackSentence,
  hostPresent,
  wireFailureAlert,
  wireSessionNote,
  wireTapPeek,
} from '../src/browser/notice.ts';
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

/** A clock and a scheduler a test owns, so no tick of the countdown is a real timer. */
function ticking(): {
  runs: Array<() => void>;
  schedule: (run: () => void) => number;
  cancel: () => void;
} {
  const runs: Array<() => void> = [];
  return {
    runs,
    schedule: (run) => runs.push(run),
    cancel: () => {},
  };
}

function makeElement() {
  const runs: unknown[] = [];
  let text = '';
  // The fake wears the DOM's own rule, which the countdown depends on: what the runs say is
  // what `textContent` reads, and writing `textContent` takes the runs away.
  return {
    hidden: false,
    dataset: {} as Record<string, string>,
    get replaced(): unknown[] {
      return runs;
    },
    replaceChildren(...nodes: unknown[]): void {
      runs.length = 0;
      runs.push(...nodes);
      text = '';
    },
    get textContent(): string {
      if (runs.length === 0) {
        return text;
      }
      return runs
        .map((run) =>
          typeof run === 'string' ? run : String((run as { textContent: unknown }).textContent),
        )
        .join('');
    },
    set textContent(value: string) {
      text = value;
      runs.length = 0;
    },
  };
}

/**
 * The number's own element, as the page builds it. Stubbed rather than a real span, because
 * what the suite has to see is that the count moves while the sentence's own two runs do not:
 * a polite region whose text changed every second would read the count out thirty times.
 */
function countStub() {
  return (lead: string, tail: string) => {
    const number = { textContent: '' };
    return {
      parts: [lead, number, tail] as unknown[],
      number: (text: string): void => {
        number.textContent = text;
      },
    };
  };
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

  it('keeps the pre-join backdrop legible on the pane it is drawn on', () => {
    // The backdrop is a picture of an editor drawn in these tokens, so the
    // pairs that matter are the ones its own rules name, over the pane each
    // rule is scoped to: the tree on the card, the code on the page. Read out
    // of the shell, so recolouring the picture is measured — a table of token
    // names would go on passing after the picture stopped using them.
    const backdrop = style.slice(style.indexOf('#preview {'), style.indexOf('#veil {'));
    const scoped = [
      ...backdrop.matchAll(/(#preview \.fake-(?:side|main)[^{}]*)\{([^{}]*)\}/g),
    ];
    assert.ok(scoped.length >= 6, `the scan reached ${scoped.length} backdrop rules`);
    let measured = 0;
    for (const [, selector = '', body = ''] of scoped) {
      const ground = selector.includes('.fake-side') ? 'card' : 'background';
      for (const [, name = ''] of body.matchAll(/color:\s*var\(--([a-z-]+)\)/g)) {
        measured += 1;
        const ratio = contrast(token(name), token(ground));
        assert.ok(ratio >= 4.5, `${selector.trim()} is ${ratio.toFixed(2)}:1 (--${name} on --${ground})`);
      }
    }
    assert.ok(measured >= 5, `the scan measured ${measured} text colours`);
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

  it('the tap-revealed line says one thing, stands, and takes itself down', () => {
    const element = makeElement();
    const scheduled: Array<() => void> = [];
    const peek = wireTapPeek(element as unknown as HTMLElement, {
      schedule: (run) => {
        scheduled.push(run);
        return scheduled.length;
      },
      cancel: () => {},
    });
    peek.show('sam · host');
    assert.equal(element.textContent, 'sam · host');
    scheduled[0]?.();
    assert.equal(element.textContent, '', 'the peek never left the screen');
  });

  it('the session note carries the host-leave warning and nothing else', () => {
    const element = makeElement();
    const timer = ticking();
    const note = wireSessionNote(element as unknown as HTMLElement, {
      countParts: countStub(),
      schedule: timer.schedule,
      cancel: timer.cancel,
    });
    assert.equal(element.textContent, '', 'an untouched note paints nothing');
    note.countdown(30_000);
    assert.match(element.textContent, /^The host left\. The room closes in 30 seconds/);
    // The host's return replaces the countdown and leaves on its own, the way a notice does.
    note.say('demo-host is back — the session continues.', 5000);
    assert.equal(element.textContent, 'demo-host is back — the session continues.');
    timer.runs.at(-1)?.();
    assert.equal(element.textContent, '', 'the return stood for ever');
    note.hide();
  });

  it('a sentence that stands takes itself down, and the countdown is not one', () => {
    const element = makeElement();
    const timer = ticking();
    const note = wireSessionNote(element as unknown as HTMLElement, {
      countParts: countStub(),
      now: () => 0,
      schedule: timer.schedule,
      cancel: timer.cancel,
    });
    note.say('demo-host is back — the session continues.', 5000);
    assert.equal(timer.runs.length, 1, 'the return never leaves on its own');
    timer.runs[0]?.();
    assert.equal(element.textContent, '', 'the return stood for ever');
  });

  // The attach frame and the membership report that names the host arrive in the same burst,
  // and the report used to take the whole line down: the sentence the guest has to read was
  // written and wiped in the same millisecond, so no one could see it. The all-clear ends the
  // countdown; a sentence standing in its place is what the guest is owed.
  it("the membership all-clear leaves the host's return standing", () => {
    const element = makeElement();
    const timer = ticking();
    const note = wireSessionNote(element as unknown as HTMLElement, {
      countParts: countStub(),
      now: () => 0,
      schedule: timer.schedule,
      cancel: timer.cancel,
    });
    note.countdown(30_000);
    assert.match(element.textContent, /^The host left\./, 'the countdown never stood');
    note.say('demo-host is back — the session continues.', 5000);
    note.endCountdown();
    assert.equal(
      element.textContent,
      'demo-host is back — the session continues.',
      'the all-clear took the host-is-back sentence down with the countdown',
    );
    // The all-clear did not cancel the sentence's own clock either, so it still leaves.
    timer.runs.at(-1)?.();
    assert.equal(element.textContent, '', 'the return was left standing for ever');
  });

  it('the all-clear takes down a countdown and nothing else', () => {
    const element = makeElement();
    const timer = ticking();
    const note = wireSessionNote(element as unknown as HTMLElement, {
      countParts: countStub(),
      now: () => 0,
      schedule: timer.schedule,
      cancel: timer.cancel,
    });
    note.endCountdown();
    assert.equal(element.textContent, '', 'an untouched line was left dirty');
    note.countdown(30_000);
    note.endCountdown();
    assert.equal(element.textContent, '', 'the countdown survived the all-clear');
    assert.equal(element.dataset.tone, '', 'the countdown left its tone on the line');
  });

  it('the end of the room comes back as the card, not as a strip', () => {
    const main = readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8');
    assert.ok(
      main.includes('leaveSession(roomGoneSentence(notice.reason))'),
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
  it('the grace window reads in the largest whole unit the room still has', () => {
    // The window is the server's number, so the sentence has to hold any of
    // them without asking the guest to divide seconds. It rounds down: a
    // countdown that said `2 minutes` over 60 seconds would hand the guest time
    // the room does not have.
    assert.equal(graceWording(30_000), '30 seconds');
    assert.equal(graceWording(1_000), '1 second');
    assert.equal(graceWording(59_999), '59 seconds');
    assert.equal(graceWording(60_001), '1 minute');
    assert.equal(graceWording(600_000), '10 minutes');
    assert.equal(graceWording(60_000), '1 minute');
    assert.equal(graceWording(90_000), '1 minute');
    assert.equal(graceWording(119_000), '1 minute');
    assert.equal(graceWording(3_600_000), '1 hour');
    assert.equal(graceWording(3_599_999), '59 minutes');
    assert.equal(graceWording(0), 'a moment');
    assert.equal(graceWording(500), 'a moment');
    for (const ms of [0, 500, 1_000, 30_000, 59_999, 60_001, 90_000, 599_999, 600_000, 3_600_000]) {
      const shown = graceWording(ms);
      assert.ok(!/\d+s\b/.test(shown), `a raw second count survives: ${shown}`);
      assert.ok(!shown.includes('undefined'), `a unit went missing: ${shown}`);
    }
  });

  it('the grace warning counts the window down against the room\'s deadline', () => {
    const element = makeElement();
    const timer = ticking();
    let clock = 1_000_000;
    const note = wireSessionNote(element as unknown as HTMLElement, {
      countParts: countStub(),
      now: () => clock,
      schedule: timer.schedule,
      cancel: timer.cancel,
    });
    note.countdown(3000);
    assert.equal(
      element.textContent,
      'The host left. The room closes in 3 seconds unless the host returns.',
    );
    // Every tick reads the clock again rather than lowering a value of its own, so the reading
    // is the room's remaining time even for a tab that missed a hundred ticks.
    clock += 1000;
    timer.runs[0]?.();
    assert.equal(
      element.textContent,
      'The host left. The room closes in 2 seconds unless the host returns.',
    );
    clock += 1000;
    timer.runs[0]?.();
    assert.equal(
      element.textContent,
      'The host left. The room closes in 1 second unless the host returns.',
    );
    clock += 1000;
    timer.runs[0]?.();
    assert.equal(
      element.textContent,
      'The host left. The room closes in a moment unless the host returns.',
    );
  });

  it('the count is in an element of its own, which the live region does not announce', (t) => {
    const attributes: Record<string, string> = {};
    const number = {
      textContent: '',
      setAttribute: (name: string, value: string): void => void (attributes[name] = value),
    };
    const runs: unknown[] = [];
    (globalThis as { document?: unknown }).document = {
      createElement: () => number,
      createTextNode: (text: string) => ({ textContent: text }),
    };
    t.after(() => {
      delete (globalThis as { document?: unknown }).document;
    });
    const element = makeElement();
    let clock = 0;
    const timer = ticking();
    const note = wireSessionNote(element as unknown as HTMLElement, {
      now: () => clock,
      schedule: timer.schedule,
      cancel: timer.cancel,
    });
    note.countdown(2000);
    // The strip stays a polite region for the sentence; the number carries `role="timer"`,
    // whose own live setting is off, so the count is never read out.
    assert.deepEqual(attributes, { role: 'timer', 'aria-live': 'off' });
    runs.push(...element.replaced);
    assert.equal(number.textContent, '2 seconds');
    clock += 1000;
    timer.runs[0]?.();
    assert.equal(number.textContent, '1 second', 'the number does not move');
    assert.deepEqual(element.replaced, runs, 'the sentence around the number changed with it');
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
    assert.deepEqual(
      notices.find((notice) => notice.kind === 'grace'),
      { kind: 'grace', graceMs: 30000 },
      `the grace window is not reported as a window: ${JSON.stringify(notices)}`,
    );

    binding.report({ kind: 'hostAttached', peer: { display_name: 'demo-host' } } as never);
    assert.deepEqual(
      notices.find((notice) => notice.kind === 'hostBack'),
      { kind: 'hostBack', name: 'demo-host' },
      `the host's return is not reported: ${JSON.stringify(notices)}`,
    );
    // The engine's own validation accepts an empty display name, so the sentence names the
    // role rather than leaving a gap.
    assert.equal(hostBackSentence(''), 'the host is back — the session continues.');
    assert.equal(hostBackSentence('demo-host'), 'demo-host is back — the session continues.');

    // And the membership the page reads for the same news: the host's role.
    assert.equal(hostPresent(binding.participants()), true, 'the roster hid the host');
    binding.dispose();

    const main = readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8');
    assert.ok(
      main.includes('sessionNote.countdown(notice.graceMs)'),
      'the grace window never reaches the clock',
    );
    assert.ok(
      main.includes('sessionNote.say(hostBackSentence(notice.name), HOST_BACK_STAND_MS)'),
      "the host's return is never said",
    );
    assert.ok(main.includes('sessionNote.endCountdown()'), 'the grace warning never clears');
    assert.ok(
      main.includes('sessionNote.hide()'),
      'leaving the session never takes the line down',
    );
    // Both membership notices carry the host, so both are all-clears: the
    // attach sentence is not the only way the warning comes down. The
    // all-clear ends the countdown and not the line (the host's return may be
    // standing there), so the teardown is the one caller of `hide()` left.
    for (const kind of ["case 'peers':", "case 'roster':"]) {
      const at = main.indexOf(kind);
      assert.ok(at !== -1, `${kind} left the notice routing`);
      const branch = main.slice(at, main.indexOf('break;', at));
      assert.ok(
        branch.includes('hostPresent('),
        `${kind} does not clear the grace warning when the host is named`,
      );
      assert.ok(
        branch.includes('sessionNote.endCountdown()'),
        `${kind} still takes the whole line down, so the host's return is wiped`,
      );
      assert.ok(
        !branch.includes('sessionNote.hide()'),
        `${kind} hides the host-is-back sentence with the countdown`,
      );
    }
  });
});
