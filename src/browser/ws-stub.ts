/**
 * Bundle-time stand-in for the `ws` package.
 *
 * The synced engine imports `ws` for its Node default socket factory; this client
 * always passes {@link nativeWebSocketFactory} instead, so the import is dead code
 * here. The stub keeps the engine copies byte-identical (no fork for the browser)
 * while making `ws` unresolvable at runtime: constructing it throws.
 */
export default class UnavailableWebSocket {
  // The engine's Node factory hands `ws` its options (`maxPayload`) as a second argument; the
  // stub takes the same shape so the synced engine type-checks unchanged, and still refuses.
  constructor(_url?: string, _options?: unknown) {
    throw new Error('the ws package is not part of the browser bundle; pass a socket factory');
  }
}
