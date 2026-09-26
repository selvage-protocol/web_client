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
    create: state.create,
    remove: state.remove,
    move: state.move,
    say: state.say,
    download: state.download,
    open: (path) => void state.opened.push(path),
  });
  return { pane, view };
}

/** The row a file path is drawn as, or `undefined` while the tree has not drawn it. */
function rowOf(pane, path) {
  return allWithClass(pane, 'row').find((candidate) => candidate.dataset.open === path);
}

/** The row a file path is drawn as, by the name it shows. */
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

    // One peer's cursor moves to another file: the row it left and the row it entered, and the two
    // folders those files sit in — a shut folder wears the badges of the peers inside it, so a peer
    // moving between two of its files changes that row as well.
    state.participants = [participant('p-1', 'ada', '#112233', 'src/mod03/file033.ts')];
    view.render();

    assert.equal(pane.children[0], built, 'a presence move rebuilt the tree');
    assert.ok(world.created <= 2, `a presence move made ${world.created} elements`);
    const wearing = allWithClass(pane, 'presence').filter((span) => span.children.length === 1);
    assert.equal(wearing.length, 2, 'the rows the peer entered wear no badge');
    const folder = allWithClass(pane, 'presence').find((span) => span.title === 'Inside src/mod03/');
    assert.equal(folder?.children.length, 1, 'the folder the peer moved into wears no badge');
    const left = allWithClass(pane, 'presence').find((span) => span.title === 'Inside src/mod00/');
    assert.equal(left?.children.length, 0, 'the folder the peer left still wears their badge');
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

  it('the open file and the session’s own folders redraw it', () => {
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
    state.local = new Set(['docs']);
    view.render();
    assert.notEqual(pane.children[0], opened, 'a folder this session made did not redraw the tree');
    assert.ok(
      allWithClass(pane, 'label').some((span) => span.textContent === 'docs/'),
      'the folder this session made is not drawn as a row of its own',
    );
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

  it('draws no tag for what the page knows about a document', () => {
    // `empty` and `not fetched yet` said what the page had been told about a document's text, on a
    // row whose job is to be a name in a list of names. The design draws neither, and the row keeps
    // no state for a host that is away either: the session card says that, where the countdown is.
    const row = rowState({ inRoom: ['main.rs'], textHere: ['main.rs'], textEmpty: ['main.rs'] });
    for (const gone of ['empty-tag', 'pending-tag', 'unsaved', 'in-room']) {
      assert.equal(allWithClass(row, gone).length, 0, `a row still draws .${gone}`);
    }
    // And a refused write is not the row's either: the sentence the folder gave stands on the
    // page's transient line (`main.ts`).
    assert.equal(allWithClass(row, 'chip').length, 0, 'a row still carries a chip');
  });

  it('redraws the rows when a document arrives, which is what a host\u2019s download reads', () => {
    // A path is in the listing from the grant alone, so a document arriving can change what the room
    // knows about a row while the listing reads exactly the same. The one chrome that follows it is
    // the download: a host's file is on its own disk until the room holds it open, and the row gains
    // the control then, which is what the redraw key carries.
    const state = {
      listing: ['main.rs'],
      current: undefined,
      touch: false,
      opened: [],
      participants: [],
      canCreate: true,
      download: () => {},
    };
    const { pane, view } = makeView(state);
    view.render();
    const built = pane.children[0];
    assert.equal(
      allWithClass(pane, 'download').length,
      0,
      'a host is offered a download for a file the room does not hold',
    );
    // The room opens it: the row gains the control, and only a rebuild puts it there.
    state.inRoom = ['main.rs'];
    view.render();
    assert.notEqual(pane.children[0], built, 'the room opening a document redrew nothing');
    assert.equal(
      allWithClass(pane, 'download').length,
      1,
      'the row the room holds open offers no download',
    );
  });

  it('names the host on their badge, where a crown has no circle to sit on', () => {
    // The crown a face wears is half the circle it is drawn on; a 17 px square badge is not one, and
    // at a size that reads it pokes out of the row. The role goes in the tooltip instead — the same
    // `name · Host` a face reads — and every other badge carries the bare name as it always has.
    const host = rowState({
      participants: [
        { ...participant('p-host', 'Mira', '#94e2d5', 'main.rs'), role: 'host' },
        participant('p-guest', 'sam', '#e06c75', 'main.rs'),
      ],
    });
    const badges = allWithClass(host, 'badge');
    assert.deepEqual(
      badges.map((badge) => badge.title),
      ['Mira \u00b7 Host', 'sam'],
    );
    assert.equal(allWithClass(host, 'crown').length, 0, 'a badge wears a crown it has no room for');
  });
});

