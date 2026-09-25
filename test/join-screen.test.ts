/**
 * The join card a guest sees: one name question over a blurred preview, a
 * paste box only on a bare open, and plain-words failures on every
 * socket-failure surface. Owner standard: no connection plumbing anywhere
 * the guest can see — no `ws://`, no bare server address, no token
 * material, no engine words — only words and one next step. Diagnostics
 * live in the console (or behind `?debug=1`), never in default UI.
 */

import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ProtocolError,
  code as errCode,
  encodeKey,
  parseSessionUrl,
} from '../src/engine/index.ts';
import {
  DISPLAY_NAME_KEY,
  INCOMPLETE_INVITE_SENTENCE,
  inviteShortfall,
  joinOnEnter,
  loadDisplayName,
  resolveJoin,
  saveDisplayName,
  validateDisplayName,
} from '../src/browser/join.ts';
import {
  describeJoinError,
  describeJoinErrorForDisplay,
  joinFailureDetail,
} from '../src/browser/transport.ts';
import { buildShareLink, pageQueryParams, parsePageLink } from '../src/browser/share.ts';

const BASE = 'ws://127.0.0.1:9';
/** The page a guest is standing on when it is not the room's own page. */
const PAGE = 'http://127.0.0.1:9/';

/** Owner standard: no plumbing in anything the guest can see. */
function assertNoPlumbing(output: string, where: string): void {
  for (const [name, pattern] of [
    ['wire scheme', /ws:\/\//i],
    ['bare server address', /\d+\.\d+\.\d+\.\d+/],
    ['token material', /token=/i],
    ['close code', /400\d/],
    ['close wording', /close/i],
    ['socket wording', /socket/i],
    ['engine wording', /engine/i],
  ] as Array<[string, RegExp]>) {
    assert.ok(!pattern.test(output), `${where} leaks ${name}: ${output}`);
  }
}

/** Every failure reads as a plain situation with one next step. */
function assertOneAction(output: string, where: string): void {
  assert.ok(
    /retry|reload|fresh link|paste the whole link|shorten it to join|paste an invite/i.test(output),
    `${where} names no next step: ${output}`,
  );
}

/** No raw mechanism wording may reach the card on any join failure. */
function assertPlain(output: string): void {
  assertNoPlumbing(output, 'join failure');
  assertOneAction(output, 'join failure');
}

describe('display-name validation', () => {
  it('blank names keep the card copy', () => {
    assert.throws(() => validateDisplayName('   '), /Type the name other participants will see\./);
  });

  it('trims and returns the name', () => {
    assert.equal(validateDisplayName('  sam  '), 'sam');
  });

  it('32 units join; 33 are refused, never shortened', () => {
    assert.equal(validateDisplayName('a'.repeat(32)), 'a'.repeat(32));
    assert.throws(() => validateDisplayName('a'.repeat(33)), /allows 32.*Shorten it to join/);
  });

  it('counts the protocol unit: astral characters cost two', () => {
    assert.equal(validateDisplayName('😀'.repeat(16)).length, 32);
    assert.throws(() => validateDisplayName('😀'.repeat(17)), /34 characters/);
  });
});

describe('join targets', () => {
  it('a link in the address bar names the page\'s own server', () => {
    assert.deepEqual(
      resolveJoin(new URLSearchParams('room=r-1&token=tok'), '', PAGE),
      { base: BASE, room: 'r-1', token: 'tok', fragment: '' },
    );
  });

  it('a server= parameter in the address bar is an unknown parameter', () => {
    // The page was served by the room's server, so its origin is the server;
    // `server` names nothing the page reads.
    assert.deepEqual(
      resolveJoin(new URLSearchParams('room=r-1&token=tok&server=ws://other:8080'), '', PAGE),
      { base: BASE, room: 'r-1', token: 'tok', fragment: '' },
    );
  });

  it('a bare open joins from a pasted page link, at the link\'s own server', () => {
    assert.deepEqual(
      resolveJoin(new URLSearchParams(), 'https://edit.example/?room=r-1&token=tok', PAGE),
      { base: 'wss://edit.example', room: 'r-1', token: 'tok', fragment: '' },
    );
  });

  it('a bare open still accepts a whole wire invite', () => {
    const parsed = parseSessionUrl('ws://other:8080/session?room=r-1&token=tok');
    assert.ok(parsed?.join.room === 'r-1' && parsed?.join.token === 'tok');
    assert.deepEqual(
      resolveJoin(new URLSearchParams(), 'ws://other:8080/session?room=r-1&token=tok', PAGE),
      { base: 'ws://other:8080', room: 'r-1', token: 'tok', fragment: '' },
    );
  });

  it('a pasted wire invite keeps working with extras, fragments and a second ?', () => {
    // Foreign params are ignored; a fragment or an appended `?debug=1` must
    // not glue into the token the way the address-bar `?debug=1` once did. The
    // fragment itself is carried — it is `§5.1`'s fragment, which is how an
    // invite names its two keys, and what it names is read where the link is
    // handed to the engine.
    for (const invite of [
      'ws://other:8080/session?room=r-1&token=tok&debug=1&foo=bar',
      'ws://other:8080/session?token=tok&room=r-1&utm_source=x',
      'ws://other:8080/session?room=r-1&token=tok#frag',
      'ws://other:8080/session?room=r-1&token=tok?debug=1',
    ]) {
      assert.deepEqual(resolveJoin(new URLSearchParams(), invite, PAGE), {
        base: 'ws://other:8080',
        room: 'r-1',
        token: 'tok',
        fragment: invite.includes('#') ? '#frag' : '',
      });
    }
  });

  it('a pasted fragment keeps the paste-it-whole copy', () => {
    assert.throws(
      () => resolveJoin(new URLSearchParams(), 'just some words', PAGE),
      /That invite link does not name a session\. Paste the whole link\./,
    );
  });

  it('a bare open with nothing pasted asks for the link', () => {
    assert.throws(
      () => resolveJoin(new URLSearchParams(), '  ', PAGE),
      /Paste an invite link to join\./,
    );
  });

  it('a room without a token is not a link', () => {
    assert.throws(
      () => resolveJoin(new URLSearchParams('room=r-1'), '', PAGE),
      /Paste an invite link to join\./,
    );
  });

  it('a page link is bounded by its own origin, so nothing else can reach the socket', () => {
    // A page link's base is built from the link's own host and path, so the
    // request address is the one the link reads as naming: credentials, a
    // query or a fragment cannot put another address in it.
    for (const link of [
      'https://user:secret@edit.example/?room=r-1&token=tok',
      'https://edit.example/?room=r-1&token=tok#frag',
      'https://edit.example/?token=tok&room=r-1&server=file:///etc/passwd',
    ]) {
      assert.deepEqual(resolveJoin(new URLSearchParams(), link, PAGE), {
        base: 'wss://edit.example',
        room: 'r-1',
        token: 'tok',
        fragment: link.includes('#') ? '#frag' : '',
      });
    }
  });

  it('a wire invite may name a server, and only one this page can dial', () => {
    // A pasted wire invite names its server in its authority, and the guest's
    // own browser is what would read `<server>/meta` and open a socket at
    // `<server>/session` from it, so only the schemes a room can live on are
    // used: credentials and an unlisted scheme are the two shapes that reach
    // the base from there.
    for (const invite of [
      'ws://user:secret@other:8080/session?room=r-1&token=tok',
      'ws://user@other:8080/session?room=r-1&token=tok',
      'ftp://other:8080/session?room=r-1&token=tok',
      'data:text/html,x/session?room=r-1&token=tok',
    ]) {
      let thrown: Error | undefined;
      try {
        resolveJoin(new URLSearchParams(), invite, PAGE);
      } catch (error: unknown) {
        thrown = error as Error;
      }
      assert.ok(thrown !== undefined, `${invite} was admitted`);
      assertPlain(thrown.message);
    }
  });

  it('a wire invite on a scheme a room can live on is untouched', () => {
    for (const invite of [
      'ws://other:8080/session?room=r-1&token=tok',
      'wss://other:8443/session?room=r-1&token=tok',
      'ws://127.0.0.1:8117/session?room=r-1&token=tok',
      'wss://other:8443/proxy/session?room=r-1&token=tok',
    ]) {
      const parsed = parseSessionUrl(invite);
      assert.deepEqual(resolveJoin(new URLSearchParams(), invite, PAGE), {
        base: parsed?.base ?? '',
        room: 'r-1',
        token: 'tok',
        fragment: '',
      });
    }
  });
});


describe('display-name persistence', () => {
  it('round-trips through localStorage only', () => {
    const kept = new Map();
    const storage = {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
    };
    assert.equal(loadDisplayName(storage), '');
    saveDisplayName(storage, 'sam');
    assert.equal(loadDisplayName(storage), 'sam');
    assert.deepEqual([...kept.keys()], [DISPLAY_NAME_KEY]);
  });

  it('a refusing storage never breaks the card', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    assert.equal(loadDisplayName(broken), '');
    saveDisplayName(broken, 'sam');
  });
});

