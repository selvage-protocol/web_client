/**
 * The first painted frame is the final card.
 *
 * The shell's inline script runs while the parser is still reading the markup,
 * so what it decides is what paints — and the bundle's `initJoinCard` decides
 * the same things (which intent the card has, down to the heading it reads and
 * the action it leads with, and the remembered name) when it takes over. This
 * file runs both against the same inputs and holds them to the same answer.
 *
 * Owner defect (2026-09-18): on a bare open the first frame was a card with no
 * paste box and `Selvage mark` as the mark's alt text — the 60 KB PNG had not
 * arrived — and the layout then moved 40 px under the reader as the bundle
 * filled both in.
 */

import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { DISPLAY_NAME_KEY, initJoinCard } from '../src/browser/join.ts';
import type { JoinCardElements } from '../src/browser/join.ts';
import { pageQueryParams } from '../src/browser/share.ts';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
const card = html.slice(html.indexOf('<div id="join" class="card-start">'), html.indexOf('id="workspace"'));

/** The one inline script: every pre-bundle decision the shell makes. */
function inlineScript(): string {
  const found = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(found !== null, 'the shell carries no inline script');
  return found[1] ?? '';
}

interface FakeElement {
  hidden: boolean;
  open: boolean;
  className: string;
  value: string;
  disabled: boolean;
  textContent: string;
  addEventListener(type: string, listener: (event: unknown) => void): void;
}

/** What a fired event looks like to the shell: a key, and a form's own cancel. */
interface FiredEvent {
  key?: string;
  repeat?: boolean;
  defaultPrevented: boolean;
  preventDefault(): void;
}

interface ShellState {
  pane: { className: string };
  startHeading: { hidden: boolean };
  joinHeading: { hidden: boolean };
  invitePath: { open: boolean };
  inviteReveal: { hidden: boolean };
  inviteWrap: { hidden: boolean };
  nameInput: { value: string };
  /** Read live, so what a fired event decided is what the test sees. */
  readonly armed: boolean;
  readonly pending: boolean;
  /** Whether the shell's own "still loading" line is on the card. */
  readonly waiting: boolean;
  /** The card's message line, as the shell left it. */
  message: { hidden: boolean; textContent: string };
  joinButton: { disabled: boolean; textContent: string };
  /** Enter in a field, as the browser delivers it. */
  enter(id: string): FiredEvent;
  /** A form submission, as the form delivers it — the shell's own guard on top of the markup's. */
  submit(): FiredEvent;
  /** Arms the card the way the bundle does, so the shell's own guards can be seen to stand aside. */
  arm(): void;
}

/** What the card holds when the shell has run; `heldSubmit` is the markup's own hold on a submit. */
interface ShellOpen {
  search: string;
  stored: string;
  heldJoin?: boolean;
  heldSubmit?: boolean;
}

/**
 * What the page is at the moment the parser has run the script and has not yet
 * painted: the markup's own state, then whatever the script decides. The
 * markup state is read from the shell, never assumed — a card whose paste box
 * is only hidden in the markup is exactly the frame that flashed, and so is a
 * card that paints the other intent and is corrected once the bundle lands.
 */
