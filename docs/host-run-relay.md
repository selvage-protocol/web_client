# Host-run relay

A browser tab cannot open a listening socket, so this page cannot run a room's relay. The
host's client does. Start the room in an editor client or through the MCP server on the
machine that owns the folder, and open the invite in this page as a guest. The relay speaks
the same `selvage/2` session layer and emits the same bytes a standalone relay did.

The invite carries the host's reachable address. This page derives the socket endpoint from
the link exactly as it does today.

## Reaching the host over Tailscale

Install Tailscale on the host and on every guest and join the machines to the same tailnet.
Bind the relay listener to `127.0.0.1` and run `tailscale serve <port>` in front of it, with
`<port>` replaced by that listener port. A numeric Serve target proxies to loopback, so a LAN
bind does not work here. Advertise the device's fully qualified tailnet DNS name and Serve's TLS
port in the invite. A guest page dials the `wss://` URL over the
tailnet, so no router port forward and no public address are needed. The listener stays off the
public internet, but it is still reachable by someone else, so it needs the terminator. The
certificate is for the DNS name, not for a numeric `tailscale ip -4` address, and an https page
cannot dial plain `ws://`.

A host on the same LAN as its guests can advertise its LAN address instead. A host with a
public address can advertise that directly, with whatever port forward and firewall rules
it chooses. Either address needs the same terminator and rate limit.

## Tailcat without a tailnet

[Tailcat](https://github.com/tailscale/tailcat) gives the same reachability without a Tailscale
account or control plane. Put the TLS terminator and rate limit in front of the relay and run
`tailcat serve <port>` against that protected port. Tailcat prints a `tc...` address. Send the
guest that address, the protected port, and the complete invite URL the host's client copied.

An invite is one URL. Its `?room=…&token=…` query names the room and carries the join token. The
text after `#` is the fragment: `#k=<room-key>&h=<host-key>`. The client needs both parts. Copy
them exactly. A host invite looks like this with real values in place of the angle brackets:

```
ws://<host-address>:<relay-port>/session?room=<room-id>&token=<token>#k=<room-key>&h=<host-key>
```

The guest runs the forward with the protected port:

```sh
tailcat forward <tc-addr> 18080:8080
```

Then the guest changes only the invite's host and port:

```
ws://127.0.0.1:18080/session?room=<room-id>&token=<token>#k=<room-key>&h=<host-key>
```

Keep `/session`, the full query and the full fragment. Change nothing else. A browser cannot use
a `tc...` address as a hostname, so use Tailscale Serve when the guest is this page. Treat the
tailcat address and the invite as one secret.

The invite is still a secret. It now carries the host's reachable address as well as the
room key and the host public key.

## What this changes

The host must stay online. It already had to: only the host writes the room's text to the
working copy, and clients end a session after the host-away window. When the host process
ends, the relay ends with it.

Nothing on the wire changes. Signatures, counters, roles, holds, awareness and CRDT sync
are peer-side facts and behave exactly as they did with a standalone relay.
