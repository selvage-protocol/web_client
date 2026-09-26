/**
 * The room's seats, and the colour each one wears in this window.
 *
 * `DESIGN.md` §4.3 leaves a peer's colour to the adapter, and the two clients spend that licence
 * differently. The desktop client derives a colour from the peer id, so the same peer reads the same
 * in every window of it — and repeats: the palette is eight entries, so a six-person room can show
 * three faces in one fill, and no seat is reliably the host's. This page colours the *seat* instead,
 * in the design's own order, so a room of thirteen or fewer gives every person a fill of their own.
 *
 * Yellow is left out and reserved: the host's crown is drawn in it, and a face filled with it would
 * swallow the mark.
 */

import type { Role } from '../engine/index.ts';

/** The thirteen accents, in the order the seats take them. */
export const SEAT_PALETTE = [
  '#cba6f7', // mauve
  '#94e2d5', // teal
  '#f5e0dc', // rosewater
  '#f2cdcd', // flamingo
  '#f5c2e7', // pink
  '#f38ba8', // red
  '#eba0ac', // maroon
  '#fab387', // peach
  '#a6e3a1', // green
  '#89dceb', // sky
  '#74c7ec', // sapphire
  '#89b4fa', // blue
  '#b4befe', // lavender
] as const;

/** How many seats the palette fills: a seat past its end keeps the colour the bridge gave it. */
export const SEAT_LIMIT = SEAT_PALETTE.length;

/** One person, as the seat order reads them. */
export interface Seat {
  peerId: string;
  role: Role;
}

/**
 * The colour each seat wears, keyed by peer id.
 *
 * The host's seat leads whatever position it holds in `seats`, and every other seat keeps the order
 * it came in. The page hands over the room as its own bar draws it — your own seat first, then the
 * room's people — so the host is Mauve, the seat beside it Teal, and the faces read down the bar in
 * the same order as the colours.
 *
 * A seat past the palette's end, and a peer the page's list does not name at all, is left out rather
 * than guessed at: whatever draws them then keeps the colour the bridge derived from the peer id.
 */
export function seatColours(seats: readonly Seat[]): Map<string, string> {
  const host = seats.find((seat) => seat.role === 'host');
  const order = host === undefined ? seats : [host, ...seats.filter((seat) => seat !== host)];
  const colours = new Map<string, string>();
  order.slice(0, SEAT_LIMIT).forEach((seat, index) => {
    colours.set(seat.peerId, SEAT_PALETTE[index]);
  });
  return colours;
}
