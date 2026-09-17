declare const Buffer: {
  byteLength(text: string, encoding?: string): number;
};

/** Pre-bundle join guard (see the inline script in `public/index.html`). */
interface Window {
  __selvageJoinArmed: boolean;
  __selvagePendingJoin: boolean;
}
