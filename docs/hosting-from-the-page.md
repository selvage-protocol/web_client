# Hosting from the page

The page does not host a room. A browser tab cannot open a listening socket, so the relay runs in
the host's own client — an editor client, or the MCP server on the machine that holds the folder
(see [Host-run relay](host-run-relay.md)). The card offers one action, the join, and where the
start action would have been it says why:

> A browser tab cannot run a room’s relay. Start the room in an editor client or the MCP server on
> the machine with the folder, then open the invite here.

The invite still names the host's reachable address. This page reads the socket endpoint from the
link exactly as it always has, so a guest joins a host-run room from here with nothing else to know
(see [Where the server comes from](where-the-server-comes-from.md)).

Nothing on the wire changes. Signatures, counters, roles, holds, awareness and CRDT sync are
peer-side facts and behave as they did with a deployed relay. The host's client is what reads the
folder, seals the listing the room's state is drawn from, and writes the settled text back to disk,
and it stays online for as long as the room does.

Two things a page can do are not what a room needs. `showDirectoryPicker` and the File System Access
API let a page read and write a folder the person chose, but no browser API lets a tab listen for a
connection. A room's host is the peer that answers the socket, so the host has to be a process that
can listen.

The page still asks for a name and a link, and a held submit is replayed once the bundle arrives,
whether the link came from the address bar or the paste box. Joining is unchanged.