function runShell(open: ShellOpen): ShellState {
  const { search, stored } = open;
  const markupClass = /<div id="join"[^>]*\sclass="([^"]*)"/.exec(html)?.[1] ?? '';
  const markupOpen = /<details id="invite-path"[^>]*\sopen/.test(html);
  const markupHides = (id: string): boolean =>
    new RegExp(`<(?:h1|label|summary|div|p) id="${id}"[^>]*\\shidden`).test(html);
  const elements = new Map<string, Array<{ type: string; listener: (event: unknown) => void }>>();
  const nodes = new Map<string, FakeElement>();
  const element = (id: string): FakeElement => {
    let found = nodes.get(id);
    if (found === undefined) {
      found = {
        hidden: markupHides(id),
        open: id === 'invite-path' ? markupOpen : false,
        className: id === 'join' ? markupClass : '',
        value: '',
        disabled: false,
        textContent: '',
        addEventListener: (type: string, listener: (event: unknown) => void) => {
          const forNode = elements.get(id) ?? [];
          forNode.push({ type, listener });
          elements.set(id, forNode);
        },
      };
      nodes.set(id, found);
    }
    return found;
  };
  const window = {
    location: { search },
    localStorage: { getItem: (key: string) => (key === DISPLAY_NAME_KEY ? stored : null) },
    __selvageJoinArmed: false,
    __selvagePendingJoin: open.heldJoin ?? false,
    __selvagePendingSubmit: open.heldSubmit ?? false,
    __selvageWaiting: false,
  };
  const document = { getElementById: (id: string) => element(id) };
  // eslint-disable-next-line no-new-func
  const run = new Function('window', 'document', 'URLSearchParams', inlineScript());
  run(window, document, URLSearchParams);
  const fire = (id: string, type: string, event: Partial<FiredEvent>): FiredEvent => {
    const fired: FiredEvent = {
      defaultPrevented: false,
      preventDefault() {
        fired.defaultPrevented = true;
      },
      ...event,
    };
    for (const registered of elements.get(id) ?? []) {
      if (registered.type === type) {
        registered.listener(fired);
      }
    }
    return fired;
  };
  return {
    pane: element('join'),
    startHeading: element('start-heading'),
    joinHeading: element('join-heading'),
    invitePath: element('invite-path'),
    inviteReveal: element('invite-reveal'),
    inviteWrap: element('invite-wrap'),
    nameInput: element('name'),
    message: element('join-message'),
    joinButton: element('join-button'),
    get armed() {
      return window.__selvageJoinArmed;
    },
    get pending() {
      return window.__selvagePendingJoin;
    },
    get waiting() {
      return window.__selvageWaiting;
    },
    enter: (id: string) => fire(id, 'keydown', { key: 'Enter', repeat: false }),
    submit: () => fire('join-form', 'submit', {}),
    arm: () => {
      window.__selvageJoinArmed = true;
    },
  };
}

function bundleCard(search: string, stored: string): JoinCardElements {
  const elements: JoinCardElements = {
    pane: { className: '' },
    startHeading: { hidden: false },
    joinHeading: { hidden: false },
    invitePath: { open: false },
    inviteReveal: { hidden: false },
    inviteWrap: { hidden: false },
    inviteInput: { value: '' },
    nameInput: { value: '' },
  };
  initJoinCard(elements, pageQueryParams(search), {
    getItem: (key: string) => (key === DISPLAY_NAME_KEY ? stored : null),
  });
  return elements;
}

