/**
 * The end of a session: the words for it, and the teardown.
 *
 * The page does not stand on a dead session. When the room is gone it leaves —
 * the socket closed, the binding and the editor dropped, the chrome gone — and
 * says why on the card, the way both desktop clients dispose of a room that
 * ended. So the copy here is the desktop clients' own sentence plus the one
 * next step, and `dropSession` is the order the page leaves in.
 */

/** The room is gone, in the desktop clients' words, naming the cause. */
export function roomGoneMessage(reason: string): string {
  const why = reason.trim() === '' ? 'no reason given' : reason.trim();
  return `The room is gone (${why}).`;
}

/**
 * A terminal disconnect that carried no room-gone reason (reconnection gave
 * up) ends the session just the same, and the way back is the same fresh link.
 */
export const SESSION_ENDED_MESSAGE = 'The session ended.';

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
