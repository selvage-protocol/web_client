/**
 * The files-and-people panel's width: how it is dragged, keyed, remembered, and put back.
 *
 * The panel is a column of the page and its width is the reader's, not the design's: a tree of
 * paths wants room, and the same person wants more or less of it at different moments. It is the
 * one piece of chrome a page is expected to let a person size, and the platform's
 * own way of doing it is a `role="separator"` a pointer can drag and a keyboard can move.
 *
 * The arithmetic is here as pure functions over numbers, so every bound is pinned without a DOM:
 * the width a drag would take, what a key does to it, and what the remembered value is allowed to
 * be. `wireSidebar` is the small part that touches elements.
 */

/** The width a panel has before anyone has said otherwise, in rem. */
export const DEFAULT_WIDTH_REM = 24;
/** The narrowest it may be dragged to, in px. It never shuts: a tree nobody can see is no tree. */
export const MIN_WIDTH_PX = 224;
/** The widest, in px. */
export const MAX_WIDTH_PX = 512;
/** What the editor beside it always keeps, in px, so a narrow window does not lose the code. */
export const PANE_MIN_PX = 320;
/** How much one arrow key moves it, and how much Shift does. */
export const KEY_STEP_PX = 16;
export const KEY_STEP_LARGE_PX = 64;
/** Below this width the panel's own contents change shape (a container query in the shell). */
export const NARROW_WIDTH_REM = 18;

/** Where the width is remembered. One key, per browser. */
export const SIDEBAR_STORAGE_KEY = 'selvage.sidebar';

/** The panel as it stands. */
export interface SidebarState {
  width: number;
}

/** What a stored value is read as, ignoring anything else a browser may have left there. */
export function readSidebar(raw: string | null): SidebarState | undefined {
  if (raw === null) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return undefined;
  }
  const value = parsed as { width?: unknown };
  if (typeof value.width !== 'number' || !Number.isFinite(value.width)) {
    return undefined;
  }
  return { width: value.width };
}

/** The text a state is remembered as. */
export function sidebarStorageValue(state: SidebarState): string {
  return JSON.stringify({ width: Math.round(state.width) });
}

/** The bounds a window gives the panel: a floor, and a ceiling that leaves the editor its room. */
export function widthLimits(viewportWidth: number): { min: number; max: number } {
  const min = MIN_WIDTH_PX;
  const max = Math.max(min, Math.min(MAX_WIDTH_PX, viewportWidth - PANE_MIN_PX));
  return { min, max };
}

/** A width inside the bounds, which is what every path that sets one goes through. */
export function clampWidth(width: number, viewportWidth: number, remPx: number): number {
  const { min, max } = widthLimits(viewportWidth);
  if (!Number.isFinite(width)) {
    return DEFAULT_WIDTH_REM * remPx;
  }
  return Math.min(max, Math.max(min, width));
}

/** What one keypress makes of the current width, or `undefined` for a key that is not the panel's. */
export function nextWidth(
  current: number,
  key: string,
  shift: boolean,
  viewportWidth: number,
  remPx: number,
): number | undefined {
  const step = shift ? KEY_STEP_LARGE_PX : KEY_STEP_PX;
  switch (key) {
    case 'ArrowLeft':
      return clampWidth(current - step, viewportWidth, remPx);
    case 'ArrowRight':
      return clampWidth(current + step, viewportWidth, remPx);
    case 'Home':
      return clampWidth(widthLimits(viewportWidth).min, viewportWidth, remPx);
    case 'End':
      return clampWidth(widthLimits(viewportWidth).max, viewportWidth, remPx);
    default:
      return undefined;
  }
}

/** How wide the panel is in rem, for the `aria-valuenow`-style readouts a separator carries in px. */
export function toRem(px: number, remPx: number): number {
  return px / remPx;
}

export interface SidebarElements {
  /** The column that is resized. */
  side: HTMLElement;
  /** The 1 px line between the panels; the drag target and the keyboard's. */
  separator: HTMLElement;
}

export interface SidebarOptions {
  elements: SidebarElements;
  /** Where the width is remembered, when the browser allows it to be. */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | undefined;
  /** How many pixels a rem is here, so the bounds are the design's and not this screen's. */
  remPx: () => number;
  /** How wide the window is, for the ceiling. */
  viewportWidth: () => number;
  /** Re-measures whatever the panel's width just changed (the editor). */
  relayout?: () => void;
  /**
   * Whether this device has a panel of its own width at all.
   *
   * A phone renders none of this: the panel is a full-width disclosure with its own state, and a
   * separator that wrote `hidden` there would reopen what the person shut — on a rotation, on the
   * soft keyboard, on any resize.
   */
  active?: () => boolean;
  /** Schedules one frame of work, so a drag re-measures once a frame rather than once an event. */
  frame?: (run: () => void) => unknown;
}

export interface Sidebar {
  /** Puts the remembered (or default) width on the page, before or after paint. */
  apply(): void;
  /** The width now, in px. */
  width(): number;
  /** Puts the panel back to the width it starts at. */
  reset(): void;
  dispose(): void;
}

