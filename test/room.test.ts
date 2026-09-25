/**
 * The room's people: the faces in the session bar, the menu a face opens, and the list the `+N`
 * opens.
 *
 * `room.ts` is a render and two computations, so all of it is asserted here without a browser —
 * the caps, the marks a face wears, the words every control is read by, and the acts behind them.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  FACE_LIMIT,
  MORE_ANCHOR,
  PHONE_FACE_LIMIT,
  faceLabel,
  focusInto,
  menuPlacement,
  renderEveryoneMenu,
  renderPersonMenu,
  renderRoom,
  renameHoldsTheList,
  syncExpanded,
  visibleFaces,
} from '../src/browser/room.ts';
import type { RoomPerson } from '../src/browser/room.ts';

/** The smallest document a render needs: elements, their attributes, and the events they fire. */
function makeDocument() {
  // The document the fixture's own `focus` writes back to, as a browser's does: `renderRoom` reads
  // `activeElement` before every redraw, so a fake that only set `focused` would leave the removed
  // face as the active element and no second redraw could restore anything.
  const document = {
    activeElement: null as any,
    createElement: (tag: string) => make(tag),
  };
  function make(tag: string) {
    const listeners: Record<string, ((event: unknown) => void)[]> = {};
    const attributes: Record<string, string> = {};
    const element = {
      tag,
      tagName: tag.toUpperCase(),
      children: [] as unknown[],
      classes: [] as string[],
      /** The class list, under both the names a DOM element offers it by. */
      get className() {
        return element.classes.join(' ');
      },
      set className(value: string) {
        element.classes = value.split(' ').filter((name) => name !== '');
      },
      textContent: '',
      /** Markup written by an icon, opaque here: it is `icons.ts`'s string, not more children. */
      html: '',
      title: '',
      value: '',
      maxLength: undefined as number | undefined,
      type: '',
      disabled: false,
      spellcheck: undefined as boolean | undefined,
      autocomplete: undefined as string | undefined,
      focused: false,
      selected: false,
      /** What a hold reads (`renameHoldsTheList`): who this element was appended to. */
      parentElement: null as any,
      dataset: {} as Record<string, string>,
      properties: {} as Record<string, string>,
      classList: {
        add: (name: string) => void element.classes.push(name),
        toggle: () => {},
        remove: () => {},
      },
      style: {
        setProperty: (name: string, value: string) => void (element.properties[name] = value),
      },
      set innerHTML(html: string) {
        element.html = html;
      },
      get innerHTML() {
        return element.html;
      },
      replaceChildren: (...nodes: unknown[]) => {
        element.children = nodes;
        for (const node of nodes) adopt(element, node);
      },
      append: (...nodes: unknown[]) => {
        for (const node of nodes) {
          element.children.push(node);
          adopt(element, node);
        }
      },
      appendChild: (node: unknown) => {
        element.children.push(node);
        adopt(element, node);
      },
      /** What a redraw asks before it takes the faces away, and what a hold asks after it. */
      contains: (node: unknown) => walk(element).includes(node),
      addEventListener: (type: string, listener: (event: unknown) => void) =>
        void ((listeners[type] ??= []).push(listener)),
      /** Fires what a real element fires, so a test drives the control it drew. */
      fire: (type: string, event: Record<string, unknown> = {}) => {
        for (const run of listeners[type] ?? []) {
          run({ preventDefault: () => {}, stopPropagation: () => {}, ...event });
        }
      },
      focus: () => {
        element.focused = true;
        document.activeElement = element;
      },
      select: () => void (element.selected = true),
      setAttribute: (name: string, value: string) => void (attributes[name] = value),
      getAttribute: (name: string) => attributes[name],
      querySelector: (selector: string) => walk(element).find((node) => matches(node, selector)) ?? null,
      querySelectorAll: (selector: string) => walk(element).filter((node) => matches(node, selector)),
    };
    return element;
  }
  return document;
}

/** The two things an append changes: the child list, and the parent a hold reads. */
function adopt(parent: any, node: unknown): void {
  if (typeof node === 'object' && node !== null && 'tag' in (node as object)) {
    (node as any).parentElement = parent;
  }
}

