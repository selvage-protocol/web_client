# web_client

The browser client for the Selvage session protocol. A share link opens the page, a
guest edits in Monaco and converges with the room, and a Chromium browser can also start
a room here: pick a folder and the folder itself is what the room shares, with the host's
working copy staying the source of truth. Joining is one click, in every browser; hosting
from the page needs the File System Access API, so it is Chrome and Edge and not Firefox
or Safari, and a page can only host where the server that serves it also answers
`/meta`.

## Get it working

You need Node and a `selvaged` the page can reach. The suite runs its TypeScript test
files directly under `node --test`, which needs Node 22.18 or newer.

```sh
npm ci        # install exactly what package-lock.json pins
npm run build # write dist/
npm run serve # serve dist/ at http://localhost:8081/
```

When you change a dependency, `npm install --no-audit --no-fund` writes the lockfile.
`npm run serve` is `python3 -m http.server 8081 --directory dist`. That port is the
development server's alone, chosen to avoid `selvaged`'s default 8080; it is not the
deployed page's port. The image listens on 8080 and `compose.yaml` publishes it on 80
(see Serving the page).

### Where the server comes from

**The link is the server.** An invite is `https://<host>/?room=…&token=…`: the page the
room's own server serves, carrying the room and its token, and nothing else. The server
is read from that link's own origin and from nowhere else, so a room cannot be linked at
a page that dials a different server. `src/browser/servers.ts` holds the two halves of
the derivation — `pageOriginOf` (the server as the page a browser opens: `wss://` as
`https://`, `ws://` as `http://`) and `serverBaseOf` (the page read back as the server) —
and the same rule is in both editor clients.

The page derives the server from its own address for a link it was opened with, and from
the link's address for one pasted into a bare open. So a page served from one origin,
given an invite naming another, talks to the room's server and never to its own. With no
link there is no server: the card asks for one, and a page served from no server at all
(a `file://` open) is told so. An https page must never
emit a `ws://` or `http://` subrequest, so a link's `ws://` base is dialled as `wss://`
there (`schemeMatchBase`). The other shape the page takes is a whole wire invite
(`ws://host:8080/session?room=…&token=…`), for a room whose server serves no page: its
base comes from whoever sent the link, so it is bounded before it is used: an absolute
`ws`, `wss`, `http` or `https` URL with a host, and no credentials, fragment or query
(`linkServerBase`). The guest's own browser is what reads that server's `/meta` and opens
its socket.

If a link names another origin than the page's own, that server's `/meta` has to allow the
page's origin through CORS for the browser to read it. Nothing in this project emits
`access-control-*`, so such a join skips the advisory `/meta` read (the server's identity,
its capabilities and the reconnect grace it carries) while the WebSocket handshake still
proceeds and enforces compatibility. `selvaged --serve-page` is one origin, where the page, `/meta` and
`/session` share it and the read lands.

### Serving the page

**One origin.** `selvaged --serve-page <dir>` answers the page, `/meta` and `/session`
from one listener, which is what the demo and the published server image run:
`reference_server` bakes this bundle into `/page` and starts with `--serve-page /page`.
A share link is then the page's own origin and nothing else, the `/meta` read is
same-origin and lands, and one terminator in front of the one port is enough for TLS.
`npm run serve` is the local stand-in for the page half of it: a plain static server
with no session protocol beside it.

**The page-only image.** This repository publishes the bundle on its own, so the page
can live on an origin of its own, in front of several `selvaged` instances. The
preferred way to run it is `compose.yaml`, which builds the page from this checkout
and answers on the standard web port:

```sh
docker compose up --build --detach   # http://localhost/
```

The service publishes `80:8080`: the host answers on port 80 while the container keeps
listening on 8080, which it must, because `nginx-unprivileged` runs as uid 101 with every
capability dropped and cannot bind a port below 1024. `compose.yaml` carries the same
hardening as `reference_server`'s (`read_only`, `cap_drop: [ALL]`, `no-new-privileges`,
no volumes) and `scripts/container-smoke.sh` asserts it. To evaluate on this machine
only, rebind the published port to `127.0.0.1:8080:8080` there.

**The image is on the registry.** `v0.1.0` published
`ghcr.io/selvage-protocol/selvage-web`, and every `v*` tag republishes it
(`.github/workflows/image.yml`) with the tags `<version>-<sha>`, `<version>` and
`latest`; `0.4.2` is the current release. `docker compose pull` fetches the published
page; the compose file builds
from this checkout when the registry name is absent. The hand run is the same page:

