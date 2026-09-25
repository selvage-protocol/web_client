/**
 * The grant tree's redraw budget, its row chrome, and the create row it owns.
 *
 * The tree draws rows — which paths exist, which is open, what the room knows about each — and
 * badges — who is in which file. Rows change when the listing or the room's document set does;
 * badges change on every presence frame, which is every cursor move every peer makes. A room can
 * list thousands of paths, so a presence frame that rebuilds the rows costs the main thread the
 * whole tree per keystroke of somebody else's typing. These tests count what a frame actually
 * redraws.
 *
 * The DOM double below is small and deliberate: it holds what the view touches — children, classes,
 * listeners, an input's value, focus — and nothing else. `document.activeElement` follows `focus()`,
 * because the view restores the caret across a rebuild rather than dropping it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { GrantTreeView } from '../src/browser/tree-view.ts';
import type { CreateResult, RowFeedback } from '../src/browser/tree-view.ts';
import { grantLevels } from '../src/browser/tree.ts';
import {
  EMPTY_FILE_TITLE,
  EMPTY_IN_ROOM_TITLE,
  IN_THE_ROOM_TITLE,
  NOT_HERE_TAG,
  NOT_READ_TITLE,
  NOT_SENT_TITLE,
} from '../src/browser/tree-state.ts';

/** A DOM that counts what it is asked to make, and keeps the children it is given. */
const world = { created: 0 };

function makeElement(tag) {
  world.created += 1;
  const element = {
    tag,
    children: [],
    classes: [],
    textContent: '',
    title: '',
    type: '',
    value: '',
    hidden: false,
    open: false,
    disabled: false,
    readOnly: false,
    spellcheck: false,
    autocomplete: '',
    maxLength: undefined,
    innerHTML: '',
    focused: false,
    selectionStart: 0,
    selectionEnd: 0,
    style: {},
    dataset: {},
    attributes: {},
    listeners: {},
    classList: {
      add: (name) => void (element.classes.includes(name) || element.classes.push(name)),
      remove: (name) => void (element.classes = element.classes.filter((known) => known !== name)),
      toggle: (name, on) => {
        const has = element.classes.includes(name);
        if (on === true && !has) element.classes.push(name);
        if (on === false && has) element.classes = element.classes.filter((known) => known !== name);
      },
      contains: (name) => element.classes.includes(name),
    },
    append: (...nodes) => {
      for (const node of nodes) {
        element.appendChild(node);
      }
    },
    /** A real `insertBefore` moves its node; this one does too, or a move would duplicate it. */
    insertBefore: (node, before) => {
      element.children = element.children.filter((known) => known !== node);
      const at = element.children.indexOf(before);
      element.children.splice(at === -1 ? element.children.length : at, 0, node);
      node.parentElement = element;
      return node;
    },
    /** A real `appendChild` moves its node: this one does too, or a re-append would duplicate it. */
    appendChild: (node) => {
      const previous = node.parentElement;
      if (previous !== undefined && previous !== element) {
        previous.children = previous.children.filter((known) => known !== node);
      }
      if (!element.children.includes(node)) {
        element.children.push(node);
      }
      node.parentElement = element;
      return node;
    },
    replaceChildren: (...nodes) => {
      element.children.length = 0;
      element.children.push(...nodes);
    },
    remove: () => {
      const parent = element.parentElement;
      if (parent !== undefined) {
        parent.children = parent.children.filter((known) => known !== element);
      }
    },
    addEventListener: (type, run) =>
      void ((element.listeners[type] ??= []).push(run)),
    removeEventListener: (type, run) => {
      element.listeners[type] = (element.listeners[type] ?? []).filter((known) => known !== run);
    },
    setAttribute: (name, value) => void (element.attributes[name] = value),
    getAttribute: (name) => element.attributes[name],
    removeAttribute: (name) => delete element.attributes[name],
    focus: () => {
      doc.activeElement = element;
      element.focused = true;
    },
    setSelectionRange: (start, end) => {
      element.selectionStart = start;
      element.selectionEnd = end;
    },
    select: () => {},
  };
  /** Fires the element's own handler, the way a real control's would. */
  element.fire = (type, event = {}) => {
    const full = { preventDefault: () => {}, stopPropagation: () => {}, isTrusted: true, target: element, ...event };
    for (const run of element.listeners[type] ?? []) {
      run(full);
    }
  };
  element.click = () => element.fire('click');
  element.parentElement = undefined;
  Object.defineProperty(element, 'tagName', { get: () => String(element.tag).toUpperCase() });
  Object.defineProperty(element, 'lastElementChild', {
    get: () => element.children[element.children.length - 1],
  });
  // `className` is the class list, as it is in a browser: a class added by `classList.add` has to be
  // visible to a check that reads the attribute, and the other way round.
  Object.defineProperty(element, 'className', {
    get: () => element.classes.join(' '),
    set: (value) => {
      element.classes = String(value)
        .split(/\s+/)
        .filter((name) => name !== '');
    },
  });
  return element;
}

