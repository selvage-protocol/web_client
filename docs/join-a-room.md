# Join a room

The page's own `/` takes the room and its token as query parameters:

```text
http://host/?room=<room>&token=<token>
```

A host produces that link with the editor clients' copy-invite command
(`Selvage: Copy the invite link` in VS Code, `:SelvageCopyInvite` in Neovim), which builds it from
the room's own server. A `ws://host:8080/session?room=…&token=…` invite is the other shape the page
takes, pasted into the box a bare open shows, for a room whose server serves no page.

Either way the card carries a heading, one question (your name) and one confirm, over a blurred
preview of the editor. Type the name and press Join or Enter, and the first shared file opens
focused. A pasted page link lands in the address bar, so a reload rejoins from it.