```sh
docker run --rm --read-only --cap-drop ALL --security-opt no-new-privileges:true \
  --publish 80:8080 ghcr.io/selvage-protocol/selvage-web:0.4.2
```

The image carries this repository's committed `dist/` (the checks job proves a build
of `src/` reproduces it, so the image cannot fall behind its source). The runtime is
`nginx-unprivileged` as uid 101 on port 8080,
and it answers the media types, the cache policy and the content-security policy that
`selvaged`'s own page handler decides for the one-origin shape: a hashed chunk pinned
for a year, everything else revalidating, `no-referrer`, `nosniff`. It holds nothing
writable: nginx's pid file and temp directories are the runtime's own `/dev/shm`, so
the flags above run it with no mount at all, which `scripts/container-smoke.sh` reads
back off the daemon's record of the container.

**What the second shape costs.** The page becomes a second origin. The WebSocket is not
CORS-bound, so the page dials whatever server a pasted wire invite names and the handshake
is where compatibility is enforced. The `/meta` read is a cross-origin fetch, though, and
this project emits no `access-control-*` headers, so it is skipped, which costs the
recognition of the origin as a Selvage server and the reconnect grace it carries, and
nothing else. An invite is a page link,
though, so a guest handed one is sent to the room's own page, wherever it is served from;
this image is for fronting servers that cannot serve a page themselves, handed on as
`ws://` invites. One origin is the default.

### Join a room

The page's own `/` takes the room and its token as query parameters:

```text
http://host/?room=<room>&token=<token>
```

A host produces that link with the editor clients' copy-invite command
(`Selvage: Copy the invite link` in VS Code, `:SelvageCopyInvite` in Neovim), which
builds it from the room's own server. A `ws://host:8080/session?room=…&token=…` invite is
the other shape the page takes, pasted into the box a bare open shows, for a room whose
server serves no page.

Either way the card carries a heading, one question (the name other participants see) and
one confirm, over a blurred preview of the editor. Type the name and press Join or Enter,
and the first shared file opens focused. A pasted page link lands in the address bar, so a
reload rejoins from it.

### Start a room from the page

A page with no invite can start one: type the name, press **Choose a folder to share…**,
and the browser asks for a folder. The folder is the room's working copy — the page walks it
for the listing a guest's tree draws, reads a file out when a guest asks for it, and
writes the text the room settles on back through it. Nothing is uploaded, and no file
outside the folder the person picked can be named through the handle. The invite link is
then the one the session bar carries, and it is the same link an editor host would have
produced: whoever opens it joins as a guest and edits the folder with them.

Four things that shape it:

- **Chromium only, and only where the page's origin is the server.** `showDirectoryPicker`
  is Chrome and Edge; Firefox and Safari get a sentence where the button would be, and
  joining still works there. A page that is not served by a Selvage server (the page-only
  image in front of other servers, a static dev server) says so instead of offering a
  control that could only refuse (see *Sessions on the wire*).
- **Read and write.** The picker asks for both, because the room's settled text has to
  reach the folder or the room is a scratch pad rather than a working copy.
- **The stale-file guard.** The page holds a replica and a directory handle and cannot see
  the file change under it, so before writing it compares the file's `lastModified` with
  the stamp its last read or write saw. If something else wrote the file — a formatter, a
  build, a `git checkout`, another editor — the write is **refused** and reported instead
  of overwriting it, which is what VS Code and Neovim do on save and what a page has no
  watcher to do any other way. A path the page never read is refused the same way.
- **The tab is the host, and a reload ends the room.** A host's invite link is not written
  into the address bar: reloading would rejoin its own room as a guest with no folder
  while the room's grace ran out underneath it. The card warns before the click, and the
  load after a reload says the room is over. Reclaiming inside the grace is not built.

**Download** takes the open document out of the room and onto the person's disk — for a
guest who has just edited a file and cannot keep it, and for a host whose folder refused
the write. It is the control beside the share bar, and it is off while nothing is open.

### Checks

```sh
npm run typecheck   # tsc --noEmit over src/
npm test            # the whole suite; no server needed
npm run test:ci     # the suite CI runs: every file, see below
npm run check:types # Content-Type of every dist/ file, against a live page
scripts/ci-local.sh checks   # what .github/workflows/ci.yml runs, in one command
```

`typecheck` covers `src/`, which is all `tsconfig.json` includes.