const doc = { activeElement: undefined };
globalThis.document = {
  createElement: (tag) => makeElement(tag),
  head: { appendChild: () => {} },
  get activeElement() {
    return doc.activeElement;
  },
};
globalThis.setTimeout = globalThis.setTimeout;

/** Every element in `node`'s subtree carrying this class, depth first. */
function allWithClass(node, className) {
  const found = [];
  for (const child of node.children ?? []) {
    if (child.classList?.contains(className) === true) {
      found.push(child);
    }
    found.push(...allWithClass(child, className));
  }
  return found;
}

/** The control a person reads by its own name, which is how a tree row's icons are found. */
function labelled(node, label) {
  const found = [];
  const walk = (child) => {
    if (child.attributes?.['aria-label'] === label) {
      found.push(child);
    }
    for (const grandchild of child.children ?? []) {
      walk(grandchild);
    }
  };
  walk(node);
  return found[0];
}

function withClass(node, className) {
  const found = allWithClass(node, className);
  assert.ok(found.length > 0, `nothing carries .${className}`);
  return found[0];
}

function participant(peerId, displayName, colour, path) {
  return { peerId, displayName, role: 'guest', colour, path };
}

function makeSource(state) {
  return {
    grantListing: () => state.listing,
    grantTree: (directory = '') => grantLevels(state.listing).get(directory) ?? [],
    currentPath: () => state.current,
    isOpenInRoom: (path) => (state.inRoom ?? []).includes(path),
    hasText: (path) => (state.textHere ?? []).includes(path),
    isTextEmpty: (path) => (state.textEmpty ?? []).includes(path),
    participants: () => state.participants,
  };
}

/** A listing of `count` files under ten directories, which is what a shared repo looks like. */
function listing(count) {
  return Array.from(
    { length: count },
    (_, index) => `src/mod${String(index % 10).padStart(2, '0')}/file${String(index).padStart(3, '0')}.ts`,
  );
}

function makeView(state) {
  const pane = makeElement('div');
  const view = new GrantTreeView({
    pane,
    source: makeSource(state),
    pinned: new Set(),
    touch: () => state.touch ?? false,
    canCreate: () => state.canCreate ?? false,
    localFolders: () => state.local ?? new Set(),
    room: () => state.room ?? 'demo-app',
    unsaved: () => state.unsaved ?? new Map(),
    hostAway: () => state.hostAway ?? false,
    create: state.create,
    download: state.download,
    open: (path) => void state.opened.push(path),
  });
  return { pane, view };
}

/** The row a file path is drawn as. */
function rowFor(pane, name) {
  const row = allWithClass(pane, 'row').find((candidate) =>
    candidate.children.some((child) => child.textContent === name),
  );
  assert.ok(row !== undefined, `no row for ${name}`);
  return row;
}

