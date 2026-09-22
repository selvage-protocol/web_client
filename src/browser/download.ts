/**
 * Keeping a document: the room's text, out of the room and onto the person's own disk.
 *
 * The page holds the text already — the model in front of the editor, or the replica behind it —
 * so a download is one blob and one anchor. It is worth having on its own, for both roles: a
 * guest who has just edited a file and cannot keep it is the one gap in "come edit my code with
 * me", and for a host whose folder refused a write (§`file-tree-and-the-grant`'s stale-file
 * problem) it is the only way out with the room's text before the room closes.
 *
 * The name is the room path's own leaf, and it is safe to hand a browser as a filename: a path a
 * session carries has already passed the grant's rules (`isGrantedPath`), which leave out a
 * control character, a separator and the traversal segments a `download` attribute would have to
 * be defended against.
 */

/** Where a download goes: the browser's own two steps, injected so the suite needs no DOM. */
export interface DownloadSink {
  /** A blob holding the text — the page builds a plain-text one. */
  blob(text: string): Blob;
  /** An object URL for it, alive until `deliver` releases it. */
  url(blob: Blob): string;
  /** Hand the URL to the browser under `name`, then release it. */
  deliver(url: string, name: string): void;
}

/** The filename a room path downloads as: its own leaf, or a plain fallback. */
export function downloadName(path: string): string {
  const leaf = path.split('/').pop() ?? '';
  // A path is not a filename: `/` separates, and a browser refuses to save a name whose leaf is
  // a relative segment. A room path cannot be either, but the fallback costs one line.
  return leaf === '' || leaf === '.' || leaf === '..' ? 'document.txt' : leaf;
}

/** Saves `text` as `path`'s own file. */
export function downloadDocument(path: string, text: string, sink: DownloadSink): void {
  sink.deliver(sink.url(sink.blob(text)), downloadName(path));
}