describe('brand heading', () => {
  it('the mark carries the brand and the words carry the one fact the bar has', () => {
    const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
    const bar = barOf(html);
    // A `Selvage` wordmark beside the mark was the brand twice and the fact never: what stands there
    // now is whose room this is, or whose folder is exposed.
    assert.ok(bar.includes('id="session-identity"'), 'the bar says nothing about which session it is');
    assert.ok(!bar.includes('>Selvage<'), 'the wordmark is still in the session bar');
    assert.ok(!bar.includes('room-label'), 'session text still beside the brand');
    const join = readFileSync(new URL('../src/browser/join.ts', import.meta.url), 'utf8');
    assert.ok(!join.includes('SESSION_HEADING'), 'session heading still exported');
  });

  it('names the folder a host is exposing, and whose room a guest is in', () => {
    const main = readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8');
    assert.match(main, /`Sharing “\$\{hostFolder\.name\}”`/, 'a host cannot read which folder it exposes');
    // The apostrophe is the page's: the pre-join card and the room's own copy use the typographic
    // one (`host.ts`), so a straight one here is the same phrase spelled two ways.
    assert.match(main, /`In \$\{host\.displayName\}\\u2019s session`/, 'a guest cannot read whose room it is');
    assert.match(main, /'In a shared session'/, 'a guest before the roster arrives reads nothing');
  });

  it('gives the card and the workspace one main landmark', () => {
    // The page the demo serves had none — the landing page has one — so a screen-reader user had no
    // landmark to jump to. What the page is for is one thing: the card before a session, and the
    // workspace in one. The deployment's own notice is appended after it, and the noise the page
    // keeps outside the content (`live`, `peek`, `alert`) is inside the landmark with it.
    const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
    assert.match(html, /<main id="app">/, 'the page has no main landmark');
    assert.match(html, /<\/main>\s*<script>/, 'the landmark does not close over the whole page');
    assert.ok(!/<main[^>]*>[\s\S]*<main/.test(html), 'the page has more than one landmark');
  });

  it('shows room health as a dot, with its words only when there is something to say', () => {
    const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
    const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
    assert.match(
      html,
      /<span id="health" data-health="ok" aria-live="polite" title="Connected">/,
      'no health dot in the bar',
    );
    // The dot is `aria-hidden` and a `title` is not an accessible name, so the healthy state's
    // name is in the document and clipped out of the paint: a screen reader reads it and the eye
    // does not. The two other states paint theirs beside the dot.
    assert.match(
      html,
      /<span class="dot" aria-hidden="true"><\/span><span id="health-label">Connected<\/span>/,
      'the healthy state carries no name for a screen reader',
    );
    assert.match(
      style,
      /#health\[data-health='ok'\] #health-label \{[^}]*clip-path: inset\(50%\)/,
      'a healthy room paints its own name',
    );
    const main = readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8');
    for (const state of ["'reconnecting'", "'away'"]) {
      assert.ok(main.includes(`setHealth(${state})`), `the ${state} state reaches no dot`);
    }
    assert.match(main, /'Reconnecting…'/, 'the reconnecting state is wordless');
    assert.match(main, /'Host away'/, 'the host-away state is wordless');
  });
});