describe('the grant tree redraws what changed', () => {
  it('a presence move repaints the rows it moved, not the tree', () => {
    const state = {
      listing: listing(60),
      current: 'src/mod00/file000.ts',
      touch: false,
      opened: [],
      participants: [participant('p-1', 'ada', '#112233', 'src/mod00/file000.ts')],
    };
    const { pane, view } = makeView(state);
    view.render();
    const built = pane.children[0];
    assert.ok(world.created > 100, 'the first render built the tree');
    world.created = 0;

    // One peer's cursor moves to another file: the row it left and the row it entered.
    state.participants = [participant('p-1', 'ada', '#112233', 'src/mod03/file033.ts')];
    view.render();

    assert.equal(pane.children[0], built, 'a presence move rebuilt the tree');
    assert.ok(world.created <= 2, `a presence move made ${world.created} elements`);
    const wearing = allWithClass(pane, 'presence').filter((span) => span.children.length === 1);
    assert.equal(wearing.length, 1, 'the row the peer entered wears no badge');
  });

  it('a listing that moved rebuilds the tree', () => {
    const state = { listing: listing(4), current: undefined, touch: false, opened: [], participants: [] };
    const { pane, view } = makeView(state);
    view.render();
    const built = pane.children[0];

    state.listing = [...state.listing, 'src/mod09/late.ts'];
    view.render();
    assert.notEqual(pane.children[0], built, 'a new path did not redraw the tree');
  });

  it('the open file, a refused write, the host being away and the session’s own folders redraw it', () => {
    const state = {
      listing: listing(4),
      current: undefined,
      touch: false,
      opened: [],
      participants: [],
    };
    const { pane, view } = makeView(state);
    view.render();
    const built = pane.children[0];

    state.current = 'src/mod00/file000.ts';
    view.render();
    assert.notEqual(pane.children[0], built, 'opening a file did not redraw the tree');
    assert.ok(rowFor(pane, 'file000.ts').classes.includes('open'), 'the open row is not lit');

    const opened = pane.children[0];
    state.unsaved = new Map([['src/mod00/file000.ts', 'the file changed on disk']]);
    view.render();
    assert.notEqual(pane.children[0], opened, 'a refused write did not redraw the tree');
    const warn = withClass(rowFor(pane, 'file000.ts'), 'unsaved');
    assert.equal(warn.textContent, '⚠');
    assert.equal(warn.title, 'the file changed on disk');

    const warned = pane.children[0];
    state.hostAway = true;
    view.render();
    assert.notEqual(pane.children[0], warned, 'the host going away did not redraw the tree');
    assert.ok(rowFor(pane, 'file000.ts').classes.includes('away'), 'a row is not dimmed');
    // A row whose text is in the room stays legible: the host being away cannot cost it anything.
    assert.equal(rowFor(pane, 'file000.ts').title, 'The host is away, so its text cannot arrive.');

    const dimmed = pane.children[0];
    state.local = new Set(['docs']);
    view.render();
    assert.notEqual(pane.children[0], dimmed, 'a folder this session made did not redraw the tree');
    assert.equal(withClass(pane, 'local').textContent, 'only you');
  });

  it('a row click opens the path the row names', () => {
    const state = { listing: ['src/main.ts'], current: undefined, touch: false, opened: [], participants: [] };
    const { pane, view } = makeView(state);
    view.render();
    rowFor(pane, 'main.ts').click();
    assert.deepEqual(state.opened, ['src/main.ts']);
  });
});

describe('what a row says about the room', () => {
  function rowState(overrides) {
    const state = {
      listing: ['main.rs'],
      current: undefined,
      touch: false,
      opened: [],
      participants: [],
      ...overrides,
    };
    const { pane, view } = makeView(state);
    view.render();
    return rowFor(pane, 'main.rs');
  }

  it('gains its `●` when the room picks the file up, with the listing unchanged', () => {
    // The `●` is about the room's open set, and a path is in the listing from the grant alone: a
    // document arriving can change the mark while the listing reads exactly the same.
    const state = {
      listing: ['main.rs'],
      current: undefined,
      touch: false,
      opened: [],
      participants: [],
    };
    const { pane, view } = makeView(state);
    view.render();
    const built = pane.children[0];
    state.inRoom = ['main.rs'];
    state.textHere = ['main.rs'];
    view.render();
    assert.notEqual(pane.children[0], built, 'the room picking a file up redrew nothing');
    assert.equal(withClass(rowFor(pane, 'main.rs'), 'in-room').textContent, '●');
  });

  it('wears `●` when the room holds the file and this window has text for it', () => {
    const row = rowState({ inRoom: ['main.rs'], textHere: ['main.rs'] });
    const dot = withClass(row, 'in-room');
    assert.equal(dot.textContent, '●');
    assert.equal(dot.title, IN_THE_ROOM_TITLE);
  });

  it('wears a tag of its own while the room holds the file and nothing has arrived', () => {
    // The row used to say `empty` here, which claims a document nobody has read: the room holds the
    // path open and not a byte has been sent, so the tag says exactly that. The two titles are what
    // tell a guest's wait from a host's, and neither is only in a `title` — the tag carries it.
    const guest = rowState({ inRoom: ['main.rs'] });
    const pending = withClass(guest, 'pending-tag');
    assert.equal(pending.textContent, NOT_HERE_TAG);
    assert.equal(pending.title, NOT_SENT_TITLE);
    assert.equal(allWithClass(guest, 'empty-tag').length, 0, 'an unfetched file still reads empty');
    // A host fetches nothing: it has not read the file off its own disk yet.
    const host = rowState({ inRoom: ['main.rs'], canCreate: true });
    assert.equal(withClass(host, 'pending-tag').title, NOT_READ_TITLE);
  });

  it('wears `empty` only for text the room sent, and which is empty', () => {
    // The text is here and it is empty: that is a fact the page was told.
    const guest = rowState({ inRoom: ['main.rs'], textHere: ['main.rs'], textEmpty: ['main.rs'] });
    assert.equal(withClass(guest, 'empty-tag').title, EMPTY_IN_ROOM_TITLE);
    // A host read the file off its own disk, so it says the one true thing.
    const host = rowState({
      inRoom: ['main.rs'],
      canCreate: true,
      textHere: ['main.rs'],
      textEmpty: ['main.rs'],
    });
    assert.equal(withClass(host, 'empty-tag').title, EMPTY_FILE_TITLE);
  });

  it('says nothing at all about a path the room does not hold', () => {
    const row = rowState({});
    assert.equal(allWithClass(row, 'in-room').length, 0);
    assert.equal(allWithClass(row, 'empty-tag').length, 0);
    assert.equal(allWithClass(row, 'pending-tag').length, 0);
  });
});

