/**
 * Which server the page talks to, and over which scheme.
 *
 * An invite is the page the room's own server serves, so the server is read
 * from an address rather than from a parameter: the page's own address for a
 * link in the address bar, the link's address for one pasted in, and the
 * invite's own base for a `ws://` hand-over. `pageOriginOf` and `serverBaseOf`
 * are that derivation — the server as the page a browser opens, and back again
 * — and they are the same rule the desktop clients apply.
 *
 * A page loaded over https must never emit a ws:// or http:// subrequest:
 * Firefox blocks those as mixed active content (Chromium merely warns, so
 * Chromium proofs of a ws:// default passed and lied). `schemeMatchBase`
 * matches whatever base a link names to the page that dials it, and
 * `linkServerBase` bounds what a pasted wire invite may name before it is
 * used.
 */

/**
 * The page a room's server is linked at, over the scheme a browser speaks:
 * `wss://` as `https://`, `ws://` as `http://`, with the host, port and any
 * path prefix kept and a trailing slash dropped. One address decides the whole
 * invite — the page the guest opens and the socket they join on are one host —
 * so this is the only place the page half comes from.
 */
export function pageOriginOf(serverBase: string): string {
  const wanted = serverBase.trim().replace(/\/+$/, '');
  if (wanted.startsWith('wss://')) {
    return `https://${wanted.slice('wss://'.length)}`;
  }
  if (wanted.startsWith('ws://')) {
    return `http://${wanted.slice('ws://'.length)}`;
  }
  return wanted;
}

/**
 * The server a page address names, which is what a guest dials: the scheme a
 * browser speaks read back as the one a socket does, with the host, port and
 * any path prefix kept and the query, the fragment and a trailing slash
 * dropped.
 *
 * `''` for an address that names no page of either scheme: a `file://` page is
 * served by no server, and a page served there cannot say which one the room
 * lives on.
 */
export function serverBaseOf(page: string): string {
  let url: URL;
  try {
    url = new URL(page.trim());
  } catch {
    return '';
  }
  const scheme = url.protocol === 'https:' ? 'wss:' : url.protocol === 'http:' ? 'ws:' : '';
  if (scheme === '') {
    return '';
  }
  return `${scheme}//${url.host}${url.pathname.replace(/\/+$/, '')}`;
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

/** The schemes a pasted wire invite may name: a socket, or the http(s) form of the same server. */
const LINK_SCHEMES = new Set(['ws:', 'wss:', 'http:', 'https:']);

/**
 * The server base a pasted wire invite names, or `undefined` when it may not
 * name one.
 *
 * A wire invite's base comes from whoever sent the link, and the page reads
 * `<base>/meta` and opens a socket at `<base>/session` from it, so what it may
 * name is bounded before it is used: an absolute `ws`/`wss`/`http`/`https`
 * URL with a host, and nothing that would put a different address in the
 * request than the link reads as naming — no credentials, no fragment, no
 * query. A path is kept: a server behind a prefix is addressed, not spoofed.
 *
 * The scheme is returned in the one case the page's own rules are written in,
 * because this text becomes the base of a `wss://` socket and of an
 * `https://` read: a link that spells `WS://` names the same server, and every
 * consumer downstream decides by the scheme's spelling whether the page would
 * be making a cleartext subrequest. Nothing else about the text moves.
 *
 * A page link needs no bound of its own: its base is built from the link's own
 * host and path by `serverBaseOf`, so it carries no credentials, query or
 * fragment to begin with.
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
  const mark = text.indexOf('://');
  if (mark === -1) {
    return text;
  }
  return `${url.protocol}//${text.slice(mark + 3)}`;
}
