/**
 * The grant tree as a view: what a room change has to redraw, and what it does not.
 *
 * The tree draws two kinds of thing, and they change at completely different rates. Its
 * *rows* — which paths exist, which one is open, whether that file's text has arrived —
 * change when the listing changes, which is the user's own doing. Its *badges* — who is in
 * which file — change on every presence frame the room sends, which is every cursor move
 * every peer makes.
 *
 * Redrawing the rows for the second kind is what this module exists to avoid. A listing is
 * a peer's word and can name thousands of paths, and rebuilding that tree costs the main
 * thread seconds per second of a peer's typing; a presence move repaints the two rows the
 * peer left and entered instead, and nothing else.
 *
 * It is a module rather than a few functions in `main.ts` because that is what makes the
 * rule testable: the pane and the source are both injected, so a test can count what a
 * frame actually redraws.
 */

import { fileIcon, iconSpan, labelSpan } from './icons.ts';
import { badgeSignature, changedBadgePaths, initials } from './presence.ts';
import { dirOpen, rowsKey, showUnpublishedBadge, unpublishedPillText } from './tree-state.ts';
import type { Participant } from './editor.ts';
import type { GrantChild } from './tree.ts';

/** The slice of the session binding the tree reads. */
export interface TreeSource {
  /** The room's listing: its grant unioned with the documents it holds open. */
  grantListing(): string[];
  /** The immediate children of `directory` in that listing. */
  grantTree(directory?: string): GrantChild[];
  /** The room path in front of the editor, if any. */
  currentPath(): string | undefined;
  /** Whether a room path holds no text anyone has sent. */
  isUnpublished(path: string): boolean;
  /** Every participant, with the path each one says it is in. */
  participants(): Participant[];
}

export interface TreeViewOptions {
  /** The element the tree is drawn into. Emptied and refilled on a rebuild. */
  pane: HTMLElement;
  source: TreeSource;
  /** The directories the guest pinned open. Read on a rebuild, written by the toggles. */
  pinned: Set<string>;
  /** Whether this device has no hover, which is what the unpublished pill's words depend on. */
  touch: () => boolean;
  /**
   * Whether this window can put a file into the folder the room is drawn from (`main.ts`: a host
   * that holds one). It decides what an empty listing says, and nothing else: a guest's empty room
   * is the host's to fill, while a host's own empty folder is a thing this page can act on.
   */
  canCreate?: () => boolean;
  /** A row was clicked: the page decides what opening a path means. */
  open(path: string): void;
}

export class GrantTreeView {
  private readonly pane: HTMLElement;
  private readonly source: TreeSource;
  private readonly pinned: Set<string>;
  private readonly touch: () => boolean;
  private readonly canCreate: () => boolean;
  private readonly open: (path: string) => void;
  /** What the rows were last built from, so a frame that changes none of it rebuilds none. */
  private drawnRows = '';
  /** Each file row's badge container, so a badge repaint has somewhere to land. */
  private readonly hosts = new Map<string, HTMLElement>();
  /** What each row's badges were last drawn with. */
  private readonly badges = new Map<string, string>();

  constructor(options: TreeViewOptions) {
    this.pane = options.pane;
    this.source = options.source;
    this.pinned = options.pinned;
    this.touch = options.touch;
    this.canCreate = options.canCreate ?? ((): boolean => false);
    this.open = options.open;
  }

  /**
   * Draws what the room has changed since the last draw. A listing or a row chrome that
   * reads the same rebuilds nothing and repaints only the badges that moved.
   */
  render(): void {
    const listing = this.source.grantListing();
    const current = this.source.currentPath();
    const rows = rowsKey(listing, {
      current,
      unpublished: current !== undefined && this.source.isUnpublished(current),
      touch: this.touch(),
    });
    if (rows === this.drawnRows) {
      this.refreshBadges();
      return;
    }
    this.drawnRows = rows;
    this.rebuild(listing, current);
  }

  /** Empties the pane and forgets the tree, for the end of a session. */
  reset(): void {
    this.drawnRows = '';
    this.hosts.clear();
    this.badges.clear();
    this.pane.replaceChildren();
  }

  private rebuild(listing: readonly string[], current: string | undefined): void {
    this.hosts.clear();
    this.badges.clear();
    this.pane.replaceChildren();
    if (listing.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      // An empty room reads differently to the two people looking at it: a guest is waiting on
      // the host, and a host is the one who can fill it — with the row above the tree, which is
      // why this sentence names an act rather than the absence of files.
      empty.textContent = this.canCreate()
        ? 'You have not shared anything from this folder yet. Create a file, and it joins the room.'
        : 'The host has not shared any files yet.';
      this.pane.appendChild(empty);
      return;
    }
    this.pane.appendChild(this.level('', 0, current, this.presenceByPath()));
  }

