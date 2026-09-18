# Browser client notes (M0–M1)

Decisions settled while scaffolding and building, with what is deliberately
left out.

## Link shape

The share link is the page URL: `location.origin + path +
?room=<id>&token=<tok>`, with `&server=<ws-base>` only when the room lives
off the default instance (`src/browser/share.ts`). Query params read with
real param semantics (`pageQueryParams`): `room`/`token`/`server`/`debug` as
independent params in any order, everything else ignored, values decoded
once — a literal `?` past the first is a separator, so a `?debug=1`
appended to a link that already has a query still joins instead of gluing
into the token (the 2026-09-17 owner failure, pinned in `test/share.test.ts`
and `test/join-screen.test.ts`). After joining, the session
bar shows the link with its link icon doing the copy — the clipboard where
it exists, a selection otherwise — so the guest flow never shows a bare
`ws://`. While
the page itself is served from loopback the link uses the page origin, which
round-trips locally; a `PUBLIC_PAGE_ORIGIN` constant stands ready for a
configured public origin when one exists. A pasted page link joins the same
way it loads; a whole wire invite (`ws://…/session?room=…&token=…`) is still
accepted through the engine's own `parseSessionUrl`. The token stays the
permission, as in v1: anyone holding the link joins while the room lives. The
page mints nothing.

## Editor and its backed modes (M1)

Monaco, Mocha: one `IStandaloneCodeEditor` running a `selvage-mocha` theme
(`monaco.editor.defineTheme`, `vs-dark` base) in Catppuccin Mocha colours with a
mauve caret, active line number and focus border. The bundle imports
the editor core — not the `monaco-editor` root, which pulls in all eighty-odd
tokenizers and every language service — plus exactly three contributions:
markdown, TypeScript and JavaScript tokenizers, and the TypeScript language
service that makes TS/JS understanding rather than colouring. `languages.ts`
maps a room path to its mode; anything unmapped stays `plaintext` on purpose,
an honest mode rather than highlighting that pretends.

Two real workers ship beside the bundle: the editor fallback
(`editor.worker.js`) and the TypeScript/JavaScript language worker
(`ts.worker.js`), chosen by label in `MonacoEnvironment.getWorkerUrl`. The M0
placeholder worker is gone.

Bundle diet, same machine, both unminified development builds: M0 served one
`app.js` of 8.6 MB with no workers at all; M1 serves `app.js` 2.3 MB plus the
shared editor-core chunk 4.8 MB and the language-service chunk (~50 KB) up
front — about 7.1 MB before tokenizers — with tokenizers (~2–10 KB each)
loading when a document of that language opens and the workers (0.5 MB,
11.6 MB) fetched only when a mode needs them. The `ws`-free build assert is
still green. The weight left is the editor core itself and `typescriptServices`
inside the TS worker; shrinking those means a slimmer editor or giving up the
language service, neither of which this demo needs.

## Theme (Mocha + mauve)

The page is dark-only, in Catppuccin Mocha with a mauve accent, shaped like a
small component library rather than bare element styles: `public/index.html`
carries design tokens on `:root` (`--background` `#1e1e2e`, `--card` `#181825`,
`--muted` `#313244`, `--border` `#45475a`, `--foreground` `#cdd6f4`,
`--muted-foreground` `#a6adc8`, `--primary`/`--ring` `#cba6f7`, `--radius`
`0.5rem`) and the chrome — session bar, side panel, join card, buttons,
inputs, focus rings — reads them. There is no theme toggle; light never
shipped as a supported mode, so nothing had to be kept working there. Peer
colours stay data-driven throughout: roster swatches, the follow banner and
caret decorations use the engine's `peerColour` mapping and no theme token
touches them.

