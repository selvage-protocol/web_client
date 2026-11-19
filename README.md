# web_client

The browser client for the Selvage session protocol, over the engine and the bridge the editor
clients share. A share link opens the page, a guest edits in Monaco and converges with the room, and
the host's own client runs the relay, so this page joins the rooms an editor client or the MCP
server hosts: a browser tab cannot open a listening socket. A guest edits in Monaco and converges
with the room, and the folder itself is what the room shares, with the host's working copy staying
the source of truth.

## Get it working

You need Node 22.18 or newer, and a running `selvaged` server the page can reach.

```sh
npm ci        # install exactly what package-lock.json pins
npm run build # write dist/
npm run serve # serve dist/ at http://localhost:8081/
```

Open `http://localhost:8081/`, paste an invite link, type a name and join. With no link the card
asks for one: a room is started in the host's own client, and this page cannot start one.

`npm run serve` is `python3 -m http.server 8081 --directory dist`. That port is the development
server's alone, chosen to avoid `selvaged`'s default 8080; it is not the deployed page's port. The
image listens on 8080 and `compose.yaml` publishes it on 80 — see
[Serving the page](docs/serving-the-page.md).

When you change a dependency, `npm install --no-audit --no-fund` writes the lockfile.

The checks a commit has to be green on run the same way: `npm run typecheck` reads the page's
TypeScript, and `npm run test:ci` is the suite CI gates on — `node --test` over the
`test/*.test.ts` files. The plain `npm test` hands `node --test` the directory instead, so run
`test:ci` when what you want is what CI runs.

The [public contract workflow](.github/workflows/public-contracts.yml) compares this candidate's
engine, bridge, CRDT pins, and release guard with their public canonical sources. It records the
exact Git revisions. The checker code is pinned independently of the canonical specification and
VS Code data, which follow public `main` and are resolved once per run. Its scheduled/manual
integration job builds a fresh public server, requires
the sibling site's mark comparison, and runs the live adapter and rendered-page proofs on loopback.
These are automated tests, not evidence of human acceptance. Reproduce the live proofs with:

```sh
SELVAGE_SELVAGED=/absolute/path/to/selvaged SELVAGE_CHROMIUM=/absolute/path/to/chromium \
  scripts/ci-local.sh integration
```

Run `npm ci` and `npm run build` first. Evidence is written to `.tmp/live-proofs/`. Before a
repeat run, confirm the prior run has ended and rename that directory to a new, unused archive
name under `.tmp/` (for example, `live-proofs-20261101T120000Z`). Retain the archive; do not delete
or overwrite earlier evidence. The harness refuses an existing evidence directory rather than
mixing runs. Missing tools, failed readiness, timeouts, and cleanup errors other than an already
removed browser profile fail the job. Catchable termination ends the owned process groups, records
the interruption with `completed: false`, and exits nonzero. Copy comparisons use the specification's public
[workspace checker](https://github.com/selvage-protocol/specification/blob/main/docs/workspace-contracts.md),
which also has an explicit-revision local invocation. Publish canonical updates before synchronized
consumers, following its
[publication order](https://github.com/selvage-protocol/specification/blob/main/docs/workspace-contracts.md#publication-order);
a workflow file alone does not establish that the replacement public jobs ran.

## Settings and identity

There is no account: the name typed on the card is all the room knows a person by, and the page keeps
it in the browser so the next card is prefilled. The file panel's width is remembered the same way.
Nothing else is written down: a room's text lives in memory and ends when its host leaves.

## More

- [Where the server comes from](docs/where-the-server-comes-from.md): how the page reads its server
  from the link
- [Serving the page](docs/serving-the-page.md): the one-origin shape, the page-only image, and the
  relay `SELVAGE_SERVER` gives it
- [Join a room](docs/join-a-room.md): the page-link shape, the copy-invite commands, and the join
  card
- [Hosting from the page](docs/hosting-from-the-page.md): why the card offers no start action, and
  where the relay runs instead
- [What the page does](docs/what-the-page-does.md): the card, the session bar, follow, and the
  notices column
- [Host-run relay](docs/host-run-relay.md): why a page joins a host-run relay, and how the host
  reaches guests over Tailscale
- [Languages and peer markers](docs/languages-and-peer-markers.md): the mode list, and how a peer is
  drawn

## Licence

`MIT OR Apache-2.0`, in `LICENSE-MIT` and `LICENSE-APACHE`.
