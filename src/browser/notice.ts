/**
 * The two message homes the page keeps now that the status line is gone.
 *
 * Neither is a ticker. The failure alert is an error surface: it appears only
 * when an action a guest took refused, stands a few seconds, and leaves on its
 * own — progress, success and connection chatter never reach it. The session
 * note is the chrome's own lifecycle line: the host-leave warning while the
 * grace runs, and the end of the room, each staying for as long as it is true.
 */

export interface NoticeOptions {
  /** How long a failure stands before it leaves on its own. */
  standMs?: number;
  schedule?: (run: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

export interface FailureAlert {
  /** Shows one failure; a later failure replaces it and restarts the clock. */
  show(text: string): void;
  /** Takes the failure down now. */
  dismiss(): void;
}

/**
 * Wires the alert region. The element stays in the DOM — an empty live region
 * announces reliably, and its empty state is what hides it, so a failure
 * paints in one frame with no unhide flicker.
 */
export function wireFailureAlert(element: HTMLElement, options: NoticeOptions = {}): FailureAlert {
  const standMs = options.standMs ?? 7000;
  const schedule = options.schedule ?? ((run, ms) => setTimeout(run, ms));
  const cancel =
    options.cancel ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let pending: unknown;

  const dismiss = (): void => {
    if (pending !== undefined) {
      cancel(pending);
      pending = undefined;
    }
    element.textContent = '';
  };

  return {
    show(text: string): void {
      if (pending !== undefined) {
        cancel(pending);
      }
      element.textContent = text;
      pending = schedule(dismiss, standMs);
    },
    dismiss,
  };
}

/** The two lifecycle states the chrome names for itself. */
export type SessionNoteKind = 'warning' | 'ended';

/** What one transient binding sentence means for the session note. */
export type SessionNoteSignal = 'grace' | 'back';

/**
 * The host's socket detaching — the sentence that opens the grace window — and
 * the host coming back inside it. The binding has no notice kind for either,
 * so both arrive as transient text; every other transient sentence (a drop, a
 * reconnect, a follow landing) is chatter and maps to nothing.
 */
export function sessionNoteSignal(text: string): SessionNoteSignal | undefined {
  if (text.startsWith(HOST_LEFT)) {
    return 'grace';
  }
  if (HOST_BACK.test(text)) {
    return 'back';
  }
  return undefined;
}

/**
 * The binding's own opening words, kept as the contract the routing reads:
 * `test/join-chrome.test.ts` drives the binding that emits them, so a reworded
 * sentence cannot drop the warning (or leave it standing) silently.
 */
const HOST_LEFT = 'host left';
const HOST_BACK = /^host .+ is back$/;

export interface SessionNote {
  /** Shows the line, replacing whatever stood before. */
  show(text: string, kind: SessionNoteKind): void;
  hide(): void;
}

/**
 * Wires the chrome's lifecycle line the same way as the alert: it stays in the
 * DOM as an empty live region (so the sentence is announced when it lands) and
 * its empty state is what hides it, so the strip takes no room while the room
 * is healthy.
 */
export function wireSessionNote(element: HTMLElement): SessionNote {
  return {
    show(text: string, kind: SessionNoteKind): void {
      element.textContent = text;
      element.dataset.kind = kind;
    },
    hide(): void {
      element.textContent = '';
      delete element.dataset.kind;
    },
  };
}
