/**
 * Types for the Monaco ESM subpaths `monaco.ts` imports that the package ships
 * no declarations for. The entry points it declares itself — `monaco-editor/editor`
 * and every `.../register` this module names — are resolved by TypeScript through
 * the package's own `exports` map, and are not declared here.
 *
 * What is left is the inside of the tree: the shared language-registration helper,
 * the two worker entries, and the two services the shared-text link guard reads.
 */
declare module 'monaco-editor/languages/definitions/_.contribution.js' {
  export function registerLanguage(def: {
    id: string;
    extensions?: string[];
    filenames?: string[];
    aliases?: string[];
    mimetypes?: string[];
    loader: () => Promise<{ language: unknown; conf: unknown }>;
  }): void;
}

declare module 'monaco-editor/editor/editor.worker.js';

declare module 'monaco-editor/languages/features/typescript/ts.worker.js';

/** The standalone service locator, for the shared-text link guard. */
declare module 'monaco-editor/editor/standalone/browser/standaloneServices.js' {
  export const StandaloneServices: {
    get<T>(serviceId: unknown): T;
  };
}

/** The opener-service token, for the shared-text link guard. */
declare module 'monaco-editor/platform/opener/common/opener.js' {
  export const IOpenerService: unknown;
}
