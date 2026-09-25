/**
 * The suite CI runs: every test in `test/`, in a checkout that carries one
 * repository.
 *
 * `test/identity.test.ts` reads the `site` checkout beside this one — the page's
 * mark is that checkout's file, compared byte for byte — and a single-repository
 * job has no sibling. It resolves the sibling from this repository's own git
 * directory, so a worktree finds it too, and the one test that needs it *skips
 * with that reason* rather than the file being excluded by name. What is left of
 * that file needs this checkout alone, and it runs here: the icon determinism and
 * clock-chunk tests never ran in CI while the whole file was excluded.
 *
 * `test/serve-types.test.ts` was expected to need a sibling too, and does not: it
 * reads `dist/` alone and takes its extension table from
 * `scripts/check-content-types.mjs`. `npm test` runs the same files with the
 * sibling checkout in place, so every test runs somewhere.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const excluded = [];

const files = readdirSync(resolve(root, 'test'))
  .filter((file) => file.endsWith('.test.ts'))
  .sort();

for (const name of excluded) {
  if (!files.includes(name)) {
    throw new Error(
      `test/${name} is named as an exclusion and does not exist — fix the name rather than run a suite that covers less than it says`,
    );
  }
}

const run = files.filter((file) => !excluded.includes(file));
if (run.length === 0) {
  throw new Error('no test files to run: test/ holds only exclusions');
}

console.log(
  `node --test over test/: ${run.length} files${
    excluded.length === 0 ? '' : `, excluding ${excluded.map((name) => `test/${name}`).join(', ')}`
  }`,
);

const result = spawnSync(
  process.execPath,
  ['--test', ...run.map((file) => `test/${file}`)],
  { cwd: root, stdio: 'inherit' },
);
process.exit(result.status ?? 1);