/** Every element under one, itself first: what the selectors below are answered from. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function walk(node: { children?: unknown[] }): any[] {
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

/** The three selectors `room.ts` and the page ask a menu for, and nothing more. */
function matches(element: any, selector: string): boolean {
  return selector.split(',').some((part) => {
    const at = part.trim();
    if (at === 'input') return element.tag === 'input';
    if (at === 'button:not(:disabled)') return element.tag === 'button' && element.disabled === false;
    if (at === '[data-anchor]') return element.getAttribute('data-anchor') !== undefined;
    if (at.startsWith('[data-act=')) return element.getAttribute('data-act') === at.slice(11, -2);
    if (at.startsWith('.')) return element.classes.includes(at.slice(1));
    throw new Error(`the fake document does not know the selector ${at}`);
  });
}

/** A node's own readable text: what it holds, and what its children hold, in order. */
function textOf(node: unknown): string {
  if (typeof node === 'string') return node;
  const element = node as { textContent?: string; children?: unknown[] };
  let text = element.textContent ?? '';
  for (const child of element.children ?? []) text += textOf(child);
  return text;
}

function withClass(node: any, name: string): any[] {
  return walk(node).filter((element) => element.classes.includes(name));
}

function buttonsIn(node: any): any[] {
  return walk(node).filter((element) => element.tag === 'button');
}

const SELF: RoomPerson = {
  peerId: 'peer-self',
  displayName: 'Jo',
  role: 'guest',
  colour: '#cba6f7',
  path: undefined,
  self: true,
};
const MIRA: RoomPerson = {
  peerId: 'peer-mira',
  displayName: 'Mira',
  role: 'host',
  colour: '#94e2d5',
  path: 'src/room.rs',
  self: false,
};
const SAM: RoomPerson = {
  peerId: 'peer-sam',
  displayName: 'sam',
  role: 'guest',
  colour: '#e06c75',
  path: undefined,
  self: false,
};
const BO = { ...SAM, peerId: 'peer-b', displayName: 'bo' };
const CY = { ...SAM, peerId: 'peer-c', displayName: 'cy' };
const DEE = { ...SAM, peerId: 'peer-d', displayName: 'dee' };

function renderCluster(people: RoomPerson[], view: Record<string, unknown> = {}) {
  const document = makeDocument();
  globalThis.document = document as unknown as Document;
  const host = document.createElement('span') as any;
  const pressed: string[] = [];
  renderRoom(host, people, {
    followedPeerId: undefined,
    openAnchor: undefined,
    limit: FACE_LIMIT,
    onAnchor: (anchor: string) => void pressed.push(anchor),
    ...view,
  } as never);
  return { host, pressed };
}

function renderMenu(people: RoomPerson[], person: RoomPerson, view: Record<string, unknown> = {}) {
  const document = makeDocument();
  globalThis.document = document as unknown as Document;
  const menu = document.createElement('div') as any;
  const calls: unknown[] = [];
  renderPersonMenu(menu, person, {
    all: people,
    followedPeerId: undefined,
    fromList: false,
    onGoTo: (peerId: string) => void calls.push(['go', peerId]),
    onFollow: (peerId: string) => void calls.push(['follow', peerId]),
    onStopFollow: (peerId: string) => void calls.push(['stop', peerId]),
    onRename: () => void calls.push(['rename']),
    onBack: () => void calls.push(['back']),
    ...view,
  } as never);
  return { menu, calls };
}

