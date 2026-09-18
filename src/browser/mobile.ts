/**
 * The phone's own choices, decided once from what the browser reports about
 * itself rather than from the width of a window: a narrow desktop window is a
 * desktop.
 *
 * `(any-hover: none)` is the query that separates them. `(hover: …)` answers for
 * the *primary* input mechanism alone, so a touchscreen laptop whose primary is
 * reported as touch would get the phone layout while a mouse sits next to it;
 * `any-hover` answers for every mechanism the device has, and `none` is true
 * only when none of them can hover — a phone or a tablet, never a machine with
 * a mouse or a touchpad. Everything below is the *behaviour* behind the two
 * media queries in `public/index.html`; the shell owns the sizes.
 *
 * Nothing here touches the DOM, so the decisions are testable without one.
 */

import type * as monaco from 'monaco-editor';

/** No pointing device anywhere: a phone or a tablet, never a machine with a mouse. */
export const TOUCH_QUERY = '(any-hover: none)';

/** The same device, phone-shaped: the card is a sheet and the panel a disclosure. */
export const PHONE_QUERY = '(any-hover: none) and (max-width: 640px)';

/**
 * The editor options for this device. A phone gets the settings its screen
 * argues for and a desktop is handed the options it has always had, so the two
 * cannot drift apart by a later edit to one of them.
 *
 * The minimap is a grey texture on a 390 px screen, not a navigator; a line
 * wider than the phone scrolls sideways inside a vertically scrolling page
 * unless it wraps, which is a trap on touch; 16 px is the floor under which
 * iOS zooms a focused field, and the editor's own input is a focused field;
 * and a fingertip needs a scrollbar it can see, never the 10 px hairline.
 */
export function editorOptionsFor(
  touch: boolean,
): monaco.editor.IStandaloneEditorConstructionOptions {
  if (!touch) {
    return { minimap: { enabled: true, side: 'right' } };
  }
  return {
    minimap: { enabled: false },
    wordWrap: 'on',
    fontSize: 16,
    scrollbar: { verticalScrollbarSize: 14, horizontalScrollbarSize: 14 },
  };
}

/**
 * The height the app should be pinned to, or `undefined` to leave it to its own
 * CSS (`100dvh`).
 *
 * A soft keyboard on iOS shrinks only the *visual* viewport: the layout
 * viewport, and so `dvh`, and so every layout engine listening to the element's
 * own size, never hear about it — which is how a caret ends up behind the
 * keyboard. Following the visual viewport is the fix, and it is deliberately
 * narrow: a pinch-zoom is a visual-viewport shrink too, and reflowing the page
 * to half its width because the guest zoomed in would be worse than the bug.
 */
export function appHeightFor(
  viewport: { height: number; scale: number } | undefined,
  layoutHeight: number,
): number | undefined {
  if (viewport === undefined || viewport.scale !== 1 || viewport.height >= layoutHeight) {
    return undefined;
  }
  return Math.round(viewport.height);
}
