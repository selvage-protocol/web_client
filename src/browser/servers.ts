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

/** The schemes a link may name: a socket, or the http(s) form of the same server. */
const LINK_SCHEMES = new Set(['ws:', 'wss:', 'http:', 'https:']);

/**
 * The server base a link names, or `undefined` when a link may not name it.
 *
 * A link's `server` comes from whoever sent the link, and the page reads
 * `<server>/meta` and opens a socket at `<server>/session` from it, so what it
 * may name is bounded before it is used: an absolute `ws`/`wss`/`http`/`https`
 * URL with a host, and nothing that would put a different address in the
 * request than the link reads as naming — no credentials, no fragment, no
 * query. A path is kept: a server behind a prefix is addressed, not spoofed.
 */
export function linkServerBase(raw: string): string | undefined {
  const text = raw.trim();
  if (text === '') {
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return undefined;
  }
  if (!LINK_SCHEMES.has(url.protocol) || url.hostname === '') {
    return undefined;
  }
  if (url.username !== '' || url.password !== '') {
    return undefined;
  }
  if (url.hash !== '' || url.search !== '') {
    return undefined;
  }
  return text;
}
