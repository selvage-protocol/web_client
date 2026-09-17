/**
 * The room path's language, for the Monaco model showing it.
 *
 * Only languages the bundle backs with a tokenizer — and, where the mode needs
 * understanding rather than colouring, a worker — are named here. Anything else
 * stays `plaintext`: an honest mode rather than highlighting that pretends.
 */

const BY_EXTENSION: ReadonlyMap<string, string> = new Map([
  ['md', 'markdown'],
  ['markdown', 'markdown'],
  ['mdown', 'markdown'],
  ['mkdn', 'markdown'],
  ['mkd', 'markdown'],
  ['ts', 'typescript'],
  ['tsx', 'typescript'],
  ['cts', 'typescript'],
  ['mts', 'typescript'],
  ['js', 'javascript'],
  ['jsx', 'javascript'],
  ['mjs', 'javascript'],
  ['cjs', 'javascript'],
]);

/** The Monaco language id for a room path. */
export function languageForPath(path: string): string {
  const slash = path.lastIndexOf('/');
  const name = slash === -1 ? path : path.slice(slash + 1);
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) {
    return 'plaintext';
  }
  return BY_EXTENSION.get(name.slice(dot + 1).toLowerCase()) ?? 'plaintext';
}
