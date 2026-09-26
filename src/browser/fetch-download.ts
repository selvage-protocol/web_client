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
 * save happens only once the room has answered and that answer carries text, and it is read from
 * the document that arrived. A fetch that nothing arrives for saves nothing and says the wait is
 * still running. The wait ends at the answer, empty included: waiting for text past a document
 * that has already arrived is waiting for something that is never coming.
 *
 * **The test for all of that is `has`, and never whether the document is open in front of the
 * editor.** An open document is not an answered one: a guest that taps a row's ⤓ on the file it has
 * just opened holds a model whose text is `''` until the room replies, and treating that as the
 * person's own file is how the 0-byte download came back. What is here and answered — an empty
 * document included, which is the room saying the file it read is empty, or a buffer this window
 * has already written into — is the person's own copy of the file as it stands, and a path with no
 * document here is a fetch. Reading an empty buffer as the room's answer instead told a guest who
 * had cleared their own file that the host had sent no text for it, and asked them to save the empty
 * file they had already asked for.
 *
 * Asking is done with the engine's own `open`, the same call opening a file makes, because that is
 * what makes the room send the text — there is no read-only fetch in the protocol, and a second
 * mechanism would be a second thing to keep true (`§6.3`, `§12`). It is why the page says so once:
 * fetching a file opens it for everybody.
 */

/** What the fetch-and-save act needs of the room and of the browser. */
export interface FetchSavePorts {
  /**
   * Whether anything has arrived here for the path: text the room sent, or text this window
   * wrote into the document. False means nothing at all has come, which is not the same as an
   * empty answer.
   */
  has(path: string): boolean;
    /** The text once `has` says it is here, and nothing for a path it does not. */
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
   * Nothing was saved and the answer that arrived inside the fetch carries no text for the path:
   * `has` turned true while the fetch was waiting, and what it holds is empty.
   *
   * Empty is not a failure — an empty file is a state a person may want — but it is not the file
   * they asked for either: it is the room's news rather than the copy the person already had, so it
   * is offered rather than assumed. The copy a window *holds* when it asks never reaches this case;
   * it is saved as it stands.
   */
  | { kind: 'empty'; text: string }
  /**
   * Nothing arrived for the path inside the stand, and nothing was saved: the room has not
   * answered yet.
   *
   * This is not the empty case and must never be said as one. A room that has answered has sent
   * *something* for the path — a document whose text is empty, which the page can read — where
   * silence has sent nothing, and the text the fetch waits for may still be on its way. An empty
   * file offered out of silence is the same defect as saving one: the page states a fact it
   * cannot know.
   */
  | { kind: 'pending' }
  /** Asking the room failed. Nothing was saved. */
  | { kind: 'failed'; sentence: string };

/**
 * What the page adds to one renewal window for the answer to come back: the host's read of its
 * own working copy, the content frame, and its application here.
 */
export const FETCH_SETTLE_MS = 5_000;

/** What a fetch stands for when there is no session to read the server's own number from. */
export const FETCH_STAND_MS = 10_000;

/**
 * How long a fetch waits for the room's text, from the window the server advertises.
 *
 * `§7.1` folds an announcement accepted inside a window a state already went out for, and answers
 * it at that window's end. A guest whose key no state commits yet cannot publish at all until
 * then — its holds included, and the hold is what this fetch is — so an ask can wait a whole
 * `awareness_renew_ms` before the host even hears it. The stand is that window and a settlement
 * for the answer to travel, and it is read from the session rather than assumed here: a server
 * that advertises another window gets, and needs, another stand.
 */
export function fetchStandMs(awarenessRenewMs: number | undefined): number {
  return awarenessRenewMs === undefined ? FETCH_STAND_MS : awarenessRenewMs + FETCH_SETTLE_MS;
}

/** How often the wait re-asks whether the text has arrived. */
const POLL_MS = 100;

export interface FetchSaveOptions {
  standMs?: number;
  /** The wait, injected so the suite needs no timers. */
  wait?: (ms: number) => Promise<void>;
  /** How many polls the stand lasts. */
  polls?: number;
}

/** What the row says while it waits: the wait itself, and never a verdict on the text. */
export function fetchingSentence(path: string): string {
  return `Asking the host for ${path}…`;
}

/** What opening a file costs the room, said once in a session, before the first fetch. */
export function fetchCostsSentence(path: string): string {
  return `Fetching opens ${path} in the room, so every peer receives it.`;
}

/** What a fetch the room has not answered says: a wait, and not an emptiness it cannot know. */
export function stillAskingSentence(path: string): string {
  return `Still asking the host for ${path}. No answer yet.`;
}

/** What a fetch the room answered with an empty document says, in the desktop clients' own words. */
export function stillEmptySentence(path: string): string {
  return `${path} is still empty. The host sent no text for it.`;
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
 * A window that holds the room's answer for the path saves it at once: that copy is the person's
 * own as it stands, the buffer they emptied included, and the browser's own download UI is the
 * confirmation. A message about a file that was already here would be noise.
 */
export async function fetchAndSave(
  path: string,
  ports: FetchSavePorts,
  options: FetchSaveOptions = {},
): Promise<FetchSaveOutcome> {
  if (ports.has(path)) {
    return saveNow(path, ports.text(path), ports);
  }
  try {
    await ports.open(path);
  } catch (error: unknown) {
    return { kind: 'failed', sentence: fetchFailedSentence(path, reason(error)) };
  }
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  // The wait is for the *answer*, and the answer is the document: a document carrying text is the
  // text, and a document holding none is the room saying the file it read is empty. Both are
  // answers, so the loop stops at `has` — reading on for text is reading on for a second thing that
  // this protocol never sends, and it cost the whole stand: measured against a real `selvaged`, a
  // room answered in 101 ms and the fetch reported it 3 007 ms later.
  const polls = options.polls ?? Math.max(1, Math.ceil((options.standMs ?? FETCH_STAND_MS) / POLL_MS));
  for (let poll = 0; poll < polls && !ports.has(path); poll += 1) {
    await wait(POLL_MS);
  }
  // Nothing arrived for the path at all: the room has not answered, and emptiness is a fact this
  // page does not have. The text may still be coming, so the fetch reports the wait.
  if (!ports.has(path)) {
    return { kind: 'pending' };
  }
  const arrived = ports.text(path);
  // An answer that arrives *inside* the fetch with no text in it is the room saying the file is
  // empty — news the person did not have when they asked, and not their own buffer: it is offered
  // rather than assumed, and nothing is written for it without being asked for.
  if (arrived === '') {
    return { kind: 'empty', text: arrived };
  }
  return saveNow(path, arrived, ports);
}

/** Writes the copy this window holds, and reports a save the browser would not take. */
function saveNow(path: string, text: string, ports: FetchSavePorts): FetchSaveOutcome {
  try {
    ports.save(path, text);
  } catch (error: unknown) {
    return { kind: 'failed', sentence: fetchFailedSentence(path, reason(error)) };
  }
  return { kind: 'saved', text };
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
