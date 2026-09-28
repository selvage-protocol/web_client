# What is in the tree

`src/engine/` and `src/bridge/` are copies of `vscode_client/src/{engine,bridge}`, never edited here.
Refresh them with `npm run sync-engine`, which records the upstream SHA in `scripts/sync-engine.sh`.

The copy carries `selvage/2`'s session layer with the rest of the engine: `src/engine/sealed.ts` is
`CANONICAL.md` §6.1's bytes, `src/engine/peer.ts` is `PROTOCOL.md` §13, `src/engine/host.ts` is
§7.1's producer half (the room state the host key seals, and one rule for each state that goes out),
and `src/engine/crypto.ts` is the crypto seam a caller supplies (HKDF-SHA256, SHA-256, AES-256-GCM and
Ed25519), which this page implements with WebCrypto, the engine's own default. The seam is
asynchronous for exactly this client's sake, since WebCrypto has no synchronous form.

The page's own modules:

- `src/browser/main.ts`: the page. Display name, invite, the editable document, the faces in the
  session bar with go-to and a follow toggle, the presence-badged grant tree, the file strip above the
  editor (the open file, the directory muted and the leaf bold, and the chevron a phone opens the
  panel with), the panel disclosure a phone gets, and the page-origin share link whose whole bar
  copies.
- `src/browser/transport.ts`: the engine's socket from the browser's own WebSocket. The `ws` package
  is a dev-only dependency for the Node proof and never enters the bundle; the build refuses a bundle
  that mentions it.
- `src/browser/relay.ts`: the page's `selvage/2` room, the vendored relay with the page's own
  WebSocket, and the `RoomEngine` shape the binding and the session bar drive.
- `src/browser/node-shim.ts`: the one Node global the synced engine expects, `Buffer.byteLength`,
  defined only when absent.
- `src/browser/monaco.ts`: the Monaco runtime, the editor core plus the languages the page backs, each
  with its tokenizer and, for TypeScript and JavaScript, the language worker that makes the mode
  understanding rather than colouring. JSON, TOML and Nix are this repository's own small Monarch
  sets, because Monaco 0.52.2 ships none of the three. Every tokenizer loads lazily, when a document
  of that language opens; anything unbacked is `plaintext` (see `languages.ts`).
- `src/browser/workers/`: the two worker entries the backed modes need, the editor fallback and the
  TypeScript/JavaScript language worker.
- `src/browser/editor.ts`: the Monaco adapter. Remote text in, local edits and the selection out, peer
  cursors as decorations (glyph-margin initials badges, caret bars, selection fills, `label · role`
  hovers), plus the grant tree, jump-to-participant and follow. A peer's whole line is never marked.
  The hover's label comes from the room, so it is escaped to literal markdown (`literalMarkdown`): a
  name paints as its characters and can carry no link, image or code span into a guest's browser.
- `src/browser/icons.ts`: the inline-SVG set and the per-type tree icon, a solid page in the type's
  colour with a short label so it reads in a tree row.
- `src/browser/room.ts`: the room's faces as a testable render: the cap and who is showing, the marks
  on each face, and the dialog a face opens: `Go to` only where there is somewhere to go, a `Follow`
  toggle that stops on its second press, the own name's edit in place, a refused go-to's sentence in
  the menu that asked for it, and the list of everyone the `+N` opens.
- `src/browser/empty-editor.ts`: the editor pane with no document in front of it (a host whose folder
  is empty, a host with files to pick from, a guest whose host has shared nothing, a guest with files
  to pick from), each naming the next act and putting its control where the step is, with the peer
  that is already in a file offered beside them. On a phone the act is `Browse files`, since the panel
  starts shut and nothing else opens it.
- `src/browser/share-box.ts`: the share bar as one copy control. Click anywhere, or focus and press
  Enter, to copy; an overlay inside the bar names the `Copied` confirmation briefly and hides, and the
  readout never leaves, so no layout shifts. The copy is announced once, through the page's polite
  region, because the morph says nothing to a screen reader.