/**
 * Wires the panel's edge.
 *
 * A pointer drag takes the pointer (`setPointerCapture`), so a fast drag that leaves the 8 px target
 * keeps resizing instead of stopping at the edge of it. The keyboard is the same arithmetic on the
 * same element, because a separator is a control a keyboard user is entitled to.
 */
export function wireSidebar(options: SidebarOptions): Sidebar {
  const { side, separator } = options.elements;
  const frame = options.frame ?? ((run: () => void) => requestAnimationFrame(run));
  const active = options.active ?? ((): boolean => true);
  const remembered = options.storage === undefined ? undefined : readSidebar(safeRead(options.storage));
  // Read before the workspace paints (the page calls `apply` at load), so the panel does not jump.
  let width = remembered?.width ?? DEFAULT_WIDTH_REM * options.remPx();
  let drag: { startX: number; startWidth: number } | undefined;
  let framePending = false;

  const remember = (): void => {
    if (options.storage === undefined) {
      return;
    }
    try {
      options.storage.setItem(SIDEBAR_STORAGE_KEY, sidebarStorageValue({ width }));
    } catch {
      // A browser that refuses the write (private mode, a full quota) keeps the width for this
      // visit and forgets it after; nothing a person asked for is lost either way.
    }
  };

  const layout = (): void => {
    if (framePending) {
      return;
    }
    framePending = true;
    frame(() => {
      framePending = false;
      options.relayout?.();
    });
  };

  const paint = (): void => {
    if (!active()) {
      // Nothing of this is the panel's to decide on a device with no separator: the disclosure owns
      // `hidden`, and there is no width to carry.
      side.style.width = '';
      return;
    }
    // One number, and it is the number the panel renders at: the width is brought inside the window's
    // bounds here, so what the style declares, what the separator states and what the next write
    // remembers are the same width. Read unclamped from storage, a width from a wider window used to
    // paint one number and report another.
    width = clampWidth(width, options.viewportWidth(), options.remPx());
    const rounded = Math.round(width);
    side.style.width = `${rounded}px`;
    const { min, max } = widthLimits(options.viewportWidth());
    separator.setAttribute('aria-valuemin', String(Math.round(min)));
    separator.setAttribute('aria-valuemax', String(Math.round(max)));
    separator.setAttribute('aria-valuenow', String(rounded));
    separator.setAttribute('aria-valuetext', `${(rounded / options.remPx()).toFixed(1)} rem`);
    layout();
  };

  const setWidth = (next: number, rememberIt = true): void => {
    width = clampWidth(next, options.viewportWidth(), options.remPx());
    if (rememberIt) {
      remember();
    }
    paint();
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) {
      return;
    }
    drag = { startX: event.clientX, startWidth: width };
    separator.setPointerCapture?.(event.pointerId);
    separator.dataset.dragging = 'true';
    event.preventDefault();
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (drag === undefined) {
      return;
    }
    setWidth(drag.startWidth + (event.clientX - drag.startX));
  };
  const onPointerUp = (event: PointerEvent): void => {
    if (drag === undefined) {
      return;
    }
    drag = undefined;
    delete separator.dataset.dragging;
    separator.releasePointerCapture?.(event.pointerId);
    remember();
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    const next = nextWidth(width, event.key, event.shiftKey, options.viewportWidth(), options.remPx());
    if (next === undefined) {
      return;
    }
    event.preventDefault();
    setWidth(next);
  };
  const onDoubleClick = (): void => {
    setWidth(DEFAULT_WIDTH_REM * options.remPx());
  };

  const onViewportResize = (): void => {
    // A window narrowed under the panel must not leave it wider than its ceiling.
    setWidth(width);
  };

  separator.addEventListener('pointerdown', onPointerDown);
  separator.addEventListener('pointermove', onPointerMove);
  separator.addEventListener('pointerup', onPointerUp);
  separator.addEventListener('pointercancel', onPointerUp);
  separator.addEventListener('keydown', onKeyDown);
  separator.addEventListener('dblclick', onDoubleClick);
  window.addEventListener('resize', onViewportResize);

  return {
    apply(): void {
      paint();
    },
    width: () => width,
    reset(): void {
      setWidth(DEFAULT_WIDTH_REM * options.remPx());
    },
    dispose(): void {
      separator.removeEventListener('pointerdown', onPointerDown);
      separator.removeEventListener('pointermove', onPointerMove);
      separator.removeEventListener('pointerup', onPointerUp);
      separator.removeEventListener('pointercancel', onPointerUp);
      separator.removeEventListener('keydown', onKeyDown);
      separator.removeEventListener('dblclick', onDoubleClick);
      window.removeEventListener('resize', onViewportResize);
    },
  };
}

/** `localStorage.getItem`, which a browser may refuse outright (a `file://` page, private mode). */
function safeRead(storage: Pick<Storage, 'getItem'>): string | null {
  try {
    return storage.getItem(SIDEBAR_STORAGE_KEY);
  } catch {
    return null;
  }
}
