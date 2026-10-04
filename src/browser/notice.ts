/**
 * The notices column: one home for everything the page has to say over the workspace.
 *
 * The column floats in the top-right corner, takes no pointer (`pointer-events: none`) and is out of
 * the flow, so a sentence arriving never moves the editor under it. Inside it, one card per kind of
 * news:
 *
 * - **the session card** is the room's own lifecycle: the host's socket detached and the grace
 *   window is running, so it stands in the warning colour with the host's name, the time left and a
 *   2 px bar draining over that time; when the window runs out it turns red and says the session
 *   ended. A transient sentence — the host's return, a dropped socket the engine is re-dialling —
 *   stands in the same card in the plain colour. The ticking line is hidden from assistive tech and
 *   the card carries a separate sentence that changes once, so a screen reader hears the news once
 *   rather than once a second.
 * - **the download toasts** are files this window saved: `Downloaded <leaf>`, two at a time, the rest
 *   counted by a `+N more` pill.
 * - **the failure alert** and **the tap-revealed line** are the same mechanism with different copy:
 *   one sentence about a thing that just happened, standing a few seconds and leaving on its own.
 *   The host's own listing cut is said on the alert: it is a fact about the folder this window
 *   shares, and the guest is told nothing, because a short listing is a listing like any other.
 */
import { disconnectingReading, hostAwaySentence, hostLeftSentence } from '../bridge/index.ts';
import { listingCutSentence } from './folder.ts';
import type { FolderCut } from './folder.ts';
import { iconSpan } from './icons.ts';

