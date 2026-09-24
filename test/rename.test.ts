/**
 * Renaming yourself: the one action, its two sentences, and the order it answers
 * in.
 *
 * `§5` gives the request and its confirmation words, and the desktop clients
 * already carry them (`docs/studies/client-command-parity.md` §5): the sentence
 * pinned here is theirs, word for word, because a person who uses both clients
 * must not have to learn a second line for the same moment. The refusal is where
 * the clients already differ, so it is this page's own.
 *
 * The page cannot be driven here — `main.ts` is the entry module and runs on
 * import — so the action lives in `src/browser/rename.ts` and the page hands it
 * its rooms, its storage and its two message homes. Every check below failed
 * before this module existed: the page sent nothing at all.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { renameRefused, renameSelf, renamedSentence } from '../src/browser/rename.ts';
import { MAX_DISPLAY_NAME_UNITS } from '../src/browser/join.ts';

/**
 * A page, as the action sees one: what it was asked, in the order it was asked,
 * and the name it holds. `failure` makes `§5`'s request fail, as a room that
 * would not take the name does.
 */
function renamingPage(seated: string, failure?: string) {
  const seen: string[] = [];
  let current = seated;
  const ports = {
    current: () => current,
    rename: async (name: string) => {
      seen.push(`rename:${name}`);
      if (failure !== undefined) {
        throw new Error(failure);
      }
      current = name;
    },
    remember: (name: string) => void seen.push(`remember:${name}`),
    applied: (name: string) => void seen.push(`applied:${name}`),
    refused: (sentence: string) => void seen.push(`refused:${sentence}`),
    said: (sentence: string) => void seen.push(`said:${sentence}`),
  };
  return { seen, ports, name: () => current };
}

describe('the sentence a rename is confirmed with', () => {
  it('is the desktop clients’ own line, word for word', () => {
    // `docs/studies/client-command-parity.md` §5, "Display name, set".
    assert.equal(renamedSentence('ada'), 'display name set to "ada"');
    assert.equal(renamedSentence('Ada Lovelace'), 'display name set to "Ada Lovelace"');
  });

  it('names the cause on a refusal, which the clients word for themselves', () => {
    assert.equal(
      renameRefused('the session is not connected'),
      'Could not change your name: the session is not connected',
    );
  });
});

describe('renaming yourself', () => {
  it('sends the trimmed name and tells the room, the storage and the person', async () => {
    const page = renamingPage('sam');
    await renameSelf('  ada  ', page.ports);
    assert.deepEqual(page.seen, [
      'rename:ada',
      'applied:ada',
      'remember:ada',
      'said:display name set to "ada"',
    ]);
    assert.equal(page.name(), 'ada', 'the page still holds the old name');
  });

  it('refuses a blank name in the card’s own words, sending nothing', async () => {
    const page = renamingPage('sam');
    await renameSelf('   ', page.ports);
    assert.deepEqual(page.seen, ['refused:Type the name other participants will see.']);
    assert.equal(page.name(), 'sam');
  });

  it('refuses a name past the room’s bound before it is sent', async () => {
    const page = renamingPage('sam');
    await renameSelf('a'.repeat(MAX_DISPLAY_NAME_UNITS + 1), page.ports);
    assert.equal(page.seen.length, 1);
    assert.match(page.seen[0] ?? '', /^refused:That name is 33 characters and the room allows 32\./);
    assert.ok(!page.seen[0]?.startsWith('rename:'), 'an over-long name was sent');
    assert.equal(page.name(), 'sam');
  });

  it('sends nothing when the name is the one already in force', async () => {
    const page = renamingPage('ada');
    await renameSelf('ada', page.ports);
    assert.deepEqual(page.seen, [], 'a rename to the same name was sent');
  });

  it('reports a room that would not take it, and keeps the old name', async () => {
    const page = renamingPage('sam', 'the session is not connected');
    await renameSelf('ada', page.ports);
    assert.deepEqual(page.seen, [
      'rename:ada',
      'refused:Could not change your name: the session is not connected',
    ]);
    assert.equal(page.name(), 'sam', 'the page took a name the room refused');
  });
});
