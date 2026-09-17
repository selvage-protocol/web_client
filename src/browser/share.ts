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
 * Keeps a manual room/token join across reloads: after joining, the page URL
 * already has the share-link shape, so replacing it means a reload rejoins
 * from the address bar instead of losing what was typed.
 */
export function persistJoinUrl(history: Pick<History, 'replaceState'>, url: string): void {
  history.replaceState(null, '', url);
}
