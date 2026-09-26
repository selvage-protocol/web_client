/**
 * The room's seats: the order the colours are handed out in, and one colour per peer across the
 * three surfaces this page paints a peer on.
 *
 * The bar's faces, the grant tree's presence badges and the editor's carets are three renders of one
 * room, and a person has to read as the same person in all three. The colours are worked out once —
 * `seats.ts`, from the room the bar draws — and this file holds the order they are handed out in,
 * that the three surfaces take that one answer, and that a peer the page's own list does not name
 * keeps the colour the bridge derived from its id.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { MonacoBinding } from '../src/browser/editor.ts';
import { peerColour } from '../src/bridge/index.ts';
import { renderRoom } from '../src/browser/room.ts';
import type { RoomPerson } from '../src/browser/room.ts';
import { SEAT_LIMIT, SEAT_PALETTE, seatColours } from '../src/browser/seats.ts';
import { GrantTreeView } from '../src/browser/tree-view.ts';
import { grantLevels } from '../src/browser/tree.ts';

/**
 * A DOM the two renderers can draw into. It holds what they touch — children, classes, attributes,
 * the two ways a colour is written (`style.backgroundColor` and `style.setProperty`), focus — and
 * the rules a `<style>` element is handed, which is where the editor's caret colour is read from.
 */
const rules: string[] = [];

function makeElement(tag: string): any {
  const listeners: Record<string, Array<(event: unknown) => void>> = {};
  const element: any = {
    tag,
    children: [] as unknown[],
    classes: [] as string[],
    properties: {} as Record<string, string>,
    attributes: {} as Record<string, string>,
    dataset: {} as Record<string, string>,
    style: { setProperty: (name: string, value: string) => void (element.properties[name] = value) },
    textContent: '',
    title: '',
    type: '',
    value: '',
    hidden: false,
    open: false,
    disabled: false,
    spellcheck: false,
    autocomplete: '',
    maxLength: 0,
    innerHTML: '',
    focused: false,
    parentElement: undefined as unknown,
  };
  const adopt = (node: unknown): void => {
    if (typeof node === 'object' && node !== null && 'tag' in (node as object)) {
      (node as { parentElement?: unknown }).parentElement = element;
    }
  };
  Object.defineProperty(element, 'className', {
    get: () => element.classes.join(' '),
    set: (value: string) => {
      element.classes = String(value).split(/\s+/).filter((name) => name !== '');
    },
  });
  Object.defineProperty(element, 'lastElementChild', {
    get: () => element.children[element.children.length - 1],
  });
  element.classList = {
    add: (name: string) => {
      if (!element.classes.includes(name)) element.classes.push(name);
    },
    remove: (name: string) => (element.classes = element.classes.filter((known: string) => known !== name)),
    toggle: (name: string, on: boolean) => {
      if (on === true && !element.classes.includes(name)) element.classes.push(name);
      if (on === false) element.classList.remove(name);
    },
    contains: (name: string) => element.classes.includes(name),
  };
  element.append = (...nodes: unknown[]) => {
    for (const node of nodes) element.appendChild(node);
  };
  element.appendChild = (node: unknown) => {
    if (tag === 'style' && typeof node === 'string') rules.push(node);
    element.children.push(node);
    adopt(node);
    return node;
  };
  element.insertBefore = (node: unknown, before: unknown) => {
    element.children = element.children.filter((known: unknown) => known !== node);
    const at = element.children.indexOf(before);
    element.children.splice(at === -1 ? element.children.length : at, 0, node);
    adopt(node);
    return node;
  };
  element.replaceChildren = (...nodes: unknown[]) => {
    element.children = [];
    for (const node of nodes) {
      element.children.push(node);
      adopt(node);
    }
  };
  element.remove = () => {
    const parent = element.parentElement as any;
    if (parent !== undefined) {
      parent.children = parent.children.filter((known: unknown) => known !== element);
    }
  };
  element.addEventListener = (type: string, run: (event: unknown) => void) =>
    void ((listeners[type] ??= []).push(run));
  element.removeEventListener = (type: string, run: (event: unknown) => void) => {
    listeners[type] = (listeners[type] ?? []).filter((known) => known !== run);
  };
  element.setAttribute = (name: string, value: string) => void (element.attributes[name] = value);
  element.getAttribute = (name: string) => element.attributes[name];
  element.removeAttribute = (name: string) => delete element.attributes[name];
  element.contains = (node: unknown) => walk(element).includes(node);
  element.focus = () => {
    element.focused = true;
    doc.activeElement = element;
  };
  element.setSelectionRange = () => {};
  element.select = () => {};
  return element;
}

