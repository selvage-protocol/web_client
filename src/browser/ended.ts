/**
 * The end of a session: the words for it, and the teardown.
 *
 * The page does not stand on a dead session. When the room is gone it leaves —
 * the socket closed, the binding and the editor dropped, the chrome gone — and
 * says why on the card. So the copy here is the desktop clients' own sentence,
 * the one thing this client has to say which they do not, and the one next step;
 * `dropSession` is the order the page leaves in.
 */

/** The room is gone, in the desktop clients' words, naming the cause. */
export function roomGoneMessage(reason: string): string {
  const why = reason.trim() === '' ? 'no reason given' : reason.trim();
  return `The room is gone (${why}).`;
}

/**
 * What became of the room's content when it closed. The desktop clients keep the guest's copy and
 * say where it is; a page has no disk to leave a mirror on, so nothing of the room stays here. What
 * is *not* true is that nothing was saved: every settled edit was written into the folder the room
 * was hosted from, within the settle, and a host reading the old sentence was told the opposite of
 * what the page had just done. The one thing that can still be missing is a keystroke inside the
 * settle, which the sentence's "had settled" allows for.
 */
export const NOTHING_KEPT =
  'Nothing is kept on this page; the folder the room was hosted from has the text it had settled on.';

/** The room-gone card's sentence: what happened, and what became of everything in it. */
export function roomGoneSentence(reason: string): string {
  return `${roomGoneMessage(reason)} ${NOTHING_KEPT}`;
}

/**
 * A terminal disconnect that carried no room-gone reason (reconnection gave
 * up) ends the session just the same, and the way back is the same fresh link.
 */
export const SESSION_ENDED_MESSAGE = 'The session ended.';

/**
 * Someone left on purpose, in the desktop clients' words (`docs/studies/client-command-parity.md`
 * §5 says `left the session`, which their wrappers carry in lower case). The card's sentences open
 * with a capital, as `The room is gone (…)` does for the desktop clients' own `the room is gone`.
 */
export const LEFT_SESSION_SENTENCE = 'Left the session.';

/** What the guest does next, on the card that comes back. */
export const REJOIN_PROMPT = 'Paste a fresh invite link to join another session.';

/** The one line the card carries when a session is over: what, then what now. */
export function sessionOverMessage(sentence: string): string {
  return `${sentence} ${REJOIN_PROMPT}`;
}

/** The handles a live session holds, as the teardown sees them. */
export interface LiveSession {
  /** The editor's opener guard: one registration per join, dropped with the session. */
  linkGuard?: { dispose(): void };
  /** The binding next: a disposed binding never reports anything else. */
  binding?: { dispose(): void };
  /** The editor widget the binding drew into. */
  editor?: { dispose(): void };
  /** The engine's socket. */
  engine?: { disconnect(): unknown };
}

/**
 * Drops a live session in the order that keeps it quiet: the opener guard, the
 * binding, the editor it drew into, then the socket. A step that throws never
 * strands the others — a page that cannot finish leaving a dead room is worse
 * than a logged error, and the log is the only place that failure may sit.
 */
export function dropSession(session: LiveSession): void {
  quiet(() => session.linkGuard?.dispose());
  quiet(() => session.binding?.dispose());
  quiet(() => session.editor?.dispose());
  quiet(() => void session.engine?.disconnect());
}

function quiet(step: () => void): void {
  try {
    step();
  } catch (error) {
    console.error('[selvage] dropping the session failed', error);
  }
}
