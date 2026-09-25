/**
 * What the editor pane says when no document is in front of it.
 *
 * A room with nothing open is the room's first screen, and the pane is the
 * largest thing on it: it carries the one fact the person needs and the act that
 * follows from it, in that pane rather than in a sentence somewhere else
 * (design §7). Four states, and each names the next step where it stands:
 *
 * - a host whose folder is empty, told what sharing a file means, with `New
 *   file` inserting the row that creates one and the invite beside it;
 * - a host with files, told that opening one is what puts its text in the room;
 * - a guest whose host has shared nothing, told whose room it is and that
 *   nothing is loading;
 * - a guest with files, told what opening one costs the room, and offered the
 *   peer that is already in one.
 *
 * On a device with no hover the pane's own act is the panel: shut, it is the
 * only place the tree can be reached from and nothing else on screen opens it
 * (§7.6). The host with an empty folder keeps `New file`, which opens the panel
 * itself, because creating is the act that state is about.
 *
 * The sentences live here and nowhere else in the page: one home for copy that
 * the tests pin (`test/empty-editor.test.ts`).
 */

/** The acts the pane can offer, as the page dispatches them. */
export type EmptyEditorAction =
  | 'new-file'
  | 'copy-invite'
  | 'browse-files'
  | 'go-to'
  | 'follow'
  | 'stop-follow';

/** What the pane's blocks say, in the order they stand. */
export interface EmptyEditorBlock {
  /** The state's own sentence, read first and drawn as the lead. */
  lead?: string;
  /** What the block is about, after the lead. */
  text?: string;
  /** The acts beside the sentence. */
  actions: readonly EmptyEditorAction[];
  /** The peer the block's acts are about, when it is about one. */
  peerId?: string;
}

export interface EmptyEditorState {
  blocks: readonly EmptyEditorBlock[];
}

/** What the pane is drawn from: the room, this window, and the device. */
export interface EmptyEditorFacts {
  /** This window holds the folder the room is drawn from. */
  host: boolean;
  /** The folder's own name, which the host's empty state names. */
  folder: string;
  /** How many files the room's listing carries. */
  files: number;
  /** The host's display name, for the guest's sentence; empty before the roster arrives. */
  hostName: string;
  /** This device has no hover, so the panel is a disclosure with no other way in. */
  phone: boolean;
  /** A peer that is in a file, when one is. */
  peer?: { peerId: string; name: string; path: string } | undefined;
  /** The peer this window is following, so the peer block's toggle is the state it is in. */
  following?: string | undefined;
}

/** The panel's own verb, where the panel is the only way to the thing the sentence names. */
const BROWSE_FILES = 'Browse files';

/** The act the empty folder's state is about, in the same words as the panel's own verb. */
const NEW_FILE = 'New file';

/**
 * The pane's empty state for a room as it stands.
 */
export function emptyEditorFor(facts: EmptyEditorFacts): EmptyEditorState {
  const blocks: EmptyEditorBlock[] = [];
  if (!facts.host && facts.files === 0) {
    blocks.push({
      lead: `${hostNameOf(facts)} hasn't shared any files yet.`,
      text: "They'll appear in Shared as soon as the host's folder has some.",
      // Nothing is loading, so nothing spins: the room is empty and that is all the pane says.
      actions: facts.phone ? [BROWSE_ACTION] : [],
    });
  } else if (facts.host && facts.files === 0) {
    blocks.push({
      lead: `Your folder “${facts.folder}” is empty.`,
      text: "Files you create here are shared by name; a file's text reaches the room when it is opened.",
      actions: ['new-file', 'copy-invite'],
    });
  } else if (facts.host) {
    blocks.push({
      text: 'Pick a file from Shared. Its text reaches the room when you open it.',
      actions: facts.phone ? [BROWSE_ACTION] : [],
    });
  } else {
    blocks.push({
      text: 'Pick a file from Shared. Opening a file asks the host for its text, and everyone in the room receives it.',
      actions: facts.phone ? [BROWSE_ACTION] : [],
    });
  }
  const peer = facts.peer;
  if (peer !== undefined) {
    const following = facts.following === peer.peerId;
    blocks.push({
      text: `${peer.name} is in ${peer.path}`,
      actions: ['go-to', following ? 'stop-follow' : 'follow'],
      peerId: peer.peerId,
    });
  }
  return { blocks };
}

/** The panel's verb, as the act the page dispatches. */
const BROWSE_ACTION: EmptyEditorAction = 'browse-files';

/** The host's name, or the role, which is all a page knows before the roster arrives. */
function hostNameOf(facts: EmptyEditorFacts): string {
  const name = facts.hostName.trim();
  return name === '' ? 'The host' : name;
}

/** What one act's control reads, wherever the pane draws it. */
export function emptyEditorActionLabel(action: EmptyEditorAction): string {
  switch (action) {
    case 'new-file':
      return NEW_FILE;
    case 'copy-invite':
      return 'Copy invite link';
    case 'browse-files':
      return BROWSE_FILES;
    case 'go-to':
      return 'Go to';
    case 'follow':
      return 'Follow';
    case 'stop-follow':
      return 'Following ✓';
  }
}

/**
 * Draws the state into `pane`, or hides the pane when there is nothing to say.
 *
 * The blocks are the whole of the pane's contents, replaced as one: an empty
 * state that left the last room's sentences behind would be the wrong room's
 * advice, and the actions are the page's own dispatcher (`run`), so this module
 * decides what is said and the page decides what a press does.
 */
export function renderEmptyEditor(
  pane: HTMLElement,
  state: EmptyEditorState | undefined,
  run: (action: EmptyEditorAction, peerId: string | undefined) => void,
): void {
  pane.replaceChildren();
  pane.hidden = state === undefined;
  if (state === undefined) {
    return;
  }
  for (const block of state.blocks) {
    const section = document.createElement('div');
    section.className = 'empty-block';
    if (block.lead !== undefined) {
      const lead = document.createElement('p');
      lead.className = 'empty-lead';
      lead.textContent = block.lead;
      section.appendChild(lead);
    }
    if (block.text !== undefined) {
      const text = document.createElement('p');
      text.className = 'empty-text';
      text.textContent = block.text;
      section.appendChild(text);
    }
    if (block.actions.length > 0) {
      const actions = document.createElement('div');
      actions.className = 'empty-actions';
      for (const action of block.actions) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = action === 'new-file' ? 'primary' : '';
        button.dataset.action = action;
        if (action === 'stop-follow') {
          button.setAttribute('aria-pressed', 'true');
        }
        button.textContent = emptyEditorActionLabel(action);
        button.addEventListener('click', () => run(action, block.peerId));
        actions.appendChild(button);
      }
      section.appendChild(actions);
    }
    pane.appendChild(section);
  }
}
