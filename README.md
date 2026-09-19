# web_client

The browser client for the Selvage session protocol. A share link opens the page, a
guest edits in Monaco and converges with the room, and hosting stays in the editor
clients. Guest only: it opens what the room shares and publishes what is typed, while
the host's working copy stays the source of truth.

## Get it working

You need Node and a `selvaged` the page can reach. The suite runs its TypeScript test
files directly under `node --test`, which needs Node 22.18 or newer.

```sh
npm ci        # install exactly what package-lock.json pins
npm run build # write dist/
npm run serve # serve dist/ at http://localhost:8081/
```

When you change a dependency, `npm install --no-audit --no-fund` writes the lockfile.
`npm run serve` is `python3 -m http.server 8081 --directory dist`.

### Where the server comes from

The page reads its server from the link it was opened with and from nowhere else:
`?server=<ws-base>` in the URL, or the invite pasted into a bare open. With no server
named, the built-in default follows the page's own scheme,
`wss://lumi-raspberrypi.muskellunge-yo.ts.net:8444` on an https page and
`ws://100.64.0.3:8080` on an http one (`src/browser/servers.ts`, and `DEFAULT_SERVER` in
`src/browser/main.ts`). An https page must never emit a `ws://` or `http://` subrequest,
so a link's `ws://` base is dialled as `wss://` there. A `server` value is bounded before
it is used: an absolute `ws`, `wss`, `http` or `https` URL with a host, and no
credentials, fragment or query (`linkServerBase`). The guest's own browser is what reads
that server's `/meta` and opens its socket.

### Join a room

The page's own `/` takes the room and its token as query parameters:

```text
http://host:8081/?room=<room>&token=<token>&server=<ws-base>
```

A host produces that link with the editor clients' copy-invite command
(`Selvage: Copy the invite link` in VS Code, `:SelvageCopyInvite` in Neovim), which
builds it from the configured page origin and adds `server` only when the room lives
somewhere other than the default. The default demo instance needs no `server`. A
`ws://host:8080/session?room=…&token=…` invite is the other shape the page takes,
pasted into the box a bare open shows.

Either way the card carries a heading, one question (the name other participants see) and
one confirm, over a blurred preview of the editor. Type the name and press Join or Enter,
and the first shared file opens focused. A pasted page link lands in the address bar, so a
reload rejoins from it.

### Checks

```sh
npm run typecheck   # tsc --noEmit over src/
npm test            # the suite; no server needed
npm run check:types # Content-Type of every dist/ file, against a live page
npm run check:cors  # CORS headers on the TLS proxy's /meta, against a live proxy
```

`typecheck` covers `src/`, which is all `tsconfig.json` includes.

`test` runs the suite with a fake editor standing in for Monaco: the adapter, languages,
follow, roster, grants, tree refresh, share links, the join card, mobile, identity, and
the serve-types contract. Two of them read files outside this repository, and fail when
it is checked out alone or in a worktree: `identity` compares the marks with the `site`
checkout beside this one, and `serve-types` reads `ai_notes/.tmp/web-hosting/serve.py`
from beside it.

`check:types` and `check:cors` are live, and they test a deployment rather than the local
static server. `check:types` defaults to the Pi page on :8443 and takes another base as
an argument, `npm run check:types -- http://127.0.0.1:8081`; a plain static server
answers the `.map` files as `application/octet-stream` and fails that check, which is
about the serving layer the page is deployed behind. `check:cors` defaults to the TLS
proxy on :8444 and takes `SELVAGE_CORS_BASE=`; it needs the proxy that puts the CORS
headers on `/meta` for an https page on another origin.

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
`Files and people` control. The People roster leads with your own name and lists who
else is here with go-to and follow, never path text. The tree lists what the room shares
with a peer badge on whoever's file is whose; an open file the host hasn't shared wears
a `not yet shared` pill (`not shared by the host` on a phone, where a title cannot be
hovered), and an action that refuses says so in the alert. The tree is the only way to
open a document.

Following shows a banner in the followed peer's colour with the stop control on it, and
ends when you type, navigate (open a file from the tree or go to someone), stop it, or
the peer leaves. When the host's socket drops, the session note names the grace window
and clears when the host is back. When the room ends, because the host does not return
before the grace expires, the page leaves the session: the socket closes, the binding
and the editor are dropped, the chrome comes down, and the card returns over the blurred
preview carrying `The room is gone (host did not return). Paste a fresh invite link to
join another session.` Nothing of the dead room stays on screen, the name stays typed,
and pasting a fresh link joins the next room from there. There is no manual rejoin and no
reclaim: the page never hellos as host and never rebuilds a room on its own.

## What is in the tree

`src/engine/` and `src/bridge/` are copies of `vscode_client/src/{engine,bridge}`, never
edited here. Refresh them with `npm run sync-engine`, which records the upstream SHA in
`scripts/sync-engine.sh`.

The page's own modules:

