# Browser client notes (M0–M1)

Decisions settled while scaffolding and building, with what is deliberately
left out.

## Link shape

**Superseded in part** by *The link is the server (2026-09-21)* below: the link is now the
room's own page and carries no `server`, the page's server is derived from the link's own
origin rather than read from the query or from a built-in default, and `PUBLIC_PAGE_ORIGIN`
went with the page origin that was configured separately.

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

- No hosting **without a gesture**: the page mints a room only from the folder
  picker, so a load, a timer or a replayed submit can never start one, and the
  guest path never asks for the host role. The stance written here through M1 —
  "guest joins only" — is the one this file said to revisit if hosting were ever
  wanted, and it was: see *Starting a room from the page* below. What it was
  avoiding is answered rather than ignored (a reload, the truth while the tab is
  closed), and what a browser cannot do — host in Firefox or Safari — is a
  sentence on the card rather than a control.
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

**Superseded** by *The room closing leaves, and the links read* below: the page
no longer rests on a dead session — it leaves it and says why on the card — so
the resting chrome this section describes (a frozen tree, a dead roster, a
retired link, a read-only editor left on screen) was deleted with it.

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

## The room closing leaves, and the links read (2026-09-18)

Owner, on the state the round above produced: "if the room is closed the
instance should just disconnect with a toast/popup similar to the joining one".
This supersedes the resting terminal state of **Room-gone terminal state
(2026-09-18)** — that section's stale tree, dead roster, retired link and
read-only editor left on screen are gone from the page.

**The page leaves.** On the binding's `roomGone` — and on a terminal
`disconnected` that carries no reason, which ends a session just the same — the
page drops the session whole and puts the card back. `dropSession` in
`ended.ts` disposes the binding, then the editor widget it drew into, then the
engine's socket, in that order, each step guarded so one throwing never strands
the others (the failure goes to the console rather than the void). The session
bar, the follow banner, the workspace, the tree and the roster come down, the
note is cleared, the per-session state is reset, the editor host is emptied, the
join gate is released, and the card returns over the blurred preview with the
paste box open, the name still typed, and focus in the field. Read off the
served page after a host SIGKILL at grace expiry: card shown, message
`The room is gone (host did not return). Paste a fresh invite link to join
another session.`, paste box shown, empty and focused, the button reading
`Join` and enabled, session/workspace/follow hidden, `#share` empty, the
editor's DOM gone, no error line, and zero console exceptions.

**What went with it.** `endedMessage` and every branch that read it; the frozen
tree (`visibleListing`, `TREE_STALE_NOTE`); the dead roster
(`ROSTER_DISABLED_REASON`, `roster.ts`'s `disabled`/`disabledReason` view); the
retired link (`SHARE_RETIRED_REASON`, `ShareBox.retire`, the
`#share-group.retired` rules); and the session note's `ended` state, so the
strip is now only ever the grace warning. `ended.ts` stays because something
still uses it: `editor.ts` imports `roomGoneMessage` for the terminal echo it
sends while a keystroke slips through, and the page uses `roomGoneMessage`,
`SESSION_ENDED_MESSAGE`, `REJOIN_PROMPT`, `sessionOverMessage` and
`dropSession`. The binding's own terminal behaviour is untouched — it still
empties the roster, sets the editor read-only and refuses go-to/follow past the
end, which is what covers the window between the notice and the teardown, and
`test/room-gone.test.ts` still pins it.

**The words are the desktop clients'.** `roomGoneMessage` reads
`The room is gone (<reason>).` — vscode's sentence without its `Selvage:`
prefix, nvim's verbatim — with `no reason given` when the report carries none,
and the card adds the one next step
(`Paste a fresh invite link to join another session.`). No em dash, and no
claim about a room that no longer exists.

**The way back.** The address bar still names the room that just closed, and a
rejoin would otherwise retry it: the first live proof run pasted a fresh link
and got `Nothing answers at that link. Ask the host for a fresh link and
retry.`, because `resolveJoin` lets the address-bar link win by design. The
page now decides which source is the way in — `addressBarInvite(isTheInvite,
search)` hands the join nothing from the bar once a room has closed — pinned by
a test that fails on the old composition. The second run: the pasted fresh link
joins, the chrome returns with the new room's roster and tree, the bar shows
the new link, and exactly one editor lives in `#editor` (the dead session's is
disposed, not stacked behind it).

**The two clipped links.** Same instrument, same 1280×900 window, Chromium 152,
a real room on the demo server:

| measured | before | after |
| --- | --- | --- |
| `#share` value | 59 chars: `http://127.0.0.1:8081/?room=r-0d9b…&token=…` | 38 chars: `/?room=r-98b4…77f7e&token=896498…1f210` |
| `#share` clientWidth / scrollWidth | 148 / 413 px — a scrolled prefix | 280 / 280 px — the whole value, `scrollLeft` 0 |
| `#share-group` width | 180 px | 315 px |
| paste hint vs its field | `http://127.0.0.1:8081/?room=…&token=…`, 37 chars, 300 px in 254 px — clipped | `/?room=…&token=…`, 16 chars, 150 px in 254 px — whole |

`displayShareLink(link, pageOrigin)` drops the scheme and the host when the
link is on the page's own origin (the guest is looking at the page it points
to) and keeps a shortened host when it is somewhere else, and `fitReadout`
sizes the readout to the value it carries — `size` counts the font's *average*
character and a link of digits, lowercase and ellipses runs wider, so the
fallback carries 15 % slack, while `field-sizing: content` in the shell fits it
exactly where the engine has it (probed: a 275 px value in a 275 px readout).
The paste hint is a static schematic in the shell now, so no origin can clip it;
`invitePlaceholder` and its runtime assignment are gone.

Tests: suite **210/210** (`test/session-over.test.ts` new, 18 checks, every one
red against the previous revision; `test/room-gone.test.ts` reduced to the
binding and the no-host-hello scan; `test/copy-ux.test.ts`,
`test/join-screen.test.ts`, `test/join-card-init.test.ts` and
`test/join-chrome.test.ts` updated for the copy, the hint, the fourth focus
call and the note's single state), typecheck green, minified build green with
the ws-absence assert.

Proven live (`CLOSED_DONE`, zero console exceptions): room hosted by
`scripts/tmp-webflow-host.mjs`, `dist/` on `:8081`, Chromium 152 from the nix
store over CDP, drivers `.tmp/live/measure.mjs` (before/after numbers),
`.tmp/live/closed.mjs` (the popup and the rejoin), `.tmp/live/sizing-probe.mjs`
(the sizing options), `.tmp/live/bar-look.mjs` (the revealed bar), shots
`hint-before.png` / `hint-after.png`, `bar-before.png` / `20-joined-bar.png`,
`21-grace-warning.png`, `22-room-closed-popup.png`, `23-rejoined.png`,
`25-bar-masked.png`, `26-bar-revealed.png`.

Could not verify: a real hover (reveal proven by focus and by computed style),
the rejoin after a *terminal disconnect with no reason* (no way to make the
engine give up reconnecting on demand in the demo room — the same `leaveSession`
path is taken, and the copy is unit-pinned), and the stack in an engine without
`field-sizing` (the `size` fallback was measured in Chromium by setting `size`
directly: 281 px readout for a 275 px value, and the fallback's own slack is
the tested part).

Open questions: whether leaving should also clear the address bar's dead room
(it keeps it; a reload refuses that link plainly), whether the card should keep
its `Join a shared session` heading above the closure line or swap it for the
reason, and whether the grace warning should keep the session note at all now
that it is the only thing the strip ever shows.

## Editor icons and backing languages (2026-09-18)

Owner, twice: "there shouldnt be a colored underline on the line the other
person is on" and "file icons and syntax highlighting are still not there".
Both were reproduced against a real room; each had a different cause.

**The underline is gone.** Remote presence drew a whole-line `border-bottom`
in the peer's quarter-alpha colour beside the caret bar, the badge, the hover
and the ruler tick. The bar, badge, hover and tick stay; the line marker does
not. The desktop draws the same pair — caret bar and selection fill,
`vscode_client/src/adapter/decorations.ts` — and a whole-line rule under a
peer's line reads as the document's own rule besides. `renderCursors` now
returns a caret alone for a bare cursor and a caret plus an inline fill for a
selection. `test/presence.test.ts` pins the absence (no whole-line decoration,
no minted rule carrying `border-bottom`) and the caret bar and ruler tick;
`test/binding.test.ts` follows the same shift.

**The tree icons read now.** `icons.ts` drew a 16-unit page outline with a
`<text font-size="4.6">` label; at a ~14 px row that label was under 4 px and
every file read as the same page. A typed file is now a solid page in the
type's colour with a bold 7.6-unit label — TS blue, JS yellow, Rust orange,
shell green, YAML red, Nix blue, and so on — while the generic and text files
stay the muted outline, so an unbacked type is visibly a plain file. The
extension map grew to the types a room plausibly holds (Rust, CSS/SCSS/Less,
JSON, HTML/XML/SVG, shell, TOML, YAML, Nix, INI, Python, Go, C/C++, Java, SQL,
Lua, Docker, …) and gained a filename map for `Dockerfile` and
`.editorconfig`.

**The highlighting: 39 languages, lazily.** `languages.ts` mapped ten
extensions. It now names 39 languages over 97 extensions and five filenames:
every basic language Monaco 0.52.2 ships that a room plausibly holds, plus
JSON, TOML and Nix — which Monaco does not ship at all, so
`tokenizers/{json,toml,nix}.ts` are this repository's own small Monarch sets,
colour-only, no worker. Each is registered through Monaco's own
`registerLanguage` with a dynamic loader, so the tokenizer body is a
`lang-*.js` chunk fetched the first time a document of that language opens;
only the id and its loader register with the runtime. Unknown extensions stay
`plaintext`.

Bundle, minified, same machine:

| measured | before | after |
| --- | --- | --- |
| entry `app.js` | 150,482 B | 154,855 B (+4,373, +2.9%) |
| runtime chunk fetched on join | 971,885 B | 979,437 B (+7,552, +0.8%) |
| a newly-backed document fetches | nothing | its tokenizer chunk: `rust.js` 4,592 B, `css.js` 4,940 B, `shell.js` 3,507 B, `json.ts` 774 B, `toml.ts` 1,197 B, `nix.ts` 1,829 B |

The entry grows only by the icon SVGs and the two maps; the runtime chunk by
the 36 registration modules. The tokenizer bodies stay out of both.

**Everything is green.** `npm run typecheck` clean; `npm test` **215/215**
(the new icon and language cases, and the presence tests that pin the marker's
absence); `npm run build` green with the `ws`-absence assert, `dist/` rebuilt
last so the bundle matches `src`.

Proven in a real browser (Chromium 152 from the nix store over CDP, profile
under `.tmp/live/`, `dist/` on `:8081`, a real room on the demo server):
driver `.tmp/live/icons.mjs`, host `.tmp/live/host.mjs`, shots under
`.tmp/live/icons/`. Opening every granted file read a distinct token-class
set — Rust 9, Nix 10, CSS 8, shell 7, JSON 7, TOML 3, `todo.txt` 1
(plaintext) — and fetched exactly its own chunk (table above). The peer caret
on `main.rs` left the binding's only line rule `.selvage-0 { border-left: 2px
solid #c678dd; }`, with one caret-bar element and zero elements carrying a
`border-bottom`; shots `01-notes.md.png` … `08-todo.txt.png`,
`90-main.rs-caret.png`, `91-tree.png`.

**The build stopped dirtying the tree.** Every `npm run build` rewrote the
four `dist/*.png` icons with a new ImageMagick `tIME` chunk and
`date:timestamp` tag, byte-identical otherwise. `scripts/build.mjs` now passes
`-define png:exclude-chunk=time +set date:timestamp`; two consecutive builds
hash identically, and `date:create`/`date:modify` and the source's `Software`
tag survive.

Could not verify: a second peer (one host peer only), and the marker in a
non-Chromium engine. Open questions: whether `.zsh` belongs to the shell
tokenizer (mapped; `.fish` and `.ksh` are not), whether `.conf`/`.cfg` should
be INI (mapped; a guess), and whether JSON deserves the schema-aware language
service rather than this colour-only set (it would add a worker).
## Independent review round: the tokenizer, the grace note and the proofs (2026-09-18)

A review of the icons-and-languages round found one blocking defect, three
smaller ones and four leftovers. All are fixed here, each with a test that
fails without it; `npm test` goes 215/215 to **234/234**.

**B1: the TOML set threw on every assignment line.** `tokenizers/toml.ts` sent
`[{}[].=,]` to `@brackets`. Monarch compiles a tokenizer from the *language
definition* alone — `basic-languages/_.contribution.js` hands the tokens
provider `mod.language`, and `conf` only ever reaches
`setLanguageConfiguration` — and `compile()` defaults the bracket list to
`{} [] () <>` only when the definition carries no `brackets` of its own. The
file's `conf.brackets` never reached the lexer, so `=` had no pair:
`compile('toml', language)` yields brackets `"{} [] () <>"` and the lexer threw
`toml: @brackets token returned but no bracket defined as: =` on the first
assignment of every pass. `Cargo.toml` — the file that motivated the set — lost
its colour, and the page raised an uncaught error per pass. The rule is now
`[/[{}[\]]/, '@brackets']` with `[/[.,=]/, 'delimiter']` beside it: the
assignment operators are punctuation, not brackets. JSON and Nix were checked
for the same mistake and are clean — every character either sends to `@brackets`
is in the default list — and are pinned by the same test.

`test/tokenizers.test.ts` is new and drives the real path: `compile()` the
language definition, then Monaco's own `MonarchTokenizer` line by line, carrying
the end state, over a `Cargo.toml` (table header, `name = "selvage"`,
`version = "0.1.0"`, an inline table, an array, an indented multi-line string, a
dotted key, a date, a number), a `package.json` and a `flake.nix` — asserting no
throw *and* the classes that come out. `test/languages.test.ts` only mapped a
path to a language id, which is how a set that threw on line two passed a round.

Live, Chromium 152 from the nix store over CDP, `dist/` on `:8081`, the icons
round's own driver under `.tmp/live/` with the console watch it never had (it
recorded token classes but watched no console — the reason this read as a
success):

