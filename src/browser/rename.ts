/**
 * Renaming yourself, apart from the page it happens on.
 *
 * `PROTOCOL.md` §5 announces an accepted rename to the whole room as `peer.renamed`, the mover
 * included, and the engine follows that event for this connection's own seat, so a re-hello
 * carries the name the room has (`§9.1`). It is not yet the new name when the request returns,
 * because §5 puts the event after the response: the page therefore keeps the name it is seated
 * under itself (`selfName`), sends the change over the bridge, and answers for the outcome.
 *
 * The two sentences are the vocabulary's, not this module's invention: the
 * confirmation is the desktop clients' own line for the moment, word for word
 * (`docs/studies/client-command-parity.md` §5), and the refusal is where the
 * clients already differ, so it is this page's wording. They are separated from
 * the page so a suite can pin the words and the order they are said in without a
 * browser: the page's entry module runs on import and cannot be one.
 */

import { validateDisplayName } from './join.ts';

/** What the action asks of the page it runs on. */
export interface RenamePorts {
  /** The name this window is seated under, which the page keeps (`§5`). */
  current(): string;
  /** §5's request, over the page's own room. */
  rename(name: string): Promise<void>;
  /** Remembers the name, so the next join's prefill is the one in force. */
  remember(name: string): void;
  /** Takes the new name as the one the page's own row wears. */
  applied(name: string): void;
  /** A refusal, in the words this module builds. */
  refused(sentence: string): void;
  /** The confirmation, said where the page says one. */
  said(sentence: string): void;
}

/** The desktop clients' own sentence for a name that changed (§5). */
export function renamedSentence(name: string): string {
  return `display name set to "${name}"`;
}

/** This page's sentence for a rename the room would not take. */
export function renameRefused(why: string): string {
  return `Could not change your name: ${why}`;
}

/**
 * Sends the typed name and answers for it.
 *
 * The refusals are ordered as the person meets them: a name the room's own bound
 * would not take is refused here, before anything is sent, with the card's own
 * sentence for that question (`validateDisplayName`); a name that is already in
 * force sends nothing, because §5's request would relabel nothing; and a server
 * that refused the request is reported with its own reason rather than swallowed,
 * since a page that silently kept the old name would look like it accepted it.
 */
export async function renameSelf(raw: string, ports: RenamePorts): Promise<void> {
  let name: string;
  try {
    name = validateDisplayName(raw);
  } catch (error: unknown) {
    ports.refused(reason(error));
    return;
  }
  if (name === ports.current()) {
    return;
  }
  try {
    await ports.rename(name);
  } catch (error: unknown) {
    ports.refused(renameRefused(reason(error)));
    return;
  }
  ports.applied(name);
  ports.remember(name);
  ports.said(renamedSentence(name));
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