const doc: { activeElement: unknown; head: unknown; createElement: (tag: string) => any } = {
  activeElement: null,
  head: { appendChild: () => {} },
  createElement: (tag: string) => makeElement(tag),
};
globalThis.document = doc as unknown as Document;

/** Every element in `node`'s subtree carrying this class. */
function withClass(node: any, name: string): any[] {
  return walk(node).filter((element) => element.classes?.includes(name) === true);
}

/** Every element under one, itself first. */
function walk(node: any): any[] {
  const found: any[] = [];
  const visit = (element: any) => {
    found.push(element);
    for (const child of element.children ?? []) {
      if (typeof child !== 'string') visit(child);
    }
  };
  visit(node);
  return found;
}

// -- the editor -------------------------------------------------------------

function makeModel(text: string): any {
  const lines = () => text.split('\n');
  return {
    isDisposed: () => false,
    dispose: () => {},
    getValue: () => text,
    getEOL: () => '\n',
    onDidChangeContent: () => ({ dispose: () => {} }),
    getOffsetAt: (position: { lineNumber: number; column: number }) => {
      const source = lines();
      let offset = 0;
      for (let index = 0; index < position.lineNumber - 1; index += 1) {
        offset += (source[index] ?? '').length + 1;
      }
      return offset + position.column - 1;
    },
    getPositionAt: (offset: number) => {
      const source = lines();
      let rest = offset;
      for (let index = 0; index < source.length; index += 1) {
        if (rest <= (source[index] ?? '').length) return { lineNumber: index + 1, column: rest + 1 };
        rest -= (source[index] ?? '').length + 1;
      }
      return { lineNumber: source.length, column: (source[source.length - 1] ?? '').length + 1 };
    },
  };
}

function makeEditor(): any {
  return {
    decorations: [] as any[],
    createDecorationsCollection: function () {
      return {
        set: (next: any[]) => void (this.decorations = next),
        clear: () => void (this.decorations = []),
      };
    },
    onDidChangeCursorSelection: () => ({ dispose: () => {} }),
    getSelection: () => null,
    setModel: () => {},
    setPosition: () => {},
    revealPositionInCenter: () => {},
  };
}

interface Peer {
  peer_id: string;
  display_name: string;
  role: string;
}