describe('the card shell decides the first frame', () => {
  const SEARCHES = [
    '',
    '?room=r-1&token=tok',
    '?room=r-1',
    '?token=tok',
    '?room=&token=',
    '?room=r-1&token=tok?debug=1',
    '?debug=1&room=r-1&token=tok',
    '?room=%20r-1%20&token=tok',
  ];
  const STORED = ['', 'browser'];

  for (const search of SEARCHES) {
    for (const stored of STORED) {
      const where = `${search === '' ? 'a bare open' : search} with ${stored === '' ? 'no' : `"${stored}"`} remembered`;
      it(`${where}: the shell and the bundle agree`, () => {
        const shell = runShell({ search, stored });
        const bundle = bundleCard(search, stored);
        assert.equal(shell.pane.className, bundle.pane.className, `the leading action disagrees on ${where}`);
        assert.equal(shell.startHeading.hidden, bundle.startHeading.hidden, `the start heading disagrees on ${where}`);
        assert.equal(shell.joinHeading.hidden, bundle.joinHeading.hidden, `the join heading disagrees on ${where}`);
        assert.equal(shell.invitePath.open, bundle.invitePath.open, `the invite path disagrees on ${where}`);
        assert.equal(shell.inviteReveal.hidden, bundle.inviteReveal.hidden, `the invite line disagrees on ${where}`);
        assert.equal(shell.inviteWrap.hidden, bundle.inviteWrap.hidden, `the paste box disagrees on ${where}`);
        assert.equal(shell.nameInput.value, bundle.nameInput.value, `the name field disagrees on ${where}`);
        assert.equal(shell.armed, false, 'the inline script armed the card before the bundle');
      });
    }
  }

  it('a bare open paints the start card with the invite path shut; a link open paints the join card', () => {
    const bare = runShell({ search: '', stored: '' });
    assert.equal(bare.pane.className, 'card-start', 'a bare open paints the other intent');
    assert.equal(bare.startHeading.hidden, false, 'a bare open paints without its heading');
    assert.equal(bare.joinHeading.hidden, true, 'a bare open paints the join heading');
    assert.equal(bare.invitePath.open, false, 'a bare open still paints an open invite path');
    assert.equal(bare.inviteReveal.hidden, false, 'a bare open asks for a link nobody offered');

    const linked = runShell({ search: '?room=r-1&token=tok', stored: '' });
    assert.equal(linked.pane.className, 'card-join', 'a link open paints the start card');
    assert.equal(linked.joinHeading.hidden, false, 'a link open paints without its heading');
    assert.equal(linked.startHeading.hidden, true, 'a link open paints the start heading');
    assert.equal(linked.invitePath.open, true, 'a link open paints the invite path shut');
    assert.equal(linked.inviteWrap.hidden, true, 'a link open paints a paste box it will take away');
  });

  it('the remembered name is on the card before the bundle arrives', () => {
    assert.equal(runShell({ search: '', stored: 'browser' }).nameInput.value, 'browser');
    assert.equal(runShell({ search: '?room=r-1&token=tok', stored: 'browser' }).nameInput.value, 'browser');
  });

  it('the held-submit guard is installed before the card block, so nothing can disarm it', () => {
    // The guard is the safety net: if the card block below it threw, an early
    // submit would navigate away and wipe the fields.
    const guard = html.indexOf('__selvageJoinArmed');
    const card = html.indexOf("getElementById('start-heading')");
    assert.ok(guard !== -1, 'no pre-bundle guard');
    assert.ok(card !== -1, 'no pre-paint card block');
    assert.ok(guard < card, 'the card block runs before the guard that protects the form');
  });

  it('holds a submit the card gets before any script has run, without guessing its intent', () => {
    // A deployment that defers every script — the demo's Cloudflare Rocket
    // Loader does — has no guard until one runs, and the room's own server
    // answers a form action with a CSP refusal, so a join made in that window
    // can neither navigate nor leave a trace. The markup is the only thing
    // standing there, so the hold is an attribute on the form — and it records
    // only that a submit was held: which of the card's two actions it was is
    // read from the card itself, once the card's own script has painted it.
    const tag = /<form id="join-form"[^>]*>/.exec(html)?.[0];
    assert.ok(tag !== undefined, 'the shell carries no join form');
    const handler = /\sonsubmit="([^"]*)"/.exec(tag)?.[1];
    assert.ok(handler !== undefined, `the form carries no pre-script hold: ${tag}`);
    const preScript = { __selvageJoinArmed: false };
    // eslint-disable-next-line no-new-func
    const cancel: unknown = new Function('window', handler)(preScript);
    assert.equal(cancel, false, 'the hold does not cancel the submission it holds');
    assert.equal(preScript.__selvagePendingSubmit, true, 'a held submit is never recorded for the shell');
    assert.ok(
      !('__selvagePendingJoin' in preScript),
      'the markup decides the intent, which it cannot read before any script has run',
    );
    // Once the bundle is armed the hold has no job: the guard's own listener
    // and the bundle's handler own the submit from there.
    const armed = { __selvageJoinArmed: true };
    // eslint-disable-next-line no-new-func
    new Function('window', handler)(armed);
    assert.equal(armed.__selvagePendingSubmit, undefined, 'the hold records a submit the bundle already handles');
  });

  it('settles a submit the markup held before the script ran, once the intent is readable', () => {
    // The attribute cannot tell the two intents apart; the script can, and it
    // always runs before the bundle. A submit held on a bare page with the
    // disclosure shut is the name field's Enter, not a join.
    const bare = runShell({ search: '', stored: '', heldSubmit: true });
    assert.equal(bare.pending, false, 'the markup\'s held submit was queued as a join on a bare page');
    assert.equal(bare.waiting, true, 'the held submit was answered with nothing at all');
    assert.notEqual(
      bare.joinButton.textContent,
      'Joining…',
      "the bare page's held submit put the join verb on the button",
    );
    const guest = runShell({ search: '?room=r-1&token=tok', stored: '', heldSubmit: true });
    assert.equal(guest.pending, true, 'a guest page dropped the submit the markup held for it');
  });

  it('leaves a held join alone when the shell script arrives', () => {
    // The markup held it and the bundle is the only thing that can replay it,
    // so a shell script that cleared the flag on arrival would drop the join
    // instead of handing it on.
    const shell = runShell({ search: '', stored: '', heldJoin: true });
    assert.equal(shell.armed, false, 'the inline script armed the card before the bundle');
    assert.equal(shell.pending, true, 'the inline script dropped the join the markup held for it');
    const main = readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8');
    assert.match(
      main,
      /__selvagePendingJoin === true[\s\S]{0,120}attemptJoin\(\)/,
      'nothing in the bundle replays a join the shell held',
    );
  });

  it('a pre-bundle Enter in the name field is the card\'s own action, never the join', () => {
    // M4: the shell's form *is* the invite path, so an Enter in the name field used to be held
    // as a join and replayed as one once the bundle landed — on a page whose heading is "Start a
    // shared session", answered with "Paste an invite link to join." The field belongs to the
    // card, so the held act is the card's own; it is answered now (the start action needs a
    // folder picker, which the browser answers only under a click of the person's own) and the
    // card is live a moment later.
    const bare = runShell({ search: '', stored: '' });
    const fired = bare.enter('name');
    assert.equal(fired.defaultPrevented, true, 'the implicit submission is left to find the join');
    assert.equal(bare.pending, false, "a bare page's Enter was queued as a join");
    assert.equal(bare.waiting, true, 'the held Enter was answered with nothing at all');
    assert.equal(bare.message.hidden, false, 'the line that answers it is hidden');
    assert.match(bare.message.textContent, /still loading/, 'the answer does not say what is happening');
    assert.match(bare.message.textContent, /Press Enter again/, 'the answer names no next step');
    assert.notEqual(bare.joinButton.textContent, 'Joining…', 'the wrong verb is on the button');
    assert.equal(bare.joinButton.disabled, false, 'the join button was disabled for a join nobody asked for');
  });

  it("a pre-bundle Enter in the name field on a guest's card is the join, and says so", () => {
    const guest = runShell({ search: '?room=r-1&token=tok', stored: '' });
    const fired = guest.enter('name');
    assert.equal(fired.defaultPrevented, true, 'the submission is left to navigate');
    assert.equal(guest.pending, true, "a guest page's Enter was not held for the join");
    assert.equal(guest.joinButton.textContent, 'Joining…', 'the held join never answers the click');
    assert.equal(guest.joinButton.disabled, true, 'the held join leaves the button live');
    assert.equal(guest.waiting, false, 'a guest page is told the card is still loading');
  });

  it('stands aside once the bundle has armed the card, which wires Enter itself', () => {
    const bare = runShell({ search: '', stored: '' });
    bare.arm();
    bare.enter('name');
    assert.equal(bare.waiting, false, 'the shell answered an Enter the bundle already owns');
    const held = bare.submit();
    assert.equal(held.defaultPrevented, false, 'the shell still cancels the bundle\'s own submits');
    assert.equal(bare.pending, false, 'the shell queued a join under the armed card');
  });

  it('settles a submit by the card it is about: the disclosure decides, not the form', () => {
    // The form is the invite path, so a submit from it is a join — unless the path is shut, where
    // nothing in it can be clicked or pasted and the only thing that can submit is the name
    // field's Enter arriving the way the form makes of it. That reading is what a programmatic
    // submit (and the review's own probe) gets, and it is the same reading the keydown listener
    // makes: one rule, two doors into it.
    const shut = runShell({ search: '', stored: '' });
    shut.submit();
    assert.equal(shut.pending, false, 'a submit with the invite path shut was queued as a join');
    assert.equal(shut.waiting, true, 'a submit with the invite path shut was answered with nothing');

    const open = runShell({ search: '', stored: '' });
    open.invitePath.open = true;
    open.submit();
    assert.equal(open.pending, true, 'a submit from the open invite path was not held as a join');
    assert.equal(open.waiting, false, 'the card says it is still loading instead of joining');

    const guest = runShell({ search: '?room=r-1&token=tok', stored: '' });
    guest.submit();
    assert.equal(guest.pending, true, "a guest page's submit was not held as a join");
  });

  it('the bundle takes the shell\'s line over with what it knows, and replays a held join once', () => {
    const main = readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8');
    assert.match(
      main,
      /__selvageWaiting === true[\s\S]{0,200}joinMessage\.hidden = hostingNotice === undefined/,
      "the shell's loading line is never taken off the card",
    );
    assert.match(
      main,
      /__selvagePendingJoin === true[\s\S]{0,120}attemptJoin\(\)/,
      'a join the shell held is never replayed',
    );
  });

  it('the script runs while the parser still holds the shell', () => {
    const at = html.indexOf('<script>');
    assert.ok(at !== -1, 'no inline script in the shell');
    for (const id of ['start-heading', 'join-heading', 'invite-path', 'invite-reveal', 'name']) {
      assert.ok(html.indexOf(`id="${id}"`) < at, `the script addresses ${id} before the markup names it`);
    }
    assert.ok(at < html.indexOf('<script type="module"'), 'the module script is parsed first');
    assert.ok(
      !/<script[^>]*\ssrc=/.test(html.slice(0, html.indexOf('<script type="module"'))),
      'the pre-paint path waits on a fetch',
    );
  });
});