describe('the faces a cluster shows', () => {
  /** Six seats: one more than a pointer device's bar has room for. */
  const people = [SELF, MIRA, SAM, BO, CY, DEE];

  it('shows everyone up to the cap, and the rest behind the +N', () => {
    assert.deepEqual(visibleFaces(people.slice(0, 3), FACE_LIMIT, undefined).hidden, []);
    const capped = visibleFaces(people, FACE_LIMIT, undefined);
    assert.equal(capped.shown.length, FACE_LIMIT - 1);
    assert.equal(capped.hidden.length, people.length - capped.shown.length);
    assert.deepEqual(capped.shown.map((person) => person.displayName), ['Jo', 'Mira', 'sam', 'bo']);
    assert.deepEqual(capped.hidden.map((person) => person.displayName), ['cy', 'dee']);
  });

  it('is always your own face first', () => {
    const { host } = renderCluster(people);
    const faces = walk(host).filter((element) => element.classes.includes('av'));
    assert.equal(faces[0].getAttribute('aria-label'), 'Jo, (you)');
    assert.ok(faces[0].classes.includes('me'), 'your own face does not wear the solid ring');
    assert.equal(faces.filter((face) => face.classes.includes('me')).length, 1, 'a second face is marked as yours');
  });

  it('never hides the followed face behind the +N', () => {
    // The ring is the one place a follow shows on this bar, so the face it is on takes the last
    // shown slot rather than being counted away.
    const { shown, hidden } = visibleFaces(people, FACE_LIMIT, 'peer-d');
    assert.ok(shown.includes(DEE), 'the followed face is behind the +N');
    assert.equal(shown.at(-1), DEE, 'the followed face does not take the last shown slot');
    assert.ok(!hidden.includes(DEE), 'the followed face is hidden and shown at once');
    assert.equal(shown[0], SELF, 'the pinned face displaced your own');
    assert.deepEqual(hidden.map((person) => person.displayName), ['bo', 'cy']);
    // And one that is already shown is left where it is.
    assert.deepEqual(
      visibleFaces(people, FACE_LIMIT, 'peer-mira').shown.map((person) => person.peerId),
      ['peer-self', 'peer-mira', 'peer-sam', 'peer-b'],
    );
  });

  it('holds three faces on a phone and five on a pointer device', () => {
    assert.equal(FACE_LIMIT, 5);
    assert.equal(PHONE_FACE_LIMIT, 3);
    assert.equal(visibleFaces(people, PHONE_FACE_LIMIT, undefined).shown.length, 2);
    assert.equal(visibleFaces(people.slice(0, 3), PHONE_FACE_LIMIT, undefined).hidden.length, 0);
  });
});

describe('the cluster and the faces in it', () => {
  it('names the group for the room, and the faces for the people', () => {
    const { host } = renderCluster([SELF, MIRA, SAM]);
    assert.equal(host.getAttribute('role'), 'group');
    assert.equal(host.getAttribute('aria-label'), '3 in the room');
    const faces = buttonsIn(host);
    assert.deepEqual(
      faces.map((face) => face.getAttribute('aria-label')),
      ['Jo, (you)', 'Mira, host', 'sam'],
    );
    // The host's role is beside the name in the accessible name and after a separator in the
    // tooltip; every other face reads the bare name.
    assert.deepEqual(
      faces.map((face) => face.title),
      ['Jo', 'Mira \u00b7 Host', 'sam'],
    );
  });

  it('carries the person’s marks in the order the design draws them', () => {
    assert.equal(faceLabel(MIRA, [SELF, MIRA], 'peer-mira'), 'Mira, host, following');
    assert.equal(faceLabel(SELF, [SELF, MIRA], undefined), 'Jo, (you)');
    assert.equal(faceLabel({ ...MIRA, role: 'guest' }, [MIRA], undefined), 'Mira');
  });

  it('opens a dialog from every face, and says which one is open', () => {
    const { host, pressed } = renderCluster([SELF, MIRA], { openAnchor: 'peer-mira' });
    const faces = buttonsIn(host);
    assert.deepEqual(faces.map((face) => face.getAttribute('aria-haspopup')), ['dialog', 'dialog']);
    assert.deepEqual(faces.map((face) => face.getAttribute('aria-expanded')), ['false', 'true']);
    faces[0].fire('click');
    assert.deepEqual(pressed, ['peer-self'], 'a press on a face opens nothing');
    // The room's own colour, the one the caret and the tree badges wear.
    assert.equal(faces[1].properties['--c'], '#94e2d5');
  });

  it('wears the crown on the host’s face and on no other', () => {
    const { host } = renderCluster([SELF, MIRA, SAM]);
    const crowns = withClass(host, 'crown');
    assert.equal(crowns.length, 1, 'the host is not the only face with a crown');
    assert.equal(crowns[0].getAttribute('role'), 'img');
    assert.equal(crowns[0].getAttribute('aria-label'), 'Host');
    assert.ok(crowns[0].html.includes('viewBox="0 0 256 256"'), 'the crown is not the design’s glyph');
    const [you, mira] = buttonsIn(host);
    assert.deepEqual(withClass(you, 'crown'), [], 'a guest wears the crown');
    assert.equal(withClass(mira, 'crown').length, 1, 'the host wears no crown');
  });

  it('marks the followed face with a dashed ring and an eye', () => {
    const { host } = renderCluster([SELF, MIRA, SAM], { followedPeerId: 'peer-sam' });
    const followed = buttonsIn(host).filter((face) => face.classes.includes('followed'));
    assert.equal(followed.length, 1, 'the followed face is not the only one marked');
    assert.equal(followed[0].getAttribute('aria-label'), 'sam, following');
    assert.equal(withClass(followed[0], 'eye').length, 1, 'the followed face carries no eye');
    assert.equal(withClass(host, 'eye').length, 1, 'the eye is on more than one face');
  });

  it('counts what it could not show, and names the list behind the +N', () => {
    const { host, pressed } = renderCluster([SELF, MIRA, SAM, BO, CY, DEE]);
    const verbs = buttonsIn(host);
    assert.equal(verbs.length, FACE_LIMIT, 'the cluster shows more controls than it has slots');
    const more = verbs.find((face) => face.classes.includes('more'));
    assert.ok(more !== undefined, 'no +N over a room of six');
    assert.equal(textOf(more), '+2');
    assert.equal(more.getAttribute('aria-label'), '2 more \u2014 everyone in the room');
    assert.equal(more.title, 'Everyone in the room');
    assert.equal(more.getAttribute('data-anchor'), MORE_ANCHOR);
    more.fire('click');
    assert.deepEqual(pressed, [MORE_ANCHOR]);
    // A room that fits is offered no list: the count would be the faces themselves.
    const room = renderCluster([SELF, MIRA, SAM, BO, CY]).host;
    assert.equal(buttonsIn(room).length, 5);
    assert.equal(
      buttonsIn(room).some((face) => face.classes.includes('more')),
      false,
      'a room that fits is offered a list of everyone',
    );
  });
});

