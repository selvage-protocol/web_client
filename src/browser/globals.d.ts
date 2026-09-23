declare const Buffer: {
  byteLength(text: string, encoding?: string): number;
};

/** Pre-bundle join guard (see the inline script in `public/index.html`). */
interface Window {
  __selvageJoinArmed: boolean;
  __selvagePendingJoin: boolean;
  /** A submit the form's own hold caught before any script ran, settled by that script. */
  __selvagePendingSubmit: boolean;
  /** Whether the shell's own "still loading" line is on the card. */
  __selvageWaiting: boolean;
  /** The shell's settle for a held submit, which the shell's card block calls once. */
  __selvageSettleHeldSubmit(): void;
}
