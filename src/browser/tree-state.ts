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