describe('a person’s menu', () => {
  it('heads the menu with the face, the name and where they are', () => {
    const { menu } = renderMenu([SELF, MIRA], MIRA);
    assert.equal(menu.getAttribute('role'), 'dialog');
    assert.equal(menu.getAttribute('aria-label'), 'Mira');
    assert.equal(withClass(menu, 'name')[0].textContent, 'Mira');
    assert.equal(withClass(menu, 'where')[0].textContent, 'in src/room.rs');
    // The header's face is a picture of the same face, and a host's crown is on it.
    assert.equal(withClass(menu, 'head')[0].children.some((child: any) => child.classes.includes('av')), true);
    assert.equal(withClass(menu, 'crown').length, 1, 'the host’s crown is missing from the menu');
  });

  it('offers Go to and Follow to a peer with a file open', () => {
    const { menu, calls } = renderMenu([SELF, MIRA], MIRA);
    const verbs = buttonsIn(menu);
    assert.deepEqual(verbs.map((verb) => textOf(verb)), ['Go to', 'Follow']);
    // The page keeps focus on the control the press came from when the room refuses it, by asking
    // the menu for the go-to's own anchor; a button without it is one the refusal can never land on.
    assert.equal(menu.querySelector('[data-act="go"]'), verbs[0], 'the Go to button is not the anchor the page focuses on a refusal');
    // No `aria-pressed`: the words already flip between Follow and Stop following, and the toggle's
    // own press is its label. `Stop following, pressed` is the same state read twice, and backwards.
    assert.equal(verbs[1].getAttribute('aria-pressed'), undefined, 'the follow toggle carries a pressed state its words already say');
    verbs[0].fire('click');
    verbs[1].fire('click');
    assert.deepEqual(calls, [['go', 'peer-mira'], ['follow', 'peer-mira']]);
  });

  it('offers no Go to while the peer is in no file, and says where they are', () => {
    const { menu } = renderMenu([SELF, SAM], SAM);
    assert.equal(
      buttonsIn(menu).some((verb) => textOf(verb) === 'Go to'),
      false,
      'a peer with no file open is offered a Go to that can only refuse',
    );
    assert.equal(withClass(menu, 'waiting')[0].textContent, 'not in a file yet');
    // The head says where they are as well, which is what the design draws.
    assert.equal(withClass(menu, 'where')[0].textContent, 'not in a file yet');
    assert.deepEqual(buttonsIn(menu).map((verb) => textOf(verb)), ['Follow']);
  });

  it('is a toggle: the followed peer reads Stop following, and pressing it stops', () => {
    const { menu, calls } = renderMenu([SELF, MIRA], MIRA, { followedPeerId: 'peer-mira' });
    const follow = buttonsIn(menu).find((verb) => textOf(verb) === 'Stop following');
    assert.ok(follow !== undefined, 'the followed peer is not offered the way out of it');
    assert.equal(follow.getAttribute('aria-pressed'), undefined, 'the state is read twice, and the words are enough');
    assert.equal(follow.title, 'Stop following');
    follow.fire('click');
    assert.deepEqual(calls, [['stop', 'peer-mira']]);
  });

  it('offers the own name’s edit on your own seat, and nothing else', () => {
    const { menu, calls } = renderMenu([SELF, MIRA], SELF);
    const verbs = buttonsIn(menu);
    assert.deepEqual(verbs.map((verb) => textOf(verb)), ['Rename']);
    assert.equal(verbs[0].title, 'Set the name other participants see');
    assert.equal(verbs[0].getAttribute('aria-label'), 'Set the name other participants see');
    assert.equal(withClass(menu, 'marks')[0].textContent, '(you)');
    assert.deepEqual(withClass(menu, 'where'), [], 'your own seat is given a place it does not have');
    verbs[0].fire('click');
    assert.deepEqual(calls, [['rename']]);
  });

  it('stands the refusal in the menu of the peer it is about, and in no other', () => {
    const text = 'nothing to go to: sam is not in a document';
    const refused = renderMenu([SELF, SAM, MIRA], SAM, { goToRefusal: { peerId: 'peer-sam', text } });
    assert.equal(withClass(refused.menu, 'refusal')[0].textContent, text);
    assert.deepEqual(withClass(renderMenu([SELF, SAM, MIRA], MIRA).menu, 'refusal'), [], 'the refusal landed in another menu');
    assert.deepEqual(withClass(renderMenu([SELF, SAM, MIRA], SAM).menu, 'refusal'), []);
  });

  it('carries the way back to the list when the menu was opened from it', () => {
    const { menu, calls } = renderMenu([SELF, MIRA], MIRA, { fromList: true });
    const back = buttonsIn(menu)[0];
    assert.equal(textOf(back), 'Everyone in the room');
    assert.equal(back.classes.includes('back'), true);
    back.fire('click');
    assert.deepEqual(calls, [['back']]);
    assert.deepEqual(withClass(renderMenu([SELF, MIRA], MIRA).menu, 'back'), []);
  });
});