`test` runs the suite with a fake editor standing in for Monaco: the adapter, languages,
follow, roster, the empty pane, grants, tree refresh, share links, the join card, mobile,
identity, and the serve-types contract. `identity` reads files outside this repository:
one of its tests compares the marks with the `site` checkout beside this one, and it reads
this repository's own git directory to find that sibling from a worktree as well as from a
checkout. Where there is no sibling — a single-repository CI job — that one test skips
with the reason and the rest of the file runs, icons and clock chunks included. `test:ci`,
`scripts/test-ci.mjs`, is that suite; it names no exclusions, and the checks that need
something live, `check:types` (a deployed page) and the proofs (a `selvaged`), run locally
only.

`check:types` is live, and tests a deployment rather than the local static server. It
defaults to the demo page and takes another base as an argument,
`npm run check:types -- http://127.0.0.1:8081`; a plain static server answers the `.map`
files as `application/octet-stream` and fails that check, which is about the serving
layer the page is deployed behind. Against the page-only image the same script is what
`scripts/check-page.sh` runs, together with the served bytes and headers.

### CI

The repository's two workflows. `ci.yml` is the node checks, on a pull request:
`npm ci`, `typecheck`, `build`, `scripts/check-dist.sh` and `test:ci`. It runs in
`node:22-trixie-slim`, because the build shells out to ImageMagick 7's `magick` and
the GitHub runner image ships ImageMagick 6.

`scripts/check-dist.sh` is the build reproducing the committed `dist/`: every file the
bundler writes, byte for byte, and the six sized icons at their six sizes. The icons
are the one part an ImageMagick version decides, so `test/identity.test.ts` pins their
bytes, on a machine that has the `site` checkout beside this one.

`image.yml` is the image. On a pull request that changes what the image is built from,
it runs `docker build` and a hardened `docker run` with the assertions above
(`scripts/container-smoke.sh`), plus a rehearsal of the publish path against a registry
on the runner's own loopback. On a `v*` tag it publishes the three tags and reads the
version and the page back off them.

The container steps need a Docker daemon, so `scripts/ci-local.sh container` and both
smoke scripts are CI runs on a machine without one.

## The build

`npm run build` wipes `dist/` and rebuilds it wholesale, because chunk names carry
content hashes and anything else would strand orphaned bundles. The output is minified
and code-split: the page loads the editor core and the language service up front,
tokenizers load when a document of that language opens, and the two workers are fetched
only when a mode needs them. The build refuses a bundle containing the `ws` package and
refuses one that lacks `monaco-editor`. It copies the shell, renders the sized icons and
writes `dist/site.webmanifest`.

## What the page does

The pre-join card is inline HTML, so it paints before the bundle arrives, and its own
inline script has already decided which shape it is (a bare open shows the paste box, a
link open does not) and prefilled the remembered name, so the first painted frame is the
final one. A name typed during a slow load survives, because the prefill only fills an
untouched field. The editor stack loads on join and not before.

After joining, the session bar shows the share link with the page's own origin dropped
and the room id and the token shortened middle-first, masked until hovered or focused
and fading in rather than snapping, sized to what it shows so the whole thing reads at a
glance. The whole bar copies it, focus plus Enter included, with the full link as its
title and the clipboard bytes. A submit that lands before the page finishes loading
never fails: it queues until loaded and joins exactly once, the button reading
`Joining…` throughout. The last joined name is remembered for prefill in the browser
only.

On a device with a pointer the first shared file opens focused, so typing starts at
once. A phone focuses it on the first tap instead, so the soft keyboard does not stand
over a room nobody has seen, and starts with the tree and roster behind a
`Files and people` control. The People roster leads with your own name — one swatch, one
quiet `(you)`, one Rename — and lists who else is here, never path text: a `Go to` where
the peer is in a file and `not in a file yet` where it is not, and a `Follow` toggle that
reads `Following ✓` pressed and stops the follow when it is pressed. A go-to the room
cannot answer — the peer closed the file, or its caret does not resolve here — says so
under that row for four seconds. The tree lists what the room shares with a peer badge on
whose file is whose. An action that refuses says so beside its own control, or in the
alert where it has none.

