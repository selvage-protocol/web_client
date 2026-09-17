/**
 * Bundle-time stand-in for the `ws` package.
 *
 * The synced engine imports `ws` for its Node default socket factory; this client
 * always passes {@link nativeWebSocketFactory} instead, so the import is dead code
 * here. The stub keeps the engine copies byte-identical (no fork for the browser)
 * while making `ws` unresolvable at runtime: constructing it throws.
 */
export default class UnavailableWebSocket {
  constructor(_url?: string) {
    throw new Error('the ws package is not part of the browser bundle; pass a socket factory');
  }
}
