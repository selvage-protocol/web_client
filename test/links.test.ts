/**
 * Shared-text links must never navigate the session page: the editor's
 * default external opener answers any non-http(s) target with
 * `location.href = href`, so a `file:` link from room content drives the page
 * itself at `file:///...` — refused with a Security Error. The guard swallows
 * everything but web and mail links, and no served first-party source may
 * reference a `file:` URL at all.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  linkOpensExternally,
  linkTargetScheme,
  registerLinkGuard,
} from '../src/browser/links.ts';
import type { GuardableOpenerService, LinkTarget } from '../src/browser/links.ts';

function fakeService(): { service: GuardableOpenerService; openers: Array<(target: LinkTarget) => boolean | Promise<boolean>>; disposals: () => number } {
  const openers: Array<(target: LinkTarget) => boolean | Promise<boolean>> = [];
  let disposed = 0;
  return {
    openers,
    disposals: () => disposed,
    service: {
      registerOpener: (opener) => {
        openers.push((target) => opener.open(target));
        return { dispose: () => void (disposed += 1) };
      },
    },
  };
}

describe('linkOpensExternally', () => {
  it('lets web and mail links through to the default opener', () => {
    for (const scheme of ['http', 'https', 'mailto', 'HTTP', 'MailTo']) {
      assert.equal(linkOpensExternally(scheme), true, scheme);
    }
  });

  it('swallows file, command, and anything else shared text could name', () => {
    for (const scheme of ['file', 'FILE', 'command', 'vsls', 'vscode-file', 'ftp', '', 'notes.md']) {
      assert.equal(linkOpensExternally(scheme), false, scheme || '(empty)');
    }
  });
});

describe('linkTargetScheme', () => {
  it('reads the scheme from a URI or a raw string', () => {
    assert.equal(linkTargetScheme({ scheme: 'file' }), 'file');
    assert.equal(linkTargetScheme({ scheme: 'https' }), 'https');
    assert.equal(linkTargetScheme('file:///etc/passwd'), 'file');
    assert.equal(linkTargetScheme('https://edit.example/?room=r-1'), 'https');
  });

  it('answers empty for relative targets', () => {
    assert.equal(linkTargetScheme('./other.md'), '');
    assert.equal(linkTargetScheme('notes.md'), '');
  });
});

describe('registerLinkGuard', () => {
  it('hands the registration back, so the caller can drop it', () => {
    const { service, disposals } = fakeService();
    const registration = registerLinkGuard(service);
    assert.equal(disposals(), 0, 'the guard disposed itself the moment it registered');
    registration.dispose();
    assert.equal(disposals(), 1, 'the registration cannot be dropped');
  });

  it('swallows file targets before the default opener runs', async () => {
    const { service, openers } = fakeService();
    registerLinkGuard(service);
    assert.equal(openers.length, 1);
    assert.equal(await openers[0]({ scheme: 'file' }), true);
    assert.equal(await openers[0]('file:///etc/passwd'), true);
  });

  it('leaves web and mail links to the default handling', async () => {
    const { service, openers } = fakeService();
    registerLinkGuard(service);
    assert.equal(await openers[0]({ scheme: 'https' }), false);
    assert.equal(await openers[0]({ scheme: 'http' }), false);
    assert.equal(await openers[0]('mailto:someone@example.com'), false);
  });

  it('swallows command and relative targets too', async () => {
    const { service, openers } = fakeService();
    registerLinkGuard(service);
    assert.equal(await openers[0]('command:editor.action.deleteLines'), true);
    assert.equal(await openers[0]('./other.md'), true);
  });

  it('swallows the shapes the editor actually hands over', async () => {
    // Uppercase strings, the editor's relative-file shape
    // (`file://./relativeFile.txt`, links.js), and URI objects with
    // vendor schemes — all reach the guard, none reach the default opener.
    const { service, openers } = fakeService();
    registerLinkGuard(service);
    assert.equal(await openers[0]('FILE:///etc/passwd'), true);
    assert.equal(await openers[0]('file://./relativeFile.txt'), true);
    assert.equal(await openers[0]({ scheme: 'vscode-file' }), true);
    assert.equal(await openers[0]({ scheme: 'FILE' }), true);
  });
});

describe('no file: references in the served output', () => {
  /**
   * Everything the page serves, plus the shell source it is copied from:
   * the bundle, every lazy chunk, both workers, maps, stylesheets, the
   * manifest, the SVG icon — and the binaries too (ASCII survives the
   * decode, so a smuggled URL cannot hide in a font or a favicon).
   */
  function servedFiles(): Array<{ name: string; text: string }> {
    const out: Array<{ name: string; text: string }> = [];
    const walk = (dir: URL, prefix: string): void => {
      let entries: string[];
      try {
        entries = readdirSync(dir).map(String).sort();
      } catch {
        assert.fail(`${prefix} is missing — run npm run build first`);
      }
      for (const entry of entries) {
        const url = new URL(entry, dir);
        if (statSync(url).isDirectory()) {
          walk(url, `${prefix}${entry}/`);
        } else {
          out.push({ name: `${prefix}${entry}`, text: readFileSync(url, 'utf8') });
        }
      }
    };
    walk(new URL('../dist/', import.meta.url), 'dist/');
    out.push({
      name: 'public/index.html',
      text: readFileSync(new URL('../public/index.html', import.meta.url), 'utf8'),
    });
    return out;
  }

  /**
   * Audited runtime-code atoms (S3, 2026-09-18): TypeScript inside the
   * language worker builds file: URL *strings* it never fetches — the
   * CPU-profiler node URL and the disk-path serializer. They are pinned as
   * exact quoted/template atoms, so a real `file:///…` URL can never hide
   * inside them (no closing-quote adjacency). If a monaco upgrade moves
   * these, the list — and the audit — moves with it.
   */
  const AUDITED_FILE_URL_ATOMS = ['`file://${', '"file://"', '"file:///"'];

  it('no file:// survives outside the audited atoms', () => {
    for (const { name, text } of servedFiles()) {
      let stripped = text;
      for (const atom of AUDITED_FILE_URL_ATOMS) {
        stripped = stripped.split(atom).join('');
      }
      assert.ok(
        !stripped.includes('file://'),
        `${name} references a file:// URL outside the audited atoms`,
      );
    }
  });

  it('no load-position file: reference in any served text file', () => {
    // href/src/url(/import(/Worker(/fetch(/location.href=/window.open( —
    // every shape that could drive the page at file:///... Only static
    // string targets: the guard in this file already swallows every runtime
    // target the opener service can be handed.
    const patterns = [
      /href\s*=\s*['"]file:/i,
      /src\s*=\s*['"]file:/i,
      /url\(\s*['"]?file:/i,
      /importscripts\(\s*['"]file:/i,
      /import\(\s*['"]file:/i,
      /worker\(\s*['"]file:/i,
      /fetch\(\s*['"]file:/i,
      /\.href\s*=\s*['"]file:/i,
      /window\.open\(\s*['"]file:/i,
    ];
    for (const { name, text } of servedFiles()) {
      if (/\.(png|ttf|woff2?)$/.test(name)) continue;
      for (const pattern of patterns) {
        assert.ok(!pattern.test(text), `${name} carries a loadable file: URL: ${pattern}`);
      }
    }
  });

  it('the page shell holds no file: link, worker, or asset target', () => {
    const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
    for (const pattern of [/href="file:/i, /src="file:/i, /url\(file:/i, /file:\/\/\//]) {
      assert.ok(!pattern.test(html), `page shell references a file: URL: ${pattern}`);
    }
  });
});
