/**
 * The grant tree's redraw budget.
 *
 * The tree draws rows — which paths exist, which is open — and badges — who is in which
 * file. Rows change when the listing does; badges change on every presence frame, which is
 * every cursor move every peer makes. A room can list thousands of paths, so a presence
 * frame that rebuilds the rows costs the main thread the whole tree per keystroke of
 * somebody else's typing. These tests count what a frame actually redraws.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { GrantTreeView } from '../src/browser/tree-view.ts';
import { grantLevels } from '../src/browser/tree.ts';

/** A DOM that counts what it is asked to make, and keeps the children it is given. */
const world = { created: 0 };

function makeElement(tag) {
  world.created += 1;
  const element = {
    tag,
    children: [],
    className: '',
    textContent: '',
    title: '',
    type: '',
    innerHTML: '',
    hidden: false,
    open: false,
    style: {},
    dataset: {},
    classes: [],
    listeners: {},
    classList: { add: (name) => void element.classes.push(name), remove: () => {} },
    append: (...nodes) => void element.children.push(...nodes),
    appendChild: (node) => {
      element.children.push(node);
      return node;
    },
    replaceChildren: (...nodes) => {
      element.children.length = 0;
      element.children.push(...nodes);
    },
    addEventListener: (type, run) => void element.listeners[type]?.push(run) ?? (element.listeners[type] = [run]),
    setAttribute: () => {},
    remove: () => {},
  };
  /** Fires the element's own click handler, the way a real button's would. */
  element.click = () => {
    for (const run of element.listeners.click ?? []) {
      run({ isTrusted: true });
    }
  };
  return element;
}

globalThis.document = {
  createElement: (tag) => makeElement(tag),
  head: { appendChild: () => {} },
};

/** Every element in `node`'s subtree carrying this class, depth first. */
function allWithClass(node, className) {
  const found = [];
  for (const child of node.children ?? []) {
    if (child.className === className) {
      found.push(child);
    }
    found.push(...allWithClass(child, className));
  }
  return found;
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
    isUnpublished: () => state.unpublished,
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
    open: (path) => void state.opened.push(path),
  });
  return { pane, view };
}

describe('the grant tree redraws what changed', () => {
  it('a presence move repaints the rows it moved, not the tree', () => {
    const state = {
      listing: listing(60),
      current: 'src/mod00/file000.ts',
      unpublished: false,
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
    const state = {
      listing: listing(4),
      current: undefined,
      unpublished: false,
      touch: false,
      opened: [],
      participants: [],
    };
    const { pane, view } = makeView(state);
    view.render();
    const built = pane.children[0];

    state.listing = [...state.listing, 'src/mod09/late.ts'];
    view.render();
    assert.notEqual(pane.children[0], built, 'a new path did not redraw the tree');
  });

  it('the open file and its chrome rebuild the tree', () => {
    const state = {
      listing: listing(4),
      current: undefined,
      unpublished: false,
      touch: false,
      opened: [],
      participants: [],
    };
    const { pane, view } = makeView(state);
    view.render();
    const built = pane.children[0];

    state.current = 'src/mod00/file000.ts';
    state.unpublished = true;
    view.render();
    assert.notEqual(pane.children[0], built, 'opening a file did not redraw the tree');
    assert.equal(withClass(pane, 'unpub').textContent, 'not yet shared');

    // A pointer arrives mid-session: the pill's words are the row's chrome, and a
    // repaint of the badges alone would leave the short form standing.
    state.touch = true;
    view.render();
    assert.equal(withClass(pane, 'unpub').textContent, 'not shared by the host');
  });

  it('a row click opens the path the row names', () => {
    const state = {
      listing: ['src/main.ts'],
      current: undefined,
      unpublished: false,
      touch: false,
      opened: [],
      participants: [],
    };
    const { pane, view } = makeView(state);
    view.render();
    withClass(pane, 'row').click();
    assert.deepEqual(state.opened, ['src/main.ts']);
  });
});

describe('an empty listing', () => {
  /**
   * The dead end this sentence exists for: a fresh room whose folder holds nothing shows a
   * read-only editor and no explanation, and the two people looking at it can do different things
   * about it. The host holds the folder and may create in it; a guest is waiting on the host.
   */
  it('reads differently to the person who can fill it', () => {
    const state = {
      listing: [],
      current: undefined,
      unpublished: false,
      touch: false,
      opened: [],
      participants: [],
    };

    const guest = makeView({ ...state, canCreate: false });
    guest.view.render();
    assert.equal(withClass(guest.pane, 'empty').textContent, 'The host has not shared any files yet.');

    const host = makeView({ ...state, canCreate: true });
    host.view.render();
    const line = withClass(host.pane, 'empty').textContent;
    assert.match(line, /Create a file/);
    assert.ok(!line.includes('The host'), 'a host is told about the host');
  });
});
