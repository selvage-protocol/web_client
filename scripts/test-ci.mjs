/**
 * The suite CI runs, which is the suite in `test/` minus the tests that need a
 * checkout this repository does not carry.
 *
 * `test/identity.test.ts` compares the page's mark, byte for byte, with the `site`
 * checkout beside this one (through that checkout's own git history), and a CI job
 * that checks out one repository has no sibling: it is the one test in the suite
 * that reads another repository. `test/serve-types.test.ts` was expected to need one
 * too, and does not: it reads `dist/` alone and takes its extension table from
 * `scripts/check-content-types.mjs`, so it runs here, as does the rest of the 300-odd
 * tests.
 *
 * The exclusions are named, and a name that no longer exists is an error rather than
 * a suite that quietly covers less than this file claims. `npm test` runs everything,
 * with the sibling checkout in place.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const excluded = ['identity.test.ts'];

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
  `node --test over test/: ${run.length} files, excluding ${excluded
    .map((name) => `test/${name}`)
    .join(', ')}`,
);

const result = spawnSync(
  process.execPath,
  ['--test', ...run.map((file) => `test/${file}`)],
  { cwd: root, stdio: 'inherit' },
);
process.exit(result.status ?? 1);
