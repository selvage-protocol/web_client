/**
 * Types for the Monaco ESM subpaths `monaco.ts` imports. The package ships types
 * only for its root (`editor.api.d.ts`); the core entry exports that same API
 * surface, and the contributions are side-effectful registrations with nothing
 * to name.
 */
declare module 'monaco-editor/esm/vs/editor/edcore.main.js' {
  export * from 'monaco-editor';
}

declare module 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js';

declare module 'monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js';

declare module 'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution.js';

declare module 'monaco-editor/esm/vs/language/typescript/monaco.contribution.js';

declare module 'monaco-editor/esm/vs/editor/editor.worker.js';

declare module 'monaco-editor/esm/vs/language/typescript/ts.worker.js';

/** The Monaco basic-language registration helper, for this repository's own tokenizers. */
declare module 'monaco-editor/esm/vs/basic-languages/_.contribution.js' {
  export function registerLanguage(def: {
    id: string;
    extensions?: string[];
    filenames?: string[];
    aliases?: string[];
    mimetypes?: string[];
    loader: () => Promise<{ language: unknown; conf: unknown }>;
  }): void;
  export function loadLanguage(languageId: string): Promise<void>;
}

/** The standalone service locator, for the shared-text link guard. */
declare module 'monaco-editor/esm/vs/editor/standalone/browser/standaloneServices.js' {
  export const StandaloneServices: {
    get<T>(serviceId: unknown): T;
  };
}

/** The opener-service token, for the shared-text link guard. */
declare module 'monaco-editor/esm/vs/platform/opener/common/opener.js' {
  export const IOpenerService: unknown;
}