describe('the own name’s edit', () => {
  function renaming(overrides: Record<string, unknown> = {}) {
    const events: unknown[] = [];
    const edit = {
      opened: 'Jo',
      value: 'Jo',
      maxLength: 32,
      commit: (value: string) => void events.push(['commit', value]),
      cancel: () => void events.push(['cancel']),
      ...overrides,
    };
    const { menu } = renderMenu([SELF], SELF, { renaming: edit });
    return { menu, events, edit };
  }

  it('opens the field on the name in force, in place of the control that opened it', () => {
    const { menu, edit } = renaming();
    const field = withClass(menu, 'rename')[0];
    assert.equal(field.tag, 'input');
    assert.equal(field.value, 'Jo');
    assert.equal(field.maxLength, 32);
    assert.equal(field.getAttribute('aria-label'), 'The name other participants see');
    assert.equal(field.title, 'The name other participants see');
    assert.equal(withClass(menu, 'rename-edit').length, 1);
    assert.equal(withClass(menu, 'rename-edit')[0].children.includes(field), true);
    assert.equal(edit.field, field, 'the draw does not hand its field back to the page');
    assert.equal(
      buttonsIn(menu).some((verb) => textOf(verb) === 'Rename'),
      false,
      'a second Rename opens a second field',
    );
  });

  it('disables the ✓ while the field names nothing, and sends what it holds', () => {
    const { menu, events } = renaming();
    const field = withClass(menu, 'rename')[0];
    const save = withClass(menu, 'rename-save')[0];
    const cancel = withClass(menu, 'rename-cancel')[0];
    assert.equal(save.getAttribute('aria-label'), 'Set this name');
    assert.equal(cancel.getAttribute('aria-label'), 'Leave the name as it is');
    field.value = '  ';
    field.fire('input');
    assert.equal(save.disabled, true, 'a name of nothing is offered to the room');
    field.value = 'ada';
    field.fire('input');
    assert.equal(save.disabled, false);
    field.fire('keydown', { key: 'Enter' });
    assert.deepEqual(events, [['commit', 'ada']], 'Enter does not send the typed name');
    field.fire('keydown', { key: 'Escape' });
    assert.deepEqual(events, [['commit', 'ada'], ['cancel']], 'Escape does not drop the typed name');
    save.fire('click');
    assert.deepEqual(events.at(-1), ['commit', 'ada'], 'the ✓ sends something else');
    cancel.fire('click');
    assert.deepEqual(events.at(-1), ['cancel'], 'the ✕ sends something');
  });

  it('holds the dialog still only while the person is in the name field', () => {
    const { edit } = renaming();
    const field = edit.field as any;
    const group = field.parentElement;
    const save = withClass(group, 'rename-save')[0];
    assert.equal(renameHoldsTheList(field, field), true, 'a field that has focus does not hold the dialog still');
    // The ✓ beside the field is the control a press is about to land on: a draw that unmounts it
    // takes the press with it, so the hold is the field's group rather than the field alone.
    assert.equal(renameHoldsTheList(field, save), true, 'the ✓ beside a focused field is taken away before the press lands');
    assert.equal(renameHoldsTheList(field, null), false, 'an edit nobody is in holds the dialog still');
    assert.equal(renameHoldsTheList(field, group.parentElement), false, 'focus outside the edit holds the dialog still');
    assert.equal(renameHoldsTheList(undefined, field), false, 'a hold with no field holds the dialog still');
  });
});

