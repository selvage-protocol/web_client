/**
 * Browser globals the synced engine expects from Node.
 *
 * Today that is exactly one: `Buffer.byteLength` for the inbound-frame bound.
 * Defined here only when absent, so Node (and its test runs) keeps its own.
 */
const scope = globalThis as unknown as {
  Buffer?: { byteLength(text: string, encoding?: string): number };
  TextEncoder?: new () => { encode(text: string): Uint8Array };
};

if (typeof scope.Buffer === 'undefined' && typeof scope.TextEncoder !== 'undefined') {
  const Encoder = scope.TextEncoder;
  scope.Buffer = {
    byteLength: (text: string): number => new Encoder().encode(text).length,
  };
}

export {};
