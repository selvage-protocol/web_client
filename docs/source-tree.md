# What is in the tree

`src/engine/` and `src/bridge/` are copies of `vscode_client/src/{engine,bridge}`, never edited
here. Refresh them with `npm run sync-engine`, which records the upstream SHA in
`scripts/sync-engine.sh`.

The copy carries `selvage/2`'s session layer with the rest of the engine: `src/engine/sealed.ts` is
`CANONICAL.md` §6.1's bytes, `src/engine/peer.ts` is `PROTOCOL.md` §13, `src/engine/host.ts` is
§7.1's producer half — the room state the host key seals, and one rule for each state that goes out
— and `src/engine/crypto.ts` is the crypto seam a caller supplies — HKDF-SHA256, SHA-256,
AES-256-GCM and Ed25519 — which this page implements with WebCrypto, the engine's own default. The
seam is asynchronous for exactly this client's sake, since WebCrypto has no synchronous form.
