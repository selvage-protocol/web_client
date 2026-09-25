/**
 * Leaving a session, and what leaving costs a host.
 *
 * A guest can simply go: it holds the room's key through the link it joined by, and the room goes on
 * without it (`PROTOCOL.md` §9, `peer.left`). A host cannot: the room's host key is the only one that
 * signs its state, and the room is destroyed `room_grace_ms` after its **last** connection ends
 * (§9). So a host's connection ending is the end of the room — exactly what closing the tab does —
 * with everyone still in it editing until their own host-away clock passes `awareness_expire_ms` and
 * their sessions end (§13.8), and nothing written anywhere the room did not already hold.
 *
 * That is a real consequence for other people, and it is one click from the share bar, so a host's
 * Leave asks before it acts. The question stands **under the button that asks it**, in an anchored
 * panel, because the question and its answer have to be one glance apart: the earlier version put the
 * sentence at the far left of the bar and morphed the button at the far right, and a person reading
 * one could not see the other. The panel has the two answers and no timer — a question that answered
 * itself while somebody was still reading it is worse than one they had to dismiss.
 *
 * The control is separated from the page so the suite drives it without a browser: the page's entry
 * module runs on import and cannot be one. The control's own name is set from the role as the seat
 * is taken (`showRole`), because a host's press is not a guest's: the shell's markup carries the
 * guest's shape, which is what a page between sessions shows.
 */

/** What the control asks of the page it sits on. */
export interface LeaveOptions {
  /**
   * Whether this window is the room's host — the one leaving whose connection ends the room. The
   * page reads it from the folder it holds rather than from the room's role: the role is the applied
   * state's word and arrives a moment after the seat, and a confirmation that could fail to be asked
   * is worse than one asked for a guest.
   */
  hosting(): boolean;
  /** The control and the panel its question stands in. */
  surface: LeaveSurface;
  /** Leaves the session. */
  leave(): void;
}

/** The elements of the ask: the control, the anchored panel, and the two answers in it. */
export interface LeaveSurface {
  /** The panel the question stands in, anchored under the control. */
  panel: HTMLElement;
  /** The line the question itself is written in. */
  question: HTMLElement;
  /** The control in the bar, which asks the question. */
  button: HTMLElement;
  /** The quiet answer, and where focus lands. */
  cancel: HTMLButtonElement;
  /** The destructive answer: this is the press that ends the room. */
  go: HTMLButtonElement;
}

export interface LeaveControl {
  /** One press of the bar's control: leaves, or raises a host's question. */
  press(): void;
  /** Takes the question down. */
  close(): void;
  /** Whether the question is standing. */
  asking(): boolean;
  /**
   * Names the control for the role this window has taken.
   *
   * The page calls it as the seat is taken, because the role is not known before then (`§13.4`).
   */
  showRole(hosting: boolean): void;
  dispose(): void;
}

/** The verb at rest, for a guest: leaving costs nobody else anything. */
export const LEAVE_LABEL = 'Leave';

/** The control's name for a guest — the desktop clients' own `Leave the session`. */
export const LEAVE_TITLE = 'Leave the session';

/**
 * The verb for a host, whose connection is the room.
 *
 * The consequence used to be readable only in the confirmation: the control said `Leave` for both
 * roles, so a host pressed the same word a guest does and learned what it did afterwards. It says
 * what it does now, in the visible label, because the confirmation is one press too late and a
 * `title` is a thing a phone never shows.
 */
export const LEAVE_HOST_LABEL = 'Leave and end the room';

/** The answer that leaves: the words on the destructive button in the panel. */
export const LEAVE_ASKING_LABEL = 'Leave anyway';

/** The answer that does not. */
export const LEAVE_CANCEL_LABEL = 'Cancel';

/**
 * The question a host's first press asks. It names the consequence rather than the countdown that
 * follows it: the host reads the same sentence on the card before it ever starts a room
 * (`HOST_TAB_WARNING`), and the grace is the room's number, not this panel's.
 */
export const HOST_LEAVE_QUESTION =
  'Leaving ends the room for everyone in it, and nothing in it is saved.';

export function wireLeave(options: LeaveOptions): LeaveControl {
  const { panel, question, button, cancel, go } = options.surface;
  question.textContent = HOST_LEAVE_QUESTION;
  go.textContent = LEAVE_ASKING_LABEL;
  cancel.textContent = LEAVE_CANCEL_LABEL;
  let open = false;
  // The shell's own markup starts the panel hidden and the control unexpanded; saying it again here
  // means the two cannot disagree even if a page omits one of the attributes.
  button.setAttribute('aria-expanded', 'false');
  panel.hidden = true;

  /**
   * Shows the state on the control as well as in the panel, and keeps both here.
   *
   * `aria-expanded` is the button's for a screen reader, and it has to move with the same flag the
   * page's own `open` does — a control that says `expanded` after Cancel, or after a room ended
   * under it, is a disclosure that lies. Nothing outside this module writes either one.
   */
  const show = (expanded: boolean): void => {
    open = expanded;
    panel.hidden = !expanded;
    button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  };

  const close = (): void => {
    if (!open) {
      return;
    }
    show(false);
  };

  /**
   * The control's own words, which are the role's: a host's press ends the room for everyone in
   * it, and the verb says so before it is pressed rather than in the question that follows.
   */
  const showRole = (hosting: boolean): void => {
    const name = hosting ? LEAVE_HOST_LABEL : LEAVE_TITLE;
    button.textContent = hosting ? LEAVE_HOST_LABEL : LEAVE_LABEL;
    button.setAttribute('aria-label', name);
    button.title = name;
  };

  const openPanel = (): void => {
    show(true);
    // Focus lands on the answer that does not end the room: the destructive one is a second press
    // away, and never the one a stray Return takes.
    cancel.focus?.();
  };

  const onCancel = (): void => {
    close();
    button.focus?.();
  };

  const onGo = (): void => {
    close();
    options.leave();
  };

  const onKeyDown = (event: Event): void => {
    if ((event as KeyboardEvent).key === 'Escape') {
      event.preventDefault();
      onCancel();
    }
  };

  // A press anywhere else is the third answer: the question goes away and nothing happens. The
  // panel and the control both count as inside, because the control's own press is handled above.
  const doc = (panel.ownerDocument ?? undefined) as Document | undefined;
  const onOutside = (event: Event): void => {
    if (!open) {
      return;
    }
    const target = event.target as Node | null;
    if (target === null) {
      return;
    }
    if (panel.contains(target) || button.contains(target)) {
      return;
    }
    close();
  };

  cancel.addEventListener('click', onCancel);
  go.addEventListener('click', onGo);
  panel.addEventListener('keydown', onKeyDown);
  doc?.addEventListener('pointerdown', onOutside, true);

  return {
    press(): void {
      if (open) {
        // The control asks once: a second press is a press on the question's own panel, and the
        // panel's answers are the only two there are.
        close();
        return;
      }
      if (!options.hosting()) {
        options.leave();
        return;
      }
      openPanel();
    },
    close,
    asking: () => open,
    showRole,
    dispose(): void {
      cancel.removeEventListener('click', onCancel);
      go.removeEventListener('click', onGo);
      panel.removeEventListener('keydown', onKeyDown);
      doc?.removeEventListener('pointerdown', onOutside, true);
    },
  };
}
