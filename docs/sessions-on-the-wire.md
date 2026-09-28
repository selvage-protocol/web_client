# Sessions on the wire

The protocol has one wire version, `selvage/2`, and this page speaks it. A **join** reads the link it
was handed: `§5.1`'s fragment carries the room key and the host key, so a link with both is a room,
one whose fragment names a single key is refused on the card by the name of the key it is missing
(before a socket, and never joined in the clear instead), and a link with no fragment at all is
refused where the engine reads it. A **host** walks the folder and then mints, because `§7.1` seals
the room state from the listing: a host that minted first would put an empty tree in front of its
first guest. The guest link the bar offers is the wire invite with its fragment.

Nothing chooses a version, and there is no pin: `/meta` is read for one purpose, telling this page's
own origin apart from one that is not a Selvage server (and from one that did not answer, where the
offer stands with a note saying so). The handshake reports the truth either way.

`src/browser/relay.ts` is the page's socket wiring: the vendored `src/engine/relay.ts` and
`src/bridge/peer-engine.ts` do the protocol, and what is left for that file is the browser's own
WebSocket and the `RoomEngine` shape the binding and the session bar ask of. A document arrives when
the guest opens it from the shared tree (the room's documents are the paths somebody holds, `§13.4`),
and a connection the room seats as `viewer` gets its documents with the editor read-only, since
`§13.9` publishes none of a viewer's content.

**What is not carried.** The relay runs no resume (`§9.1`), so there is no `HostStore` and no
returning host; `§13.11`'s per-receiver caps are unimplemented, as they are in the reference client.
Nothing here asks for the `viewer` role: the room state assigns it, and a client that could ask would
be inventing a request the protocol does not have.

The page's own modules are in [What is in the tree](source-tree.md).
