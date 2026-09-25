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
  RECONNECTING_NOTE,
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
const card = html.slice(html.indexOf('<div id="join" class="card-start">'), html.indexOf('id="workspace"'));

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
  it('one heading per intent, one name field, one confirm, one paste box', () => {
    // Two headings, because the card is two intents: a page that starts a room and a page
    // an invite named. The shell's own script hides one of them before the first paint, so
    // exactly one is read — and it is the one the address bar calls for.
    assert.match(card, /<h1 id="start-heading">Start a Selvage session<\/h1>/, 'no heading for the start card');
    assert.match(card, /<h1 id="join-heading" hidden>Join a Selvage session<\/h1>/, 'no heading for the join card');
    for (const heading of ['Join a Selvage session', 'Start a Selvage session']) {
      assert.equal((html.match(new RegExp(heading, 'g')) ?? []).length, 1, `the heading is repeated: ${heading}`);
    }
    assert.equal((html.match(/<h1/g) ?? []).length, 2, 'a third heading is on the card');
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

  it('keeps what the flow is pinned on: the paste schematic, the name field, Enter', () => {
    assert.match(card, /<input id="name" type="text" maxlength="32" autocomplete="off"/,
      'the name field left the card, or grew an example that reads as a value');
    assert.match(card, /room=…&token=…/, 'the paste schematic left the card');
    assert.ok(card.includes('id="join-form"'), 'no form: Enter would not join');
    assert.ok(card.includes('<input id="name"'), 'the name field left the card');
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
  it('is masked at rest, and the one reveal is the hand copy', () => {
    // The link *is* the room key, so it belongs on the clipboard rather than on a screen: a
    // screen-share, a screenshot or someone standing behind the guest defeats any state that
    // revealed it. A blur was the earlier answer and a reviewer read the room id and the token
    // straight through it, so the value itself is a fixed run of bullets now.
    const base = rule('#share');
    assert.match(base, /color:\s*transparent/, 'the readout is not masked at rest');
    assert.match(base, /text-shadow:\s*0 0 5px/, 'the masked value is not drawn as a blur');

    // Every rule that could put the value back on screen under a state a pointer can reach. A rule
    // that reveals on `:hover`, `:focus`, `:focus-visible`, `:focus-within`, `:active` or
    // `[aria-pressed]` is the same defect wearing a different selector.
    const states = /:(?:hover|focus|focus-visible|focus-within|active)\b|\[aria-pressed/;
    const reveals = [];
    for (const match of style.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = (match[1] ?? '').trim();
      const body = match[2] ?? '';
      // The readout itself, not the group it sits in: the pill's border and the copy flash are
      // not the value.
      if (!/#share(?![\w-])/.test(selector)) continue;
      if (!states.test(selector)) continue;
      if (/color:|text-shadow:|filter:|opacity:|-webkit-text-security/.test(body)) {
        reveals.push(`${selector} { ${body.trim()} }`);
      }
    }
    assert.deepEqual(reveals, [], `a state puts the room key back on screen: ${reveals.join(' | ')}`);

    // The one rule that does make the value readable is the fallback's, and it is the page's own
    // answer to a clipboard that refused: the field is focused and selected for a person to copy
    // by hand, and there is nothing else left for them to use.
    assert.match(
      style,
      /#share-group\.hand-copy #share\s*\{[^}]*color:\s*var\(--foreground\)/,
      'a refused copy has no way to read the link it asks the person to copy',
    );
  });

  it('honours prefers-reduced-motion', () => {
    // The block that names the copy control, not the first one in the sheet: the shell now has more
    // than one reduced-motion cut, and only this one is about the reveal.
    const blocks = [...style.matchAll(/@media \(prefers-reduced-motion[^{]*\{([\s\S]*?)\n      \}/g)].map(
      (match) => match[1] ?? '',
    );
    const block = blocks.find((candidate) => candidate.includes('#share-group'));
    assert.ok(block !== undefined, 'the copy control lost its reduced-motion cut');
    assert.match(block, /transition:\s*none/, 'reduced motion is not honoured with a cut');
    // Nothing about the readout changes any more, so there is no reveal to animate at all.
    assert.ok(!/#share(?![\w-])/.test(block), 'the readout still declares a reveal animation');
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

  it('leaves a short link whole to the display rule, and puts the bytes on the clipboard alone', () => {
    assert.equal(
      displayShareLink('https://edit.example/?room=r-1&token=tok'),
      'https://edit.example/?room=r-1&token=tok',
    );
    // The readout itself carries bullets and no attribute holds the link (the room key must not be
    // readable off a screen); the clipboard is the one channel the whole link travels on.
    const main = readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8');
    assert.ok(main.includes('shareInput.value = SHARE_MASK'), 'the readout is not the mask');
    assert.ok(!main.includes('shareInput.title'), 'the room key is back in the readout’s title');
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

describe('the side panel holds what a roster row is made of', () => {
  it('is wide enough for a name beside two labelled verbs', () => {
    // Measured in Chromium 152 at 1440x900, the real bundle, one host and one
    // guest: at 19rem the row's name column was 69 px for a name needing 82 px,
    // so the guest's own `Guest One` painted as `Guest ...` while two dead verbs
    // took 132 px of a 234 px row; following a nine-character peer elided that
    // name too (`demo-h... Following`). At 21rem both fit, and the editor keeps
    // 1125 px of the 1440 px window.
    const width = /#side\s*\{[^}]*width:\s*([\d.]+)rem/.exec(style);
    assert.ok(width !== null, 'the panel has no fixed width');
    assert.ok(Number(width[1]) >= 21, `the panel is ${width[1]}rem: a peer's name elides beside its own verbs`);
    const backdrop = /#preview \.fake-side\s*\{[^}]*width:\s*([\d.]+)rem/.exec(style);
    assert.ok(backdrop !== null, 'the backdrop carries no panel width');
    assert.equal(backdrop[1], width[1], 'the backdrop draws a panel of another width');
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
      // The clock the note reads is a stub, as it is in the tests around this one: with the
      // real one the reading is `graceMs` minus however many milliseconds elapsed between the
      // deadline being set and the first draw, which is 29 whenever the clock ticks in between.
      now: () => 0,
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

  it('a status sentence has a home, and does not take the room\u2019s warning down', () => {
    // The editor raises `status` for the sentence a `viewer` is owed, a go-to the room could not
    // answer, a follow landing, an error the room reported — and the page had no case for the
    // kind at all, so every one of them was written and thrown away. The page shows the topics
    // with no other surface (`SHOWN_STATUS_TOPICS`, above) and the strip's own rules are these.
    const element = makeElement();
    const timer = ticking();
    const note = wireSessionNote(element as unknown as HTMLElement, {
      countParts: countStub(),
      now: () => 0,
      schedule: timer.schedule,
      cancel: timer.cancel,
    });
    note.status('you are a viewer in this room, so its documents are read-only.');
    assert.equal(
      element.textContent,
      'you are a viewer in this room, so its documents are read-only.',
      'the sentence a viewer is owed reaches no line',
    );
    assert.equal(element.dataset.tone, 'plain', 'news wears the warning\u2019s tone');
    // One line, so a later sentence replaces it rather than stacking under it.
    note.status('Following sam in notes.md');
    assert.equal(element.textContent, 'Following sam in notes.md', 'two sentences stacked');
    assert.equal(timer.runs.length, 2, 'a replaced sentence kept its own clock');
    // The replaced sentence's clock is cancelled, so it cannot wipe the newer sentence early.
    timer.runs[0]?.();
    timer.runs[1]?.();
    assert.equal(element.textContent, '', 'the sentence stood for ever');
  });

  it('a sentence said again while it stands is not restarted', () => {
    // A follow re-lands and re-says itself on every frame the peer moves. Re-writing it would
    // restart the stand and re-announce an unchanged line in the note's polite live region.
    const element = makeElement();
    const timer = ticking();
    const note = wireSessionNote(element as unknown as HTMLElement, {
      countParts: countStub(),
      now: () => 0,
      schedule: timer.schedule,
      cancel: timer.cancel,
    });
    note.status('Following sam in notes.md');
    assert.equal(timer.runs.length, 1);
    note.status('Following sam in notes.md');
    assert.equal(timer.runs.length, 1, 'the same sentence was written back and re-armed');
    assert.equal(element.textContent, 'Following sam in notes.md');
    timer.runs[0]?.();
    assert.equal(element.textContent, '', 'the sentence stood for ever');
    // Once it has left, the same words are news again.
    note.status('Following sam in notes.md');
    assert.equal(element.textContent, 'Following sam in notes.md', 'a cleared sentence never returns');
    note.hide();
  });

  it('echoes the room\u2019s own warning rather than replacing it', () => {
    // The countdown and the dropped line are armed by one event each and nothing re-arms them,
    // so a sentence taking the strip from either deletes the only reading of a room that is
    // closing or out of reach.
    const element = makeElement();
    const timer = ticking();
    const note = wireSessionNote(element as unknown as HTMLElement, {
      countParts: countStub(),
      now: () => 0,
      schedule: timer.schedule,
      cancel: timer.cancel,
    });
    note.countdown(30_000);
    note.status('nothing to go to: sam is not in a document');
    assert.match(element.textContent, /^The host left\./, 'news took the countdown down');
    assert.equal(element.dataset.tone, 'grace', 'the countdown lost its tone');
    // A countdown that started after the news: the warning wins whenever it arrives.
    note.hide();
    note.status('Following sam in notes.md');
    note.countdown(30_000);
    assert.match(element.textContent, /^The host left\./, 'the warning never took the strip');
    // And the dropped line, which stands until the room answers.
    note.dropped(RECONNECTING_NOTE);
    note.status('Following sam in notes.md');
    assert.equal(element.textContent, RECONNECTING_NOTE, 'news took the dropped line down');
    note.hide();
  });

  it('the page shows the status topics that have no other surface, and only those', () => {
    // The owner's own pass: the follow banner already reads "Following vscodium" with a Stop
    // control, and the notice bar was saying "Following vscodium in test" right above it — the
    // same fact twice, one of them chrome that appears and disappears. The binding still raises
    // every topic; the page's switch is where the ones with another surface stop.
    const main = readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8');
    assert.match(
      main,
      /case 'status':[\s\S]{0,900}?SHOWN_STATUS_TOPICS\.has\(notice\.topic\)[\s\S]{0,120}?sessionNote\.status\(notice\.text\)/,
      'a status notice reaches no line on the page',
    );
    const shown = /SHOWN_STATUS_TOPICS[^=]*=\s*new Set\(\[([^\]]*)\]\)/.exec(main);
    assert.ok(shown !== null, 'the shown-topics set left the page');
    const topics = (shown[1] ?? '').match(/'[a-z]+'/g) ?? [];
    // A go-to the room could not answer is the click's only answer, and a session error is the
    // room's own word; both have no other surface yet.
    assert.deepEqual(topics.slice().sort(), ["'error'", "'refusal'", "'role'"].sort());
    // The role is a state rather than a sentence now: the strip's `Read-only` chip, which stays
    // while it is true instead of a toast the person had to have caught.
    assert.match(main, /if \(notice\.topic === 'role'\)/, 'the read-only state reaches no chip');
    assert.match(main, /readOnly = true/, 'nothing puts the strip into its read-only state');
    for (const dropped of ['follow', 'terminal']) {
      assert.ok(
        !topics.includes(`'${dropped}'`),
        `the ${dropped} topic is shown again, and something else on the page already states it`,
      );
    }
    // The dropped topics still leave the binding: it is the page that stops repeating them.
    const editor = readFileSync(new URL('../src/browser/editor.ts', import.meta.url), 'utf8');
    assert.match(editor, /topic: 'terminal'/g, 'the binding stopped raising the terminal sentence');
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
      'Reconnected',
      'linkDown',
      'reseated',
    ]) {
      assert.ok(!main.includes(gone), `${gone} survives in the page`);
    }
  });

  // The one transient that is not chatter. A retry runs for as long as the room's advertised
  // grace, and through all of it the editor keeps working locally while nothing typed can reach
  // the room: the line stands until the room answers, rather than for a guessed number of
  // seconds, and it is the reason `Connection dropped. Reconnecting…` is no longer on the list
  // above.
  it('a dropped socket wears a line that stands until the room answers', () => {
    const element = makeElement();
    const timer = ticking();
    const note = wireSessionNote(element as unknown as HTMLElement, {
      countParts: countStub(),
      now: () => 0,
      schedule: timer.schedule,
      cancel: timer.cancel,
    });
    note.dropped(RECONNECTING_NOTE);
    assert.equal(element.textContent, RECONNECTING_NOTE);
    assert.equal(element.dataset.tone, 'dropped');
    assert.equal(timer.runs.length, 0, 'the dropped line armed a timer of its own');
    note.endDropped();
    assert.equal(element.textContent, '', 'the all-clear left the dropped line standing');
    assert.equal(element.dataset.tone, '', 'the dropped line left its tone behind');
    // The all-clear is the room's own reports, so it arrives whatever the line is showing: a
    // sentence said into the same strip — the host's return — is not the one it takes down.
    note.say('demo-host is back — the session continues.', 5000);
    note.endDropped();
    assert.equal(
      element.textContent,
      'demo-host is back — the session continues.',
      'the all-clear took down a sentence that is not the dropped line',
    );
    note.hide();
  });

  it('the page shows the dropped line and the all-clear that ends it', () => {
    const main = readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8');
    assert.ok(
      main.includes('sessionNote.dropped(RECONNECTING_NOTE)'),
      'a dropped socket reaches no line on the page',
    );
    // Both seat reports are the all-clear: the bridge forces them on a re-seat, because the set
    // can be exactly what it was before the drop.
    assert.equal(
      [...main.matchAll(/case 'documents':|case 'peers':/g)].length,
      2,
      'the seat reports moved',
    );
    assert.equal(
      [...main.matchAll(/sessionNote\.endDropped\(\)/g)].length,
      2,
      'a seat report no longer ends the dropped line',
    );
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
    // Two elements are made now — the sentence's own wrapper and the number inside it (see
    // `defaultCountParts`: the strip is a flex row, so the sentence has to be one of its runs) —
    // and the assertions below are about the same one: the number is its own element, the strip's
    // run does not change while its text does, and only the number carries the announcement
    // attributes.
    const made: Array<{
      textContent: string;
      attributes: Record<string, string>;
      children: unknown[];
      append: (...nodes: unknown[]) => void;
      setAttribute: (name: string, value: string) => void;
    }> = [];
    (globalThis as { document?: unknown }).document = {
      createElement: () => {
        const element = {
          textContent: '',
          attributes: {} as Record<string, string>,
          children: [] as unknown[],
          append: (...nodes: unknown[]): void => void element.children.push(...nodes),
          setAttribute: (name: string, value: string): void => void (element.attributes[name] = value),
        };
        made.push(element);
        return element;
      },
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
    const [sentence, number] = made;
    assert.ok(sentence !== undefined && number !== undefined, 'the sentence and its number are built');
    // The strip stays a polite region for the sentence; the number carries `role="timer"`,
    // whose own live setting is off, so the count is never read out.
    assert.deepEqual(number.attributes, { role: 'timer', 'aria-live': 'off' });
    assert.deepEqual(sentence.attributes, {}, 'the sentence announces something of its own');
    assert.deepEqual(element.replaced, [sentence], 'the strip was handed a run per part');
    assert.deepEqual(
      sentence.children,
      [{ textContent: 'The host left. The room closes in ' }, number, { textContent: ' unless the host returns.' }],
      'the sentence is not the lead, the number and the tail',
    );
    const runs = [...element.replaced];
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

describe('the countdown is one sentence, whatever the number says', () => {
  /**
   * The strip is a flex row, so every child of it wears the row's `gap` on both sides. The
   * countdown substitutes its time into the middle of one sentence, which means the default build
   * has to hand the strip *one* run: three runs directly under it space `30 seconds` by the row's
   * gap instead of by a space, and space `a moment` the same way — the spacing the owner read as
   * too large, and different from the words around it. The stylesheet carries the same note.
   */
  function makeDocument() {
    // `textContent` is derived from the children, the way a real element's is: the assertions below
    // read the sentence as a reader of the strip would, so the fake has to compose it.
    const make = (tag: string) => {
      const children: unknown[] = [];
      const element = {
        tag,
        nodeType: 1,
        children,
        attributes: {} as Record<string, string>,
        append: (...nodes: unknown[]) => void children.push(...nodes),
        setAttribute: (name: string, value: string) => void (element.attributes[name] = value),
        get textContent(): string {
          return children
            .map((child) => String((child as { textContent: unknown }).textContent))
            .join('');
        },
        set textContent(value: string) {
          children.length = 0;
          children.push({ nodeType: 3, textContent: value });
        },
      };
      return element;
    };
    return {
      createElement: make,
      createTextNode: (text: string) => ({ nodeType: 3, textContent: text }),
    };
  }

  it('hands the strip one run, with the number in an element of its own', () => {
    const real = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = makeDocument();
    try {
      const element = makeElement();
      const timer = ticking();
      const note = wireSessionNote(element as unknown as HTMLElement, {
        // No `countParts` stub: this is the page's own build, which is what the strip receives.
        now: () => 0,
        schedule: timer.schedule,
        cancel: timer.cancel,
      });
      note.countdown(30_000);

      const runs = element.replaced;
      assert.equal(runs.length, 1, 'the strip was handed a run per part, so its gap spaces them');
      const sentence = runs[0] as {
        children: Array<{ textContent: string; attributes?: Record<string, string> }>;
      };
      assert.equal(sentence.children.length, 3, 'the sentence is not lead, number, tail');
      assert.equal(sentence.children[0]?.textContent, 'The host left. The room closes in ');
      assert.equal(sentence.children[1]?.textContent, '30 seconds');
      assert.equal(sentence.children[2]?.textContent, ' unless the host returns.');
      // The count is not announced: the sentence is, once, through the live region it sits in.
      assert.equal(sentence.children[1]?.attributes?.['role'], 'timer');
      assert.equal(sentence.children[1]?.attributes?.['aria-live'], 'off');
      assert.equal(element.textContent, 'The host left. The room closes in 30 seconds unless the host returns.');
      note.hide();
    } finally {
      (globalThis as { document?: unknown }).document = real;
    }
  });

  it('keeps one run for every form of the reading, a word as well as a number', () => {
    const real = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = makeDocument();
    try {
      const element = makeElement();
      const timer = ticking();
      const note = wireSessionNote(element as unknown as HTMLElement, {
        now: () => 0,
        schedule: timer.schedule,
        cancel: timer.cancel,
      });
      // Every form `graceWording` can produce, including the branch that is a word rather than a
      // number and the singular/plural pair: the run count and the spacing are the sentence's, and
      // the reading only ever replaces the middle run's text.
      for (const [graceMs, reading] of [
        [500, 'a moment'],
        [1000, '1 second'],
        [2000, '2 seconds'],
        [60_000, '1 minute'],
        [3_600_000, '1 hour'],
      ] as Array<[number, string]>) {
        note.countdown(graceMs);
        const runs = element.replaced;
        assert.equal(runs.length, 1, `the run count for ${reading} is not the sentence's`);
        const sentence = runs[0] as { children: Array<{ textContent: string }> };
        assert.equal(sentence.children.length, 3, `${reading} is not lead, number, tail`);
        assert.equal(sentence.children[1]?.textContent, reading);
        assert.equal(
          sentence.children[0]?.textContent,
          'The host left. The room closes in ',
          `${reading} changed the lead`,
        );
        assert.equal(
          sentence.children[2]?.textContent,
          ' unless the host returns.',
          `${reading} changed the tail`,
        );
        assert.equal(
          element.textContent,
          `The host left. The room closes in ${reading} unless the host returns.`,
        );
      }
      note.hide();
    } finally {
      (globalThis as { document?: unknown }).document = real;
    }
  });
});
