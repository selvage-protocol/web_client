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
 * save happens only once text has arrived here (`has`), and it is read from the document that
 * arrived. A fetch that nothing arrives for saves nothing and says the wait is still running.
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
   * Nothing was saved and the room has answered with an empty document for the path: `has` is
   * true and its text is empty.
   *
   * Empty is not a failure — an empty file is a state a person may want — but it is not the file
   * they asked for either, so it is offered rather than assumed.
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
  return `Still asking the host for ${path} — no answer yet.`;
}

/** What a fetch the room answered with an empty document says, in the desktop clients' own words. */
export function stillEmptySentence(path: string): string {
  return `${path} is still empty — the host sent no text for it.`;
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
    // Even a path this window already holds is not saved while what it holds is nothing: a
    // document with no text in it may be an empty file the room keeps, and the person is offered
    // the choice rather than handed a file that may be a lie (`canSaveAtOnce`).
    if (text === '') {
      return { kind: 'empty', text };
    }
    ports.save(path, text);
    return { kind: 'saved', text };
  }
  try {
    await ports.open(path);
  } catch (error: unknown) {
    return { kind: 'failed', sentence: fetchFailedSentence(path, reason(error)) };
  }
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  // The wait is for the *text*, not for the receipt, and the two are not the same moment: a room
  // answers an open by holding an empty document for the path, and the host's copy lands in it a
  // frame or a second later (the in-room driver measured exactly that). A loop that stopped at the
  // receipt would call the fetch empty while the text was still on its way.
  const polls = options.polls ?? Math.max(1, Math.ceil((options.standMs ?? FETCH_STAND_MS) / POLL_MS));
  const here = (): boolean => ports.has(path) && ports.text(path) !== '';
  for (let poll = 0; poll < polls && !here(); poll += 1) {
    await wait(POLL_MS);
  }
  if (here()) {
    const text = ports.text(path);
    ports.save(path, text);
    return { kind: 'saved', text };
  }
  // Nothing arrived for the path at all: the room has not answered, and emptiness is a fact this
  // page does not have. The text may still be coming, so the fetch reports the wait.
  if (!ports.has(path)) {
    return { kind: 'pending' };
  }
  // A document for the path is here and its text is empty: that is the room's own answer, and it
  // is offered rather than assumed — nothing is saved without being asked for (`canSaveAtOnce`).
  return { kind: 'empty', text: ports.text(path) };
}

/**
 * Whether a download can go straight to the browser's own save, with no fetch behind it.
 *
 * The test is the *text*, and not the room's receipt of the path. `has(path)` is true once a
 * document for the path is here, and a document with no text in it is exactly what a room holds
 * for a file that is genuinely empty: only the text can be saved without lying. Saving on the
 * receipt is how a guest ends up with an empty file named `src/main.ts` on its disk and nothing to
 * say the real contents were still coming — the defect this module exists to prevent, and the one
 * the in-room driver caught: the fetch that had timed out left the room holding an empty document,
 * the next press of the row's action took this path, and an empty file was saved without a word.
 *
 * So an empty answer is never saved without being asked for: it goes through `fetchAndSave`, which
 * waits while the text may still arrive and offers `Save empty file` only for a document the room
 * has actually sent (`FetchSaveOutcome`).
 */
export function canSaveAtOnce(text: string): boolean {
  return text !== '';
}

/**
 * Which document, if any, the page should put in front of the editor after the room's set moved.
 *
 * The rule that gives a phone a file to look at — nothing is open here, so open the first document
 * the room names — has to leave out the documents this window fetched only to save them. A fetch is
 * a background act by design ("without changing what the editor shows"), and it *is* what puts a path
 * in the room's set: a guest who downloads a row it has never opened would otherwise watch the
 * editor switch to the file it just asked to save, which is the opposite of what was asked for. The
 * first bug the in-room driver caught after the strip landed was exactly this.
 */
export function documentToAutoOpen(
  documents: readonly string[],
  open: string | undefined,
  background: ReadonlySet<string>,
): string | undefined {
  if (open !== undefined) {
    return undefined;
  }
  return documents
    .slice()
    .sort()
    .find((path) => !background.has(path));
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
