/**
 * The notices column: the room's own card, and the toasts a save earns.
 *
 * Everything the page says over the workspace lives here, in one column that floats in the top-right
 * corner. The card is the room's lifecycle — the host leaving, the window counting down with the bar
 * that drains with it, the host's return, a socket the engine is re-dialling — and the toasts are the
 * files this window saved. `notice.ts` is DOM-building, so the element is a fake that carries only
 * what the module reads and writes; the stylesheet halves are read from the shell, and the driver
 * measures the column in a real browser.
 */
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  HOST_BACK_STAND_MS,
  RECONNECTING_NOTE,
  TOAST_STAND_MS,
  TOASTS_SHOWN,
  TRANSIENT_STAND_MS,
  disconnectingReading,
  downloadedSentence,
  graceWording,
  hostBackSentence,
  hostLeftSentence,
  wireDownloadToasts,
  wireSessionCard,
} from '../src/browser/notice.ts';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
const main = readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8');

/**
 * Every rule whose selector list names `selector`. More than one: the design gives its cards one
 * shape in a shared rule and their own colour in a rule each.
 */
function rules(selector: string): string[] {
  // The comments go first: one sits inside the same run of text as the selector that follows it,
  // and a selector list with a paragraph of prose in front of it is not a selector list.
  const bare = style.replace(/\/\*[\s\S]*?\*\//g, '');
  const found: string[] = [];
  for (const match of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const list = (match[1] ?? '').split(',').map((entry) => entry.trim());
    if (list.includes(selector)) found.push(match[2] ?? '');
  }
  assert.ok(found.length > 0, `no ${selector} rule in the stylesheet`);
  return found;
}

/** The declarations of every rule naming `selector`, as one string. */
function allOf(selector: string): string {
  return rules(selector).join('\n');
}

/** One element of the card, with only what the module touches: text, `hidden`, and a style. */
function part() {
  return { textContent: '', hidden: false, style: {} as Record<string, string> };
}

/** The card's own element, and the four parts inside it that `wireSessionCard` looks up. */
function cardElement() {
  const msg = part();
  const when = part();
  const bar = part();
  const sr = part();
  const parts: Record<string, ReturnType<typeof part>> = {
    '.msg': msg,
    '.when': when,
    '.bar': bar,
    '.sr': sr,
  };
  const element = {
    hidden: true,
    dataset: {} as Record<string, string>,
    querySelector: (selector: string): ReturnType<typeof part> | null => parts[selector] ?? null,
  };
  return { element, msg, when, bar, sr };
}

/** A scheduler that runs when the test says so, and remembers what it was asked for. */
function ticking() {
  const runs: Array<() => void> = [];
  const delays: number[] = [];
  return {
    runs,
    delays,
    schedule: (run: () => void, ms: number): number => {
      runs.push(run);
      delays.push(ms);
      return runs.length;
    },
    cancel: (): void => {},
  };
}

describe('the countdown reads in the unit the window deserves', () => {
  it('counts a window a person can watch in whole seconds, the way the design draws it', () => {
    assert.equal(disconnectingReading(30_000, 30_000), '30s');
    assert.equal(disconnectingReading(30_000, 1_000), '1s');
    // Any part of a second left is still a second the host can come back in, and `0s` is not a
    // thing to show.
    assert.equal(disconnectingReading(30_000, 400), '1s');
    assert.equal(disconnectingReading(30_000, 0), '0s');
    for (const remaining of [1_000, 12_500, 30_000]) {
      assert.ok(!/second|minute|hour/.test(disconnectingReading(30_000, remaining)));
    }
  });

  it('reads a window nobody can watch in the largest whole unit it still has', () => {
    // The server's own number can be anything up to an hour, and 3600 seconds is not a countdown
    // any person reads: past a minute the card falls back to `graceWording`'s unit, rounded down so
    // the reading never hands the guest time the room does not have.
    assert.equal(disconnectingReading(60_000, 60_000), '1 minute');
    assert.equal(disconnectingReading(600_000, 599_999), '9 minutes');
    assert.equal(disconnectingReading(3_600_000, 3_600_000), '1 hour');
  });

  it('the grace wording itself holds every window without asking the guest to divide', () => {
    assert.equal(graceWording(30_000), '30 seconds');
    assert.equal(graceWording(1_000), '1 second');
    assert.equal(graceWording(60_000), '1 minute');
    assert.equal(graceWording(3_600_000), '1 hour');
    assert.equal(graceWording(500), 'a moment');
  });
});

describe('the session card', () => {
  it('stands the host leaving in the warning colour, with the window and its bar', () => {
    const card = cardElement();
    const timer = ticking();
    let clock = 1_000_000;
    const session = wireSessionCard(card.element as unknown as HTMLElement, {
      now: () => clock,
      schedule: timer.schedule,
      cancel: timer.cancel,
    });
    assert.equal(card.element.hidden, true, 'an untouched card paints something');

    session.away('Jo', 30_000);
    assert.equal(card.element.hidden, false, 'the host leaving paints nothing');
    assert.equal(card.element.dataset.tone, 'grace', 'the countdown is not the warning colour');
    assert.equal(card.msg.textContent, 'Jo left the session');
    assert.equal(card.when.textContent, 'Disconnecting in 30s');
    assert.equal(card.bar.hidden, false, 'the card draws no bar');
    assert.equal(card.bar.style.transform, 'scaleX(1)', 'the bar does not start full');

    // Halfway through: the line and the bar are the same reading, and every tick reads the clock
    // again rather than lowering a value of its own.
    clock += 15_000;
    timer.runs[0]?.();
    assert.equal(card.when.textContent, 'Disconnecting in 15s', 'the countdown does not move');
    assert.equal(card.bar.style.transform, 'scaleX(0.5)', 'the bar does not drain with the count');

    // The window runs out: the same card, red, saying what the room is now, and no bar to drain.
    clock += 15_000;
    timer.runs[0]?.();
    assert.equal(card.element.dataset.tone, 'over', 'the card stays a warning when the room is gone');
    assert.equal(card.msg.textContent, 'The session ended');
    assert.equal(card.when.textContent, 'Host disconnected');
    assert.equal(card.bar.hidden, true, 'the bar drains for a window that has run out');
    assert.equal(timer.runs.length, 1, 'the clock kept running past the deadline');
  });

  it('says the news once, to a screen reader, rather than once a second', () => {
    const card = cardElement();
    const timer = ticking();
    let clock = 0;
    const session = wireSessionCard(card.element as unknown as HTMLElement, {
      now: () => clock,
      schedule: timer.schedule,
      cancel: timer.cancel,
    });
    session.away('Jo', 30_000);
    // The whole window, as a unit: a reader that heard the ticking line would hear thirty of these.
    assert.equal(card.sr.textContent, 'Jo left the session. The room disconnects in 30 seconds.');
    const spoken = card.sr.textContent;
    clock += 1_000;
    timer.runs[0]?.();
    assert.equal(card.when.textContent, 'Disconnecting in 29s', 'the ticking line did not move');
    assert.equal(card.sr.textContent, spoken, 'the count is announced, once a second');
    // The ticking line is hidden from assistive tech: the card's own sentence is the whole of what
    // is read.
    assert.match(html, /<span class="msg" aria-hidden="true"><\/span>/);
    assert.match(html, /<span class="when" aria-hidden="true"><\/span>/);
  });

  it('says the host is back in the plain colour, and takes its own sentence down', () => {
    const card = cardElement();
    const timer = ticking();
    const session = wireSessionCard(card.element as unknown as HTMLElement, {
      now: () => 0,
      schedule: timer.schedule,
      cancel: timer.cancel,
    });
    session.say(hostBackSentence('Jo'), HOST_BACK_STAND_MS);
    assert.equal(card.msg.textContent, 'Jo is back — the session continues.');
    assert.equal(card.element.dataset.tone, 'plain', 'news about the room wears the warning colour');
    assert.equal(card.when.hidden, true, 'a one-line sentence still draws the countdown line');
    assert.equal(card.bar.hidden, true, 'a one-line sentence still draws the bar');
    assert.equal(card.sr.textContent, 'Jo is back — the session continues.');
    assert.deepEqual(timer.delays, [HOST_BACK_STAND_MS], 'the sentence never leaves on its own');
    timer.runs[0]?.();
    assert.equal(card.element.hidden, true, 'the sentence stood for ever');
  });

  it('the all-clear ends the countdown and leaves a standing sentence alone', () => {
    const card = cardElement();
    const timer = ticking();
    const session = wireSessionCard(card.element as unknown as HTMLElement, {
      now: () => 0,
      schedule: timer.schedule,
      cancel: timer.cancel,
    });
    session.endAway();
    assert.equal(card.element.hidden, true, 'an untouched card was left dirty');
    session.away('Jo', 30_000);
    session.endAway();
    assert.equal(card.element.hidden, true, 'the countdown survived the all-clear');
    // The attach frame and the membership report arrive in the same burst: a report that took the
    // whole card down would wipe the sentence the guest has to read.
    session.away('Jo', 30_000);
    session.say(hostBackSentence('Jo'), HOST_BACK_STAND_MS);
    session.endAway();
    assert.equal(card.msg.textContent, 'Jo is back — the session continues.');
    timer.runs.at(-1)?.();
    assert.equal(card.element.hidden, true, 'the return was left standing for ever');
  });

  it('a dropped socket wears a line that stands until the room answers', () => {
    const card = cardElement();
    const timer = ticking();
    const session = wireSessionCard(card.element as unknown as HTMLElement, {
      now: () => 0,
      schedule: timer.schedule,
      cancel: timer.cancel,
    });
    session.dropped(RECONNECTING_NOTE);
    assert.equal(card.msg.textContent, RECONNECTING_NOTE);
    assert.equal(timer.runs.length, 0, 'the dropped line armed a timer of its own');
    // The all-clear arrives whatever the card is showing, and takes down that line alone: a
    // sentence said into the same card — the host's return — is not the one it ends.
    session.say(hostBackSentence('Jo'), HOST_BACK_STAND_MS);
    session.endDropped();
    assert.equal(card.msg.textContent, 'Jo is back — the session continues.');
    session.hide();
    session.dropped(RECONNECTING_NOTE);
    session.endDropped();
    assert.equal(card.element.hidden, true, 'the all-clear left the dropped line standing');
  });

  it('carries the host-leave sentence, and falls back to the role for a name it has not got', () => {
    assert.equal(hostLeftSentence('Jo'), 'Jo left the session');
    assert.equal(hostLeftSentence('  Jo  '), 'Jo left the session');
    // A guest that joined after the host's socket dropped never saw a name: the sentence names the
    // role rather than leaving a gap.
    assert.equal(hostLeftSentence(''), 'The host left the session');
    assert.equal(hostBackSentence(''), 'the host is back — the session continues.');
  });

  it('has no general-purpose news line', () => {
    // Design §6.2: a `status` sentence went with the four that found other homes. What is left of
    // the card is what changes what typing means — the countdown, the dropped socket — and the
    // host's return, which is the reason the countdown vanishing has one.
    const source = readFileSync(new URL('../src/browser/notice.ts', import.meta.url), 'utf8');
    assert.ok(!/status\(text: string\)/.test(source), 'the card carries a status method again');
    assert.ok(!/TRANSIENT_STAND_MS\b/.test(source.slice(source.indexOf('wireSessionCard'))),
      'a transient sentence stands for the one transient number');
  });
});

/** The plain objects the toasts build: what each is called, and what it holds. */
function toastDom() {
  const made: Array<{
    tag: string;
    className: string;
    textContent: string;
    attributes: Record<string, string>;
    children: unknown[];
    setAttribute: (name: string, value: string) => void;
    append: (...nodes: unknown[]) => void;
  }> = [];
  return {
    made,
    document: {
      createElement: (tag: string) => {
        const element = {
          tag,
          className: '',
          textContent: '',
          attributes: {} as Record<string, string>,
          children: [] as unknown[],
          setAttribute(name: string, value: string): void {
            element.attributes[name] = value;
          },
          append(...nodes: unknown[]): void {
            element.children.push(...nodes);
          },
        };
        made.push(element);
        return element;
      },
    },
  };
}

/** One element that holds what it was handed, as `#toasts` does. */
function listOf() {
  const element = {
    children: [] as unknown[],
    hidden: false,
    textContent: '',
    replaceChildren(...nodes: unknown[]): void {
      element.children = [...nodes];
    },
  };
  return element;
}

function textOf(node: { textContent?: string; children?: unknown[] }): string {
  return (
    (node.textContent ?? '') +
    (node.children ?? [])
      .map((child) => textOf(child as { textContent?: string; children?: unknown[] }))
      .join('')
  );
}

describe('the download toasts', () => {
  it('shows two at a time and counts the rest, oldest first', () => {
    const { made, document } = toastDom();
    const real = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = document;
    try {
      const list = listOf();
      const more = listOf();
      const timer = ticking();
      const toasts = wireDownloadToasts(
        list as unknown as HTMLElement,
        more as unknown as HTMLElement,
        { schedule: timer.schedule },
      );
      toasts.downloaded('src/main.rs');
      assert.equal(list.children.length, 1);
      assert.equal(textOf(list.children[0] as never), 'Downloaded main.rs', 'the toast names the path');
      assert.equal(more.hidden, true, 'one toast is counted as more');
      assert.deepEqual(timer.delays, [TOAST_STAND_MS], 'a toast does not stand the design’s 2.2 s');

      toasts.downloaded('docs/a.md');
      toasts.downloaded('notes.txt');
      assert.equal(list.children.length, TOASTS_SHOWN, 'a burst is not capped at two');
      assert.deepEqual(list.children.map((toast) => textOf(toast as never)), [
        'Downloaded main.rs',
        'Downloaded a.md',
      ], 'the newest toast jumped the one being read');
      assert.equal(more.hidden, false, 'the rest of a burst is not counted');
      assert.equal(more.textContent, '+1 more');

      // Each toast's own clock takes it down, and the queue moves up into the room it leaves.
      const first = timer.runs[0];
      first?.();
      assert.deepEqual(list.children.map((toast) => textOf(toast as never)), [
        'Downloaded a.md',
        'Downloaded notes.txt',
      ], 'the queue did not move up');
      assert.equal(more.hidden, true, 'an empty queue still counts more');
      assert.equal(more.textContent, '');
      timer.runs[1]?.();
      assert.equal(list.children.length, 1);
      timer.runs[2]?.();
      assert.equal(list.children.length, 0, 'the last toast never left');
      assert.ok(made.length > 0, 'the toasts built no elements at all');
    } finally {
      (globalThis as { document?: unknown }).document = real;
    }
  });

  it('names the leaf, because the row it was asked from named the rest', () => {
    assert.equal(downloadedSentence('src/main.rs'), 'Downloaded main.rs');
    assert.equal(downloadedSentence('notes.txt'), 'Downloaded notes.txt');
  });
});

describe('the column itself', () => {
  it('floats over the workspace and takes no click from what it covers', () => {
    const column = allOf('#notices');
    assert.match(column, /position:\s*absolute/, 'the column is in the flow, so it pushes the workspace');
    assert.match(column, /pointer-events:\s*none/, 'the column takes a click meant for the editor');
    assert.ok(!/top:\s*0\s*;/.test(column), 'the column hard-codes a top the bundle is meant to measure');
    // And the card and a toast are one shape, so a column of them reads as one column.
    assert.match(allOf('#session-card'), /color:\s*var\(--warning\)/, 'the card is not the warning colour');
    assert.match(allOf('.toast'), /color:\s*var\(--mocha-sky\)/, 'a toast is not the design’s sky');
    assert.match(allOf("#session-card[data-tone='over']"), /var\(--danger\)/, 'a window that ran out stays a warning');
    assert.match(allOf('#session-card .bar'), /height:\s*2px/, 'the bar is not the design’s 2 px');
  });

  it('is placed below the bar, and below the phone’s strip as well', () => {
    assert.match(
      main,
      /function placeNotices\(\): void \{\n\s+const strip = phoneLayout\.matches \? fileStrip\.offsetHeight : 0;\n\s+noticesPane\.style\.top = `\$\{sessionBar\.offsetHeight \+ strip \+ 10\}px`;/,
      'the column is not cleared of the bar, or of the strip a phone runs the width of',
    );
    // Measured where the bar's own shape can change — the faces are what makes a phone's bar tall —
    // and where the window or the panel moving changes what it has to clear.
    assert.match(main, /placeOpenMenu\(\);\n\s+\/\/ The faces[\s\S]{0,200}?placeNotices\(\);/, 'the column is never placed');
    assert.match(main, /addEventListener\('resize',[\s\S]{0,80}?placeNotices\(\)/, 'a resized window leaves the column behind');
    assert.match(main, /syncEmptyEditor\(\);\n\s+\/\/ The workspace is a different height[\s\S]{0,80}?placeNotices\(\);/, 'opening the panel leaves the column over the tree');
  });
});

describe('the alert and the tap line live in the column with the rest', () => {
  it('the shell has one home for a sentence over the workspace', () => {
    const column = /<div id="notices">([\s\S]*?)\n      <\/div>/.exec(html)?.[1] ?? '';
    assert.notEqual(column, '', 'the shell has no notices column');
    for (const id of ['session-card', 'toasts', 'toasts-more', 'alert', 'peek']) {
      assert.ok(column.includes(`id="${id}"`), `#${id} is not in the notices column`);
    }
    assert.ok(!/#alert\s*\{[^}]*position:\s*fixed/.test(style), 'the alert is anchored to the page');
    assert.ok(!/#peek\s*\{[^}]*position:\s*fixed/.test(style), 'the tap line is anchored to the page');
    assert.ok(!style.includes('--keyboard-inset'), 'a rule still parks a line under the keyboard');
    assert.ok(!main.includes('keyboardInsetFor'), 'the page still computes a keyboard inset for nothing');
  });

  it('a failure and a tap stand and leave on the one transient number', () => {
    assert.equal(TRANSIENT_STAND_MS, 7000);
  });
});
