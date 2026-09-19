# web_client

Browser editor client for the Selvage session protocol: join a session from a
page, edit in Monaco, converge with the room. Guest only — it opens what the
room shares and publishes what is typed. Hosting stays in the editor clients.

## Layout

- `src/engine/`, `src/bridge/` — copies of `vscode_client/src/{engine,bridge}`,
  never edited here. Refresh with `npm run sync-engine` (records the upstream
  SHA in `scripts/sync-engine.sh`).
- `src/browser/transport.ts` — the engine's socket from the browser's own
  WebSocket. The `ws` package is a dev-only dependency for the Node proof and
  never enters the bundle; the build refuses otherwise.
- `src/browser/node-shim.ts` — the one Node global the synced engine expects
  (`Buffer.byteLength`), defined only when absent.
- `src/browser/monaco.ts` — the Monaco runtime: the editor core plus the
  languages the page backs, each with its tokenizer and, for TypeScript and
  JavaScript, the language worker that makes the mode understanding rather than
  colouring. JSON, TOML and Nix are this repository's own small Monarch sets,
  because Monaco 0.52.2 ships none of the three. Every tokenizer loads lazily,
  when a document of that language opens; anything unbacked is `plaintext`
  (see `languages.ts`).
- `src/browser/workers/` — the two worker entries the backed modes need: the
  editor fallback and the TypeScript/JavaScript language worker.
- `src/browser/editor.ts` — the Monaco adapter: remote text in, local edits and
  the selection out, peer cursors as decorations (glyph-margin initials
  badges, caret bars, selection fills, `label · role` hovers), plus the grant
  tree, jump-to-participant and follow. A peer's whole line is never marked.
  The hover's label is room-supplied, so it is escaped to literal markdown
  (`literalMarkdown`): a name paints as its characters and can carry no link,
  image or code span into a guest's browser.
- `src/browser/icons.ts` — the inline-SVG set plus the per-type tree icon: a
  solid page in the type's colour with a short label, so it reads in a tree row.
- `src/browser/roster.ts` — the People roster as a testable render: the own
  name first as a full row (swatch, quiet `you`, reasoned disabled actions),
  one row per peer, no path text.
- `src/browser/share-box.ts` — the share bar as one copy control: click
  anywhere or focus plus Enter copies, and an overlay inside the bar names
  the `Link copied` confirmation briefly, then hides; the readout never
  leaves, so no layout shifts.
- `src/browser/presence.ts` — initials, one-badge-per-line, the badge CSS.
- `src/browser/mobile.ts` — what a touch-only browser is given: the two media
  queries the phone layout keys on, the editor options a phone needs (no
  minimap, wrapped lines, 16 px), and how tall the app is when a soft keyboard
  shrinks the visual viewport.
- `src/browser/main.ts` — the page: display name, invite, the editable
  document (focused on join on a device with a pointer, so typing starts at
  once; a phone focuses it on the first tap instead, so the soft keyboard does
  not stand over a room nobody has seen), the People roster with go-to/follow,
  the presence-badged grant tree, the follow banner with the one stop control,
  the panel disclosure a phone gets, and the page-origin share link whose whole
  bar copies. The tree is the only way to open a document.
- `src/browser/notice.ts` — the message homes the page keeps: the session
  note in the chrome (the host-leave warning while the grace runs), the
  failure alert that shows an action that refused, and the line a tap reveals
  where a `title` would have shown a pointer. The last two are one mechanism,
  standing a few seconds and leaving on their own.
- `src/browser/ended.ts` — the end of a session: the sentence for it (the
  desktop clients' `The room is gone (<reason>).`), the one next step, and
  `dropSession`, the order in which the page leaves a dead room.
- `src/browser/share.ts` — the guest link shape: built from the page's own
  origin (`?room=&token=`, plus `?server=` off the default), read back the
  same way when pasted; the bar shows it with the page's own origin dropped
  and the host, the room id and the token shortened middle-first, sized to
  what it shows.
- `public/` — the page shell, carrying the site's mark as its own pixels (a
  104 px render of `mark-transparent.png` in the shell, so no frame waits on an
  image; `node scripts/inline-mark.mjs` prints a refreshed one).
- `scripts/prove-m1.mjs` — the live proof (see below). `scripts/prove-pi.mjs`
  is the M0 record, kept as-is. `scripts/prove-fb2.mjs` is the
  owner-feedback proof (tree-only open, create+move refresh, share-link
  shape and round-trip).
- `test/` — adapter, language, follow/roster/grant, tree-refresh, and
  share-link tests with a fake editor.

## Commands

```sh
npm install --no-audit --no-fund
npm run typecheck
npm run build        # dist/, refuses a bundle containing ws
npm test             # adapter + language + follow tests
npm run serve        # serve dist/ on :8081
npm run prove        # live proof against SELVAGE_BASE (default: the Pi demo)
npm run prove:fb2    # owner-feedback proof: tree-only open, move refresh, share link
npm run check:cors   # CORS headers on the TLS proxy /meta, live (or SELVAGE_CORS_BASE=)
npm run check:types  # Content-Type of every dist/ file, live (or a base URL arg)
```

