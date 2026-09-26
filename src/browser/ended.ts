/**
 * The end of a session: the words for it, and the teardown.
 *
 * The page does not stand on a dead session. When the room is gone it leaves,
 * with the socket closed, the binding and the editor dropped and the chrome gone,
 * and the start card says why in one short sentence. `dropSession` is the order
 * the page leaves in.
 */

import { endingReason } from '../engine/index.ts';

/** The room is gone, in the desktop clients' words, naming the cause. */
export function roomGoneMessage(reason: string): string {
  const why = reason.trim() === '' ? 'no reason given' : reason.trim();
  return `The room is gone (${why}).`;
}

/** The room-gone card's sentence: short, and in the person's words rather than the protocol's. */
export function roomGoneSentence(reason: string): string {
  const why = reason.trim();
  if (why === endingReason('closing')) {
    return 'The host ended the session.';
  }
  if (why === endingReason('host-away')) {
    return 'The host was away too long, so the session ended.';
  }
  return why === '' ? SESSION_ENDED_MESSAGE : `The session ended (${why}).`;
}

/** A terminal disconnect that carried no room-gone reason: reconnection gave up. */
export const SESSION_ENDED_MESSAGE = 'The session ended.';

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
