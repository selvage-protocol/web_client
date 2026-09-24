import type { WebSocketFactory, WebSocketLike } from '../engine/index.ts';
import { close, code as errCode, isProtocolError } from '../engine/index.ts';

/**
 * The engine's socket, from the browser's own WebSocket.
 *
 * The engine only needs the `WebSocketLike` slice (text/binary send, close, the
 * open/message/close/error callbacks), which the browser's WebSocket already provides —
 * so the factory is one line and the `ws` package never enters the bundle. The
 * tsconfig `paths` entry maps `ws` to the stub next to this file, keeping the synced
 * engine sources byte-identical while guaranteeing the Node-only import resolves to
 * nothing at typecheck and bundle time.
 */
export const nativeWebSocketFactory: WebSocketFactory = (url: string): WebSocketLike =>
  new WebSocket(url) as unknown as WebSocketLike;

/**
 * A connection failure in words. Every surface of the join path maps here, and so
 * does the host path's own failure — a socket that would not come up, or a
 * handshake that refused, is one situation whichever action opened it — so the card
 * reads as a plain situation with one next step: never a server address, a code, or
 * mechanism wording. The token never appears. Diagnostics keep the server and the raw
 * cause, but they live in the console (or behind `?debug=1`), never in default UI.
 *
 * A message this does not recognise (the card's own refusals — the name, the folder
 * among them) passes through untouched: they are already sentences written for this card,
 * and rewriting one would only lose what it says.
 *
 * - refusals the handshake named (`room_unknown`, `token_invalid`,
 *   `room_gone`, `host_present`) say what to check;
 * - a close code buried in a transport message maps the same way, because
 *   the refusal and the socket race and either may arrive first;
 * - a transport that never came up, an abandoned attempt, or a hello with
 *   no answer reads as not reaching the session;
 * - a server address the socket cannot even use says the link can't be used;
 * - anything else passes through untouched, except a last guard that
 *   catches any wording the cases above missed.
 *
 * `base` stays in the signature for the diagnostic helpers below; the
 * plain copy itself never names it.
 */
export function describeJoinError(error: unknown, _base?: string): string {
  const message = error instanceof Error ? error.message : String(error);
  if (isProtocolError(error)) {
    switch (error.code) {
      case errCode.roomUnknown:
        return 'Nothing answers at that link. Ask the host for a fresh link and retry.';
      case errCode.tokenInvalid:
        return 'That link was refused. Paste the whole link again and retry.';
      case errCode.roomGone:
        return 'The session already ended. Ask the host for a fresh link and retry.';
      case errCode.hostPresent:
        return 'The session already has its host. Ask the host for a guest link and retry.';
      case errCode.unsupportedVersion:
        return 'The page and the session disagree. Reload the page and retry.';
      case errCode.helloRequired:
        return 'Got no answer. Check the link and retry.';
      default:
        break;
    }
  }
  const closed = /closed with (\d+)|closed before it opened:\s*(\d+)/i.exec(message);
  const closeCode = closed?.[1] ?? closed?.[2];
  if (closeCode !== undefined) {
    switch (Number(closeCode)) {
      case close.roomUnknown:
        return 'Nothing answers at that link. Ask the host for a fresh link and retry.';
      case close.tokenInvalid:
        return 'That link was refused. Paste the whole link again and retry.';
      case close.roomGone:
        return 'The session already ended. Ask the host for a fresh link and retry.';
      case close.hostPresent:
        return 'The session already has its host. Ask the host for a guest link and retry.';
      case close.unsupportedVersion:
        return 'The page and the session disagree. Reload the page and retry.';
      case close.protocolError:
        return 'The join was refused. Check the link and retry.';
      default:
        return "Couldn't reach the session. Check your connection and retry.";
    }
  }
  if (
    /webSocket reported an error|socket closed before it opened|failed to connect|ECONNREFUSED|unreachable|abandoned|did not answer session\.hello/i.test(
      message,
    )
  ) {
    return "Couldn't reach the session. Check your connection and retry.";
  }
  if (/failed to construct .WebSocket|not a valid .*URL|invalid URL/i.test(message)) {
    return 'That invite link can\'t be used. Paste the whole link and retry.';
  }
  if (/WebSocket|session\.hello|UTF-16|the connection closed/i.test(message)) {
    return "Couldn't reach the session. Check your connection and retry.";
  }
  return message;
}

/**
 * Console-only diagnostic for a failure either path met: the server and the raw cause.
 * Never shown in default UI — the card keeps the plain `describeJoinError` copy, and
 * only an explicit `?debug=1` appends the server (see below).
 */
export function joinFailureDetail(error: unknown, base: string): string {
  const raw = error instanceof Error ? error.message : String(error);
  return `server ${base}: ${raw}`;
}

/**
 * What the card shows for a failure, either path's: the plain copy, plus the server
 * only behind `?debug=1` for the owner debugging an unreachable room.
 */
export function describeJoinErrorForDisplay(error: unknown, base: string, debug: boolean): string {
  const plain = describeJoinError(error, base);
  return debug ? `${plain} (server ${base})` : plain;
}