describe('a folder row', () => {
  function tree(overrides = {}) {
    const state = {
      listing: ['src/main.ts', 'src/other.ts', 'README.md'],
      current: undefined,
      touch: false,
      opened: [],
      participants: [],
      ...overrides,
    };
    const { pane, view } = makeView(state);
    view.render();
    return pane;
  }

  it('is the design’s folder: filled, swapping when it opens, and named with its slash', () => {
    const summary = withClass(tree(), 'folder').parentElement;
    const glyphs = allWithClass(summary, 'folder');
    assert.equal(glyphs.length, 2, 'the row draws one glyph, so it has nothing to swap to');
    assert.deepEqual(
      glyphs.map((glyph) => glyph.className),
      ['icon folder closed', 'icon folder open'],
      'the folder is not drawn closed and open',
    );
    assert.equal(allWithClass(summary, 'chev').length, 0, 'the folder still draws a chevron');
    assert.equal(nameIn(summary), 'src/', 'the folder is not named as a folder');
  });

  it('wears the badges of the peers inside it, and no badge of its own', () => {
    // A folder is not a document, so the room says nothing about it; the rows inside it say where
    // each peer is, and while the folder is shut those rows are not on screen.
    const pane = tree({
      participants: [
        participant('p-1', 'ada', '#112233', 'src/main.ts'),
        participant('p-2', 'bob', '#445566', 'README.md'),
      ],
    });
    const summary = withClass(pane, 'folder').parentElement;
    assert.deepEqual(
      allWithClass(summary, 'badge').map((badge) => badge.textContent),
      ['ad'],
      'the folder wears the wrong badges',
    );
    assert.equal(withClass(summary, 'presence').title, 'Inside src/');
  });
});