Following shows a segment in the file strip, in the followed peer's colour, with the stop
control on it, and ends when you type, navigate (open a file from the tree or go to
someone), stop it, or the peer leaves. When the host's socket drops, the session note
names the grace window and counts it down to the room's own deadline; when the host
returns it says so for a few seconds and then clears. When the room ends, because the host does not return before the
grace expires, the page leaves the session: the socket closes, the binding and the editor
are dropped, the chrome comes down, and the card returns over the blurred preview carrying
`The room is gone (host did not return). Nothing in the room was saved. Paste a fresh
invite link to join another session.` A page has no disk to leave a copy on. Nothing of
the dead room stays on screen, the name stays typed, and pasting a fresh link joins the
next room from there. A guest never claims host and never rebuilds a room on its own: the
only mint is the one behind the folder picker, and a test pins that the guest path never
asks for the host role.

A page-hosted room has one more thing to say. The room lives in its tab, so the card warns
before the click, and a reload says `This tab was hosting a room, and it is not any
more…` rather than offering a card that looks like the last one.

## What is in the tree

`src/engine/` and `src/bridge/` are copies of `vscode_client/src/{engine,bridge}`, never
edited here. Refresh them with `npm run sync-engine`, which records the upstream SHA in
`scripts/sync-engine.sh`.

The copy carries `selvage/2`'s session layer with the rest of the engine: `src/engine/sealed.ts` is
`CANONICAL.md` §6.1's bytes, `src/engine/peer.ts` is `PROTOCOL.md` §13, `src/engine/host.ts` is
§7.1's producer half — the room state the host key seals, and one rule for each state that goes out
— and `src/engine/crypto.ts` is the crypto seam a caller supplies — HKDF-SHA256, SHA-256,
AES-256-GCM and Ed25519 — which this page implements with WebCrypto, the engine's own default. The
seam is asynchronous for exactly this client's sake, since WebCrypto has no synchronous form.

### Sessions on the wire

The protocol has one wire version, `selvage/2`, and this page speaks it. A **join** reads the
link it was handed: `§5.1`'s fragment carries the room key and the host key, so a link with both
is a room, one whose fragment names a single key is refused on the card by the name of the key it
is missing — before a socket, and never joined in the clear instead — and a link with no fragment
at all is refused where the engine reads it. A **host** walks the folder and then mints, because
`§7.1` seals the room state from the listing: a host that minted first would put an empty tree in
front of its first guest. The guest link the bar offers is the wire invite with its fragment.

Nothing chooses a version, and there is no pin: `/meta` is read for one purpose, telling this
page's own origin apart from one that is not a Selvage server (and from one that did not answer,
where the offer stands with a note saying so). The handshake reports the truth either way.

`src/browser/relay.ts` is the page's socket wiring: the vendored `src/engine/relay.ts` and
`src/bridge/peer-engine.ts` do the protocol, and what is left for that file is the browser's own
WebSocket and the `RoomEngine` shape the binding and the session bar ask of. A document arrives
when the guest opens it from the shared tree — the room's documents are the paths somebody holds
(`§13.4`) — and a connection the room seats as `viewer` gets its documents with the editor
read-only, since `§13.9` publishes none of a viewer's content.

**What is not carried.** The relay runs no resume (`§9.1`), so there is no `HostStore` and no
returning host; `§13.11`'s per-receiver caps are unimplemented, as they are in the reference client.
Nothing here asks for the `viewer` role: the room state assigns it, and a client that could ask
would be inventing a request the protocol does not have.

The page's own modules:

- `src/browser/main.ts`: the page. Display name, invite, the editable document, the
  People roster with go-to and a follow toggle, the presence-badged grant tree, the file
  strip above the editor (the open file's state, the follow's own stop, the save control),
  the panel disclosure a phone gets, and the page-origin share link whose whole bar
  copies.
- `src/browser/transport.ts`: the engine's socket from the browser's own WebSocket. The
  `ws` package is a dev-only dependency for the Node proof and never enters the bundle;
  the build refuses a bundle that mentions it.
- `src/browser/relay.ts`: the page's `selvage/2` room — the vendored relay with the page's own
  WebSocket, and the `RoomEngine` shape the binding and the session bar drive.
- `src/browser/node-shim.ts`: the one Node global the synced engine expects,
  `Buffer.byteLength`, defined only when absent.
- `src/browser/monaco.ts`: the Monaco runtime, the editor core plus the languages the
  page backs, each with its tokenizer and, for TypeScript and JavaScript, the language
  worker that makes the mode understanding rather than colouring. JSON, TOML and Nix are
  this repository's own small Monarch sets, because Monaco 0.52.2 ships none of the
  three. Every tokenizer loads lazily, when a document of that language opens; anything
  unbacked is `plaintext` (see `languages.ts`).
