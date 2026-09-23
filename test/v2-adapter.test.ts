/**
 * The page's `selvage/2` wiring: which version a link asks for, which version a host mints, and
 * the one place a host's listing is read from.
 *
 * `§5.1` is the whole of the first answer: the room key and the host key travel on the link's
 * fragment, so a link that names both is a version-2 room and a link with none — every link the
 * published client has ever handed on — is not. The second is a host's own choice, because it is
 * the host's key that seals a version-2 room's state, and it is made on the page with `?wire=2`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { hostsVersion2, listingSource, wireVersionOf } from '../src/browser/relay.ts';
import { buildShareLink, parsePageLink } from '../src/browser/share.ts';
import { fragmentOf, resolveJoin } from '../src/browser/join.ts';

/** `§5.1`'s fragment, the shape `encodeKey` writes: two 43-character base64url keys. */
const KEYS =
  '#k=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&h=BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

const main = readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8');

describe('the version a link asks for', () => {
  it('a fragment naming both keys is a selvage/2 invite', () => {
    assert.equal(wireVersionOf(`ws://edit.example/session?room=r-1&token=tok${KEYS}`), 'selvage/2');
    assert.equal(wireVersionOf(`https://edit.example/?room=r-1&token=tok${KEYS}`), 'selvage/2');
  });

  it('a fragment that names one key, or neither, is not', () => {
    // `#x` is a fragment a page's own address can already carry, and it names no key: it must not
    // send a join to an engine that would then refuse the invite it was handed.
    assert.equal(wireVersionOf('ws://edit.example/session?room=r-1&token=tok#x'), 'selvage/1');
    assert.equal(wireVersionOf('ws://edit.example/session?room=r-1&token=tok#k=AAAA'), 'selvage/1');
    assert.equal(wireVersionOf('ws://edit.example/session?room=r-1&token=tok#h=BBBB'), 'selvage/1');
  });

  it('a link with no fragment at all is the version every published client speaks', () => {
    assert.equal(wireVersionOf('ws://edit.example/session?room=r-1&token=tok'), 'selvage/1');
  });

  it('another parameter beside the two keys does not change the version', () => {
    assert.equal(wireVersionOf(`ws://edit.example/session?room=r-1&token=tok${KEYS}&x=1`), 'selvage/2');
  });
});

describe('the version a host mints', () => {
  it('?wire=2 and ?wire=selvage/2 ask for a version-2 room', () => {
    assert.equal(hostsVersion2('?wire=2'), true);
    assert.equal(hostsVersion2('wire=2'), true);
    assert.equal(hostsVersion2('?wire=selvage/2'), true);
    assert.equal(hostsVersion2('?debug=1&wire=2'), true);
  });

  it('anything else, including unset, is the version every published client speaks', () => {
    assert.equal(hostsVersion2(''), false);
    assert.equal(hostsVersion2('?'), false);
    assert.equal(hostsVersion2('?wire=1'), false);
    assert.equal(hostsVersion2('?wire=3'), false);
    assert.equal(hostsVersion2('?other=2'), false);
  });
});

describe("a version-2 host's listing", () => {
  it('is one place to read and one to replace', () => {
    const listing = listingSource(['notes.txt']);
    assert.deepEqual(listing.current(), ['notes.txt']);
    listing.replace(['notes.txt', 'src/main.ts']);
    assert.deepEqual(listing.current(), ['notes.txt', 'src/main.ts']);
    // The caller's array is not the source's: a state is sealed from this, and a walk that
    // mutates what it was read into would change what the room is told.
    const paths = ['a.txt'];
    const fromWalk = listingSource(paths);
    paths.push('b.txt');
    assert.deepEqual(fromWalk.current(), ['a.txt']);
  });

  it('starts empty when the folder named nothing', () => {
    assert.deepEqual(listingSource().current(), []);
  });
});

describe('a version-2 link', () => {
  it('carries the fragment on the page link a host hands on', () => {
    const link = buildShareLink('wss://edit.example', 'r-1', 'tok', KEYS);
    assert.equal(link, `https://edit.example/?room=r-1&token=tok${KEYS}`);
    // The two forms of the link are the same room, the same token and the same two keys: this is
    // the page link, and the wire invite is what the engine minted.
    assert.deepEqual(parsePageLink(link), {
      room: 'r-1',
      token: 'tok',
      origin: 'https://edit.example',
      fragment: KEYS,
    });
    assert.deepEqual(resolveJoin(searchParamsOf(link), '', link), {
      base: 'wss://edit.example',
      room: 'r-1',
      token: 'tok',
      fragment: KEYS,
    });
  });

  it('a page link with no fragment joins the way it always did', () => {
    const link = buildShareLink('wss://edit.example', 'r-1', 'tok');
    assert.equal(link, 'https://edit.example/?room=r-1&token=tok');
    assert.equal(fragmentOf(link), '');
    assert.deepEqual(resolveJoin(new URLSearchParams(), link, 'https://edit.example/'), {
      base: 'wss://edit.example',
      room: 'r-1',
      token: 'tok',
      fragment: '',
    });
  });

  it('a fragment is never query data', () => {
    assert.equal(fragmentOf('https://edit.example/?room=r-1&token=tok#k=1'), '#k=1');
    assert.equal(fragmentOf('https://edit.example/?room=r-1&token=tok'), '');
    assert.equal(fragmentOf('no hash here'), '');
  });
});

describe('the page picks the version', () => {
  it('routes a link that names two keys to the version-2 join, and any other to the engine it had', () => {
    assert.match(
      main,
      /wireVersionOf\(invite\) === 'selvage\/2'[\s\S]{0,20}\? await joinRoom2\(invite, displayName\)[\s\S]{0,20}: await SelvageEngine\.join\(invite, displayName, CLIENT_OPTIONS\)/,
      'a join no longer chooses its engine by the link it was handed',
    );
  });

  it('walks the folder before the version-2 mint, and not before the version-1 one', () => {
    // `§7.1` seals the room state from the listing, so a host that minted first would put an
    // empty tree in front of its first guest.
    assert.match(
      main,
      /hostsVersion2\(window\.location\.search\)[\s\S]*?listingSource\(await folder\.list\(\)\)[\s\S]*?\? await hostRoom2\(base, displayName, listing\)/,
      'a version-2 mint no longer follows the folder walk',
    );
  });
});

/** The search parameters a page's own address carries, which is what the address bar is read as. */
function searchParamsOf(link: string): URLSearchParams {
  return new URL(link).searchParams;
}
