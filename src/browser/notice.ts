/**
 * The two message homes the page keeps: a failure alert and a session note.
 *
 * The failure alert is an error surface: it appears only when an action a guest
 * took refused, stands a few seconds, and leaves on its own. Progress, success
 * and connection chatter never reach it. The session note is the one line about
 * the room itself: the host's socket detached and the grace window is running,
 * so it stays for as long as that is true, counting the window down. When the
 * room actually ends the page leaves and says so on the card.
 */

export interface NoticeOptions {
  /** How long a failure stands before it leaves on its own. */
  standMs?: number;
  schedule?: (run: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
  /** The clock the countdown reads; `Date.now` unless a test injects one. */
  now?: () => number;
  /**
   * Builds the note's three runs — the sentence's lead, the element the number counts in —
   * with the number in an element of its own (see `CountParts`). Injected so the suite needs
   * no DOM.
   */
  countParts?: (lead: string, tail: string) => CountParts;
}

/** The three runs of the countdown's sentence, and the way its number is written. */
export interface CountParts {
  /**
   * What `replaceChildren` is given. The countdown's default is one element holding the whole
   * sentence — the strip is a flex row, so a run left as its own child would wear the row's gap
   * (see `defaultCountParts`).
   */
  parts: (Node | string)[];
  /** Writes one reading of the number. */
  number: (text: string) => void;
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

/**
 * Whether a membership report — a `roster` or a `peers` notice — names the host
 * as present. Either one is the all-clear the warning needs: the attach frame is
 * the only thing that says the host is back, so a guest whose socket was down at
 * that instant would otherwise read the countdown — and then a deadline that had
 * already passed — for the rest of the session (S1, 2026-09-18). The room's own
 * word on who is here carries the same news on every membership frame.
 */
export function hostPresent(members: readonly { role: string }[]): boolean {
  return members.some((member) => member.role === HOST_ROLE);
}

/** The one role that means the host. */
const HOST_ROLE = 'host';

/**
 * The host's absence in the page's own words, around the number that counts down in it: the
 * number is the strip's own reading of the deadline, so the sentence around it never changes
 * and the live region only ever announces that the host left.
 */
const HOST_LEFT_LEAD = 'The host left. The room closes in ';
const HOST_LEFT_TAIL = ' unless the host returns.';

/**
 * A dropped socket, in the words the desktop clients' own status lines carry: the room is out of
 * reach and the engine's bounded retry is re-dialling it (`§9.1`). A page that said nothing would
 * look healthy for the whole retry — the editor keeps working locally and nothing typed reaches
 * the room.
 */
export const RECONNECTING_NOTE = 'Connection dropped. Reconnecting…';

/** How long the host's return stands in the strip before it takes itself down. */
export const HOST_BACK_STAND_MS = 5000;

/**
 * The host coming back inside the grace, in the words both desktop clients use. The name is
 * the room's to leave blank — the engine's own validation accepts an empty display name — and
 * the sentence falls back to the role rather than to a gap.
 */
export function hostBackSentence(name: string): string {
  const who = name.trim() === '' ? 'the host' : name.trim();
  return `${who} is back — the session continues.`;
}

/**
 * How long the grace window reads to a guest: the largest whole unit the window
 * still has one of, rounded down, so the countdown never gives the guest more
 * time than the room has. The window is the server's own number (`room_grace_ms`,
 * echoed on the detach frame), so it can be anything up to an hour, and a raw
 * second count makes the reader divide it.
 */
export function graceWording(graceMs: number): string {
  const ms = Math.max(0, graceMs);
  const seconds = Math.floor(ms / 1000);
  if (seconds === 0) {
    return 'a moment';
  }
  if (seconds < 60) {
    return `${seconds} second${seconds === 1 ? '' : 's'}`;
  }
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  const hours = Math.floor(ms / 3_600_000);
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}

/**
 * The number's own element, `role="timer"` and silent: the count is not read out.
 *
 * The three runs go inside one wrapper element, and that is not decoration. The strip that shows
 * them is a flex row (for the dot beside the sentence), and every child of a flex container is a
 * flex item with the container's `gap` on each side of it — so three runs directly under it put
 * `gap`-width spaces around the substituted number, which is neither the width of a space nor the
 * same for `30 seconds` as for `a moment`. One wrapper keeps the sentence one flow: the spaces in it
 * are the words' own, and the gap stays where it was written, between the dot and the sentence.
 */
function defaultCountParts(lead: string, tail: string): CountParts {
  const sentence = document.createElement('span');
  const number = document.createElement('span');
  // `role="timer"` carries `aria-live: off`, and the explicit pair keeps that true whatever a
  // browser's default is: the sentence is announced once, the count is not announced at all.
  number.setAttribute('role', 'timer');
  number.setAttribute('aria-live', 'off');
  sentence.append(document.createTextNode(lead), number, document.createTextNode(tail));
  return {
    parts: [sentence],
    number: (text: string): void => {
      number.textContent = text;
    },
  };
}

export interface SessionNote {
  /** Shows the grace window, counting the number in its sentence down to the deadline. */
  countdown(graceMs: number): void;
  /** Shows one sentence that stands `standMs` and then takes itself down. */
  say(text: string, standMs: number): void;
  /**
   * Shows the line a dropped socket wears while the engine re-dials it (`§9.1`). It stands until
   * `endDropped` takes it down, because the retry has no length to stand for: a bounded backoff
   * can run for the room's whole advertised grace, and a line on its own timer would either lie
   * about the wait or leave while the room is still out of reach.
   */
  dropped(text: string): void;
  /**
   * Takes the dropped line down once the room has answered again, and leaves any other sentence
   * standing: the host's return is said into this same strip and outlives the all-clear.
   */
  endDropped(): void;
  /**
   * Takes the countdown down when the countdown is what the line is showing, and leaves a
   * sentence standing in its place alone: the host's return outlives the all-clear.
   */
  endCountdown(): void;
  /** Takes the line down, whatever it was showing. */
  hide(): void;
}

/**
 * Wires the chrome's lifecycle line. It stays in the DOM as an empty live region (so the
 * sentence is announced when it lands) and its empty state is what hides it, so the strip
 * takes no room while the room is healthy.
 *
 * The countdown is a deadline rather than a value the strip lowers itself: every tick reads
 * the clock again, so a backgrounded tab that missed a dozen ticks shows the room's own
 * remaining time the moment it paints again.
 */
export function wireSessionNote(element: HTMLElement, options: NoticeOptions = {}): SessionNote {
  const now = options.now ?? ((): number => Date.now());
  const schedule = options.schedule ?? ((run, ms) => setInterval(run, ms));
  const cancel =
    options.cancel ?? ((handle) => clearInterval(handle as ReturnType<typeof setInterval>));
  const countParts = options.countParts ?? defaultCountParts;
  let pending: unknown;
  let deadline: number | undefined;

  const stop = (): void => {
    if (pending !== undefined) {
      cancel(pending);
      pending = undefined;
    }
    deadline = undefined;
  };

  const clear = (): void => {
    element.dataset.tone = '';
    element.textContent = '';
  };

  return {
    endCountdown(): void {
      if (element.dataset.tone !== 'grace') {
        return;
      }
      stop();
      clear();
    },

    dropped(text: string): void {
      stop();
      element.textContent = text;
      element.dataset.tone = 'dropped';
    },

    endDropped(): void {
      if (element.dataset.tone !== 'dropped') {
        return;
      }
      stop();
      clear();
    },

    countdown(graceMs: number): void {
      stop();
      const count = countParts(HOST_LEFT_LEAD, HOST_LEFT_TAIL);
      element.replaceChildren(...count.parts);
      element.dataset.tone = 'grace';
      deadline = now() + Math.max(0, graceMs);
      let shown = '';
      const draw = (): void => {
        const reading = graceWording(Math.max(0, (deadline ?? 0) - now()));
        if (reading !== shown) {
          shown = reading;
          count.number(reading);
        }
      };
      draw();
      pending = schedule(() => {
        draw();
        if ((deadline ?? 0) - now() <= 0) {
          stop();
        }
      }, 1000);
    },

    say(text: string, standMs: number): void {
      stop();
      element.textContent = text;
      element.dataset.tone = 'plain';
      pending = schedule(clear, standMs);
    },

    hide(): void {
      stop();
      clear();
    },
  };
}