- `src/browser/workers/`: the two worker entries the backed modes need, the editor
  fallback and the TypeScript/JavaScript language worker.
- `src/browser/editor.ts`: the Monaco adapter. Remote text in, local edits and the
  selection out, peer cursors as decorations (glyph-margin initials badges, caret bars,
  selection fills, `label · role` hovers), plus the grant tree, jump-to-participant and
  follow. A peer's whole line is never marked. The hover's label comes from the room, so
  it is escaped to literal markdown (`literalMarkdown`): a name paints as its characters
  and can carry no link, image or code span into a guest's browser.
- `src/browser/icons.ts`: the inline-SVG set and the per-type tree icon, a solid page in
  the type's colour with a short label so it reads in a tree row.
- `src/browser/roster.ts`: the People roster as a testable render, the own name first as
  a full row (swatch, quiet `you`, the one verb the row can act on), one row per peer with
  no path text, a `Go to` only where there is somewhere to go, a `Follow` toggle that
  stops on its second press, and a refused go-to's sentence on the row that asked for it.
- `src/browser/empty-editor.ts`: the editor pane with no document in front of it — a host
  whose folder is empty, a host with files to pick from, a guest whose host has shared
  nothing, a guest with files to pick from — each naming the next act and putting its
  control where the step is, with the peer that is already in a file offered beside them.
  On a phone the act is `Browse files`, since the panel starts shut and nothing else opens
  it.
- `src/browser/share-box.ts`: the share bar as one copy control. Click anywhere, or
  focus and press Enter, to copy; an overlay inside the bar names the `Link copied`
  confirmation briefly and hides, and the readout never leaves, so no layout shifts.
- `src/browser/presence.ts`: initials, one badge per line, the badge CSS.
- `src/browser/mobile.ts`: what a touch-only browser is given, the two media queries the
  phone layout keys on, the editor options a phone needs (no minimap, wrapped lines,
  16 px), and how tall the app is when a soft keyboard shrinks the visual viewport.
- `src/browser/notice.ts`: the two message homes the page keeps: the session note in the
  chrome (the host-leave warning while the grace runs, counting its window down to the
  room's deadline, the dropped socket's line while the engine re-dials, and the host's
  return for a few seconds), and the failure alert — an action that refused with no control
  to sit beside, and an error the room reports about the session — plus the line a tap
  reveals where a `title` would have shown a pointer. The countdown's number is an element of its own with the live region off, so
  the sentence is announced once and the count never is; the alert and the tap line are
  one mechanism, standing a few seconds and leaving on their own.
- `src/browser/ended.ts`: the end of a session, the sentences for it (the desktop clients'
  `The room is gone (<reason>).` plus what a page cannot keep) and the one next step, and
  `dropSession`, the order in which the page leaves a dead room.
- `src/browser/share.ts`: the guest link shape — the page the room's own server serves,
  carrying `?room=&token=` and nothing else — read back the same way when pasted. The bar
  shows it with the page's own origin dropped and the host, the room id and the token
  shortened middle-first, sized to what it shows.

`public/` is the page shell, which carries the site's mark as its own pixels, a 104 px
render of `mark-transparent.png` inlined in the shell so no frame waits on an image.
`node scripts/inline-mark.mjs` prints a refreshed one, levelled (`MARK_GAMMA`) the way the
site levels the copy the nav bar paints.

`scripts/` holds the proofs (`prove-m1.mjs`, the live M1 proof; `prove-v2.mjs`, the
wire's proof in a real browser; `prove-fb2.mjs`, the
owner-feedback proof; `prove-tls.mjs` and `prove-flow2.mjs`) and the live check
(`check-content-types.mjs`).
`test/` holds the suite.

`Dockerfile`, `.dockerignore` and `packaging/` are the page-only image: nginx's own
configuration, with the media types, the cache policy and the page's policy the
one-origin deployment decides, and the bundle copied from the committed `dist/`. The
scripts CI reads live beside the proofs: `test-ci.mjs` (the suite a single checkout can
run), `release-tags.sh` (the release identity), `check-page.sh` (the served bytes, types
and headers), `container-smoke.sh`, `assert-image-page.sh` and `ci-local.sh`.

## Languages and peer markers

