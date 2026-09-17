/**
 * Which server the page talks to, and over which scheme.
 *
 * A page loaded over https must never emit a ws:// or http:// subrequest:
 * Firefox blocks those as mixed active content (Chromium merely warns, so
 * Chromium proofs of the ws:// default passed and lied). The rule is
 * scheme-match: on an https page every base speaks TLS, and the default is
 * the Pi's TLS endpoint (a reverse proxy over the same selvaged); an http
 * page keeps the plaintext default.
 */

/** The TLS endpoint for the demo room: the proxy in front of the Pi selvaged. */
export const DEFAULT_TLS_SERVER = 'wss://lumi-raspberrypi.muskellunge-yo.ts.net:8444';

/** The default server for a page loaded under `pageProtocol`. */
export function defaultServerForPage(pageProtocol: string, defaultServer: string): string {
  return pageProtocol === 'https:' ? DEFAULT_TLS_SERVER : defaultServer;
}

/**
 * Matches a server base to the page that dials it: on an https page the
 * base always names a TLS socket (`ws://` -> `wss://`, and an `http(s)://`
 * base names the same server over `wss://`), so the socket and the `/meta`
 * read derived from it (the engine maps `wss://` to `https://`) both speak
 * TLS. Anything else — including an http page — passes through untouched.
 */
export function schemeMatchBase(base: string, pageProtocol: string): string {
  if (pageProtocol !== 'https:') {
    return base;
  }
  return base.replace(/^ws:\/\//, 'wss://').replace(/^https?:\/\//, 'wss://');
}
