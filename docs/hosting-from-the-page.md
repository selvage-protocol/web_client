# Hosting from the page

A page with no invite can start one: type the name, press **Share a folder…**, and the browser asks
for a folder. The folder is the room's working copy — the page walks it for the listing a guest's
tree draws, reads a file out when a guest asks for it, and writes the text the room settles on back
through it, within half a second of the room settling and whoever typed it. Nothing is uploaded, and
no file outside the folder the person picked can be named through the handle. The invite link is
then the one the session bar carries, and it is the same link an editor host would have produced:
whoever opens it joins as a guest and edits the folder with them.

Five things that shape it:

- **Chromium only, and only where the page's origin is the server.** `showDirectoryPicker` is Chrome
  and Edge; Firefox and Safari get a sentence where the button would be, and joining still works
  there. A page that is not served by a Selvage server (the page-only image with no `SELVAGE_SERVER`,
  a static dev server) says so instead of offering a control that could only refuse (see
  [Sessions on the wire](sessions-on-the-wire.md)).
- **Read and write.** The picker asks for both, because the room's settled text has to reach the
  folder or the room is a scratch pad rather than a working copy.
- **The stale-file guard.** The page holds a replica and a directory handle and cannot see the file
  change under it, so before writing it compares the file's `lastModified` with the stamp its last
  read or write saw. If something else wrote the file — a formatter, a build, a `git checkout`,
  another editor — the write is **refused** and reported instead of overwriting it, which is what VS
  Code and Neovim do on save and what a page has no watcher to do any other way. A path the page never
  read is refused the same way.
- **The tab is the host, and a reload ends the room.** A host's invite link is not written into the
  address bar: reloading would rejoin its own room as a guest with no folder while the room's grace
  ran out underneath it. The card offers the action and says nothing else, and the load after a reload
  says what the reload cost — the room, its invite link and the keystrokes still inside the settle,
  and everything else is already in the folder. Reclaiming inside the grace is not built.
- **Not every file in the folder is shared.** Anyone with the invite link can open and edit the files
  the page shares, and their edits — and yours — are written back to those files on disk. `.env`,
  `.git/**` and the key names are excluded from the listing, a binary-named path is left out, and a
  file past the size bound is refused.

**Download** takes a document out of the room and onto the person's disk — for a guest who has just
edited a file and cannot keep it, and for a host whose folder refused the write. It is one control
per file row, where the room's files are, and it is there for every file the room holds.
