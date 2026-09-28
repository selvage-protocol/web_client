# Proofs

The proofs drive the page's own code against a real `selvaged`, with a fake editor standing in for
Monaco:

```sh
SELVAGE_BASE=ws://127.0.0.1:8080 npm run prove      # the M1 page stack
SELVAGE_BASE=ws://127.0.0.1:8080 npm run prove:fb2  # the owner-feedback pass
npm run prove:flow2                                 # the flow-review fixes
npm run prove:tls                                   # the same page over TLS
npm run prove:v2                                    # the wire, in a real headless Chromium
```

`SELVAGE_BASE` and `SELVAGE_TLS_BASE` both default to the public demo,
`wss://selvage-demo.dontblameme.dev`, so `prove`, `prove:fb2`, `prove:flow2` and `prove:tls` run
against that instance unless you point them elsewhere. A base names its scheme: nothing on the page's
own path completes a bare domain, because a page reads a link's base or its own origin and both always
carry one.

`prove` mints a room with this checkout's own engine, joins the way the page does with the default
`/meta` check, and walks the room's participants, the grant tree, a jump, a follow, convergence both
ways, a reconnect, and the degraded `/meta` a cross-origin page sees. `prove:fb2` covers tree-only
open, create and move tree refresh, and the share-link shape with a round trip back into a join.
`prove:flow2` re-walks the three headline flows of the flow review. `prove:tls` hosts and joins on the
demo origin and asserts that every derived URL speaks TLS.

`prove:v2` drives a real browser: it starts one `selvaged --serve-page dist` on the room's own origin,
hosts from Node with the engine the page bundles, opens the page on the guest's fragment link in
headless Chromium, joins from the card, opens the room's document from the shared tree, and asserts an
edit in both directions, with `SELVAGE_SELVAGED` and `SELVAGE_CHROMIUM` pointing at a binary and a
browser when the defaults are not the ones on the machine. It is the wire's own browser proof, and it
is the only one that needs a browser: the browser-host flow it does not press is the folder picker's
dialog, which no automation can answer.

What none of them covers is Monaco itself: the adapter owns no protocol logic beyond offset mapping,
which both sides count in UTF-16 code units.
