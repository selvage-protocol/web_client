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
