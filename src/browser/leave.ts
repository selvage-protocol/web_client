/**
 * Leaving a session, and what leaving costs a host.
 *
 * A guest can simply go: it holds the room's key through the link it joined by,
 * and the room goes on without it (`PROTOCOL.md` §9, `peer.left`). A host cannot:
 * the room's host key is the only one that signs its state, and the room is
 * destroyed `room_grace_ms` after its **last** connection ends (§9). So a host's
 * connection ending is the end of the room — exactly what closing the tab does —
 * with everyone still in it editing until their own host-away clock passes
 * `awareness_expire_ms` and their sessions end (§13.8), and nothing written
 * anywhere the room did not already hold.
 *
 * That is a real consequence for other people, and it is one click away from the
 * share bar, so a host's Leave asks before it acts: the first press raises the
 * question and the control becomes the words that answer it, and the second press
 * within the ask leaves. A guest's press leaves at once — nobody else pays for it.
 *
 * The control is separated from the page so the suite drives the two-step without
 * a browser: the page's entry module runs on import and cannot be one. The control's
 * own name — the desktop clients' `Leave the session` — is the shell's, beside the
 * button in `public/index.html`, because it is the same at every moment.
 */

/** What the control asks of the page it sits on. */
export interface LeaveOptions {
  /**
   * Whether this window is the room's host — the one leaving whose connection ends the room.
   * The page reads it from the folder it holds rather than from the room's role: the role is the
   * applied state's word and arrives a moment after the seat, and a confirmation that could fail
   * to be asked is worse than one asked for a guest.
   */
  hosting(): boolean;
  /** The control itself, so the asking state can be its own words. */
  button: { textContent: string };
  /** Raises the question, where the page keeps its one line about the room. */
  ask(): void;
  /** Leaves the session. */
  leave(): void;
  /** How long the ask stands before the control returns to rest. */
  askMs?: number;
  schedule?: (run: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

export interface LeaveControl {
  /** One press of the control: leaves, or turns a host's press into the question. */
  press(): void;
  /** Takes the ask back down and returns the control to rest. */
  reset(): void;
  dispose(): void;
}

/** The verb at rest. */
export const LEAVE_LABEL = 'Leave';

/** The same verb once the question is standing: the words that answer it. */
export const LEAVE_ASKING_LABEL = 'Leave anyway';

/** How long a host's ask stands before it takes itself back. Also the strip's own stand for it. */
export const LEAVE_ASK_MS = 6000;

/**
 * The question a host's first press asks, in the room's own line. It names the
 * consequence rather than the countdown that follows it: the host reads the same
 * sentence on the card before it ever starts a room (`HOST_TAB_WARNING`), and the
 * grace is the room's number, not this strip's.
 */
export const HOST_LEAVE_QUESTION =
  'Leaving ends the room for everyone in it, and nothing in it is saved.';

export function wireLeave(options: LeaveOptions): LeaveControl {
  const askMs = options.askMs ?? LEAVE_ASK_MS;
  const schedule = options.schedule ?? ((run, ms) => setTimeout(run, ms));
  const cancel =
    options.cancel ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let asking = false;
  let pending: unknown;

  const reset = (): void => {
    if (pending !== undefined) {
      cancel(pending);
      pending = undefined;
    }
    asking = false;
    options.button.textContent = LEAVE_LABEL;
  };

  return {
    press(): void {
      if (asking) {
        // The answer to the question this control just asked: the ask has been read, so the
        // consequence has been read.
        reset();
        options.leave();
        return;
      }
      if (!options.hosting()) {
        options.leave();
        return;
      }
      asking = true;
      options.button.textContent = LEAVE_ASKING_LABEL;
      options.ask();
      pending = schedule(reset, askMs);
    },
    reset,
    dispose(): void {
      if (pending !== undefined) {
        cancel(pending);
        pending = undefined;
      }
    },
  };
}