| `Cargo.toml`, the same file | token classes | console |
| --- | --- | --- |
| before | 3 — base, string, one bracket | 5 uncaught `@brackets … no bracket defined as: =` |
| after | 8 — base, key, string, number, type, `delimiter`, `delimiter.curly`, `delimiter.square` | clean |

The other files still read as before (Rust 9, Nix 10, CSS 8, shell 7, JSON 7,
`todo.txt` 1), and the peer caret still leaves one rule with no underline. The
previous round's own line — "TOML 3" — was the symptom, read as a result.

**S1: the grace warning could stand for the rest of a session.** The note came
down only on the literal sentence `host <name> is back`, which rides the live
`host.attached` frame; a guest whose socket was down at that instant missed the
one all-clear, reconnected and read "the room closes in 30s unless the host
returns" indefinitely. Two changes. The fallback pattern is now
`/^host (.*) is back$/`: the engine's own validation accepts an empty
`display_name` and the binding prints whatever the peer carries, so the
all-clear can arrive as `host  is back`. And the note also clears on any
membership report that names the host — the `roster` and `peers` notices, read
through `hostPresent(participants)` in `notice.ts`.

That the membership is a safe all-clear was checked, not assumed: the room sends
`peer.left` for the host before `host.detached`, so through the grace the guest's
own peer list holds no host at all. Probed live against the demo server
(`.tmp/grace-probe.mjs`): before the detach the guest sees `[["grace-host","host"]]`
and `hostPresent` is true; during the grace it sees `[]`, `hostPresent` false,
and the `host left — the room closes in 30s unless the host returns` sentence. A
membership report can only name the host once it is really back.

**S2: `npm run prove:flow2` could not pass.** It still expected `following
flow2-host — <path>`, `connection dropped — reconnecting…`, an `open: <path>`
go-to sentence the round deleted, and a join-error copy reworded two rounds ago.
The script still has value — it is the only proof that go-to, follow, the
unpublished read and the reconnect re-seat work against a real server — so it is
updated rather than deleted: a go-to now proves it lands *and* stays silent, a
follow proves `Following flow2-host in notes.md`, the drop proves `Connection
dropped. Reconnecting…`, the join error proves `Couldn't reach the session.
Check your connection and retry.` Its notices are read by *text*, the way the
page reads them, never by notice kind — and the guard in
`test/join-chrome.test.ts` that greps drivers for `#status|setStatus` now flags
a driver reading them by the internal `status` kind too. Live: `PROOF OK`
against the demo server.

**The leftovers.**

- The session note was `role="alert"` (assertive) where the deleted status span
  was polite: it is `aria-live="polite"` now — the equivalent, and no `status`
  word back in the shell (`role="status"` would have been). The failure alert
  stays assertive.
- `registerLinkGuard` registers an opener on the editor's service and threw its
  `{dispose}` away, leaking one opener per join. It returns the registration now,
  and the page hands it to `dropSession` (disposed first, before the binding)
  and drops a refused join's registration before a retry.
- The peer row's `Go to` was disabled with no reason while the self row's dead
  actions carried titles: it says `They are not in a document yet`, and
  `test/roster.test.ts` pins that *every* disabled action carries one.
  `test/session-over.test.ts` no longer claims the roster draws no dead actions
  at all — it draws them reasoned, and the terminal vocabulary is what is gone.
- The icon determinism fix was incomplete: `tIME` and `date:timestamp` went, but
  `date:create`/`date:modify` were inherited from `public/mark-opaque.png`'s own
  mtime, so a fresh clone rebuilt four different PNGs. `scripts/dist-icons.mjs`
  now owns the one render (used by the build and by the test), drops all four
  clock chunks and keeps the source's `Software` tag. Two builds with the
  source's mtime twenty years apart hash identically, and the pixels are
  untouched (`magick identify -format '%#'` equal before and after).

**Two things deliberately left alone**, the review's own instruction being to
record the decision rather than churn the code:

- the internal `{ kind: 'status' }` notice kind stays: it is the binding's own
  vocabulary — the desktop clients' `Report` channel — and the page routes those
  sentences by text (`sessionNoteSignal`) to the note and the alert, so a driver
  should read them the same way;
- the binding's terminal state (`enterTerminal`, `terminalReason`) stays, and so
  does the doc comment in `main.ts` that still describes it: the page leaves a
  dead room above it (`dropSession`), but the resting state is the adapter
  vocabulary both desktop clients implement, and deleting it would take the page
  further from them than the design says.

Green: `npm run typecheck` clean, `npm test` 234/234, `npm run build` with the
`ws`-absence assert, `dist/` rebuilt last. Live: the full icons driver pass
(join, every file, the caret) with a clean console, and `prove:flow2` `PROOF OK`.

Could not verify: the grace warning coming down in a real browser — the
membership path is pinned at the binding and probed against the live server, but
no browser join survived a host detach here — and the *look* of a coloured
`Cargo.toml`; the token classes were recorded, the pixels were not eyeballed.
Open questions: whether `hostPresent` should be the trigger at all or the attach
frame plus the reconnect snapshot only (the probe says the membership is only
ever host-bearing when the host is really back, so the two agree); whether
`delimiter` is the right class for TOML's `=`/`.`/`,` (JSON and Nix use
`delimiter` for the same punctuation); that a dotted Nix builtin
(`builtins.getEnv`) still reads as a plain identifier while a bare `length`
reads as `predefined` (cosmetic, unchanged); and whether the orphaned
terminal-state doc comment in `main.ts` belongs beside `enterTerminal` in
`editor.ts`.

## First frame, the inlined mark, the hover and the server a link may name (2026-09-18)

Five defects, four of them owner-facing, each reproduced before it was fixed and
each pinned by a test that fails without the fix.

