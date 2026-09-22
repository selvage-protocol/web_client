/**
 * The clipboard-less fallback for the share bar.
 *
 * The bar's readout shows the link abbreviated, and the whole link is what an
 * invite has to carry. When the page cannot reach the clipboard API it fields the
 * whole link in the readout and asks the browser's own copy command for it — and
 * the abbreviated display comes back only if that worked. A field left holding the
 * abbreviation while the alert says `Select the link and copy it by hand.` is an
 * invitation that cannot be used: the person selects what is there and sends a
 * link no room answers.
 */

/** The readout the person would copy from. */
export interface Readout {
  value: string;
  select(): void;
}

export interface HandCopyOptions {
  readout: Readout;
  /** The whole link, which is what has to reach the clipboard. */
  full: string;
  /** What the readout shows when nothing is being copied: the shortened display. */
  shown: string;
  /** `document.execCommand('copy')`, handed in so the fallback is testable. */
  exec: () => boolean;
  /** Sizes the readout to whichever value it ends up carrying. */
  fit?: (value: string) => void;
}

/**
 * Puts the bar back to what it shows at rest. A failed fallback leaves the whole
 * link in the readout, and it is the display that belongs there once a copy — by
 * either route — has worked.
 */
export function showDisplay(options: Pick<HandCopyOptions, 'readout' | 'shown' | 'fit'>): void {
  const { readout, shown, fit } = options;
  if (readout.value === shown) {
    return;
  }
  readout.value = shown;
  fit?.(shown);
}

/**
 * Fields the whole link, copies it with the browser's own command, and returns
 * whether the clipboard now holds it. A failed copy leaves the whole link in the
 * readout, which is the only thing the person has left to select.
 */
export function handCopy(options: HandCopyOptions): boolean {
  const { readout, full, shown, exec, fit } = options;
  readout.value = full;
  fit?.(full);
  readout.select();
  let done = false;
  try {
    done = exec();
  } catch {
    done = false;
  }
  if (done) {
    readout.value = shown;
    fit?.(shown);
  }
  return done;
}
