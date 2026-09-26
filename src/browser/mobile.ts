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

/**
 * The same device, phone-shaped: the card is a sheet and the panel a disclosure.
 *
 * Two arms, because a phone has two shapes and the width alone answers for one of them. Held
 * upright it is 390 px wide; turned on its side it is 844 px wide and 390 px tall, which no
 * width query can see — measured at 844x390, the landscape phone was given the desktop column, a
 * 196 px panel beside the editor, the strip's own download control and a footer that took 60 of
 * the 390 px. The second arm is the same device in the other shape, and it is narrowed by the
 * touch query either way, so a 400 px-tall desktop window is not a phone.
 */
export const PHONE_QUERY =
  '(any-hover: none) and (max-width: 640px), (any-hover: none) and (max-height: 480px)';

/**
 * The editor options for this device. A phone gets the settings its screen
 * argues for and a pointer device gets the page's own base options, so the two
 * cannot drift apart by a later edit to one of them.
 *
 * Both wrap long lines, as the design does, so a line is read without scrolling sideways.
 *
 * The minimap is off on both, and the current line is unmarked on both: the
 * design draws neither — its gutter is numbers and nothing else, in one colour
 * — and the minimap this page used to turn on for a pointer was a grey texture
 * beside the code. What is left is a phone's own three: 16 px is the floor under
 * which iOS zooms a focused field, and the editor's own input is a focused field;
 * and a fingertip needs a scrollbar it can see, never the 10 px hairline.
 *
 * The gutter is the third. Monaco's own line-number column, its fold arrows and
 * its decoration width added up to 96 of 390 px — a quarter of the screen, and
 * 30 % at 320 — for numbers no phone document reaches and arrows a fingertip
 * cannot hit. Two characters of line number, no folding and 14 px of decoration
 * width leave the glyph margin, which is where a peer's badge is drawn and the
 * one thing in the gutter this page puts there.
 */
export function editorOptionsFor(
  touch: boolean,
): monaco.editor.IStandaloneEditorConstructionOptions {
  if (!touch) {
    return { minimap: { enabled: false }, renderLineHighlight: 'none', wordWrap: 'on' };
  }
  return {
    minimap: { enabled: false },
    renderLineHighlight: 'none',
    wordWrap: 'on',
    fontSize: 16,
    scrollbar: { verticalScrollbarSize: 14, horizontalScrollbarSize: 14 },
    // The gutter, measured at 390 px: 96 px of the 390 with Monaco's defaults, against 55 with
    // these. `glyphMargin` stays on because the peer badges are drawn in it, and its width is the
    // line height — nothing here can narrow it — so the separation the code and the number need
    // comes out of the column the numbers do not use: two digits of line number, and a decoration
    // width of 14 px, where Monaco's own 4 left the code against the number (`1# Hosted from …`).
    // A pointer device's gap is 26 px, which is Monaco's 10 plus the 16 px its fold arrows take —
    // arrows this device has none of, and a width this screen cannot pay for: 26 here would put
    // the gutter back at 77 of 390.
    lineNumbersMinChars: 2,
    lineDecorationsWidth: 14,
    folding: false,
    glyphMargin: true,
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

/** The part of a live media query `watchTouchQuery` needs, so a test can fake one. */
export interface LiveQuery {
  readonly matches: boolean;
  addEventListener(type: 'change', listener: (event: unknown) => void): void;
}

/**
 * Re-runs a decision when the device changes under it. A pointer attached or
 * removed mid-session — a mouse plugged into a tablet, a trackpad in a case —
 * flips the query with no reload, so the decisions a stylesheet cannot restyle
 * (Monaco's options, the off-hover wording, the viewport pin) have to be told.
 */
export function watchTouchQuery(query: LiveQuery, apply: (touch: boolean) => void): void {
  query.addEventListener('change', () => apply(query.matches));
}