  /** Repaints the rows whose badges the room has moved, and nothing else. */
  private refreshBadges(): void {
    const presence = this.presenceByPath();
    for (const [path, signature] of changedBadgePaths(this.badges, presence)) {
      const host = this.hosts.get(path);
      if (host === undefined) {
        continue;
      }
      this.badges.set(path, signature);
      host.replaceChildren(...badgeNodes(presence.get(path) ?? []));
    }
  }

  /** Where everyone is, by the room path each participant says it is in. */
  private presenceByPath(): Map<string, Participant[]> {
    const presence = new Map<string, Participant[]>();
    for (const participant of this.source.participants()) {
      if (participant.path !== undefined) {
        const known = presence.get(participant.path) ?? [];
        known.push(participant);
        presence.set(participant.path, known);
      }
    }
    return presence;
  }

  private level(
    directory: string,
    depth: number,
    current: string | undefined,
    presence: ReadonlyMap<string, readonly Participant[]>,
  ): HTMLElement {
    const list = document.createElement('ul');
    if (depth === 0) {
      list.style.paddingLeft = '0';
    }
    for (const child of this.source.grantTree(directory)) {
      const item = document.createElement('li');
      if (child.directory) {
        item.appendChild(this.directory(child, depth, current, presence));
      } else {
        item.appendChild(this.file(child, current, presence));
      }
      list.appendChild(item);
    }
    return list;
  }

  private directory(
    child: GrantChild,
    depth: number,
    current: string | undefined,
    presence: ReadonlyMap<string, readonly Participant[]>,
  ): HTMLElement {
    const details = document.createElement('details');
    details.dataset.dir = child.path;
    // Openness is the guest's pin, or an ancestor of the open file — never the open
    // file alone, so re-renders keep folders as the guest left them.
    details.open = dirOpen(child.path, this.pinned, current);
    // Untrusted toggles are the render above, not the guest: only the guest's own
    // opening and shutting pins a directory.
    details.addEventListener('toggle', (event) => {
      if (!event.isTrusted) {
        return;
      }
      if (details.open) {
        this.pinned.add(child.path);
      } else {
        this.pinned.delete(child.path);
      }
    });
    const head = document.createElement('summary');
    head.append(iconSpan('chevron'), iconSpan('folder'), labelSpan(child.name));
    details.appendChild(head);
    details.appendChild(this.level(child.path, depth + 1, current, presence));
    return details;
  }

  private file(
    child: GrantChild,
    current: string | undefined,
    presence: ReadonlyMap<string, readonly Participant[]>,
  ): HTMLElement {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'row';
    row.append(iconSpan(fileIcon(child.path)), labelSpan(child.name));
    // The row's own badge container, kept so a presence move repaints this row rather
    // than the tree around it.
    const here = presence.get(child.path) ?? [];
    const badges = document.createElement('span');
    badges.className = 'presence';
    badges.replaceChildren(...badgeNodes(here));
    this.hosts.set(child.path, badges);
    this.badges.set(child.path, badgeSignature(here));
    row.append(badges);
    if (showUnpublishedBadge(child.path, current, this.source.isUnpublished(child.path))) {
      row.append(this.unpublishedPill());
    }
    if (child.path === current) {
      row.classList.add('open');
    }
    row.addEventListener('click', () => this.open(child.path));
    return row;
  }

  /**
   * The unpublished marker: a quiet pill on the open file's own row.
   *
   * The short form is what a pointer device reads, with the reason on its `title`; a phone
   * has no hover to read that with, so the pill carries the reason itself. Only the open
   * file may wear it (see `showUnpublishedBadge`).
   */
  private unpublishedPill(): HTMLElement {
    const badge = document.createElement('span');
    badge.className = 'unpub';
    badge.textContent = unpublishedPillText(this.touch());
    badge.title = "The host hasn't shared its text yet";
    return badge;
  }
}

/**
 * Who is in one file, as initials badges in peer colours: where someone is reads on the
 * tree, glanceable, instead of path text under roster names.
 */
function badgeNodes(present: readonly Participant[]): HTMLElement[] {
  return present.map((participant) => {
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.style.backgroundColor = participant.colour;
    badge.textContent = initials(participant.displayName);
    badge.title = participant.displayName;
    return badge;
  });
}