**The first frame is the final card.** Reproduced on the built page with
`app.js` held at the CDP Fetch gate: on a bare open the first painted frame was
a card with no paste box and `Selvage mark` drawn where the mark belongs (the
60 KB PNG had not arrived), measuring 336×310 against the final 336×389 — a
40 px move under the reader. The shell's inline script now decides the card's
shape **and** the remembered name while the parser is still reading the markup,
so nothing the bundle does changes what the first frame looks like, and
`initJoinCard` sets the variant both ways when it takes over. The inline script
is two blocks: the held-submit guard **first**, so a throw in the card block
cannot disarm the safety net, then the card block. `test/join-paint.test.ts`
runs the real inline script and the real `initJoinCard` against the same address
bars (bare, link, room without a token, `?room=&token=`, an appended
`?debug=1`, a percent-encoded room) and holds them to the same answer: the two
languages carry one predicate, and that test is what keeps them one rule.

**The mark never wears a request, and it is the owner's pixels.** Two changes
met here. The card painted `Selvage mark` as alt text while the 60 KB PNG was
in flight and an empty box while it was merely slow; and the site then deleted
`app/icon.svg` — the vector monogram this page copied as `favicon.svg` — because
its `clipPath` pointed at a `<g>` and the whole monogram was clipped away, so
the tab icon it served here was blank. The site's icon set is its own pixels
now, and a measurement settled what this page should carry: the vector draws the
same monogram but not the same image — at the card's 52 px, eight times up, its
strokes and its `p` differ visibly from the master's, which is exactly the
"a redraw cannot match the owner's artwork" the site's own change concluded.
`preload` + `<img alt="">` would have kept the pixels but not the invariant: a
preload is still a race the first paint can win, and only the *document* cannot
lose it. So the mark's bytes are in the shell — a 104 px render of
`public/mark-transparent.png` (the card's 3.25rem at 2x, the largest the mark is
ever shown) by the same renderer the build's icons use, carried once as the
`.mark` rule's `background-image` and worn by the card and the brand. It paints
nothing that could be text, it cannot fail to arrive, and the first frame's
resource list is `app.css` and `site.webmanifest` with the mark already drawn:
**zero pixels** different from the final frame on a bare open, a bare open with
a remembered name, a link open with a remembered name, and with the PNG request
failed outright — and 224 distinct colours in the mark's own 46×46 crop, so it
is a mark and not a blank box. `test/identity.test.ts` decodes the data URI and
holds it to `renderIcon(public/mark-transparent.png, 104)` byte for byte, so
refreshing the site's master cannot go stale; `node scripts/inline-mark.mjs`
prints the replacement in one paste. `public/favicon.svg` is gone with its
`<link>`, and the tab is the rasters the build renders from the opaque master —
`favicon-16x16.png`, `favicon-32x32.png` and `icon-48.png`, the sizes the site
serves, alongside the touch and manifest icons this page already had.
`mark-transparent.png` stays in `public/` as the artwork's source and is no
longer served: nothing fetches it.

**A peer's name is text, not markup.** A decoration's `hoverMessage` is
rendered as markdown and the label in it is the room's, so a host named
`![](http://127.0.0.1:8181/l.png)` — 31 units, inside the protocol's 32-unit
display-name bound — made every guest's browser fetch that URL on hover.
`literalMarkdown` in `editor.ts` escapes every ASCII punctuation character a
name can carry before the message is built, so a name paints as its own
characters and can form no link, image or code span; a name of letters is
untouched. It is the hover channel's `escapeCssContent` — the badge's CSS
content channel already had its own escape. `test/presence.test.ts` drives the
real binding with `![](…)`, `[x](…)`, backticks, `<http://…>`, an `onerror`
image and a trailing backslash, and asserts that no live markdown character
survives and that what a guest reads is the name. Proven in the browser: the
keyboard hover (End of the peer's line, then Ctrl+K Ctrl+I) renders
`<p>![](http://127.0.0.1:8181/l.png) · host</p>` with `img` and `a` counts of 0
and no request at all, where the unescaped build — rebuilt only for the control
— logged `GET /l.png` and an `<img>` node.

**The server a link may name.** `?server=` (and the `server` in a pasted page
link or wire invite) was passed through untouched, and the page is what reads
`<server>/meta` and opens a socket at `<server>/session` from it.
`linkServerBase` in `servers.ts` now admits an absolute `ws`/`wss`/`http`/`https`
URL with a host and refuses credentials, a fragment, a query and anything
relative, at every way in; a path is kept, because a server behind a prefix is
addressed rather than spoofed. The refusal is the card's own copy — `That invite
link names a server this page cannot reach. Ask the host for a fresh link.` —
carrying no address. Driven on the built page against a listener: credentials, a
fragment, a query, `file://` and a relative value produce **no request at all**
and that sentence, while a plain `ws://127.0.0.1:…` still reaches the listener
with `GET /meta` and the upgrade — the residual the rule leaves, and the one the
demo's own default depends on.

**A refused pre-flight hands the button back.** The browser run above found a
dead end next door: a submit held before the bundle disables the button with
`Joining…`, and a pre-flight refusal (a blank name, a link that names no
session) returned before `runJoin`'s restore, so the guest's only way on was
Enter. `attemptJoin`'s catch now restores the button the way a refused join
does; `test/join-card-init.test.ts` pins the restore inside `attemptJoin` rather
than on the queued path, and the browser run reads `Join`, enabled, with `Paste
an invite link to join.` under it.

**Design pass.** The session chrome grew a bar, rows with air, quieter verbs and
one less smudge. The session bar is taller and wider-spaced; the share pill is
larger with a tighter mask (a 5 px text-shadow rather than 8 px, so the rest
state is a redaction bar rather than a grey foam); the sidebar labels are 11 px
with 0.08em tracking and 1.5em of air above; roster rows are 38 px and tree rows
34 px with 2 px between them; the roster's `Go to`/`Follow` are ghost buttons at
rest that fill on hover; the join card's rhythm was tightened (1.9rem padding,
1rem between rows, `line-height: 1.5` on the room-closed line) and the body
line-height went 1.45 → 1.5. The two dims a reader reads most in the editor were
the only colours under AA — Mocha's overlay1 is 4.4:1 on the editor ground — so
comments and line numbers step to `#868ca2` (4.9:1). `test/join-chrome.test.ts`
now also pins the peer palette, eight hues reached by hashing a peer id and used
as black initials on the colour and as the colour on the card, at or above
4.5:1 on both grounds. Nothing was added: no dependency, no fetched font, no
gradient, no feature.

Proven live on the built page by scratch harnesses under `.tmp/prepaint/` (CDP
over the `ws` package, Chromium 152 from the nix store, its own `selvaged` on
8183 and its own static server on 8182, so no run shares a room space with
another checkout's): the four pre-paint frame pairs, the held submit, a real
guest session (join, sidebar with a directory open, share hover, `Link copied`,
the grace note at a 4 s grace, the room-closed card), the hover control pair,
and the server-link table.

Green: `npm run typecheck` clean, `npm test` 275/275 — including
`identity.test.ts`'s byte-identity pairs, which the site's icon change had left
stale and this round resolves: the pairing for the deleted `app/icon.svg` is
gone with the file, and the two marks that remain are still compared to the
site's own copies. `npm run build` with the `ws`-absence assert, and `dist/`
rebuilt last.

Could not verify: Monaco's own rendering of a hover beyond its DOM, and
anything on Firefox — every browser claim here is Chromium 152.

Open questions: whether the shell should carry the mark's bytes at all or
whether a *blocking* first paint on the PNG is worth revisiting (measured here:
a preload loses the race, so the invariant and the request cannot both be had);
whether
`showIfCollapsed` on the caret decoration would give a *mouse* reader the hover
anywhere on the peer's line (today only the keyboard path and the mouse just
past the line's text reach it — a decoration hover answers a position anchor,
not a token); whether a link should be allowed to name a private or loopback
address at all (the demo default is one, so a rule that refused them would
refuse the demo); and whether the `?server=` bound belongs in the protocol or
stays a guard in the client.

## The join flow on a phone (2026-09-18)

A recon of the page at 390, 320 and landscape found five defects and said which
sizes to move; this is the pass that moved them. Everything below is Chromium
152 with `Emulation.setDeviceMetricsOverride { mobile: true }` and touch
emulation on, so `(any-hover: none)` and `(pointer: coarse)` are both true — the
query the whole round keys on. Every measurement before and after is in
`.tmp/mobile-ux/{before,after}/facts.json`, the driver in
`.tmp/mobile-ux/drive.mjs`, the shots beside them.