describe('a host’s own folders', () => {
  it('draws a folder this session made as a row of its own', () => {
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
    assert.equal(nameIn(withClass(pane, 'folder').parentElement), 'docs/');
  });

  it('draws it once, whether the listing carries it or not', () => {
    // The listing is files: a folder this session made is drawn from the page's own memory until
    // some path goes through it, and from the listing after that — never both.
    for (const listing of [[], ['docs/intro.md']]) {
      const state = {
        listing,
        current: undefined,
        touch: false,
        opened: [],
        participants: [],
        canCreate: true,
        local: new Set(['docs']),
      };
      const { pane, view } = makeView(state);
      view.render();
      // Two glyphs per folder row: the closed one and the open one it swaps to.
      assert.equal(allWithClass(pane, 'folder').length, 2, `the folder is not drawn once: ${listing}`);
    }
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
    assert.equal(commit.attributes['aria-label'], 'Create');
    assert.equal(cancel.attributes['aria-label'], 'Cancel');
    // The row explains nothing: the field, the `✓` and the tree around them are the whole of what
    // it is for, so the line stands empty until there is something a person cannot see.
    assert.equal(withClass(pane, 'new-hint').textContent, '', 'the row explains itself');
    assert.ok(allWithClass(row, 'icon').length > 0, 'the kind’s icon is not drawn');
  });

  it('names the directory variant’s own kind', () => {
    const { pane, view } = creating({ listing: ['src/main.ts'] });
    view.beginCreate('directory', 'src');
    assert.equal(withClass(pane, 'new-commit').attributes['aria-label'], 'Create');
    assert.equal(withClass(pane, 'new-name').attributes['aria-label'], 'New folder name in src');
    assert.equal(withClass(pane, 'new-hint').textContent, '');
    // The trailing slash is drawn outside the field rather than typed into it.
    assert.equal(withClass(pane, 'new-slash').textContent, '/');
    assert.equal(withClass(pane, 'new-slash').hidden, false);
  });

  it('validates as the person types, in the line under the field', async () => {
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

  it('makes the directories a typed path names, and puts focus on the row of the file it made', async () => {
    // A path a person types is a path: `docs/intro.md` makes `docs` because a room’s listing is
    // files, so an empty folder is in nobody’s listing and typing one through its file is how it
    // gets into the room. The file that was made opens, and the row it was made as is where the
    // person’s hands are, so focus lands there rather than back on the page body.
    const created = [];
    const state = {
      listing: ['README.md'],
      current: undefined,
      touch: false,
      opened: [],
      participants: [],
      canCreate: true,
      create: async (path, entry) => {
        created.push([path, entry]);
        state.listing = [...state.listing, path];
        return { kind: 'made', path, entry };
      },
    };
    const { pane, view } = makeView(state);
    view.render();
    view.beginCreate('file', '');
    const input = withClass(pane, 'new-name');
    input.value = 'docs/intro.md';
    input.fire('keydown', { key: 'Enter' });
    await until(() => created.length === 1, 'the create');
    assert.deepEqual(created, [['docs/intro.md', 'file']]);
    await until(() => rowOf(pane, 'docs/intro.md') !== undefined, 'the row of the file that was made');
    assert.equal(view.isCreating(), false, 'the row outlived the create');
    assert.ok(
      allWithClass(pane, 'label').some((span) => span.textContent === 'docs/'),
      'the folder the typed path named is not drawn',
    );
    assert.equal(
      summaryFor(pane, 'docs/').parentElement.open,
      true,
      'the folder the new file landed in is shut, so its row is behind a disclosure nobody opened',
    );
    assert.equal(doc.activeElement, rowOf(pane, 'docs/intro.md'), 'focus did not land on the new file’s row');
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
    assert.equal(withClass(pane, 'new-commit').attributes['aria-label'], 'Create');
    assert.equal(
      withClass(pane, 'new-name').attributes['aria-label'],
      'New file name in docs',
      'the row does not say which folder it is naming a file in',
    );
    assert.equal(withClass(pane, 'new-hint').textContent, '');
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
    // end of the folder group instead of where its name sorts. The slash a folder is drawn with is
    // its mark and not part of the name, so a draft called `mike` still sorts between two folders.
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
    assert.deepEqual(order, ['alpha/', '<the create row>', 'zulu/']);
  });

  it('hides the slash on the file variant and its own folder’s slash on the directory one', () => {
    const { pane, view } = creating();
    view.beginCreate('file', '');
    assert.equal(withClass(pane, 'new-slash').hidden, true, 'a file row draws a directory slash');
    assert.equal(withClass(pane, 'new-commit').attributes['aria-label'], 'Create');
    // The field is named for what it asks for, and for the folder the row stands in when it is in
    // one: `New folder name in src` is a question about `src`, and nothing else on the row says so.
    assert.equal(withClass(pane, 'new-name').attributes['aria-label'], 'New file name');
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

  it('puts the folder’s own two acts on a directory row for a host, and a `⋯` nowhere', () => {
    const host = downloadable({ listing: ['src/main.ts'], canCreate: true });
    host.view.render();
    const newFile = labelled(host.pane, 'New file in src/');
    assert.ok(newFile !== undefined, 'no New file on a directory row');
    assert.equal(newFile.title, 'New file in src/', 'the verb names itself nowhere a pointer reads');
    newFile.fire('click');
    assert.equal(host.view.isCreating(), true, 'the directory verb opened no row');
    assert.equal(host.view.creatingIn(), 'src', 'the row opened somewhere else');
    // Neither verb is the directory's own toggle: preventDefault is what keeps the summary shut.
    let prevented = 0;
    host.view.cancelCreate();
    const again = labelled(host.pane, 'New file in src/');
    again.fire('click', { preventDefault: () => void (prevented += 1) });
    assert.equal(prevented, 1, 'a directory verb would have toggled the directory too');
    // The folder's other act is the trash, in the summary beside it.
    assert.ok(
      labelled(host.pane, 'Delete src/') !== undefined,
      'no Delete on a directory row',
    );
    assert.equal(
      labelled(host.pane, 'New folder in src/'),
      undefined,
      'a per-folder New folder is still drawn',
    );

    // A finger has no hover, so both are drawn on the row itself rather than behind a menu: the
    // design’s folder row holds the folder’s own acts and nothing else.
    const finger = downloadable({ listing: ['src/main.ts'], canCreate: true, touch: true });
    finger.view.render();
    assert.ok(labelled(finger.pane, 'New file in src/') !== undefined, 'a finger has no New file');
    assert.ok(labelled(finger.pane, 'Delete src/') !== undefined, 'a finger has no Delete');
    assert.equal(allWithClass(finger.pane, 'row-menu').length, 0, 'a `⋯` menu is still drawn');
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

/**
 * Waits for an effect rather than for a number of turns: the row's own work is a promise, and a
 * fixed handful of microtasks is a test that passes before the thing happened. Bounded, and it says
 * what it was waiting for when it gives up.
 */
async function until(predicate, what) {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(`timed out waiting for ${what}`);
}

/** The `summary` a folder row is drawn as, found by the name it shows. */
function summaryFor(pane, name) {
  const label = allWithClass(pane, 'label').find((span) => span.textContent === name);
  assert.ok(label !== undefined, `no row for ${name}`);
  return label.parentElement;
}

/** A drag's own data transfer, which is the one browser object the handlers read. */
function dataTransfer() {
  const written = [];
  return { written, setData: (type, value) => void written.push([type, value]), effectAllowed: '', dropEffect: '' };
}

describe('the row that asks to be taken out', () => {
  function deletable(overrides = {}) {
    const calls = [];
    const said = [];
    const state = {
      listing: ['src/main.ts', 'src/lib.ts', 'src/api/handler.ts', 'tests/join.rs', 'README.md'],
      current: undefined,
      touch: false,
      opened: [],
      participants: [],
      canCreate: true,
      remove: async (path) => {
        calls.push(path);
        return { kind: 'removed', path, paths: [path] };
      },
      say: (text) => void said.push(text),
      ...overrides,
    };
    const { pane, view } = makeView(state);
    return { pane, view, calls, said, state };
  }

  it('draws a trash on every file and folder row for the host, and none of it for a guest', () => {
    const host = deletable();
    host.view.render();
    for (const label of ['Delete main.ts', 'Delete lib.ts', 'Delete handler.ts', 'Delete join.rs', 'Delete README.md']) {
      assert.ok(labelled(host.pane, label) !== undefined, `no ${label} on a file row`);
    }
    assert.ok(labelled(host.pane, 'Delete src/') !== undefined, 'no trash on a folder row');
    assert.ok(labelled(host.pane, 'Delete src/api/') !== undefined, 'no trash on a nested folder row');

    // A guest holds no folder and no listing: neither act is theirs, so neither control is drawn.
    const guest = deletable({ canCreate: false });
    guest.view.render();
    for (const label of ['Delete main.ts', 'Delete src/', 'Delete src/api/']) {
      assert.equal(labelled(guest.pane, label), undefined, `a guest is offered ${label}`);
    }
    assert.equal(allWithClass(guest.pane, 'del-row').length, 0, 'a guest is offered the question');
    assert.equal(
      allWithClass(guest.pane, 'row').some((row) => row.draggable === true),
      false,
      'a guest’s file row can be dragged',
    );
  });

  it('asks in the row itself, in place, with focus on ✓', () => {
    const { pane, view } = deletable();
    view.render();
    labelled(pane, 'Delete src/').fire('click');

    // The row keeps its shape and its place: a `<details>` that is still open, whose summary is the
    // row the person pressed, with the trash where the folder icon was.
    const row = withClass(pane, 'del-row');
    assert.equal(row.tagName, 'SUMMARY');
    assert.equal(row.parentElement.dataset.dir, 'src');
    assert.equal(row.parentElement.open, true, 'the folder shut under the person');
    assert.equal(row.attributes['aria-label'], 'Delete src/ and its 3 files?');
    assert.equal(row.attributes['aria-description'], 'Enter on Delete confirms, Escape leaves it');
    const mark = withClass(row, 'del-mark');
    assert.equal(mark.attributes['aria-hidden'], 'true');
    assert.ok(mark.innerHTML.includes('<svg'), 'the mark is not the trash');
    assert.equal(withClass(row, 'del-name').textContent, 'src/');
    assert.ok(withClass(row, 'del-name').classes.includes('del-name'), 'the name is not struck through');

    // The two answers stand where the download and the delete were, and ✓ holds focus.
    const yes = labelled(pane, 'Delete src/ and its 3 files');
    const no = labelled(pane, 'Keep src/');
    assert.ok(yes !== undefined, 'no ✓ on the row');
    assert.ok(no !== undefined, 'no ✕ on the row');
    assert.equal(yes.parentElement, row, '✓ is not in the row it belongs to');
    assert.equal(doc.activeElement, yes, 'focus did not land on the deletion');

    // What goes with the folder is drawn struck and nested under it: the folder inside it, and the
    // files inside that.
    const nested = allWithClass(pane, 'del-plain');
    assert.ok(
      nested.some((line) => nameIn(line) === 'main.ts'),
      'the folder’s own files are not drawn as going with it',
    );
    assert.ok(
      allWithClass(pane, 'sum').some((line) => (line.children[1]?.textContent ?? '') === 'api/'),
      'a folder inside the folder is not drawn as going with it',
    );
    assert.ok(
      nested.some((line) => nameIn(line) === 'handler.ts'),
      'the nested folder’s contents are not drawn as going with it',
    );
    // A struck line is a picture, not a row: nothing in what goes with the folder can be opened.
    assert.equal(
      nested.some((line) => line.dataset.open !== undefined),
      false,
      'a row that is going is still a control',
    );
  });

  it('takes it out on ✓, says what went, and puts the row back on ✕', async () => {
    const { pane, view, calls, said } = deletable();
    view.render();
    labelled(pane, 'Delete src/').fire('click');
    labelled(pane, 'Delete src/ and its 3 files').fire('click');
    await until(() => calls.length === 1, 'the removal');
    assert.deepEqual(calls, ['src']);
    assert.deepEqual(said, ['Deleted src/ and its 3 files']);
    assert.equal(allWithClass(pane, 'del-row').length, 0, 'the row is still asking after the removal');

    // ✕ keeps it, and the row is a row again — downloadable, openable, its name unbroken.
    labelled(pane, 'Delete main.ts').fire('click');
    assert.equal(allWithClass(pane, 'del-row').length, 1);
    // ✓ names the file it would remove by its path and ✕ the file it would keep, the same way a
    // folder's do: the row is the one that was pressed, and what the two answers say has to name the
    // file wherever it is.
    labelled(pane, 'Keep src/main.ts').fire('click');
    assert.equal(allWithClass(pane, 'del-row').length, 0, '✕ left the row asking');
    assert.ok(labelled(pane, 'Delete main.ts') !== undefined, 'the row never came back');
    assert.equal(rowFor(pane, 'main.ts').tagName, 'BUTTON', 'the row is not the row again');
  });

  it('leaves it on Escape, wherever focus is in the row', () => {
    const { pane, view, calls, said } = deletable();
    view.render();
    labelled(pane, 'Delete src/').fire('click');
    pane.fire('keydown', { key: 'Escape' });
    assert.equal(allWithClass(pane, 'del-row').length, 0, 'Escape left the row asking');
    assert.deepEqual(calls, [], 'Escape removed something');
    assert.deepEqual(said, [], 'Escape said something');
    assert.equal(view.isCreating(), false);
  });

  it('keeps the question open, with the folder’s own sentence, when the removal is refused', async () => {
    const sentence = 'src is not in the folder any more, so nothing was removed.';
    const refused = deletable({ remove: async () => ({ kind: 'refused', sentence }) });
    refused.view.render();
    labelled(refused.pane, 'Delete src/').fire('click');
    labelled(refused.pane, 'Delete src/ and its 3 files').fire('click');
    await until(() => allWithClass(refused.pane, 'row-note').length === 1, 'the refusal');
    assert.equal(withClass(refused.pane, 'row-note').children[0], sentence);
    assert.equal(allWithClass(refused.pane, 'del-row').length, 1, 'a refusal closed the question');
    assert.deepEqual(refused.said, [], 'a refusal announced a deletion');
  });

  it('names a file’s own row after its leaf and a folder’s after its path', () => {
    const { pane, view } = deletable({ listing: ['src/main.ts'] });
    view.render();
    // A file’s control is read by its leaf; a folder’s by the path, with the slash that says folder.
    assert.ok(labelled(pane, 'Delete main.ts') !== undefined);
    labelled(pane, 'Delete main.ts').fire('click');
    assert.ok(labelled(pane, 'Delete src/main.ts') !== undefined, '✓ does not name the file it would remove');
    assert.ok(labelled(pane, 'Keep src/main.ts') !== undefined, '✕ does not name the file it would keep');
    assert.equal(
      allWithClass(pane, 'del-row')[0].tagName,
      'DIV',
      'a file’s asking row is not the row itself',
    );
  });
});

describe('moving a file', () => {
  function movable(overrides = {}) {
    const calls = [];
    const said = [];
    const state = {
      listing: ['src/main.ts', 'src/lib.ts', 'tests/join.rs', 'README.md'],
      current: undefined,
      touch: false,
      opened: [],
      participants: [],
      canCreate: true,
      say: (text) => void said.push(text),
      ...overrides,
    };
    // The page republishes the walk and redraws the tree while the move is still in flight, so the
    // stub does too: the drawing and the act are one sequence in the real page, and a view that only
    // ever renders after the move resolves would not be the one that ships.
    let live;
    state.move =
      overrides.move ??
      (async (path, into) => {
        const leaf = path.split('/').pop();
        const to = into === '' ? leaf : `${into}/${leaf}`;
        if (state.listing.includes(to)) {
          return { kind: 'refused', sentence: `${to} is already in the folder, so nothing was moved.` };
        }
        state.listing = state.listing.filter((known) => known !== path).concat(to);
        calls.push([path, into]);
        live.view.render();
        return { kind: 'moved', to };
      });
    const { pane, view } = makeView(state);
    live = { view };
    return { pane, view, calls, said, state };
  }

  it('drags a file onto a folder, marks the folder as a whole, and speaks the move', async () => {
    const { pane, view, calls, said } = movable();
    view.render();
    const transfer = dataTransfer();

    pane.fire('dragstart', { target: rowFor(pane, 'main.ts'), dataTransfer: transfer });
    assert.equal(
      said[0],
      'Picked up main.ts. Up and down choose a folder, Enter drops it, Escape leaves it where it is.',
    );
    assert.deepEqual(transfer.written, [['text/plain', 'src/main.ts']]);
    assert.equal(transfer.effectAllowed, 'move');
    assert.ok(rowFor(pane, 'main.ts').parentElement.classes.includes('dragging'), 'the row it came from is not dimmed');

    // The folder a drop would land in is marked as a whole: the pointer is over `tests/`.
    const tests = summaryFor(pane, 'tests/');
    let prevented = 0;
    pane.fire('dragover', { target: tests, dataTransfer: transfer, preventDefault: () => void (prevented += 1) });
    assert.equal(prevented, 1, 'a drop on a folder was not accepted');
    assert.ok(tests.classes.includes('drop-into'), 'the folder is not marked as where it lands');

    pane.fire('drop', { target: tests, dataTransfer: transfer });
    await until(() => calls.length === 1, 'the move');
    assert.deepEqual(calls, [['src/main.ts', 'tests']]);
    assert.equal(said.at(-1), 'Moved main.ts into tests');
  });

  it('walks the folders from the keyboard and drops the file where the choice is', async () => {
    const { pane, view, calls, said } = movable();
    view.render();
    const row = () => rowFor(pane, 'main.ts');

    // Space picks it up: the sentence is the whole instruction, because the keys are not on screen.
    pane.fire('keydown', { target: row(), key: ' ' });
    assert.equal(
      said[0],
      'Picked up main.ts. Up and down choose a folder, Enter drops it, Escape leaves it where it is.',
    );
    assert.ok(row().parentElement.classes.includes('dragging'), 'the picked-up row is not dimmed');

    // The choice walks every folder the listing has, in order, and the top level last.
    pane.fire('keydown', { target: row(), key: 'ArrowUp' });
    assert.equal(said[1], 'Already into src', 'the folder it is in is not read as where it already is');
    pane.fire('keydown', { target: row(), key: 'ArrowDown' });
    assert.equal(said[2], 'Drops into tests');
    assert.ok(summaryFor(pane, 'tests/').classes.includes('drop-into'), 'the choice is not marked');
    pane.fire('keydown', { target: row(), key: 'ArrowDown' });
    assert.equal(said[3], 'Drops at the top level');
    assert.ok(withClass(pane, 'drop-into').tagName === 'UL', 'the top level is not marked as a whole');
    pane.fire('keydown', { target: row(), key: 'ArrowUp' });
    assert.equal(said[4], 'Drops into tests');

    pane.fire('keydown', { target: row(), key: 'Enter' });
    await until(() => calls.length === 1, 'the move');
    assert.deepEqual(calls, [['src/main.ts', 'tests']]);
    assert.equal(said.at(-1), 'Moved main.ts into tests');
    // The row moved with the file, so focus is on the row at its new path.
    assert.equal(doc.activeElement, rowFor(pane, 'main.ts'), 'focus did not return to the file’s row');
    assert.equal(summaryFor(pane, 'tests/').parentElement.open, true, 'the folder it landed in is shut');
  });

  it('leaves the file where it is on Escape, and says which file', () => {
    const { pane, view, calls, said } = movable();
    view.render();
    pane.fire('keydown', { target: rowFor(pane, 'main.ts'), key: ' ' });
    pane.fire('keydown', { target: rowFor(pane, 'main.ts'), key: 'Escape' });
    assert.deepEqual(calls, [], 'Escape moved the file');
    assert.equal(said.at(-1), 'Left main.ts where it is');
    assert.equal(allWithClass(pane, 'dragging').length, 0, 'the row is still dimmed');
    assert.equal(doc.activeElement, rowFor(pane, 'main.ts'), 'focus did not come back to the row');
  });

  it('refuses to move a file the room holds open, and says why', () => {
    const { pane, view, calls, said } = movable({ inRoom: ['src/main.ts'] });
    view.render();
    // The pointer: the drag never begins, so nothing is dimmed and no folder is marked for a file
    // that could not land in it.
    pane.fire('dragstart', { target: rowFor(pane, 'main.ts'), dataTransfer: dataTransfer() });
    assert.equal(allWithClass(pane, 'dragging').length, 0, 'an open file was picked up');
    assert.match(said[0], /is open in the room, so it cannot be moved/);
    // The keyboard: Space answers the same way.
    pane.fire('keydown', { target: rowFor(pane, 'main.ts'), key: ' ' });
    assert.match(said[1], /is open in the room, so it cannot be moved/);
    assert.deepEqual(calls, [], 'an open file was moved');
  });

  it('does not move a file into the folder it is already in', () => {
    const { pane, view, calls, said } = movable();
    view.render();
    pane.fire('keydown', { target: rowFor(pane, 'main.ts'), key: ' ' });
    pane.fire('keydown', { target: rowFor(pane, 'main.ts'), key: 'ArrowUp' });
    assert.equal(allWithClass(pane, 'drop-into').length, 0, 'the folder it is already in is marked');
    pane.fire('keydown', { target: rowFor(pane, 'main.ts'), key: 'Enter' });
    assert.deepEqual(calls, [], 'the file was moved into the folder it was already in');
    assert.equal(said.at(-1), 'Already into src');
  });

  it('does not move a file onto a name the folder already holds', () => {
    // `tests/main.ts` is already there: the folder would refuse the write, so the drop is refused
    // before it is made, and no folder is marked for it.
    const { pane, view, calls } = movable({ listing: ['src/main.ts', 'tests/main.ts', 'tests/join.rs'] });
    view.render();
    const transfer = dataTransfer();
    pane.fire('dragstart', { target: rowFor(pane, 'main.ts'), dataTransfer: transfer });
    const tests = summaryFor(pane, 'tests/');
    let prevented = 0;
    pane.fire('dragover', { target: tests, dataTransfer: transfer, preventDefault: () => void (prevented += 1) });
    assert.equal(prevented, 0, 'a name the folder holds was accepted as a drop');
    assert.equal(tests.classes.includes('drop-into'), false, 'a folder that holds the name is marked');
    pane.fire('drop', { target: tests, dataTransfer: transfer });
    assert.deepEqual(calls, [], 'the file was moved onto a name the folder holds');
  });
});
