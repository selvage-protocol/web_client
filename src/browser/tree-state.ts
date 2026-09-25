/**
 * Everything the tree's rows are drawn from beside where everyone is: the listing, which file is
 * open, what the room knows about each path, the create row when one is open, and whether this
 * device has a pointer.
 *
 * A re-render is owed when this changes and not when only the presence on the rows moved, which is
 * every frame a peer's cursor takes — on a listing of thousands of paths that re-render is the whole
 * cost of watching someone else type.
 *
 * A granted path carries no line feed and no NUL (a name with a control character is not a granted
 * path), so joining the listing is unambiguous: two listings that read the same have the same key.
 */

/** What the tree draws a row from besides where everyone is. */
export interface RowChrome {
  /** The open file, whose row is lit. */
  current: string | undefined;
  /** Whether this device has no hover, which is what the row's actions depend on. */
  touch: boolean;
  /** The create row, as `kind:parent`, or `''` when none is open. */
  draft: string;
  /** The directories this session made that no listing carries. */
  local: string;
  /** The paths whose write was refused, in the room's order. */
  unsaved: string;
  /** Whether the host is away and the grace is running (a guest's dimming). */
  hostAway: boolean;
  /**
   * What each row says about the room: its text is here, the room holds it, it reads empty.
   *
   * Part of the row chrome because the *listing* does not carry it. A path is in a listing from the
   * grant alone, so a document arriving — which is what the `●` is about — can change every row on
   * screen while the listing reads exactly the same, and a frame that redrew nothing would leave
   * every mark stale.
   */
  marks: string;
}

export function rowsKey(listing: readonly string[], chrome: RowChrome): string {
  return [
    chrome.current ?? '',
    chrome.touch ? '1' : '0',
    chrome.draft,
    chrome.local,
    chrome.unsaved,
    chrome.hostAway ? '1' : '0',
    chrome.marks,
    listing.join('\n'),
  ].join('\u0000');
}

/**
 * Whether a grant-tree directory renders expanded: pinned open by the guest, holding the open file,
 * or holding the create row — a row a person is typing into must never be behind a collapsed
 * directory.
 */
export function dirOpen(path: string, pinned: ReadonlySet<string>, current: string | undefined): boolean {
  if (pinned.has(path)) {
    return true;
  }
  return current !== undefined && current.startsWith(`${path}/`);
}

/**
 * What a row says about the room, beside its name.
 *
 * The distinction the tree exists to draw is *is this file's text in the room?* — the one thing a
 * host most wants to know (which of their files has left their folder) and the one thing a guest
 * cannot otherwise tell. `inRoom` is the room's own open-document set, which both roles receive, so
 * the mark means the same thing on both sides.
 *
 * `empty` is a fact the page has been told: the text is here, and it is empty. It used to cover the
 * other state as well — the room holds a path open and nothing has arrived for it — so a guest's row
 * said `empty` for a document the host had not sent a byte of, and the only thing that separated the
 * two was a `title`, which a phone never shows. That is a claim about a document nobody has read, so
 * the unfetched state has a tag of its own and `empty` is left for the empty one.
 */
export interface RoomRowState {
  /** The room holds this path open. */
  inRoom: boolean;
  /** This window has the path's text. */
  textHere: boolean;
  /** The text this window has is empty. Meaningful only with `textHere`. */
  textEmpty: boolean;
  /** This window holds the folder, so it is the one that can read the file off a disk. */
  host: boolean;
}

export type RoomMark =
  | { kind: 'none' }
  | { kind: 'in-room'; title: string }
  | { kind: 'empty'; title: string }
  | { kind: 'not-here'; title: string };

/** The tooltip for the `●` a row wears when its text is in the room. */
export const IN_THE_ROOM_TITLE = 'Its text is in the room.';

/** What the `empty` tag says on a guest's screen, where the room is the one that sent the text. */
export const EMPTY_IN_ROOM_TITLE = 'The room sent its text, and it is empty.';

/** What it says on a host's screen, where this page read the file itself. */
export const EMPTY_FILE_TITLE = 'The file is empty.';

/**
 * What the tag for the unfetched state reads, on both roles' screens.
 *
 * A guest's row is waiting on a fetch it asked for and nobody has answered; a host's is waiting on
 * a file this window has not read yet. `fetched` is the page's own word for the first, and the two
 * titles below say which one this is rather than making the tag say both.
 */
export const NOT_HERE_TAG = 'not fetched yet';

/** What the tag says to a guest: the room holds it open and the text has not arrived. */
export const NOT_SENT_TITLE =
  'The room holds it open, and its text has not arrived yet.';

/** What it says to a host, which fetches nothing: this window has not read the file yet. */
export const NOT_READ_TITLE =
  'The room holds it open, and this window has not read the file yet.';

/** What a guest's row says while the host is away, since no text can arrive until it returns. */
export const HOST_AWAY_ROW_TITLE = 'The host is away, so its text cannot arrive.';

export function roomMark(state: RoomRowState): RoomMark {
  if (!state.inRoom) {
    return { kind: 'none' };
  }
  if (!state.textHere) {
    return { kind: 'not-here', title: state.host ? NOT_READ_TITLE : NOT_SENT_TITLE };
  }
  if (state.textEmpty) {
    return { kind: 'empty', title: state.host ? EMPTY_FILE_TITLE : EMPTY_IN_ROOM_TITLE };
  }
  return { kind: 'in-room', title: IN_THE_ROOM_TITLE };
}