Four small layout rules arrived with the same pass: `[hidden]` beats the
flex layouts so the pre-join page and the emptied follow banner paint nothing
(the banner's 3px peer-coloured stripe is gone); `#editor` gets `min-width: 0`
so the flex child can shrink, plus a 640px media query that stacks the side
panel above the editor and wraps the session bar, which makes a 390px
viewport usable with no sideways scroll; roster rows and their buttons hold
`white-space: nowrap`; the favicon and touch icons are real mark files
served beside the bundle (see §Identity), so loads log no 404.

## Identity (2026-09-17)

The page carries the same mark as the website: the owner's `svp` monogram
in Mocha/mauve. Nothing is redrawn or approximated. The sources are
byte-identical copies of the site's files, kept in `public/`:
`favicon.svg` is `site/app/icon.svg` (the SVG original lives in the site
repo, so the inline-SVG placeholder is gone), and `mark-opaque.png` /
`mark-transparent.png` are `site/public/`'s. `test/identity.test.ts` pins
the byte-identity (sha256) and the wiring.

Wired from those sources:

- Favicon: `favicon.svg` with a `favicon-32x32.png` fallback.
- `apple-touch-icon.png` (180×180, from the opaque mark — the transparent
  one has nothing behind it on a home screen) and manifest icons
  `icon-192.png` / `icon-512.png`. All four are rendered at build time by
  `scripts/build.mjs` (ImageMagick, from the 800px opaque mark) into
  `dist/` — no hand-scaled binaries in the tree.
- `site.webmanifest` (`scripts/build.mjs` writes it): name `Selvage —
  shared editing in the browser`, short name `Selvage`, Mocha base
  `#1e1e2e` as theme and background colour; `theme-color` meta to match.
- Brand in the page chrome, mirroring the site header: the session bar
  opens with the transparent mark beside a `Selvage` wordmark (the img is
  `alt=""`, the wordmark names it), and the join card carries the mark
  above the heading with `alt="Selvage mark"`. Both render from the 800px
  source, crisp at 1x/2x.
- OpenGraph basics: `og:title` (the page title), `og:description` (the join
  lede, verbatim — no new claims), `og:type` website, `og:image` at the
  `mark-opaque.png` asset path.

Proven live (`ai_notes/.tmp/web-eyeball/eye-icon.mjs`, real Chromium 152
over CDP, fresh `chrome-profile-icon` killed after, `dist/` on `:8081`):
13/13 checks, `ICON VERDICT: PASS` — every identity asset HTTP 200 with
zero failing requests, the manifest parses with name/theme/icons, both
brand imgs decode at natural 800px, zero console errors. Shots
`01-join-icon.png` (1x), `02-join-2x-icon.png` (2x join card),
`03-brand-icon.png` (session brand clip). The session bar stays hidden
until a join, so the brand clip was eyeballed by revealing it in place —
no server was needed, only the mark img was under test. Verdict in
`ai_notes/.tmp/web-eyeball-report.md`.

## The engine is copied, not forked

`src/engine` and `src/bridge` are byte-identical copies of
`vscode_client/src/{engine,bridge}` at upstream `85e9ee2`, refreshed by
`scripts/sync-engine.sh` (same shape as the Neovim client's vendor script).
Three seams keep the copies untouched:

1. Socket: the engine's `WebSocketFactory` takes the browser's own WebSocket.
   `ws` is a dev-only dependency for the Node proof; tsconfig maps it to a
   throwing stub and the build refuses a bundle containing the package.
2. `Buffer.byteLength` (the inbound-frame bound) is the only Node global the
   synced engine touches. `node-shim.ts` defines it via `TextEncoder` only
   when absent; Node keeps its own.
3. Monaco: `editor.ts` imports only its types. Model creation is injected, so
   the adapter's offset mapping is testable without a DOM.

Protocol untouched: the same `selvage/1` socket, the same messages.

## `/meta` without the skip (M1)

The page joins with the engine's default `/meta` check. Same-origin, the read
checks the wire version before the socket opens. Cross-origin against the
plaintext demo port, where `/meta` answers without CORS headers, the read
fails like any unreachable endpoint — advisory, never a refusal — and the
handshake negotiates the truth. Cross-origin against the TLS proxy
(`https://…:8444/meta`), the read is real: the proxy answers CORS on `/meta`
(the request `Origin` echoed, `*` without one, `OPTIONS` preflight handled in
the proxy itself), so the version check runs before the socket opens there.
`npm run check:cors` (or `scripts/check-cors.mjs` against a fixture via
`SELVAGE_CORS_BASE=`) pins the headers live. The server-side CORS header on
selvaged itself stays a queued server item and was not touched here.

## Roster, follow, grant tree (M1)

The desktop semantics, in page form:

- The roster lists remote peers with the name, the role, the room path they
  are in (or `no shared document open`), and a swatch in `peerColour`'s
  colour — the same mapping the caret wears, so rows and carets cannot
  disagree. Each row offers Go to and Follow. (Since the owner-UX batch
  below: rows carry the name and swatch only — no path text, no roster
  stop — with the own name leading; where someone is reads on the tree.)
- Go to lands once where the peer is: opens (which fetches, the desktop
  guest's behaviour), resolves, places the caret, reveals it. A landing that
  cannot resolve never lands at offset zero; a pending one re-resolves on
  every room event rather than refusing during awareness lag.
- Follow lands where the peer is and again on every frame, and every landing
  announces itself in the status line (`following <name> — <path>`, `open:
  <path>` for a go-to), so the status names the file the tree highlights and
  the editor shows. (Since the batch: the go-to `open:` status is gone —
  tree and editor carry it — while follow re-lands still announce.) A local edit ends it — the caret sits where the peer is,
  so typing on would be yanked back — while a remote apply never does (the
  binding's applying guard tells them apart). A deliberate navigation ends it
  too, the same class as typing: going to someone (the binding stops the
  follow first), or opening a file from the tree (the page stops it before
  the open, so the follow cannot land back over the file just opened). The
  binding's `openDocument` primitive itself stays neutral — landings are
  opens, and `prove-m1` pins the neutrality — while the stop control, or the
  peer leaving, ends it as well, the leaving with a sentence. The indicator
  is a full-width banner in the followed peer's colour with the stop control
  on it.
- The grant tree is the room's listing (`doc.granted`) unioned with the open
  documents — the desktop's offered set — drawn with synthesized directories,
  directories first. Clicking a file opens it, which fetches it.

One implementation note the desktop does not need: re-showing a document the
page already holds touches no wire. Landing through a full open on every frame
answered its own open with the room event that superseded it, and follow could
never land; the binding fronts each path once and re-attaches the model after
that. A test pins it.

## What the page does NOT do

- No hosting: guest joins only. A browser page holding host grants would raise
  persistence questions the demo does not need — what survives a reload, what
  the truth is while the tab is closed — so the explicit refusal stands:
  `readGrantedFile` answers nothing and `save` is a no-op. If hosting from the
  browser is ever wanted, that stance, not the code, is the thing to revisit.
- No accounts, no signup. A reload
  rejoins from the link: arriving via link keeps working, and after a manual
  paste join the page writes the share link back into the address bar
  (`history.replaceState` in `join`, `persistJoinUrl` in `share.ts`), so the
  reload rejoins from it instead of losing what was pasted. The one thing
  kept besides the live session is the last joined display name, in
  `localStorage` under `selvage.displayName`, for prefill only — never sent
  anywhere except the next join's hello, and a refusing storage simply
  skips it.
- No metrics, no analytics, no network calls beyond the session socket (plus
  the lazy tokenizer/worker fetches from the page's own origin).
- No persistence claims: the copy says the host's working copy stays the
  source of truth and the room receives what is typed — that is the whole of
  it.

## Owner-feedback pass (2026-09-17)

Four confirmed items from the owner testing the page, plus one folded-in fix.

1. One way to open: the file-select dropdown is gone — the control, the
   `knownDocs` state, `syncDocsSelect`, its styles and its listener, all
   deleted. The grant tree is the only open affordance; nothing referenced
   the select, so nothing had to be repurposed. The bundle carries no `docs`
   id at all.
2. Tree refresh on every listing change: the missed invalidation was the
   binding's engine subscription — `documentsChanged` re-ran the follow tick
   but never announced the tree, while the listing is the grant unioned with
   the open set. It now emits the `grant` notice on `documentsChanged` too,
   and the page re-renders the tree on the `documents` notice as well as the
   `grant` one. `test/grant-refresh.test.ts` pins create-then-move with no
   grant event (red before the fix).
3. Page-origin share links (see §Link shape).
4. Restyle, still Mocha and dark-only: a tighter session bar (room, share
   link with copy, status), a 19rem side panel with stacked roster rows
   (round swatch, name over path, icon buttons with text labels), full-width
   tree rows with hover/active states and a rotating chevron on folders, a
   primary Join button and a shadowed join card as the pre-join empty state.
   The panel went 17rem to 19rem with slimmer actions after the vision
   review found names truncating; on narrow screens the readonly share input
   hides while the link icon stays. Iconography is inline SVG throughout (typed
   file icons, folder, chevron, go, follow, stop, link, check) with text labels beside every
   icon; no emoji anywhere. Peer colours still come only from `peerColour` —
   the One-Dark-reading peer palette stays, consistent across swatch, banner,
   caret and selection, and `bridge/` is a byte-identical synced copy, so a
   remap would be an upstream palette change plus a resync, not a page edit.
   The copy is unchanged apart from the invite placeholder the link shape
   required — no new claims.

Folded in from the same queue: ending a follow by typing left the roster
toggle reading `Stop` until the next room event. `syncFollow` now refreshes
the roster on unfollow too, so the toggle mirrors the indicator in the same
frame; the live eyeball asserts it (`09-typed-fb2.png`).

## Proven (2026-09-17, Pi demo)

Typecheck green, build green with the ws-absence assert, tests 17/17, and
`scripts/prove-m1.mjs` against `ws://100.64.0.3:8080/session`: room minted by
this checkout's own engine (one copy — the M0 dual-copy harness caveat is
gone), guest joined the way the page does over a native WebSocket with the
default `/meta` check; roster named the host in the caret colour; grant
listing unioned and the tree synthesized directories first; click opened and
fetched the listed document in its backed language; jump landed in the host's
document at the host's caret; follow re-landed on the next caret move; a local
edit ended the follow and still converged on the host; the host edit converged
on the guest; a forcibly-failing `/meta` read still joined; socket cut and the
room converged again. Served `dist/` on `:8081`: index/js/css/workers/chunks
all HTTP 200, protocol string in the bundle, no `ws`, no placeholder worker.

## Proven: owner-feedback pass (2026-09-17, Pi demo)

Typecheck green, build green with the ws-absence assert, tests 22/22
(binding 4, follow/roster/grant 10, languages 3, tree-refresh 1, share-link 4),
and `scripts/prove-fb2.mjs` (`npm run prove:fb2`) against
`ws://100.64.0.3:8080/session`, 11/11 checks, `PROOF OK`: opened `src/main.ts`
through the tree's own children and fetched it in its backed language; the host
created `docs/` and moved `notes.md` into it — the guest tree re-rendered on the
listing changes with `grant` notices, and the moved entry opened from the new
path; the share link starts with `https://`, names no `ws://`, and its
room/token rejoined through `sessionUrl` as a second guest. Real Chromium 152
over CDP (`ai_notes/.tmp/web-eyeball/eye-fb2.mjs`, fresh `chrome-profile-fb2`,
screenshots `*-fb2.png`, `console-fb2.json`): pre-join page shows no select and
a page-link placeholder; the session-bar link starts with the page origin and
carries no `ws://`; copy confirms in the status line; navigating to the copied
link prefills and rejoins; tree-only open marks the row; jump and follow land
with the peer-coloured banner; typing ends the follow and flips the roster
toggle to `Follow` in the same frame; the host create+move grows the `docs/`
folder live and the moved entry opens; 390px has no sideways scroll. Console:
zero JS exceptions; the only network entries are the known cross-origin
`/meta` CORS downgrade, advisory as documented. Verdict appended to
`ai_notes/.tmp/web-eyeball-report.md`.

Vision look-review (`ai_notes/.tmp/vision-web-look.md`, shots in
`.tmp/vision-weblog/`, an independent pass over the rebuilt bundle): no blocking
issues, zero console errors, every sampled chrome hex on-palette. Its three
polish findings are folded in above: the 19rem panel with slimmer actions, the
hidden narrow share input, and the kept peer palette.

## Flow-review fixes (2026-09-17)

Seven flow findings from the independent UX-flow review
(`ai_notes/.tmp/vision-web-flow.md`), each verified against the code before
being fixed. The synced `engine/` and `bridge/` copies are untouched
throughout; every fix sits in `src/browser/` plus its tests.

- Status/tree/editor agreement after landings (blocking): the binding's
  landing now announces every landing in the status line, and the page
  re-marks the tree row whenever the current path moves, on any notice — a
  go-to included. Navigation ends follow, settled the README way: typing, a
  deliberate navigation (go-to, or a tree open — the page stops the follow
  before it), the stop control, or the peer leaving. `test/flow-fixes.test.ts`
  drives go-to (lands silent — tree and editor name the file, no `open:`
  status) and a follow re-land (status still names who and where);
  `scripts/prove-m1.mjs` keeps pinning the primitive's neutrality.
- Granted-but-unpublished files: `openPath` asks the new
  `binding.isUnpublished` (the engine's `has`: received anything at all, so
  an arrived-and-emptied file is not unpublished) and the status reads
  `<path> — the host hasn't shared its text yet`. Probed live: the
  sync arrives before the open resolves, so the check is settled by the
  time the opener asks.
- Drop signal: the engine already emits `reconnecting` synchronously on a
  seated socket close (`prove-m1` cuts a socket and watches it), and the
  page already mapped it — the review polled a tab whose own socket never
  dropped, so it never fired there. Wiring pinned in
  `test/flow-fixes.test.ts`; new is the other half: the first room event on
  the reseated socket retires the sticky status with `reconnected — open:
  <path>`, so even when the re-hello wins the race the room still says it
  reconnected.
- Duplicate names: roster rows render through `rosterLabel` (`names.ts`) —
  plain while unique, with a short peer id while taken — recomputed on
  every render, so late clashes disambiguate too; joining into a taken name
  adds a one-line status warning. Pinned in `test/flow-fixes.test.ts`.
- Manual room/token entry: the join writes the share link back into the
  address bar (same-origin; silently skipped elsewhere), covered by a
  `persistJoinUrl` test.
- Unreachable server: join failures map through `describeJoinError`
  (`transport.ts`) — the raw `the WebSocket reported an error` becomes
  `couldn't reach <server> — check the server address and retry`, while
  validation copy passes through untouched. Pinned in
  `test/flow-fixes.test.ts`.
- Tree directories: openness is the guest's pin (`openDirs`, toggled only by
  trusted toggle events) plus ancestors of the open file (`dirOpen` in
  `tree-state.ts`), so re-renders keep folders as left. Pinned in
  `test/flow-fixes.test.ts`.
- Narrow overflow (tentative pixel finding): re-measured live —
  `documentElement.scrollWidth` settles at 390 with no sideways scroll, so
  no page change. The over-wide nodes left are Monaco's own `lines-content`
  and `view-rulers` (headless font metrics lay them 16M wide); the editor's
  overflow containment holds them, and the check stays a watch item for a
  hardware pass.

Proven live (`npm run prove:flow2`, 12/12 against the Pi demo, plus the
real-Chromium `eye-flow2`/`eye-flow2-drop` passes with `*-flow2.png` shots):
follow re-lands announce who and where with status, tree and editor
agreeing (go-to lands silent since the batch below); the unpublished file
reads advisory; the drop raises the reconnecting status on the dropped tab
and the reseat restores a bare `reconnected`; duplicates render apart; the manual join
lands in the address bar; the unreachable server reads plainly. Verdict in
`ai_notes/.tmp/web-eyeball-report.md`.

## Join card (2026-09-18)

The share link carries the room, its token, and the server when off the
default — so the card asks one thing. Pre-join shows the editor shell as a
blurred preview (`#preview`, a pure-CSS skeleton of side panel and editor
panes behind `#veil`'s backdrop blur — never real room content; the
workspace stays hidden and Monaco is created only on join) with a single
centered card: the mark, the lede (verbatim, no new claims), a room line
reading the room id (`Joining room <id>`, shortened past 24 characters
with the full id as its title — human-readable, no token material), one
name field, one Join button. A bare page open (no `room`+`token` params)
shows the same card with one paste box above the name (`Paste your invite
link`, page-link placeholder, no socket jargon): it takes a page link or a
whole wire invite, the link in the address bar winning when both exist
(`resolveJoin` in `src/browser/join.ts`). The old server/room/token fields
are gone, with their copy: a bare open with nothing pasted reads `paste
an invite link to join`.

The form submits on Enter, Tab walks invite to name to Join, and focus
starts on the first empty question. The name validates non-blank (the
kept copy) plus the protocol's 32 UTF-16 code units counted the desktop
way (`String.length`, astral characters cost two), refused never
shortened: `that name is <n> characters and the room allows 32 — shorten
it to join`. The joined name persists in `localStorage` under
`selvage.displayName` for prefill; the duplicate-name behaviour is
unchanged (seated with a one-line status warning, the row told apart by
`rosterLabel`).

Join failures read plain words with a next step (`describeJoinError` in
`src/browser/transport.ts`), after a live report of a raw `WebSocket
reported an error` reaching the card. Every surface of the join path maps:
the handshake-named refusals (`room_unknown` / `token_invalid` /
`room_gone` / `host_present` / `unsupported_version` name the link and a
fresh one; `hello_required` and the abandoned attempt name the server
address); a close code buried in a transport message (`the socket closed
before it opened: 4001 …`, `the connection closed with 4002`) maps the
same way as the refusal, because the refusal and the socket close race and
either may arrive first — previously the close won and a refused room read
as unreachable; a transport that never came up keeps the `couldn't reach
<server> — check the server address and retry` copy; an unusable server
address reads `that server address can't be used — fix it and retry`; and a
last guard catches any wording the cases missed, so no `WebSocket` or
engine wording reaches the card. The token never appears in any message.
`test/join-screen.test.ts` pins each mapping with a no-leak assert, and
the live pass below triggers the socket, refused-room and refused-token
surfaces for real.

Proven live (`npm run typecheck`, build green with the ws-absence assert,
tests 66/66, Pi demo `ws://100.64.0.3:8080/session`): real Chromium 152
over CDP (`ai_notes/.tmp/web-eyeball/eye-join.mjs`, fresh
`chrome-profile-join` killed after, `dist/` on `:8081`, shots
`*-join.png`): bare open shows paste box plus name only, skeleton behind
the blur, veil at `blur(9px)`, card above it, focus on the invite, nothing
real before join; empty/over-long/pasted-fragment refusals keep their
copy; the unreachable server, refused room and refused token each read
their plain copy with zero socket/engine wording; link join asks just the
name and shows the room id with no token on the card; duplicate join
warns `already here`; reload rejoins from the link with the stored name
prefilled; manual paste join works by Tab, type and Enter and lands in the
address bar; 390px has no sideways scroll and the card fits (a
`box-sizing` fix found by measuring the card at 426px mid-pass). Console:
zero JS exceptions; the only network entries are the known cross-origin
`/meta` CORS downgrade plus the deliberate unreachable probe. Verdict in
`ai_notes/.tmp/web-eyeball-report.md`.

## Join flow without plumbing (2026-09-17)

Owner standard: the joining guest sees only words and one next step — no
`ws://`, no server address, no room/token material, no engine words,
anywhere user-visible. Per surface, before → after:

- Pre-join card: `Joining room <id>` (`shortRoom`, full id as title) → a
  generic `You've been invited to a live session` line with no id element
  at all. Server-minted ids (`r-` plus hex) are not human-readable, so the
  id display went instead of staying; `shortRoom` is deleted with its
  test, and the stale `.roomline strong` rule with it.
- Manual paste box: `https://this-page/?room=…&token=…` →
  `e.g. https://this-page/… — paste the whole invite link`: still an
  https page-link example, never `ws://`, and no `token=` in the card.
- Failure messages (`describeJoinError`): every copy that interpolated
  the server (`no room answers at <base>`, `couldn't reach <base> —
  check the server address and retry`, `couldn't get an answer from
  <base>`, `that server address can't be used`) → plain situations with
  one action: unreachable/abandoned/timeout read `couldn't reach the
  session — check your connection and retry`; refusals read `nothing
  answers at that link …`, `that link was refused …`, `the session
  already ended …`, each ending in a fresh link and a retry. No address,
  no code, no `close`/`socket`/`engine` wording (the copy even avoids
  `closed`). The `flow-fixes.test.ts` expectation that pinned the old
  address copy now pins the plain one.
- Share-link bar: unchanged shape — page link only, no `ws://` — pinned
  by a new test. The token rides inside the page link itself (it is the
  permission, as in v1); no wire address ever does.
- Joining status: the button reads `Joining…` while the attempt runs (was
  a bare disable); the session bar read `Shared session` instead of
  `room <id> — <role>` — since the batch below the bar carries no session
  text at all, just the mark and wordmark.
- Diagnostics: every failure logs `[selvage] join failed (server <base>:
  <raw>)` to the console, and `?debug=1` appends `(server <base>)` to the
  card copy (`describeJoinErrorForDisplay`, `joinFailureDetail` in
  `transport.ts`) — the only places an address may appear, never default
  UI. `debug` itself is a regular query param, so it works joined with `&`
  or appended with a second `?`. `test/join-screen.test.ts` pins both:
  default UI clean, gated detail present.

Proven live (`CLEAN VERDICT: PASS`, Pi demo `ws://100.64.0.3:8080`): real
Chromium 152 over CDP (`ai_notes/.tmp/web-eyeball/eye-clean.mjs`, fresh
`chrome-profile-clean` killed after, `dist/` on `:8081`, shots
`*-clean.png`): the bare card, placeholder, invite line, every failure
surface, session label and joined status each scanned for `ws://`, bare
IPs, `token=`, `400x` and `close`/`socket`/`engine` wording; link card
asks only the name; `?debug=1` names the server; reload rejoins with the
stored name; manual paste join works by Tab, type and Enter; 390px has no
sideways scroll. Console: zero JS exceptions; the only network entries are
the known cross-origin `/meta` CORS downgrade plus the deliberate
unreachable probe. Verdict in `ai_notes/.tmp/web-eyeball-report.md`.

## The one unverified layer

Monaco rendering itself: no display, no headless browser on the proving host,
so no DOM ever laid out. Covered instead by adapter unit tests (offset mapping
both directions, cursor decoration ranges, landing positions) and the live
session proof of everything below the adapter. A human with a browser must
still eyeball, once, against a live room:

1. Join from a `?room=&token=&server=` link: the roster names the other side,
   swatches match caret colours, paths read correctly.
2. Open a `.md` and a `.ts` file: highlighting appears a beat after open
   (lazy tokenizer), and the TS file gets hover/diagnostics from the worker.
3. Jump and follow: the caret lands centred on the peer, the banner shows in
   the peer's colour, typing ends it, Stop ends it.
4. The grant tree: directories open and shut, clicking a file fills the pane.
5. Reload mid-session: the page rejoins from the link with nothing kept.

## TLS: the https page speaks only wss/https (2026-09-17)

The owner loaded the Pi page over https and Firefox blocked two
subrequests as mixed active content: the page dialled
`ws://100.64.0.3:8080/session` and `http://100.64.0.3:8080/meta`.
Chromium merely warns, so every Chromium proof passed and lied.

Two halves, both landed:

- Pi: `~/selvage-demo/tls-proxy.py` terminates TLS on the tailnet IP
  only (`100.64.0.3:8444`) with the page's existing Let's Encrypt tailnet
  cert (reused by path, nothing copied) and forwards exactly
  `/session` (upgrade, then a byte tunnel) and `/meta` (plain relay) to
  loopback `:8080`, byte-identical both ways. Anything else is 404.
  The one exception is CORS on `/meta` (2026-09-18 owner defect: the page's
  meta check died on Same-Origin Policy): the proxy answers `OPTIONS`
  preflights itself (204, `GET, OPTIONS`) and adds
  `access-control-allow-origin` (the request `Origin` echoed, `*` without
  one) plus `vary: Origin` to the relayed `/meta` read — header-only, lengths
  and body untouched — so the https page's `/meta` check reads the version
  for real. `/session` stays byte-identical; CORS does not apply to the
  upgrade tunnel.
  Stdlib only — no caddy/nginx/socat on the Pi. Unit
  `selvage-tls-proxy.service` follows the runbook conventions (user unit,
  `Restart=always`, stdout appended to `~/selvage-demo/tls-proxy.log`,
  which is the record, not the journal); enabled with linger on, so it
  returns at boot. See `ai_notes/docs/runbook-pi-demo.md`.
- Page: the scheme-match rule (`src/browser/servers.ts`, pinned in
  `test/tls-scheme.test.ts`). An https page talks TLS only: the default
  server is `wss://lumi-raspberrypi.muskellunge-yo.ts.net:8444`, and any
  base — default or an explicit `?server=` — is matched to the page
  scheme (`ws://`→`wss://`, `http(s)://`→`wss://`, so the derived socket
  and `/meta` URLs both speak TLS). An http page keeps the plaintext
  default untouched. There is no mixed content at all now, which is also
  what makes the fix browser-agnostic: nothing left for Firefox to block.

Proven live (`npm run prove:tls` for the engine path, plus real Chromium
152 over CDP in `ai_notes/.tmp/web-eyeball/eye-tls.mjs`, shots
`*-tls.png`): the https page joins over wss with no `ws://`/`http://`
request anywhere in the run, edits converge both ways with a second
client, refused/unreachable joins keep their plain-words copy, and the
owner's double-`?` link joins with a clean token. The cross-origin
`https://:8444/meta` read still fails CORS, advisory as documented — the
proxy stays transparent and the handshake negotiates the truth.

## Slow-load card, styled first paint, CORS read (2026-09-18)

Three owner-observed defects from a live Firefox session, reproduced then fixed.

- Typed name wiped by the late bundle: the card shell was already inline HTML,
  but the bundle decided the variant, prefilled the name unconditionally, and
  parked focus at eval — so anything typed during a slow load died on arrival.
  Now `initJoinCard` (`src/browser/join.ts`) flips only the variant the address
  bar calls for and prefills only an untouched field; the editor stack
  (`src/browser/monaco.ts`, the megabytes) loads on join via a dynamic import,
  never before — the entry chunk fell from 2.2 MB to ~367 KB and no editor
  chunk or worker is fetched until the join; a pre-bundle inline guard holds an
  early submit (never a bare navigation, which would wipe the fields) and the
  bundle replays it once. `test/join-card-init.test.ts` pins preservation
  (red with the clobber restored), the inline shell, and the wiring.
- Forced layout before load (`Layout was forced before the page was fully
  loaded`): two causes. `app.css` is the Monaco stylesheet only and used to
  load render-blocking — it now preloads and applies via the print-swap, while
  the inline block carries all pre-join chrome, so first paint is styled with
  no editor CSS. And focus no longer parks at eval: it settles on `load` (at
  once when already loaded) and never steals a field being typed in.
- CORS on `https://…:8444/meta`: fixed at the proxy (see §TLS), so the https
  page's `/meta` check reads the version instead of dying on Same-Origin
  Policy; filed as the queued server-side item for selvaged itself, which was
  not touched. `scripts/check-cors.mjs` (`npm run check:cors`) asserts the
  headers live and against the fixture.
- Non-bug confirmed: a dead room id closes `4001` (`no such room: <id>`, rooms
  are memory-only) and the card reads `nothing answers at that link — ask the
  host for a fresh link and retry`, with no id, code, or mechanism wording.

Proven live (`LOAD VERDICT: PASS`, Pi demo, room minted over
`ws://100.64.0.3:8080`, local `dist/` on `:8081`): real Chromium 152 over CDP
(`ai_notes/.tmp/web-eyeball/eye-load.mjs`, fresh `chrome-profile-load` killed
after, shots `*-load.png`): the bundle held at the Fetch gate while the guest
typed and even submitted — card visible and already in its `--card` token with
no editor code fetched; on release the typed name survived, the held submit
joined once with no second click, the seed landed in the editor; the dead room
read its plain copy with zero leak patterns; zero page exceptions and zero
console errors besides the documented advisory plaintext-`/meta` CORS
downgrade and the join-failure diagnostic line. Verdict in
`ai_notes/.tmp/web-load-round.md`.

## Enter always joins; shared-text links never navigate (2026-09-18)

Two owner-observed defects from a live Firefox session, reproduced then fixed,
plus one verification.

- Enter joins from the name field. The card already carried a `<form>` with
  the name inside it and a `type="submit"` Join button, and Enter joined in
  real Chromium — so the defect was the reliance on implicit submission plus
  a silent pre-bundle hold. The form now listens for keydown Enter
  (`joinOnEnter` in `src/browser/join.ts`) and attempts the join itself with
  the default prevented, so no implicit submit follows: exactly one attempt
  in every browser, repeats ignored. The submit listener stays as the
  fallback (button activation, held-submit replays). The inline pre-bundle
  guard answers a held submit with `Joining…` on the disabled button — the
  hold used to be silent until the bundle arrived — and a refused replay
  restores the button in `attemptJoin`'s catch, so the guest can retry.
  Pinned by markup tests (name inside the form, submit button, `action="#"`)
  and `joinOnEnter` behaviour tests, and proven live: Enter from the name
  joins with no submit race (the keydown attempt suppresses the implicit
  submit), on the local bundle and on the deployed page.
- `file:///` Security Error. No asset was the source: every subresource the
  page loads is same-origin relative or https (audited live with zero
  `file:` requests), and no served first-party file references a `file:`
  URL (pinned by test). The reference is a link the page renders from shared
  text: room documents naming `[text](file:///…)` linkify (the
  `detected-link` decoration, proven live), and the editor's default
  external opener answers any non-http(s) target with `location.href = href`
  — the session page itself navigates at `file:///`, refused with exactly
  this error. `registerLinkGuard` (`src/browser/links.ts`, registered on
  join through the standalone opener service) swallows everything but
  http/https/mailto before the default opener runs; `command:` and relative
  targets go too, so shared text can neither run editor commands nor leave
  the page. `monaco.ts` re-exports only the two opener-service pieces and
  the editor stack still loads on join alone (entry `app.js` 367 → 368 KB).
  Proven live: activating a rendered `file:///` link neither navigates nor
  logs, while the same gesture on an `https` link still opens a new tab.
  The remaining `file://` strings inside the served editor bundles are inert
  (URI doc examples, the language-service profiler path remap, the markdown
  link pattern) — audited to never reach a URL sink; the guard is the
  enforcement.
- Dead-room verification, not a fix. `no such room` for a dead id is the
  right server answer (memory-only rooms die on restart) and the card copy
  stays verbatim `nothing answers at that link — ask the host for a fresh
  link and retry`, pinned for both the refusal and the 4001-close paths. A
  freshly minted room joins end to end: Enter join on the deployed page with
  a page-origin https share link, and the guest edit converges on the host
  (minted through `wss://…:8444`, the page's scheme-matched default — the
  resync-round lesson that `:8080` names a different session space).

Open from the same live runs, untouched: the unpublished advisory
  (`<path> — the host hasn't shared its text yet`) can land while the text
  is already in the editor (the sync arrived after the open resolved,
  twice) — the known timing question from the earlier eyeball notes,
  still open.

## Serve round: MIME table, queued join, minified build (2026-09-18)

Three owner-observed defects from a live Firefox console against the Pi page,
reproduced then fixed. Full record in `ai_notes/.tmp/web-serve-round.md`; the
owner's room from the report was never joined, every proof minted its own.

- S1 — language chunk served as text/html. The Pi serves whatever is in its
dist: a hashed chunk URL missing from it answers `404 File not found` with
`Content-Type: text/html`, which blocks the module load — byte-for-byte the
owner's symptom (the dist was stale, not the page). Fixed at the serving
layer: `serve.py` (`ai_notes/.tmp/web-hosting/serve.py`, deployed to
`~/selvage-web/serve.py`) now pins an explicit `extensions_map` for every
emitted extension (`.js`/`.mjs` → `text/javascript`, `.css`, `.map` →
`application/json` — Python's own `mimetypes` maps `.map` to nothing —
`.wasm`, `.svg`, `.webmanifest`, `.png`, `.ttf`, `.woff`/`.woff2`,
`.json`, `.ico`, `.txt`), independent of the host's mime.types; unknown
extensions keep the base-class octet-stream. 404s stay 404s (a missing
chunk must fail loudly, not masquerade). Regression is two layers:
`test/serve-types.test.ts` pins the contract against the canonical
`serve.py`, and `npm run check:types` (`scripts/check-content-types.mjs`)
asserts status plus Content-Type for every file in dist/ against the live
URL after each deploy — every file, not one per extension, so a stale chunk
fails even while `app.js` passes.
- S2 — join attempted before load finishes, then failed with `the page did
not finish loading — reload the page and retry`. It never fails now: the
submit snapshots the name, room and token and the join gate (`createJoinGate`
in `src/browser/join.ts`) queues the attempt until `load`, then lands it
exactly once — a second submit while queued or running is a duplicate, never
a second join — with the button reading `Joining…` throughout. A refused join
releases the gate so the guest can retry. The button also disables before the
editor stack arrives (previously only after), closing the double-click double-join.
A genuinely missing editor stack post-load reads `the editor code failed to
load — reload the page and retry` (the old wording lied about load).
`test/join-queue.test.ts` pins queue-once/release/retry; a structural test
pins the gate is constructed before the pre-bundle replay that uses it (a
same-round TDZ ordering bug stuck the card at `Joining…`, caught live).
- S3 — `file:///` Security Error. The opener guard was proven airtight live
(Ctrl+click on a rendered `file:///` link does nothing while the adjacent
`https://` link opens externally — same gesture, same path), as were hover,
middle-click, the TS worker boot with `file:` JSDoc/import/comment links,
suggestions and quickinfo. The remaining `file:` references reachable from
the served page were dead literals in the unminified bundles (Monaco/TypeScript
doc samples) — eliminated by shipping minified (`minify: true`,
`sourcesContent: false`; the three surviving string-building atoms in
`ts.worker.js` — profiler display and path serializer, never fetched — are
pinned as an audited allowlist). The build also wipes dist/ first: chunk
names carry content hashes, so incremental builds accumulated orphaned bundles
that were still served and scanned. The no-file test now scans the whole
built dist/ (every bundle, chunk, worker, map, stylesheet, manifest, icon,
binaries included) for `file://` outside the allowlist plus every
load-position shape (`href`/`src`/`url(`/`import(`/`Worker(`/`fetch(`/
`location.href`), instead of four files plus the shell.

Minified diet, same machine: entry `app.js` ~143 KB (was 2.3 MB dev),
editor-core chunk ~2.2 MB (was 4.8 MB), TS language client ~949 KB,
workers 259 KB + 5.7 MB (were 543 KB + 11.6 MB), dist/ 38 files, ~15 MB.

Proven live (real Chromium 152 over CDP, fresh profiles killed after):
`TYPES VERDICT: PASS` 38/38 files with exact types against the Pi URL (and
22/38 failing pre-resync, each a 404 text/html — the S1 window reproduced);
`SERVE-JOIN VERDICT: PASS` (early submit held pre-bundle, replay queued
behind a held image with `Joining…` and no guest on the wire, exactly one
landing after load, edit converged); `SERVE-FILE VERDICT: PASS` (file:
click swallowed, https control opened, zero file: requests/errors, location
stable). Shots `*-serve.png`, consoles `console-serve-*.json`.

The deployed Pi build for this round also carries the in-flight roster/tree
redesign that landed in the same tree mid-round (extracted
`icons.ts`/`roster.ts`/`presence.ts`, People heading, icon copy button,
presence badges) — green together, 145/145, but that redesign is its own
story, not this round's.

## Owner-UX batch (2026-09-18)

Twelve findings from the owner testing the page live, each verified in a
real Chromium against the Pi demo (`UXB VERDICT: PASS`,
`ai_notes/.tmp/web-eyeball/eye-uxb.mjs`, fresh `chrome-profile-uxb` killed
after, shots `*-uxb.png`). New modules: `src/browser/icons.ts` (the icon
set plus the per-type tree icon), `src/browser/roster.ts` (roster rows as a
testable render), `src/browser/presence.ts` (initials, one-per-line, the
glyph-margin badge CSS); `test/` gains `presence`, `roster` and `icons`.

1. Focus first file: `join` focuses the editor right after `openFirst`, so
   typing starts at once with no click-to-type. Proven live: post-join the
   active element is `textarea.inputarea` inside `#editor`, and inserted
   text converges on the host untouched by any click. The focus allowlist
   in `test/join-card-init.test.ts` names it (post-join, after awaits —
   never bundle-eval focus).
2. The `open: <path>` status is gone. Its only signal — which file is up —
   already reads on the tree highlight and the buffer, so plain opens and
   go-to landings write no status; the unpublished advisory keeps its
   reason minus the prefix (`<path> — the host hasn't shared its text
yet`); reseats read a bare `reconnected`. `test/flow-fixes.test.ts` pins
   the silent go-to.
3. Link box: shrunk to a 22em input-styled box, no separate Copy button —
   the link icon is the button (`aria-label="Copy invite link"`) and
   confirms with a check glyph plus the status line. Proven live: the
   clipboard holds the page-origin guest link after an icon click.
   (Superseded twice over: first the whole bar became the copy target —
   see §Owner-findings round below — then the status-line confirmation was
   deleted and the morph scoped to an overlay — see §Copy-control batch.)
4. Header: the session text is gone (`SESSION_HEADING` deleted with its
   test); the mark and `Selvage` wordmark suffice.
5. Roster heading: `Here` reads `People`, in the shell and everywhere the
docs named it.
6. Following: one stop control, on the banner — the most discoverable of
   the two, full-width in the followed peer's colour directly above the
   editor where the eye sits during a follow. The roster row reads
   `Following` and offers nothing to press (`test/roster.test.ts`).
7. Names stand out: roster names are 700-weight foreground against muted
   chrome, and the own name leads every roster as a mauve self row with a
   `you` marker and no actions. Peer colours stay data-driven on the
   swatch throughout.
8. Tree icons per type (TS/JS/MD/TXT lettered outlines in the set's
   stroke, `fileIcon` in `icons.ts`) with live highlighting proven per
   type: opening each file shows content token spans in several token
   kinds (js 25, md 10, ts 78), while `notes.txt` renders every line in
   the single uncoloured `mtk1` base token only — the honest plaintext,
   not pretending.
9. Presence parity with the desktop: glyph-margin initials badges in peer
   colours (one per line, lowest peer id winning the lane — the same rule
   the VS Code client draws by), a whole-line fill beside the selection
   fill, `label · role` hovers, and an overview-ruler tick. (Superseded:
   the fill is gone — an underline only — see §Owner-findings round
   below.) `peerColour`
   was verified identical across the two clients' bridges for sampled ids
   (same synced copy, same hash). The VS Code window itself could not run
   on the proving host (no display server, no editor binary), so parity is
   by shared rule plus these live DOM proofs: the badge class paints
   inside `.glyph-margin-widgets`, its `::after` draws the initials, and
   remote lines carry the highlight.
10. Roster presence refinement: no path text under any name (the `.where`
    line is deleted with its styles). Where someone is reads on the tree
    instead, as initials badges in peer colours on their file — so the
    tree re-renders on `roster`/`peers` notices too, not only on
    grant/document changes.
11. Minimap: it was `enabled: false` — no minimap at all — so the
    behind-the-scrollbar report resolved to enabling it properly
    (`side: 'right'`, glyph margin on). Measured live at 1440px: the
    119px minimap ends exactly where the 14px scrollbar begins, no
    overlap.
12. Regression-proofed: typecheck, minified build with the ws-absence
    assert, and the full suite green together with the serve round's work.

Proven live (`UXB VERDICT: PASS`, Pi demo `ws://100.64.0.3:8080/session`,
room minted with one file per backed type plus honest plaintext, a second
guest holding another file): join lands focused with instant typing that
converges; header/chrome/roster assertions above read from the live DOM;
icon copy fills the clipboard with the page-origin link; each file type
opens from its typed tree row with live token proof; tree badges name both
peers on their files; follow raises the single-stop banner and the banner
stop ends it; minimap and scrollbar measure side by side; 390px fits;
zero JS exceptions and no failing request but the known cross-origin
`/meta` advisory. Shots `01-joined-uxb.png` through `12-narrow-uxb.png`.
Verdict in `ai_notes/.tmp/web-eyeball-report.md`.


## Owner-findings round (2026-09-17)

Five findings from the owner testing the page live, each reproduced in a
real Chromium against the Pi demo before fixing (`READ VERDICT: PASS`,
`ai_notes/.tmp/web-eyeball/eye-read.mjs`, fresh timestamped profiles
removed after, shots `*-read.png`). Typecheck green, minified build green
with the ws-absence assert, suite 151/151.

1. Peer wash. Remote presence painted the entire line in the peer colour
   (`isWholeLine` plus a `background-color` fill in `renderCursors`),
   hiding the local caret and selection. The desktop rule
   (`vscode_client/src/adapter/decorations.ts`) draws two decoration types
   per peer colour only — a caret bar and a selection fill — and no line
   background at all, so the page matches it now: the fill is deleted and
   the line marker is a subtle underline (`border-bottom` in the peer's
   quarter-alpha fill, transparent background) beside the 2px caret bar,
   the glyph-margin initials badge, the `label · role` hover and the
   overview-ruler tick. The caret is always visible; selections keep their
   tint. `peerColour` re-verified identical across both clients' bridges
   for eight sampled ids (same synced copy, same hash); the VS Code window
   itself still cannot run on the proving host, so parity stays by shared
   rule plus live DOM proof. Pinned by rewritten `presence` tests including
   a no-full-line-wash assert (red before the fix), and live: zero
   background rules on whole-line classes, zero painted wash nodes, one
   underlined remote line, badge in the lane. Shot `01-wash-read.png`.
2. Link box. The whole bar is the copy target now: `#share-group` is one
   control (`role="button"`, `tabindex="0"`, the copy label) wrapping a
   readout input, and `src/browser/share-box.ts` (`test/share-box.test.ts`)
   wires click-anywhere plus Enter/Space with a morphing confirmation —
   the bar swaps to check plus `Link copied` briefly, then reverts — beside
   the kept status line. The icon-only `#copy-share` button is gone with
   its styles. Proven live: a bar-body click and a focus-plus-Enter each
   fill the clipboard with the page-origin guest link, the bar morphs and
   reverts. Shots `02-link-read.png`.
   (Superseded: the morph is an overlay that never removes the readout,
   and the status-line confirmation is deleted — see §Copy-control batch.)
3. Self row. The own name led the roster as bare text with a mauve `you`,
   reading as a section header. It is a roster row now: swatch (the shared
   `peerColour` of the session's own peer id, passed as `selfColour`),
   700-weight name like peers, the `you` marker kept but quiet
   (muted, smaller), and the actions slot with Go to/Follow disabled
   carrying the reason on hover (`this is you — …`, `you can't follow
   yourself`). Pinned in `test/roster.test.ts` (red before the fix);
   proven live in `03-self-read.png`.
4. Unpublished advisory. The top-right `<path> — the host hasn't shared
   its text yet` sentence is gone; no `setStatus` carries it (pinned in
   `test/join-screen.test.ts`). The state machine stays untouched:
   fetch-on-open plus `binding.isUnpublished` (still pinned in
   `test/flow-fixes.test.ts`). The state was judged truly undiscoverable
   without it — an unpublished file reads empty exactly like a cleared one
   — so the minimal replacement is a tree-row badge: the open file's own
   row wears a quiet `not yet shared` pill (reason on hover), and only the
   open file may (`showUnpublishedBadge` in `tree-state.ts` gates on the
   current path, because every unopened path reads unpublished too and
   badging those would mark the whole tree). Proven live: opening
   `todo.txt` writes no status while its row carries the pill.
   Shot `04-unpub-read.png`.
5. Highlighting and icons status check. Live per type from each file's own
   tree row: `util.js` 25 spans over six token classes with a JS icon,
   `notes.md` 10 spans over four classes with an MD icon, `main.ts` 77
   spans over six classes with a TS icon, and `notes.txt` 2 spans in the
   single uncoloured `mtk1` base token only with a TXT icon — plaintext
   honestly uncoloured is correct, not a regression. Nothing regressed, so
   nothing fixed; this is the record. Shots `05-util-js-read.png`,
   `05-notes-md-read.png`, `05-notes-txt-read.png`, `05-main-ts-read.png`.
   Console: zero JS exceptions; the only failing request is the known
   cross-origin `/meta` CORS downgrade, advisory as documented. Verdict in
   `ai_notes/.tmp/web-eyeball-report.md`.

## Copy-control batch (2026-09-18)

Seven findings from the owner testing the page live, each reproduced in a
real Chromium against the Pi demo before fixing (`COPY VERDICT: PASS`,
`ai_notes/.tmp/web-eyeball/eye-copy.mjs`, fresh `chrome-profile-copy-*`
removed after, shots `*-copy.png`). Typecheck green, minified build green
with the ws-absence assert, suite 162/162 (`test/copy-ux.test.ts` new: 8
checks, each red before its fix).

1. Copy flicker. `confirm()` replaced the bar's children with the
   confirmation badge, so the whole bar resized and the eye read it as a
   page flash. The confirmation is an overlay now (`span.confirm` appended
   once, `hidden` toggled, painted `absolute inset: 0` over the bar): the
   icon and the readout never leave, the bar keeps its box to the pixel
   (asserted live before/during/after), and a MutationObserver over the
   session bar records zero mutations outside the control through a full
   morph cycle. Pinned in `test/share-box.test.ts` and `test/copy-ux.test.ts`
   (red: the old code removed the readout).
2. Cursor. The bar carried `cursor: pointer` but the input and the morph
   fell back to their own cursors. One rule covers the control in every
   state: `#share-group, #share-group *, #share-group.copied,
   #share-group.copied *`. Asserted live on group, input and overlay
   mid-morph, pinned in `test/copy-ux.test.ts` (red: only the bar matched).
3. Top-right copy sentence gone. `invite link copied — anyone holding it
   joins while the room lives` is deleted with no replacement anywhere:
   the overlay morph is the whole confirmation, and the status line stays
   empty through a copy (asserted live). The clipboard-less fallback keeps
   its one-line next step (`Select the link and copy it by hand.`), which
   is a failure path, not a confirmation. Pinned in `test/copy-ux.test.ts`
   (red: the sentence was in `main.ts`).
4. Link privacy. The invite is a bearer credential on a shared screen, so
   the readout is masked at rest (`color: transparent` with a blurred
   shadow holding its shape) and reads on hover or focus only
   (`#share-group:hover #share, #share-group:focus-within #share`). The
   clipboard and the title keep the full bytes; only the paint is masked.
   Proven live: transparent at rest, named colour on focus and on a real
   hover, transparent again on leave. Shot `05-follow-copy.png` shows the
   masked bar in a real layout. Pinned in `test/copy-ux.test.ts` (red: the
   link read in full at rest).
5. Abbreviated host. The bar shows the link with a long hostname truncated
   middle-first (`abbreviateHost` in `share.ts`: whole at or under 24
   characters, else head plus ellipsis plus tail) while the full link stays
   as the input's title and the clipboard bytes (`fullShareLink` in
   `main.ts`; the hand-copy fallback briefly fields the full link, then
   restores the display). Proven live from a 37-character host:
   `http://lumi-raspber…o.localhost:8081/?room=…` on the bar, the full
   host in the title, `readText` equal to the title. Shot
   `04-abbrev-copy.png`. Pinned in `test/copy-ux.test.ts` plus
   `test/share.test.ts`-style unit pins (red: the helpers did not exist).
6. Join button. The card's primary was default-sized beside roster buttons
   at 0.78em. It is full-width now with its own padding (0.75em 1.2em),
   text (1.05em) and press (hover/active transitions plus a 1px active
   sink), still on the Mocha tokens. Proven live by computed style.
   Pinned in `test/copy-ux.test.ts` (red: one margin rule only).
7. Copy pass over every user-visible string: sentence case, periods instead
   of em dashes doing structural work, no new claims. The full before/after
   list stands at the end of this section; the lede, meta/og copy, invite
   line, labels, banner, pills, headings and diagnostics are verbatim.
   Two functional changes ride with it: the paste placeholder is a
   schematic built from the real page origin at runtime
   (`invitePlaceholder(pageOrigin)` → `<origin>/?room=…&token=…`, ellipsis
   placeholders, never literal ids, never the wire scheme — the shell keeps
   an `https://this-page/` fallback of the same shape), and the name field
   shows `Ada`. One deliberate carve-out the task forces: the schematic
   contains `room=…&token=…`, so the old blanket no-`token=` asserts now
   strip the schematic before scanning (pinned in
   `test/join-screen.test.ts`). New-string pins plus a no-em-dash sweep
   over failures, validation and invite errors live in
   `test/copy-ux.test.ts` (red: every dash joined two clauses).

Changed strings, before → after (unchanged strings are not listed):

- `invite link copied — anyone holding it joins while the room lives`
  → deleted, no replacement.
- `nothing answers at that link — ask the host for a fresh link and retry`
  → `Nothing answers at that link. Ask the host for a fresh link and retry.`
- `that link was refused — paste the whole link again and retry`
  → `That link was refused. Paste the whole link again and retry.`
- `the session already ended — ask the host for a fresh link and retry`
  → `The session already ended. Ask the host for a fresh link and retry.`
- `the session already has its host — ask the host for a guest link and retry`
  → `The session already has its host. Ask the host for a guest link and retry.`
- `the page and the session disagree — reload the page and retry`
  → `The page and the session disagree. Reload the page and retry.`
- `got no answer — check the link and retry` → `Got no answer. Check the link and retry.`
- `the join was refused — check the link and retry`
  → `The join was refused. Check the link and retry.`
- `couldn't reach the session — check your connection and retry`
  → `Couldn't reach the session. Check your connection and retry.`
- `that invite link can't be used — paste the whole link and retry`
  → `That invite link can't be used. Paste the whole link and retry.`
- `type the name other participants will see` → `Type the name other participants will see.`
- `that name is <n> characters and the room allows 32 — shorten it to join`
  → `That name is <n> characters and the room allows 32. Shorten it to join.`
- `that invite link does not name a session — paste the whole link`
  → `That invite link does not name a session. Paste the whole link.`
- `paste an invite link to join` → `Paste an invite link to join.`
- `following <name> — <path>` → `Following <name> in <path>`
- `connection dropped — reconnecting…` → `Connection dropped. Reconnecting…`
- `<status> — '<name>' is already here, so your row carries a short id`
  → `'<name>' is already here. Your row carries a short id.`
- `joined — waiting for the room to name a document`
  → `Joined. Waiting for the room to name a document.`
- `could not open <path>: …` → `Could not open <path>: …`
- `could not go to <name>: …` → `Could not go to <name>: …`
- `could not follow <name>: …` → `Could not follow <name>: …`
- `select the link and copy it by hand` → `Select the link and copy it by hand.`
- `the room shares no listing yet` → `The room shares no listing yet.`
- `reconnected — waiting for the room to name a document`
  → `Reconnected. Waiting for the room to name a document.`
- `reconnected` → `Reconnected.`
- `the editor code failed to load — reload the page and retry`
  → `The editor code failed to load. Reload the page and retry.`
- `this is you — there is nowhere to go to` → `This is you. There is nowhere to go to.`
- `you can't follow yourself` → `You can't follow yourself.`
- Paste placeholder `e.g. https://this-page/… — paste the whole invite link`
  → shell fallback `e.g. https://this-page/?room=…&token=…`, replaced at
  runtime with `<this-origin>/?room=…&token=…`.
- Name field, no placeholder → `Ada`.

Proven live (`COPY VERDICT: PASS`, Pi demo `ws://100.64.0.3:8080/session`,
room minted by this checkout's own engine, `dist/` on `:8081`): card
placeholders (runtime origin plus `Ada`), primary-sized Join with
transitions, blank-name and bad-paste copy with no em dash, page-link bar
with the full value as title, scoped morph (overlay only, bar box stable,
zero outside mutations, empty status, pointer on group/input/overlay),
clipboard equal to the full bytes, mask at rest with hover/focus reveal,
`Following copy-peer in notes.md` with no em dash, 37-character host
abbreviated mid-first with full title and bytes. Shots `01-card-copy.png`,
`02-errors-copy.png`, `03-morph-copy.png`, `04-abbrev-copy.png`,
`05-follow-copy.png`. Console: zero JS exceptions; the only failing
requests are the known cross-origin `/meta` CORS downgrade, advisory as
documented. Verdict in `ai_notes/.tmp/web-eyeball-report.md`.

## Room-gone terminal state (2026-09-18)

The host-leave probe (`ai_notes/.tmp/hostleave-probe.md`) found the web page
in limbo at grace expiry: it flashed `room closed: <reason>` and then rested
on bare `disconnected`, with a stale live-looking roster (Go to/Follow still
offered), a dead but copyable share link, typing silently swallowed into the
local model, and the tree shedding never-opened files when the engine cleared
its local grant on the 4003 close. Nvim (full reset) and VS Code (dispose +
status gone) were already explicit. This batch matches that bar, in page form
— the session chrome stays up, but everything in it reads over:

- Status keeps its sentence. The binding reports `roomGone` as its own
  notice ahead of the trailing `disconnected`, and the page's terminal state
  (`endedMessage`) ignores every later transient status — the resting line
  reads `The room is closed — host did not return.` A terminal disconnect
  with no room-gone reason (reconnection gave up) ends with its own
  sentence instead (`SESSION_ENDED_MESSAGE`). Copy lives in
  `src/browser/ended.ts`, shared by the page, the binding and the tests.
- Roster clears with dead actions. The binding's `participants()` reads empty
  past the end, and the page renders nobody with `disabled` rows whose hover
  names the reason (`ROSTER_DISABLED_REASON`) — never a live-looking Go
  to/Follow. `renderRoster` takes the disabled view; the self row was already
  reasoned-disabled.
- Share link retires. `ShareBox.retire` stops all copying (click, Enter,
  Space, confirmation) and marks the bar `aria-disabled`; the page disables
  the readout with the reason as its title (`SHARE_RETIRED_REASON`). The dead
  link stays readable but never reaches the clipboard.
- Editor goes read-only with the message. The binding sets
  `readOnly: true` on entry, so keystrokes are prevented visibly; a change
  that still slips through re-announces the terminal sentence instead of
  publishing, and go-to/follow/tree opens past the end refuse or echo it.
  Nothing typed goes nowhere silently.
- Tree freezes on the snapshot, visibly stale. The page snapshots
  `binding.grantListing()` on entry — before the engine sheds its local
  grant on the terminal close — and renders the snapshot under a stale
  marker (`TREE_STALE_NOTE`) with dead rows. The never-opened file stays
  listed; nothing is silently shed.
- Rejoin is manual only. The page never re-hellos on its own, and no
  auto-reclaim exists or was added: `test/room-gone.test.ts` scans
  `src/browser/` and fails on any host-role hello or room mint, pinning the
  all-clear the probe verified live (guests stay `guest` end to end; a dead
  token is refused `room_unknown`). A dead link rejoins only through the
  card, which refuses it plainly (`Nothing answers at that link. …`).

Tests: `test/room-gone.test.ts` (11) — copy, binding end/lock/typing-echo/
go-to-follow refusal, roster disabled-vs-live, share retire, snapshot rule,
no-host-hello scan — plus one updated expectation in `test/binding.test.ts`
(the new `roomGone` notice). Suite 173/173, typecheck and minified build
(with the ws-absence assert) green.

Proven live (`GONE VERDICT: PASS`, Pi demo `ws://100.64.0.3:8080/session`,
room minted by a scripted holder with `demo.ts`/`notes.md`/`todo.txt` granted,
`dist/` on `:8081`, real Chromium 152 over CDP with a fresh profile killed
after): holder SIGKILLed through the 30 s grace to gone, both guests resting
on the sentence with cleared rosters, retired links, read-only editors and
three-row stale trees; a post-death keystroke changed nothing with the
sentence standing; the dead link refused at the card; no rejoin or reclaim
fired on its own. Shots `gone-*-end.png`, driver `goneleg-end.mjs`, holder
`holder-gone-end.mjs`. Verdict in `ai_notes/.tmp/web-eyeball-report.md`.

## Join card and chrome (2026-09-18)

Six findings from the owner on the live page: the confirm button's label sat
left and its type ran large; the card was a wall of prose before the one
question it asks; the invite link snapped into view; the link in the bar was
still too revealing; `#status` was still in the served shell (the fourth ask);
and the page was not pretty. Typecheck green, minified build green with the
ws-absence assert, suite **197/197** (`test/join-chrome.test.ts` new: 24
checks, 16 of them red against `e7bf124`).

1. **`#status` is gone.** No node in the shell, no rule (the media query's
   included), no `#status` anywhere in `src/browser/`, no `setStatus`, no read
   and no write. A scan test pins it by id, by role and by the bare word in the
   shell, and it also fails on the historical driver scripts under `scripts/`
   still selecting it — those three now read `#session-note`. Nothing the line
   carried is restated anywhere: the messages that need a home have one, and
   the rest are dropped (see below).
2. **The card is the flow.** One heading (`Join a shared session`), the name
   field, the confirm — and the paste box only for a page opened without a
   link. The lede paragraph and the `You've been invited to a live session`
   line are deleted, copy and all: with the heading above it, the line only
   repeated the invitation. `initJoinCard` lost its roomline field rather than
   keeping a dead one.
3. **The primary control reads deliberate.** `#join-button` centres its label
   (`justify-content: center`), drops to `1em` from `1.05em`, keeps
   `padding: 0.8em 1.1em` and its press; the name field is `1rem` with
   `padding: 0.7em`. Measured live in the browser: `justifyContent: center`,
   `fontSize: 14px` (the old one was 14.7px), `padding: 11.2px 15.4px`; the
   field padding `9.8px 11.2px`. The card no longer renders left-aligned
   because the shared `button` rule has no `justify-content`.
4. **The link fades.** The masked readout keeps its blur and gains
   `transition: color 180ms ease, text-shadow 180ms ease`, so hover and focus
   fade the value in instead of swapping it. Sampled in the real browser: at
   rest `rgba(0,0,0,0)` with an 8px shadow, 70 ms after focus
   `rgba(166,173,200,0.64)` with a 2.9px shadow, then `rgb(166,173,200)` with
   no shadow. Under `prefers-reduced-motion: reduce` the transition is cut,
   not shortened (and so is the button's press).
5. **The bar shortens the credential, not just the host.** `abbreviateHost`
   became `abbreviateMiddle` (one rule, three callers) and `displayShareLink`
   shortens the `room` and `token` query values to 12 characters middle-first,
   each on its own bound; the host bound stays 24 and the `server` value stays
   whole (it names where the room is, not a permission). Live:
   `?room=r-6a6a…af57e&token=45a54a…9bc53` on the bar, the whole link as the
   element's title, and a real `navigator.clipboard.readText()` returned the
   full bytes, byte-identical to the title.
6. **The chrome speaks the landing page's language.** One Mocha token set
   (`--background`, `--card`, `--foreground`, `--muted-foreground`, `--primary`
   are the site's own values), borders moved to surface0 with a new
   `--border-strong` for the edges that must stay visible (the open tree row,
   the follow outline, the unpublished pill), one radius scale, the svp mark at
   3.25rem over the blurred preview, the card centred instead of pinned to
   12vh, a deeper veil (0.6 at 11px) and a softer shadow. A test computes WCAG
   contrast from the tokens in the CSS itself: text, subtext, the primary
   label, the failure red and the placeholder all land at or above 4.5:1 (the
   tightest is the placeholder `#7f849c` on `#11111b`, 5.07:1). No gradient, no
   fetched font, no new dependency.

Where a message lives now — the owner's standard is that nothing fails
silently:

- **The host's socket detaching** (`host left — the room closes in 30s unless
  the host returns`) and **the end of the room** (`The room is closed — host
  did not return.`, or `Disconnected — the session ended. …` for a terminal
  drop with no reason) show in the session chrome as `#session-note`: an
  inline strip under the bar, a dot and the sentence, yellow for the grace and
  red for the end (7.58:1 on mantle). It is a lifecycle line, not a ticker: it
  appears only while something is true of the room, and the end never leaves.
  Both homes are live regions (`role="alert"`) that stay in the DOM and hide
  through `:empty`, so the sentence a guest cannot see is still the sentence a
  screen reader hears — the role the deleted span used to carry. The same
  transient channel carries `host <name> is back`, which clears the grace
  strip again; with the status line gone nothing else would have, and the
  warning would have kept standing there after the host returned.
- **An action that refused** — a file that would not open, a go-to or follow
  that failed, the hand-copy fallback when the clipboard is unavailable —
  shows in `#alert`: a failure strip at the bottom of the window,
  `role="alert"`, a red left rule, standing 7 s and then gone. It is empty at
  rest and `:empty` hides it (a live region that is never removed announces
  reliably); it never shows success, progress or connection chatter.
- **Dropped**, deliberately, with nothing in their place: `Joined. Waiting for
  the room to name a document.` (the tree already reads `The room shares no
  listing yet.`), `'<name>' is already here. Your row carries a short id.`
  (the roster row already carries the short id), the follow landings
  (`Following <n> in <path>` — the banner names who, the tree and the buffer
  name where), the transients `Connection dropped. Reconnecting…`,
  `Reconnected.` and `disconnected` (nothing to act on: the socket reseats and
  the room converges on its own), `room closed: <reason>` (the terminal
  sentence supersedes it), and the past-the-end refusals that echoed the
  terminal sentence from a dead control — every one of those controls is
  `disabled` or `aria-disabled` with its reason on hover, so the refusal is
  already visible. With the drop status gone, the `linkDown`/`reseated()`
  bookkeeping that existed only to retire it went too. The one transient
  sentence that is routed instead of dropped is the host's return, which
  clears the grace strip.

One coupling is unavoidable and is pinned rather than hidden: the binding has
no notice kind for the host's grace window, so that warning and its
`host <name> is back` all-clear arrive as transient text, and
`sessionNoteSignal` in `notice.ts` maps exactly those two sentences — every
other transient sentence is chatter. `test/join-chrome.test.ts` drives
`MonacoBinding.report({ kind: 'hostDetached' })` and `{ kind: 'hostAttached' }`
through the binding and maps the sentences that come out, so a reworded binding
can neither drop the warning nor leave it standing after the host is back.

Proven live (`EYEBALL_DONE`, no console exceptions): the room hosted by
`scripts/tmp-webflow-host.mjs`, `dist/` served on `:8081`, real Chromium 152
from the nix store over CDP, profiles and shots under `./.tmp/live/` (the
native browser tool cannot launch on this host — its bundled Chrome misses
`libglib-2.0.so.0`), drivers `.tmp/live/eyeball.mjs`, `.tmp/live/clip.mjs`,
`.tmp/live/mobile.mjs`. Read off the served page: the bare card is
`Join a shared session | Paste your invite link | The name other participants
see | Join`, with `document.getElementById('status') === null` and zero
`[role="status"]` nodes; the invited card is the heading, the name and Join
with focus already in the field; the joined bar abbreviates the room id and the
token while the title and the clipboard keep the whole link; the reveal
interpolates mid-fade; the host's death raises the yellow grace strip and, 30 s
later, the red end strip with the roster dead, the link retired
(`aria-disabled`, its title naming the reason) and the tree frozen under its
stale marker; the alert paints bottom centre. Shots `01-card-bare.png`,
`03-card-invited.png`, `04-joined.png`, `05-share-revealed.png`,
`07-host-left.png`, `08-room-gone.png`, `09-alert.png`, `10-copy-whole.png`,
`11-card-narrow.png`, `12-joined-narrow.png`. The alert's data path (which
failures reach it, that success never does, that it clears itself) is covered
by unit tests against the wired module, not by the live run — no reachable
failure was at hand in the demo room — and only its paint was eyeballed. The
clipboard read needed `Emulation.setFocusEmulationEnabled` plus a granted
permission, so it is the real clipboard, not a stub.

Open questions this round did not settle: whether a dropped socket deserves any
visible state at all (today it has none, by design); whether the owner accepts a
failure alert as a home rather than a status line by another name (it appears
only on a failure and leaves on its own); the 12-character bound for the room
id and the token, which is a guess at what still reads as an identifier; and
whether the grace-window warning should become its own notice kind in the
binding instead of a sentence the page matches by its opening words.

## M2 needs (polish / publish-readiness)

- A real browser pass of the checklist above, on light and dark, narrow and
  wide — the layout has had no eyes on it. (2026-09-17: full pass done on the
  dark Mocha theme, narrow and wide; see the eyeball report appendix. Light
  is not a supported mode — the page is dark-only.)
- Minified production build and a second diet look (landed 2026-09-18 in the
  serve round: `minify: true`, `sourcesContent: false`, entry ~143 KB, the TS
  worker still dominates the total; a further diet means a slimmer editor).
- Same-origin hosting decision for the demo page or the queued server-side
  CORS item (the plaintext port still answers no CORS; the TLS proxy already
  answers it for the https page) — one of the two, not both.
- Display-name validation messages shared with the desktop clients, if they
  drift; the page enforces non-blank plus the 32-unit bound (see §Join card).
- The empty public `web_client` repo decision from M0 still stands with the
  owner (keep as the future home, or remove); nothing is published until code
  lands there.
