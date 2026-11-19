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

[Tailcat](https://github.com/tailscale/tailcat) carries the relay over WireGuard through DERP and
NAT traversal. Put a TLS terminator in front of the relay. These steps are for an editor or agent
guest. A browser guest needs Tailscale Serve.

Host:

1. Start the room in the host client. Copy the invite URL.
2. Read the port from the invite. In `wss://relay.example.com:8080/session?…` it is `8080`.
3. Run `tailcat serve 8080` with that port.
4. Send the guest the printed `tc...` address, the port `8080`, the certificate hostname
   `relay.example.com`, and the full invite URL.

The invite ends with a fragment such as `#k=<room-key>&h=<host-key>`. It is part of the URL. The
guest must copy it unchanged.

Guest:

1. Add `127.0.0.1 relay.example.com` to the local hosts file.
2. Run `tailcat forward <tc-addr> 18080:8080`.
3. Insert `wss://relay.example.com:18080` in place of the invite's scheme, host and port. Keep
   `/session`, the `?room=…&token=…` query and the `#k=…&h=…` fragment.
4. Open the new URL in the client:

```
wss://relay.example.com:18080/session?room=<room-id>&token=<token>#k=<room-key>&h=<host-key>
```

Treat the `tc...` address and the invite as one secret. Rate-limit the relay. Restrict inbound
access to the host with a firewall.

The invite is still a secret. It now carries the host's reachable address as well as the
room key and the host public key.

## What this changes

The host must stay online. It already had to: only the host writes the room's text to the
working copy, and clients end a session after the host-away window. When the host process
ends, the relay ends with it.

Nothing on the wire changes. Signatures, counters, roles, holds, awareness and CRDT sync
are peer-side facts and behave exactly as they did with a standalone relay.
