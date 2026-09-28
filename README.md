# web_client

The browser client for the Selvage session protocol, over the engine and the bridge the editor clients
share. A share link opens the page, a guest edits in Monaco and converges with the room, and a Chromium
browser can also start a room here: pick a folder and the folder itself is what the room shares, with
the host's working copy staying the source of truth. Joining is one click, in every browser; hosting
from the page needs the File System Access API, so it is Chrome and Edge and not Firefox or Safari, and
a page can only host where the server that serves it also answers `/meta`.

## Status

Joining is one click in every browser, and hosting from the page works in Chrome and Edge, where the
page's own origin answers `/meta`. The page image is published on `ghcr.io`, the checks rebuild the
committed bundle and compare it with the commit's copy byte for byte, and the proofs drive the page's
own code against a real `selvaged`.

## Running it

You need Node and a `selvaged` the page can reach. The suite runs its TypeScript test files directly
under `node --test`, which needs Node 22.18 or newer.

```sh
npm ci        # install exactly what package-lock.json pins
npm run build # write dist/
npm run serve # serve dist/ at http://localhost:8081/
```

When you change a dependency, `npm install --no-audit --no-fund` writes the lockfile. `npm run serve`
is `python3 -m http.server 8081 --directory dist`. That port is the development server's alone, chosen
to avoid `selvaged`'s default 8080; it is not the deployed page's port. The image listens on 8080 and
`compose.yaml` publishes it on 80 (see [Serving the page](docs/serving-the-page.md)).

The tests, and what each one covers ([Checks](docs/checks.md)):

```sh
npm run typecheck   # tsc --noEmit over src/
npm test            # the whole suite; no server needed
npm run test:ci     # the suite CI runs: every file, see below
npm run check:types # Content-Type of every dist/ file, against a live page
scripts/ci-local.sh checks   # what .github/workflows/ci.yml runs, in one command
```

`test:ci` is `scripts/test-ci.mjs`, the same suite with no exclusions. `check:types` and the proofs
need something live, a deployed page and a `selvaged` respectively, so they run locally.

## More

- [Where the server comes from](docs/where-the-server-comes-from.md): the invite's origin, and how a
  page reads its server from it
- [Serving the page](docs/serving-the-page.md): the one-origin shape, the page-only image, the relay
- [Join a room](docs/join-a-room.md): the page-link shape, the copy-invite commands, the join card
- [Hosting from the page](docs/hosting-from-the-page.md): the folder picker, the stale-file guard
- [What the page does](docs/what-the-page-does.md): the card, the session bar, follow, the notices
  column
- [Sessions on the wire](docs/sessions-on-the-wire.md): what this page speaks of `selvage/2`, and what
  it does not carry
- [What is in the tree](docs/source-tree.md): the vendored engine and bridge, the page's own modules
- [The build](docs/the-build.md): what `npm run build` writes, splits and refuses
- [Languages and peer markers](docs/languages-and-peer-markers.md): the mode list, and how a peer is
  drawn
- [Theme and identity](docs/theme-and-identity.md): the Mocha theme, and the mark's levels and rasters
- [Checks](docs/checks.md): what each command in the suite covers
- [CI](docs/ci.md): the four workflows, and what each one proves
- [Proofs](docs/proofs.md): the five `prove*` scripts, and the layer none of them covers
- [What the page does not do](docs/what-the-page-does-not-do.md): the non-goals, and where
  `BROWSER_NOTES.md` went

## Licence

`MIT OR Apache-2.0`, in `LICENSE-MIT` and `LICENSE-APACHE`.
