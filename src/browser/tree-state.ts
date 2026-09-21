/**
 * Everything the tree's rows are drawn from beside where everyone is: the listing, which
 * file is open, whether that file's text has arrived, and whether this device has a
 * pointer to read the unpublished pill's short form with.
 *
 * A re-render is owed when this changes and not when only the presence on the rows moved,
 * which is every frame a peer's cursor takes — on a listing of thousands of paths that
 * re-render is the whole cost of watching someone else type.
 *
 * A granted path carries no line feed and no NUL (a name with a control character is not a
 * granted path), so joining the listing is unambiguous: two listings that read the same
 * have the same key.
 */
export function rowsKey(
  listing: readonly string[],
  chrome: { current: string | undefined; unpublished: boolean; touch: boolean },
): string {
  return [
    chrome.current ?? '',
    chrome.unpublished ? '1' : '0',
    chrome.touch ? '1' : '0',
    listing.join('\n'),
  ].join('\u0000');
}

/**
 * Whether a grant-tree directory renders expanded: pinned open by the guest, or
 * holding the open file. Re-renders consult this instead of deriving openness
 * from the open file alone, so untouched folders stay as the guest left them.
 */
export function dirOpen(path: string, pinned: ReadonlySet<string>, current: string | undefined): boolean {
  if (pinned.has(path)) {
    return true;
  }
  return current !== undefined && current.startsWith(`${path}/`);
}

/**
 * Whether a grant-tree file row wears the unpublished badge: only the open
 * file, whose hold has settled, may claim it. Every unopened path reads
 * unpublished too (nothing fetched yet), so badging those would mark the
 * whole tree rather than the one file the host has not shared.
 */
export function showUnpublishedBadge(
  path: string,
  current: string | undefined,
  unpublished: boolean,
): boolean {
  return unpublished && current !== undefined && path === current;
}

/**
 * What that pill says. A pointer device reads the short form and the reason on
 * its `title`; a phone has no hover and no native tooltip, so the pill carries
 * the reason itself — the one line a guest with a finger can actually read.
 */
export function unpublishedPillText(touch: boolean): string {
  return touch ? 'not shared by the host' : 'not yet shared';
}