**A phone is `(any-hover: none)`, and nothing else is.** Two media queries carry
the round: `(any-hover: none)` for what a finger needs (field size, target size)
and `(any-hover: none) and (max-width: 640px)` for what a phone needs (the card
as a sheet, the panel as a disclosure). `mobile.ts` names both and
`test/mobile.test.ts` holds the stylesheet and the page to the same two strings,
because a page that thinks it is a phone while the CSS paints a desktop is the
failure this leaves behind otherwise. `any-hover` and not `hover`, because
`hover` answers for the *primary* input mechanism alone: a touchscreen laptop
whose primary is reported as touch would take the phone layout with a mouse
sitting next to it. A narrow desktop window is a desktop, and so is anything
with a mouse or a touchpad; landscape at 844 keeps the two-column layout it
already read well in. (Headless Chromium reports *both* queries as true — it has
no pointer at all — so the driver cannot tell them apart; the distinction is the
device's.)

**iOS zoomed every field.** The root font is 14 px, so `#join input { font-size:
1rem }` computed to 14 px — under the 16 px floor at which iOS stops zooming the
page on focus — and Monaco's own input textarea was 14 px too. Both are 16 px
under the touch query, along with `#join-message`, which was 12.88 px: the
sentence that says the room is gone was the smallest text on the card. Measured
14 px → 16 px on `#invite`, `#name` and `textarea.inputarea`; desktop stays at
`1rem` and 14 px.

**Twelve of thirteen rows were under the 44 px a fingertip hits.** The share
control was a 24 px strip, the roster's `Go to`/`Follow` were 26 px at 11.2 px,
tree folders 32 px and tree rows 34 px. Under the touch query every `button`,
every `summary`, the tree rows and `#share-group` take `min-height: 44px`, and
the roster verbs take `min-width: 44px` with 0.9em labels. One trap worth
recording: `min-height` is a floor on the *content* box, so 44 px plus 8.4 px of
padding and a border rendered the share strip **63 px** tall. The floor is on
the box (`box-sizing: border-box`) and the strip measures 44 px. Desktop density
is untouched — the sizes are behind the query, and a test asserts no `44px`
appears above it.

**The panel owned 42 % of the workspace forever.** `#side { max-height: 38% }`
was content-box, so padding and border sat outside the cap and the panel took
42 % at 390 (324/774) and 44 % at 320 — and nothing could dismiss it. Now
`box-sizing: border-box` makes 38 % the box it actually takes, and on a phone it
is a disclosure: a full-width `Files and people` control sits under the session
bar, the panel starts *shut* so the editor owns the screen, and opening a file
shuts it again. With the keyboard emulated (390×420) the editor went 187 px to
286 px of a 330 px workspace — 53 % to 87 %, over the 55 % floor. Rotating out
of the phone shape opens the panel rather than leaving the tree with no control
to reach it.

**Monaco was configured for a desktop with a mouse attached.** The minimap took
38 px of a 390 px screen, long lines did not wrap, and `editor.focus()` on join
raised the soft keyboard over a room the guest had not seen. All four are
`editorOptionsFor(touch)` in `mobile.ts`: no minimap, `wordWrap: 'on'`,
`fontSize: 16`, 14 px scrollbars; and the focus is skipped on touch, where it
follows the first tap instead. Measured: minimap 38 px → 0, a 240-character line
paints as 2 (unwrapped; a stray third view-line is the trailing empty line)
→ 19 visual lines, `activeElement` after join `textarea.inputarea` → `body`.
Tapping the editor still focuses the input, and typing still lands in the model.

**A `title` never paints for a finger.** A peer's `label · role` lived only in
the caret decoration's `hoverMessage`, `not yet shared`'s reason and every dead
roster verb's reason only in a `title`. The pill now says
`not shared by the host` on a phone (`unpublishedPillText`), a dead verb's
reason is a row line that the touch query unhides (`#roster .why`), and a peer's
`label · role` is a tap: `MonacoBinding.peerAt(offset)` answers whose caret or
selection is under a tap, and `main.ts` shows `name · role` on the `#peek` line
— the tap state for a hover that cannot happen. `#peek` is the alert's own
mechanism (`wireTransientLine`) with different copy and no danger border, empty
and therefore hidden at rest, and politely announced when it fills.

**The keyboard and the viewport.** `#app` is `100dvh` (with `100%` before it for
a browser without `dvh` and `box-sizing: border-box`, without which the inset
below would push it past the height it was measured against), the viewport meta
carries `viewport-fit=cover` and `interactive-widget=resizes-content`, and
`env(safe-area-inset-bottom)` pads the app, the card and the alert. iOS shrinks only the *visual* viewport, which no
layout engine hears about, so a `visualViewport` resize re-pins `#app` to the
height the guest can actually see and re-measures the editor; `appHeightFor`
declines a pinch-zoom, which is a visual-viewport shrink too, and a test pins
that. Driven with an installed `visualViewport` (no CDP call shrinks it — see
the annotations in `.tmp/mobile-ux/drive.mjs`): `#app` 844 → 420, editor
710 → 286 px, and back.

**Measured, before → after** (`drive.mjs before|after`, 50 checks, all green
after; the hook is that the driver reports each one and its measurement):

| what | before | after |
|---|---|---|
| `#invite`, `#name`, Monaco input | 14 px | 16 px |
| `#join-message` | 12.88 px | 16 px |
| controls under 44 px, seated 390 | 12 | 0 |
| `#share-group` | 359×24 | 359×44 |
| session bar height (44 px of it the copy control) | 70 px | 90 px |
| roster `Go to`/`Follow` | 62×26 / 67×26 | 62×44 / 67×44 |
| tree `summary` / row | 370×32 / 370×34 | 370×44 / 370×44 |
| `#side` of `#workspace` (open) | 324/774 = 42 % | 287/754 = 38 % |
| editor of workspace, kb 390×420 | 187/350 = 53 % | 286/330 = 87 % |
| Monaco minimap | 38 px | 0 |
| horizontal page scroll, every state | none | none |

**Everything is green.** `npm run typecheck` clean; `npm test` **299 tests, 297
pass** from a nested worktree — the two that read `../../site` and
`../../ai_notes/.tmp/` fail there alone, and both pass where the siblings sit at
`web_client`'s level, which is the layout they were written for; `npm run build`
with the `ws`-absence assert, `dist/` rebuilt last.
`test/mobile.test.ts` is new and pins the media queries, the editor options, the
visual-viewport rule and the 16/44 px sizes at both ends of the query.

**Three review findings, all fixed.** The safe-area padding above needed
`box-sizing: border-box` on `#app`, or content-box made the app taller than the
viewport the inset was measured against. `MonacoBinding.peerAt` read the path
from the last drawn frame, and opening a document changes the path and the model
in one step while the frame that re-draws the carets arrives later — so a tap's
offset into the new buffer could be answered by the previous document's carets;
it now filters the drawn carets by the *current* path, with a test that opens a
second document between the draw and the tap. And the touch query is
`(any-hover: none)` rather than `(hover: none)`, which answers for the primary
input mechanism alone.

**The mobile review's findings, closed.** The masked `#share` readout is a
readonly field the clipboard fallback focuses, and outside the phone sheet that
hides it it was still 11.9 px — the one focusable field under the 16 px iOS zoom
floor — so the touch query raises it too. Where a failure alert and the tap line
stand at the same anchor the alert now paints over it (`z-index` 6 against
`#peek`'s 5). Both lines take `--keyboard-inset` from `fitVisualViewport`: the
distance from the layout viewport's floor up to the visual viewport's, which is
how a fixed line stays above a keyboard the layout viewport never heard about.
A pointer attached or removed mid-session re-decides the touch mode —
`watchTouchQuery` re-applies Monaco's options (read off the editor it made,
because Monaco's font default is platform-dependent), the off-hover pill's words
and the viewport pin, and a pan of the visual viewport re-runs the inset. The
guards on top of the round take the driver to **60 checks** and the suite to
**306 tests (304 pass** from a nested worktree).

Could not verify: a real iOS or Android soft keyboard — the driver emulates the
layout-viewport shrink and, separately, an installed `visualViewport`; whether
`visualViewport.height` on a real iOS keyboard is the number `#app` should take
(the rule is pinned by unit test, the platform behaviour is not); Monaco's
drag-scroll and word-selection under a real finger, which the recon also could
not call; and `env(safe-area-inset-bottom)` on a notched device, which is zero
on any desktop Chromium.

Open questions: whether the panel should be a `Files | People | Editor` tab
strip rather than one disclosure — the recon offered both and this took the
smaller one; whether the roster's dead-verb reasons should be permanently on
screen on a phone or revealed by a tap instead (they are plain text today, which
costs the self row two lines); whether an iPad with a trackpad should keep
desktop density, since such a device reports `(any-hover: hover)`, takes the
desktop layout, and would still zoom a 14 px field — the query buys the
touchscreen laptop its desktop and pays for it here; and whether landscape's session bar at 62 px (44 px of it
the copy control) is worth a shorter variant, given 390 px of height.

## Ghost document, ghost caret (2026-09-19)

Two owner-reported defects, both reproduced live before the fix and pinned by
tests after it.

**1. A room that shares no document left the editor editable.** `monaco.editor.
create(host, …)` with no `model` makes itself an empty buffer, `openFirst`
opens nothing when the room names no document, and the `documents` case opens
only when the room names one — so the page showed a buffer bound to no room
document and took text into it. That text is not in the room, nothing
publishes it and no peer sees it, while it looks like a file. `MonacoBinding`
now owns the rule *the editor accepts text only while a room document is in
front of it*: `applyEditability` sets `readOnly` at construction, on every
`openDocument` (both the fetch and the re-show branch), on `closeDocument` and
in `enterTerminal`, from the one condition `path === undefined ||
terminalReason !== undefined`.

Both shapes are covered, and they differ only in what the page already says:

| Room state | Tree | Editor |
|---|---|---|
| No listing, nothing open | `The room shares no listing yet.` | read-only, empty |
| A listing, nothing open | the files, all closed rows | read-only, empty |
| A file opened by the person | that row wears `open` | editable, fetches the file |

No sentence was coined for it. In the no-listing case the tree's existing
line is the state, and in the listing case the rows are the invitation; on the
keystroke Monaco answers for itself — `Cannot edit in read-only editor`, in
its own words, which the after-fix shots show. Opening a listed file is
unaffected: the open reaches the room as before and the editor takes text the
moment the document arrives, which the driver checks by clicking `todo.txt`
and typing into what opens. The room-gone teardown is unchanged — it is now
one of `applyEditability`'s two reasons rather than its own `updateOptions`,
and `test/room-gone.test.ts` still pins it.

**2. A peer's caret stretched over the lines the local person typed, and its
badge repeated on each of them.** The caret is a *zero-width* decoration, and
Monaco tracks a decoration's range through edits: by default
(`AlwaysGrowsWhenTypingAtEdges`, `0`) a range the local person types at its own
edge widens to swallow the typed text. Three Enters at the peer's position
therefore left the caret spanning lines 11–14, and a `className` decoration
over a multi-line range paints on *every* line it covers — one `DIV.cdr`
caret bar and one glyph-margin widget per line, which is the four `pe` badges
and the stretched bar in the owner's screenshot. Nothing was stale: the next
frame drew the peer's caret as the point the room resolves it to (line 14),
which is why a cursor move appeared to fix it.

`renderCursors` now mints both the caret and the selection fill with
`CURSOR_STICKINESS` (`NeverGrowsWhenTypingAtEdges`, `1`) — the value the
desktop client's `DecorationRangeBehavior.ClosedClosed` maps to
(`vscode_client/src/adapter/decorations.ts`), so the two clients track a peer's
positions the same way. The value is named numerically because this module
imports Monaco's types only: a runtime import would put the editor's DOM in the
tests' path.

**Tests.** `test/ghost-caret.test.ts` is new, 5 checks: the editor read-only
with no document in front and editable the moment one opens (in both
directions, including after the room is over), and the caret's tracking. The
caret pin is behavioural rather than structural: the options `renderCursors`
mints are handed to Monaco's own `nodeAcceptEdit` (the function its interval
tree calls for every decoration on an edit), and the range must stay a point
through three inserts, with the peer's selection end not moving. Removing the
read-only calls alone leaves *leaves the editor read-only until a document
opens* and *locks again when the document leaves…* red (`the editor takes text
the room does not hold`); removing the two `stickiness` lines alone leaves
*is drawn as a point…* and *does not widen over the lines three Enters at it
create* red (`the caret stretched to 10..13 over the typed text`, the same
three offsets the browser painted as four lines).

