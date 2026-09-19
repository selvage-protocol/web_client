/**
 * The two message homes the page keeps now that the status line is gone.
 *
 * Neither is a ticker. The failure alert is an error surface: it appears only
 * when an action a guest took refused, stands a few seconds, and leaves on its
 * own — progress, success and connection chatter never reach it. The session
 * note is the one warning about the room itself: the host's socket detached
 * and the grace window is running, so it stays for as long as that is true.
 * When the room actually ends the page leaves and says so on the card.
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
 * The tap-revealed line: one sentence about what the guest just touched.
 *
 * A pointer device reads that sentence from a `title` the moment it hovers; a
 * finger has no hover, and a native tooltip never paints on touch, so the same
 * words have to arrive some other way — a tap, and a line that stands a few
 * seconds the way a failure does.
 */
export type TapPeek = FailureAlert;

/**
 * Wires a line that appears, stands a while, and leaves on its own. The failure
 * alert and the tap-revealed peek are the same mechanism with different copy
 * and different homes, so they are one implementation with two names.
 */
function wireTransientLine(element: HTMLElement, options: NoticeOptions): FailureAlert {
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

/**
 * Wires the alert region. The element stays in the DOM — an empty live region
 * announces reliably, and its empty state is what hides it, so a failure
 * paints in one frame with no unhide flicker.
 */
export function wireFailureAlert(element: HTMLElement, options: NoticeOptions = {}): FailureAlert {
  return wireTransientLine(element, options);
}

/** Wires the tap-revealed line, with the same empty-is-hidden rule as the alert. */
export function wireTapPeek(element: HTMLElement, options: NoticeOptions = {}): TapPeek {
  return wireTransientLine(element, options);
}

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
 * Whether a membership report — a `roster` or a `peers` notice — names the host
 * as present. Either one is the all-clear the warning needs: the `host <name>
 * is back` sentence only rides the attach frame, so a guest whose socket was
 * down at that instant would otherwise read "the room closes in 30s unless the
 * host returns" for the rest of the session (S1, 2026-09-18). The room's own
 * word on who is here carries the same news on every membership frame.
 */
export function hostPresent(members: readonly { role: string }[]): boolean {
  return members.some((member) => member.role === HOST_ROLE);
}

/**
 * The binding's own opening words, kept as the contract the routing reads:
 * `test/join-chrome.test.ts` drives the binding that emits them, so a reworded
 * sentence cannot drop the warning (or leave it standing) silently. The name
 * between the two words may be empty: the engine's own validation accepts an
 * empty `display_name`, and the binding prints whatever the peer carries.
 */
const HOST_LEFT = 'host left';
const HOST_BACK = /^host (.*) is back$/;
/** The one role that means the host. */
const HOST_ROLE = 'host';

export interface SessionNote {
  /** Shows the line, replacing whatever stood before. */
  show(text: string): void;
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
    show(text: string): void {
      element.textContent = text;
    },
    hide(): void {
      element.textContent = '';
    },
  };
}
