# Hosting from the page

A page with no invite can start one: type the name, press **Share a folder…**, and the browser asks
for a folder. The folder is the room's working copy — the page walks it, honoring the folder's own
ignore files, for the listing a guest's tree draws, reads a file out when a guest asks for it, and
writes the text the room settles on back through it, within half a second of the room settling and
whoever typed it. Nothing is uploaded, and no file outside the folder the person picked can be named
through the handle. The invite link is
then the one the session bar carries, and it is the same link an editor host would have produced:
whoever opens it joins as a guest and edits the folder with them.

Seven things that shape it:

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
  file past the size bound is refused. The folder's own ignore files narrow the listing the way they
  narrow a `git status`: `<folder>/.git/info/exclude` at the lowest precedence, then every
  `.gitignore` at or below the folder, the last matching pattern deciding, and an ignored directory
  is never walked into. Their patterns follow `gitignore(5)`, with one divergence — a `?` and a
  bracket class count characters, as `fnmatch(3)` documents, where git counts UTF-8 bytes. They bind
  the file a guest asks for as well as the listing: a path that is there and ignored is refused the
  same silent `not-granted` an excluded name gets, and a path that is not there is refused `missing`
  like any other absent path, which says nothing about the ignore rule either.
  One room listing carries a bounded number of paths and a bounded number of path bytes. A folder
  past either is shared in part, the walk stopping at the first path that would cross the bound, and
  that is said **to the host** — once for the cut, on the page's transient line — because the host is
  the one who can share a smaller folder. A guest sees a listing and never a cut.
- **The folder is the bound on what the page reads.** A `.gitignore` above the picked folder is not
  read, so a folder shared from inside a repository does not honor the rules above it, and neither
  git's user-wide ignore (`core.excludesFile`) nor any other rule outside the folder is read. What
  this cannot pin: the File System Access API has no `lstat`, so a link is read only as the API
  presents it — Chromium neither lists a symbolic link nor answers for one by name, and a linked
  `.gitignore` or `.git` therefore supplies no rules, but an implementation that listed a link as an
  ordinary file would be read as one. An ignore file larger than the files a room carries is not
  read either, and a `.gitignore` that is not UTF-8 text is no ignore file at all.
- **A file the host opens is the host's own act.** The folder's ignore files are the folder's rules
  for what the room shares, not a lock on the disk: the page's window is driven by the listing, so a
  person opens what the room shares, and the bridge's seed gate stays name-only — it re-checks the
  shared excludes and the size and consults no ignore file, because a path the host itself brings to
  the editor is not a peer's guess.

**Download** takes a document out of the room and onto the person's disk — for a guest who has just
edited a file and cannot keep it, and for a host whose folder refused the write. It is one control
per file row, where the room's files are, and it is there for every file the room holds.