describe('a damaged invite is a card sentence, not an engine one', () => {
  const key = encodeKey(new Uint8Array(32).fill(7));
  const whole = `#k=${key}&h=${key}`;
  const addressBar = { base: BASE, room: 'r-1', token: 'tok' };

  it('reads a whole fragment, and the cut ones a chat app leaves', () => {
    assert.equal(
      inviteShortfall({ ...addressBar, fragment: whole }),
      undefined,
      'a whole invite was called damaged',
    );
    // A truncation cuts the fragment first: it is the longest part of the link and it sits
    // after the `#`, so the room and the token arrive whole while a key ends mid-spelling.
    const cut = inviteShortfall({ ...addressBar, fragment: whole.slice(0, whole.length - 4) });
    assert.ok(cut !== undefined && /32-byte key/.test(cut), `no shortfall named: ${cut}`);
    assert.ok(
      inviteShortfall({ ...addressBar, fragment: '' }) !== undefined,
      'a link with no fragment at all passed',
    );
    assert.ok(
      inviteShortfall({ ...addressBar, fragment: `#k=${key}` }) !== undefined,
      'a fragment with no host key passed',
    );
  });

  it('the sentence a person meets is plain and names the host as the next step', () => {
    assertPlain(INCOMPLETE_INVITE_SENTENCE);
    assert.match(INCOMPLETE_INVITE_SENTENCE, /incomplete/);
    assert.match(INCOMPLETE_INVITE_SENTENCE, /host/);
    assert.ok(
      !INCOMPLETE_INVITE_SENTENCE.includes('32-byte'),
      'the engine\u2019s reason is the first thing a person meets',
    );
  });

  it('the page checks the address bar at load, and keeps the precise reason for the console', () => {
    const main = readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8');
    assert.match(main, /^reportIncompleteInvite\(\);/m, 'nothing checks the invite when the page loads');
    assert.match(main, /const reason = inviteShortfall\(target\)/);
    assert.match(
      main,
      /console\.error\(`\[selvage\] invite incomplete/,
      'the precise reason is not kept anywhere',
    );
    assert.match(main, /params\.get\('debug'\) === '1'/, 'the precise reason has no opt-in on the card');
  });
});

describe('join failures in plain words', () => {
  const cases: Array<[string, unknown]> = [
    ['unreachable socket', new Error('the WebSocket reported an error')],
    ['close before open', new Error('the socket closed before it opened: 1006 ')],
    ['refused close wins as refusal', new Error('the socket closed before it opened: 4001 room gone')],
    ['closed with refusal code', new Error('the connection closed with 4002')],
    ['bad room refusal', new ProtocolError(errCode.roomUnknown, 'room_unknown')],
    ['bad token refusal', new ProtocolError(errCode.tokenInvalid, 'token_invalid')],
    ['closed room refusal', new ProtocolError(errCode.roomGone, 'the room is gone')],
    ['hello with no answer', new ProtocolError(errCode.helloRequired, 'the server did not answer session.hello in time')],
    ['abandoned attempt', new Error('the connection attempt was abandoned')],
    ['unusable server address', new TypeError("Failed to construct 'WebSocket': The URL 'junk' is invalid.")],
    ['refused host present', new ProtocolError(errCode.hostPresent, 'host_present')],
  ];

  for (const [name, error] of cases) {
    it(`${name} reads plainly with a next step`, () => {
      const output = describeJoinError(error, BASE);
      assertPlain(output);
      assert.ok(/retry|reload|fresh/i.test(output), `no next step: ${output}`);
    });
  }

  it('refusals name the link, never an address', () => {
    for (const error of [
      new ProtocolError(errCode.roomUnknown, 'x'),
      new ProtocolError(errCode.tokenInvalid, 'x'),
      new ProtocolError(errCode.roomGone, 'x'),
      new ProtocolError(errCode.hostPresent, 'x'),
    ]) {
      const output = describeJoinError(error, BASE);
      assertNoPlumbing(output, 'refusal');
      assert.ok(/fresh link|whole link|guest link/i.test(output), `no link next step: ${output}`);
    }
  });

  it('a dead room id keeps the plain copy verbatim', () => {
    // Memory-only rooms die on restart: `no such room` is the right answer,
    // and the card answers it in plain words with no id, code, or mechanism.
    const refused = new ProtocolError(errCode.roomUnknown, 'no such room: r-3ab6c4e248c7');
    assert.equal(
      describeJoinError(refused, BASE),
      'Nothing answers at that link. Ask the host for a fresh link and retry.',
    );
    const closed = new Error('the socket closed before it opened: 4001 no such room: r-3ab6c4e248c7');
    assert.equal(
      describeJoinError(closed, BASE),
      'Nothing answers at that link. Ask the host for a fresh link and retry.',
    );
  });

  it('unreachable servers name no address', () => {
    const output = describeJoinError(new Error('the WebSocket reported an error'), BASE);
    assertNoPlumbing(output, 'unreachable');
    assertOneAction(output, 'unreachable');
  });

  it('the card copy still passes through untouched', () => {
    for (const copy of [
      'Type the name other participants will see.',
      'That invite link does not name a session. Paste the whole link.',
      'Paste an invite link to join.',
    ]) {
      assert.equal(describeJoinError(new Error(copy), BASE), copy);
      assertNoPlumbing(copy, 'card copy');
    }
  });
});

describe('join card markup', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const card = html.slice(html.indexOf('<div id="join" class="card-start">'), html.indexOf('id="workspace"'));

  it('renders one field over a blurred preview, never the old four', () => {
    for (const gone of ['id="server"', 'id="room"', 'id="token"']) {
      assert.ok(!html.includes(gone), `${gone} still on the card`);
    }
    assert.ok(html.includes('id="join-form"'), 'no form: Enter would not join');
    assert.ok(html.includes('id="name"'), 'no single name field');
    assert.ok(html.includes('id="invite"'), 'no manual paste box');
    assert.ok(html.includes('id="preview"'), 'no blurred preview');
    assert.ok(html.includes('backdrop-filter'), 'no backdrop blur');
  });

  it('shows no room id and no token material outside the schematic example', () => {
    assert.ok(!card.includes('join-room-id'), 'room id still on the card');
    // The paste example is schematic (`room=…&token=…`, ellipsis only): strip
    // it before scanning, so only real material fails.
    const stripped = card.replace(/room=…&token=…/, '');
    assert.ok(!/token/i.test(stripped), 'token material on the card');
  });

  it('paste box shows a schematic page-link example, never a real one', () => {
    const placeholder = card.slice(card.indexOf('<input id="invite"')).match(/placeholder="([^"]*)"/)?.[1] ?? '';
    assert.match(placeholder, /\?room=…&token=…/, `no schematic example: ${placeholder}`);
    const stripped = placeholder.replace(/room=…&token=…/, '');
    assert.ok(!/token=/i.test(stripped), `token material in the example: ${placeholder}`);
    assert.ok(!/room=[^…]/i.test(stripped), `literal room in the example: ${placeholder}`);
    assert.ok(!/ws:\/\//i.test(placeholder), `wire scheme in the example: ${placeholder}`);
    assert.ok(!/\d+\.\d+\.\d+\.\d+/.test(placeholder), `bare address in the example: ${placeholder}`);
    // The whole hint has to fit the field it sits in (see `test/session-over`).
    assert.ok(placeholder.length <= 24, `the example is wide enough to clip: ${placeholder}`);
  });

  it('shows no wire scheme anywhere on the card', () => {
    assert.ok(!/ws:\/\//.test(card), 'socket jargon on the card');
  });

  it('Enter in the name field submits the form, not nothing', () => {
    const form = card.slice(card.indexOf('<form'), card.indexOf('</form>'));
    assert.ok(form.includes('id="name"'), 'name field sits outside the form: Enter would not join');
    assert.ok(
      /id="join-button"[^>]*type="submit"|type="submit"[^>]*id="join-button"/.test(form),
      'Join is not the form\'s submit button: Enter would not join',
    );
    assert.ok(/<form[^>]*action="#"/.test(card), 'the form navigates away instead of joining');
  });
});

describe('joinOnEnter', () => {
  function key(key: string, repeat = false): { key: string; repeat: boolean; prevented: boolean; preventDefault(): void } {
    return {
      key,
      repeat,
      prevented: false,
      preventDefault() {
        this.prevented = true;
      },
    };
  }

  it('Enter attempts the join exactly once, with no implicit submit after it', () => {
    const event = key('Enter');
    let attempts = 0;
    joinOnEnter(event, () => {
      attempts += 1;
    });
    assert.equal(attempts, 1);
    assert.equal(event.prevented, true);
  });

  it('other keys never attempt', () => {
    for (const other of ['a', 'Tab', 'Escape', ' ']) {
      const event = key(other);
      let attempts = 0;
      joinOnEnter(event, () => {
        attempts += 1;
      });
      assert.equal(attempts, 0, other);
      assert.equal(event.prevented, false, other);
    }
  });

  it('a held Enter never re-fires', () => {
    const event = key('Enter', true);
    let attempts = 0;
    joinOnEnter(event, () => {
      attempts += 1;
    });
    assert.equal(attempts, 0);
    assert.equal(event.prevented, false);
  });
});

describe('share-link bar', () => {
  it('offers the room\'s own page link only, never the wire URL', () => {
    const link = buildShareLink(BASE, 'r-1', 'tok');
    assert.ok(link.startsWith('http://127.0.0.1:9/?room='), `not a page link: ${link}`);
    assert.ok(!/ws:\/\//i.test(link), `wire URL in the share bar: ${link}`);
    assert.ok(!/socket|engine/i.test(link), `mechanism wording in the share bar: ${link}`);
    // The token rides inside the page link itself — it is the permission, as
    // in v1 — but no wire address ever does.
  });

  it('a pasted page link round-trips without wire material', () => {
    const link = buildShareLink(BASE, 'r-1', 'tok');
    const page = parsePageLink(link);
    assert.deepEqual(page, { room: 'r-1', token: 'tok', origin: 'http://127.0.0.1:9', fragment: '' });
    assert.deepEqual(resolveJoin(pageQueryParams(new URL(link).search), '', link), {
      base: BASE,
      room: 'r-1',
      token: 'tok',
      fragment: '',
    });
  });
});

describe('failure display and diagnostics', () => {
  it('default UI stays plain; only ?debug=1 names the server', () => {
    const error = new Error('the WebSocket reported an error');
    const plain = describeJoinErrorForDisplay(error, BASE, false);
    assert.equal(plain, describeJoinError(error, BASE));
    assertNoPlumbing(plain, 'default failure UI');
    assertOneAction(plain, 'default failure UI');
    const debug = describeJoinErrorForDisplay(error, BASE, true);
    assert.ok(debug.includes(BASE), `debug names no server: ${debug}`);
  });

  it('the console detail may name the server; the card never does', () => {
    const error = new Error('the WebSocket reported an error');
    const detail = joinFailureDetail(error, BASE);
    assert.ok(detail.includes(BASE), `console detail names no server: ${detail}`);
    assertNoPlumbing(describeJoinError(error, BASE), 'card copy');
  });
});

/**
 * The session bar's own markup: from the bar's opening tag to the health strip under it, which is
 * the next thing the shell draws. The bar used to end at the follow banner's id, and the banner is
 * gone — a slice that runs to a missing id silently reads the whole page instead.
 */
function barOf(source: string): string {
  const from = source.indexOf('<div id="session"');
  const to = source.indexOf('<div id="session-note"');
  assert.ok(from !== -1 && to > from, 'the session bar is not in the shell');
  return source.slice(from, to);
}

describe('joined chrome', () => {
  const main = readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

  it('the session bar names no room id and no server', () => {
    assert.ok(!main.includes('join-room-id'), 'room id still wired to the card');
    assert.ok(!main.includes('room-label'), 'room label still in the session bar');
    assert.ok(!html.includes('room-label'), 'room label still in the page shell');
  });

  it('the roster heading reads People', () => {
    assert.ok(html.includes('<h2>People</h2>'), 'People heading missing');
    assert.ok(!html.includes('<h2>Here</h2>'), 'Here heading still on the page');
  });

  it('the whole link bar copies — no separate Copy button', () => {
    const bar = barOf(html);
    assert.ok(!bar.includes('Copy link'), 'separate copy button still in the bar');
    assert.ok(!bar.includes('copy-share'), 'the icon-only button survived beside the bar');
    assert.ok(/id="share-group"[^>]*role="button"/.test(bar), 'the bar is no button');
    assert.ok(/id="share-group"[^>]*tabindex="0"/.test(bar), 'the bar takes no focus');
    assert.ok(/id="share-group"[^>]*aria-label="Copy invite link"/.test(bar), 'the bar names no action');
    assert.ok(main.includes('wireShareBox'), 'the bar copies from its icon only');
    // The confirmation is the words: `Link copied` is the whole of it, and the tick that stood
    // beside them said nothing they did not.
    assert.ok(!main.includes("iconSvg('check')"), 'the copied confirmation wears a tick again');
    assert.match(main, /wireShareBox\(shareGroup, \(\) => copyShareLink\(\)\)/, 'the bar morphs with something else in it');
  });

  it('an unpublished open announces nothing', () => {
    // The advisory lives on the open row's own badge and its title, never as a message.
    assert.ok(!/show\([^)]*hasn/.test(main), 'an unpublished advisory survived as a message');
  });

  it('a plain open announces nothing', () => {
    assert.ok(!main.includes('`open: ${path}`'), 'a go-to open: message survived');
    assert.ok(!/m(?:essage|ote|alert)\.show\([^)]*open:/.test(main), 'an open: message survived');
  });

  it('the first file opens focused', () => {
    assert.ok(/await openFirst\(session\);[\s\S]*?editor\.focus\(\)/.test(main), 'join never focuses the editor');
  });

  it('the roster owns no stop control', () => {
    assert.ok(!/labelSpan\('Stop'\)/.test(main), 'a roster stop survived beside the strip one');
    assert.ok(main.includes("labelSpan('Stop following')"), 'the follow segment lost its stop');
  });
});