describe('everyone in the room', () => {
  it('counts the room, and gives every person a row', () => {
    const document = makeDocument();
    globalThis.document = document as unknown as Document;
    const menu = document.createElement('div') as any;
    const picks: string[] = [];
    const people = [SELF, MIRA, SAM];
    renderEveryoneMenu(menu, people, {
      followedPeerId: 'peer-mira',
      onPick: (peerId: string) => void picks.push(peerId),
    });
    assert.equal(menu.getAttribute('role'), 'dialog');
    assert.equal(menu.getAttribute('aria-label'), 'Everyone in the room');
    assert.equal(withClass(menu, 'name')[0].textContent, '3 in the room');
    const rows = withClass(menu, 'list')[0].children;
    assert.equal(rows.length, 3);
    // Each row is one control, and its name carries the marks the face wears: the row is what a
    // reader reaches, and the face inside it is a picture of one.
    const verbs = buttonsIn(menu);
    assert.deepEqual(
      verbs.map((verb) => verb.getAttribute('aria-label')),
      ['Jo, (you)', 'Mira, host, following, in src/room.rs', 'sam, not in a file yet'],
    );
    assert.equal(withClass(verbs[0], 'marks')[0].textContent, '(you)');
    assert.equal(withClass(verbs[2], 'where')[0].textContent, 'not in a file yet');
    verbs[1].fire('click');
    assert.deepEqual(picks, ['peer-mira']);
  });
});

/**
 * The dialog and the faces are both reads of the room, so they are drawn wherever it changes — the
 * hold for the one field somebody is typing in is the only draw given up (`renameHoldsTheList`).
 *
 * What is asserted here is the consequence of that: a draw replaces the elements, so the face and
 * the menu have to be told where the person's focus and the new facts are.
 */