function makeEngine(texts: Map<string, string>, peers: Peer[], self: Peer): any {
  const listeners = new Set<(event: unknown) => void>();
  return {
    session: () => ({ role: self.role, roomId: 'r-seats', peer: self, documents: [...texts.keys()] }),
    text: (path: string) => texts.get(path) ?? '',
    has: (path: string) => texts.has(path),
    open: async () => {},
    close: async () => {},
    openDocuments: () => [],
    insert: () => {},
    delete: () => {},
    setSelection: () => {},
    setAwareness: () => {},
    // Each peer is in the room's file, which is what puts a badge on its row and a caret in the
    // buffer: the tree reads a path off the presence, never off the peer.
    presence: () =>
      peers.map((peer) => ({
        peer,
        state: { path: 'notes.txt', selection: { anchor: 0, head: 3 } },
      })),
    resolveSelection: () => ({ anchor: 1, head: 1 }),
    peers: () => peers,
    documents: () => [...texts.keys()],
    grantedPaths: () => [],
    on: (listener: (event: unknown) => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

/** The caret decoration the editor drew for one peer, found by the name it hovers. */
function caretOf(editor: any, name: string): any {
  const found = editor.decorations.filter(
    (entry) => (entry.options.hoverMessage?.value ?? '').startsWith(`${name} `),
  );
  assert.equal(found.length, 1, `the editor drew ${found.length} caret bars for ${name}`);
  return found[0];
}

/** The rule a class was given, out of everything the two `<style>` elements were handed. */
function ruleFor(className: string): string {
  return rules.find((rule) => new RegExp(`\\.${className}\\s*\\{`).test(rule)) ?? '';
}

const SELF: Peer = { peer_id: 'peer-self', display_name: 'Jo', role: 'guest' };
const ADA: Peer = { peer_id: 'peer-ada', display_name: 'Ada', role: 'host' };
const BO: Peer = { peer_id: 'peer-bo', display_name: 'Bo', role: 'guest' };

/** The binding, open on a file with one peer in it, ready for its seats to be handed in. */
async function seated(peers: Peer[] = [ADA]): Promise<{ binding: any; editor: any }> {
  // The rules one binding mints are named from zero, so each test starts from an empty sheet.
  rules.length = 0;
  const engine = makeEngine(new Map([['notes.txt', 'one\ntwo\n']]), peers, SELF);
  const editor = makeEditor();
  const binding = new MonacoBinding({
    engine,
    editor,
    onNotice: () => {},
    createModel: (text: string) => makeModel(text),
  });
  await binding.openDocument('notes.txt');
  return { binding, editor };
}

describe('the seat order', () => {
  it('gives the host Mauve and the seat beside it Teal', () => {
    const colours = seatColours([
      { peerId: 'peer-self', role: 'host' },
      { peerId: 'peer-ada', role: 'guest' },
      { peerId: 'peer-bo', role: 'guest' },
    ]);
    assert.equal(colours.get('peer-self'), '#cba6f7', 'the host is not Mauve');
    assert.equal(colours.get('peer-ada'), '#94e2d5', 'the second seat is not Teal');
    assert.equal(colours.get('peer-bo'), '#f5e0dc');
  });

  it('takes the first seat for the host even when the host is somebody else', () => {
    const colours = seatColours([
      { peerId: 'peer-self', role: 'guest' },
      { peerId: 'peer-ada', role: 'host' },
      { peerId: 'peer-bo', role: 'guest' },
    ]);
    assert.equal(colours.get('peer-ada'), '#cba6f7', 'the host does not take Mauve');
    assert.equal(colours.get('peer-self'), '#94e2d5', 'your own seat does not follow the host');
    assert.equal(colours.get('peer-bo'), '#f5e0dc');
  });

  it('closes the gap when the host is gone: your own seat leads', () => {
    const colours = seatColours([
      { peerId: 'peer-self', role: 'guest' },
      { peerId: 'peer-bo', role: 'guest' },
    ]);
    assert.equal(colours.get('peer-self'), '#cba6f7');
    assert.equal(colours.get('peer-bo'), '#94e2d5');
  });

  it('gives eight seats eight fills, none of them shared', () => {
    const seats = Array.from({ length: 8 }, (_, index) => ({
      peerId: `peer-${index}`,
      role: index === 0 ? 'host' : 'guest',
    }));
    const colours = seatColours(seats);
    assert.equal(colours.size, 8, `eight seats took ${colours.size} colours`);
    assert.equal(new Set(colours.values()).size, 8, `a colour repeated: ${[...colours.values()]}`);
    assert.equal(colours.get('peer-0'), '#cba6f7');
  });

  it('names thirteen seats and leaves the rest to the colour they already had', () => {
    const seats = Array.from({ length: 14 }, (_, index) => ({
      peerId: `peer-${index}`,
      role: 'guest',
    }));
    const colours = seatColours(seats);
    assert.equal(colours.size, SEAT_LIMIT);
    assert.equal(colours.has('peer-13'), false, 'a fourteenth seat was given a fill of its own');
    assert.equal(new Set(colours.values()).size, SEAT_LIMIT);
  });

  it('leaves the crown its own yellow', () => {
    // The one colour the page draws the host's crown in (`public/index.html`), so a face filled
    // with it would swallow the mark. Read from the stylesheet rather than restated here.
    const page = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
    const crown = /--warning:\s*(#[0-9a-f]{6})/i.exec(page)?.[1] ?? '';
    assert.equal(crown, '#f9e2af', 'the page no longer declares the crown colour this pins');
    assert.ok(
      !(SEAT_PALETTE as readonly string[]).includes(crown),
      'Yellow is a seat fill, and a face filled with it swallows the host’s crown',
    );
  });
});

describe('one peer, one colour', () => {
  it('the bar, the tree and the editor paint the peer in the seat the page gave it', async () => {
    const { binding, editor } = await seated();
    // What the page does with the room it is handed: work the seats out once, hand them to the
    // editor, and paint the faces from the same map (`main.ts`'s `seatedRoom`).
    const people: RoomPerson[] = [
      { peerId: SELF.peer_id, displayName: 'Jo', role: 'guest', colour: peerColour(SELF.peer_id), path: undefined, self: true },
      { peerId: ADA.peer_id, displayName: 'Ada', role: 'host', colour: peerColour(ADA.peer_id), path: 'notes.txt', self: false },
    ];
    const colours = seatColours(people);
    binding.setSeatColours(colours);
    const participants = binding.participants();

    // The bar: the face's fill.
    const strip = makeElement('div');
    renderRoom(
      strip,
      people.map((person) => ({ ...person, colour: colours.get(person.peerId) ?? person.colour })),
      { followedPeerId: undefined, openAnchor: undefined, limit: 5, onAnchor: () => {} },
    );
    const face = withClass(strip, 'av').find((element) => element.attributes['data-anchor'] === ADA.peer_id);
    assert.ok(face !== undefined, 'the bar drew no face for the peer');

    // The tree: the presence badge's background, off the participants the page's tree reads.
    const pane = makeElement('div');
    const listing = ['notes.txt'];
    const tree = new GrantTreeView({
      pane,
      source: {
        grantListing: () => listing,
        grantTree: (directory = '') => grantLevels(listing).get(directory) ?? [],
        currentPath: () => undefined,
        isOpenInRoom: () => false,
        hasText: () => false,
        isTextEmpty: () => false,
        participants: () => participants,
      },
      pinned: new Set<string>(),
      touch: () => false,
      open: () => {},
    });
    tree.render();
    const badge = withClass(pane, 'badge')[0];
    assert.ok(badge !== undefined, 'the tree drew no presence badge');

    // The editor: the caret bar the bridge's own cursors are drawn as, once the seats are in.
    binding.renderCursors(binding.bridge.cursors());
    const caret = caretOf(editor, 'Ada');
    const seat = colours.get(ADA.peer_id);
    assert.equal(face.properties['--c'], seat);
    assert.equal(badge.style.backgroundColor, seat);
    assert.ok(ruleFor(caret.options.className).includes(`border-left: 2px solid ${seat}`), 'the caret bar lost the seat colour');
    assert.equal(caret.options.overviewRuler.color, seat);
    assert.equal(face.properties['--c'], badge.style.backgroundColor);
    assert.equal(badge.style.backgroundColor, caret.options.overviewRuler.color);
    assert.equal(seat, '#cba6f7', 'the host did not take Mauve across the three');
    binding.dispose();
  });

  it('repaints the carets it is already drawing when the seats move', async () => {
    const { binding, editor } = await seated([ADA, BO]);
    // Drawn in the bridge's own colours first, as they are before the page hands a room in: the
    // open draws whatever the engine holds.
    const before = caretOf(editor, 'Bo');
    assert.ok(ruleFor(before.options.className).includes(peerColour(BO.peer_id)));
    // Bo is the second seat down, so the seat the page hands in moves the colour already on screen.
    binding.setSeatColours(
      seatColours([
        { peerId: SELF.peer_id, role: 'host' },
        { peerId: BO.peer_id, role: 'guest' },
      ]),
    );
    const after = caretOf(editor, 'Bo');
    assert.equal(after.options.overviewRuler.color, '#94e2d5', 'the caret kept the colour it had');
    assert.ok(
      ruleFor(after.options.className).includes('border-left: 2px solid #94e2d5'),
      'the caret bar was left in the replaced colour',
    );
    binding.dispose();
  });

  it('keeps the colour the bridge derived for a peer the seat list does not name', async () => {
    const { binding, editor } = await seated([ADA, BO]);
    // Only the host is named, as a page that hands in a room of one would.
    binding.setSeatColours(
      seatColours([{ peerId: SELF.peer_id, role: 'guest' }, { peerId: ADA.peer_id, role: 'host' }]),
    );
    const named = binding.participants().find((participant) => participant.peerId === ADA.peer_id);
    const unnamed = binding.participants().find((participant) => participant.peerId === BO.peer_id);
    assert.equal(named.colour, '#cba6f7');
    assert.equal(unnamed.colour, peerColour(BO.peer_id), 'an unnamed seat lost the colour it had');
    binding.renderCursors(binding.bridge.cursors());
    const caret = caretOf(editor, 'Bo');
    assert.equal(caret.options.overviewRuler.color, peerColour(BO.peer_id));
    assert.ok(ruleFor(caret.options.className).includes(`border-left: 2px solid ${peerColour(BO.peer_id)}`));
    binding.dispose();
  });
});
