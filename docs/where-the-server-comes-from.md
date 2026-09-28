# Where the server comes from

**The link is the server.** An invite is `https://<host>/?room=…&token=…`: the page the room's own
server serves, carrying the room and its token, and nothing else. The server is read from that
link's own origin and from nowhere else, so a room cannot be linked at a page that dials a
different server. `src/browser/servers.ts` holds the two halves of the derivation: `pageOriginOf`
(the server as the page a browser opens, `wss://` as `https://` and `ws://` as `http://`) and
`serverBaseOf` (the page read back as the server). The same rule is in both editor clients.

The page derives the server from its own address for a link it was opened with, and from the link's
address for one pasted into a bare open. So a page served from one origin, given an invite naming
another, talks to the room's server and never to its own. With no link there is no server: the card
asks for one, and a page served from no server at all (a `file://` open) is told so. An https page
must never emit a `ws://` or `http://` subrequest, so a link's `ws://` base is dialled as `wss://`
there (`schemeMatchBase`). The other shape the page takes is a whole wire invite
(`ws://host:8080/session?room=…&token=…`), for a room whose server serves no page: its base comes
from whoever sent the link, so it is bounded before it is used, to an absolute `ws`, `wss`, `http`
or `https` URL with a host and no credentials, fragment or query (`linkServerBase`). The guest's own
browser is what reads that server's `/meta` and opens its socket.

If a link names another origin than the page's own, that server's `/meta` has to allow the page's
origin through CORS for the browser to read it. Nothing in this project emits `access-control-*`, so
such a join skips the advisory `/meta` read (the server's identity, its capabilities and the
reconnect grace it carries) while the WebSocket handshake still proceeds and enforces compatibility.
`selvaged --serve-page` is one origin, where the page, `/meta` and `/session` share it and the read
lands; the page-only image with `SELVAGE_SERVER` set is the other, relaying the two endpoints to a
server that is not on the page's origin (see [Serving the page](serving-the-page.md)).
