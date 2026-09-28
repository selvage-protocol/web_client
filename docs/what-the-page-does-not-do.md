# What the page does not do

No accounts, no analytics, no stored state beyond the live session, the remembered display name and
the tab's own note that it was hosting; no automatic rejoin or host reclaim. A test pins that the
guest path never asks for the host role and that the only mint is the one behind the folder picker.

`BROWSER_NOTES.md` has the decisions, the bundle diet, and the one layer a human still has to
eyeball: Monaco rendering, which the proving host has no display for.
