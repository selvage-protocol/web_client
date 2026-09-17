/**
 * The Monaco runtime this page runs: the editor core plus exactly the languages
 * the page claims to show, each backed by its tokenizer — and, for
 * TypeScript/JavaScript, the language worker that makes the mode understanding
 * rather than colouring. Every other path stays `plaintext` (`languages.ts`).
 *
 * This module replaces the `monaco-editor` root import, which pulls in all
 * eighty-odd tokenizers and every language service. The tokenizers load lazily:
 * each contribution registers a loader, and the bundle splits on it.
 */

import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution.js';
import 'monaco-editor/esm/vs/language/typescript/monaco.contribution.js';

export * as monaco from 'monaco-editor/esm/vs/editor/edcore.main.js';

// The editor's opener service, for the shared-text link guard (`links.ts`).
// These ride the same dynamic import as the runtime above, never the card.
export { StandaloneServices } from 'monaco-editor/esm/vs/editor/standalone/browser/standaloneServices.js';
export { IOpenerService } from 'monaco-editor/esm/vs/platform/opener/common/opener.js';