export interface NoticeOptions {
  /** How long a failure stands before it leaves on its own. */
  standMs?: number;
  schedule?: (run: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
  /** The clock the countdown reads; `Date.now` unless a test injects one. */
  now?: () => number;
}

export interface FailureAlert {
  /**
   * Shows one failure; a later failure replaces it and restarts the clock.
   *
   * `standMs` is for a sentence with a stand of its own — a follow that ended stands four seconds
   * where a failure stands seven — and is the page's, not the alert's: one line has one lifetime.
   */
  show(text: string, standMs?: number): void;
  /** Takes the failure down now. */
  dismiss(): void;
}

/**
 * How long a line about something that has just happened stands before it takes itself down: the
 * failure alert, the tap-revealed line, and the session card's own transient sentences. One number,
 * because it is one idea — a sentence nobody has to act on, read once — and several surfaces that
 * would otherwise each carry their own guess.
 */
export const TRANSIENT_STAND_MS = 7000;

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
    show(text: string, standMs?: number): void {
      if (pending !== undefined) {
        cancel(pending);
      }
      element.textContent = text;
      pending = schedule(dismiss, standMs ?? options.standMs ?? TRANSIENT_STAND_MS);
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

/** What the host's own cut is said through: one line, and one saying per cut, per session. */
export interface ListingCutNotice {
  /**
   * Reads the bound one session's walk stopped at, or `undefined`, and says it if it is news to
   * that session. `session` is what the cut belongs to: the folder this window serves. Two sessions
   * are news separately, because a page can end a room and host again, so a second folder that
   * stops at the first one's bound is a cut its host has not been told.
   */
  say(session: object, cut: FolderCut | undefined): void;
}

/**
 * The host's own news that its walk stopped short of the folder, said once per cut and per session.
 *
 * A cut is a fact about the folder and not about one walk, and every act that changes the folder is
 * followed by a walk of its own: a sentence that simply followed every walk would be said again for
 * a removal that left the folder exactly as far past the bound as it was. So it is said when it
 * appears and when the bound changes, and not again while it stands — while it is the same
 * session's, because the memory is the session's and not the page's. The session key is held
 * weakly, so a room that has ended does not pin the folder it served. A folder trimmed until it
 * fits says nothing, and one that grows past a bound again is said again.
 */
export function wireListingCutNotice(alert: FailureAlert): ListingCutNotice {
  const said = new WeakMap<object, FolderCut | undefined>();
  return {
    say(session: object, cut: FolderCut | undefined): void {
      if (said.has(session) && said.get(session) === cut) {
        return;
      }
      said.set(session, cut);
      if (cut !== undefined) {
        alert.show(listingCutSentence(cut));
      }
    },
  };
}

/**
 * Whether a membership report — a `roster` or a `peers` notice — names the host
 * as present. Either one is the all-clear the warning needs: the attach frame is
 * the only thing that says the host is back, so a guest whose socket was down at
 * that instant would otherwise read the countdown — and then a deadline that had
 * already passed — for the rest of the session. The room's own word on who is
 * here carries the same news on every membership frame.
 */
export function hostPresent(members: readonly { role: string }[]): boolean {
  return members.some((member) => member.role === HOST_ROLE);
}

/** The one role that means the host. */
const HOST_ROLE = 'host';

/** How long the host's return stands in the card before it takes itself down. */
export const HOST_BACK_STAND_MS = 5000;

/** What the card shows when the window has run out and the room has not come back. */
const SESSION_ENDED_SENTENCE = 'The session ended';
const HOST_DISCONNECTED_SENTENCE = 'Host disconnected';

export interface SessionCard {
  /** The host's socket detached: the warning, the name, the window counting down to its deadline. */
  away(name: string, graceMs: number): void;
  /** One sentence that stands `standMs` and then takes itself down. */
  say(text: string, standMs: number): void;
  /**
   * The line a dropped socket wears while the engine re-dials it (`§9.1`). It stands until
   * `endDropped` takes it down, because the retry has no length to stand for: a bounded backoff
   * can run for the room's whole advertised grace, and a line on its own timer would either lie
   * about the wait or leave while the room is still out of reach.
   */
  dropped(text: string): void;
  /**
   * Takes the dropped line down once the room has answered again, and leaves any other sentence
   * standing: the host's return is said into this same card and outlives the all-clear.
   */
  endDropped(): void;
  /**
   * Takes the countdown down when the countdown is what the card is showing, and leaves a
   * sentence standing in its place alone: the host's return outlives the all-clear.
   */
  endAway(): void;
  /** Takes the card down, whatever it was showing. */
  hide(): void;
}

/** What the card is showing, which is what decides who may take it down. */
type CardMode = 'away' | 'ended' | 'return' | 'dropped';

/**
 * Wires the session card. It stays in the DOM and its `hidden` is what takes it off screen, so the
 * element the clock is writing into is not the one a redraw replaces.
 *
 * The countdown is a deadline rather than a value the card lowers itself: every tick reads the clock
 * again, so a backgrounded tab that missed a dozen ticks shows the room's own remaining time the
 * moment it paints again — and the bar is drawn from that same reading, so the two cannot disagree.
 */
export function wireSessionCard(element: HTMLElement, options: NoticeOptions = {}): SessionCard {
  const now = options.now ?? ((): number => Date.now());
  const schedule = options.schedule ?? ((run, ms) => setInterval(run, ms));
  const cancel =
    options.cancel ?? ((handle) => clearInterval(handle as ReturnType<typeof setInterval>));
  const message = element.querySelector<HTMLElement>('.msg');
  const when = element.querySelector<HTMLElement>('.when');
  const bar = element.querySelector<HTMLElement>('.bar');
  const spoken = element.querySelector<HTMLElement>('.sr');
  if (message === null || when === null || bar === null || spoken === null) {
    throw new Error('the session card is missing one of its own parts');
  }
  let pending: unknown;
  let deadline: number | undefined;
  let grace = 0;
  let mode: CardMode | undefined;

  const stop = (): void => {
    if (pending !== undefined) {
      cancel(pending);
      pending = undefined;
    }
    deadline = undefined;
  };

  /** The one sentence a screen reader hears, written only when it changes. */
  const announce = (sentence: string): void => {
    if (spoken.textContent !== sentence) {
      spoken.textContent = sentence;
    }
  };

  /** Puts the card in the shape one mode has, so the three cannot half-overwrite each other. */
  const paint = (next: CardMode): void => {
    mode = next;
    element.hidden = false;
    element.dataset.tone = next === 'away' ? 'grace' : next === 'ended' ? 'over' : 'plain';
    // Only the countdown carries these two; every other sentence is one line.
    when.hidden = next !== 'away' && next !== 'ended';
    bar.hidden = next !== 'away';
  };

  /** The window ran out: the same card, red, saying what the room is now. */
  const ended = (): void => {
    stop();
    paint('ended');
    message.textContent = SESSION_ENDED_SENTENCE;
    when.textContent = HOST_DISCONNECTED_SENTENCE;
    announce(`${SESSION_ENDED_SENTENCE}. ${HOST_DISCONNECTED_SENTENCE}.`);
  };

  const clear = (): void => {
    stop();
    mode = undefined;
    element.hidden = true;
    element.dataset.tone = '';
    message.textContent = '';
    when.textContent = '';
    bar.style.transform = '';
    announce('');
  };

  return {
    away(name: string, graceMs: number): void {
      stop();
      grace = Math.max(0, graceMs);
      deadline = now() + grace;
      paint('away');
      message.textContent = hostLeftSentence(name);
      bar.style.transform = 'scaleX(1)';
      // Said once, with the window as a unit rather than a number the reader has to catch: the
      // ticking line below is hidden from assistive tech.
      announce(hostAwaySentence(name, grace));
      let shown = '';
      const draw = (): void => {
        const remaining = (deadline ?? 0) - now();
        if (remaining <= 0) {
          ended();
          return;
        }
        const reading = disconnectingReading(grace, remaining);
        if (reading !== shown) {
          shown = reading;
          when.textContent = `Disconnecting in ${reading}`;
        }
        bar.style.transform = `scaleX(${Math.min(1, remaining / grace)})`;
      };
      draw();
      if (mode === 'away') {
        pending = schedule(() => {
          draw();
          if (deadline !== undefined && (deadline ?? 0) - now() <= 0) {
            stop();
          }
        }, 1000);
      }
    },

    say(text: string, standMs: number): void {
      stop();
      paint('return');
      message.textContent = text;
      announce(text);
      pending = schedule(clear, standMs);
    },

    dropped(text: string): void {
      stop();
      paint('dropped');
      message.textContent = text;
      announce(text);
    },

    endDropped(): void {
      if (mode !== 'dropped') {
        return;
      }
      clear();
    },

    endAway(): void {
      if (mode !== 'away' && mode !== 'ended') {
        return;
      }
      clear();
    },

    hide: clear,
  };
}

/** How long one download toast stands before it takes itself down. */
export const TOAST_STAND_MS = 2200;

/**
 * How many toasts are shown at once. A burst of downloads queues up rather than papering over the
 * corner: the newest two would jump a toast the person is reading out of the way, so the queue is
 * read oldest first and the rest are counted.
 */
export const TOASTS_SHOWN = 2;

/** What one saved file says: the leaf, because the row the press came from already named the rest. */
export function downloadedSentence(path: string): string {
  const slash = path.lastIndexOf('/');
  return `Downloaded ${slash === -1 ? path : path.slice(slash + 1)}`;
}

export interface DownloadToasts {
  /** A path this window saved. */
  downloaded(path: string): void;
}

/** Wires the toast list and the `+N more` pill beside it. */
export function wireDownloadToasts(
  list: HTMLElement,
  more: HTMLElement,
  options: NoticeOptions = {},
): DownloadToasts {
  const schedule = options.schedule ?? ((run, ms) => setTimeout(run, ms));
  const standMs = options.standMs ?? TOAST_STAND_MS;
  const queue: Array<{ id: number; text: string }> = [];
  let seq = 0;

  const draw = (): void => {
    const shown = queue.slice(0, TOASTS_SHOWN);
    list.replaceChildren(
      ...shown.map((item) => {
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.append(iconSpan('download'), labelSpan(item.text));
        return toast;
      }),
    );
    const extra = queue.length - shown.length;
    more.hidden = extra === 0;
    more.textContent = extra === 0 ? '' : `+${extra} more`;
  };

  return {
    downloaded(path: string): void {
      seq += 1;
      const item = { id: seq, text: downloadedSentence(path) };
      queue.push(item);
      draw();
      schedule(() => {
        const at = queue.findIndex((candidate) => candidate.id === item.id);
        if (at === -1) {
          return;
        }
        queue.splice(at, 1);
        draw();
      }, standMs);
    },
  };
}

/** One span of text, for a node the toasts build. */
function labelSpan(text: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'msg';
  span.textContent = text;
  return span;
}
