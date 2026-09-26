/**
 * The file strip, and the homes the page gives a message.
 *
 * The strip is the one line above the editor, and it is the open file and nothing else: the
 * directory muted, the leaf bold. It used to carry a chip per state — the text is in the room, the
 * document reads empty, this window is a viewer, the folder refused the write — and a segment for
 * the peer being followed; the design draws none of them, and each said what the reader could see
 * for themselves, what no longer has a surface of its own, or what belongs on the face it is about.
 * It is also the phone's own panel disclosure.
 *
 * The notice policy is the other half: the homes, each with one job, and a short list of what earns
 * words at all. What is asserted here is the routing — a failure with no control on screen is the
 * alert, a row's own work is a line under the row, and a follow that ended is the alert too — and
 * the sentences that were taken away, which have to stay taken away.
 */

import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const treeView = readFileSync(new URL('../src/browser/tree-view.ts', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8');
const editor = readFileSync(new URL('../src/browser/editor.ts', import.meta.url), 'utf8');
const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
/** What the strip holds, between its own tags. */
const strip = /<div id="file-strip">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? '';

/** The declarations of the rule whose selector list starts as `selector` asks. */
function rule(selector: string): string {
  const at = style.indexOf(`${selector} {`);
  assert.notEqual(at, -1, `no ${selector} rule in the stylesheet`);
  return style.slice(at, style.indexOf('}', at));
}

describe('the strip is in the shell, above the editor', () => {
  it('carries the open file’s path and nothing else', () => {
    assert.ok(strip !== '', 'no file strip above the editor');
    assert.ok(strip.includes('id="file-strip-path"'), 'the strip carries no path');
    // The line is the path: every chip and segment it used to hold is gone, and the element is the
    // one thing a phone presses to open the panel.
    const others = [...strip.matchAll(/id="([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(others, ['file-strip-path'], `the strip carries more than the path: ${others}`);
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
    // The line says what it is about at both widths: the absence of a file, or which file is open.
    assert.match(main, /'No file open'/, 'the strip says something other than what is not open');
  });

  it('carries the disclosure’s own state and name on a phone', () => {
    // A screen reader user hears a button; it has to say whether the panel is open, and it has to
    // keep the one fact the strip exists for — which file is in the editor.
    assert.match(main, /fileStrip\.setAttribute\('aria-expanded'/, 'the disclosure has no state');
    assert.match(
      main,
      /path === undefined \? 'Files, no file open' : `Files, \$\{path\} open`/,
      'the disclosure’s name throws away the open file',
    );
    assert.match(
      main,
      /if \(phoneLayout\.matches\) \{\n    fileStrip\.setAttribute\('aria-expanded'/,
      'the state is set on a device with no disclosure',
    );
    // And the name is a read of what is open, so it is re-applied where the open file moves rather
    // than standing as the load left it: measured with README.md open the name read `Files and
    // people`, and in an empty room with nothing open it read `Files and people, README.md open`.
    const strip = main.slice(main.indexOf('function syncStrip'), main.indexOf('const VIEWER_SENTENCE'));
    assert.match(strip, /applyStripRole\(\)/, 'the disclosure\u2019s name is never re-read');
  });

  it('says nothing about which file is open when there is none', () => {
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
  it('states no state at all: the line is the open file', () => {
    // The chips are gone — a file that reads empty, a viewer's read-only room, the write a folder
    // refused — and so is the follow segment. The design draws none of them, and each said what the
    // reader could see for themselves or what has a better home: the folder's own sentence goes to
    // the page's transient line, and a follow is the followed face's dashed ring and eye.
    assert.ok(!main.includes('fileStripChips'), 'the strip still builds chips');
    assert.ok(!main.includes('fileStripFollow'), 'the strip still builds the follow segment');
    assert.ok(!style.includes('#file-strip-chips'), 'the stylesheet still paints a strip chip');
    assert.ok(!style.includes('#file-strip-follow'), 'the stylesheet still paints the follow segment');
    assert.ok(!/chip\.textContent/.test(main), 'the strip still names a state in a chip');
  });

  it('says nothing about the room’s own knowledge of a row, on the strip or in the tree', () => {
    // The tree's `●`, the `empty` and `not fetched yet` tags and the `⚠` a refused write put there
    // are all gone: the row is a name in a list of names, and what the page knows about a document
    // is the editor's own pane. What is left of that knowledge in the tree is the dimming a guest's
    // rows wear while the host is away.
    assert.ok(!/in the room'/.test(main), 'the strip still says the open file’s text is in the room');
    assert.ok(!/\.in-room/.test(style), 'the tree paints a dot for a file the room holds again');
    assert.ok(!/'●'/.test(treeView), 'a row draws the dot for a file the room holds again');
    assert.ok(!/empty-tag/.test(style), 'the empty tag is still painted');
    assert.ok(!/pending-tag/.test(style), 'the unfetched tag is still painted');
    assert.ok(!/appendRoomMark/.test(treeView), 'a row still draws a room mark');
    assert.ok(!/\.unsaved/.test(style), 'the tree still paints the refused-write mark');
    assert.ok(!/'only you'/.test(treeView), 'a folder this session made still says `only you`');
  });

  it('gives an action no room and no hit area until its row is hovered', () => {
    // The download control kept its 24.4 px while it was invisible, so a name ellipsized 24 px
    // early: measured at 1280x900 on a row ending at x=284, the badge ended at x=245. The design
    // collapses the control to nothing and lets the row grow into it, and the badges take the row's
    // one auto margin either way.
    const control = rule('#tree .row-actions .icon-button');
    assert.match(control, /width:\s*0/, 'the invisible action still holds its slot');
    assert.match(control, /opacity:\s*0/, 'the action is not held back at rest');
    assert.match(control, /pointer-events:\s*none/, 'an invisible action still takes a click');
    assert.match(rule('#tree .presence'), /margin-left:\s*auto/,
      'the badges no longer take the row’s right edge');
    // And the row grows into the room the control gives up: the action is opened by the row's own
    // hover or by the focus inside it.
    const revealed = /#tree li\.file:hover \.row-actions \.icon-button,\s*\n\s*#tree li\.file:focus-within \.row-actions \.icon-button,/;
    assert.match(style, revealed, 'nothing opens the action when its row is reached');
  });

  it('declares the strip’s chevron before the call that draws it', () => {
    // `applyStripRole()` runs at module level, and a top-level `let` written below that call is in
    // its temporal dead zone: unbundled, the page would throw `Cannot access 'stripDisclosure'
    // before initialization`. esbuild lowers a top-level `let` to `var` when it bundles, so the
    // fault is invisible in `dist/` and a source-order check is what catches it.
    const declared = main.indexOf('let stripDisclosure');
    const firstCall = main.indexOf('applyStripRole();');
    assert.notEqual(declared, -1, 'the strip\u2019s chevron has no declaration');
    assert.notEqual(firstCall, -1, 'nothing applies the strip\u2019s role at load');
    assert.ok(declared < firstCall, 'the chevron is declared below the call that reads it');
  });

  it('sends the folder’s own refusal to the page’s transient line', () => {
    // A write the folder refused used to stand on the row it was about, and the row carries no mark
    // for it any more. The sentence must not vanish with the mark: it is a failure with no other
    // home, which is exactly what the alert is for.
    const notices = main.slice(main.indexOf("case 'failure'"), main.indexOf("case 'saved'"));
    assert.ok(notices !== '', 'the failure notice has no case');
    assert.match(notices, /failureAlert\.show\(notice\.text\)/, 'a refused write reaches no line');
    assert.ok(!/unsavedPaths/.test(main), 'the page still keeps a map of refused writes');
    assert.match(main, /failureAlert\.show\(outcome\.sentence\)/,
      'a create that landed without reaching the room says nothing');
  });

  it('draws a follow on the face and nowhere else, with the stop in that person’s menu', () => {
    assert.ok(!html.includes('follow-banner'), 'the banner is still in the shell');
    assert.ok(!main.includes('followBanner'), 'the page still reaches for the banner');
    assert.ok(!/fileStripFollow/.test(main), 'the page still draws a follow segment');
    assert.match(style, /\.av\.followed::after \{[^}]*border: 2px dashed/, 'the followed face lost its ring');
    assert.match(style, /\.av \.eye \{/, 'the followed face lost its eye');
    const room = readFileSync(new URL('../src/browser/room.ts', import.meta.url), 'utf8');
    assert.match(room, /labelSpan\(follows \? 'Stop following' : 'Follow'\)/,
      'the menu no longer carries the stop control');
  });

  it('says why a follow ended when the person did not press Stop', () => {
    // The ring vanishing with nothing said is the one way a person loses the thread of what just
    // happened. Both sentences are the desktop clients' own, they are raised by the binding, and the
    // page's transient line is where they stand — for the four seconds they always did.
    assert.match(editor, /Stopped following \$\{name\} — you moved\./, 'a follow ended by typing says nothing');
    assert.match(editor, /left the room, so following stopped\./, 'a follow ended by a departure says nothing');
    assert.match(main, /failureAlert\.show\(ended, FOLLOW_ENDED_STAND_MS\)/,
      'the reason does not reach the page’s transient line');
    assert.match(main, /const FOLLOW_ENDED_STAND_MS = 4000;/, 'the reason never leaves');
  });

  it('no longer repeats the follow in the health strip or the status line', () => {
    assert.ok(
      !/Following \$\{[\s\S]{0,40}\} in \$\{path\}/.test(editor),
      'the `Following X in path` status survived the strip',
    );
  });
});

describe('the homes a message can have', () => {
  it('room health is the bar’s dot and the strip under it, and nothing while the room is well', () => {
    assert.match(main, /sessionNote\.countdown\(notice\.graceMs\)/, 'the countdown has no home');
    assert.match(main, /sessionNote\.dropped\(RECONNECTING_NOTE\)/, 'the dropped line has no home');
    assert.match(main, /sessionNote\.say\(hostBackSentence\(notice\.name\), HOST_BACK_STAND_MS\)/,
      'the host’s return has no home');
    assert.match(main, /setHealth\('reconnecting'\)/, 'the socket going down reaches no dot');
    assert.match(main, /setHealth\('away'\)/, 'the host going away reaches no dot');
    // The healthy room paints nothing: the green dot is the build's own and the design draws none,
    // and what the two states that change typing mean is still painted beside the dot's own colour.
    assert.match(rule("#health[data-health='ok']"), /display:\s*none/,
      'a healthy room still paints a dot');
    assert.match(style, /#health\[data-health='reconnecting'\] \{[^}]*var\(--warning\)/,
      'a re-dialling socket paints no amber');
    assert.match(style, /#health\[data-health='away'\] \{[^}]*var\(--danger\)/,
      'a host that is away paints no red');
  });

  it('keeps every failure the page can still state, on the page’s transient line', () => {
    // A write’s refusal, a create that landed without reaching the room, a path this host cannot
    // read out of its own folder: none of them has a row to sit on any more, and the alert is the
    // home the page already has for a failure with no other one.
    assert.match(main, /failureAlert\.show\(notice\.text\)/, 'a failure with no control goes nowhere');
    assert.match(main, /failureAlert\.show\(outcome\.sentence\)/, 'an unfinished create says nothing');
    assert.ok(!/unsavedPaths/.test(main), 'the page still keeps a map of refused writes');
  });

  it('clears the fetch’s own sentence and nothing else', () => {
    // The cost sentence stands five seconds; an outcome that lands inside that stand replaces it, and
    // the timer must not carry the outcome and its actions away with it.
    assert.match(main, /feedback\.clear\(costs\)/, 'the timer clears whatever line is showing');
    const view = readFileSync(new URL('../src/browser/tree-view.ts', import.meta.url), 'utf8');
    assert.match(view, /clear\(text\?: string\): void/, 'a clear cannot be told which line it is for');
    assert.match(view, /note\.textContent \?\? ''\) !== text/, 'a named clear takes any line');
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
    assert.ok(bar.indexOf('id="faces"') < leave, 'the faces are not the last thing before the way out');
    assert.ok(bar.indexOf('</div>', bar.indexOf('id="leave-confirm"')) > leave);
    // The bar's right-hand push is the faces': the cluster is what stands at the right, and the way
    // out follows it with nothing after it.
    assert.match(style, /#faces \{[^}]*margin-left: auto/, 'the faces are not at the far right');
    assert.ok(!/#leave-wrap \{[^}]*margin-left/.test(style), 'the way out still takes the push itself');
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
