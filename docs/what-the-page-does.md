# What the page does

The pre-join card is inline HTML, so it paints before the bundle arrives, and its own inline script
has already decided which shape it is (a bare open shows the paste box, a link open does not) and
prefilled the remembered name, so the first painted frame is the final one. A name typed during a slow
load survives, because the prefill only fills an untouched field. The editor stack loads on join and
not before.

After joining, the session bar shows the share link with the page's own origin dropped and the room id
and the token shortened middle-first, masked until hovered or focused and fading in rather than
snapping, sized to what it shows so the whole thing reads at a glance. The whole bar copies it, focus
plus Enter included, with the full link as its title and the clipboard bytes. A submit that lands
before the page finishes loading never fails: it queues until loaded and joins exactly once, the
button reading `Joining…` throughout. The last joined name is remembered for prefill in the browser
only.

On a device with a pointer the first shared file opens focused, so typing starts at once. A phone
focuses it on the first tap instead, so the soft keyboard does not stand over a room nobody has seen,
and starts with the tree behind the file strip, which carries a chevron for it and opens the panel
under itself. The same layout answers for a phone on its side: a 844x390 touch device is the phone
layout and not the desktop column.

The people in the room are faces in the session bar, to the right of the invite pill and before the
way out: your own seat first, always, then the room's peers, with the cluster capped at five controls
on a pointer device or three on a phone, faces and the `+N` together. A room at or under the cap shows
every face; over it the last slot is the `+N`, so six people on a pointer device read four faces and
`+2`, and the `+N` opens the list of everyone. A face wears three marks, each a shape rather than a
colour (a solid ring for your own seat, a dashed ring and an eye for the one you follow, a crown for
the host), and the person you follow is never the one counted away, because that ring is the only
place a follow shows on this bar. Pressing a face opens that person's menu under it, with `Go to`
where they are in a file and `not in a file yet` where they are not, a `Follow` toggle that reads
`Stop following` once it is on, and your own `Rename`, which edits the name in the menu itself. A
go-to the room cannot answer (the peer closed the file, or its caret does not resolve here) says so in
that menu for four seconds as two lines: `Nothing to go to` over the room's own reason. The empty
pane's own `Go to`, which has no menu to stand it in, says the same sentence in the alert. The sidebar
is the tree: what the room shares, with a peer badge on whose file is whose and, on a shut folder, the
badges of the peers inside it. A row states nothing else about the room (the tags that said a document
reads empty or had not arrived, and the mark a refused write put there, are gone), and an action that
refuses says so beside its own control, or in the alert where it has none. The panel's create verbs
stand in a bar at its foot, labelled `New file` and `New folder`, and the row a press opens asks for a
`New file name` or a `New folder name` (`in <dir>` where it stands in one) and offers `Create` and
`Cancel`.

Following shows on the followed face (a dashed ring and an eye) with `Stop following` in that
person's menu, and ends when you type, navigate (open a file from the tree or go to someone), stop it,
or the peer leaves. A follow that ended without a stop says why on the alert, for four seconds.
Everything the page has to say over the workspace stands in one notices column in the top-right
corner, floating above it: the session card, the failure alert, the line a tap reveals, and a toast
per file saved. When the host's socket drops, the card names the host, counts the grace window down to
the room's own deadline under a bar that drains with it, and turns red saying `The session ended` when
the window is out; when the host returns it says so for a few seconds and then clears, and the bar's
identity keeps naming the host's session throughout. A file saved out of the room (fetched first when
this window has no text for it) is `Downloaded <leaf>`, two at a time with the rest counted. The
column takes no click and moves nothing under it. When the room ends, because the host does not return
before the grace expires, the page leaves the session: the socket closes, the binding and the editor
are dropped, the chrome comes down, and the card returns over the blurred preview carrying
`The room is gone (host did not return). Nothing is kept on this page; the folder the room was
hosted from has the text it had settled on. Paste a fresh invite link to join another session.`
A page has no disk to leave a copy on. Nothing of the dead room stays on screen, the name stays typed,
and pasting a fresh link joins the next room from there. A guest never claims host and never rebuilds
a room on its own: the only mint is the one behind the folder picker, and a test pins that the guest
path never asks for the host role.

A page-hosted room has one more thing to say. The room lives in its tab, so a reload ends it, and the
load after one says `Reloading ended the room this tab was hosting…` rather than offering a card that
looks like the last one.
