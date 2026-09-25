/**
 * Roster rows: names with no path text under them, the self row, the follow
 * toggle, and a refused go-to on the row that asked for it.
 */
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { renameHoldsTheList, renderRoster } from '../src/browser/roster.ts';
import type { RosterPeer } from '../src/browser/roster.ts';

function makeDocument() {
  const elements = [];
  function make(tag) {
    const listeners = {};
    const attributes = {};
    const element = {
      tag,
      children: [],
      className: '',
      textContent: '',
      title: '',
      value: '',
      maxLength: undefined,
      type: '',
      spellcheck: undefined,
      autocomplete: undefined,
      focused: false,
      disabled: false,
      style: {},
      dataset: {},
      classList: { add: (name) => void element.classes.push(name) },
      classes: [],
      replaceChildren: () => void element.children.splice(0),
      append: (...nodes) => void nodes.forEach((node) => void element.children.push(node)),
      appendChild: (node) => void element.children.push(node),
      addEventListener: (type, listener) => void ((listeners[type] ??= []).push(listener)),
      /** Fires what a real element fires, so a test drives the control it drew. */
      fire: (type, event = {}) => void (listeners[type] ?? []).forEach((run) => run(event)),
      setAttribute: (name, value) => void (attributes[name] = value),
      getAttribute: (name) => attributes[name],
      focus: () => void (element.focused = true),
    };
    elements.push(element);
    return element;
  }
  return {
    elements,
    createElement: (tag) => make(tag),
  };
}

/**
 * A row's own text, as a person reads it: its own text nodes and its children's, in order. The lone
 * host's line is one sentence, so the space between its halves is a text node in the row.
 */
function textOf(node) {
  if (typeof node === 'string') return node;
  return node.children.map((child) => child.textContent || textOf(child)).join(' ');
}

const SAM = { peerId: 'peer-sam', displayName: 'sam', role: 'guest', colour: '#e06c75', path: 'notes.md' };
const JO = { peerId: 'peer-jo', displayName: 'jo', role: 'host', colour: '#61afef', path: undefined };

function render(peers, overrides = {}) {
  const document = makeDocument();
  globalThis.document = document;
  const list = document.createElement('ul');
  const calls = [];
  renderRoster(list, peers, {
    followedPeerId: undefined,
    selfName: 'me',
    onGoTo: (peerId) => void calls.push(['go', peerId]),
    onFollow: (peerId) => void calls.push(['follow', peerId]),
    onStopFollow: (peerId) => void calls.push(['stop', peerId]),
    ...overrides,
  });
  return { list, calls, document };
}

/** Every element of a class under `element`, the row's own parts. */
function withClass(element, name) {
  const found = [];
  const walk = (node) => {
    if (node.className === name) found.push(node);
    for (const child of node.children) walk(child);
  };
  walk(element);
  return found;
}

/** Every button under an element, so a row's verbs can be read in order. */
function buttonsIn(element) {
  const found = [];
  const walk = (node) => {
    if (typeof node === 'string') return;
    if (node.tag === 'button') found.push(node);
    for (const child of node.children) walk(child);
  };
  walk(element);
  return found;
}

/** The row whose name element carries `name`. */
function rowNamed(list, name) {
  return list.children.find((row) =>
    withClass(row, 'name').some((element) => element.textContent === name),
  );
}

