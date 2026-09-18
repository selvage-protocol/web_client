/**
 * The share box: the whole bar is the copy target — click anywhere on it, or
 * focus it and press Enter — and on a copy an overlay inside the bar names
 * the confirmation briefly, then hides. The link readout never leaves the
 * bar, so the morph changes nothing outside the control and shifts no layout.
 */

export interface ShareBoxOptions {
  /** The confirmation the bar morphs to; defaults to `Link copied`. */
  confirmLabel?: string;
  /** The check glyph drawn beside the confirmation, when given. */
  checkSvg?: string;
  /** How long the confirmation stands before the bar reverts. */
  confirmMs?: number;
  schedule?: (run: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

export interface ShareBox {
  /** Shows the confirmation overlay, then hides it. */
  confirm(): void;
  dispose(): void;
}

/** Wires the group element as the copy control; returns the confirmation. */
export function wireShareBox(
  group: HTMLElement,
  copy: () => unknown,
  options: ShareBoxOptions = {},
): ShareBox {
  const confirmLabel = options.confirmLabel ?? 'Link copied';
  const confirmMs = options.confirmMs ?? 1500;
  const schedule = options.schedule ?? ((run, ms) => setTimeout(run, ms));
  const cancel =
    options.cancel ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const doc = group.ownerDocument;
  let overlay: HTMLElement | undefined;
  let pending: unknown;

  const restore = (): void => {
    if (overlay === undefined) {
      return;
    }
    overlay.hidden = true;
    group.classList.remove('copied');
    pending = undefined;
  };
  const onClick = (): void => {
    void copy();
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      void copy();
    }
  };
  group.addEventListener('click', onClick);
  group.addEventListener('keydown', onKeyDown);
  return {
    confirm(): void {
      if (overlay === undefined) {
        overlay = doc.createElement('span');
        overlay.className = 'confirm';
        overlay.hidden = true;
        if (options.checkSvg !== undefined) {
          const glyph = doc.createElement('span');
          glyph.className = 'icon';
          glyph.setAttribute('aria-hidden', 'true');
          glyph.innerHTML = options.checkSvg;
          overlay.appendChild(glyph);
        }
        const label = doc.createElement('span');
        label.textContent = confirmLabel;
        overlay.appendChild(label);
        group.appendChild(overlay);
      }
      if (pending !== undefined) {
        cancel(pending);
      }
      overlay.hidden = false;
      group.classList.add('copied');
      pending = schedule(restore, confirmMs);
    },
    dispose(): void {
      group.removeEventListener('click', onClick);
      group.removeEventListener('keydown', onKeyDown);
      if (pending !== undefined) {
        cancel(pending);
        pending = undefined;
      }
    },
  };
}