A room path opens in the mode its type maps to (`languages.ts`): Markdown/MDX,
TypeScript/JavaScript, Rust, CSS/SCSS/Less, HTML, XML/SVG, YAML, shell, Python, Go,
C/C++, Java, SQL, Lua, INI, Dockerfile, PowerShell, Ruby, PHP, C#, Kotlin, Swift, Dart,
R, Perl, Clojure, GraphQL, Protobuf, HCL/Terraform, reStructuredText, CoffeeScript,
Batch, and JSON, TOML and Nix. Everything else stays `plaintext`. Each tokenizer is a
`lang-*.js` chunk fetched the first time a document of that language opens.

A peer is drawn as a caret bar, a glyph-margin initials badge, a `label · role` hover, an
overview-ruler tick, and a fill while they hold a selection. The peer's whole line is
never marked; the VS Code client draws the same pair.

## Theme and identity

The page is dark only, in Catppuccin Mocha with a mauve accent, on the landing page's own
tokens, all of it in the shell's inline CSS so the card paints without waiting on a
stylesheet. Monaco runs a `selvage-mocha` theme on a `vs-dark` base in the same colours,
with the comment and line-number tokens stepped one shade lighter, because Mocha's overlay1
is 4.4:1 on the editor ground and under AA for the two dims a reader reads most.

The card and the session bar wear a 104 px render of `public/mark-transparent.png`, the
site's copy byte-identical, inlined in the shell and levelled for the dark ground it lands
on: the same gamma curve the site applies to its own nav mark, because the owner's artwork
is dark enough that the typical ink pixel measured 1.72:1 on this page's card.
`test/identity.test.ts` measures that pixel over the card's own ground and fails a
derivative that goes dark again. The tab is the rasters `npm run build` renders from
`mark-opaque.png` at the sizes the site serves (16, 32, 48, 180) and the two the manifest
names (192, 512). `node scripts/inline-mark.mjs` prints the data URI to paste if the
site's master changes, and the same test holds the two together byte for byte. The mark is
the owner's `svp` monogram in Mocha/mauve.

## Proofs

The proofs drive the page's own code against a real `selvaged`, with a fake editor
standing in for Monaco:

```sh
SELVAGE_BASE=ws://127.0.0.1:8080 npm run prove      # the M1 page stack
SELVAGE_BASE=ws://127.0.0.1:8080 npm run prove:fb2  # the owner-feedback pass
npm run prove:flow2                                 # the flow-review fixes
npm run prove:tls                                   # the same page over TLS
npm run prove:v2                                    # the wire, in a real headless Chromium
```

`SELVAGE_BASE` and `SELVAGE_TLS_BASE` both default to the public demo,
`wss://selvage-demo.dontblameme.dev`, so `prove`, `prove:fb2`, `prove:flow2` and
`prove:tls` run against that instance unless you point them elsewhere. A base names its
scheme: nothing on the page's own path completes a bare domain, because a page reads a
link's base or its own origin and both always carry one.

`prove` mints a room with this checkout's own engine, joins the way the page does with
the default `/meta` check, and walks the roster, the grant tree, a jump, a follow,
convergence both ways, a reconnect, and the degraded `/meta` a cross-origin page sees.
`prove:fb2` covers tree-only open, create and move tree refresh, and the share-link shape
with a round trip back into a join. `prove:flow2` re-walks the three headline flows of the
flow review. `prove:tls` hosts and joins on the demo origin and asserts that every
derived URL speaks TLS.

`prove:v2` drives a real browser: it starts one `selvaged --serve-page dist` on the room's own
origin, hosts from Node with the engine the page bundles, opens the page on the guest's fragment
link in headless Chromium, joins from the card, opens the room's document from the shared tree, and
asserts an edit in both directions — with `SELVAGE_SELVAGED` and `SELVAGE_CHROMIUM` pointing at a
binary and a browser when the defaults are not the ones on the machine. It is the wire's own
browser proof, and it is the only one that needs a browser: the browser-host flow it does not press
is the folder picker's dialog, which no automation can answer.

What none of them covers is Monaco itself: the adapter owns no protocol logic beyond
offset mapping, which both sides count in UTF-16 code units.

## What the page does not do

No accounts, no analytics, no stored state beyond the live session, the remembered display
name and the tab's own note that it was hosting; no automatic rejoin or host reclaim. A
test pins that the guest path never asks for the host role and that the only mint is the
one behind the folder picker.

`BROWSER_NOTES.md` has the decisions, the bundle diet, and the one layer a human still
has to eyeball: Monaco rendering, which the proving host has no display for.

## Licence

`MIT OR Apache-2.0`, in `LICENSE-MIT` and `LICENSE-APACHE`.