describe('the dialog follows the room', () => {
  /** One more draw of the same menu, over the element it already stands in. */
  function redrawPerson(menu: any, person: RoomPerson, all: readonly RoomPerson[]): void {
    renderPersonMenu(menu, person, {
      all,
      followedPeerId: undefined,
      fromList: false,
      onGoTo: () => {},
      onFollow: () => {},
      onStopFollow: () => {},
      onRename: () => {},
      onBack: () => {},
    } as never);
  }

  it('draws the peer again, so the menu that stood over them is where they are now', () => {
    globalThis.document = makeDocument() as unknown as Document;
    const menu = (globalThis.document as unknown as ReturnType<typeof makeDocument>).createElement('div') as any;
    redrawPerson(menu, SAM, [SELF, SAM]);
    assert.deepEqual(buttonsIn(menu).map((verb) => textOf(verb)), ['Follow']);
    assert.equal(withClass(menu, 'waiting')[0].textContent, 'not in a file yet');
    // Sam opened a file between the draw and this one: the same menu, drawn again, offers the
    // `Go to` it can now honour instead of the line saying there is nowhere to go.
    redrawPerson(menu, { ...SAM, path: 'src/room.rs' }, [SELF, { ...SAM, path: 'src/room.rs' }]);
    assert.deepEqual(buttonsIn(menu).map((verb) => textOf(verb)), ['Go to', 'Follow']);
    assert.deepEqual(withClass(menu, 'waiting'), [], 'the menu still says Sam is nowhere');
    // And back: the peer who closed the file reads where they are, with no dead verb.
    redrawPerson(menu, SAM, [SELF, SAM]);
    assert.deepEqual(buttonsIn(menu).map((verb) => textOf(verb)), ['Follow']);
    assert.equal(withClass(menu, 'waiting')[0].textContent, 'not in a file yet');
  });

  it('draws the list again, so a room that grew does not keep the old count', () => {
    globalThis.document = makeDocument() as unknown as Document;
    const menu = (globalThis.document as unknown as ReturnType<typeof makeDocument>).createElement('div') as any;
    const view = { followedPeerId: undefined, onPick: () => {} } as never;
    renderEveryoneMenu(menu, [SELF, MIRA], view);
    assert.equal(withClass(menu, 'name')[0].textContent, '2 in the room');
    renderEveryoneMenu(menu, [SELF, MIRA, SAM], view);
    assert.equal(withClass(menu, 'name')[0].textContent, '3 in the room');
    assert.equal(withClass(menu, 'list')[0].children.length, 3);
  });
});

describe('focus in the cluster', () => {
  /** The face carrying one anchor, as it stands after a draw. */
  function faceFor(host: any, anchor: string): any {
    return buttonsIn(host).find((face) => face.getAttribute('data-anchor') === anchor);
  }

  function drawAgain(host: any, people: RoomPerson[], view: Record<string, unknown> = {}): void {
    renderRoom(host, people, {
      followedPeerId: undefined,
      openAnchor: undefined,
      limit: FACE_LIMIT,
      onAnchor: () => {},
      ...view,
    } as never);
  }

  it('puts focus back on the face it was on when the faces are drawn again', () => {
    const { host } = renderCluster([SELF, MIRA, SAM]);
    faceFor(host, 'peer-mira').focus();
    // The room drew the same faces again, and `replaceChildren` took the focused element with it.
    // Twice: the face the first draw put focus back on is the one the second draw reads.
    drawAgain(host, [SELF, MIRA, SAM]);
    assert.equal(faceFor(host, 'peer-mira').focused, true, 'the face the person was on lost focus to the redraw');
    assert.equal(buttonsIn(host).filter((face) => face.focused).length, 1, 'focus landed on more than the face it was on');
    drawAgain(host, [SELF, MIRA, SAM]);
    assert.equal(faceFor(host, 'peer-mira').focused, true, 'a second redraw lost the face the first one put focus back on');
  });

  it('leaves focus alone when the face it was on is no longer drawn', () => {
    const { host } = renderCluster([SELF, MIRA, SAM]);
    faceFor(host, 'peer-mira').focus();
    // Mira left: her face is not drawn any more, and there is no control to invent in its place.
    // Focus stays where the removal put it, through a redraw or two.
    drawAgain(host, [SELF, SAM]);
    drawAgain(host, [SELF, SAM]);
    assert.deepEqual(buttonsIn(host).map((face) => face.focused), [false, false], 'a face took focus that nobody was on');
  });

  it('keeps the followed face focused when the follow pins it into the strip', () => {
    const { host } = renderCluster([SELF, MIRA, SAM]);
    faceFor(host, 'peer-sam').focus();
    // Following pins the followed face to the last shown slot; the anchor is the same, so the face
    // is still drawn and focus is still on it.
    drawAgain(host, [SELF, MIRA, SAM], { followedPeerId: 'peer-sam' });
    assert.equal(faceFor(host, 'peer-sam').focused, true, 'the followed face dropped focus when it was pinned');
  });
});