- `src/browser/presence.ts`: initials, one badge per line, the badge CSS.
- `src/browser/mobile.ts`: what a touch-only browser is given, the phone query's two arms (upright and
  on its side) and the touch query it is narrowed by, the editor options a phone needs (wrapped lines,
  16 px, a 55 px gutter), and how tall the app is when a soft keyboard shrinks the visual viewport.
  The minimap and the caret's line highlight are off for every device, because the design draws
  neither.
- `src/browser/notice.ts`: the notices column, which is every sentence the page has over the
  workspace. The session card is the room's own lifecycle: the host-leave warning while the grace
  runs, counting its window down to the room's deadline under a 2 px bar that drains with it and
  turning red when the window is out, the host's return for a few seconds, and the dropped socket's
  line while the engine re-dials. The ticking line is hidden from assistive tech and the card carries
  its own sentence, so the news is announced once rather than once a second. The same column holds the
  download toasts (`Downloaded <leaf>`, two at a time with `+N more`), the failure alert (an action
  that refused with no control to sit beside, a write the folder refused, a follow that ended, an
  error the room reports about the session), and the line a tap reveals where a `title` would have
  shown a pointer. The column takes no pointer at all, and its top is measured from the bar and the
  phone's strip so it clears both.
- `src/browser/ended.ts`: the end of a session, the sentences for it (the desktop clients' `The room
  is gone (<reason>).` plus what a page cannot keep) and the one next step, and `dropSession`, the
  order in which the page leaves a dead room.
- `src/browser/share.ts`: the guest link shape (the page the room's own server serves, carrying
  `?room=&token=` and nothing else), read back the same way when pasted. The bar shows it with the
  page's own origin dropped and the host, the room id and the token shortened middle-first, sized to
  what it shows.

`public/` is the page shell, which carries the site's mark as its own pixels, a 104 px render of
`mark-transparent.png` inlined in the shell so no frame waits on an image. `node scripts/inline-mark.mjs`
prints a refreshed one, levelled the way the site levels the copy the nav bar paints
(`scripts/mark-level.mjs`).

`scripts/` holds the proofs (`prove-m1.mjs`, the live M1 proof; `prove-v2.mjs`, the wire's proof in a
real browser; `prove-fb2.mjs`, the owner-feedback proof; `prove-tls.mjs` and `prove-flow2.mjs`) and the
live check (`check-content-types.mjs`). `test/` holds the suite.

[`Dockerfile`](../Dockerfile), `.dockerignore` and `packaging/` are the page-only image: nginx's own
configuration, with the media types, the cache policy and the page's policy the one-origin deployment
decides, the bundle copied from the committed `dist/`, and the origin relay
(`packaging/40-selvage-relay.sh` and `packaging/relay.conf.template`) that turns `SELVAGE_SERVER` into
the two proxied locations at startup, so this image can be the single origin of a room too.
`bump-version.sh` moves the page's version in every file that carries it and rebuilds the bundle, so a
bump leaves a `dist/` this repository's checks accept; `test-bump-version.sh` covers it, in a clone of
its own. The scripts CI reads live beside the proofs: `test-ci.mjs` (the suite a single checkout can
run), `release-tags.sh` (the release identity), `release-plan.sh` (what a release would be, and
whether one may be cut), `page-image.sh` (the anonymous `ghcr.io` reads), `verify-page-deploy.sh`
(what a page deploy can be verified by), `check-page.sh` (the served bytes, types and headers),
`container-smoke.sh`, `check-relay.mjs` and `relay-stub.mjs` (the room seated through the relay, and
the stand-in endpoint a local run opts into with `SELVAGE_ALLOW_RELAY_STUB=1` where the server's image
cannot be pulled), `assert-image-page.sh`, `test-relay-config.sh` (the relay the entrypoint writes,
parsed by an `nginx` where there is one) and `ci-local.sh`.