describe('the mark is painted by the shell, never fetched', () => {
  it('the card carries no image element, so no frame can show alt text or a broken box', () => {
    assert.ok(!/<img/i.test(card), 'the card still asks the network for the mark');
    assert.ok(!card.includes('alt='), 'the card mark still carries alt text');
    assert.ok(!html.includes('alt="Selvage mark"'), 'the mark alt text survives in the shell');
    assert.ok(
      /<span class="mark" aria-hidden="true"><\/span>/.test(card),
      'the card mark is not a decorative span wearing the bytes the shell carries',
    );
  });

  it("the mark is the owner's pixels in the document, carried once", () => {
    // A preload is still a race — the mark request can lose to the first paint
    // — so the bytes are in the shell instead (test/identity.test.ts checks
    // them against the site's master). Nothing here fetches anything.
    assert.ok(
      !/(src|href)=["']?mark-transparent\.png/.test(html) && !/url\(["']?mark-transparent\.png/.test(html),
      'the shell still loads the PNG mark',
    );
    assert.ok(!html.includes('favicon.svg'), 'the blank site icon still ships as a favicon');
    assert.ok(!/<link[^>]*as="image"/.test(html), 'the shell preloads an image instead');
    assert.ok(/url\("data:image\/png;base64,[^"]+"\)/.test(style), 'the mark is not in the shell');
    assert.equal(
      (style.match(/url\("data:image\/png;base64,/g) ?? []).length,
      1,
      'the mark is carried more than once',
    );
    const uses = html.match(/<span class="mark" aria-hidden="true">/g) ?? [];
    assert.equal(uses.length, 2, `the card and the brand do not both wear the mark: ${uses.length}`);
  });

  it('both marks are sized by the inline block, so first paint is final', () => {
    for (const rule of ['#join .mark', '#brand .mark']) {
      const found = style.match(new RegExp(`${rule.replace('.', '\\.')}\\s*\\{[^}]*\\}`));
      assert.ok(found !== null, `no ${rule} rule in the shell`);
      assert.match(found[0], /width:/, `${rule} has no width before paint`);
      assert.match(found[0], /height:/, `${rule} has no height before paint`);
    }
  });
});

/**
 * The backdrop behind the card is a drawing of an editor, never content.
 *
 * Owner defect (2026-09-21): grey bars of arbitrary widths stood where text
 * should be, and read as a document that had failed to load rather than as
 * decoration. It is a file tree and a few lines of code now — and this block is
 * what keeps it a picture: nothing in it reachable, nothing in it a claim, no
 * element that is not a drawing, and no colour that is not one of the page's
 * own tokens. The state it guards is the first painted frame, which is why it
 * lives here beside the mark: a backdrop that silently became unstyled, or
 * became something a reader is asked to read, is the defect coming back.
 */
describe('the pre-join backdrop is a picture of an editor', () => {
  const preview = html.slice(html.indexOf('<div id="preview"'), html.indexOf('<div id="veil"'));
  const openingTag = preview.slice(0, preview.indexOf('>') + 1);
  const classNames = [
    ...new Set(
      [...preview.matchAll(/class="([^"]*)"/g)].flatMap((match) => (match[1] ?? '').split(/\s+/)),
    ),
  ].filter((name) => name !== '');
  /** The backdrop's own rules, read off the inline block that paints it. */
  const rules = style.match(/#preview[^{}]*\{[^{}]*\}/g) ?? [];
  const code = preview.slice(
    preview.indexOf('<pre class="fake-code">'),
    preview.indexOf('</pre>'),
  );

  it('is inline HTML the parser has read before any script, so first paint is final', () => {
    const at = html.indexOf('<div id="preview"');
    assert.ok(at !== -1, 'no pre-join backdrop in the shell');
    assert.ok(at < html.indexOf('<script'), 'the backdrop renders only after a script runs');
    assert.ok(!html.includes('fake-bar'), 'the grey bars where text should be are back');
  });

  it('is a file tree and a code excerpt, not bars of arbitrary widths', () => {
    assert.ok((preview.match(/class="fake-dir"/g) ?? []).length >= 2, 'the tree carries no folder');
    assert.ok((preview.match(/class="fake-file"/g) ?? []).length >= 3, 'the tree names no file');
    assert.ok(code !== '', 'no code excerpt beside the tree');
    assert.ok(code.split('\n').length >= 4, `the excerpt is one line: ${code}`);
    assert.ok(
      (preview.match(/class="tok-(?:key|lit)"/g) ?? []).length >= 3,
      'the excerpt is not syntax-coloured',
    );
  });

  it('closes every box it opens, so the card never lands inside the picture', () => {
    // `#preview` is `inert` and takes no pointer, and the parser closes a box
    // the markup left open only at the end of the document: one missing
    // `</div>` here swallows `#veil` and the join card into that subtree, and
    // the card stops taking a click. A drawing that breaks the page it
    // decorates is the defect this whole block exists to keep out.
    for (const tag of ['div', 'pre', 'span']) {
      const opens = (preview.match(new RegExp(`<${tag}\\b`, 'g')) ?? []).length;
      const closes = (preview.match(new RegExp(`</${tag}>`, 'g')) ?? []).length;
      assert.ok(opens > 0, `the scan reaches no <${tag}> in the backdrop`);
      assert.equal(opens, closes, `the backdrop leaves ${opens - closes} <${tag}> unclosed`);
    }
  });

  it('nothing in it is reachable by tab, by a screen reader or by a pointer', () => {
    assert.match(openingTag, /\saria-hidden="true"/, 'a screen reader is read a fake file tree');
    assert.match(openingTag, /\sinert[\s>]/, 'the backdrop is never inert');
    assert.ok(!/tabindex|contenteditable/i.test(preview), 'the backdrop takes focus');
    // The elements a drawing is allowed: boxes, spans and one code block. A
    // control, a link or a heading here is content wearing decoration's name.
    const tags = [...new Set([...preview.matchAll(/<\/?([a-z]+)/g)].map((match) => match[1] ?? ''))]
      .sort();
    assert.deepEqual(tags, ['div', 'pre', 'span'], `the backdrop carries ${tags.join(', ')}`);
    assert.match(rules.join(' '), /pointer-events:\s*none/, 'the backdrop takes a click');
    assert.match(rules.join(' '), /user-select:\s*none/, 'the backdrop can be selected');
  });

  it('claims nothing: no address, no credential, no material to act on', () => {
    for (const pattern of [
      /:\/\//,
      /\bwss?:/i,
      /\btoken\b/i,
      /[?&]room=/,
      /\d+\.\d+\.\d+\.\d+/,
    ]) {
      assert.ok(!pattern.test(preview), `the backdrop carries ${String(pattern)}`);
    }
  });

  it('paints in the page’s own tokens, so it cannot start a palette of its own', () => {
    const declared = new Set([...style.matchAll(/--([a-z-]+):\s*#/g)].map((match) => match[1] ?? ''));
    const painted = rules.flatMap((rule) =>
      [...rule.matchAll(/(?:^|[\s;{])(?:color|background):\s*([^;}]+)/g)].map((match) =>
        (match[1] ?? '').trim(),
      ),
    );
    // The scan has to reach the rules it claims to cover: a `#preview` block that
    // moved out from under it would otherwise report a clean palette.
    assert.ok(painted.length >= 5, `the backdrop declares ${painted.length} colours`);
    for (const value of painted) {
      const named = /^var\(--([a-z-]+)\)$/.exec(value);
      assert.ok(named !== null, `the backdrop paints a colour of its own: ${value}`);
      assert.ok(declared.has(named[1] ?? ''), `--${named[1]} is not one of the page's tokens`);
    }
  });

  it('is styled by the inline block, so no class of it waits on app.css to arrive', () => {
    assert.ok(classNames.length >= 5, `the backdrop wears ${classNames.length} classes`);
    for (const name of classNames) {
      assert.ok(
        new RegExp(`#preview[^{}]*\\.${name}(?![\\w-])`).test(style),
        `#preview .${name} is not styled inline`,
      );
    }
  });
});

/**
 * The backdrop is drawn at the size an editor is read at, and the document
 * in it runs past the bottom of the window.
 *
 * Owner defect (2026-09-22, the public demo): behind the card stood an
 * editor at 0.85em whose code stopped after four lines, and under `#veil`'s
 * blur a shrunken drawing of nothing in particular reads as an artifact —
 * the second time this backdrop has been read as decoration that failed
 * rather than as an editor. Every property the block above pins held of the
 * four-line version too, so what a later edit has to answer for is here: the
 * size the panes are set at, the shape of the gutter, how far the document
 * runs, and whether the tree is a project or a stub.
 */
describe('the pre-join backdrop is drawn at the size an editor is read at', () => {
  const preview = html.slice(html.indexOf('<div id="preview"'), html.indexOf('<div id="veil"'));
  const rules = style.match(/#preview[^{}]*\{[^{}]*\}/g) ?? [];
  const codeRule = rules.find((rule) => rule.startsWith('#preview .fake-main .fake-code')) ?? '';
  const code = preview.slice(preview.indexOf('<pre class="fake-code">'), preview.indexOf('</pre>'));
  /** The page's own type size, which the drawing is measured against. */
  const rootPx = Number(/html,\s*body\s*\{[^}]*font:\s*(\d+(?:\.\d+)?)px/.exec(style)?.[1]);
  const sizeEm = Number(/font:\s*([\d.]+)em/.exec(codeRule)?.[1]);
  const leading = Number(/font:\s*[\d.]+em\/([\d.]+)/.exec(codeRule)?.[1]);

  it('sets the tree and the code at no less than the page’s own size', () => {
    const sizes = rules.flatMap((rule) =>
      [...rule.matchAll(/font:\s*([\d.]+)em/g)].map((match) => Number(match[1])),
    );
    assert.ok(sizes.length >= 3, `the scan reached ${sizes.length} font declarations`);
    for (const size of sizes) {
      assert.ok(size >= 1, `a pane of the drawing is set at ${size}em, which the veil's blur eats`);
    }
  });

  it('numbers every line of the excerpt it draws, in order', () => {
    const open = '<div class="fake-nums">';
    const at = preview.indexOf(open);
    assert.ok(at !== -1, 'the code pane carries no gutter, so it is not read as code');
    const gutter = preview.slice(at + open.length, preview.indexOf('</div>', at));
    const lines = code.split('\n').length;
    assert.deepEqual(
      gutter.split('&#10;'),
      Array.from({ length: lines }, (_, index) => String(index + 1)),
      'the gutter does not name the lines the excerpt has',
    );
  });

  it('draws a document longer than the laptop window the card is read in', () => {
    // The arithmetic is the shell's own: lines, at the size the code pane is
    // set at, over the leading it is set with. An excerpt that stops inside
    // the window leaves the card under its last line, with a pane of empty
    // page below, which is the artifact this defect was.
    const laptopPx = 900;
    assert.ok(
      Number.isFinite(rootPx) && Number.isFinite(sizeEm) && Number.isFinite(leading),
      `the code pane's size is not declared: ${codeRule}` ,
    );
    const heightPx = code.split('\n').length * sizeEm * rootPx * leading;
    assert.ok(
      heightPx >= laptopPx,
      `the excerpt stands ${Math.round(heightPx)} px tall, inside a ${laptopPx} px window` ,
    );
  });

  it('draws a project in the tree, not a stub', () => {
    const files = (preview.match(/class="fake-file/g) ?? []).length;
    const folders = (preview.match(/class="fake-dir"/g) ?? []).length;
    assert.ok(files >= 12, `the tree names ${files} files`);
    assert.ok(folders >= 3, `the tree shows ${folders} folders`);
    assert.ok(
      /class="fake-file fake-open"/.test(preview),
      'no row in the tree is the file the code pane has open',
    );
  });
});
