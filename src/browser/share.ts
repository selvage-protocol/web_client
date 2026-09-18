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
 * Shortens a value middle-first: the head and the tail survive and an
 * ellipsis stands where the middle was. Anything at or under the bound shows
 * whole — an abbreviation must never make a value longer than it was.
 */
function abbreviateMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  const head = Math.ceil((maxLength - 1) / 2);
  const tail = Math.floor((maxLength - 1) / 2);
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}

/** How much of the room id and of the token the bar carries. */
const ROOM_DISPLAY_MAX = 12;
const TOKEN_DISPLAY_MAX = 12;

/** A long hostname, shortened for the bar. Short hosts show whole. */
export function abbreviateHost(host: string, maxLength = 24): string {
  return abbreviateMiddle(host, maxLength);
}

/**
 * What the share bar shows: the guest link with its long parts shortened
 * middle-first — the host, the room id and the token, each on its own bound —
 * and, when the link is on this page's own origin, without the scheme and the
 * host at all: the guest is looking at the page the link points to, and the
 * pill only has room for something that reads at a glance. Display only: the
 * caller keeps the full link for the element's title and for the clipboard, so
 * the abbreviation is a paint, never a credential. The `server` parameter
 * stays whole: it names where the room is, not a permission.
 */
export function displayShareLink(link: string, pageOrigin = '', maxHost = 24): string {
  try {
    const url = new URL(link);
    const host = abbreviateMiddle(url.hostname, maxHost);
    const query = url.search.replace(
      /(\?|&)(room|token)=([^&]*)/g,
      (whole: string, lead: string, key: string, raw: string) => {
        let value: string;
        try {
          value = decodeURIComponent(raw);
        } catch {
          return whole;
        }
        const max = key === 'room' ? ROOM_DISPLAY_MAX : TOKEN_DISPLAY_MAX;
        const short = abbreviateMiddle(value, max);
        return short === value ? whole : `${lead}${key}=${short}`;
      },
    );
    if (pageOrigin !== '' && url.origin === new URL(pageOrigin).origin) {
      return `${url.pathname}${query}${url.hash}`;
    }
    if (host === url.hostname && query === url.search) {
      return link;
    }
    return `${url.protocol}//${host}${url.port === '' ? '' : `:${url.port}`}${url.pathname}${query}${url.hash}`;
  } catch {
    return link;
  }
}

/**
 * Sizes the bar's readout to the value it carries. An input sits at its own
 * intrinsic width otherwise, whatever the CSS says, and the bar would show the
 * first twenty-odd characters of the link with the rest scrolled out of sight.
 *
 * `size` counts the font's *average* character, and a link of digits,
 * lowercase and ellipses runs wider than that average — measured in Chromium,
 * 38 characters of a share link come to 275 px against 263 px of `size`. Hence
 * the slack; the shell also sets `field-sizing: content`, which sizes the
 * readout to the value exactly where the engine has it.
 */
export function fitReadout(readout: { size: number }, shown: string): void {
  readout.size = Math.ceil(shown.length * READOUT_SIZE_SLACK) + 1;
}

/** How much wider than its character count a readout has to be, per above. */
const READOUT_SIZE_SLACK = 1.15;

/**
 * Keeps a manual room/token join across reloads: after joining, the page URL
 * already has the share-link shape, so replacing it means a reload rejoins
 * from the address bar instead of losing what was typed.
 */
export function persistJoinUrl(history: Pick<History, 'replaceState'>, url: string): void {
  history.replaceState(null, '', url);
}
