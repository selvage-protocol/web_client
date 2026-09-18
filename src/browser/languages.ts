/**
 * The room path's language, for the Monaco model showing it.
 *
 * Every language named here is backed with a tokenizer the bundle carries and
 * loads lazily (`monaco.ts`): the ones Monaco ships under `basic-languages`,
 * plus the small Monarch sets this repository adds for JSON, TOML and Nix,
 * which Monaco 0.52.2 has none of. Anything else stays `plaintext`: an honest
 * mode rather than highlighting that pretends.
 */

const BY_EXTENSION: ReadonlyMap<string, string> = new Map<string, string>([
  ['md', 'markdown'],
  ['markdown', 'markdown'],
  ['mdx', 'mdx'],
  ['mdown', 'markdown'],
  ['mkdn', 'markdown'],
  ['mkd', 'markdown'],
  ['mdwn', 'markdown'],
  ['mdtxt', 'markdown'],
  ['mdtext', 'markdown'],
  ['ts', 'typescript'],
  ['tsx', 'typescript'],
  ['cts', 'typescript'],
  ['mts', 'typescript'],
  ['js', 'javascript'],
  ['jsx', 'javascript'],
  ['mjs', 'javascript'],
  ['cjs', 'javascript'],
  ['json', 'json'],
  ['jsonc', 'json'],
  ['json5', 'json'],
  ['rs', 'rust'],
  ['rlib', 'rust'],
  ['css', 'css'],
  ['scss', 'scss'],
  ['less', 'less'],
  ['html', 'html'],
  ['htm', 'html'],
  ['shtml', 'html'],
  ['xhtml', 'html'],
  ['xml', 'xml'],
  ['xsd', 'xml'],
  ['dtd', 'xml'],
  ['svg', 'xml'],
  ['xsl', 'xml'],
  ['xslt', 'xml'],
  ['xaml', 'xml'],
  ['yaml', 'yaml'],
  ['yml', 'yaml'],
  ['sh', 'shell'],
  ['bash', 'shell'],
  ['zsh', 'shell'],
  ['py', 'python'],
  ['pyw', 'python'],
  ['pyi', 'python'],
  ['rpy', 'python'],
  ['go', 'go'],
  ['c', 'cpp'],
  ['h', 'cpp'],
  ['cc', 'cpp'],
  ['cpp', 'cpp'],
  ['cxx', 'cpp'],
  ['c++', 'cpp'],
  ['hpp', 'cpp'],
  ['hh', 'cpp'],
  ['hxx', 'cpp'],
  ['java', 'java'],
  ['sql', 'sql'],
  ['lua', 'lua'],
  ['ini', 'ini'],
  ['properties', 'ini'],
  ['conf', 'ini'],
  ['cfg', 'ini'],
  ['toml', 'toml'],
  ['nix', 'nix'],
  ['dockerfile', 'dockerfile'],
  ['containerfile', 'dockerfile'],
  ['ps1', 'powershell'],
  ['psm1', 'powershell'],
  ['psd1', 'powershell'],
  ['rb', 'ruby'],
  ['gemspec', 'ruby'],
  ['php', 'php'],
  ['phtml', 'php'],
  ['cs', 'csharp'],
  ['csx', 'csharp'],
  ['kt', 'kotlin'],
  ['kts', 'kotlin'],
  ['swift', 'swift'],
  ['dart', 'dart'],
  ['r', 'r'],
  ['rmd', 'r'],
  ['pl', 'perl'],
  ['pm', 'perl'],
  ['clj', 'clojure'],
  ['cljs', 'clojure'],
  ['cljc', 'clojure'],
  ['edn', 'clojure'],
  ['graphql', 'graphql'],
  ['gql', 'graphql'],
  ['proto', 'proto'],
  ['tf', 'hcl'],
  ['tfvars', 'hcl'],
  ['hcl', 'hcl'],
  ['rst', 'restructuredtext'],
  ['coffee', 'coffeescript'],
  ['bat', 'bat'],
  ['cmd', 'bat'],
]);

/** The languages an editor names without an extension. */
const BY_NAME: ReadonlyMap<string, string> = new Map<string, string>([
  ['dockerfile', 'dockerfile'],
  ['containerfile', 'dockerfile'],
  ['.editorconfig', 'ini'],
  ['.gitconfig', 'ini'],
  ['.gitattributes', 'ini'],
]);

/** The Monaco language id for a room path. */
export function languageForPath(path: string): string {
  const slash = path.lastIndexOf('/');
  const name = slash === -1 ? path : path.slice(slash + 1);
  const byName = BY_NAME.get(name.toLowerCase());
  if (byName !== undefined) {
    return byName;
  }
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) {
    return 'plaintext';
  }
  return BY_EXTENSION.get(name.slice(dot + 1).toLowerCase()) ?? 'plaintext';
}
