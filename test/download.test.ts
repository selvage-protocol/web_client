/**
 * Downloading a document out of the room.
 *
 * The page holds the text already, so this is the name and the order of the two browser calls
 * and nothing else; the browser's own blob and anchor live in `main.ts`, behind the sink here.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { downloadDocument, downloadName } from '../src/browser/download.ts';

describe('the filename a room path downloads as', () => {
  it('is the path\'s own leaf, wherever the file sits', () => {
    assert.equal(downloadName('notes.txt'), 'notes.txt');
    assert.equal(downloadName('src/main.ts'), 'main.ts');
    assert.equal(downloadName('a/b/c/d.md'), 'd.md');
  });

  it('is a filename and not a path, whatever it was handed', () => {
    // A browser refuses a name that is a relative segment, and a room path never is one.
    assert.equal(downloadName(''), 'document.txt');
    assert.equal(downloadName('.'), 'document.txt');
    assert.equal(downloadName('src/..'), 'document.txt');
    assert.ok(!downloadName('src/main.ts').includes('/'), 'a separator survived into the name');
  });
});

describe('the download itself', () => {
  it('builds the blob from the text, names it after the path, and delivers it', () => {
    const calls: string[] = [];
    const sink = {
      blob: (text: string) => {
        calls.push(`blob:${text}`);
        return { text } as unknown as Blob;
      },
      url: (blob: Blob) => {
        calls.push(`url:${(blob as unknown as { text: string }).text}`);
        return 'blob:room/1';
      },
      deliver: (url: string, name: string) => {
        calls.push(`deliver:${url}:${name}`);
      },
    };
    downloadDocument('src/main.ts', 'let a = 1;\n', sink);
    assert.deepEqual(calls, [
      'blob:let a = 1;\n',
      'url:let a = 1;\n',
      'deliver:blob:room/1:main.ts',
    ]);
  });

  it('saves an empty document too: an empty file is a state a person may want', () => {
    const delivered: Array<[string, string]> = [];
    downloadDocument(
      'notes.txt',
      '',
      {
        blob: () => ({}) as Blob,
        url: () => 'blob:room/2',
        deliver: (url, name) => void delivered.push([url, name]),
      },
    );
    assert.deepEqual(delivered, [['blob:room/2', 'notes.txt']]);
  });
});
