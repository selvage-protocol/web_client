# web_client

The browser client for the Selvage session protocol, over the engine and the bridge the editor
clients share. A share link opens the page, a guest edits in Monaco and converges with the room, and
a Chromium browser can also start a room here: pick a folder and the folder itself is what the room
shares, with the host's working copy staying the source of truth. Joining is one click, in every
browser; hosting from the page needs the File System Access API, so it is Chrome and Edge and not
Firefox or Safari, and a page can only host where the server that serves it also answers `/meta`.

## Get it working

You need Node 22.18 or newer, and a running `selvaged` server the page can reach.

```sh
npm ci        # install exactly what package-lock.json pins
npm run build # write dist/
npm run serve # serve dist/ at http://localhost:8081/
```

Open `http://localhost:8081/`, paste an invite link, type a name and join. With no link the card is
the one that can start a room, where the page is served by a Selvage server and the browser has a
folder picker.

`npm run serve` is `python3 -m http.server 8081 --directory dist`. That port is the development
server's alone, chosen to avoid `selvaged`'s default 8080; it is not the deployed page's port. The
image listens on 8080 and `compose.yaml` publishes it on 80 — see
[Serving the page](docs/serving-the-page.md).

When you change a dependency, `npm install --no-audit --no-fund` writes the lockfile.

## Settings and identity

There is no account: the name typed on the card is all the room knows a person by, and the page keeps
it in the browser so the next card is prefilled. The file panel's width is remembered the same way.
Nothing else is written down, and the mark a hosting tab leaves itself is gone with the tab: a room
lives in memory and ends when its host leaves.

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
- [Languages and peer markers](docs/languages-and-peer-markers.md): the mode list, and how a peer is
  drawn

## Licence

`MIT OR Apache-2.0`, in `LICENSE-MIT` and `LICENSE-APACHE`.