Suite **310 tests, 309 pass** from this nested worktree — `test/identity.test.ts`
reads `../../site`, which is not beside a worktree, and passes from the main
checkout (**305/305**). `npm run typecheck` clean; `npm run build` green with
its `ws`-absence assert, `dist/` rebuilt in the same commit (this repository
tracks its built page).

**Proven live** (`GHOST-CARET VERDICT: PASS`, driver
`scripts/tmp-ghost-caret.mjs`, a real `selvaged --serve-page dist`, real
Chromium 152 over CDP, two real guests — the local person and the peer — and the
same driver run twice, under `GHOST_TAG=before-fix` and `after-fix`):

- Ghost, before: `ghost text nobody sees` sat in the buffer in both room shapes
(the driver's own check red: `before="" after="ghost text nobody sees"`).
  After: the buffer is unchanged, the room holds no document, and Monaco paints
  its read-only notice. Shots `ghost-<shape>-{before,after}-typing.png` and
  `ghost-listing-opened-takes-text.png`.
- Caret, before: after the local person pressed Enter three times at the peer's
  own position, 4 badges and 4 bars at lines 11–14 while the peer's own page
  had its caret on line 14 — the owner's screenshot exactly. After: 1 badge and
  1 bar, on line 14, the peer's own line; a click that moves the peer to
  line 13 moves the single badge with it. Shots
  `caret-{before-typing,after-three-enters,after-cursor-move}.png`.

Nothing outside the checkout is written: the Chromium profiles, the shots and
the driver's logs live under `.tmp/ghost-caret/`, and the one unix-socket
directory Chromium insists on per launch goes to `/tmp/gt` (a profile path this
deep exceeds the 107-byte socket bound). A `rawKeyDown` with no text — `ArrowDown`
and `Home` — never reaches Monaco in this headless Chromium; the driver moves a
caret by clicking the line instead, and records that here so a later driver does
not trust a key batch.

Open questions:

- The listing-but-nothing-open state says nothing in the page's own words. The
  tree's rows and Monaco's read-only notice cover it; a sentence ("Open a file
  to edit it") would be new copy, and this round added none. Whether the owner
  wants one is his call.
- A document the room *closes* while the page shows it: the buffer stays in
  front of the editor, so it stays editable — read-only is tied to "a document
  is in front", not to "the room still holds it". If the room drops a path the
  guest alone opened, the tree sheds the row while the buffer keeps the text.
- Between frames, the caret sits where the room resolves the peer, and the
  decoration no longer second-guesses it: while the local person types exactly
  at a peer's offset the peer's caret can appear one line away until their own
  frame arrives. The desktop client tracks a caret the same way.

## The page on its own origin (2026-09-19)

This repository now publishes its bundle by itself, as
`ghcr.io/selvage-protocol/selvage-web`, for a deployment that wants the page on an
origin of its own (one page in front of several `selvaged` instances, or a page host
separate from the servers). One origin stays the default and is what the server image
runs. The decisions, since a second origin of the same bundle is where they matter:

- **The image copies the committed `dist/` instead of rebuilding it.** The reference
  server's page stage proved a fresh `npm ci && npm run build` reproduces it byte for
  byte, and CI now re-proves that on every pull request (`npm run build`, then
  `scripts/check-dist.sh`, which compares every file the bundler writes by sha256 and the
  six build-rendered icons at their six sizes, an ImageMagick version deciding their
  bytes and their pixels), so the COPY takes the reviewed bytes and the image needs no
  node toolchain, no network fetch and no ImageMagick 7 in its build. What a rebuild in
  the image would add is what the checks job already asserts.
- **The runtime is `nginxinc/nginx-unprivileged` (uid 101, port 8080).** It is the
  well-known unprivileged static base, one image and no plugin; the alternatives a
  static page could run on (`python3 -m http.server`, busybox's `httpd`) would each
  need the media-type table written into the build or would answer the wrong type for
  a `.map`, which is the S1 defect this page already paid for.
- **`packaging/nginx.conf` mirrors `page.rs`.** The media-type table carries the whole
  header value, charset included, exactly as the handler's `content_type` returns it;
  the cache policy is the name's (a content hash pins for a year, everything else
  revalidates, so `lang-255Y2KCL.js` is pinned and `lang-255Y2KCL.js.map` is not,
  because the dot is in the hash's way, which is what the same rule says in Rust);
  and the page's policy, `no-referrer` and `nosniff` ride on every response.
  `scripts/check-page.sh` runs the page's own `scripts/check-content-types.mjs` plus
  byte and header assertions against the running container, so the table, the bytes
  and the policy are checked from outside rather than restated.
- **It runs with no writable mount.** nginx's pid file and its five temp directories
  are declared onto `/dev/shm`, the tmpfs the container runtime mounts itself, so
  `--read-only --cap-drop ALL --security-opt no-new-privileges:true` needs nothing
  mounted. `scripts/container-smoke.sh` reads those flags back off `docker inspect`
  and asserts the container runs as uid 101.
- **Two things a split deployment pays.** The `/meta` read is cross-origin and nothing
  here emits `access-control-*`, so it is skipped (the wire versions and the
  reconnect grace, nothing more), and the page's built-in default names one endpoint,
  so every link needs `?server=`. The socket itself is not CORS-bound, so this works
  and the handshake still enforces compatibility.
- **The repository has CI now**, which it had none of before:
  `.github/workflows/ci.yml` (install, typecheck, build, the build reproduces
  `dist/`, and the suite a single checkout can run) and `.github/workflows/image.yml`
  (build and hardened run on a pull request, a non-pushing rehearsal of the release
  path, and the three tags published on a `v*` tag only). `test/identity.test.ts` is
  the one test that reads a sibling checkout and is excluded by name in
  `scripts/test-ci.mjs`; `test/serve-types.test.ts` reads only `dist/` and runs.

## The host-away window counts down, and the room takes its copy (2026-09-21)

Owner, on the host-away state: "the timer of 30s in the browser is static and
not counting down — same in vscode. this is not great ux." The desktop clients
already tick (a status-bar item and a Neovim window row); the page worked its
sentence out once, when `host.detached` arrived, and never looked at the clock
again.

This supersedes two claims in **Join card and chrome (2026-09-18)** and the
coupling paragraph under it:

- **The strip is a ticker.** `wireSessionNote` takes the grace window, builds the
  number's own element and redraws it once a second from the deadline, so a
  backgrounded tab that missed a dozen ticks shows the room's remaining time the
  moment it paints again. The number counts in a `<span role="timer"
  aria-live="off">` inside the strip: `role="timer"` carries `aria-live: off`,
  so the sentence is announced once when the host leaves and the count is never
  read out — a polite region whose text changed every second would read the count
  out thirty times. `test/join-chrome.test.ts` drives it against an injected
  clock, so nothing in the suite sleeps and only the reading moves.
- **The binding has a notice kind now.** `{ kind: 'grace', graceMs }` and
  `{ kind: 'hostBack', name }` replace the two sentences the page matched by their
  opening words; `sessionNoteSignal` is gone. The membership all-clear stays: a
  `roster` or `peers` report naming the host still clears the strip, because the
  attach frame is the only thing that says the host is back.
- **The return is said, not silent.** Clearing the countdown was the whole
  announcement before; now the strip carries `demo-host is back — the session
  continues.` for five seconds, in the sentence both desktop clients use and in
  `--foreground` rather than the strip's warning yellow (`#session-note[data-tone
  = "plain"]`).
- **The room-gone card says what became of the room.** A page has no disk to leave
  a mirror on, so `roomGoneSentence` adds `Nothing in the room was saved.` to the
  desktop clients' sentence: they keep the guest's copy and name where it is, and
  this client cannot, which is the one end state the three cannot word alike.

Not done here: keeping the guest's text anywhere on the way out (a download, or a
stash in `localStorage`). That is what would let the page say `your copy is kept`
with the desktop clients.

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

## The pre-join backdrop is a picture (2026-09-21)

Grey bars of arbitrary widths read as content that failed to load, not as
decoration — the owner lifted `#veil` to check and said so. `#preview` draws an
editor instead: a file tree beside four lines of code, monospace, syntax
coloured from the page's own tokens (`--primary` for keywords, `--warning` for
the literal, the tree on `--card` and the code on `--background`). Nothing in
it is real and nothing in it is a claim — no address, no credential, no
element but boxes, spans and one code block — and `aria-hidden` plus `inert`
keep a screen reader out of a file tree that does not exist, with
`pointer-events: none` and `user-select: none` so a picture takes no click and
no selection. Below 640 px it is hidden rather than squeezed: 19rem of tree
leaves a sliver of code, cut by the card, which is the bars again. The shell's
own two tests hold the shape (`test/join-paint.test.ts` for what it is and is
not, `test/join-chrome.test.ts` for each token on the pane it draws it on) and
`test/mobile.test.ts` pins the 640 px cut.

## The link is the server (2026-09-21)

Owner, on a room hosted on `wss://selvage.dontblameme.dev` whose copied page half pointed at
the retired Pi origin: "There should **only** be the link, no extra `server` attribute in the
link. **The link is the server.**" And on compatibility: "remove the old useless server= thing.
nobody is using this, so leaving artifacts right now isn't worth it." `server` is deleted, not
deprecated — not read, not written, and no branch is kept for it — and the same change landed in
`nvim_client` (`#70`) and `vscode_client` (`#77`) first. This is the page's half, and the third
implementation of the same format.

**The shape now.** An invite is `https://<host>[<path>]/?room=…&token=…`: the page the room's own
server serves, carrying the room and its token and nothing else. The guest derives the socket
from that same origin, so one address decides the page a guest opens and the server they join on.
`src/browser/servers.ts` holds the two halves of the derivation, the same rule as the desktop
clients':

```
pageOriginOf: wss://host[:port][/prefix]  ->  https://host[:port][/prefix]
              ws://host[:port]            ->  http://host[:port]
serverBaseOf: https://host[/prefix]       ->  wss://host[/prefix]
              http://host[/prefix]        ->  ws://host[/prefix]
```

`serverBaseOf` takes this page's own address for a link it was opened with and the link's own
address for one pasted in, and takes the host and the path and nothing else out of either — so
the address the page reads `<server>/meta` from and opens its socket at cannot be one the link
does not read as naming, and a page link needs no bound of its own. A whole wire invite
(`ws://host:8080/session?room=…&token=…`) is the other shape the page takes, for a room whose
server serves no page: its base comes from whoever sent the link and is still bounded by
`linkServerBase`, which is a security check and not the parameter being removed. That function
now returns the scheme in the one case the page's rules are written in, because a link that
spells `WS://` names the same server while the `wss://` socket, the `https://` read and the
mixed-content rule all decide by the scheme's spelling; without it a `WS://` invite reached the
share bar as a wire URL and skipped the TLS upgrade (found on review, pinned in
`test/tls-scheme.test.ts` and `test/invite-origin.test.ts`).

**Once the origin carries the server, four things with no job left went with it.**

- `DEFAULT_SERVER_BASE` (`servers.ts`) — the built-in demo server. Every link names its own
  server now, so a page that kept a default would be a page that can still point somewhere wrong.
  Nothing else needed it: the three uses in `main.ts` (the join's fallback base, the share link's
  `defaultServer`, the failure message's base) are the page's own origin or gone.
- `PUBLIC_PAGE_ORIGIN` and `shareOrigin` (`share.ts`) — the configured public page origin, for
  linking a loopback page elsewhere. Substituting a page now mints a link whose origin dials a
  different server than the room's, which is the defect being removed.
- `resolveJoin`'s `server` read (`join.ts`) and `buildShareLink`'s `server` write (`share.ts`). A
  link that still carries a `server=` is joined at its own origin, because the parameter is then
  unknown to the page and unknown query parameters are ignored (`PROTOCOL.md` §5.1). Pinned in
  `test/invite-origin.test.ts` and `test/share.test.ts` so the path cannot creep back.
- `test/default-server.test.ts`, whose whole subject was the default. It is `git mv`'d to
  `test/invite-origin.test.ts` and states the rule instead: the demo's one origin round-trips
  through `buildShareLink`/`parsePageLink`/`resolveJoin`, the address bar takes the page's own
  origin, a pasted link takes its own.

**The case worth care.** A page served from origin A, opened with an invite naming origin B, must
talk to B. It does: the pasted page link's origin is the base (`resolveJoin`), where before the
link carried `server=` precisely so the paste worked from anywhere. An address bar link takes the
page's own origin, because the page was served by the room's server — the one-origin shape that
makes one address enough — and a page that names no server of its own at all (a `file://` open)
is refused in the card's words (`This page names no server to join. Open the link the host sent
you.`) rather than pointed at a default.

**This section supersedes, in part, earlier ones.** *Link shape* above is marked at its head: the
link is no longer `location.origin + path` with `?server=` off the default, and the page origin
is no longer configured. *The one unverified layer* item 1 still says to join from a
`?room=&token=&server=` link: the parameter is ignored now, so that recipe runs unchanged and
proves nothing about it. *TLS: the https page speaks only wss/https* names "the default server
…:8444" and "an explicit `?server=`": the scheme-match rule is unchanged and still pinned, and
those two values are gone. *The server a link may name* stays true of a pasted wire invite;
`?server=` no longer reaches `linkServerBase`, so the sentence is about one shape now, and its
open question — whether the bound belongs in the protocol — has that one shape as its subject.
*The serve round*'s split-deployment cost ("every link needs `?server=`") is now the opposite
way round: an invite is a page link, so a room whose server serves no page is handed on as a
`ws://` invite, and this image exists for fronting such servers.

**Seen in a browser.** Chromium 152 over CDP, the built bundle, a real `selvaged` on one origin
serving the page with `--serve-page dist` and a plain static server on another, the driver at
`.tmp/invite-origin/drive.mjs`, shots beside it. 16/16 checks: the join page served by the room's
server takes only the name and the share bar offers `http://127.0.0.1:8117/?room=…&token=…` with
no `server=`; the *same* link pasted into the page on `127.0.0.1:8119` joins the room on 8117 and
its bar keeps 8117 — the guest's page never dials its own origin — and a wire invite pasted into
that bare page joins too, with the bar then offering 8117's own page and never the wire URL.
No page exception on any of the three joins. The join landings and the links the bar shows were
read off the rendered page (`own-origin-joined.png`, `cross-origin-joined.png`,
`wire-invite-joined.png`).

**Red and green.** `node --test test/invite-origin.test.ts` — 10/10 green. Reverting the read
alone (the pasted page link deriving the page's own origin, the naive implementation) turns *a
link pasted into a page on another origin talks to the link's server* red with
`actual: { base: 'wss://page.example', … } / expected: { base: 'wss://room.example', … }`, and
`test/share.test.ts`'s *offers the room's own page, with no server in the query* stays green under
it, so the read has a test of its own. Restored: green. Reverting the write alone (the link
appending `&server=` again) turns three of `test/share.test.ts` red with the parameter back in the
actual link. Restored: the whole CI suite green, 327/327, and `tsc --noEmit` clean.
`scripts/ci-local.sh all` green on the committed tree.

## The backdrop is drawn at the size an editor is read at (2026-09-22)

Owner, on the public demo: "the code sample in the background (and file tree)
needs to be larger, currently it mainly looks like an artifact". Reproduced
against the committed `dist/` at 1440×900 as served
(`.tmp/web-page/before-desktop-1440x900-as-served.png`): the drawing was five
tree rows at 11.9 px and four lines of code at 12.3 px, and what came through
`#veil`'s `blur(11px)` and its `rgba(17, 17, 27, 0.6)` wash was one faint smudge
in the top-left corner, with the card the only thing in the frame that read
as anything at all.

The picture is now drawn at the size the editor itself is read at, and the
document in it is longer than the window:

- `0.85em`/`0.88em` → **`1.15em`** (16.1 px of the page's 14 px root) for the
  tree, the code and a new line-number gutter, at the 1.75 leading it had. 16 px
  is the size the page gives its own editor on a touch device
  (`src/browser/mobile.ts`); a shrunken fraction of the editor's own size is
  what the blur turns back into a smudge.
- 5 tree rows → **21**: 19 files under four folders, the one the code pane has
  open lit with `--muted` and a heavier weight, the way the real tree lights it.
- 4 lines of code → **36**, with the gutter down the left edge — the shape that
  reads as an editor first. 1014 px of code against 86 px before, so the card at
  `top: 50%` cuts lines above and below it instead of standing under the last
  one.
- Everything the previous pass pinned is unchanged: the veil and its blur, the
  page's own tokens (no colour of its own), `aria-hidden`, `inert`,
  `pointer-events: none`, `user-select: none`, the card's own border and shadow
  over a busier backdrop, and the 640 px cut — below 640 px it is still
  `display: none` rather than squeezed (`test/mobile.test.ts`), checked at
  390×844 (`final-phone-390x844.png`, `display: none`).

`test/join-paint.test.ts` grew the numbers the shrunken version satisfied too:
every `#preview` font declaration is at least 1em, the gutter names exactly the
lines the excerpt has and in order, the excerpt stands at least a 900 px window
tall at its own size, the tree names at least twelve files in at least three
folders, and every `<div>`, `<pre>` and `<span>` the picture opens is closed.
That last one is not decoration. The first draft of this change lost two
`</div>`s, which put `#veil` and the join card inside the `inert`,
`pointer-events: none` subtree: the card stopped taking clicks, the whole suite
stayed green, and only the browser pass found it (`elementFromPoint` over
the Join button answered `#app`).

**Red and green.** `node --test test/join-paint.test.ts` against the committed
shell: the four new tests in *the pre-join backdrop is drawn at the size an
editor is read at* all fail — `the scan reached 2 font declarations`, `the code
pane carries no gutter`, `the excerpt stands 86 px tall, inside a 900 px
window`, `the tree names 3 files` — and every other test in the file stays
green. Restoring the change, 36/36 in that file.

**Seen in a browser.** Chromium 152 over CDP, the built `dist/` on
`127.0.0.1:8123`, the driver at `.tmp/web-page/shoot.mjs`, shots beside it:
`before-*` is the committed shell's `dist/` served the same way on `:8124`.
As served at 1440×900 the tree reads as rows and the code as lines with the
gutter between them, the card covering the middle of the document; with the
veil lifted the drawing is an editor with a file tree, a gutter and 36 lines of
syntax-coloured code. `scripts/ci-local.sh checks` green on the committed tree,
356/356.

## A join before any script has run (2026-09-22)

The owner's second report — "when joining via website — without a room link" —
does not reproduce as a silent card in the ordinary case. On the demo,
`https://selvage.dontblameme.dev/` with no `?room=`/`?token=`, a name typed and
Join pressed refuses with the card's own sentence, `Paste an invite link to
join.`, in `#join-error`; nothing dials, nothing is minted, the address bar
keeps its address and the button comes back (`.tmp/web-page/live-bare-join.png`,
`.tmp/web-page/live2.out`, three submits at 1280×757 with every request and
console message recorded, the earliest within 100 ms of the navigation). That is the
right answer and it needed no change: `PROTOCOL.md`
§5.1 with `specification/NOTES.md` §B.17 says a URL that names no room is a
*mint*, and the page never claims host — `test/room-gone.test.ts` pins that no
browser source hellos as host — so a bare page has no session to reach and
refuses rather than dialling. The sentence is the page's own, pinned in
`test/join-screen.test.ts` and documented under *Join flow without plumbing*;
the desktop clients' `an invite link is needed` (`client-command-parity.md` §5)
is the Neovim `:SelvageJoin` with no argument, and the page's copy is the
plainer wording the guest standard asks for. Nothing here invents or renames
one.

What does reproduce is narrower and live only. The demo's Cloudflare Rocket
Loader defers every script in the page — the deployed HTML carries the rewritten
`type="…-text/javascript"` the loader evals later — so the card is painted,
focusable and clickable for a whole round trip with no guard behind it. With the
loader's own script blocked, the demo is what the parser read: the paste box
still hidden by its markup, no armed flag, no listener, no script at all
(`inviteHidden: true`, `.tmp/web-page/prescript-live.json`). A join pressed
there can neither navigate nor leave a trace: the room's own server answers
every page with `form-action 'none'`
(`reference_server/crates/selvaged/src/page.rs`), so the console records
`Sending form data … violates … "form-action 'none'"` and the person sees a
button that does nothing at all. On a machine with no CSP in front of it the
same click is a bare GET submission instead, which reloads the page and wipes
what was typed. Either way the click was lost, because the only thing that
could have held it was a script, and the deployment had not run one yet.

The form now carries the hold itself, in the one place a deferred deployment
cannot take it away:
`onsubmit="if (!window.__selvageJoinArmed) { window.__selvagePendingJoin = true; } return false;"`
records the submit for the bundle's own replay, and the shell's prologue no
longer clears a flag the markup set — the bundle is the only thing that can
replay it, so a shell script arriving later must hand it on rather than drop it.
An armed card is untouched: the attribute then records nothing and cancels a
default action both listeners cancel anyway.

**Red and green.** Two mutations, run one at a time against
`test/join-paint.test.ts`. Dropping the `onsubmit` attribute turns *holds a
submit the card gets before any script has run* red; restoring the
unconditional `window.__selvagePendingJoin = false;` turns *leaves a held join
alone when the shell script arrives* red. Each leaves the other green, so each
half of the hold has a test of its own. Restored: 356/356.

**Seen in a browser.** Chromium 152 over CDP, the driver at
`.tmp/web-page/deferred-drive.mjs`, which serves the page in the deployment's
shape — the inline shell script moved to a deferred file, the shell and the
bundle both 2.5 s late — for the committed shell and for this one, and presses Join
as soon as the card is on screen — seconds before either script lands.
Committed shell: the submit is a bare GET (`/before/?#`), the
typed name is wiped, and once the scripts land the card carries no message at
all. This one: the address is unchanged, the name stays typed, the flag reads
`true`, and when the scripts land the bundle replays it — `armed: true`,
`pending: false`, and the card reads `Paste an invite link to join.` That is the
same refusal the ordinary case gives, delivered late instead of not at all.
A run of the same harness with the room server's header set verbatim —
`form-action 'none'` and all — behaves the same way (`pending: true` at +300 ms,
the address unchanged, `Paste an invite link to join.` on the card once the
scripts land), so the hold is not something `script-src 'self'
'unsafe-inline'` takes away.
`scripts/ci-local.sh checks` green on the committed tree, 356/356; the same page
served by a real `selvaged --serve-page` on `127.0.0.1:8096` carries the same
`form-action 'none'` header.

## Starting a room from the page (2026-09-22)

The owner's shape, implemented: a person opens the page with no invite, presses **Start a
session here**, picks a folder, and the room's working copy is that folder. The design is
`ai_notes/docs/studies/browser-hosted-rooms.md`; this is what landed, what was cut, and
what was measured rather than assumed.

### What the handle is, and what the page does with it

`src/browser/folder.ts` is the browser's half of `vscode_client/src/adapter/grant.ts`, and
it is much smaller than that file because `getDirectoryHandle` *is* the walk: a path is
never a string that resolves somewhere, it is a name asked of a directory the person
picked, so there is no `..`, no absolute path and no spelling the API can express for
something outside the folder. What the two hosts still share is the bridge's own rules —
`GRANT_EXCLUDED_DIRS`, `.env`, the key names, `GRANT_BINARY_SUFFIXES`, the 1 MiB and 5000
path bounds, the publish order — because the page vendors `src/bridge/`.

`FolderWorkingCopy` is structural over the handle (`values()`, `getDirectoryHandle`,
`getFileHandle`, `getFile`, `createWritable`), so the suite drives the whole module with
hand-built doubles and no DOM. The exclusion rules run with an empty platform, which is
the shared rule's own answer for a host that cannot be read: it folds case, so a
case-sensitive checkout loses a top-level `Build/` from the listing. That is the residual
of not knowing whether the folder's volume folds, and sharing less is the safer error.

The listing is the *same* `string[]` a `doc.granted` carries, so a guest's tree, its
badges and its unpublished pill are untouched; the server and the protocol are untouched,
as the study verified.

### The stale-file guard

The page holds a replica and a directory handle and cannot see the file change underneath
it, so before any write it compares the file's `lastModified` — from `getFile()` — with
the stamp the last read or write of that path saw, and **refuses** when they differ. It
also refuses a path it has never read (`unread`): the room holds text for a path only
because this host read that path off this disk, so a write with no read behind it would
overwrite a file nothing here has looked at. This host therefore never creates a file;
`getFileHandle` is only ever called for a name the listing already named.

What it does not claim: `getFile()` and `createWritable()` are two steps, and a change
landing between them is not caught. The API has no compare-and-swap. What the guard turns
into a sentence is the overwrite a person would otherwise never hear about.

The refusal reaches the person as a failure alert, not a status line: `save` throws the
folder's own sentence, the bridge reports `saveFailed` with it, and the binding turns that
into a `failure` notice into `#alert`.

### A reload ends the room, and says so

A page-hosted room lives in its tab, and the join flow is built the other way round — it
persists the invite link into the address bar so a reload rejoins. For a host that is
exactly backwards: a reload would rejoin its own room as a *guest*, with no folder and
nothing to serve, while the dead socket's grace ran out underneath it. So a host does not
write the link into the address bar. The link lives in the session bar, which is the one
place a host needs it, and the tab leaves a mark in `sessionStorage`
(`selvage.hosting`), read once by the next load to say what the reload cost. A room that
ends cleanly clears the mark instead.

Reclaiming inside the grace was not built: it needs the handle kept in IndexedDB, a
*Resume hosting* click, and a permission re-prompt, and it is the first thing the study
would cut. What is on the card instead is the warning before the click — "*This tab is the
host. Close or reload it and the room ends…*" — and the sentence after it. A host action
is offered on a page that was not opened with an invite; a page that was is the join flow,
one action and one click, and nothing is added to it.

### No picker, and not the server's own page

The control is offered only where both are true: this browser can hand a page a folder
(`folderPickerOf` tests `showDirectoryPicker` and nothing weaker — Firefox and Safari do
implement the handle interfaces for their own OPFS), and this page's own origin answers
`/meta` with a wire version this client speaks. `npm run serve` on `:8081`, the page-only
image in front of another origin, and a `file://` open all get the sentence instead, and
joining is untouched on every one of them.

The host action is *revealed* by the bundle once `/meta` answers rather than painted by
the shell, so the first frame is the card this file's *Join card* sections describe and
the third action arrives a moment later. That is a residual of deciding `/meta` is
required: a shell cannot make a same-origin request before it paints.

### The symbolic-link probe: Chromium does not follow one, and does not show it

The study left one thing unverified — whether a Chromium `FileSystemDirectoryHandle`
follows a symbolic link out of the picked folder — and its "the browser's confinement is
stronger than the desktop's" claim leaned on the answer. Chromium 152.0.7977.82, a real
folder handle, a real folder:

| what was asked | what Chromium answered |
|---|---|
| `escape` → `../outside` (a directory link out of the folder) | absent from `values()`; `getDirectoryHandle('escape')` → `NotFoundError` |
| `link.txt` → `../outside/secret.txt` (a file link out of the folder) | absent from `values()`; `getFileHandle('link.txt')` → `NotFoundError` |
| `selflink.txt` → `hello.txt` (a link **inside** the folder) | absent from `values()`; `getFileHandle('selflink.txt')` → `NotFoundError` |
| a file and two links created on disk *after* the handle was taken | the file appeared in the next listing (the handle is live, not a snapshot); both links did not |

So Chromium does not follow a link out of the folder, and it does not expose a link at
all: a symbolic link is a "hidden item" in `storage/browser/file_system/local_file_util.cc`,
whose `IsHiddenItem` is `base::IsLink(path)` — every operation on the path is
`FILE_ERROR_NOT_FOUND` (`GetLocalFilePath`) and the directory enumerator skips it
(`LocalFileEnumerator::Next`). That is the storage layer both a *picked* and a *dropped*
directory handle run through: `FileSystemAccessDirectoryHandleImpl::GetEntries` calls the
same `FileSystemOperationRunner::ReadDirectory`, and the manager builds the handle with
the same `CreateDirectoryHandle` for both.

Two honest limits on that evidence. The handle this was probed with was a *dropped* folder
(`DataTransferItem.getAsFileSystemHandle()`), because `showDirectoryPicker` cannot be
automated: `Page.setInterceptFileChooserDialog` intercepts the directory chooser in this
build but hands back no node to fill in, and `DOM.setFileInputFiles` needs one — so the
picker's own dialog is the one thing no harness can answer, which is why the host flow
below runs against a real handle from the origin private file system instead. And the rule
is the *engine's*: a link inside the folder is invisible too, so the browser host shares
strictly less than a desktop host, which lists no links but will open a file that is not
one.

Reproduce: `.tmp/symlink-probe/probe.mjs` in a checkout (Chromium 152 over CDP, a static
page that takes a dropped folder, `run1`/`probe2`/`probe3` logs under `.tmp/symlink-probe/`).
The study is corrected in the same wave, in `ai_notes`.

### Seen in a browser

Chromium 152.0.7977.82 headless, driven through `agent-browser` over CDP, a real
`selvaged --serve-page dist` on `127.0.0.1:8090`, and two independent browser sessions for
the two roles. The picker's dialog is the one thing automation cannot answer, so the host
page is loaded with a page init script that stands in for `showDirectoryPicker` with the
**real** `FileSystemDirectoryHandle` the browser hands out for its own origin private file
system, seeded with a small project; everything after the pick — `values()`, `getFile()`,
`lastModified`, `createWritable()`, the guard, the write — is the real API. Screenshots in
`.tmp/run/`, the init script at `.tmp/run/host-init.js`.

- `01-host-bar.png` — the host page after the folder was picked: the session bar with the
  invite link and the download control, the roster with the host's own row, and the tree
  drawn from the folder. `.env`, `.git/config`, `node_modules/…`, `logo.png` and
  `server.pem` are absent from it, by name, which is the shared grant rule running in the
  browser.
- `02-guest-sees-the-folder.png` — a second browser, the invite link, one click: the guest
  sees the browser host's folder tree and Ada in the roster, and never a host action.
- `03-stale-write-refused.png` — the file rewritten on disk behind the page's back (a
  fresh handle, as a formatter or a checkout would), a guest edit, and the alert: *"README.md
  changed on disk since the room read it — something else wrote it (a formatter, a build,
  another editor, a checkout) — so it was left alone rather than overwritten…"*. The file
  still held the outside writer's bytes (read back through the handle afterwards).
- `04-reload-notice.png` — the host tab reloaded: the address bar is bare (no
  `?room=&token=`), and the card carries *"This tab was hosting a room, and it is not any
  more…"*, with **Start a session here** and its warning under it.
- `05-guest-room-gone.png` — the guest's end of it, at the grace: *"The room is gone (host
  did not return). Nothing in the room was saved."* — the sharpest consequence of a
  browser host, and the sentence the page already had.
- `06-not-the-servers-page.png` — the same page served by a plain static server on
  `:8091`: the sentence, no button, Join untouched.
- `07-no-directory-picker.png` — the same page with `showDirectoryPicker` removed before
  the bundle runs, which is what Firefox and Safari look like to the feature test: the
  sentence, no button, and a join from that page into a browser-hosted room still worked
  (the same session joined and saw the tree).

The round trip that matters was read back, not inferred: a guest's edit to `README.md`
arrived in the host's editor and then, through the guard and `createWritable`, in the
folder (`README.md` read back through the handle at the new text and a new
`lastModified`). The download was taken with `agent-browser download`, and
`.tmp/run/downloaded-README.md` is 176 bytes of the room's text — including the two guest
lines the refused write had kept out of the folder, which is what the control is for.

**Red and green.** Three mutations, each run alone, each restored before the next.
`folder.ts` with the `lastModified` comparison removed: `test/folder.test.ts` 19/20, the
one red being *refuses a write when the file changed on disk since the room read it*;
restored, 20/20. `editor.ts` with the host's own read in `initialText` removed:
`test/host-binding.test.ts` 6/9, the three red being the two that open a listed file and
the one that reports a refused read; restored, 9/9. And with `folder.ts` moved aside,
`test/folder.test.ts` cannot load at all — `ERR_MODULE_NOT_FOUND` — so nothing in it can
pass by accident. `scripts/ci-local.sh checks` green on the
committed tree, 402/402 (`npm run test:ci`, which excludes the one suite that needs the `site` checkout beside this one).

### What was cut, and what that leaves out

The study's four cuttable items, in its order. **Reclaim on reload** is cut: the warning
and the post-reload sentence are what landed (above). **The tree-driven open** is not
cuttable and is not cut — the host's click reads the file out of the folder, which is the
only way a host can edit its own file at all. **The stale-file guard** is not cut. **The
download** is not cut: it is in the same wave, because with hosting it is the escape hatch
for a refused write.

Left out with the resume, and stated: a person who reloads inside the room's grace cannot
get the same room back, and the guests in it lose what was not already in their replicas.
The card says so before the click and after the reload.

### Not in this wave

Upload: the study's §7 prices it and declines it for this shape — a folder-shaped host
already has a way to put a file in the room. The `site`'s copy and `DESIGN.md` are
handled where they live.

## A polish pass over the whole page (2026-09-22)

A walk of every state a person meets — the bare card, a bad link, a dead room, a real
guest session with a second guest and a host, follow, the share box, the host's grace
window, the room's end — at 1440×900 and on a phone (Chromium 152 over CDP at 412×915,
`mobile: true`, touch emulation). Four defects were fixed, each with a test that fails
without it; the rest of the walk is recorded below as either fine or still open. The
driver, its measurements and every shot are kept under
`.tmp/web-polish-2026-09-22/` in the checkout (outside git, along with the other eyeball
harnesses).

**The panel was narrower than its own roster row.** At 19rem the name column of a roster
row was 69 px for a name needing 82 px, so the guest's own `Guest One` painted as
`Guest ...` while two verbs that can never be pressed took 132 px of a 234 px row, and
following a nine-character peer elided that name too (`demo-h... Following`). The panel is
**21rem** now: the same three rows measure 82/82, 100/100 and 69/69 — nothing elided, the
tightest of them with 5 px to spare — and the editor keeps 1125 px of the 1440 px window.
The backdrop's own panel went with it, because it is a picture of this layout.
`test/join-chrome.test.ts` pins the width and that the two agree. This is the same remedy
the panel already had once (17rem → 19rem), and it postpones rather than removes the
question: two labelled verbs and a name still need ~250 px, and a long name still elides.

**The phone's disclosure opened onto its people and cut off its files.** Measured at
412×915 with the driver's touch emulation, one host and two guests: at the 38% cap the
panel was 314 px of the workspace, ended at y 447, and every file row sat below it (first
row 428, last 518) with 90 px of panel scroll left — the control is named `Files and
people` and showed no files. At **60%** the panel is 404 px, no row is cut, and the panel
stops scrolling at all (scrollHeight 403 = clientHeight). The editor keeps 318 px while
the disclosure is open and returns to the full workspace when a file opens it shut, which
is the state the 38% figure was measured for.

**The phone's copy control was an empty box.** Below 640 px the bar hides the readout and
keeps the icon, so the control measured **381×44 px holding a 14×14 icon and no text at
all** — an empty field with a link glyph in it. It now carries `Copy invite link` beside
the icon, shown by exactly the query that hides the readout, and `aria-hidden` because the
control's own `aria-label` already names it. On a pointer device the label is back to
`display: none` and the bar is what it was.

**The hand-copy fallback pointed at a link that could not join.** With
`navigator.clipboard.writeText` refused and `document.execCommand('copy')` answering false
— both stubbed in the real page, the way the clipboard-less path really fails — the alert
said `Select the link and copy it by hand.` while `#share` held
`/?room=r-edb2…f8f75&token=411853…55578`: the *abbreviated display*, with the selection
collapsed at its end. Selecting what was there and sending it produces an invite no room
answers. `hand-copy.ts` is the fallback now, and it puts the abbreviation back only when
the browser's copy command reported success; a failed copy leaves the whole link in the
field, selected. On a narrow bar, where that field is `display: none`, the failure adds
`#share-group.hand-copy`, which reveals the readout and stands the label down — otherwise
the instruction would still point at nothing.

The walk also confirmed four states as correct, unchanged:

- the dead room's refusal (`Nothing answers at that link. …`), the bad paste (`That invite
  link does not name a session. …`), the empty room's `The host has not shared any files
  yet.` and the read-only blank editor behind it;
- the host's grace window counting down in its own strip, and the room-gone card coming
  back with the reason, the whole link, nothing in the room saved, the pasted name kept
  and the paste box focused;
- follow, go-to and the tree's presence badges, with the peer's caret and selection fill on
  the desktop and the second guest's edit converging after a socket drop;
- the missing pointer target: at 700×800 the page has no sideways scroll and only Monaco's
  own oversize nodes cross the edge, exactly as the earlier round recorded.

Two of the three open items from earlier rounds are answered here, and one is left:

- **A dropped socket showing nothing while it reconnects: leave it.** Typing into the room
  with the browser forced offline and then restored converged on the other guest unchanged
  (`offline-edit` in `notes.md` on both pages), because what a dropped socket loses is
  local and §9.1 re-opens what the client held. There is nothing for the guest to act on
  during a drop it cannot see, and a drop that outlasts the retry budget already ends with
  the card.
- **The shortened room id in the share bar: leave it.** The readout is masked at rest,
  reveals the abbreviation on hover or focus, and the element's title and the clipboard
  both hold the whole link — proven again here by reading `#share`'s title beside its
  value. Whether 12 characters still reads as an identifier is the owner's call, not a
  defect.
- **The ghost document: reached, and it is not the defect it was thought to be.** A
  second guest can close a path the page holds `doc.close` for, but the room keeps a path
  while any peer holds it, and the page holds every document it shows — two closes from
  another guest left `documents` unchanged. The path leaves the room only while the page's
  own socket is down (the room forgets that peer's claims), and that is the one window in
  which the page can neither publish nor hear the close; on the reseat it re-opened the
  path and the room listed it again (`todo.txt` back in `documents`). What remains true is
  narrower than the note claimed: during a drop the buffer in front of the editor is still
  editable though the room no longer holds it, which costs nothing because nothing typed
  can leave the page — and the page re-opens it the moment the socket is back.

One thing the walk could not check on this host: the clipboard itself. Chromium refuses
`navigator.clipboard.readText()` here, so the *primary* copy path (API write) is pinned by
its unit tests and by the fallback it lands in, not by reading the clipboard back; the
fallback was exercised for real both ways, success and failure, by stubbing the two calls.

Open, and deliberately not touched: whether the roster's two verbs should keep their text
labels on a pointer device, where the desktop client's inline actions are icons alone —
that is the other way to give a name its room, and it is a presentation the owner shaped.
