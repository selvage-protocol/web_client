# web_client

The browser client for the Selvage session protocol, over the engine and the bridge the editor
clients share. A share link opens the page, a guest edits in Monaco and converges with the room, and
a Chromium browser can also start a room here: pick a folder and the folder itself is what the room
shares, with the host's working copy staying the source of truth. Joining is one click, in every
browser; hosting from the page needs the File System Access API, so it is Chrome and Edge and not
Firefox or Safari, and a page can only host where the server that serves it also answers `/meta`.

## Status

The page joins a room in any browser, and hosts one in Chrome and Edge, where the page's own origin
answers `/meta`. The image is published on `ghcr.io`, the checks rebuild the committed bundle and
compare it with the commit's copy byte for byte, and the proofs drive the page's own code against a
real `selvaged`.

## Get it working

You need Node and a `selvaged` the page can reach. The suite runs its TypeScript test files directly
under `node --test`, which needs Node 22.18 or newer.

```sh
npm ci        # install exactly what package-lock.json pins
npm run build # write dist/
npm run serve # serve dist/ at http://localhost:8081/
```

When you change a dependency, `npm install --no-audit --no-fund` writes the lockfile.
`npm run serve` is `python3 -m http.server 8081 --directory dist`. That port is the development
server's alone, chosen to avoid `selvaged`'s default 8080; it is not the deployed page's port. The
image listens on 8080 and `compose.yaml` publishes it on 80 (see
[Serving the page](docs/serving-the-page.md)).

## Commands

```sh
npm run typecheck   # tsc --noEmit over src/
npm test            # the whole suite; no server needed
npm run test:ci     # the suite CI runs: every file, see below
npm run check:types # Content-Type of every dist/ file, against a live page
scripts/ci-local.sh checks   # what .github/workflows/ci.yml runs, in one command
```

`typecheck` covers `src/`, which is all `tsconfig.json` includes.

`test` runs the suite with a fake editor standing in for Monaco: the adapter, languages, follow, the
room’s faces and the menu behind them, the empty pane, grants, tree refresh, share links, the join
card, mobile, identity, and the serve-types contract. `identity` reads files outside this
repository: one of its tests compares the marks with the `site` checkout beside this one, and it
reads this repository's own git directory to find that sibling from a worktree as well as from a
checkout. Where there is no sibling — a single-repository CI job — that one test skips with the
reason and the rest of the file runs, icons and clock chunks included. `test:ci`,
`scripts/test-ci.mjs`, is that suite; it names no exclusions, and the checks that need something
live, `check:types` (a deployed page) and the proofs (a `selvaged`), run locally only.

## More

- [Where the server comes from](docs/where-the-server-comes-from.md): how the page reads its server
  from the link
- [Serving the page](docs/serving-the-page.md): the one-origin shape, the page-only image, and the
  relay `SELVAGE_SERVER` gives it
- [Join a room](docs/join-a-room.md): the page-link shape, the copy-invite commands, and the join
  card
- [Hosting from the page](docs/hosting-from-the-page.md): `showDirectoryPicker`, the stale-file
  guard, and what the folder shares
- [What the page does](docs/what-the-page-does.md): the card, the session bar, follow, and the
  notices column
- [Sessions on the wire](docs/sessions-on-the-wire.md): this page's `selvage/2` room, and the
  modules under `src/browser/`
- [What is in the tree](docs/source-tree.md): the vendored engine and bridge, and the modules beside
  them
- [The build](docs/the-build.md): what `npm run build` writes and refuses
- [Languages and peer markers](docs/languages-and-peer-markers.md): the mode list, and how a peer is
  drawn
- [Theme and identity](docs/theme-and-identity.md): the Mocha theme, and the mark the tests pin
- [Checks](docs/checks.md): the live page check, and the workflow guard
- [CI](docs/ci.md): the four workflows, and what each one proves
- [Proofs](docs/proofs.md): the five `prove*` scripts, and the layer none of them covers
- [What the page does not do](docs/what-the-page-does-not-do.md): the non-goals, and where the
  client's own notes went

## Licence

`MIT OR Apache-2.0`, in `LICENSE-MIT` and `LICENSE-APACHE`.