describe('a host’s own folders', () => {
  it('draws a folder this session made as a row of its own, marked for the host only', () => {
    // A room's listing is files, so an empty directory is in nobody's: without this row, the folder
    // a host just made would vanish and the next create into it would be refused as a path through
    // something that is not there.
    const state = {
      listing: [],
      current: undefined,
      touch: false,
      opened: [],
      participants: [],
      canCreate: true,
      local: new Set(['docs']),
    };
    const { pane, view } = makeView(state);
    view.render();
    const tag = withClass(pane, 'local');
    assert.equal(tag.textContent, 'only you');
    assert.equal(tag.title, 'Folders join the room with their first file.');
  });

  it('drops the marker once the room’s listing carries the folder', () => {
    const state = {
      listing: ['docs/intro.md'],
      current: undefined,
      touch: false,
      opened: [],
      participants: [],
      canCreate: true,
      local: new Set(['docs']),
    };
    const { pane, view } = makeView(state);
    view.render();
    assert.equal(allWithClass(pane, 'local').length, 0, 'a shared folder still reads `only you`');
  });
});

describe('the create row', () => {
  function creating(overrides = {}) {
    const created = [];
    const state = {
      listing: ['README.md'],
      current: undefined,
      touch: false,
      opened: [],
      participants: [],
      canCreate: true,
      room: 'demo-app',
      create: async (path, entry) => {
        created.push([path, entry]);
        return (overrides.answer ?? { kind: 'made', path, entry });
      },
      ...overrides,
    };
    const { pane, view } = makeView({ ...state, create: state.create });
    return { pane, view, created, state };
  }

  it('is opened where the entry will appear, with no placeholder and a visible commit', () => {
    const { pane, view } = creating();
    view.beginCreate('file', '');
    const row = withClass(pane, 'new-row');
    const input = withClass(pane, 'new-name');
    const commit = withClass(pane, 'new-commit');
    const cancel = withClass(pane, 'new-cancel');
    assert.equal(input.value, '', 'the field opens with a value in it');
    assert.equal(input.attributes.placeholder, undefined, 'the field carries a greyed example');
    assert.equal(input.focused, true, 'the field does not take focus');
    assert.equal(commit.tag, 'button');
    assert.equal(commit.attributes['aria-label'], 'Create file');
    assert.equal(cancel.attributes['aria-label'], 'Cancel');
    assert.match(withClass(pane, 'new-hint').textContent, /^Enter creates the file in demo-app/);
    assert.ok(allWithClass(row, 'icon').length > 0, 'the kind’s icon is not drawn');
  });

  it('names the directory variant’s own destination and kind', () => {
    const { pane, view } = creating({ listing: ['src/main.ts'] });
    view.beginCreate('directory', 'src');
    assert.equal(withClass(pane, 'new-commit').attributes['aria-label'], 'Create folder');
    assert.equal(withClass(pane, 'new-hint').textContent, 'Enter creates the folder in src/ · Esc cancels');
    // The trailing slash is drawn outside the field rather than typed into it.
    assert.equal(withClass(pane, 'new-slash').textContent, '/');
    assert.equal(withClass(pane, 'new-slash').hidden, false);
  });

  it('validates as the person types, in the line that carried the instruction', async () => {
    const { pane, view, created } = creating();
    view.beginCreate('file', '');
    const input = withClass(pane, 'new-name');
    const commit = withClass(pane, 'new-commit');
    input.value = '.env';
    input.fire('input');
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.match(withClass(pane, 'new-hint').textContent, /is not a path this room shares\./);
    assert.ok(input.classes.includes('invalid'), 'the field does not mark the refusal');
    assert.equal(commit.disabled, true, 'the commit stayed live for a refused name');
    // Enter does nothing while the reason is on screen: a second refusal sentence would be the same
    // fact twice.
    let prevented = 0;
    input.fire('keydown', { key: 'Enter', preventDefault: () => void (prevented += 1) });
    assert.equal(prevented, 1, 'Enter was left to the browser');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(created, [], 'Enter created something from a name the line had refused');
  });

  it('creates the name the field holds now, not the one the last check saw', async () => {
    // The check is debounced, and a commit inside that window has to read the field again: a stale
    // check would create `notes` where the person had typed `notes.md`, which is a wrong file rather
    // than a missing one.
    const { pane, view, created } = creating();
    view.beginCreate('file', '');
    await new Promise((resolve) => setTimeout(resolve, 200));
    const input = withClass(pane, 'new-name');
    input.value = 'notes.md';
    input.fire('input');
    input.fire('keydown', { key: 'Enter' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(created, [['notes.md', 'file']]);
  });

  it('enables the commit and creates the file the field names', async () => {
    const { pane, view, created } = creating();
    view.beginCreate('file', '');
    const input = withClass(pane, 'new-name');
    input.value = 'notes.md';
    input.fire('input');
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(withClass(pane, 'new-commit').disabled, false, 'a good name cannot be committed');
    withClass(pane, 'new-commit').fire('click');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(created, [['notes.md', 'file']]);
    assert.equal(view.isCreating(), false, 'the row outlived a create that landed');
    assert.equal(allWithClass(pane, 'new-row').length, 0, 'the row is still drawn');
  });

  it('keeps the field open with the folder’s own sentence when the commit is refused', async () => {
    const { pane, view } = creating({
      answer: { kind: 'refused', sentence: 'notes.md is already in the folder, so nothing was created.' },
    });
    view.beginCreate('file', '');
    const input = withClass(pane, 'new-name');
    input.value = 'notes.md';
    input.fire('input');
    await new Promise((resolve) => setTimeout(resolve, 200));
    withClass(pane, 'new-commit').fire('click');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(view.isCreating(), true, 'a refused create closed the row');
    assert.equal(input.value, 'notes.md', 'a refused name was thrown away');
    assert.equal(
      withClass(pane, 'new-hint').textContent,
      'notes.md is already in the folder, so nothing was created.',
    );
  });

  it('opens the next row inside a folder it just made', async () => {
    // A folder’s only use in a room is to hold files, so the next step is offered rather than
    // described: the row reopens inside what was made.
    const { pane, view, created, state } = creating();
    view.beginCreate('directory', '');
    const input = withClass(pane, 'new-name');
    input.value = 'docs';
    input.fire('input');
    await new Promise((resolve) => setTimeout(resolve, 200));
    withClass(pane, 'new-commit').fire('click');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(created, [['docs', 'directory']]);
    assert.equal(view.isCreating(), true, 'the row closed instead of offering the next step');
    assert.equal(view.creatingIn(), 'docs', 'the row opened somewhere other than the folder just made');
    assert.equal(withClass(pane, 'new-commit').attributes['aria-label'], 'Create file');
    assert.equal(withClass(pane, 'new-hint').textContent, 'Enter creates the file in docs/ · Esc cancels');
    assert.equal(state.listing.length, 1);
  });

  it('closes on Esc, on ✕, and on a blur of an empty field — and not on a blur with a name', () => {
    const { pane, view } = creating();
    view.beginCreate('file', '');
    let input = withClass(pane, 'new-name');
    input.fire('keydown', { key: 'Escape' });
    assert.equal(view.isCreating(), false, 'Esc left the row open');

    view.beginCreate('file', '');
    withClass(pane, 'new-cancel').fire('click');
    assert.equal(view.isCreating(), false, '✕ left the row open');

    view.beginCreate('file', '');
    input = withClass(pane, 'new-name');
    input.fire('blur');
    assert.equal(view.isCreating(), false, 'an empty field stayed open on blur');

    view.beginCreate('file', '');
    input = withClass(pane, 'new-name');
    input.value = 'half-typed';
    input.fire('blur');
    assert.equal(view.isCreating(), true, 'a stray click threw away a typed name');
  });

  it('keeps what is typed when a listing change redraws the tree under it', () => {
    const { pane, view, state } = creating();
    view.beginCreate('file', '');
    const input = withClass(pane, 'new-name');
    input.value = 'notes.md';
    input.focus();
    input.setSelectionRange(5, 5);
    // A grant arrives from a peer while the person is typing.
    state.listing = [...state.listing, 'app.ts'];
    view.render();
    assert.equal(withClass(pane, 'new-name').value, 'notes.md', 'the redraw lost the typed name');
    assert.equal(doc.activeElement, withClass(pane, 'new-name'), 'the redraw dropped the cursor');
    assert.equal(withClass(pane, 'new-name').selectionStart, 5);
  });

  it('sits where the name will take it, and moves as the name is typed', () => {
    const { pane, view } = creating({ listing: ['aaa.md', 'zzz.md'] });
    view.beginCreate('file', '');
    const input = withClass(pane, 'new-name');
    const names = () => {
      const found = [];
      const walk = (node) => {
        for (const child of node.children) {
          if (child.classList.contains('new-name')) found.push('<the create row>');
          else if (child.tag === 'span' && /[.]md$/.test(child.textContent ?? '')) found.push(child.textContent);
          walk(child);
        }
      };
      walk(pane);
      return found;
    };
    // An empty field names nothing, so the row stands at the end of the level.
    assert.deepEqual(names(), ['aaa.md', 'zzz.md', '<the create row>']);
    input.value = 'mmm.md';
    input.fire('input');
    assert.deepEqual(names(), ['aaa.md', '<the create row>', 'zzz.md']);
    input.value = 'zzz2.md';
    input.fire('input');
    assert.deepEqual(names(), ['aaa.md', 'zzz.md', '<the create row>']);
  });

  it('sorts the create row among folders by the name it is given', () => {
    // A folder row is a `details` whose name lives inside its `summary`: reading only the direct
    // children left every folder with the same empty name, and a folder draft always landed at the
    // end of the folder group instead of where its name sorts.
    const { pane, view } = creating({ listing: ['alpha/x.md', 'zulu/y.md'] });
    view.beginCreate('directory', '');
    const input = withClass(pane, 'new-name');
    input.value = 'mike';
    input.fire('input');
    const order = [];
    const walk = (node) => {
      for (const child of node.children) {
        if (child.classList.contains('new-row')) order.push('<the create row>');
        else if (child.tag === 'details') {
          const summary = child.children[0];
          const label = summary === undefined ? undefined : nameIn(summary);
          if (label !== undefined) order.push(label);
        }
        walk(child);
      }
    };
    walk(pane);
    assert.deepEqual(order, ['alpha', '<the create row>', 'zulu']);
  });

  it('says `Create folder` on the folder variant and hides the slash on the file one', () => {
    const { pane, view } = creating();
    view.beginCreate('file', '');
    assert.equal(withClass(pane, 'new-slash').hidden, true, 'a file row draws a directory slash');
    assert.equal(withClass(pane, 'new-commit').attributes['aria-label'], 'Create file');
  });
});

describe('a row’s own actions', () => {
  function downloadable(overrides = {}) {
    const calls = [];
    const state = {
      listing: ['notes.md'],
      current: undefined,
      touch: false,
      opened: [],
      participants: [],
      download: (path, feedback) => void calls.push({ path, feedback }),
      ...overrides,
    };
    const { pane, view } = makeView(state);
    return { pane, view, calls, state };
  }

  it('carries a download on every file row, reachable without hover', () => {
    const { pane, view } = downloadable();
    view.render();
    const button = withClass(pane, 'download');
    assert.equal(button.attributes['aria-label'], 'Download notes.md');
    assert.equal(button.title, 'Download notes.md');
    // The action is drawn at every width; on a touch device the stylesheet shows it always, because
    // there is no hover there to reveal it with.
    assert.ok(allWithClass(pane, 'row-actions').length > 0, 'the row holds no actions');
    const finger = downloadable({ touch: true });
    finger.view.render();
    assert.equal(labelled(finger.pane, 'Download notes.md') !== undefined, true, 'a finger has no download');
  });

  it('reports progress in the action’s own place and a sentence under the row', () => {
    const { pane, view, calls, state } = downloadable();
    view.render();
    withClass(pane, 'download').fire('click');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, 'notes.md');
    const feedback: RowFeedback = calls[0].feedback;
    feedback.busy('Asking the host for notes.md…');
    assert.equal(withClass(pane, 'download').attributes['aria-label'], 'Asking the host for notes.md…');
    assert.ok(
      withClass(pane, 'download').parentElement.classes.includes('busy'),
      'the row does not show that it is working',
    );
    feedback.idle();
    assert.equal(withClass(pane, 'download').attributes['aria-label'], 'Download notes.md');
    feedback.note('notes.md is still empty — the host sent no text for it.', [
      { label: 'Try again', run: () => {} },
    ]);
    const note = withClass(pane, 'row-note');
    // The double keeps a string child as it was given: the sentence first, then the control.
    assert.match(String(note.children[0]), /still empty/);
    assert.equal(note.children.length, 2, 'the note drew no action');
    assert.equal(note.children[1].textContent, 'Try again');
    // A redraw replaces the row, and the line and the progress are redrawn with it: a fetch that
    // lands rebuilds the tree in the moment the person was meant to read what it cost.
    feedback.busy('Asking the host for notes.md…');
    state.listing = ['notes.md', 'app.ts'];
    view.render();
    assert.equal(allWithClass(pane, 'row-note').length, 1, 'the redraw took the row’s line with it');
    // The listing was replaced, so the rows are new elements: the label is looked up by what it
    // says, which is what a person reads off the control.
    assert.ok(labelled(pane, 'Asking the host for notes.md…') !== undefined, 'the redraw took the row’s progress');
    assert.ok(
      labelled(pane, 'Asking the host for notes.md…').parentElement.classes.includes('busy'),
      'the busy state is gone',
    );
    feedback.idle();
    feedback.clear();
    assert.equal(allWithClass(pane, 'row-note').length, 0, 'the note outlived its dismissal');
  });

  it('keeps its own words after a redraw, reachable through the line the row is showing', () => {
    // A fetch that lands rebuilds the tree, and the `Try again` on the line the row was showing must
    // still reach the row that is on screen: a control that writes into a thrown-away row is a button
    // that does nothing at all.
    const { pane, view, calls, state } = downloadable();
    view.render();
    withClass(pane, 'download').fire('click');
    const first: RowFeedback = calls[0].feedback;
    first.note('notes.md is still empty — the host sent no text for it.', [
      { label: 'Try again', run: () => first.note('trying again') },
    ]);
    state.listing = ['notes.md', 'app.ts'];
    view.render();
    const retry = withClass(pane, 'row-note').children[1];
    retry.fire('click');
    // The line the second attempt writes is in the tree that is on screen, not in the old one.
    assert.equal(allWithClass(pane, 'row-note').length, 1);
    assert.equal(String(withClass(pane, 'row-note').children[0]), 'trying again');
    first.clear();
    assert.equal(allWithClass(pane, 'row-note').length, 0);
  });

  it('takes down the line it was asked to, not whatever is there now', () => {
    // A sentence that stands five seconds (what fetching costs) is replaced by an outcome the person
    // can act on; the timer that clears the first must not carry the second away with it.
    const { pane, view, calls } = downloadable();
    view.render();
    withClass(pane, 'download').fire('click');
    const feedback = calls[0].feedback;
    const costs = 'Fetching opens notes.md in the room, so every peer receives it.';
    feedback.note(costs);
    feedback.note('notes.md is still empty — the host sent no text for it.', [
      { label: 'Try again', run: () => {} },
    ]);
    feedback.clear(costs);
    assert.equal(allWithClass(pane, 'row-note').length, 1, 'the timer took the outcome with it');
    assert.match(String(withClass(pane, 'row-note').children[0]), /still empty/);
    feedback.clear();
    assert.equal(allWithClass(pane, 'row-note').length, 0);
  });

  it('offers no download for a host’s file the room does not hold', () => {
    // The file is already on the host’s own disk, so there is nothing to fetch: the action is left
    // out rather than shown disabled.
    const { pane, view } = downloadable({ canCreate: true });
    view.render();
    assert.equal(allWithClass(pane, 'download').length, 0, 'a host is offered a pointless fetch');
  });

  it('offers one for a host’s file the room does hold — the escape hatch for a refused write', () => {
    const { pane, view } = downloadable({ canCreate: true, inRoom: ['notes.md'] });
    view.render();
    assert.equal(allHasDownload(pane), true, 'a host cannot save the room’s copy');
  });

  it('puts the two create verbs on a directory row for a host, and a `⋯` where there is no hover', () => {
    const host = downloadable({ listing: ['src/main.ts'], canCreate: true });
    host.view.render();
    const newFile = labelled(host.pane, 'New file in src/');
    const newFolder = labelled(host.pane, 'New folder in src/');
    assert.ok(newFile !== undefined, 'no New file on a directory row');
    assert.ok(newFolder !== undefined, 'no New folder on a directory row');
    assert.equal(newFile.title, 'New file in src/', 'the verb names itself nowhere a pointer reads');
    newFolder.fire('click');
    assert.equal(host.view.isCreating(), true, 'the directory verb opened no row');
    assert.equal(host.view.creatingIn(), 'src', 'the row opened somewhere else');
    // Neither verb is the directory's own toggle: preventDefault is what keeps the summary shut.
    let prevented = 0;
    host.view.cancelCreate();
    const again = labelled(host.pane, 'New file in src/');
    again.fire('click', { preventDefault: () => void (prevented += 1) });
    assert.equal(prevented, 1, 'a directory verb would have toggled the directory too');

    const finger = downloadable({ listing: ['src/main.ts'], canCreate: true, touch: true });
    finger.view.render();
    const menuButton = labelled(finger.pane, 'More actions for src/');
    assert.ok(menuButton !== undefined, 'a touch row draws no `⋯`');
    assert.equal(menuButton.attributes['aria-expanded'], 'false');
    menuButton.fire('click');
    const items = allWithClass(finger.pane, 'row-menu')[0];
    assert.ok(items !== undefined, 'the `⋯` opens nothing');
    assert.equal(items.children.length, 2, 'the menu holds the wrong number of actions');
    assert.equal(items.children[0].textContent, 'New file in src/');
    assert.equal(items.children[1].textContent, 'New folder in src/');
    items.children[0].fire('click');
    assert.equal(finger.view.isCreating(), true, 'the menu item opened no create row');
    assert.equal(finger.view.creatingIn(), 'src');
    assert.equal(allWithClass(finger.pane, 'row-menu').length, 0, 'the menu stayed open');
    assert.equal(menuButton.attributes['aria-expanded'], 'false', 'the trigger stayed expanded');
  });
});

/** The name a drawn row carries, for the order the create row places itself in. */
function nameIn(element) {
  for (const child of element.children) {
    if (child.classList.contains('label')) {
      return child.textContent;
    }
    const nested = nameIn(child);
    if (nested !== undefined) {
      return nested;
    }
  }
  return undefined;
}

/** Whether any row carries a download control. */
function allHasDownload(pane) {
  return allWithClass(pane, 'download').length > 0;
}

describe('an empty listing', () => {
  /**
   * The dead end this sentence exists for: a fresh room whose folder holds nothing shows a
   * read-only editor and no explanation, and the two people looking at it can do different things
   * about it. The host holds the folder and may create in it; a guest is waiting on the host.
   */
  it('reads differently to the person who can fill it', () => {
    const state = { listing: [], current: undefined, touch: false, opened: [], participants: [] };

    const guest = makeView({ ...state, canCreate: false });
    guest.view.render();
    assert.equal(withClass(guest.pane, 'empty').textContent, 'The host has not shared any files yet.');

    // The host's own line is the short one: the explanation and the two acts are the editor pane's
    // beside it (design §7.2), and this panel's header carries the verbs it used to describe.
    const host = makeView({ ...state, canCreate: true });
    host.view.render();
    const line = withClass(host.pane, 'empty').textContent;
    assert.equal(line, 'Nothing here yet.');
    assert.ok(!line.includes('The host'), 'a host is told about the host');
  });

  it('gives way to the create row the moment one opens', () => {
    const host = makeView({ listing: [], current: undefined, touch: false, opened: [], participants: [], canCreate: true });
    host.view.render();
    host.view.beginCreate('file', '');
    assert.equal(allWithClass(host.pane, 'empty').length, 0, 'the empty line stands over the create row');
    assert.equal(allWithClass(host.pane, 'new-row').length, 1);
  });
});
