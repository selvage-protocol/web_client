/**
 * Saving a room path this window has no text for yet.
 *
 * A guest may save any file the room lists, and for most of them this window holds nothing: a name
 * is all a listing carries, and the text arrives when somebody opens it. So the download is two
 * steps — ask the room, wait for the text, then save — and the order is the whole of it.
 *
 * **Waiting is not optional.** Saving whatever `text(path)` answers before the room has replied
 * writes an empty file over the text the person asked for: a real file with the right name and no
 * contents, which is worse than no file at all, because nothing about it says it is wrong. So the
 * save happens only once the room has the path (`has`), and the text is read *after* that. A fetch
 * that never lands saves nothing and says so.
 *
 * Asking is done with the engine's own `open`, the same call opening a file makes, because that is
 * what makes the room send the text — there is no read-only fetch in the protocol, and a second
 * mechanism would be a second thing to keep true (`§6.3`, `§12`). It is why the page says so once:
 * fetching a file opens it for everybody.
 */

/** What the fetch-and-save act needs of the room and of the browser. */
export interface FetchSavePorts {
  /** Whether this window holds the path's text. */
  has(path: string): boolean;
  /** The text, once `has` says it is here. */
  text(path: string): string;
  /** Asks the room for the path's text, without putting it in front of the editor. */
  open(path: string): Promise<void>;
  /** Saves it — the page's own blob and anchor. */
  save(path: string, text: string): void;
}

/** How a download of a path with no text here ended. */
export type FetchSaveOutcome =
  /** The text arrived and was saved. */
  | { kind: 'saved'; text: string }
  /**
   * Nothing was saved: the text arrived empty, or it did not arrive inside the stand.
   *
   * Empty is not a failure — an empty file is a state a person may want — but it is not the file
   * they asked for either, so it is offered rather than assumed.
   */
  | { kind: 'empty'; text: string }
  /** Asking the room failed. Nothing was saved. */
  | { kind: 'failed'; sentence: string };

/** How long the page waits for the room before it offers the person a choice. */
export const FETCH_STAND_MS = 10_000;

/** How often the wait re-asks whether the text has arrived. */
const POLL_MS = 100;

export interface FetchSaveOptions {
  standMs?: number;
  /** The wait, injected so the suite needs no timers. */
  wait?: (ms: number) => Promise<void>;
  /** How many polls the stand lasts. */
  polls?: number;
}

/** What the row says while it waits. */
export function fetchingSentence(path: string): string {
  return `Fetching ${path}…`;
}

/** What opening a file costs the room, said once in a session, before the first fetch. */
export function fetchCostsSentence(path: string): string {
  return `Fetching opens ${path} in the room, so every peer receives it.`;
}

/** What a fetch that landed nothing says, in the desktop clients' own words. */
export function stillEmptySentence(path: string): string {
  return `${path} is still empty — the host has not sent its text yet.`;
}

/** What a fetch that could not be asked for says. */
export function fetchFailedSentence(path: string, reason: string): string {
  return `Could not download ${path}: ${reason}`;
}

/** How long the cost sentence stands before it takes itself down. */
export const FETCH_COSTS_STAND_MS = 5000;

/**
 * Saves `path`, fetching its text first when this window has none.
 *
 * A window that already holds the text saves it at once: the browser's own download UI is the
 * confirmation, and a message about a file that was already here would be noise.
 */
export async function fetchAndSave(
  path: string,
  ports: FetchSavePorts,
  options: FetchSaveOptions = {},
): Promise<FetchSaveOutcome> {
  if (ports.has(path)) {
    const text = ports.text(path);
    ports.save(path, text);
    return { kind: 'saved', text };
  }
  try {
    await ports.open(path);
  } catch (error: unknown) {
    return { kind: 'failed', sentence: fetchFailedSentence(path, reason(error)) };
  }
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const polls = options.polls ?? Math.max(1, Math.ceil((options.standMs ?? FETCH_STAND_MS) / POLL_MS));
  for (let poll = 0; poll < polls && !ports.has(path); poll += 1) {
    await wait(POLL_MS);
  }
  if (!ports.has(path)) {
    // Nothing saved: an empty file would be this page's own invention, not the room's answer.
    return { kind: 'empty', text: '' };
  }
  const text = ports.text(path);
  if (text === '') {
    // The room answered and the answer is empty. Offered, not assumed: the person asked for the
    // host's text, and this is not it.
    return { kind: 'empty', text };
  }
  ports.save(path, text);
  return { kind: 'saved', text };
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
