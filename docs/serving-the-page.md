# Serving the page

**One origin.** `selvaged --serve-page <dir>` answers the page, `/meta` and `/session` from one
listener: a share link is the page's own origin and nothing else, the `/meta` read is same-origin
and lands, and one terminator in front of the one port is enough for TLS. The page comes from the
directory that flag names, so a deployment that wants this shape mounts a page — this bundle, built
or unpacked — and starts the server with `--serve-page <dir>` over it. The public demo is the other
shape: a front terminates TLS and routes, with the page and the server as containers behind it
(`reference_server/deploy/`). `npm run serve` is the local stand-in for the page half of it: a plain
static server with no session protocol beside it.

**The page-only image.** This repository publishes the bundle on its own, so the page can live on an
origin of its own. Two shapes, and [`compose.yaml`](../compose.yaml) documents both:

- **Page only.** The service answers the page and nothing else, and a share link is a whole wire
  invite (`ws://host:8080/session?room=…&token=…`) for a room whose server serves no page of its own.
  This is the default: `docker compose up --build --detach` builds the page from this checkout and
  answers on the standard web port, `http://localhost/`.
- **Origin relay.** Set `SELVAGE_SERVER` to an `http://`, `https://` or bare `host:port` base and the
  image proxies `/session` and `/meta` there, so the page's own origin is the room's server, a share
  link is a page link (`/?room=…&token=…`), and the advisory `/meta` read lands same-origin. With no
  `SELVAGE_SERVER` the relay is absent entirely and the two paths answer 404, so the image is exactly
  what it was before. `compose.yaml` carries a two-container example: the page publishing
  `127.0.0.1:8080:8080` and relaying to a `selvaged` that publishes nothing and is reachable only from
  the page.

**The upstream.** It is read once, when nginx loads its configuration, and its shape is settled
before it goes in: anything that is not a host with an optional port and an optional `http`/`https`
scheme is refused with a sentence saying what is wrong, because the value is substituted into the
configuration and nothing in it is escaped. An `https://` base is dialled with the upstream's name
as SNI and its certificate verified against the base image's own CA bundle, so a certificate no
public CA signs fails the connection. An `http://` base carries
the room token over that hop in cleartext, which is the operator's call: it is the right shape for a
loopback or a private network — the hop between the two containers in `compose.yaml` is one — and an
`https://` base is the one to name wherever the hop is not trusted.

The `Host` a relayed request carries is the upstream's own name and port, exactly as
`SELVAGE_SERVER` names them, and never the page's. A server behind anything that routes by name —
the project's own demo front answers `444` to a name that is not its own — would otherwise refuse
every request carrying the origin the page happens to be served under, so the relay sends what its
`proxy_pass` names rather than the page's name. A bare `selvaged` reads no `Host` and notices
neither choice.

That one resolution is also why a name that does not resolve is fatal: a misspelling, or a page
started before its server, exits the container with `host not found in upstream` instead of serving
a page whose every join 502s. The other failure is quieter, and it is why the compose example
carries `restart: true`: a server recreated at a new address leaves the page dialling the address it
resolved, since nginx does not resolve again, so `/meta` and `/session` answer 502 until the page
container restarts. That 502 is below the `crit` level this image logs at, and its access log is
off, so nothing about it reaches the container's transcript — an invite URL carries the room token,
and `PROTOCOL.md` §12 is why no request line is kept.

**A route on one origin, not a front.** `PROTOCOL.md` §12 requires a deployment reachable by anyone
else to put a terminator or a proxy in front that supplies a connection cap, an idle deadline and a
rate limit. The relay supplies none of the three: nothing bounds how many sockets one source may
hold at `/session`, nothing but the server's own ping and the 300 s read timeout ends an idle one,
and nothing rate-limits the handshake. What it supplies is the origin — one address for the page,
`/meta` and `/session` — and a deployment on the public internet still wants the shape
`reference_server/deploy/proxy/` documents, whose front is where those three live.

A relayed response carries the server block's own headers, a location that adds none inheriting
them: a relayed `/meta` is `no-cache` because of the name it is asked for, and it carries
`no-referrer`, `nosniff` and the page's policy. `selvaged` sends none of those four on its own
`/meta`; one origin with one policy is what this image is for.

The service publishes `80:8080` by default: the host answers on port 80 while the container keeps
listening on 8080, which it must, because `nginx-unprivileged` runs as uid 101 with every capability
dropped and cannot bind a port below 1024. `compose.yaml` carries the same hardening as
`reference_server`'s (`read_only`, `cap_drop: [ALL]`, `no-new-privileges`, no volumes). To evaluate
on this machine only, rebind the published port to `127.0.0.1:8080:8080` there.

**The image is on the registry.** The page image is `ghcr.io/selvage-protocol/selvage-web`, published
with the tags `<version>-<sha>`, `<version>` and `latest` for every release. `docker compose pull`
fetches the published page; the compose file builds from this checkout when the registry name is
absent. The hand run is the same page, and
`--env SELVAGE_SERVER=<base>` makes it the room's server as well:

```sh
docker run --rm --read-only --cap-drop ALL --security-opt no-new-privileges:true \
  --publish 80:8080 ghcr.io/selvage-protocol/selvage-web:latest
```

On its own it serves the page and no endpoint: `/meta` and `/session` answer 404 with the page's own
`404.html`.

The image carries this repository's committed `dist/`. The runtime is `nginx-unprivileged` as
uid 101 on port 8080, and it answers the media types, the cache policy and the content-security
policy that `selvaged`'s own page handler decides for the one-origin shape: a hashed chunk pinned
for a year, everything else revalidating, `no-referrer`, `nosniff`. It holds nothing writable:
nginx's pid file and temp directories are the runtime's own `/dev/shm`, and the relay's location
blocks are written there at startup too, so the flags above run it with no mount at all.

**What running without an upstream costs.** The page is then an origin of its own, a second origin
beside every server it fronts. The WebSocket is not CORS-bound, so the page dials whatever server a
pasted wire invite names and the handshake is where compatibility is enforced. The `/meta` read is a
cross-origin fetch, though, and this project emits no `access-control-*` headers, so it is skipped,
which costs the recognition of the origin as a Selvage server, the reconnect grace it carries, and
the ability to host from this page at all, since the page hosts only where its own origin answers
`/meta`. Setting `SELVAGE_SERVER` is what removes that: the page's origin is then the room's server
and the read lands. An invite is a page link, so a guest handed one is sent to the room's own page,
wherever it is served from; without a relay this image is for fronting servers that cannot serve a
page themselves, handed on as `ws://` invites. One origin is the default.