describe('which face says it is open', () => {
  it('moves aria-expanded to the face that was pressed, in a room that never redrew', () => {
    const { host } = renderCluster([SELF, MIRA], { openAnchor: 'peer-self' });
    assert.deepEqual(buttonsIn(host).map((face) => face.getAttribute('aria-expanded')), ['true', 'false']);
    // A press on Mira's face replaces the dialog, and the room sends nothing to redraw the faces
    // for: the state is read back onto every anchor instead of waiting for a presence frame.
    syncExpanded(host, 'peer-mira');
    assert.deepEqual(buttonsIn(host).map((face) => face.getAttribute('aria-expanded')), ['false', 'true']);
    syncExpanded(host, undefined);
    assert.deepEqual(buttonsIn(host).map((face) => face.getAttribute('aria-expanded')), ['false', 'false']);
  });
});

/**
 * The page's own wiring of the pieces above. `main.ts` is the entry module and runs on import, so
 * it has no seam a test can call: these read the draw itself, and the consequences it is made of
 * are `renderRoom`, `renderPersonMenu`, `renameHoldsTheList` and `syncExpanded` above.
 */
describe('the page draws the dialog wherever it draws the faces', () => {
  const main = readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8');
  const drawRoom = /function drawRoom\([\s\S]*?\n\}/.exec(main)?.[0] ?? '';

  it('redraws the open dialog on the presence frame that moved the room under it', () => {
    assert.notEqual(drawRoom, '', 'the page has no draw of the room');
    assert.match(drawRoom, /renderRoom\(faceStrip/, 'the room is never drawn as faces');
    // The dialog is a read of the room too, so the same draw stands it up again — unless the person
    // is in the name field, which is the one thing a redraw must not take.
    assert.match(
      drawRoom,
      /if \(menu !== undefined && !renameHoldsTheList\(renamingField, document\.activeElement\)\) \{[\s\S]*?renderMenu\(menuFocusSelector\(\)\);/,
      'a presence frame does not redraw the dialog standing over it',
    );
  });

  it('reads the faces’ expanded state back from the one dialog that is open', () => {
    assert.match(
      main,
      /syncExpanded\(faceStrip, menu\?\.anchor\)/,
      'a press on another face leaves the last one saying it is open',
    );
    assert.match(
      main,
      /syncExpanded\(faceStrip, undefined\)/,
      'closing the dialog leaves a face saying it is open',
    );
  });

  it('moves focus back to the face only when the dialog had the person’s attention', () => {
    assert.match(
      main,
      /const inside = focusInMenu\(\);/,
      'Escape cannot tell a stray key from one aimed at the dialog',
    );
    // The face counts as the dialog's own only when it is the face the dialog stands under: focus on
    // another face is not attention the dialog has, and moving it would be the same theft.
    assert.match(
      main,
      /active\.getAttribute\('data-anchor'\) === menu\?\.anchor\)/,
      'Escape treats any face as the dialog’s own, and can move focus off the face the person is on',
    );
    assert.match(main, /closeMenu\(inside\)/, 'Escape closes the dialog regardless of where the person was');
  });
});

describe('where the menu stands', () => {
  const frame = { left: 0, top: 0, width: 390 };

  it('puts its right edge on the face’s, its top 8 px under it', () => {
    assert.deepEqual(menuPlacement({ right: 300, bottom: 60 }, frame, 240), { left: 60, top: 68 });
  });

  it('keeps its left edge 8 px inside the frame when the face is at either edge', () => {
    // A face at the far left of a narrow screen would put the menu off the edge: the left edge
    // holds 8 px off the frame's own, which is the rule the leave question already followed.
    assert.deepEqual(menuPlacement({ right: 20, bottom: 50 }, frame, 240), { left: 8, top: 58 });
    assert.deepEqual(menuPlacement({ right: 300, bottom: 50 }, frame, 380), { left: 8, top: 58 });
  });
});

describe('focus moves into the menu', () => {
  it('takes the first control, or the one the press came for', () => {
    globalThis.document = makeDocument() as unknown as Document;
    const { menu } = renderMenu([SELF, SAM], SAM);
    focusInto(menu);
    assert.equal(buttonsIn(menu)[0].focused, true, 'the menu takes no focus at all');
    const { menu: own } = renderMenu([SELF], SELF, {
      renaming: { opened: 'Jo', value: 'Jo', maxLength: 32, commit: () => {}, cancel: () => {} },
    });
    focusInto(own, '.rename');
    const field = withClass(own, 'rename')[0];
    assert.equal(field.focused, true, 'the field the press asked for does not take focus');
    assert.equal(field.selected, true, 'the field is not selected for a name to replace');
  });
});
