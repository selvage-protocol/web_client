/**
 * Page-origin share links: what the guest flow offers is the page URL, never
 * the bare wire URL. The link *is* the server — it opens the page the room's
 * own server serves, carrying the room and its token — so it names no server
 * in its query and a page cannot be linked at an address that dials another.
 */

import { pageOriginOf } from './servers.ts';

/**
 * Builds the guest link: the room's own page, `?room=&token=`, with the `selvage/2` fragment on
 * it when the room has one.
 *
 * `§5.1` puts the room key and the host key in the fragment, and the link is the only channel
 * they travel on: a version-2 room has no token-only way in, so a host that dropped the fragment
 * would be handing out a link to a room nobody could join.
 */
export function buildShareLink(
  serverBase: string,
  room: string,
  token: string,
  fragment = '',
): string {
  return (
    `${pageOriginOf(serverBase)}/?room=${encodeURIComponent(room)}&token=${encodeURIComponent(token)}` +
    fragment
  );
}

/**
 * Reads a query string with real param semantics: `room`/`token` (and
 * `debug`) as independent params, everything else ignored, values decoded
 * once. A literal `?` past the first is a separator, not data — share-link
 * values are percent-encoded, so appending `?debug=1` to a link that already
 * has a query must split params, never glue into the token.
 */
export function pageQueryParams(search: string): URLSearchParams {
  const query = search.startsWith('?') ? search.slice(1) : search;
  return new URLSearchParams(query.replace(/\?/g, '&'));
}

/**
 * Reads a pasted page link back into the room, its token, and the page it
 * names. That page's address is the server — nothing in the query names one,
 * so a `server` parameter from a link written before this shape is an unknown
 * parameter and is ignored, exactly as `PROTOCOL.md` §5.1 says any unknown one
 * is.
 */
export function parsePageLink(
  text: string,
): { room: string; token: string; origin: string; fragment: string } | undefined {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return undefined;
  }
  const params = pageQueryParams(url.search);
  const room = params.get('room');
  const token = params.get('token');
  if (room === null || room === '' || token === null || token === '') {
    return undefined;
  }
  return {
    room,
    token,
    origin: `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`,
    // `§5.1`'s fragment, as it arrived. It is not a parameter — `URL` keeps it apart from the
    // query, which is what makes a page link's two keys survive a copy and a paste.
    fragment: url.hash,
  };
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
 * middle-first — the host, the room id, the token and each value of `§5.1`'s fragment,
 * each on its own bound — and, when the link is on this page's own origin, without the
 * scheme and the host at all: the guest is looking at the page the link points to, and
 * the pill only has room for something that reads at a glance. Display only: the
 * caller keeps the full link for the element's title and for the clipboard, so
 * the abbreviation is a paint, never a credential.
 *
 * The fragment is shortened because it is where a `selvage/2` link's length is: the two keys are
 * 43 characters each, so a link whose query was already abbreviated still read across the whole
 * session bar. Its keys stay whole — a shortened key would read as a different key — and each
 * value becomes the same marker the other parts are shortened with, because no readable prefix of
 * both keys fits the pill. The whole link is the element's title and the clipboard's.
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
    const fragment = abbreviateFragment(url.hash);
    if (pageOrigin !== '' && url.origin === new URL(pageOrigin).origin) {
      return `${url.pathname}${query}${fragment}`;
    }
    if (host === url.hostname && query === url.search && fragment === url.hash) {
      return link;
    }
    return `${url.protocol}//${host}${url.port === '' ? '' : `:${url.port}`}${url.pathname}${query}${fragment}`;
  } catch {
    return link;
  }
}

/**
 * `§5.1`'s fragment as the bar shows it: every key whole, every value the marker the rest of the
 * display shortens to.
 *
 * A fragment value is not percent-decoded before this: `§5.1`'s keys are base64url and have
 * nothing to decode, and a value that did carry an escape is safer shortened as it arrived than
 * decoded into the display.
 */
function abbreviateFragment(hash: string): string {
  return hash.replace(
    /(#|&)([A-Za-z0-9._~-]+)=([^&]*)/g,
    (whole: string, lead: string, key: string, value: string) =>
      value === '' ? whole : `${lead}${key}=…`,
  );
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
 * Keeps a room/token join across reloads. After joining, the address bar is
 * replaced with the room's own page link, so a reload rejoins from the address
 * bar instead of losing what was typed. `replaceState` refuses another origin,
 * so a page that is not the room's own page leaves the bar alone and the link
 * stays in the session bar.
 */
export function persistJoinUrl(history: Pick<History, 'replaceState'>, url: string): void {
  history.replaceState(null, '', url);
}
