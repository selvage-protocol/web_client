/**
 * Whether this page's own origin is a Selvage server, told apart from an origin that did not
 * answer at all.
 *
 * The card's host action is offered on the server's own page and nowhere else, so the read behind
 * that offer has to answer one question — is this origin a Selvage server — and it has three
 * answers rather than two, because the card says something different for each:
 *
 * - **it answered as a Selvage server**: the offer is decided by what it seats (host.ts);
 * - **it answered, and was something else**: this page was not served by a Selvage server, and
 *   the card says so rather than offering a control that could only fail;
 * - **it did not answer**: `/meta` is advisory (`PROTOCOL.md` §2), so a timeout is not a claim
 *   about the server — a page whose own server was slow, cold or behind a hiccup still is its
 *   own server, and the card keeps the offer and says what was not read.
 *
 * Reading `undefined` for the last two states is the defect this module exists to close: it told
 * a person on `selvaged`'s own page, whose `/meta` had taken more than the deadline, that the
 * page "was not served by a Selvage server", and took the one action that would have worked off
 * the card for the life of the load.
 */

import { fetchMeta } from '../engine/index.ts';
import type { Meta } from '../engine/index.ts';

/**
 * The second ask's deadline, where the first said nothing: a server slow enough to miss the first
 * one is given longer rather than being written off a second time. The first ask waits the
 * engine's own deadline, which is not restated here.
 */
export const META_REREAD_TIMEOUT_MS = 5000;

/**
 * What `/meta` said about the page's own origin. Three states, and the card words each one.
 */
export type ServerRead =
  /** Answered, and the body is a Selvage server's own (`isSelvageMeta`). */
  | { kind: 'server'; meta: Meta }
  /** Answered with something that is not a Selvage `/meta`: a 404, a page, another JSON API. */
  | { kind: 'not-a-server' }
  /**
   * Nothing answered for the origin itself: the deadline passed, the connection was refused, the
   * body never arrived, or what arrived was a gateway's own error rather than the server's answer
   * about itself.
   */
  | { kind: 'no-answer' };

/** A JSON object, which is what `/meta` answers with and what nothing else here is. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Whether a `/meta` body is a Selvage server's own (`PROTOCOL.md` §2).
 *
 * The card asks this to decide whether the origin it is served from is a server a room can be
 * started on, so the reading is a recognition rather than "it answered JSON": an origin that
 * answers `{}` at `/meta` — a stub, a metrics endpoint, a static host with a JSON file there — is
 * not a Selvage server, and a card that offered its action there would be offering a button whose
 * only outcome is a refusal deeper in.
 *
 * Recognised is the body §2 defines: the version list a client reads (`wire_versions`), the server's own
 * identification, the capability list, and the clocks. `roles` is the one member left out of it —
 * a body that does not write it is still the §2 body, and requiring it would refuse a real server.
 */
export function isSelvageMeta(body: unknown): body is Meta {
  if (!isObject(body)) {
    return false;
  }
  const versions = body['wire_versions'];
  const server = body['server'];
  return (
    Array.isArray(versions) &&
    versions.length > 0 &&
    versions.every((one) => typeof one === 'string') &&
    typeof server === 'string' &&
    server !== '' &&
    Array.isArray(body['capabilities']) &&
    isObject(body['keepalive'])
  );
}

/** True for the abort this module's own deadline raises, which is not an answer about a server. */
function isAbort(error: unknown): boolean {
  const named = error as { name?: unknown } | undefined;
  return named?.name === 'AbortError';
}

/**
 * Reads `/meta` from `base` and says which of the three things happened.
 *
 * The engine's `fetchMeta` throws for everything that is not a parsed body, so the two failure
 * shapes are told apart around it: a response that arrived is an answer whatever its body turned
 * out to be (a 404, a page, JSON that is not a Selvage `/meta`), while a deadline that passed or a
 * connection that never came up is no answer at all. A body still arriving when the deadline
 * passes is the second of those: the headers are not the server's answer about itself.
 *
 * A 5xx is the third case rather than the second. It is the origin's front door failing — a proxy
 * with nothing yet behind it, a server restarting — and the module header's "slow, cold or behind
 * a hiccup" is exactly that page: what it says is that nobody could read this origin, not that
 * this origin is not a Selvage server. `not-a-server` is a claim about the server and it is kept
 * for the life of the load, so it is worth saying only where the body was read and was something
 * else.
 */
export async function readServerMeta(
  base: string,
  options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<ServerRead> {
  let answered = false;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (fetchImpl === undefined) {
    return { kind: 'no-answer' };
  }
  const watching: typeof fetch = async (input, init) => {
    const response = await fetchImpl(input, init);
    if (response.status >= 500) {
      // A gateway's or a server's own error, which is not this server's answer about itself.
      throw new Error(`/meta answered ${response.status}`);
    }
    // Read under the same deadline, so that `answered` means the whole body arrived and was
    // read: a body that fails part way through is a failure to read this origin, not an answer
    // from it, and `fetchMeta` parses the body it is handed here exactly as it would the stream.
    const body = await response.text();
    answered = true;
    return new Response(body);
  };
  try {
    const body = await fetchMeta(base, { ...options, fetchImpl: watching });
    return isSelvageMeta(body) ? { kind: 'server', meta: body } : { kind: 'not-a-server' };
  } catch (error: unknown) {
    return answered && !isAbort(error) ? { kind: 'not-a-server' } : { kind: 'no-answer' };
  }
}