describe('roster rows', () => {
  it('names the peer with no path text under it', () => {
    const { list } = render([SAM]);
    const rows = list.children.filter((child) => child.tag === 'li');
    assert.equal(rows.length, 2);
    const row = rows.find((child) => child.classes.includes('peer'));
    assert.ok(textOf(row).includes('sam'), `name missing: ${textOf(row)}`);
    assert.ok(!textOf(row).includes('notes.md'), `path text under the name: ${textOf(row)}`);
    assert.ok(!textOf(row).includes('no shared document'), `placeholder text under the name: ${textOf(row)}`);
  });

  it('is a toggle: the followed row reads Following, pressed, and pressing it stops', () => {
    // Design §5.1: the roster toggle is the same state as the strip's Stop, from the other side —
    // so it is a control a person can press, not a disabled label explaining itself.
    const { list, calls } = render([SAM], { followedPeerId: 'peer-sam' });
    const row = rowNamed(list, 'sam');
    const buttons = buttonsIn(row);
    assert.equal(buttons.length, 2);
    const follow = buttons[1];
    assert.ok(textOf(follow).includes('Following'), `follow toggle lost: ${textOf(follow)}`);
    assert.equal(follow.getAttribute('aria-pressed'), 'true', 'the toggle does not say it is pressed');
    assert.equal(follow.disabled, false, 'the pressed toggle is a dead control again');
    // The words are the state; the act is what a pointer reads on it.
    assert.ok(!/^stop\b/i.test(textOf(follow).trim()), `a second stop control: ${textOf(follow)}`);
    assert.equal(follow.title, 'Stop following');
    follow.fire('click');
    assert.deepEqual(calls, [['stop', 'peer-sam']], 'the pressed toggle does not stop the follow');
  });

  it('an unfollowed peer offers Go to and Follow', () => {
    const { list, calls } = render([SAM]);
    const row = list.children.find((child) => child.classes.includes('peer'));
    const buttons = buttonsIn(row);
    assert.ok(textOf(buttons[0]).includes('Go to'));
    assert.ok(textOf(buttons[1]).includes('Follow'));
    assert.ok(!textOf(buttons[1]).includes('Following'));
    assert.equal(buttons[1].getAttribute('aria-pressed'), 'false');
    assert.equal(calls.length, 0);
    buttons[1].fire('click');
    assert.deepEqual(calls, [['follow', 'peer-sam']]);
  });

  it('offers no Go to while the peer is in no document, and says where they are', () => {
    const { list } = render([JO]);
    const row = rowNamed(list, 'jo');
    assert.equal(
      buttonsIn(row).some((button) => /Go to/.test(textOf(button))),
      false,
      'a peer with no file open is offered a Go to that can only refuse',
    );
    assert.equal(
      withClass(row, 'waiting')[0].textContent,
      'not in a file yet',
      'the row says nothing about where the peer is',
    );
  });

  it('has no dead control left in it at all', () => {
    // Every disabled verb that used to sit here — the self row's Go to and Follow, a peer's Go to
    // with no file open, a followed peer's Follow — is gone, with its reason: a control that can
    // never work is clutter rather than honesty, and the row says the true thing in its place.
    const { list } = render([JO, SAM, { ...SAM, peerId: 'peer-bo', displayName: 'bo', path: undefined }]);
    const dead = [];
    const walk = (element) => {
      if (element.tag === 'button' && element.disabled) dead.push(element);
      for (const child of element.children) walk(child);
    };
    walk(list);
    assert.deepEqual(dead.map((button) => textOf(button)), []);
    // Not even on the followed row: the toggle is a state a person can press out of.
    const followed = render([SAM], { followedPeerId: 'peer-sam' });
    assert.deepEqual(
      buttonsIn(rowNamed(followed.list, 'sam')).filter((button) => button.disabled),
      [],
      'the followed row offers a control that cannot be pressed',
    );
  });

  it('puts a refused go-to on the row that asked for it, and on no other row', () => {
    // Design §5.1: a race — the peer closed the file, or its caret does not resolve here — and the
    // answer belongs where the press was, not in the health strip at the top of the page.
    const text = 'nothing to go to: sam is not in a document';
    const { list } = render([SAM, JO], { goToRefusal: { peerId: 'peer-sam', text } });
    assert.equal(withClass(rowNamed(list, 'sam'), 'refusal')[0].textContent, text);
    assert.deepEqual(withClass(rowNamed(list, 'jo'), 'refusal'), [], 'the refusal landed on another row');
    // No refusal, no line: the row is what it always was.
    assert.deepEqual(withClass(rowNamed(render([SAM, JO]).list, 'sam'), 'refusal'), []);
  });

  it('says where a peer is when the answer is nowhere, instead of a verb that explains', () => {
    const { list } = render([JO, SAM], { followedPeerId: 'peer-jo' });
    const reasons = [];
    const waiting = [];
    const walk = (element) => {
      if (element.className === 'why') reasons.push(element.textContent);
      if (element.className === 'waiting') waiting.push(element.textContent);
      for (const child of element.children) walk(child);
    };
    walk(list);
    // A peer with no file open reads `not in a file yet` in muted text; there is no Go to to press
    // and nothing to explain on a phone. The self row's two dead verbs and their two lines went the
    // same way: a control that can never work is clutter, not honesty.
    assert.deepEqual(reasons, []);
    assert.deepEqual(waiting, ['not in a file yet']);
    const row = rowNamed(list, 'jo');
    assert.equal(
      buttonsIn(row).some((button) => /Go to/.test(textOf(button))),
      false,
      'a peer with no file open still offers Go to',
    );
    // One with a file open keeps the verb.
    assert.equal(
      buttonsIn(rowNamed(list, 'sam')).some((button) => /Go to/.test(textOf(button))),
      true,
      'a peer in a file lost Go to',
    );
  });

  it('the self row is a roster row: swatch, name, and the one verb it can act on', () => {
    const { list } = render([SAM], { selfColour: '#cba6f7', selfRole: 'host', onRename: () => {} });
    const self = list.children[0];
    assert.ok(self.classes.includes('self'), 'self row is not first');
    assert.ok(textOf(self).includes('me'), `own name missing: ${textOf(self)}`);
    // `Ada (you) · host` was three marks in a row that read as one sentence; the word `host` is the
    // crown now, and the `(you)` stayed, in the crown's own quiet tone and in a mark of its own. The
    // row is the reader's own, and that is not a fact to infer from a colour a second row can wear.
    assert.equal(self.getAttribute('aria-current'), 'true', 'the own row is not the current one to a reader');
    const you = withClass(self, 'you');
    assert.equal(you.length, 1, 'the own row does not say whose row it is');
    assert.equal(you[0].textContent, '(you)', `the own row's mark reads ${you[0].textContent}`);
    assert.ok(!/·/.test(textOf(self)), `a separator stands between the name and its marks: ${textOf(self)}`);
    const swatch = self.children.find((child) => child.className === 'swatch');
    assert.ok(swatch !== undefined, 'self row carries no swatch');
    assert.equal(swatch.style.backgroundColor, '#cba6f7');
    // The swatch says nothing on its own: a `title` on it would be a second reading of one fact,
    // and one a finger can never reach.
    assert.equal(swatch.title, '', 'the swatch repeats what the row already says');
    // One control, and it works. Go to and Follow on this row were two dead verbs plus two lines
    // explaining why: four elements saying what the row's own name already says.
    const buttons = buttonsIn(self);
    assert.equal(buttons.length, 1, `the own row offers ${buttons.length} controls`);
    assert.equal(buttons[0].disabled, false, 'the rename control is dead');
  });

  it('draws a lone host the row that says who they are, and nothing else', () => {
    // The `alone` row stood under it with `No one else yet.` — which the one row above already
    // says — and pointed at `Copy invite link` in the bar, a control the bar carries in plain
    // sight. Two answers to no question, and the second one told a reader where to look.
    const { list } = render([]);
    assert.equal(list.children.length, 1, 'a lone host is read more than their own row');
    const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
    assert.ok(!/#roster li\.alone/.test(html), 'the lone host’s line keeps a rule of its own');
    const roster = readFileSync(new URL('../src/browser/roster.ts', import.meta.url), 'utf8');
    assert.ok(!roster.includes('aloneRow'), 'the lone host’s line survives in the roster');
    assert.ok(!/textContent = ['"]No one else/.test(roster), 'the lone host is told the room is empty in words');
  });

  it('marks the host, and only the host', () => {
    // The room names each seat's role (`§13.4`) and the page's own design note has the roster
    // draw it: `guest` is the room's ordinary seat, where a badge on every row but one is noise.
    const { list } = render([SAM, JO]);
    const jo = rowNamed(list, 'jo');
    const sam = rowNamed(list, 'sam');
    assert.ok(jo !== undefined && sam !== undefined, 'a peer row went missing');
    const marks = withClass(jo, 'role');
    assert.equal(marks.length, 1, 'the host row carries no marker');
    // A crown and not the word: the row is mostly a name, and `host` after it read as the rest of
    // that name. The picture carries its own name for the readers who cannot see it.
    assert.equal(marks[0].textContent, '', `the host is still spelled out: ${marks[0].textContent}`);
    assert.equal(marks[0].getAttribute('aria-label'), 'Host');
    assert.equal(marks[0].title, 'Host');
    assert.equal(withClass(marks[0], 'icon').length, 1, 'the host marker is not drawn as a mark');
    assert.equal(withClass(sam, 'role').length, 0, 'a guest is marked as something');
  });

  it('marks the own row when this connection is the host', () => {
    // The room's peer list never carries this connection's own seat (`§13.4`), so a host alone
    // in a room has no other row that could say who is hosting.
    const { list } = render([], { selfRole: 'host' });
    const self = list.children[0];
    const marks = withClass(self, 'role');
    assert.equal(marks.length, 1, 'the own row of a host says nothing about it');
    assert.equal(marks[0].getAttribute('aria-label'), 'Host');
    // A guest's own row is unmarked, and a row with no role at all is too.
    assert.equal(withClass(render([]).list.children[0], 'role').length, 0);
    assert.equal(withClass(render([], { selfRole: 'guest' }).list.children[0], 'role').length, 0);
  });

  it('your own row offers the rename control, in the shared words', () => {
    const calls = [];
    const { list } = render([SAM], { onRename: () => void calls.push('rename') });
    const self = list.children[0];
    const edit = buttonsIn(self).find((button) => textOf(button).includes('Rename'));
    assert.ok(edit !== undefined, 'the own row has no rename control');
    assert.equal(edit.title, 'Set the name other participants see', 'the intent lost its words');
    edit.fire('click');
    assert.deepEqual(calls, ['rename'], 'the control opens nothing');
    // A page with no name to change draws no control rather than a dead one.
    assert.equal(
      buttonsIn(render([SAM]).list.children[0]).length,
      0,
      'a rename control is offered with no handler',
    );
  });

  it('the open edit replaces the name with the field it is about', async () => {
    const events = [];
    const renaming = {
      opened: 'me',
      value: 'me',
      maxLength: 32,
      fresh: true,
      commit: (value) => void events.push(['commit', value]),
      cancel: () => void events.push(['cancel']),
    };
    const { list } = render([], { selfName: 'me', onRename: () => {}, renaming });
    const self = list.children[0];
    const group = withClass(self, 'rename-edit')[0];
    assert.ok(group !== undefined, 'the field has no group for focus to leave');
    const fields = withClass(self, 'rename');
    assert.equal(fields.length, 1, 'no field where the name was');
    const field = fields[0];
    assert.equal(field.tag, 'input');
    assert.equal(field.value, 'me', 'the field does not open on the current name');
    assert.equal(field.maxLength, 32, 'the field offers more than the room takes');
    assert.equal(field.getAttribute('aria-label'), 'The name other participants see');
    // The edit was asked for by a press, so the field is where the person is — asked for on a
    // microtask, because the row is not in the document while the field is being built and a
    // detached field ignores `focus()`. That is the whole reason it is a microtask: without the
    // wait the call is made against a field nobody has appended yet, which is what the page did.
    await Promise.resolve();
    assert.equal(field.focused, true, 'the field the person asked for does not take focus');
    // The name is the field while the edit is open: one thing asks the question, not two.
    assert.equal(withClass(self, 'name').length, 0, 'the old name stands beside the field');
    assert.equal(
      buttonsIn(self).some((button) => textOf(button).includes('Rename')),
      false,
      'a second rename control opens a second field',
    );
    field.value = 'ada';
    field.fire('input');
    field.fire('keydown', { key: 'Enter', preventDefault: () => {} });
    assert.deepEqual(events, [['commit', 'ada']], 'Enter does not send the typed name');
    field.fire('keydown', { key: 'Escape', preventDefault: () => {} });
    assert.deepEqual(events, [['commit', 'ada'], ['cancel']], 'Escape does not drop the typed name');
    // A click outside the edit keeps what the person typed and leaves the edit open, which is the
    // rule the tree's create row already followed: the field holds a name the person typed, and a
    // stray click is not an answer.
    group.fire('focusout', { relatedTarget: null });
    assert.deepEqual(events, [['commit', 'ada'], ['cancel']], 'a click outside the edit threw the typed name away');
    // A field they have put nothing of their own in closes instead, which is the same rule in the
    // create row — its field opens empty, so a stray click there closes it — and this one opening on
    // the name already in force is what used to leave an edit standing for ever, with the page
    // holding the roster still behind it. Counted, because the escape above already answered
    // `cancel`: an assertion on the last answer alone would pass with this rule removed.
    const dismissed = events.length;
    group.fire('focusout', { relatedTarget: null });
    assert.equal(events.length, dismissed, 'a click outside the untouched field was answered');
    field.value = 'me';
    field.fire('input');
    group.fire('focusout', { relatedTarget: null });
    assert.equal(events.length, dismissed + 1, 'a stray click left the field open on the name it opened with');
    assert.deepEqual(events.at(-1), ['cancel'], 'the dismissal answered with something else');
    field.value = '';
    field.fire('input');
    group.fire('focusout', { relatedTarget: null });
    assert.equal(events.length, dismissed + 2, 'an empty field is left open');

    // The visible pair: a field that only answers Enter is an action with no button, so the same ✓
    // and ✕ the tree's create row shows stand beside it — the same two answers to the same
    // question. They are glyphs, so the name a screen reader and a pointer read is the control's.
    const save = withClass(self, 'rename-save')[0];
    const cancel = withClass(self, 'rename-cancel')[0];
    assert.ok(save !== undefined && cancel !== undefined, 'the edit offers no visible confirm or cancel');
    // And the ✓ is disabled while the field names nothing, exactly as the create row's is while its
    // own name names nothing: a press that could only be refused is not offered.
    assert.equal(save.disabled, true, 'the confirm control is offered for an empty name');
    field.value = 'ada';
    field.fire('input');
    assert.equal(save.disabled, false, 'the confirm control is dead for a name the room takes');
    assert.equal(save.textContent, '', `the confirm control spells itself out: ${save.textContent}`);
    assert.equal(save.getAttribute('aria-label'), 'Set this name');
    assert.equal(save.title, 'Set this name');
    assert.equal(withClass(save, 'icon').length, 1, 'the confirm control is not the ✓ the file rows show');
    assert.equal(cancel.getAttribute('aria-label'), 'Leave the name as it is');
    assert.equal(cancel.title, 'Leave the name as it is');
    assert.equal(withClass(cancel, 'icon').length, 1, 'the cancel control is not the ✕ the file rows show');
    save.fire('click');
    assert.deepEqual(events.at(-1), ['commit', 'ada'], 'the confirm control does not send the name');
    cancel.fire('click');
    assert.deepEqual(events.at(-1), ['cancel'], 'the cancel control sends something');

    // Focus moving within the edit is not leaving it: a press on Save or Cancel must not have
    // the edit cancelled out from under it first, or the press lands on nothing.
    const before = events.length;
    group.fire('focusout', { relatedTarget: save });
    group.fire('focusout', { relatedTarget: cancel });
    group.fire('focusout', { relatedTarget: field });
    assert.equal(events.length, before, 'a press on one of the edit\u2019s own controls cancels first');
    // A browser that does not focus a button on mousedown reports no `relatedTarget` at all, so
    // the press is recorded on the way down too and the button's own click still lands.
    save.fire('mousedown');
    group.fire('focusout', { relatedTarget: null });
    assert.equal(events.length, before, 'a mousedown on a control cancels the edit instead of pressing it');
    // Leaving from a control, where the field itself is no longer focused: the group is what
    // listens, and a field with nothing of the person's in it is the one dismissal left.
    field.value = '';
    field.fire('input');
    group.fire('focusout', { relatedTarget: null });
    assert.deepEqual(events.at(-1), ['cancel'], 'an empty field left by a click outside it stays open');
  });

  it('hands the field to the page, and only the draw that opens the edit takes focus', async () => {
    // The page keeps the field: it is what tells a presence frame whether somebody is in the edit,
    // and where the next draw reads the name they typed. What a redraw must not do is take focus
    // back — it lands while the person is in the editor, where the presence frames are — and what it
    // must not do either is open the field again on the name the edit started with.
    const renaming = {
      opened: 'me',
      value: 'me',
      maxLength: 32,
      fresh: true,
      commit: () => {},
      cancel: () => {},
    };
    const opening = render([SAM], { selfName: 'me', renaming });
    const first = withClass(opening.list.children[0], 'rename')[0];
    assert.equal(renaming.field, first, 'the draw does not hand its field back to the page');
    await Promise.resolve();
    assert.equal(first.focused, true, 'the field the edit opened with does not take focus');
    first.value = 'ada';
    first.fire('input');
    // The redraw the page makes with what it read off that field, for the presence frame that landed
    // while nobody was typing: the typed name goes back, the arriving peer is on the list, and focus
    // stays wherever the person left it.
    const typed = renaming.field?.value;
    const redrawn = render([SAM, JO], {
      selfName: 'me',
      renaming: { ...renaming, value: typed ?? '', fresh: false },
    });
    const field = withClass(redrawn.list.children[0], 'rename')[0];
    assert.equal(field.value, 'ada', 'a redraw threw away the name the person typed');
    assert.ok(rowNamed(redrawn.list, 'jo') !== undefined, 'a redraw left the roster as it was');
    await Promise.resolve();
    assert.equal(field.focused, false, 'a redraw took focus out of whatever the person was in');
  });

  it('holds the list still only while the person is in the field', () => {
    // Measured on 0.4.5: the host opened Rename and clicked into the editor, so the field stayed
    // open; the guest then renamed itself to `Zed`, and the host's tree badge said `Zed` while the
    // roster still said the old name until the host dismissed the rename. The list is held for the
    // cursor's sake and for nothing else, so an edit nobody is in holds nothing.
    const field = { tag: 'input' };
    assert.equal(renameHoldsTheList(field, field), true, 'a redraw takes the field out from under the person typing in it');
    assert.equal(renameHoldsTheList(field, null), false, 'the roster is held still for an edit nobody is in');
    assert.equal(renameHoldsTheList(field, { tag: 'div' }), false, 'focus somewhere else holds the list still');
    assert.equal(renameHoldsTheList(undefined, null), false, 'an edit with no field drawn yet holds the list');
    // And the page keeps the rule where the field is: the hold is asked with the field it holds and
    // whatever has focus, and the draw the hold guards hands the field and the typed name back.
    // There is no DOM here for the page, so this is the call site read as it stands.
    const main = readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8');
    assert.match(main, /renameHoldsTheList\(renamingField, document\.activeElement\)/,
      'the page holds the list still for an edit nobody is in');
    assert.match(main, /renamingField = renaming\?\.field;/, 'the page does not keep the field it drew');
    assert.match(main, /value: typed \?\? renamingName/, 'a redraw does not put the name the person typed back');
  });

  it('peer colours stay on the swatch, data-driven', () => {
    const { list } = render([SAM]);
    const row = list.children.find((child) => child.classes.includes('peer'));
    const swatch = row.children.find((child) => child.className === 'swatch');
    assert.equal(swatch.style.backgroundColor, '#e06c75');
  });
});
