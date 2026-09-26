/**
 * The name and version this page sends as `session.hello`'s `client` (`PROTOCOL.md` §2): free-form
 * client identification for diagnostics, read by nobody and parsed by nothing.
 *
 * The version is the manifest's, which is the version `scripts/release-tags.sh` tags the image
 * with, and `test/client-identity.test.ts` fails when the two disagree — so a release that moves
 * one without the other is red before it publishes. The proof scripts that join the way the page
 * does take this constant for the same reason.
 */
export const CLIENT_ID = "web_client/0.5.0";
