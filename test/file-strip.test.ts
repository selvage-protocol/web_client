/**
 * The file strip, and the three homes the page gives a message.
 *
 * The strip is the one line above the editor where the open file's whole state lives — which file,
 * whether its text is in the room, whether it is read-only, whether the folder refused the last
 * write to it, who is being followed — and it is also the phone's own panel disclosure. It replaced
 * four surfaces: the follow banner over the editor, the unpublished pill on a row, the viewer toast
 * and the session bar's download control.
 *
 * The notice policy is the other half: three homes, each with one job, and a short list of what earns
 * words at all. What is asserted here is the routing — a state is a marker, a failure beside the
 * control that failed is inline, a failure with no control is the alert — and the sentences that were
 * taken away, which have to stay taken away.
 */

import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const treeView = readFileSync(new URL('../src/browser/tree-view.ts', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8');
const editor = readFileSync(new URL('../src/browser/editor.ts', import.meta.url), 'utf8');
const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
const strip = /<div id="file-strip">[\s\S]*?<\/div>\n          <div id="editor-area">/.exec(html)?.[0] ?? '';

/** The declarations of the rule whose selector list starts as `selector` asks. */
function rule(selector: string): string {
  const at = style.indexOf(`${selector} {`);
  assert.notEqual(at, -1, `no ${selector} rule in the stylesheet`);
  return style.slice(at, style.indexOf('}', at));
}

describe('the strip is in the shell, above the editor', () => {
  it('carries a path, its chips and the follow segment', () => {
    assert.ok(strip !== '', 'no file strip above the editor');
    for (const id of ['file-strip-path', 'file-strip-chips', 'file-strip-follow']) {
      assert.ok(strip.includes(`id="${id}"`), `${id} is not in the strip`);
    }
    // The bar's download control moved to the tree, where a room's files are, and the strip's copy
    // of it is gone: one control per act. It is about a file, not about the session.
    const bar = html.slice(html.indexOf('<div id="session"'), html.indexOf('<div id="session-note"'));
    assert.ok(!bar.includes('id="download"'), 'the download control is still in the session bar');
    assert.ok(!strip.includes('id="download"'), 'the strip still carries a second download control');
  });

  it('is the phone’s panel disclosure, and only on a phone', () => {
    // With the phone's panel shut — its state after every open — nothing else on screen says which
    // file is open, and the panel is the only way back to the tree. One control for one panel: the
    // icon-only `☰` that stood beside the path was a second disclosure inside the strip's own
    // `role="button"`, and it never painted — the shell's `[hidden] { display: none !important }`
    // beat the phone query's `display: flex` — so it was a control nobody could press.
    assert.ok(!html.includes('panel-toggle'), 'the strip carries a second control for the panel');
    assert.match(main, /fileStrip\.addEventListener\('click'/, 'nothing on a phone opens the panel');
    assert.match(main, /applyStripRole\(\)/, 'the strip never takes the disclosure’s semantics');
    assert.match(main, /fileStrip\.setAttribute\('role', 'button'\)/, 'the strip is not a control on a phone');
    assert.match(main, /fileStrip\.removeAttribute\('role'\)/, 'a pointer device reads the strip as a button');
    assert.match(main, /phoneLayout\.matches \? 'Files and people' : 'No file open'/,
      'the strip names neither the panel nor the absence of a file');
  });

  it('carries the disclosure’s own state and name on a phone', () => {
    // A screen reader user hears a button; it has to say whether the panel is open, and it has to
    // keep the one fact the strip exists for — which file is in the editor.
    assert.match(main, /fileStrip\.setAttribute\('aria-expanded'/, 'the disclosure has no state');
    assert.match(
      main,
      /path === undefined \? 'Files and people' : `Files and people, \$\{path\} open`/,
      'the disclosure’s name throws away the open file',
    );
    assert.match(
      main,
      /if \(phoneLayout\.matches\) \{\n    fileStrip\.setAttribute\('aria-expanded'/,
      'the state is set on a device with no disclosure',
    );
  });

  it('says nothing about which file is open when there is none, and no chips either', () => {
    assert.match(main, /'No file open'/, 'no open file reads as something else');
  });

  it('offers no control of its own for saving the open file', () => {
    // The tree's per-row download is the page's one way to a file on disk, and it reaches every
    // file the room holds — the open one included. The strip's button was the same act a second
    // time, on the one line that is about *which file is open*.
    assert.ok(!html.includes('id="download"'), 'the strip carries a download control again');
    assert.ok(!main.includes('downloadButton'), 'the page still wires a download button');
    assert.ok(!main.includes('downloadOpen'), 'the page still saves the open file outside the tree');
    assert.ok(!style.includes('#download'), 'the stylesheet still paints the strip\u2019s download');
  });
});

describe('what the strip states', () => {
  it('marks the empty state and the read-only state as chips, not sentences', () => {
    assert.match(main, /chip\.textContent = 'empty'/, 'the strip does not say a file reads empty');
    assert.match(main, /chip\.textContent = 'Read-only'/, 'the read-only state is not a marker');
    assert.match(main, /VIEWER_SENTENCE/, 'the read-only chip explains nothing on hover');
  });

  it('does not say the open file is in the room, which the person can already see', () => {
    // Opening a file is what puts its text in the room, so for the file on screen the mark was
    // always true — the owner's own example of a sentence the reader already has. The tree's `●`
    // carries the fact where it is news (a file this window has not opened), and the peers in a
    // file are the row's badges.
    assert.ok(
      !/in the room'/.test(main),
      'the strip still says the open file\u2019s text is in the room',
    );
    assert.ok(!/chip\.room/.test(main), 'the strip still builds a room chip');
    assert.ok(
      !/#file-strip-chips \.chip\.room/.test(style),
      'the stylesheet still paints a room chip in the strip',
    );
    // And the tree's own dot went with it: it stood on every file whose text had reached the room,
    // which is every file this window opened, so it told a reader a fact about their own act. What
    // a row still says is the two states of the text that nobody can see — `empty`, `not fetched
    // yet` — and the `⚠` a refused write puts there.
    assert.ok(!/\.in-room/.test(style), 'the tree paints a dot for a file the room holds again');
    assert.ok(!/'●'/.test(treeView), 'a row draws the dot for a file the room holds again');
    assert.match(style, /#tree button\.row \.empty-tag/, 'the empty tag lost its chip');
    assert.match(style, /#tree button\.row \.pending-tag/, 'the unfetched tag lost its chip');
  });

  it('puts a row\u2019s own marks in one place: the badges, then the buttons', () => {
    // The presence badges carry the row's one auto margin. The actions carried `auto` as well, so
    // the free space was split between the two and a file somebody is in showed their badge short
    // of the button it belongs beside — measured on the phone, the badge ended 88 px left of the
    // download control. On a pointer device the actions are invisible until hover and still take
    // their room, so the gap was there in every state.
    assert.match(rule('#tree button.row .presence'), /margin-left:\s*auto/,
      'the badges no longer take the row\u2019s right edge');
    assert.ok(
      !/margin-left:\s*auto/.test(rule('#tree button.row .row-actions')),
      'two auto margins split the free space, so the badges stop in the middle of the row',
    );
  });

  it('carries the host’s refused write, in the words the folder refused with', () => {
    assert.match(main, /'⚠ Not saved to your folder'/, 'a refused write reaches no chip');
    assert.match(main, /chip\.title = refused/, 'the chip does not say why');
  });

  it('is the follow indicator, with the stop control the banner used to own', () => {
    assert.ok(!html.includes('follow-banner'), 'the banner is still in the shell');
    assert.ok(!main.includes('followBanner'), 'the page still reaches for the banner');
    assert.match(main, /fileStripFollow\.appendChild/, 'the follow segment is drawn nowhere');
    assert.match(main, /labelSpan\('Stop following'\)/, 'the stop control went with the banner');
  });

  it('says why a follow ended when the person did not press Stop', () => {
    // The segment vanishing with nothing said is the one way a person loses the thread of what just
    // happened. Both sentences are the desktop clients' own, and they are raised by the binding.
    assert.match(editor, /Stopped following \$\{name\} — you moved\./, 'a follow ended by typing says nothing');
    assert.match(editor, /left the room, so following stopped\./, 'a follow ended by a departure says nothing');
    assert.match(main, /FOLLOW_ENDED_STAND_MS/, 'the reason is never taken down');
    assert.match(main, /announce\(ended\)/, 'the reason is never announced');
  });

  it('no longer repeats the follow in the health strip or the status line', () => {
    assert.ok(
      !/Following \$\{[\s\S]{0,40}\} in \$\{path\}/.test(editor),
      'the `Following X in path` status survived the strip',
    );
  });
});

describe('the three homes a message can have', () => {
  it('room health is the bar’s dot and the strip under it, and nothing else', () => {
    assert.match(main, /sessionNote\.countdown\(notice\.graceMs\)/, 'the countdown has no home');
    assert.match(main, /sessionNote\.dropped\(RECONNECTING_NOTE\)/, 'the dropped line has no home');
    assert.match(main, /sessionNote\.say\(hostBackSentence\(notice\.name\), HOST_BACK_STAND_MS\)/,
      'the host’s return has no home');
    assert.match(main, /setHealth\('reconnecting'\)/, 'the socket going down reaches no dot');
    assert.match(main, /setHealth\('away'\)/, 'the host going away reaches no dot');
  });

  it('a failed action goes beside its own control, and the alert keeps what has none', () => {
    // A write’s refusal belongs on the row it is about and stays there; a path this host cannot read
    // out of its own folder has no row to sit on, so it is the alert’s.
    assert.match(main, /if \(notice\.path !== undefined\) \{/, 'every failure is treated the same way');
    assert.match(main, /unsavedPaths\.set\(notice\.path, notice\.text\)/, 'a write’s refusal reaches no row');
    assert.match(main, /failureAlert\.show\(notice\.text\)/, 'a failure with no control goes nowhere');
    assert.match(main, /case 'saved':/, 'a write that landed never clears its mark');
  });

  it('clears the fetch’s own sentence and nothing else', () => {
    // The cost sentence stands five seconds; an outcome that lands inside that stand replaces it, and
    // the timer must not carry the outcome and its actions away with it.
    assert.match(main, /feedback\.clear\(costs\)/, 'the timer clears whatever line is showing');
    const view = readFileSync(new URL('../src/browser/tree-view.ts', import.meta.url), 'utf8');
    assert.match(view, /clear\(text\?: string\): void/, 'a clear cannot be told which line it is for');
    assert.match(view, /note\.textContent \?\? ''\) !== text/, 'a named clear takes any line');
  });

  it('a create that landed but was not finished is a marker, not a sentence', () => {
    assert.match(main, /unsavedPaths\.set\(path, outcome\.sentence\)/, 'an unfinished create reaches no row');
  });

  it('keeps the sentences that still have one home', () => {
    assert.match(main, /failureAlert\.show\(`Could not open \$\{path\}/, 'an open failure goes nowhere');
    assert.match(main, /failureAlert\.show\(`Could not go to/, 'a go-to failure goes nowhere');
    assert.match(main, /failureAlert\.show\(`Could not follow/, 'a follow failure goes nowhere');
  });

  it('took away the sentence the rename’s own row already states', () => {
    const rename = readFileSync(new URL('../src/browser/rename.ts', import.meta.url), 'utf8');
    assert.match(rename, /renamedSentence/, 'the confirmation copy left the module that owns it');
    assert.match(main, /said: \(\) => undefined/, 'the rename still says a sentence the row states');
    assert.ok(
      !/sessionNote\.say\(sentence, TRANSIENT_STAND_MS\)/.test(main),
      'the rename confirmation survived in the strip',
    );
  });

  it('announces in place, through the one polite region, what no longer has a sentence', () => {
    assert.match(html, /<div id="live" aria-live="polite"><\/div>/, 'there is no live region for markers');
    assert.match(style, /#live \{[^}]*clip-path: inset\(50%\)/, 'the live region is visible on the page');
    assert.match(main, /function announce\(/, 'nothing writes to the live region');
  });
});

describe('the leave control', () => {
  it('is at the far right, with a border, and nothing is ever placed to its right', () => {
    const bar = html.slice(html.indexOf('<div id="session"'), html.indexOf('<div id="session-note"'));
    const leave = bar.indexOf('id="leave-wrap"');
    assert.ok(leave !== -1, 'the leave control is not in the bar');
    assert.ok(bar.indexOf('</div>', bar.indexOf('id="leave-confirm"')) > leave);
    assert.match(style, /#leave-wrap \{[^}]*margin-left: auto/, 'the way out is not at the far right');
    assert.match(style, /#leave \{[^}]*border-color: var\(--border-strong\)/, 'it reads as a label, not a button');
  });

  it('shows a host the consequence before the press, in the panel under the control', () => {
    assert.match(html, /<div id="leave-confirm" role="dialog"/, 'the question has no panel');
    assert.match(html, /id="leave-cancel"/, 'the quiet answer is missing');
    assert.match(html, /id="leave-anyway"/, 'the destructive answer is missing');
    // The words are the module's, kept verbatim, and the markup carries them so the panel paints
    // before the bundle arrives.
    const leave = readFileSync(new URL('../src/browser/leave.ts', import.meta.url), 'utf8');
    assert.match(leave, /LEAVE_ASKING_LABEL = 'Leave anyway'/, 'the destructive answer lost its words');
    assert.match(leave, /LEAVE_CANCEL_LABEL = 'Cancel'/, 'the quiet answer lost its words');
    assert.ok(html.includes('>Leave anyway<'), 'the panel’s own answer is not in the shell');
  });
});
