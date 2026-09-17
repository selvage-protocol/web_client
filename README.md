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
- `src/browser/monaco.ts` — the Monaco runtime: the editor core plus the three
  backed languages (markdown, TypeScript, JavaScript) with the TS language
  service. Everything else is `plaintext` (see `languages.ts`).
- `src/browser/workers/` — the two worker entries the backed modes need: the
  editor fallback and the TypeScript/JavaScript language worker.
- `src/browser/editor.ts` — the Monaco adapter: remote text in, local edits and
  the selection out, peer cursors as decorations (glyph-margin initials
  badges, whole-line highlights, `label · role` hovers), plus the grant
  tree, jump-to-participant and follow.
- `src/browser/icons.ts` — the inline-SVG set plus the per-type tree icon.
- `src/browser/roster.ts` — the People roster as a testable render: the own
  name first, one row per peer, no path text.
- `src/browser/presence.ts` — initials, one-badge-per-line, the badge CSS.
- `src/browser/main.ts` — the page: display name, invite, the editable
  document (focused on join, so typing starts at once), the People roster
  with go-to/follow, the presence-badged grant tree, the follow banner with
  the one stop control, and the page-origin share link whose link icon
  copies. The tree is the only way to open a document.
- `src/browser/share.ts` — the guest link shape: built from the page's own
  origin (`?room=&token=`, plus `?server=` off the default), read back the
  same way when pasted.
- `public/` — the page shell.
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

## Joining

Open the served page with the room and its token in the address:

```text
http://host:8081/?room=<room>&token=<token>&server=<ws-base>
```

`server` is omitted for the default demo instance and appears only for other
servers — and the default itself follows the page scheme: an https page joins
over `wss://` (the Pi TLS proxy) while an http page keeps the plaintext `ws://`
default, so an https page never emits a `ws://` or `http://` subrequest (see
`BROWSER_NOTES.md`). That link is the whole guest flow: the page shows one question —
the name other participants see — over a blurred preview of the editor, and
joins. The card shell is inline HTML, so it paints before the bundle arrives:
a name typed during a slow load survives (prefill only fills an untouched
field), an early submit is held and replayed, and the editor stack loads only
on join. Opening the page bare shows the same card with a paste box for the
invite link (a page link, or a whole `ws://…/session?room=…&token=…`
invite) above the name; after joining, the session bar shows the same link
with its link icon doing the copy, and a paste join lands in the address
bar so a reload
rejoins from it. A submit that lands before the page finishes loading never
fails: it queues until loaded and joins exactly once, the button reading
`Joining…` throughout. Type the
name, press Join (or Enter) — the first shared file opens focused, so you
type at once. The last joined name is remembered for
prefill in the browser only. The People roster leads with your own name and
lists who else is here with go-to and follow, never path text; the tree
lists what the room shares with a peer badge on whoever's file is whose;
following shows a banner in the followed peer's colour with the stop control
on it, and ends when you type, navigate (open a file from the tree or go
to someone), stop it, or the peer leaves.

## What the page does NOT do

No hosting, no accounts, no stored state beyond the live session plus the
remembered display name, no analytics.
See `BROWSER_NOTES.md` for the decisions, the bundle diet, and the one layer a
human still has to eyeball (Monaco rendering — no display on the proving host).
