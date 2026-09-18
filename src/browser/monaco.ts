/**
 * The Monaco runtime this page runs: the editor core plus the languages the page
 * claims to show (`languages.ts`), each backed by its tokenizer — and, for
 * TypeScript/JavaScript, the language worker that makes the mode understanding
 * rather than colouring. Every other path stays `plaintext`.
 *
 * This module replaces the `monaco-editor` root import, which pulls in all
 * eighty-odd tokenizers and every language service. Each contribution only
 * registers the language and a loader; the tokenizer body loads when a document
 * of that language opens, and the bundle splits on it (`lang-*.js`). JSON, TOML
 * and Nix get the same treatment from this repository's own Monarch sets, since
 * Monaco 0.52.2 ships none of the three (`tokenizers/`).
 */

import { registerLanguage } from 'monaco-editor/esm/vs/basic-languages/_.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/mdx/mdx.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/rust/rust.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/css/css.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/scss/scss.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/less/less.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/html/html.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/xml/xml.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/shell/shell.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/go/go.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/java/java.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/lua/lua.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/ini/ini.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/dockerfile/dockerfile.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/powershell/powershell.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/ruby/ruby.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/php/php.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/csharp/csharp.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/kotlin/kotlin.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/swift/swift.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/dart/dart.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/r/r.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/perl/perl.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/clojure/clojure.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/graphql/graphql.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/protobuf/protobuf.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/hcl/hcl.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/restructuredtext/restructuredtext.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/coffee/coffee.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/bat/bat.contribution.js';
import 'monaco-editor/esm/vs/language/typescript/monaco.contribution.js';

// The three the dependency has no basic language for. Same lazy shape: the id
// and its loader register now, the Monarch set loads on first open.
registerLanguage({
  id: 'json',
  extensions: ['.json', '.jsonc', '.json5'],
  aliases: ['JSON', 'json'],
  mimetypes: ['application/json'],
  loader: () => import('./tokenizers/json.ts'),
});
registerLanguage({
  id: 'toml',
  extensions: ['.toml'],
  aliases: ['TOML', 'toml'],
  loader: () => import('./tokenizers/toml.ts'),
});
registerLanguage({
  id: 'nix',
  extensions: ['.nix'],
  aliases: ['Nix', 'nix'],
  loader: () => import('./tokenizers/nix.ts'),
});

export * as monaco from 'monaco-editor/esm/vs/editor/edcore.main.js';

// The editor's opener service, for the shared-text link guard (`links.ts`).
// These ride the same dynamic import as the runtime above, never the card.
export { StandaloneServices } from 'monaco-editor/esm/vs/editor/standalone/browser/standaloneServices.js';
export { IOpenerService } from 'monaco-editor/esm/vs/platform/opener/common/opener.js';