- `src/browser/main.ts`: the page. Display name, invite, the editable document, the
  People roster with go-to and follow, the presence-badged grant tree, the follow banner
  with the one stop control, the panel disclosure a phone gets, and the page-origin share
  link whose whole bar copies.
- `src/browser/transport.ts`: the engine's socket from the browser's own WebSocket. The
  `ws` package is a dev-only dependency for the Node proof and never enters the bundle;
  the build refuses a bundle that mentions it.
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
  a full row (swatch, quiet `you`, reasoned disabled actions), one row per peer, no path
  text.
- `src/browser/share-box.ts`: the share bar as one copy control. Click anywhere, or
  focus and press Enter, to copy; an overlay inside the bar names the `Link copied`
  confirmation briefly and hides, and the readout never leaves, so no layout shifts.
- `src/browser/presence.ts`: initials, one badge per line, the badge CSS.
- `src/browser/mobile.ts`: what a touch-only browser is given, the two media queries the
  phone layout keys on, the editor options a phone needs (no minimap, wrapped lines,
  16 px), and how tall the app is when a soft keyboard shrinks the visual viewport.
- `src/browser/notice.ts`: the message homes the page keeps, the session note in the
  chrome (the host-leave warning while the grace runs), the failure alert that shows an
  action that refused, and the line a tap reveals where a `title` would have shown a
  pointer. The last two are one mechanism, standing a few seconds and leaving on their
  own.
- `src/browser/ended.ts`: the end of a session, the sentence for it (the desktop clients'
  `The room is gone (<reason>).`), the one next step, and `dropSession`, the order in
  which the page leaves a dead room.
- `src/browser/share.ts`: the guest link shape, built from the page's own origin
  (`?room=&token=`, plus `?server=` off the default) and read back the same way when
  pasted. The bar shows it with the page's own origin dropped and the host, the room id
  and the token shortened middle-first, sized to what it shows.

`public/` is the page shell, which carries the site's mark as its own pixels, a 104 px
render of `mark-transparent.png` inlined in the shell so no frame waits on an image.
`node scripts/inline-mark.mjs` prints a refreshed one.

`scripts/` holds the proofs (`prove-m1.mjs`, the live M1 proof; `prove-pi.mjs`, the M0
record kept as-is; `prove-fb2.mjs`, the owner-feedback proof; `prove-tls.mjs` and
`prove-flow2.mjs`) and the live checks (`check-cors.mjs`, `check-content-types.mjs`).
`test/` holds the suite.

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
site's copy byte-identical, inlined in the shell. The tab is the rasters `npm run build`
renders from `mark-opaque.png` at the sizes the site serves (16, 32, 48, 180) and the two
the manifest names (192, 512). `node scripts/inline-mark.mjs` prints the data URI to paste
if the site's master changes, and `test/identity.test.ts` holds the two together byte for
byte. The mark is the owner's `svp` monogram in Mocha/mauve, nothing redrawn or
approximated.

The site's `app/icon.svg`, once copied here as `favicon.svg`, drew nothing but its
background plate, because its `clipPath` pointed at a `<g>`. Both are gone.

## Proofs

The proofs drive the page's own code against a real `selvaged`, with a fake editor
standing in for Monaco:

```sh
SELVAGE_BASE=ws://127.0.0.1:8080 npm run prove      # the M1 page stack
SELVAGE_BASE=ws://127.0.0.1:8080 npm run prove:fb2  # the owner-feedback pass
npm run prove:flow2                                 # the flow-review fixes
npm run prove:tls                                   # the same page over TLS
```

`SELVAGE_BASE` defaults to the Pi demo and `SELVAGE_TLS_BASE` to the Pi TLS proxy, so
`prove:flow2` and `prove:tls` run against that machine unless you point them elsewhere.

`prove` mints a room with this checkout's own engine, joins the way the page does with
the default `/meta` check, and walks the roster, the grant tree, a jump, a follow,
convergence both ways, a reconnect, and the degraded `/meta` a cross-origin page sees.
`prove:fb2` covers tree-only open, create and move tree refresh, and the share-link shape
with a round trip back into a join. `prove:flow2` re-walks the three headline flows of the
flow review. `prove:tls` hosts and joins through the Pi TLS proxy and asserts that every
derived URL speaks TLS. `scripts/prove-pi.mjs` is the M0 record kept as-is, and it mints
its room with the `vscode_client` engine beside this checkout.

What none of them covers is Monaco itself: the adapter owns no protocol logic beyond
offset mapping, which both sides count in UTF-16 code units.

## What the page does not do

No hosting, no accounts, no stored state beyond the live session plus the remembered
display name, no analytics, no automatic rejoin or host reclaim. A test pins that no
browser source ever hellos as host.

`BROWSER_NOTES.md` has the decisions, the bundle diet, and the one layer a human still
has to eyeball: Monaco rendering, which the proving host has no display for.

## Licence

`MIT OR Apache-2.0`, in `LICENSE-MIT` and `LICENSE-APACHE`.
