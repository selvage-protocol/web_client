/**
 * The room-gone terminal state: the plain copy every surface of it shares, and
 * the one rule the tree obeys (the last known listing stays, visibly stale).
 */

/** The resting status once the room is gone: plain, and naming the cause. */
export function roomGoneMessage(reason: string): string {
  const why = reason.trim() === '' ? 'the room is gone' : reason.trim();
  return `The room is closed — ${why}.`;
}

/**
 * The resting status for a terminal disconnect that carried no room-gone
 * reason (reconnection gave up): explicit that the session ended, and that
 * the way back is a fresh join rather than a wait.
 */
export const SESSION_ENDED_MESSAGE =
  'Disconnected — the session ended. Rejoin from a fresh link to continue.';

/** Why the share link no longer copies: the room it names is over. */
export const SHARE_RETIRED_REASON = 'This link is for a closed room — it will not connect again.';

/** Why no roster action presses anymore: there is nobody left to reach. */
export const ROSTER_DISABLED_REASON = 'The room is closed — nobody is here to go to or follow.';

/** The tree's stale marker: the listing is the last one known, frozen. */
export const TREE_STALE_NOTE = 'Showing the last listing from before the room closed — it will not update.';

/** What the tree shows once the room is over: the snapshot, never the live view. */
export function visibleListing(ended: boolean, snapshot: readonly string[], live: readonly string[]): string[] {
  return ended ? [...snapshot] : [...live];
}
