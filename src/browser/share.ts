/**
 * Page-origin share links: what the guest flow offers is the page URL, never
 * the bare wire URL. The link carries the room and its token, plus `server`
 * only when the room lives somewhere other than the default.
 */

/** Public page origin for share links while the page itself is on loopback. */
export const PUBLIC_PAGE_ORIGIN = '';

/** The origin a share link uses: the page's own, unless it is loopback-only. */
export function shareOrigin(pageOrigin: string, publicOrigin: string = PUBLIC_PAGE_ORIGIN): string {
  if (publicOrigin === '') {
    return pageOrigin;
  }
  try {
    const host = new URL(pageOrigin).hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') {
      return publicOrigin;
    }
  } catch {
    return publicOrigin;
  }
  return pageOrigin;
}

/** Builds the guest link: `pageOrigin + path + ?room=&token=[&server=]`. */
export function buildShareLink(
  pageOrigin: string,
  pagePath: string,
  room: string,
  token: string,
  server: string,
  defaultServer: string,
): string {
  const path = pagePath === '' ? '/' : pagePath;
  let link =
    `${shareOrigin(pageOrigin)}${path}` +
    `?room=${encodeURIComponent(room)}&token=${encodeURIComponent(token)}`;
  if (server !== defaultServer) {
    link += `&server=${encodeURIComponent(server)}`;
  }
  return link;
}

/**
 * Reads a query string with real param semantics: `room`/`token`/`server`
 * (and `debug`) as independent params, everything else ignored, values
 * decoded once. A literal `?` past the first is a separator, not data —
 * share-link values are percent-encoded, so appending `?debug=1` to a link
 * that already has a query must split params, never glue into the token.
 */
export function pageQueryParams(search: string): URLSearchParams {
  const query = search.startsWith('?') ? search.slice(1) : search;
  return new URLSearchParams(query.replace(/\?/g, '&'));
}

/** Reads a pasted page link back into the room, its token, and any server. */
export function parsePageLink(text: string): { room: string; token: string; server?: string } | undefined {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return undefined;
  }
  const params = pageQueryParams(url.search);
  const room = params.get('room');
  const token = params.get('token');
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return undefined;
  }
  if (room === null || room === '' || token === null || token === '') {
    return undefined;
  }
  const server = params.get('server');
  if (server === null || server === '') {
    return { room, token };
  }
  return { room, token, server };
}

/**
 * Shortens a long hostname middle-first: the head and the tail survive and
 * an ellipsis stands where the middle was. Short hosts show whole.
 */
export function abbreviateHost(host: string, maxLength = 24): string {
  if (host.length <= maxLength) {
    return host;
  }
  const head = Math.ceil((maxLength - 1) / 2);
  const tail = Math.floor((maxLength - 1) / 2);
  return `${host.slice(0, head)}…${host.slice(host.length - tail)}`;
}

/**
 * What the share bar shows: the guest link with a long hostname abbreviated
 * middle-first. Display only — the path and query are untouched, and the
 * caller keeps the full link for the title and the clipboard.
 */
export function displayShareLink(link: string, maxHost = 24): string {
  try {
    const url = new URL(link);
    const short = abbreviateHost(url.hostname, maxHost);
    if (short === url.hostname) {
      return link;
    }
    return `${url.protocol}//${short}${url.port === '' ? '' : `:${url.port}`}${url.pathname}${url.search}${url.hash}`;
  } catch {
    return link;
  }
}

/**
 * The paste-box example, built from the real page origin at runtime: the
 * origin is real, the room and token are ellipsis placeholders — never
 * literal ids, never the wire scheme.
 */
export function invitePlaceholder(pageOrigin: string): string {
  return `${pageOrigin}/?room=…&token=…`;
}

/**
 * Keeps a manual room/token join across reloads: after joining, the page URL
 * already has the share-link shape, so replacing it means a reload rejoins
 * from the address bar instead of losing what was typed.
 */
export function persistJoinUrl(history: Pick<History, 'replaceState'>, url: string): void {
  history.replaceState(null, '', url);
}
