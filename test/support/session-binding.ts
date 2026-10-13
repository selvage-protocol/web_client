import { MonacoBinding } from '../../src/browser/editor.ts';
import { FolderWorkingCopy } from '../../src/browser/folder.ts';
import type { FolderDirectoryHandle, FolderFileHandle } from '../../src/browser/folder.ts';

export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

export class ManualTimers {
  private readonly pending = new Map<number, () => void>();
  private next = 0;
  private readonly delays = new Map<number, number>();
  hasDelay(delay: number): boolean {
    return [...this.pending.keys()].some((id) => this.delays.get(id) === delay);
  }
  after(delay: number, run: () => void): () => void {
    const id = ++this.next;
    this.pending.set(id, run);
    this.delays.set(id, delay);
    return () => void this.pending.delete(id);
  }
  fire(): void {
    for (const [id, run] of [...this.pending]) {
      this.pending.delete(id);
      run();
    }
  }
}

export function model(text: string) {
  let current = text;
  let disposed = false;
  const listeners = new Set<() => void>();
  return {
    isDisposed: () => disposed,
    dispose: () => { disposed = true; },
    getValue: () => current,
    getEOL: () => current.includes('\r\n') ? '\r\n' : '\n',
    getPositionAt: (offset: number) => ({ lineNumber: 1, column: offset + 1 }),
    getOffsetAt: (position: { column: number }) => position.column - 1,
    pushEditOperations: (_before: unknown, edits: Array<{ text: string; range: { startColumn: number; endColumn: number } }>) => {
      for (const edit of edits) {
        current = current.slice(0, edit.range.startColumn - 1) + edit.text + current.slice(edit.range.endColumn - 1);
      }
      return null;
    },
    onDidChangeContent: (listener: () => void) => {
      listeners.add(listener);
      return { dispose: () => void listeners.delete(listener) };
    },
    edit: (next: string) => { current = next; listeners.forEach((listener) => listener()); },
  };
}

export function editor() {
  let front: ReturnType<typeof model> | null = null;
  return {
    createDecorationsCollection: () => ({ set: () => {}, clear: () => {} }),
    onDidChangeCursorSelection: () => ({ dispose: () => {} }),
    getSelection: () => null,
    setModel: (next: ReturnType<typeof model> | null) => { front = next; },
    front: () => front,
    updateOptions: () => {}, focus: () => {},
    getOption: () => ({ verticalScrollbarSize: 10, horizontalScrollbarSize: 10 }),
  };
}

export function engine(texts = new Map<string, string>()) {
  const listeners = new Set<(event: { type: string; path?: string }) => void>();
  const emit = (event: { type: string; path?: string }) => listeners.forEach((listener) => listener(event));
  const peer = { peer_id: 'p', display_name: 'Peer', role: 'guest' as const };
  const room = {
    session: () => ({ role: 'host', roomId: 'r', peer: { peer_id: 'self', display_name: 'Self', role: 'host' }, documents: [] }),
    text: (path: string) => texts.get(path) ?? '', has: (path: string) => texts.has(path),
    open: async (_path: string) => {}, close: async (_path: string) => {},
    openDocuments: () => [], documents: () => [...texts.keys()],
    grantedPaths: () => ['a.txt', 'b.txt', 'notes.txt'],
    peers: () => [peer], presence: () => [{ peer, state: { path: 'b.txt' } }],
    holds: () => [], resolveSelection: () => undefined, setSelection: () => {}, clearSelection: () => {},
    insert: (path: string, index: number, text: string) => {
      const current = texts.get(path) ?? '';
      texts.set(path, current.slice(0, index) + text + current.slice(index));
    },
    delete: (path: string, index: number, length: number) => {
      const current = texts.get(path) ?? '';
      texts.set(path, current.slice(0, index) + current.slice(index + length));
    },
    on: (listener: (event: { type: string; path?: string }) => void) => {
      listeners.add(listener); return () => void listeners.delete(listener);
    },
    emit,
    remote: (path: string, text: string) => { texts.set(path, text); emit({ type: 'documentChanged', path }); },
  };
  return room;
}

export function dom() {
  globalThis.document = {
    createElement: () => ({ append: () => {}, remove: () => {} }),
    head: { appendChild: () => {} },
  } as unknown as Document;
}

export function workingFolder(texts: Map<string, string>) {
  let stamp = 0;
  const files = new Map([...texts].map(([path, text]) => [path, { text, lastModified: ++stamp }]));
  const directories = new Set(['', 'other']);
  for (const path of files.keys()) {
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) { directories.add(parts.slice(0, i).join('/')); }
  }
  const writes: Array<[string, string]> = [];
  const removed: string[] = [];
  const directory = (path: string): FolderDirectoryHandle => ({
    kind: 'directory', name: path.split('/').at(-1) || 'workspace',
    async *values() {
      const prefix = path === '' ? '' : `${path}/`;
      for (const [paths, kind] of [[directories, 'directory'], [files.keys(), 'file']] as const) {
        for (const child of paths) {
          const name = child.slice(prefix.length);
          if (child.startsWith(prefix) && name !== '' && !name.includes('/')) { yield { name, kind }; }
        }
      }
    },
    async getDirectoryHandle(name, options) {
      const at = path === '' ? name : `${path}/${name}`;
      if (files.has(at)) { throw new DOMException(at, 'TypeMismatchError'); }
      if (!directories.has(at)) {
        if (!options?.create) { throw new DOMException(at, 'NotFoundError'); }
        directories.add(at);
      }
      return directory(at);
    },
    async getFileHandle(name, options): Promise<FolderFileHandle> {
      const at = path === '' ? name : `${path}/${name}`;
      if (directories.has(at)) { throw new DOMException(at, 'TypeMismatchError'); }
      if (!files.has(at)) {
        if (!options?.create) { throw new DOMException(at, 'NotFoundError'); }
        files.set(at, { text: '', lastModified: ++stamp });
      }
      const file = files.get(at)!;
      return {
        kind: 'file', name,
        getFile: async () => ({
          lastModified: file.lastModified, size: new TextEncoder().encode(file.text).length,
          arrayBuffer: async () => new TextEncoder().encode(file.text).buffer,
        }),
        createWritable: async () => {
          let pending = '';
          return {
            write: async (text) => { pending = text; },
            close: async () => {
              file.text = pending; file.lastModified = ++stamp; writes.push([at, pending]);
            },
            abort: async () => {},
          };
        },
      };
    },
    async removeEntry(name) {
      const at = path === '' ? name : `${path}/${name}`;
      removed.push(at);
      files.delete(at);
      directories.delete(at);
      for (const child of files.keys()) { if (child.startsWith(`${at}/`)) { files.delete(child); } }
      for (const child of directories) { if (child.startsWith(`${at}/`)) { directories.delete(child); } }
    },
  });
  return { folder: new FolderWorkingCopy(directory('')), files, directories, writes, removed };
}
export { MonacoBinding };
