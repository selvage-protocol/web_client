/**
 * Starting a room from the page: what the card offers, and what it says instead.
 *
 * The relay runs in the host's own client, not on a page's origin: a browser tab cannot open a
 * listening socket, so this page joins the rooms an editor client or the MCP server hosts and
 * cannot start one (`docs/host-run-relay.md`). The card therefore never offers the action, and the
 * sentence that stands where it would have been lives here, apart from the wiring that draws it,
 * so it has one wording.
 */

/** Why the host action is not offered: the relay is the host's, and a tab cannot run it. */
export const HOST_RUNS_IN_A_CLIENT =
  'A browser tab cannot run a room\u2019s relay. Start the room in an editor client or the MCP server on the machine with the folder, then open the invite here.';

/** What the card offers: no action, and the sentence that stands where it would have been. */
export type HostAvailability = { kind: 'explained'; note: string };

export function hostAvailability(): HostAvailability {
  return { kind: 'explained', note: HOST_RUNS_IN_A_CLIENT };
}