`build` wipes and rebuilds `dist/` wholesale (chunk names carry content
hashes, so anything else would strand orphans), minified and code-split: the
page loads the editor core and the language service up front, tokenizers load
when a document of that language opens, and the two workers are fetched only
when a mode needs them.

## Languages and peer markers

A room path opens in the mode its type maps to (`languages.ts`): Markdown/MDX,
TypeScript/JavaScript, Rust, CSS/SCSS/Less, HTML, XML/SVG, YAML, shell, Python,
Go, C/C++, Java, SQL, Lua, INI, Dockerfile, PowerShell, Ruby, PHP, C#, Kotlin,
Swift, Dart, R, Perl, Clojure, GraphQL, Protobuf, HCL/Terraform,
reStructuredText, CoffeeScript, Batch, and JSON, TOML and Nix. Everything else
stays `plaintext`. Each tokenizer is a `lang-*.js` chunk fetched the first time
a document of that language opens.

A peer is drawn as a caret bar, a glyph-margin initials badge, a `label · role`
hover, an overview-ruler tick, and — while they hold a selection — a fill. The
peer's whole line is never marked; the VS Code client draws the same pair.

## Joining

Open the served page with the room and its token in the address:

```text
http://host:8081/?room=<room>&token=<token>&server=<ws-base>
```

`server` is omitted for the default demo instance and appears only for other
servers, and it is bounded before it is used: an absolute `ws`/`wss`/`http`/
`https` URL with a host, and no credentials, fragment or query — the guest's own
browser is what would read its `/meta` and open its socket (`linkServerBase`).
The default itself follows the page scheme: an https page joins
over `wss://` (the Pi TLS proxy) while an http page keeps the plaintext `ws://`
default, so an https page never emits a `ws://` or `http://` subrequest (see
`BROWSER_NOTES.md`). That link is the whole guest flow: the page shows one
card — the heading, one question (the name other participants see) and one
confirm, over a blurred preview of the editor — and joins. The card shell is
inline HTML, so it paints before the bundle arrives, and its own inline script
has already decided which shape it is (a bare open shows the paste box, a link
open does not) and prefilled the remembered name, so the first painted frame is
the final one:
a name typed during a slow load survives (prefill only fills an untouched
field), an early submit is held and replayed, and the editor stack loads only
on join. Opening the page bare shows the same card with a paste box for the
invite link (a page link, or a whole `ws://…/session?room=…&token=…`
invite) above the name; after joining, the session bar shows the same link
with the page's own origin dropped, the room id and the token shortened,
masked until hovered or focused and fading in rather than snapping, sized to
what it shows so the whole thing reads at a glance,
with its whole bar doing the copy (focus plus Enter works too), the full
link as its title and the clipboard bytes — and a paste join lands in the address
bar so a reload
rejoins from it. A submit that lands before the page finishes loading never
fails: it queues until loaded and joins exactly once, the button reading
`Joining…` throughout. Type the
name, press Join (or Enter) — the first shared file opens focused, so you
type at once (a phone leaves the keyboard down until you tap the editor, and
starts with the tree and roster behind a `Files and people` control). The last
joined name is remembered for prefill in the browser only. The People roster leads with your own name and
lists who else is here with go-to and follow, never path text; the tree
lists what the room shares with a peer badge on whoever's file is whose
(an open file the host hasn't shared wears a `not yet shared` pill — `not
shared by the host` on a phone, where a title cannot be hovered — and an
action that refuses says so in the alert);
following shows a banner in the followed peer's colour with the stop control
on it, and ends when you type, navigate (open a file from the tree or go
to someone), stop it, or the peer leaves. When the host's socket drops, the
session note names the grace window and clears when the host is back. When the
room ends — the host does not return before the grace expires — the page
leaves the session: the socket closes, the binding and the editor are dropped,
the chrome comes down, and the card returns over the blurred preview carrying
`The room is gone (host did not return). Paste a fresh invite link to join
another session.` Nothing of the dead room stays on screen, the name stays
typed, and pasting a fresh link joins the next room from there. No manual
rejoin, and no reclaim: the page never hellos as host and never rebuilds a room
on its own.

## The mark, and the icons

The page carries the site's own mark and nothing drawn in its place: the card
and the session bar wear a 104 px render of `public/mark-transparent.png` — the
site's copy, byte-identical — inlined in the shell, and the tab is the rasters
`npm run build` renders from `mark-opaque.png` at the sizes the site serves
(16, 32, 48, 180). `node scripts/inline-mark.mjs` prints the data URI to paste
if the site's master changes; `test/identity.test.ts` holds the two together
byte for byte. The site's `app/icon.svg` — copied here as `favicon.svg` until
this round — drew nothing but its background plate (its `clipPath` pointed at a
`<g>`), and is gone with it.

## What the page does NOT do

No hosting, no accounts, no stored state beyond the live session plus the
remembered display name, no analytics, no automatic rejoin or host reclaim —
a test pins that no browser source ever hellos as host.
See `BROWSER_NOTES.md` for the decisions, the bundle diet, and the one layer a
human still has to eyeball (Monaco rendering — no display on the proving host).
