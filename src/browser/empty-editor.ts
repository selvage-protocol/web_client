/**
 * What the editor pane says when no document is in front of it.
 *
 * A room with nothing open is the room's first screen, and the pane is the
 * largest thing on it: it carries the one fact the person needs and the act that
 * follows from it, in that pane rather than in a sentence somewhere else
 * (design §7). Three states, and each names the next step where it stands:
 *
 * - a host whose folder is empty, told what sharing a file means, with `New
 *   file` inserting the row that creates one and the invite beside it;
 * - a guest whose host has shared nothing, told whose room it is and that
 *   nothing is loading;
 * - either of them with files to pick from, told the one act: open one.
 *
 * The host and the guest read that third state in the same words. What separates
 * them is the empty folder — theirs to fill, or the other's — and the tree
 * itself; the pane's one sentence is the act, and it is not the pane's job to
 * explain the room's shape to either of them.
 *
 * On a device with no hover the pane's own act is the panel, where the panel is shut: the strip
 * names and opens it, and the pane is the other way in. An act that opens what is already open does
 * nothing visible, and a phone whose room shares nothing has the panel open already — so the pane
 * offers it only where it is the only way in, which is what `panelOpen` says.
 *
 * The host with an empty folder keeps `New file`, which opens the panel
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
  /** The host's display name, for the guest's sentence; empty before the room's people arrive. */
  hostName: string;
  /** This device has no hover, so the panel is a disclosure to be offered where it is shut. */
  phone: boolean;
  /** Whether that disclosure is already open, where the pane would otherwise offer to open it. */
  panelOpen: boolean;
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
      lead: `${hostNameOf(facts)} hasn\u2019t shared any files yet.`,
      text: 'They\u2019ll appear in Shared as soon as the host\u2019s folder has some.',
      // Nothing is loading, so nothing spins: the room is empty and that is all the pane says.
      actions: panelActs(facts),
    });
  } else if (facts.host && facts.files === 0) {
    blocks.push({
      lead: `Your folder “${facts.folder}” is empty.`,
      text: 'Files you create here are shared by name; a file\u2019s text reaches the room when it is opened.',
      actions: ['new-file', 'copy-invite'],
    });
  } else {
    // Either role, with files to pick from: one sentence, and it is the act. What the room does
    // with the file once it is open is the pane's job only where the folder is empty and sharing
    // has to be explained.
    blocks.push({
      text: 'Open a file to start editing.',
      actions: panelActs(facts),
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

/**
 * The blocks' acts on a phone: the panel's own verb where the panel is shut, and none of it where
 * it is already open — the button would otherwise be the one control in the pane and do nothing.
 */
function panelActs(facts: EmptyEditorFacts): readonly EmptyEditorAction[] {
  return facts.phone && !facts.panelOpen ? [BROWSE_ACTION] : [];
}

/** The host's name, or the role, which is all a page knows before the room's people arrive. */
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
      // No tick: the word is the state, the control carries `aria-pressed`, and a mark after a word
      // that already says it is decoration.
      return 'Following';
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
        if (action === 'follow' || action === 'stop-follow') {
          // The same toggle the menu draws, in both states: a control that becomes a toggle on
          // its press is announced as one before the press too.
          button.setAttribute('aria-pressed', action === 'stop-follow' ? 'true' : 'false');
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
