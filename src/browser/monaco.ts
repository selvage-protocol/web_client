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
 * Monaco ships none of the three (`tokenizers/`).
 *
 * The paths are the ones 0.56 sorted into entry points: the editor's features, the
 * API namespace, and one `register` per language and per language service, in place
 * of the `esm/vs/...` tree this module used to walk directly.
 */

// Every editor feature: find, suggest, folding, the standalone extras. This is Monaco's own
// "all features" entry, and what replaced the core entry that also registered them.
import 'monaco-editor/features/register.all.js';

import { registerLanguage } from 'monaco-editor/languages/definitions/_.contribution.js';
import 'monaco-editor/languages/definitions/markdown/register.js';
import 'monaco-editor/languages/definitions/mdx/register.js';
import 'monaco-editor/languages/definitions/typescript/register.js';
import 'monaco-editor/languages/definitions/javascript/register.js';
import 'monaco-editor/languages/definitions/rust/register.js';
import 'monaco-editor/languages/definitions/css/register.js';
import 'monaco-editor/languages/definitions/scss/register.js';
import 'monaco-editor/languages/definitions/less/register.js';
import 'monaco-editor/languages/definitions/html/register.js';
import 'monaco-editor/languages/definitions/xml/register.js';
import 'monaco-editor/languages/definitions/yaml/register.js';
import 'monaco-editor/languages/definitions/shell/register.js';
import 'monaco-editor/languages/definitions/python/register.js';
import 'monaco-editor/languages/definitions/go/register.js';
import 'monaco-editor/languages/definitions/cpp/register.js';
import 'monaco-editor/languages/definitions/java/register.js';
import 'monaco-editor/languages/definitions/sql/register.js';
import 'monaco-editor/languages/definitions/lua/register.js';
import 'monaco-editor/languages/definitions/ini/register.js';
import 'monaco-editor/languages/definitions/dockerfile/register.js';
import 'monaco-editor/languages/definitions/powershell/register.js';
import 'monaco-editor/languages/definitions/ruby/register.js';
import 'monaco-editor/languages/definitions/php/register.js';
import 'monaco-editor/languages/definitions/csharp/register.js';
import 'monaco-editor/languages/definitions/kotlin/register.js';
import 'monaco-editor/languages/definitions/swift/register.js';
import 'monaco-editor/languages/definitions/dart/register.js';
import 'monaco-editor/languages/definitions/r/register.js';
import 'monaco-editor/languages/definitions/perl/register.js';
import 'monaco-editor/languages/definitions/clojure/register.js';
import 'monaco-editor/languages/definitions/graphql/register.js';
import 'monaco-editor/languages/definitions/protobuf/register.js';
import 'monaco-editor/languages/definitions/hcl/register.js';
import 'monaco-editor/languages/definitions/restructuredtext/register.js';
import 'monaco-editor/languages/definitions/coffee/register.js';
import 'monaco-editor/languages/definitions/bat/register.js';
import 'monaco-editor/languages/features/typescript/register.js';

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

export * as monaco from 'monaco-editor/editor.js';

// The editor's opener service, for the shared-text link guard (`links.ts`).
// These ride the same dynamic import as the runtime above, never the card.
export { StandaloneServices } from 'monaco-editor/editor/standalone/browser/standaloneServices.js';
export { IOpenerService } from 'monaco-editor/platform/opener/common/opener.js';
