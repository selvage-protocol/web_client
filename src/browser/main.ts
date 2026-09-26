import { sessionBase, sessionUrl } from '../engine/index.ts';
import type { SessionBase } from '../engine/index.ts';
import type { RoomEngine } from './relay.ts';
import { hostRoom, joinRoom, listingSource } from './relay.ts';
import type { SessionInfo } from '../engine/index.ts';
import type * as monacoTypes from 'monaco-editor';
import { MonacoBinding } from './editor.ts';
import type { BindingNotice, Following, GoToOutcome, Participant, StatusTopic } from './editor.ts';
import { handCopy, showDisplay } from './hand-copy.ts';
import {
  SHARE_MASK,
  buildShareLink,
  fitReadout,
  forgetJoinUrl,
  pageQueryParams,
  persistJoinUrl,
} from './share.ts';
import { MAX_DISPLAY_NAME_UNITS, INCOMPLETE_INVITE_SENTENCE, fragmentOf, inviteShortfall } from './join.ts';
import type { monaco as monacoApi } from './monaco.ts';
import {
  cardIntentOf,
  clearNameFailure,
  createJoinGate,
  initJoinCard,
  joinOnEnter,
  primaryActionOf,
  addressBarInvite,
  resolveJoin,
  saveDisplayName,
  showJoinFailure,
  showNameFailure,
  showCardIntent,
  showRejoinCard,
  validateDisplayName,
} from './join.ts';
import type { CardIntent, JoinCardElements, JoinTarget } from './join.ts';
import type { GuardableOpenerService } from './links.ts';
import { registerLinkGuard } from './links.ts';
import { iconSpan, labelSpan } from './icons.ts';
import {
  FolderWorkingCopy,
  folderPickerOf,
  pickFolder,
} from './folder.ts';
import type { NewEntryKind } from './folder.ts';
import { createInFolder } from './new-entry.ts';
import type { CreateOutcome } from './new-entry.ts';
import {
  clearHostingMark,
  hostAvailability,
  markHosting,
  takeHostingNotice,
} from './host.ts';
import { META_REREAD_TIMEOUT_MS, readServerMeta } from './meta-read.ts';
import type { ServerRead } from './meta-read.ts';
import { downloadDocument } from './download.ts';
import type { DownloadSink } from './download.ts';
import { GrantTreeView } from './tree-view.ts';
import type { CreateResult, RowFeedback } from './tree-view.ts';
import {
  fetchAndSave,
  fetchCostsSentence,
  fetchingSentence,
  fetchStandMs,
  stillAskingSentence,
  stillEmptySentence,
} from './fetch-download.ts';
import { FETCH_COSTS_STAND_MS } from './fetch-download.ts';
import { wireSidebar } from './sidebar.ts';
import {
  FACE_LIMIT,
  MORE_ANCHOR,
  NOTHING_TO_GO_TO,
  PHONE_FACE_LIMIT,
  focusInto,
  placeMenu,
  renameHoldsTheList,
  renderEveryoneMenu,
  renderPersonMenu,
  renderRoom,
  syncExpanded,
} from './room.ts';
import type { RenameEdit, RoomPerson } from './room.ts';
import {
  emptyEditorFor,
  renderEmptyEditor,
} from './empty-editor.ts';
import type { EmptyEditorAction } from './empty-editor.ts';
import { renameSelf } from './rename.ts';
import { wireLeave } from './leave.ts';
import { wireShareBox } from './share-box.ts';
import {
  HOST_BACK_STAND_MS,
  RECONNECTING_NOTE,
  hostBackSentence,
  hostPresent,
  wireDownloadToasts,
  wireFailureAlert,
  wireSessionCard,
  wireTapPeek,
} from './notice.ts';
import {
  LEFT_SESSION_SENTENCE,
  SESSION_ENDED_MESSAGE,
  dropSession,
  roomGoneSentence,
  sessionOverMessage,
} from './ended.ts';
import type { ShareBox } from './share-box.ts';
import { describeJoinErrorForDisplay, joinFailureDetail } from './transport.ts';
import { peerColour } from '../bridge/index.ts';
import { schemeMatchBase, serverBaseOf } from './servers.ts';
import {
  PHONE_QUERY,
  TOUCH_QUERY,
  appHeightFor,
  editorOptionsFor,
  watchTouchQuery,
} from './mobile.ts';

(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
  getWorkerUrl: (_moduleId: string, label: string) =>
    label === 'typescript' || label === 'javascript' ? 'ts.worker.js' : 'editor.worker.js',
};

/**
 * Whether this browser has no pointer that can hover: a phone or a tablet, and
 * the one question the page asks about the device. A narrow window on a machine
 * with a mouse answers no, and keeps the layout it has — see `mobile.ts`.
 */
/** The live touch query; `watchTouchQuery` re-decides when a pointer arrives. */
const touchLayout = window.matchMedia(TOUCH_QUERY);
let touchOnly = touchLayout.matches;
/** The same device, phone-shaped: the panel is a disclosure that starts shut. */
const phoneLayout = window.matchMedia(PHONE_QUERY);
/** How far a finger may drift and still count as a tap rather than a scroll. */
const TAP_SLOP = 12;

/** The page's own scheme: an https page speaks TLS to the server, always. */
const pageProtocol = window.location.protocol;

/** The editor runtime, loaded on join — never before, so the card never waits on it. */
let monacoReady: typeof monacoApi | undefined;

async function ensureMonaco(): Promise<typeof monacoApi> {
  if (monacoReady === undefined) {
    try {
      const { monaco } = await import('./monaco.ts');
      monaco.editor.defineTheme('selvage-mocha', {
        base: 'vs-dark',
        inherit: true,
        rules: [
          // Mocha's overlay1 is 4.4:1 on the editor ground — under AA for the
          // dimmest token a reader reads most, the comment — so it steps one
          // shade lighter: 4.9:1, still quiet.
          { token: 'comment', foreground: '868ca2' },
          { token: 'keyword', foreground: 'cba6f7' },
          { token: 'string', foreground: 'a6e3a1' },
          { token: 'number', foreground: 'fab387' },
          { token: 'type', foreground: 'f9e2af' },
        ],
        colors: {
          'editor.background': '#1e1e2e',
          'editor.foreground': '#cdd6f4',
          // The gutter is the design's: every line number in Mocha's Overlay 0
          // (3.4:1 on the ground), and the line the caret is on no different from
          // the rest — the mauve active number and the highlight band are Monaco's
          // own, and the design draws neither.
          'editorLineNumber.foreground': '#6c7086',
          'editorLineNumber.activeForeground': '#6c7086',
          'editorCursor.foreground': '#cba6f7',
          'editor.selectionBackground': '#45475a',
          'editor.inactiveSelectionBackground': '#313244',
          'editorIndentGuide.background1': '#313244',
          'editorIndentGuide.activeBackground1': '#585b70',
          'editorWidget.background': '#181825',
          'editorWidget.border': '#45475a',
          'editorHoverWidget.background': '#181825',
          'editorHoverWidget.border': '#45475a',
          'editorSuggestWidget.background': '#181825',
          'editorSuggestWidget.border': '#45475a',
          'editorSuggestWidget.selectedBackground': '#45475a',
          'focusBorder': '#cba6f7',
          'button.background': '#cba6f7',
          'button.foreground': '#181825',
          'input.background': '#11111b',
          'input.border': '#45475a',
        },
      });
      monacoReady = monaco;
    } catch {
      // Joins only start once the page loads (the join gate holds earlier
      // submits), so a stack that never arrives is a failed load, not an
      // early one.
      throw new Error('The editor code failed to load. Reload the page and retry.');
    }
  }
  return monacoReady;
}

const joinPane = document.getElementById('join') as HTMLElement;
const startHeading = document.getElementById('start-heading') as HTMLElement;
const joinHeading = document.getElementById('join-heading') as HTMLElement;
const previewPane = document.getElementById('preview') as HTMLElement;
const veilPane = document.getElementById('veil') as HTMLElement;
const joinForm = document.getElementById('join-form') as HTMLFormElement;
const invitePath = document.getElementById('invite-path') as HTMLDetailsElement;
const inviteReveal = document.getElementById('invite-reveal') as HTMLElement;
const inviteWrap = document.getElementById('invite-wrap') as HTMLElement;
const inviteInput = document.getElementById('invite') as HTMLInputElement;
const nameInput = document.getElementById('name') as HTMLInputElement;
const joinButton = document.getElementById('join-button') as HTMLButtonElement;
const joinMessage = document.getElementById('join-message') as HTMLElement;
const joinError = document.getElementById('join-error') as HTMLElement;
const nameError = document.getElementById('name-error') as HTMLElement;
/** The name field and the line its own refusal is written in, as the one thing `join.ts` reads. */
const nameField = { field: nameInput, error: nameError };
const hostError = document.getElementById('host-error') as HTMLElement;
const sessionBar = document.getElementById('session') as HTMLElement;
const sessionIdentity = document.getElementById('session-identity') as HTMLElement;
const shareInput = document.getElementById('share') as HTMLInputElement;
const shareGroup = document.getElementById('share-group') as HTMLElement;
const health = document.getElementById('health') as HTMLElement;
const healthLabel = document.getElementById('health-label') as HTMLElement;
const leaveButton = document.getElementById('leave') as HTMLButtonElement;
const leaveConfirm = document.getElementById('leave-confirm') as HTMLElement;
const leaveQuestion = document.getElementById('leave-question') as HTMLElement;
const leaveCancel = document.getElementById('leave-cancel') as HTMLButtonElement;
const leaveAnyway = document.getElementById('leave-anyway') as HTMLButtonElement;
const hostWrap = document.getElementById('host-wrap') as HTMLElement;
const hostButton = document.getElementById('host-button') as HTMLButtonElement;
const hostQuiet = document.getElementById('host-quiet') as HTMLButtonElement;
const hostNote = document.getElementById('host-note') as HTMLElement;
const workspacePane = document.getElementById('workspace') as HTMLElement;
const editorHost = document.getElementById('editor') as HTMLElement;
const editorEmpty = document.getElementById('editor-empty') as HTMLElement;
const faceStrip = document.getElementById('faces') as HTMLElement;
const treePane = document.getElementById('tree') as HTMLElement;
const treeActions = document.getElementById('tree-actions') as HTMLElement;
const newFileButton = document.getElementById('new-file') as HTMLButtonElement;
const newFolderButton = document.getElementById('new-folder') as HTMLButtonElement;
const appPane = document.getElementById('app') as HTMLElement;
const noticesPane = document.getElementById('notices') as HTMLElement;
const sidePane = document.getElementById('side') as HTMLElement;
const sideResizer = document.getElementById('side-resizer') as HTMLElement;
const sideRail = document.getElementById('side-rail') as HTMLButtonElement;
const fileStrip = document.getElementById('file-strip') as HTMLElement;
const fileStripPath = document.getElementById('file-strip-path') as HTMLElement;
/** The one polite region for the changes that no longer have a visible sentence of their own. */
const live = document.getElementById('live') as HTMLElement;

/**
 * The chrome's lifecycle card: the host-leave warning while the grace runs, counting its window
 * down with the bar that drains with it. Every other transient sentence either has a home of its
 * own or is dropped (see `onNotice`).
 */
const sessionCard = wireSessionCard(document.getElementById('session-card') as HTMLElement);
/** The files this window saved, as the design's toasts in the same column. */
const toasts = wireDownloadToasts(
  document.getElementById('toasts') as HTMLElement,
  document.getElementById('toasts-more') as HTMLElement,
);
/** Failures of an action the guest took: shown, then gone on their own. */
const failureAlert = wireFailureAlert(document.getElementById('alert') as HTMLElement);
/**
 * What a fingertip touched: the words a `title` would have shown a pointer, and
 * the reason a disabled action would have given on hover. It stands briefly and
 * takes itself down, the way a failure does.
 */
const peek = wireTapPeek(document.getElementById('peek') as HTMLElement, { standMs: 4000 });

/**
 * The page's own session, declared here because the panel's own state is set at load — the pane
 * with no document in it is redrawn from that state, and the pane is a read of the session.
 */
let binding: MonacoBinding | undefined;
/**
 * The editor widget the binding drew into, dropped with the session. Declared here with `binding`
 * for the same reason: `showPanel` lays the editor out when the panel closes, which is the state
 * the page loads in on a phone, and a top-level `let` written below that call is in its temporal
 * dead zone — unbundled, the load would throw `Cannot access 'editorApi' before initialization`.
 */
let editorApi: monacoTypes.editor.IStandaloneCodeEditor | undefined;

/**
 * Where the notices column starts. It floats over the workspace rather than being laid out with
 * it, so its top is measured from what it has to clear: the bar, whose height the faces change,
 * and — on a phone, where the file strip runs the whole width — the strip below it. Measured
 * rather than assumed, because a phone whose panel is open draws no strip at all.
 */
function placeNotices(): void {
  const strip = phoneLayout.matches ? fileStrip.offsetHeight : 0;
  noticesPane.style.top = `${sessionBar.offsetHeight + strip + 10}px`;
}

/**
 * The panel is a disclosure on a phone and a resizable column on anything else.
 * Rotating out of the phone shape opens it rather than leaving the tree with no
 * way to be reached: the disclosure it was behind is gone at that width.
 *
 * On a phone the file strip is the whole of the disclosure — its own name, its own state and its
 * own press (`applyStripRole`) — so nothing here draws a second control for the same panel: the
 * `☰` that stood beside the strip was never on screen (the shell's base rule hid it and the
 * `[hidden]` attribute kept the phone query's `display: flex` from landing), and a button inside
 * the strip's `role="button"` would be a control within a control.
 */
function showPanel(open: boolean): void {
  sidePane.hidden = !open;
  // On a phone the editor is out of the flow while the panel is open (the shell's own rule), and
  // Monaco laid itself out against a box of nothing: closing the panel gives it a size again.
  if (!open) {
    editorApi?.layout();
  }
  // On a phone the strip is the disclosure, so it is the element that carries the state; on a
  // pointer device it is a line of text and has no state to carry.
  if (phoneLayout.matches) {
    fileStrip.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  // The empty pane's own way into the panel is that state read back: the pane offers the panel only
  // where the panel is shut, and an act that opens what is already open does nothing visible.
  syncEmptyEditor();
  // The workspace is a different height, and on a phone the strip the column clears may be gone.
  placeNotices();
}

phoneLayout.addEventListener('change', () => {
  showPanel(!phoneLayout.matches);
  // The cluster's own cap is a phone's, and the query that decided it has just changed.
  drawRoom(binding?.participants() ?? []);
});
// The panel competes with the editor on a phone (a 42 % cut of a 844 px screen)
// and starts shut there; every other device has the room for both.
showPanel(!phoneLayout.matches);

/**
 * On a phone the whole strip is the panel's disclosure: with the panel shut — its state after every
 * open — nothing else on screen says which file is in the editor, and the panel is the only place
 * the tree can be reached from. A press that landed on a control inside the strip is not the
 * disclosure's.
 */
fileStrip.addEventListener('click', (event) => {
  if (!phoneLayout.matches) {
    return;
  }
  if ((event.target as HTMLElement).closest('button') !== null) {
    return;
  }
  showPanel(sidePane.hidden);
});
fileStrip.addEventListener('keydown', (event) => {
  // The strip is the disclosure only where it *is* the target: a key that bubbled up from a control
  // inside it belongs to that control, and swallowing it here would make that control unpressable
  // by keyboard.
  if (
    !phoneLayout.matches ||
    event.target !== fileStrip ||
    (event.key !== 'Enter' && event.key !== ' ')
  ) {
    return;
  }
  event.preventDefault();
  showPanel(sidePane.hidden);
});

/** Shuts the panel after a navigation, so the file that opened gets the screen. */
function collapsePanel(): void {
  if (phoneLayout.matches) {
    showPanel(false);
  }
}

/**
 * The card's live controls, in one bundle: what its intent is painted through (`showCardIntent`,
 * the swap below) and what its `initJoinCard` reads. One object, so the wiring and every later
 * repaint cannot disagree about which elements the card is.
 */
function cardElements(): JoinCardElements {
  return {
    pane: joinPane,
    startHeading,
    joinHeading,
    invitePath,
    inviteReveal,
    inviteWrap,
    inviteInput,
    nameInput,
  };
}

const params = pageQueryParams(window.location.search);
// Which of the card's two intents this page has: a room and its token in the address bar
// are the invite the host sent, and the card asks the name alone and joins it. With neither,
// this page is where a room starts, and the invite path is a disclosure the person opens
// only if they turn out to have a link. A room the address bar named that is now gone
// leaves the card in the join shape anyway (`leaveSession`): a fresh link is the way in.
let cardIntent: CardIntent = cardIntentOf(params);
/** The `/meta` read the card's host action was offered on, so the swap repaints from it rather than
 * asking the page's own origin a second time (`showHosting`). */
let lastServerRead: ServerRead | undefined;
// The address bar's invite is the way in until the room it names is over.
let linkIsTheInvite = cardIntent === 'join';
// The card shell is inline HTML, so it paints before this bundle arrives: wire only the intent
// the address bar calls for, prefill only an untouched name field, and land focus past first
// paint without stealing a field the guest already typed into. The name is the question both
// intents ask — each action needs it — so focus belongs there either way.
initJoinCard(
  cardElements(),
  params,
  window.localStorage,
);
reportIncompleteInvite();
settleFocusWhenReady(nameInput);
/** This browser's directory picker, if it has one: what a browser host needs and what a
 * Firefox or Safari page does not have. Read once, because it cannot change under a load. */
const folderPicker = folderPickerOf(window);
// A reload of a host tab is a room that ended. The mark is the tab's own memory, taken here
// once so the card says what the reload cost instead of looking like the page before it.
const hostingNotice = takeHostingNotice(window.sessionStorage);
if (hostingNotice !== undefined) {
  joinMessage.textContent = hostingNotice;
  joinMessage.hidden = false;
}
void offerHosting();

/**
 * A damaged invite is reported when the page loads, not after a name is typed and Join pressed.
 *
 * A chat app that truncates a link cuts the fragment first: it is the longest part of the link and
 * it sits after the `#`, so the room and the token arrive whole while `§5.1`'s two keys do not. The
 * guest, who did nothing wrong, used to meet the engine's own sentence about a 32-byte key only
 * after filling the card in. The fragment is checked here against the link the join would dial, the
 * card says what a person can act on — the link is incomplete and the host has to send it again —
 * and the precise reason stays in the console (and on the card under `?debug=1`).
 */
function reportIncompleteInvite(): void {
  if (cardIntent !== 'join') {
    return;
  }
  let target: JoinTarget;
  try {
    target = resolveJoin(addressBarInvite(linkIsTheInvite, params), '', window.location.href);
  } catch {
    // A page whose own address names no server: the join attempt has its own words for that.
    return;
  }
  const reason = inviteShortfall(target);
  if (reason === undefined) {
    return;
  }
  console.error(`[selvage] invite incomplete (${reason})`);
  showJoinFailure(
    { invitePath, joinError },
    params.get('debug') === '1' ? `${INCOMPLETE_INVITE_SENTENCE} (${reason})` : INCOMPLETE_INVITE_SENTENCE,
  );
}

/**
 * Offers the card its focus without ever forcing layout before the page loads
 * or yanking a field the guest already typed into (Firefox logs the former as
 * `Layout was forced before the page was fully loaded`).
 */
function settleFocusWhenReady(field: HTMLInputElement): void {
  if (document.readyState === 'complete') {
    settleFocus(field);
  } else {
    window.addEventListener('load', () => settleFocus(field), { once: true });
  }
}

function settleFocus(field: HTMLInputElement): void {
  const active = document.activeElement;
  if (active === field || active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    return;
  }
  field.focus();
}

let engine: RoomEngine | undefined;
/** The editor's opener guard, one registration per join, dropped with the session. */
let linkGuard: { dispose(): void } | undefined;
/** What the editor was created with on this device, to return to under a pointer. */
let desktopEditorOptions: monacoTypes.editor.IEditorOptions | undefined;
let opening: string | undefined;
/**
 * The full guest link. It reaches the clipboard whole and nothing else: not the readout's value at
 * rest, not a `title`, not any attribute. What the bar carries is `SHARE_MASK` — a fixed run of
 * bullets that says "there is a key here, take it with the control" and shows none of it.
 */
let fullShareLink = '';
/** The server the last join attempt reached for, for the unreachable-server copy. */
let lastBase = '';
/** The joined display name, for this window's own face. */
let selfName = '';
/** The tree's guest-pinned directories, kept across re-renders. */
const openDirs = new Set<string>();
/** The path the tree last highlighted, so landings re-render it. */
let renderedPath: string | undefined;
/** The room's listing as a tree, built on the first notice after a join. */
let tree: GrantTreeView | undefined;
/** Whether a host start is running: the picker is a single flight, whatever the button says. */
let hosting = false;
/** The folder this tab's room is drawn from, when this tab is the host: what a create writes to. */
let hostFolder: FolderWorkingCopy | undefined;
/**
 * Publishes the room's listing after this host's own folder changed (`§7.1`). The source the mint
 * sealed the room from is replaced with the walk's own answer before the room is told, so a state
 * sealed later cannot carry a listing the folder no longer has.
 */
let republishGrant: ((paths: readonly string[]) => Promise<void>) | undefined;
/**
 * The directories this session made that no listing carries.
 *
 * A room's listing is files, so an empty directory is in nobody's — a host that made `docs/` and
 * saw it vanish would have a control that lied about what it did, and the next create into it would
 * be refused as a path through something that is not there. They are drawn as this window's own rows
 * (`tree-view.ts`) and forgotten with the session.
 */
const madeFolders = new Set<string>();
/** The directory the panel's create verbs last used, for the session. */
let lastCreateParent: string | undefined;
/** Whether the host's absence is being counted down. */
let hostAway = false;
/**
 * The host's display name, remembered while its seat is in the room.
 *
 * A room's roster stops carrying the host the moment its socket detaches, and both the bar's
 * identity line and the session card still have to name it: `In <host>'s session` is as true while
 * the grace runs as it was a second before. Nothing clears it but leaving the room.
 */
let sessionHostName: string | undefined;
/** Whether the cost of fetching has been said this session: it is said once. */
let saidFetchCosts = false;

/**
 * Creates a file or a directory in the folder this tab picked, and puts it in the room.
 *
 * The order is the one that makes each step true. The create is the folder's own, and its refusals
 * are the folder's own sentences. The re-walk is what a listing is, so the new path is published
 * because the folder holds it and not because this function names it — the same walk a watcher
 * would have triggered had the create been made by something else on the disk. And a created file
 * is opened, which is what makes its text reach the room at all: content arrives when a file is
 * opened, so a listed path nobody opened reads empty to every guest.
 *
 * What the row is answered with is the phase, not a sentence: a refusal keeps the field open with
 * the folder's own words in it, and a create that landed but was not finished closes the row and
 * marks the path instead, because the entry *is* in the folder and a row that said otherwise would
 * be telling a person their file is missing while it sits there.
 */
async function createEntry(path: string, entry: NewEntryKind): Promise<CreateResult> {
  const folder = hostFolder;
  if (folder === undefined || binding === undefined) {
    return { kind: 'refused', sentence: 'This window is not serving a folder any more.' };
  }
  let outcome: CreateOutcome;
  try {
    outcome = await createInFolder({ folder, publish: republishGrant, open: openPath }, path, entry);
  } catch (error: unknown) {
    // What reaches here is the folder layer's own unnamed failure, thrown before the entry was made:
    // the steps after it belong to the act and report themselves (`CreateOutcome`), so a file that
    // did land is never reported as one that did not.
    return { kind: 'refused', sentence: `${path} was not created: ${describe(error)}` };
  }
  // A directory is not in a listing (a room's listing is files), so the page remembers the ones
  // this session made and draws them as its own rows: a folder that vanished the moment it was
  // made would be a control that lied about what it did.
  if (entry === 'directory') {
    madeFolders.add(path);
  }
  if (outcome.kind === 'refused') {
    madeFolders.delete(path);
    return { kind: 'refused', sentence: outcome.sentence };
  }
  if (outcome.kind === 'incomplete') {
    // The entry was made and its text did not reach the room. The row carries no mark for that any
    // more, so the sentence the folder gave stands on the page's transient line.
    failureAlert.show(outcome.sentence);
    syncGrant();
    return { kind: 'incomplete', path, entry, sentence: outcome.sentence };
  }
  syncGrant();
  return { kind: 'made', path, entry };
}

/**
 * The two create verbs, offered only to a window that holds a folder: a guest has nothing to create
 * in, and the sentence the empty tree carries is its own answer. They stand in a full-width bar at
 * the panel's foot, always visible, and they create where the person is looking — the directory of
 * the open file, or the folder they last created in, and the root when neither says otherwise.
 */
newFileButton.append(iconSpan('file-add'), labelSpan('New file'));
newFolderButton.append(iconSpan('folder-add'), labelSpan('New folder'));
newFileButton.addEventListener('click', () => beginCreate('file'));
newFolderButton.addEventListener('click', () => beginCreate('directory'));

/** The directory the panel's verbs default to: the open file's, or the last one used, or the root. */
function createTarget(): string {
  const last = lastCreateParent;
  const current = binding?.currentPath();
  if (current !== undefined) {
    const slash = current.lastIndexOf('/');
    return slash === -1 ? '' : current.slice(0, slash);
  }
  return last ?? '';
}

function beginCreate(kind: NewEntryKind): void {
  const parent = createTarget();
  lastCreateParent = parent;
  tree?.beginCreate(kind, parent);
}

// Enter runs the action the field belongs to: the name is the card's own field and runs what
// the card leads with, while the paste box is the invite path and always joins.
joinForm.addEventListener('submit', (event) => {
  event.preventDefault();
  attemptJoin();
});
nameInput.addEventListener('keydown', (event) => {
  joinOnEnter(event, runPrimary);
});
// The refusal is about the value that was submitted, so it goes the moment the value changes:
// a sentence still standing over a name the person has since typed is a line about nothing.
nameInput.addEventListener('input', () => {
  clearNameFailure(nameField);
});
inviteInput.addEventListener('keydown', (event) => {
  joinOnEnter(event, attemptJoin);
});

/**
 * The card's own action, for Enter in the name field: the button the intent leads with.
 *
 * Starting a room runs only where the card offers it. Where it does not, the invite path is the
 * only action the page has left, so Enter takes it and the join path answers with what it needs
 * — the paste box is opened under it and the line says what the join is missing. Silence is the
 * one answer the card does not give to a field it focused itself, and the reason hosting is not
 * offered stands beside it in the card's own words (`#host-note`).
 */
function runPrimary(): void {
  const action = primaryActionOf(cardIntent, !hostButton.hidden);
  if (action === 'host') {
    void attemptHost();
  } else {
    attemptJoin();
  }
}

hostButton.addEventListener('click', () => {
  void attemptHost();
});

/**
 * The single-flight gate for joins (S2, 2026-09-18): a submit that lands
 * before the page finishes loading queues until `load` instead of failing,
 * and a second submit while queued or running never starts a second join.
 * Declared before the replay below uses it: the replay runs during this
 * module's own evaluation, so a later declaration would still be unborn.
 */
const joinGate = createJoinGate(
  () => document.readyState === 'complete',
  (onLoad) => window.addEventListener('load', onLoad, { once: true }),
);

/** A join held while the page loads: the submit-time name, room and token. */
interface HeldJoin {
  displayName: string;
  figured: JoinTarget;
}

// A submit that landed before this bundle armed the card (the inline guard
// held it) still joins, once.
window.__selvageJoinArmed = true;
// The shell's own line goes with the load it described: the card is this bundle's now, and what
// belongs there is what the bundle knows — the notice a reload left, or nothing. A submit held
// before the shell's script ran is settled by that script, which always runs before this one.
if (window.__selvageWaiting === true) {
  window.__selvageWaiting = false;
  joinMessage.textContent = hostingNotice ?? '';
  joinMessage.hidden = hostingNotice === undefined;
}
if (window.__selvagePendingJoin === true) {
  window.__selvagePendingJoin = false;
  attemptJoin();
}

function attemptJoin(): void {
  // One failure stands on the card at a time: the line the other action left goes with this
  // attempt, and so does this path's own — a refusal about an invite the person has since
  // replaced is a line about nothing.
  hostError.textContent = '';
  joinError.textContent = '';
  clearNameFailure(nameField);
  // Read at submit time: a queued join holds these until load, so anything
  // typed meanwhile must not rewrite the attempt.
  const typedName = nameInput.value;
  const pastedInvite = linkIsTheInvite ? '' : inviteInput.value;
  let displayName: string;
  try {
    displayName = validateDisplayName(typedName);
  } catch (error: unknown) {
    // The name is asked for above both actions, so its refusal stands at the field rather than
    // under whichever button was pressed: the button is one screen away, and it is not the thing
    // that is wrong.
    showNameFailure(nameField, describe(error));
    // Nothing left the page, but a held early submit disabled the button before this bundle
    // arrived: a refused pre-flight (a blank name) hands the card back the way a refused join
    // does, or the guest's only way on is Enter.
    joinButton.disabled = false;
    joinButton.textContent = 'Join';
    return;
  }
  let figured: JoinTarget;
  try {
    figured = resolveJoin(
      addressBarInvite(linkIsTheInvite, params),
      pastedInvite,
      window.location.href,
    );
  } catch (error: unknown) {
    const base = fallbackBase();
    console.error(`[selvage] join failed (${joinFailureDetail(error, base)})`);
    showJoinFailure(
      { invitePath, joinError },
      describeJoinErrorForDisplay(error, base, params.get('debug') === '1'),
    );
    joinButton.disabled = false;
    joinButton.textContent = 'Join';
    return;
  }
  const held: HeldJoin = { displayName, figured };
  // A pasted link can be as damaged as the one in the address bar: the same check, the same
  // sentence, and the precise reason in the console rather than on the card.
  const shortfall = inviteShortfall(held.figured);
  if (shortfall !== undefined) {
    console.error(`[selvage] invite incomplete (${shortfall})`);
    showJoinFailure(
      { invitePath, joinError },
      params.get('debug') === '1' ? `${INCOMPLETE_INVITE_SENTENCE} (${shortfall})` : INCOMPLETE_INVITE_SENTENCE,
    );
    joinButton.disabled = false;
    joinButton.textContent = 'Join';
    return;
  }
  const outcome = joinGate.request(() => {
    void runJoin(held);
  });
  if (outcome === 'duplicate') {
    return;
  }
  // Started or queued: the card answers now — `Joining…` throughout the
  // queue, not just once the editor stack arrives — and stays answered until
  // the join lands or fails back.
  joinButton.disabled = true;
  joinButton.textContent = 'Joining…';
}

async function runJoin(held: HeldJoin): Promise<void> {
  try {
    await join(held);
  } catch (error: unknown) {
    const base = lastBase === '' ? fallbackBase() : lastBase;
    // The server and the raw cause stay in the console; the card keeps the
    // plain copy unless the owner asked for the diagnostic with `?debug=1`.
    console.error(`[selvage] join failed (${joinFailureDetail(error, base)})`);
    showJoinFailure(
      { invitePath, joinError },
      describeJoinErrorForDisplay(error, base, params.get('debug') === '1'),
    );
    // A refused join registered the guard before it gave up, so the retry
    // starts from a clean opener service rather than a second registration.
    linkGuard?.dispose();
    linkGuard = undefined;
    // A held early submit disables the button for feedback (see the inline
    // guard): a refused join hands the card back, so the guest can retry.
    joinGate.release();
    joinButton.disabled = false;
    joinButton.textContent = 'Join';
  }
}

/** What the host button says, before and after an attempt.
 *
 * The trailing ellipsis is the platform's own convention for a control that opens a system dialog
 * (the folder picker) rather than a trailing thought, and the shell carries the same words for the
 * frame before the bundle lands.
 */
const HOST_BUTTON_LABEL = 'Share a folder…';

/**
 * The editor stack and the shared-text opener guard, both of which a join and a host need
 * before a socket is opened: the guard must be registered before the first buffer renders, and
 * the stack is what builds a document's model.
 */
async function prepareEditor(): Promise<typeof monacoApi> {
  // The editor stack loads on join, never before: the card is interactive while the megabytes
  // it needs are still arriving.
  const monaco = await ensureMonaco();
  // Shared text may name links the page must never follow: a `file:` target would drive the
  // page itself at `file:///...`. The guard swallows everything but web and mail links before
  // the default opener runs.
  const services = await import('./monaco.ts');
  // The registration lives on the editor's opener service until it is disposed, so it is held
  // here and dropped with the session — never left behind for the next join to overwrite.
  linkGuard = registerLinkGuard(
    services.StandaloneServices.get<GuardableOpenerService>(services.IOpenerService),
  );
  return monaco;
}

/** What a seated session owns, whichever role holds it. */
interface Seat {
  monaco: typeof monacoApi;
  engine: RoomEngine;
  session: SessionInfo;
  displayName: string;
  /** The link the session bar carries and the clipboard copies. */
  shareLink: string;
  /** The folder this window was handed, when it is the host: absent for a guest. */
  folder?: FolderWorkingCopy;
  /**
   * Publishes a listing this host's folder changed under, replacing the source the room's state is
   * sealed from (`§7.1`). A guest has none.
   */
  republish?: (paths: readonly string[]) => Promise<void>;
}

/**
 * Everything a session has once the handshake is done and before anyone types: the share bar,
 * the editor and its binding, the tree, the faces in the bar, the first document and the focus.
 *
 * A join and a host differ in how the socket was opened and in what the bar's link means, and
 * in nothing else, so this is one function with one option that differs.
 */
async function seatSession(seat: Seat): Promise<void> {
  const { monaco, engine: seated, session } = seat;
  // The engine this page holds for the life of the session, and the one every later line reads:
  // the own row's colour and role, the fallback read of a path this window has no model for, a
  // rename, the leave's teardown and the one on `beforeunload`. It is dropped with the session
  // (`leaveSession`), so a page between sessions holds none.
  engine = seated;
  selfName = seat.displayName;
  // The folder, when this window has one, is what a create writes to; a guest is offered no control
  // and reads the empty tree's own sentence instead.
  hostFolder = seat.folder;
  // The way out says what it costs this window: a host's press ends the room for everyone in it,
  // and the role is only known once the seat is taken.
  leaveControl.showRole(seat.folder !== undefined);
  republishGrant = seat.republish;
  // The two create verbs are the window's that holds a folder, and no one else's.
  treeActions.hidden = seat.folder === undefined;
  madeFolders.clear();
  fullShareLink = seat.shareLink;
  // The readout carries the mask and nothing of the link, at a fixed size so the pill's width says
  // nothing about the link's length either. The clipboard is the one place the whole link goes.
  shareInput.value = SHARE_MASK;
  fitReadout(shareInput, SHARE_MASK);
  joinMessage.hidden = true;
  joinPane.hidden = true;
  previewPane.hidden = true;
  veilPane.hidden = true;
  sessionBar.hidden = false;
  workspacePane.hidden = false;

  const editor = monaco.editor.create(editorHost, {
    automaticLayout: true,
    glyphMargin: true,
    theme: 'selvage-mocha',
  });
  // Read the desktop options off the editor it just made rather than restating them: Monaco's
  // font size default is platform-dependent, and a pointer that arrives mid-session has to be
  // able to put all three back (see `applyTouchMode`).
  const scrollbar = editor.getOption(monaco.editor.EditorOption.scrollbar);
  desktopEditorOptions = {
    ...editorOptionsFor(false),
    wordWrap: editor.getOption(monaco.editor.EditorOption.wordWrap),
    fontSize: editor.getOption(monaco.editor.EditorOption.fontSize),
    scrollbar: {
      verticalScrollbarSize: scrollbar.verticalScrollbarSize,
      horizontalScrollbarSize: scrollbar.horizontalScrollbarSize,
    },
  };
  if (touchOnly) {
    editor.updateOptions(editorOptionsFor(true));
  }
  // Held so the whole session can be dropped, editor and all, when the room ends.
  editorApi = editor;
  binding = new MonacoBinding({
    engine: seated,
    editor,
    folder: seat.folder,
    onNotice: (notice: BindingNotice) => onNotice(notice),
    createModel: (text: string, language: string) => monaco.editor.createModel(text, language),
  });
  // The tree reads the binding and the page decides what a row's click means: it is a
  // deliberate navigation, the same class as typing or going to someone, so the follow
  // ends instead of landing back over the file just opened.
  tree = new GrantTreeView({
    pane: treePane,
    source: binding,
    pinned: openDirs,
    touch: () => touchOnly,
    canCreate: () => hostFolder !== undefined,
    localFolders: () => madeFolders,
    hostAway: () => hostAway,
    create: (path, entry) => createEntry(path, entry),
    download: (path, feedback) => startDownload(path, feedback),
    open: (path) => {
      binding?.stopFollowing();
      void openPath(path);
    },
  });
  // The bar's own line about *which* session this is: the folder exposed, or whose room.
  setSessionIdentity();
  drawRoom(binding.participants());
  syncGrant();
  await openFirst(session);
  // The first file opens focused on a desktop, where typing starts at once. A
  // phone would read that as the guest asking for the keyboard, which then
  // stands over the room they have not seen yet: focus follows the first tap.
  if (!touchOnly) {
    editor.focus();
  }
}

async function join(held: HeldJoin): Promise<void> {
  const { displayName, figured } = held;
  // Scheme-match: the socket and the `/meta` read derived from this base
  // both speak TLS on an https page — never a ws:// or http:// subrequest.
  const base = schemeMatchBase(figured.base, pageProtocol);
  // §5.1: the fragment is the room key and the host key, and it travels on the connection URL
  // the engine dials. A link without both keys is refused where it is read, by the engine's own
  // sentence (`peer.ts`), which is the local refusal `§5.1` states.
  const address = sessionUrl(base, figured.room, figured.token);
  const invite = address + figured.fragment;
  lastBase = base;
  joinError.textContent = '';
  // A stack that never arrives throws before the button disables, so the card keeps its copy
  // and the guest can retry.
  const monaco = await prepareEditor();
  // The default `/meta` check runs: same-origin it reads the server, and where
  // the page is cross-origin the read fails like any unreachable endpoint —
  // advisory, never a refusal — while the handshake negotiates the truth.
  // The button stays `Joining…` throughout: attemptJoin owns it, and the gate
  // makes a second submit while this runs a duplicate, never a second join.
  const engine = await joinRoom(invite, displayName);
  await seatSession({
    monaco,
    engine,
    session: engine.session(),
    displayName,
    shareLink: buildShareLink(base, figured.room, figured.token, figured.fragment),
  });
  // A typed room/token join lands in the address bar, so a reload rejoins
  // from it instead of losing what was typed. Same-origin only; elsewhere
  // the link stays in the session bar.
  try {
    persistJoinUrl(window.history, fullShareLink);
  } catch {
    // Leave the address bar alone.
  }
  // The joined name is the prefill next time: localStorage only, never the wire.
  saveDisplayName(window.localStorage, displayName);
  // A name already in the room is allowed in, and the face carries the short
  // id that tells the two apart, so no sentence is needed here.
}

/**
 * Starts a room in this tab, with the folder the person just picked as the working copy.
 *
 * The order matters twice. The listing goes out before anything is seated, so the first guest
 * to arrive finds the room's own listing rather than an empty room that fills in a moment
 * later. And the invite link does *not* go into the address bar: the page persists the link for
 * a guest so a reload rejoins, and for a host that would reload into its own room as a guest
 * with no folder and nothing to serve, while the dead socket's grace ran out underneath it. The
 * link lives in the session bar alone, and the mark in `sessionStorage` is what tells the next
 * load what the reload cost (`host.ts`).
 */
async function host(folder: FolderWorkingCopy, displayName: string): Promise<void> {
  const base = fallbackBase();
  if (base === '') {
    // A page whose own address names no server at all. The card offers no start action there
    // (`hostAvailability`), so this is the guard for a call that reached the folder picker anyway:
    // a room minted against no server would be a room nobody could be seated on.
    throw new Error('This page names no server of its own, so there is nothing to start a room on.');
  }
  lastBase = base;
  const monaco = await prepareEditor();
  // A host's listing is what the room's state is sealed from (`§7.1`), so the walk has to come
  // before the mint: a host that minted first would put an empty room in front of its first guest.
  const listing = listingSource(await folder.list());
  const engine = await hostRoom(base, displayName, listing);
  const session = engine.session();
  await seatSession({
    monaco,
    engine,
    session,
    displayName,
    shareLink: buildShareLink(
      base,
      session.roomId,
      session.token ?? '',
      fragmentOf(engine.inviteUrl() ?? ''),
    ),
    folder,
    republish: async (paths) => {
      listing.replace(paths);
      await engine.grant(paths);
    },
  });
  markHosting(window.sessionStorage, session.roomId);
  saveDisplayName(window.localStorage, displayName);
}

/**
 * The host action: the name, then the folder, then the room.
 *
 * The picker is asked before anything that could await, because it needs the click's own
 * transient user activation: a call made from a timer, a load handler or a promise already in
 * flight is refused rather than prompted.
 */
async function attemptHost(): Promise<void> {
  if (hosting) {
    return;
  }
  // One failure stands on the card at a time: the line the other action left goes with this
  // attempt, and a refusal lands where the thing that is wrong stands — the name at the field,
  // the folder under the button that asked for it.
  hostError.textContent = '';
  joinError.textContent = '';
  clearNameFailure(nameField);
  let displayName: string;
  try {
    displayName = validateDisplayName(nameInput.value);
  } catch (error) {
    // The name is asked for above the button, so the refusal about it stands at the field: under
    // the button was a line the reader had to find, and it marked nothing.
    showNameFailure(nameField, describe(error));
    return;
  }
  hosting = true;
  hostButton.disabled = true;
  hostButton.textContent = 'Opening…';
  try {
    const picked = await pickFolder(folderPicker);
    if (picked.kind === 'cancelled') {
      // A dismissed prompt is not a failure: the person changed their mind, and the card is simply
      // as it was. The red `No folder was chosen…` this used to write made a decision look like a
      // mistake, and it is the one refusal the person already knows the answer to.
      return;
    }
    if (picked.kind === 'refused') {
      hostError.textContent = picked.sentence;
      return;
    }
    await host(picked.folder, displayName);
  } catch (error) {
    // The same plain copy the join path shows (`transport.ts`): a socket that would not come up,
    // or a handshake that refused, is one situation whichever action opened it — and the
    // engine's own wording for it ("the WebSocket reported an error") names a mechanism rather
    // than a next step. The card's own refusals — the name and the folder — pass through it
    // untouched, because they are already sentences written for this card.
    const base = lastBase === '' ? fallbackBase() : lastBase;
    console.error(`[selvage] hosting failed (${joinFailureDetail(error, base)})`);
    hostError.textContent = describeJoinErrorForDisplay(error, base, params.get('debug') === '1');
  } finally {
    hosting = false;
    hostButton.disabled = false;
    hostButton.textContent = HOST_BUTTON_LABEL;
  }
}

/**
 * Reveals the host action, or the sentence that stands where it would.
 *
 * Two facts decide it, and both are settled before any control is offered: this browser can hand a
 * page a folder, and this page's own origin is a Selvage server. A page that is not the server's
 * own page — the page-only image in front of other servers, a bare `file://` open, a static dev
 * server — gets the sentence instead, because a room started there would have no server to be
 * seated on and its invite would point at an address the room does not live at.
 *
 * A read that did not answer is not the second of those facts. `/meta` is advisory (§2), a deadline
 * that passed says nothing about the origin, and the offer stands with a note saying what was not
 * read; one more ask, given longer, replaces that note with the truth if the server answers after
 * all. Nothing here can take the offer back once a click is being answered.
 *
 * Both intents are offered it. On a bare page starting a room is the card's own action, and on
 * a page an invite named it is the quiet one under the join: a person holding a link is still a
 * person who might want a room of their own, and the action is no more a promise there than it
 * is here.
 */
async function offerHosting(): Promise<void> {
  const picker = folderPicker !== undefined;
  // The card's `/meta` read, and it is not made where no control could use its answer.
  const base = picker ? pageBase() : undefined;
  if (base === undefined) {
    // A page whose own address names no server at all (a `file://` open) has no origin to ask, and
    // it is not a server's own page either way: no offer, and no sentence about it.
    showHosting(picker, { kind: 'not-a-server' });
    return;
  }
  const read = await readServerMeta(base);
  showHosting(picker, read);
  if (read.kind !== 'no-answer') {
    return;
  }
  // One more ask, with a longer deadline: a server that was cold, a link that stalled or a proxy
  // that hiccupped has not yet said anything about itself, and the card keeps the offer meanwhile
  // rather than writing the server off. Only an answer can change the card.
  const again = await readServerMeta(base, { timeoutMs: META_REREAD_TIMEOUT_MS });
  if (again.kind !== 'no-answer' && !hosting) {
    showHosting(picker, again);
  }
}

/**
 * Puts one read of the page's own origin on the card: the note beside the action, and whether
 * there is an action at all.
 *
 * The two intents say it differently, and that is the whole of the collapse (design §7.1). On the
 * start card the action is the card's own — the button that says what happens next — and on a
 * guest's card hosting is the alternative to the thing the person came for, so it is one quiet
 * line and nothing else: pressing it is what puts the start card in front of them
 * (`swapCardToStart`). A page where hosting is not on offer says why, in one line, wherever the
 * action would have stood — except the page that is not a Selvage server's own, which says nothing
 * and leads with the way in it has (`host.ts`).
 */
function showHosting(picker: boolean, read: ServerRead): void {
  lastServerRead = read;
  const availability = hostAvailability({ picker, read });
  const offered = availability.kind === 'offered' || availability.kind === 'unchecked';
  // A guest asked to join, and a page that cannot host has nothing to say to them: the four-line
  // refusal that stood under Join was about an action this card is not offering, on the card of
  // somebody who never asked for it. The quiet verb goes with it — a press that could only lead to
  // a card with no action on it is worse than no verb — and what is left is the way in.
  if (cardIntent === 'join') {
    hostWrap.hidden = !offered;
    hostQuiet.hidden = !offered;
    hostButton.hidden = true;
    hostNote.textContent = '';
    return;
  }
  hostQuiet.hidden = true;
  // The offered card says nothing: the action is the whole of it. A state that cannot act stands its
  // sentence where the action would have been, and the page that is not a Selvage server's own
  // stands none: the way in it does have is the whole of what it can say.
  hostNote.textContent =
    availability.kind === 'offered' || availability.kind === 'silent' ? '' : availability.note;
  // A state with neither an action nor a sentence takes no room either: the wrap is a hairline and
  // 34 px of space around whatever it holds, and holding nothing it drew an empty rule under Join.
  hostWrap.hidden = !offered && hostNote.textContent === '';
  hostButton.hidden = !offered;
  // A page that cannot start a room leads with the way in it does have. The invite path opens —
  // joining was behind a 11.9 px summary and a four-line refusal led the card — and Join takes the
  // card's own action, because the one thing this card can do is the one thing it should offer.
  joinPane.classList.toggle('no-host', !offered);
  if (!offered) {
    invitePath.open = true;
  }
}

/**
 * The guest card's one quiet line: the start card, in front of the person.
 *
 * The card the address bar made is a guest's, and this is the other intent it can be — the name is
 * the same field either way, so nothing typed is lost. The invite path is shut as it goes: the join
 * intent opened it itself, the person never did, and the way back is the disclosure it leaves behind
 * (`Have an invite link?`) with the link still in the address bar.
 */
function swapCardToStart(): void {
  if (cardIntent === 'start') {
    return;
  }
  cardIntent = 'start';
  showCardIntent(cardElements(), 'start');
  invitePath.open = false;
  if (lastServerRead !== undefined) {
    showHosting(folderPicker !== undefined, lastServerRead);
  }
  // The press hid the control it was made with, so the keyboard goes where the press led: the
  // start action when this page can offer one, and the name — the one thing the card still asks
  // for — when the sentence about this page's own origin stands in its place.
  (hostButton.hidden ? nameInput : hostButton).focus();
}

hostQuiet.addEventListener('click', () => {
  swapCardToStart();
});

/** This page's own origin, read as the session base a room started here would be seated on. */
function pageBase(): SessionBase | undefined {
  return sessionBase(serverBaseOf(window.location.href));
}

/**
 * The server a failure message names before any attempt resolved one: this
 * page's own address read back as the server, which is where the room's link
 * would have pointed. A page that names no server of its own (a `file://`
 * page) yields none, and the diagnostic names none.
 */
function fallbackBase(): string {
  const page = pageBase();
  return page === undefined ? '' : schemeMatchBase(page, pageProtocol);
}

async function openFirst(session: SessionInfo): Promise<void> {
  const first = session.documents.slice().sort()[0];
  if (first !== undefined) {
    await openPath(first);
    return;
  }
  // A room that names no document would leave a phone on a blank editor: the
  // panel is the one place that says the room shares nothing, and a phone
  // starts with it shut. Open it for them; the first file that opens shuts it
  // again (see `collapsePanel`).
  if (phoneLayout.matches) {
    showPanel(true);
  }
}

async function openPath(path: string): Promise<void> {
  if (binding === undefined || opening === path) {
    return;
  }
  opening = path;
  try {
    // The hold taken by the open is what makes the room send the text: opening a
    // listed path fetches it, the desktop guest's behaviour.
    await binding.openDocument(path);
    syncGrant();
    renderedPath = path;
    // The file that just opened is what the guest asked for: on a phone the
    // panel gets out of its way rather than holding 42 % of the screen.
    collapsePanel();
    // A plain open says nothing on screen — the strip above the editor names the file and the tree
    // highlights it. It is announced, because a sentence that was never shown is a sentence a screen
    // reader user never heard either.
    announce(`Open ${path}`);
  } catch (error) {
    failureAlert.show(`Could not open ${path}: ${describe(error)}`);
  } finally {
    if (opening === path) {
      opening = undefined;
    }
  }
}

/**
 * The whole bar is the copy target — click anywhere on it, or focus it and
 * press Enter — and on a copy the bar itself morphs to the confirmation
 * briefly, then reverts.
 */
const shareBox: ShareBox = wireShareBox(shareGroup, () => copyShareLink());

/**
 * The leave control: a guest's press drops the session and brings the card back with a fresh link
 * as the way in; a host's press asks first, because its connection is the room's (`leave.ts`). The
 * question stands in the panel anchored under the control, so the two answers are one glance from
 * the sentence that asks for them.
 *
 * The design's icon is the control at every width, sized to the faces beside it, and the words live
 * in their own span: the span keeps the text in the DOM — a screen reader and a pointer read it —
 * and the stylesheet clips it out of the paint. `showRole` rewrites the span, not the button, so the
 * icon is not the thing it takes away.
 */
const leaveLabel = document.createElement('span');
leaveLabel.className = 'label';
leaveLabel.textContent = leaveButton.textContent ?? '';
leaveButton.replaceChildren(iconSpan('leave'), leaveLabel);
const leaveControl = wireLeave({
  hosting: () => hostFolder !== undefined,
  surface: {
    panel: leaveConfirm,
    question: leaveQuestion,
    button: leaveButton,
    label: leaveLabel,
    cancel: leaveCancel,
    go: leaveAnyway,
  },
  leave: () => leaveSession(LEFT_SESSION_SENTENCE),
});
leaveButton.addEventListener('click', () => {
  leaveControl.press();
});

/**
 * The panel's edge and its width: remembered per browser, draggable, keyed, collapsible and
 * resettable (`sidebar.ts`). Applied at load so the workspace never paints at one width and jumps to
 * another. A phone renders no separator and takes the panel whole, which the shell's own query does.
 */
const sidebar = wireSidebar({
  elements: { side: sidePane, separator: sideResizer, rail: sideRail },
  // A phone's panel is the full-width disclosure the shell queries for, and its `hidden` belongs to
  // `showPanel`: a separator that wrote it would reopen the panel on every resize.
  active: () => !phoneLayout.matches,
  storage: window.localStorage,
  remPx: () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16,
  viewportWidth: () => window.innerWidth,
  relayout: () => editorApi?.layout(),
});
sidebar.apply();

/**
 * The strip's own chevron, drawn on a phone and taken down anywhere else. Declared before the
 * function that reads it: `applyStripRole()` runs at load, and a top-level `let` written below that
 * call is in its temporal dead zone — unbundled, the page throws on the way in.
 */
let stripDisclosure: HTMLElement | undefined;

/**
 * On a phone the whole strip is the panel's disclosure, so it wears the control's own semantics —
 * `role`, focus and `aria-expanded` — only while that is true. On a pointer device the strip is what
 * it looks like: a line of text and a few controls, none of them a disclosure.
 */
function applyStripRole(): void {
  if (!phoneLayout.matches) {
    fileStrip.removeAttribute('role');
    fileStrip.removeAttribute('tabindex');
    fileStrip.removeAttribute('aria-controls');
    fileStrip.removeAttribute('aria-label');
    fileStrip.removeAttribute('aria-expanded');
    stripDisclosure?.remove();
    stripDisclosure = undefined;
    return;
  }
  fileStrip.setAttribute('role', 'button');
  fileStrip.setAttribute('tabindex', '0');
  fileStrip.setAttribute('aria-controls', 'side');
  fileStrip.setAttribute('aria-expanded', sidePane.hidden ? 'false' : 'true');
  // The mark that says this line opens something. It is drawn here rather than in the shell so a
  // pointer device never carries a control it has no use for, and it is a span inside the strip's
  // own `role="button"`, never a button: a control within a control is one a finger cannot reach.
  if (stripDisclosure === undefined) {
    stripDisclosure = iconSpan('chevron');
    stripDisclosure.classList.add('disclosure');
    fileStrip.appendChild(stripDisclosure);
  }
  // The name says the state as well as the act: on this width the strip is also the only thing that
  // names the file in the editor, so `Files, no file open` alone would throw away the fact it is
  // there for.
  const path = binding?.currentPath();
  fileStrip.setAttribute('aria-label', path === undefined ? 'Files, no file open' : `Files, ${path} open`);
}
applyStripRole();
phoneLayout.addEventListener('change', applyStripRole);
// The pane with no document in it offers the panel's own verb only on a device that needs it, so the
// query moving is a redraw of it too.
phoneLayout.addEventListener('change', () => syncEmptyEditor());

async function copyShareLink(): Promise<void> {
  // Every attempt starts from the bar's rest state: a fallback that failed has the whole link in
  // the readout for a person to copy by hand, and the mask is what belongs there once a copy — by
  // either route — has worked. On a narrow bar this is also what puts the readout back behind its
  // label.
  shareGroup.classList.remove('hand-copy');
  showDisplay({ readout: shareInput, shown: SHARE_MASK, fit: (value) => fitReadout(shareInput, value) });
  try {
    if (navigator.clipboard === undefined) {
      throw new Error('no clipboard');
    }
    await navigator.clipboard.writeText(fullShareLink);
  } catch {
    // The fallback copies from the field, so it puts the whole link there for the browser's own
    // copy command and hands the mask back once that worked. Only a copy that failed leaves the
    // link in the field, and that is the one place it is legible by design: there is nothing else
    // left for the person to select. `hand-copy` is what makes it readable there, and what reveals
    // it on a bar narrow enough to hide the readout.
    shareGroup.classList.add('hand-copy');
    shareInput.focus();
    const done = handCopy({
      readout: shareInput,
      full: fullShareLink,
      shown: SHARE_MASK,
      exec: () => document.execCommand('copy'),
      fit: (value) => fitReadout(shareInput, value),
    });
    if (!done) {
      failureAlert.show('Select the link and copy it by hand.');
      return;
    }
    shareGroup.classList.remove('hand-copy');
  }
  // The design's confirmation, and the news for a screen reader: the morph says the copy landed
  // to the eye, and the polite region says it to whoever did not see the pill change.
  shareBox.confirm();
  announce('Invite link copied');
}

/** The room's people, this window's own seat first, which the room's peer list never carries. */
function roomPeople(participants: readonly Participant[]): RoomPerson[] {
  const seated = engine?.session();
  const peers = participants.map((participant) => ({
    peerId: participant.peerId,
    displayName: participant.displayName,
    role: participant.role,
    colour: participant.colour,
    path: participant.path,
    self: false,
  }));
  if (seated === undefined) {
    return peers;
  }
  return [
    {
      peerId: seated.peer.peer_id,
      displayName: selfName,
      role: seated.role,
      colour: peerColour(seated.peer.peer_id),
      // Your own seat says nothing about where it is: the editor in front of the person is that
      // answer, and the room's own path for it is not the only one this window has open.
      path: undefined,
      self: true,
    },
    ...peers,
  ];
}

/**
 * Who is here, as the faces in the bar, and the menu the face that was pressed belongs to.
 *
 * The cluster and the dialog are both reads of the room as it stands, so both are drawn wherever a
 * presence frame lands: a peer who leaves, or who opens a file, changes what their menu says, and a
 * dialog drawn only when its own state changed would keep live verbs for someone gone, or say
 * `not in a file yet` beside a `Go to` that had appeared. The design draws the menu on every render
 * for the same reason.
 *
 * The one draw the dialog gives up is under the own-name field (`renameHoldsTheList`): a presence
 * frame lands every few hundred milliseconds while anybody types, and a field replaced under the
 * caret is a caret taken. The hold is the field's own group and nothing broader — the name typed
 * into it is put back by the draw that follows — so the dialog is never stale while nobody types.
 */
function drawRoom(participants: Participant[]): void {
  renderRoom(faceStrip, roomPeople(participants), {
    followedPeerId: binding?.following()?.peerId,
    openAnchor: menu?.anchor,
    limit: phoneLayout.matches ? PHONE_FACE_LIMIT : FACE_LIMIT,
    onAnchor: (anchor) => void pressAnchor(anchor),
  });
  // The dialog follows the room under it, held only while somebody is in the name field. The
  // control that had focus is carried across the rebuild, so a redraw does not drop the person off
  // the `Go to` they were on.
  if (menu !== undefined && !renameHoldsTheList(renamingField, document.activeElement)) {
    renderMenu(menuFocusSelector());
  }
  // Every draw replaces the button the dialog came from, so the dialog is placed again against
  // the one that stands there now.
  placeOpenMenu();
  // The faces are what makes a phone's bar tall, and the column clears the bar: it is placed here,
  // where the cluster's own size can have changed.
  placeNotices();
}

/**
 * The dialog, and the face it was opened from. One at a time: a press on another face replaces
 * it, and a press on the same one closes it.
 */
type MenuState =
  | { view: 'person'; peerId: string; anchor: string; fromList: boolean }
  | { view: 'everyone'; anchor: string };
let menu: MenuState | undefined;
/** The dialog element, which lives as long as the dialog does. */
let menuElement: HTMLDivElement | undefined;

/** The face a dialog was opened from, as it stands in the cluster now. */
function anchorButton(anchor: string): HTMLElement | undefined {
  for (const button of faceStrip.querySelectorAll<HTMLElement>('[data-anchor]')) {
    if (button.dataset.anchor === anchor) {
      return button;
    }
  }
  return undefined;
}

/**
 * The open dialog's own control that has focus, as a selector the redraw can put it back on: the
 * act that was pressed, or the row of the list, so a room moving under the dialog does not take the
 * person's place in it. Focus in the name field is the hold's, and never reaches here.
 */
function menuFocusSelector(): string | undefined {
  const active = document.activeElement;
  if (active === null || menuElement === undefined || !menuElement.contains(active)) {
    return undefined;
  }
  const act = active.getAttribute('data-act');
  if (act !== null) {
    return `[data-act="${act}"]`;
  }
  const pick = active.getAttribute('data-pick');
  return pick === null ? undefined : `[data-pick="${pick}"]`;
}

/**
 * Whether the person's attention is in the dialog: focus inside it, or on the face it stands under.
 * Escape reads this before it decides whether closing should move focus.
 */
function focusInMenu(): boolean {
  const active = document.activeElement;
  if (active === null) {
    return false;
  }
  return (
    menuElement?.contains(active) === true ||
    (faceStrip.contains(active) && active.getAttribute('data-anchor') === menu?.anchor)
  );
}

/**
 * A press on a face, or on the `+N`: the same face twice closes what it opened, another one
 * replaces it, and the `+N` opens the list of everyone.
 */
function pressAnchor(anchor: string): void {
  if (menu?.anchor === anchor) {
    closeMenu();
    return;
  }
  openMenu(
    anchor === MORE_ANCHOR
      ? { view: 'everyone', anchor }
      : { view: 'person', peerId: anchor, anchor, fromList: false },
  );
}

function openMenu(state: MenuState): void {
  menu = state;
  renamingName = undefined;
  renderMenu();
  // Every face's state is read back from the one dialog that is open: a press on another face in a
  // quiet room leaves the last face saying it is expanded unless the faces are told.
  syncExpanded(faceStrip, menu?.anchor);
  if (menuElement !== undefined) {
    focusInto(menuElement);
  }
}

/**
 * Closes the dialog and, unless the press that closed it was somewhere else, puts focus back on
 * the face it came from: a press that lands on nothing should not leave the person nowhere.
 */
function closeMenu(refocus = true): void {
  const anchor = menu?.anchor;
  menu = undefined;
  renamingName = undefined;
  renamingField = undefined;
  menuElement?.remove();
  menuElement = undefined;
  syncExpanded(faceStrip, undefined);
  if (refocus && anchor !== undefined) {
    anchorButton(anchor)?.focus();
  }
}

/**
 * Draws the open dialog over the element it lives in, and moves focus into it when the press
 * came to see something: the first control, or the one a selector names.
 */
function renderMenu(focusSelector?: string): void {
  if (menu === undefined) {
    return;
  }
  if (menuElement === undefined) {
    menuElement = document.createElement('div');
    menuElement.id = 'menu';
    appPane.appendChild(menuElement);
  }
  const people = roomPeople(binding?.participants() ?? []);
  const anchor = menu.anchor;
  const renaming = renameView();
  if (menu.view === 'everyone') {
    renderEveryoneMenu(menuElement, people, {
      followedPeerId: binding?.following()?.peerId,
      onPick: (peerId) => void openMenu({ view: 'person', peerId, anchor, fromList: true }),
    });
  } else {
    const peerId = menu.peerId;
    const person = people.find((candidate) => candidate.peerId === peerId);
    if (person === undefined) {
      // The peer left while their menu stood open: a menu about nobody is not drawn.
      closeMenu(false);
      return;
    }
    renderPersonMenu(menuElement, person, {
      all: people,
      followedPeerId: binding?.following()?.peerId,
      fromList: menu.fromList,
      renaming,
      goToRefusal,
      // The press leaves the menu standing: the room has not answered yet, and the answer — where
      // the caret landed, or the sentence saying it could not — belongs in the menu it was pressed
      // in. `goToParticipant` takes it down once the outcome is `landed`.
      onGoTo: (peerId) => {
        void goToParticipant(peerId);
      },
      onFollow: (peerId) => {
        closeMenu();
        void followParticipant(peerId);
      },
      // The same state from the other side: the menu's Stop is the strip's Stop.
      onStopFollow: () => {
        closeMenu();
        binding?.stopFollowing();
      },
      onRename: () => startRename(),
      onBack: () => void backToEveryone(),
    });
  }
  if (focusSelector !== undefined) {
    focusInto(menuElement, focusSelector);
  }
  renamingField = renaming?.field;
  placeOpenMenu();
}

/** Back to the list the person was picked from, with the press back on the row it was made on. */
function backToEveryone(): void {
  const picked = menu?.view === 'person' ? menu.peerId : undefined;
  const anchor = menu?.anchor;
  if (anchor === undefined) {
    return;
  }
  menu = { view: 'everyone', anchor };
  // The pick is cleared before the draw that follows it, so the row the person came from is the
  // one focus lands on.
  renderMenu();
  if (menuElement === undefined || picked === undefined) {
    return;
  }
  for (const row of menuElement.querySelectorAll<HTMLElement>('.list button')) {
    if (row.dataset.pick === picked) {
      row.focus();
      return;
    }
  }
}

/** Places the open dialog under the face it came from, measured as the two stand. */
function placeOpenMenu(): void {
  if (menu === undefined || menuElement === undefined) {
    return;
  }
  const anchor = anchorButton(menu.anchor);
  if (anchor !== undefined) {
    placeMenu(menuElement, anchor, appPane);
  }
}

/**
 * The dialog's own two ways out: a press that lands on neither it nor a face, and Escape.
 *
 * A press outside keeps a name the person has typed and leaves the edit open — the rule both
 * in-row edits follow — and everything else takes the dialog down.
 */
document.addEventListener('pointerdown', (event) => {
  if (menu === undefined) {
    return;
  }
  const target = event.target as Element | null;
  if (target === null || target.closest('#menu') !== null || target.closest('[data-anchor]') !== null) {
    return;
  }
  const typed = renamingField?.value.trim() ?? '';
  if (renamingName !== undefined && typed !== '' && typed !== renamingName) {
    return;
  }
  closeMenu(false);
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || menu === undefined) {
    return;
  }
  // Closing takes focus back to the face only when the dialog is where the person's attention is:
  // a stray Escape — one Monaco is dismissing — closes the menu without pulling focus out of the
  // editor and back to the bar.
  const inside = focusInMenu();
  if (renamingName !== undefined) {
    // The edit is what Escape leaves, and the dialog stays open on the control that opened it.
    // The field's own Escape never reaches here: it stops the key.
    endRename(inside);
    return;
  }
  closeMenu(inside);
});

// The dialog is placed against the face it came from, so a window that changed size under it has
// to be told rather than the two drifting apart.
window.addEventListener('resize', () => {
  placeOpenMenu();
  placeNotices();
});

/**
 * Landing on a peer, from wherever the press came: a face's `Go to`, or the empty pane's own.
 *
 * A rejection is the room being unreachable, which is the alert's; a refusal the room answers with
 * is not a rejection at all, and lands on the row (`showGoToRefusal`).
 */
function goToParticipant(peerId: string): void {
  const participant = binding?.participants().find((candidate) => candidate.peerId === peerId);
  void binding
    ?.goTo(peerId)
    .then((outcome: GoToOutcome) => {
      // Only a press that landed somewhere is the menu's own end. The other outcomes leave it
      // standing: `waiting` because the room has not answered yet (the next presence frame retries,
      // and the refusal it may raise belongs in the menu), `refused` because its sentence stands
      // there for its four seconds, and `gone` because the next draw takes down the menu of a person
      // who is no longer in the room.
      if (outcome === 'landed') {
        closeMenu();
      }
    })
    .catch((error: unknown) => {
      failureAlert.show(`Could not go to ${participant?.displayName ?? peerId}: ${describe(error)}`);
    });
}

/** Following a peer, from wherever the press came: a face's `Follow`, or the empty pane's own. */
function followParticipant(peerId: string): void {
  const participant = binding?.participants().find((candidate) => candidate.peerId === peerId);
  void binding?.follow(peerId).catch((error: unknown) => {
    failureAlert.show(`Could not follow ${participant?.displayName ?? peerId}: ${describe(error)}`);
  });
}

/**
 * A go-to the room could not answer: in the menu of the person it was asked for, or on the page's
 * transient line when no such menu is standing (design §5.1).
 *
 * The refusal is a race — the peer closed the file, or its caret does not resolve here — and the
 * answer belongs where the press was. It is not a state: where a menu carries it, it stands
 * `GO_TO_REFUSAL_STAND_MS` and then goes, and the room's next presence frame does not re-raise it,
 * because nothing is wrong with the room. The sentence is announced once, from whichever home
 * takes it, and both homes carry the design's two parts: the headline, and the room's own reason
 * on the line beneath it.
 */
let goToRefusal: { peerId: string; detail: string } | undefined;
/** The standing refusal's own clock. One at a time: a press replaces the sentence *and* the timer. */
let goToRefusalTimer: number | undefined;

/** How long a refused go-to stands in the menu it was pressed in. */
const GO_TO_REFUSAL_STAND_MS = 4000;

function showGoToRefusal(peerId: string | undefined, detail: string): void {
  // The one line the transient home and its announcement read: the same two parts the menu draws,
  // in the order it draws them.
  const sentence = `${NOTHING_TO_GO_TO}: ${detail}`;
  // The menu of the person it is about is the only place the refusal is painted, so a refusal
  // with no such menu — the empty pane's own press, or one that names no peer — goes to the
  // page's transient line, the home it already has for a press that could not do what it said.
  // Nothing is stood or timed there: the sentence is the whole of it.
  if (peerId === undefined || menu?.view !== 'person' || menu.peerId !== peerId) {
    failureAlert.show(sentence);
    announce(sentence);
    return;
  }
  if (goToRefusalTimer !== undefined) {
    window.clearTimeout(goToRefusalTimer);
  }
  goToRefusal = { peerId, detail };
  goToRefusalTimer = window.setTimeout(() => {
    goToRefusalTimer = undefined;
    goToRefusal = undefined;
    // The control the sentence stood under is where focus stays, and the menu is redrawn under it
    // — but only while the person is still in the menu: taking focus back out of the editor to
    // put it on a control they have left would be worse than the sentence going.
    renderMenu(
      menuElement?.contains(document.activeElement) === true ? '[data-act="go"]' : undefined,
    );
  }, GO_TO_REFUSAL_STAND_MS);
  // The press that earned it is where focus stays, so the sentence is drawn under it either way.
  renderMenu('[data-act="go"]');
  announce(sentence);
}

/**
 * The own-name edit, open or not. The page owns it rather than the menu: the name the face shows
 * and the name the room is told are both the page's, and the menu is drawn from this state.
 */
let renamingName: string | undefined;
/**
 * The field the open edit is in, for the draw that built it — what tells a press outside the menu
 * whether the person has a name of their own in it, which a stray press keeps.
 */
let renamingField: HTMLInputElement | undefined;

/**
 * The edit as the menu draws it, when one is open.
 *
 * It opens on the name in force and draws whatever the field holds now: a redraw of a dialog nobody
 * is typing in must not throw away a half-typed name, which is what lets the presence-frame hold be
 * about the caret alone.
 */
function renameView(): RenameEdit | undefined {
  if (renamingName === undefined) {
    return undefined;
  }
  return {
    opened: renamingName,
    value: renamingField?.value ?? renamingName,
    maxLength: MAX_DISPLAY_NAME_UNITS,
    commit: (value) => void commitRename(value),
    cancel: () => endRename(),
  };
}

function startRename(): void {
  if (renamingName !== undefined || binding === undefined) {
    return;
  }
  renamingName = selfName;
  renamingField = undefined;
  renderMenu('.rename');
}

/**
 * Drops the edit and leaves the menu open on the control that opened it. A press inside the menu
 * moves focus there; Escape with attention elsewhere leaves the focus where the person put it.
 */
function endRename(refocus = true): void {
  renamingName = undefined;
  renamingField = undefined;
  renderMenu(refocus ? '[data-act="rename"]' : undefined);
}

/**
 * Sends the typed name and answers for it, over the page.
 *
 * `rename.ts` owns the order of the answers and the words; what is here is what the page is: the
 * menu it redraws, the strip it says the confirmation in, the alert a refusal stands on, and the
 * two places the name in force lives — the own face's `selfName` and the prefill the next join
 * reads.
 */
async function commitRename(raw: string): Promise<void> {
  endRename();
  await renameSelf(raw, {
    current: () => selfName,
    rename: async (name) => {
      await engine?.rename(name);
    },
    remember: (name) => saveDisplayName(window.localStorage, name),
    applied: (name) => {
      selfName = name;
    },
    refused: (sentence) => failureAlert.show(sentence),
    // The face already wears the new name, which is the confirmation; a sentence repeating what the
    // person can see would be the same fact twice.
    said: () => undefined,
  });
  drawRoom(binding?.participants() ?? []);
  renderMenu('[data-act="rename"]');
}

/** The room's listing as a tree. Directories open and shut; files open and fetch. */
function syncGrant(): void {
  tree?.render();
  // The one control whose state is the open document re-reads it here, where every event that
  // can move the open document already lands.
  syncStrip();
  // And so does the pane with no document in it: which state it is in is a fact about the listing
  // and the presence beside it, both of which land here.
  syncEmptyEditor();
}

/**
 * The pane with no document in front of it (`§6.3`, design §7).
 *
 * The state is a read of the room as it stands — who is hosting, how many files the listing carries,
 * which peer is in a file — so it is drawn wherever the listing or the presence lands (`syncGrant`),
 * and nowhere else. A document open here means the pane has something better to show, and the
 * overlay goes.
 */
function syncEmptyEditor(): void {
  const path = binding?.currentPath();
  renderEmptyEditor(
    editorEmpty,
    binding === undefined || path !== undefined
      ? undefined
      : emptyEditorFor({
          host: hostFolder !== undefined,
          folder: hostFolder?.name ?? '',
          files: binding.grantListing().length,
          hostName: binding.participants().find((participant) => participant.role === 'host')?.displayName ?? '',
          phone: phoneLayout.matches,
          panelOpen: !sidePane.hidden,
          peer: peerInAFile(binding.participants()),
          following: binding.following()?.peerId,
        }),
    runEmptyEditorAction,
  );
}

/**
 * The first peer that is in a file, as the pane's own block names one: a peer with no path has
 * nothing to go to, and their menu says so (`room.ts`).
 */
function peerInAFile(
  participants: readonly Participant[],
): { peerId: string; name: string; path: string } | undefined {
  const found = participants.find((participant) => participant.path !== undefined && participant.path !== '');
  return found === undefined || found.path === undefined
    ? undefined
    : { peerId: found.peerId, name: found.displayName, path: found.path };
}

/**
 * What the empty pane's own controls do. The create opens the row in the tree, so it opens the panel
 * a phone keeps shut first: a field nobody can see is a control that does nothing. The invite is the
 * bar's own handler, so the confirmation is the pill's `Copied` wherever the act was pressed.
 */
function runEmptyEditorAction(action: EmptyEditorAction, peerId: string | undefined): void {
  switch (action) {
    case 'new-file':
      showPanel(true);
      beginCreate('file');
      break;
    case 'copy-invite':
      void copyShareLink();
      break;
    case 'browse-files':
      showPanel(true);
      break;
    case 'go-to':
      if (peerId !== undefined) {
        goToParticipant(peerId);
      }
      break;
    case 'follow':
      if (peerId !== undefined) {
        followParticipant(peerId);
      }
      break;
    case 'stop-follow':
      binding?.stopFollowing();
      break;
  }
}

/**
 * The file strip: the open file, in one line above the editor — the directory muted, the leaf bold,
 * and nothing else.
 *
 * It is where the things that used to be said elsewhere now live, and which file is open is the one
 * of them the design draws: nothing said it at all on a phone, where the same row is also the
 * panel's disclosure. The read-only state, the empty document, the write the folder refused and the
 * peer being followed all had a chip or a segment here; the design models none of them, and the
 * four said what the reader could see for themselves or what a failure alert says better. A follow
 * is the face's dashed ring and its eye, and `Stop following` is in that person's menu.
 *
 * It carried a `⤓` that saved the open file to the person's own disk, which the tree's per-row
 * download already does for every file the room holds — including the one on screen. Two controls
 * for one act, and the strip is not the place a room's files are.
 */
function syncStrip(): void {
  const path = binding?.currentPath();
  fileStripPath.replaceChildren();
  fileStripPath.classList.toggle('none', path === undefined);
  if (path === undefined) {
    fileStripPath.textContent = 'No file open';
  } else {
    const slash = path.lastIndexOf('/');
    if (slash !== -1) {
      const dir = document.createElement('span');
      dir.className = 'dir';
      dir.textContent = path.slice(0, slash + 1);
      fileStripPath.appendChild(dir);
    }
    const leaf = document.createElement('span');
    leaf.className = 'leaf';
    leaf.textContent = slash === -1 ? path : path.slice(slash + 1);
    fileStripPath.appendChild(leaf);
  }
  // The disclosure's own name says which file is open, and this is where that changes: the strip is
  // re-read on every event that can move the open document (`syncGrant`), so its name moves with it
  // rather than standing as the load left it.
  applyStripRole();
}

/** The desktop clients' own sentence for the read-only state, which the page announces. */
const VIEWER_SENTENCE = 'you are a viewer in this room, so its documents are read-only.';

/** One sentence for a screen reader, in the one region that carries the changes that say nothing. */
function announce(text: string): void {
  live.textContent = text;
}

/**
 * The server's own renewal window, which is the bound `§7.1`'s fold is measured in.
 *
 * The page reads it rather than assuming the default: an ask made inside a window somebody else
 * opened is answered at that window's end, and a server that advertises another window gets
 * another stand. `undefined` only when there is no seated session to read it from.
 */
function awarenessRenewMs(): number | undefined {
  try {
    return engine?.session().keepalive.awareness_renew_ms;
  } catch {
    return undefined;
  }
}

/**
 * Saves a path out of the room, fetching its text first when this window has none.
 *
 * The fetch is the page's own open (`fetch-download.ts` says why it has to be the same call), and
 * the answer lands on the row that asked: progress in the action's own place, and a sentence under
 * the row while there is a decision in it — the cost of the fetch, a wait, an empty file offered, a
 * failure with its retry. What the design draws and those states are not, is the save itself: it is
 * a toast in the notices column, where a finished thing belongs.
 */
function startDownload(path: string, feedback: RowFeedback): void {
  if (binding === undefined) {
    return;
  }
  const here = (candidate: string): string =>
    binding?.text(candidate) ?? engine?.text(candidate) ?? '';
  // Whether the room's answer for the path is here, which is the whole of what decides this: a
  // document in front of the editor is not an answered one, and a guest that taps a row's ⤓ on the
  // file it has just opened holds an empty model until the room replies. Saving that model wrote a
  // 0-byte file over the one the person asked for. A path this window does hold is the person's own
  // copy of the file as it stands, the buffer they emptied included, and `fetch-download.ts` saves
  // it without a fetch; a path it does not hold is a fetch.
  const holds = binding.hasText(path) === true;
  // The cost is said once a session, before the first fetch, and only when a fetch is what comes
  // next: a path this window holds is answered out of its own document, so `Fetching opens …` would
  // be a sentence about an act that is not taken. It is not asked as a question — the room already
  // lists the name — it is said.
  if (!holds && !saidFetchCosts) {
    saidFetchCosts = true;
    const costs = fetchCostsSentence(path);
    feedback.note(costs);
    announce(costs);
    // Cleared by its own words: a fetch that settles inside the stand has replaced this line with
    // the outcome and its actions, and a timer that cleared whatever was there would take the only
    // thing the person can act on with it.
    window.setTimeout(() => feedback.clear(costs), FETCH_COSTS_STAND_MS);
  }
  // The wait is the fetch's own line, and only a fetch has one: a save of what is here is the
  // browser's own download UI and nothing else.
  if (!holds) {
    feedback.busy(fetchingSentence(path));
  }
  const again = { label: 'Try again', run: () => { feedback.clear(); startDownload(path, feedback); } };
  void fetchAndSave(path, {
    has: (candidate) => binding?.hasText(candidate) ?? false,
    text: here,
    open: (candidate) => binding?.requestText(candidate) ?? Promise.resolve(),
    save: (candidate, text) => downloadDocument(candidate, text, downloadSink),
  }, { standMs: fetchStandMs(awarenessRenewMs()) })
    .then((outcome) => {
      feedback.idle();
      if (outcome.kind === 'saved') {
        // Opening it is what put its text in the room, so the row's own mark moves, and the save
        // itself is the toast in the notices column.
        toasts.downloaded(path);
        syncGrant();
        return;
      }
      if (outcome.kind === 'failed') {
        feedback.note(outcome.sentence, [again]);
        return;
      }
      if (outcome.kind === 'pending') {
        // Nothing has arrived for the path, so the text may still be on its way. Nothing here says
        // the file is empty and nothing offers to save one: that would be the page claiming a fact
        // about the room's answer, and there is no answer yet. `Try again` is the whole of what a
        // person can do about it.
        feedback.note(stillAskingSentence(path), [again, { label: '✕', run: () => feedback.clear() }]);
        return;
      }
      feedback.note(stillEmptySentence(path), [
        {
          label: 'Save empty file',
          run: () => {
            feedback.clear();
            downloadDocument(path, '', downloadSink);
            toasts.downloaded(path);
          },
        },
        again,
        { label: '✕', run: () => feedback.clear() },
      ]);
    })
    .catch((error: unknown) => {
      feedback.idle();
      feedback.note(`Could not download ${path}: ${describe(error)}`, [again]);
    });
}

/** Where a download goes: the browser's own blob, object URL and anchor, in that order. */
const downloadSink: DownloadSink = {
  blob: (text) => new Blob([text], { type: 'text/plain;charset=utf-8' }),
  url: (blob) => URL.createObjectURL(blob),
  deliver: (url, name) => {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    // The click hands the browser a URL it reads after the event returns, so it is released on
    // a later turn rather than under the download's own feet.
    window.setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
  },
};

/**
 * A follow, and the reason one ended.
 *
 * The follow itself is drawn nowhere here: it is the dashed ring and the eye on the followed face in
 * the bar, and the control that stops it is `Stop following` in that person's menu. The strip used to
 * carry a segment for it, which said a second time what the face already said, and the design draws
 * the face alone.
 *
 * A follow that ends without the person pressing Stop leaves the reason on the page's transient line
 * for four seconds: the ring vanishing with nothing said is the one way a person loses the thread of
 * what just happened.
 */
function syncFollow(following: Following | undefined, ended?: string): void {
  if (binding !== undefined) {
    // The menu's toggle mirrors the follow: a follow ended by typing or by the peer leaving
    // re-renders here, not on the next room event. The pane's own toggle is the same state, so it is
    // redrawn with it — a follow that opened no document leaves the pane showing.
    drawRoom(binding.participants());
    syncEmptyEditor();
  }
  if (following === undefined && ended !== undefined) {
    failureAlert.show(ended, FOLLOW_ENDED_STAND_MS);
  }
}

/** How long the reason a follow ended stands before it goes. */
const FOLLOW_ENDED_STAND_MS = 4000;

/**
 * Leaves the session when it ends: the binding, the editor and the socket are
 * dropped, the session chrome and the tree come down, and the card returns over
 * the blurred preview carrying the reason and the next step. Nothing of the
 * dead room stays on screen — no frozen tree, no dead faces, no retired link —
 * and the guest can join another room from here with one fresh link.
 *
 * The address-bar link named the room that just closed, so it stops being the
 * way in (`linkIsTheInvite`): the paste box is what gets anyone back, and the card
 * leads with the join again (`cardIntent`), which is what its one action runs.
 */
function leaveSession(sentence: string): void {
  if (binding === undefined) {
    // No live session: a notice that arrives twice, or before anything joined,
    // has nothing to leave. The card is already the card.
    return;
  }
  dropSession({ linkGuard, binding, editor: editorApi, engine });
  // The address bar named the room this tab is leaving, and the link it carries is the whole
  // permission to be in it: a page that left must not be one reload away from walking back in.
  forgetJoinUrl(window.history, window.location.href);
  // Monaco takes its own DOM with it; anything it leaves behind must not sit in
  // the host when the next session builds another editor there.
  editorHost.replaceChildren();
  linkGuard = undefined;
  binding = undefined;
  engine = undefined;
  // The folder goes with the session: a control that outlived it would create in a folder this
  // window is no longer serving.
  hostFolder = undefined;
  republishGrant = undefined;
  treeActions.hidden = true;
  madeFolders.clear();
  lastCreateParent = undefined;
  hostAway = false;
  sessionHostName = undefined;
  saidFetchCosts = false;
  setHealth('ok');
  editorApi = undefined;
  desktopEditorOptions = undefined;
  opening = undefined;
  renderedPath = undefined;
  tree = undefined;
  goToRefusal = undefined;
  openDirs.clear();
  fullShareLink = '';
  shareGroup.classList.remove('hand-copy');
  shareInput.value = '';
  closeMenu(false);
  faceStrip.replaceChildren();
  treePane.replaceChildren();
  fileStripPath.textContent = '';
  renderEmptyEditor(editorEmpty, undefined, runEmptyEditorAction);
  // The question a host was reading goes with the room it was about, and the control that asked it
  // goes back to rest: one owner for that state, so the next session's first press raises a panel.
  leaveControl.close();
  sessionCard.hide();
  peek.dismiss();
  sessionBar.hidden = true;
  workspacePane.hidden = true;
  linkIsTheInvite = false;
  cardIntent = 'join';
  // The room this tab was hosting is over cleanly, so the next load has nothing to explain.
  clearHostingMark(window.sessionStorage);
  syncStrip();
  showRejoinCard(
    {
      pane: joinPane,
      startHeading,
      joinHeading,
      invitePath,
      inviteReveal,
      inviteWrap,
      preview: previewPane,
      veil: veilPane,
      message: joinMessage,
      joinError,
      hostError,
      inviteInput,
      joinButton,
    },
    sessionOverMessage(sentence),
  );
  // The card is the guest's now, and the host action is the card's own shape is what says so: the
  // sentence about what a room costs belongs to the start card, and a button left standing here
  // from a room whose page was bare is the other intent's. Nothing is asked of the page's origin
  // again — the read the offer rested on stands (`showHosting`).
  if (lastServerRead !== undefined) {
    showHosting(folderPicker !== undefined, lastServerRead);
  }
  // The join gate was left settled by the join that just ended: another join
  // from this card has to start clean.
  joinGate.release();
  inviteInput.focus();
}

/**
 * The status topics the page routes, and where each one goes.
 *
 * The binding raises every topic and this is where the page decides. Three of them have a surface of
 * their own and no case here at all: a follow's sentences are the file strip's own segment (who is
 * followed, and a Stop control in it), the faces in the bar are where a peer's arrival and
 * departure read, and a room that is over comes back as the card carrying the room's own sentence.
 *
 * - `role` is a state rather than a sentence: the strip's `Read-only` chip, which stays while it is
 *   true instead of a toast the person had to have caught. It is announced once, because a chip
 *   that appears with no words is a change a screen reader would otherwise miss.
 * - `refusal` is a go-to the room could not answer: the menu of the face that asked when one stands
 *   for it, and the alert otherwise (`showGoToRefusal`).
 * - `error` is the room's own word about the session, and nothing on screen is about it: it is the
 *   alert's, the one home for a failure with no control to sit beside (design §6.1).
 */
function statusRoute(topic: StatusTopic): 'role' | 'refusal' | 'error' | undefined {
  switch (topic) {
    case 'role':
    case 'refusal':
    case 'error':
      return topic;
    default:
      return undefined;
  }
}

/**
 * The bar's dot, which is the glanceable half of room health: a healthy room says nothing, and the
 * two states that change what typing means say their own name. The sentence with the countdown in it
 * is the strip below.
 */
/**
 * The bar's dot, which is the glanceable half of room health: a healthy room paints the dot alone,
 * and the two states that change what typing means paint their own name beside it. The sentence
 * with the countdown in it is the strip below. The name is set in every state, the green one
 * included: there it is clipped out of the paint, so a screen reader has it and the eye does not.
 */
function setHealth(state: 'ok' | 'reconnecting' | 'away'): void {
  health.dataset.health = state;
  const label =
    state === 'reconnecting' ? 'Reconnecting…' : state === 'away' ? 'Host away' : 'Connected';
  healthLabel.textContent = label;
  health.title =
    state === 'reconnecting'
      ? 'Reconnecting…'
      : state === 'away'
        ? 'The host is away'
        : 'Connected';
}

/**
 * The bar's one fact about which session this is.
 *
 * A host reads the folder it is exposing — the name is the handle's, and it is worth the glance —
 * and a guest reads whose room it is, from the room's own `host` seat. Before the room's peers have
 * arrived there is nothing to name but the shape: a guest in a session it does not yet know the
 * host of.
 *
 * While the host is away its seat leaves the roster and this line would read as a room with nobody
 * in charge of it. The name is kept from when the room still named it, so the guest keeps reading
 * whose session they are in — the card above says the same name, and both are the same fact.
 */
function rememberHostName(): void {
  const host = binding?.participants().find((participant) => participant.role === 'host');
  if (host !== undefined) {
    sessionHostName = host.displayName;
  }
}

function setSessionIdentity(): void {
  if (hostFolder !== undefined) {
    sessionIdentity.textContent = `Sharing “${hostFolder.name}”`;
    return;
  }
  rememberHostName();
  sessionIdentity.textContent =
    sessionHostName === undefined ? 'In a shared session' : `In ${sessionHostName}\u2019s session`;
}

function onNotice(notice: BindingNotice): void {
  // A landing moves the current path outside openPath: the tree highlight
  // follows it here, on every notice kind, so go-to and follow re-lands
  // mark the row the editor shows.
  syncTreeIfMoved();
  switch (notice.kind) {
    case 'roomGone':
      leaveSession(roomGoneSentence(notice.reason));
      break;
    case 'disconnected':
      // No room-gone reason came with it (reconnection gave up): the session is
      // over all the same, and the way back is a fresh join from a link.
      leaveSession(SESSION_ENDED_MESSAGE);
      break;
    case 'documents':
      // Both seat reports are the room answering again — the bridge forces them on a re-seat,
      // because the set can be exactly what it was before the drop — so either one ends the
      // dropped line a retry put up.
      sessionCard.endDropped();
      setHealth(hostAway ? 'away' : 'ok');
      // The tree is the listing, so a changed set re-renders it here as well
      // as on the grant event itself. Nothing is opened: opening a file is the person's act, and
      // the one open the page makes for them is the room's own seat (`openFirst`). A room that
      // names a document arriving while this window is working must not take the editor — the
      // download of a file this window has never opened is exactly that shape, and the row it was
      // asked from, with its note and its actions, is inside the panel an open collapses.
      syncGrant();
      break;
    case 'peers':
      sessionCard.endDropped();
      if (binding !== undefined) {
        const present = binding.participants();
        // The membership report is the room's own word on who is here, so a
        // report that names the host ends the warning the attach frame may
        // never have delivered (S1, 2026-09-18). It ends the countdown and
        // not the line: the host's return may be standing there, and the
        // card is the only place the guest reads it.
        if (hostPresent(present)) {
          sessionCard.endAway();
          hostAway = false;
        }
        // The dot and the dimming are one fact: green and legible together, red and dimmed together.
        setHealth(hostAway ? 'away' : 'ok');
        drawRoom(present);
        // The bar's identity names the host's session, which the room's peers are where the host appears.
        setSessionIdentity();
        // Where someone is reads on the tree, so presence moves re-render it.
        syncGrant();
      }
      break;
    case 'roster':
      if (hostPresent(notice.participants)) {
        sessionCard.endAway();
        hostAway = false;
      }
      setHealth(hostAway ? 'away' : 'ok');
      drawRoom(notice.participants);
      setSessionIdentity();
      // Where someone is reads on the tree, so presence moves re-render it.
      syncGrant();
      break;
    case 'grace':
      // The roster stops naming the host the moment its socket detaches, and the card says who
      // left: the name is taken from the room while it is still there, and kept.
      rememberHostName();
      sessionCard.away(sessionHostName ?? '', notice.graceMs);
      // No row draws a state while the host is away: no text can arrive until it is back, and the
      // card above carries that news. What is left of the fact is the health dot, and the rows.
      hostAway = true;
      setHealth('away');
      setSessionIdentity();
      syncGrant();
      break;
    case 'reconnecting':
      // The socket is down and the engine is re-dialling it: the line stands for as long as that
      // lasts, and the room's own reports are what take it down.
      sessionCard.dropped(RECONNECTING_NOTE);
      setHealth('reconnecting');
      break;
    case 'hostBack':
      sessionCard.say(hostBackSentence(notice.name), HOST_BACK_STAND_MS);
      hostAway = false;
      setHealth('ok');
      syncGrant();
      break;
    case 'status':
      // Where each topic goes, and why: `statusRoute` and the two functions it names.
      switch (statusRoute(notice.topic)) {
        case 'role':
          // A viewer's documents are read-only, and the page draws no chip for that any more: the
          // strip is the open file and nothing else, so the role is announced and the editor's own
          // refusal to type is what a person meets.
          syncStrip();
          announce(VIEWER_SENTENCE);
          break;
        case 'refusal':
          showGoToRefusal(notice.peerId, notice.text);
          break;
        case 'error':
          failureAlert.show(notice.text);
          break;
        default:
          break;
      }
      break;
    case 'grant':
      syncGrant();
      break;
    case 'follow':
      syncFollow(notice.following, notice.ended);
      break;
    case 'failure':
      // Something the person asked for was refused, and the sentence says why. A write's refusal
      // used to stand on the row it was about, and no row carries a mark for it any more: the page's
      // transient line is where a failure with no other home goes, and the folder's own words are the
      // whole of what a person can act on. A write that lands afterwards has nothing to take down —
      // the sentence went on the alert's own clock.
      failureAlert.show(notice.text);
      break;
  }
}

/** The tree highlight follows landings made outside openPath. */
function syncTreeIfMoved(): void {
  if (binding === undefined || binding.currentPath() === renderedPath) {
    return;
  }
  renderedPath = binding.currentPath();
  syncGrant();
}


function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}



window.addEventListener('beforeunload', () => {
  binding?.dispose();
  void engine?.disconnect();
});

/**
 * Keeps the page the size of what the guest can actually see.
 *
 * A soft keyboard on iOS shrinks only the *visual* viewport, so the layout
 * viewport — and with it `100dvh`, and with it every layout engine listening to
 * the element's own size — never hears about it. That is how a caret ends up
 * behind the keyboard. Following the visual viewport is the fix; `appHeightFor`
 * is the rule, and it declines a pinch-zoom, which is a visual-viewport shrink
 * too. A layout that did change gets its editor re-measured.
 */
function fitVisualViewport(): void {
  const height = touchOnly
    ? appHeightFor(window.visualViewport ?? undefined, window.innerHeight)
    : undefined;
  appPane.style.height = height === undefined ? '' : `${height}px`;
  editorApi?.layout();
}

window.visualViewport?.addEventListener('resize', fitVisualViewport);

/**
 * The decisions a stylesheet cannot restyle, replayed when a pointer is
 * attached or removed mid-session: Monaco's options, the off-hover wording,
 * and the viewport pin handed back to the browser or taken over again.
 */
function applyTouchMode(): void {
  editorApi?.updateOptions(
    touchOnly ? editorOptionsFor(true) : desktopEditorOptions ?? editorOptionsFor(false),
  );
  syncGrant();
  fitVisualViewport();
}

watchTouchQuery(touchLayout, (touch) => {
  touchOnly = touch;
  applyTouchMode();
});

/**
 * A finger taps where a pointer hovers. A peer's `label · role` is a decoration
 * hover, which never paints for a finger, so a tap that lands on a peer's caret
 * — or inside their selection — says the same line on the peek row. A drag is a
 * scroll and says nothing.
 */
let pressedAt: readonly [number, number] | undefined;
editorHost.addEventListener(
  'touchstart',
  (event) => {
    const touch = event.changedTouches[0] ?? event.touches[0];
    pressedAt = touch === undefined ? undefined : [touch.clientX, touch.clientY];
  },
  { passive: true },
);
editorHost.addEventListener('touchend', (event) => {
  if (!touchOnly) {
    return;
  }
  const touch = event.changedTouches[0] ?? event.touches[0];
  const from = pressedAt;
  pressedAt = undefined;
  if (touch === undefined || from === undefined) {
    return;
  }
  if (
    Math.abs(touch.clientX - from[0]) > TAP_SLOP ||
    Math.abs(touch.clientY - from[1]) > TAP_SLOP
  ) {
    return;
  }
  const position = editorApi?.getTargetAtClientPoint(touch.clientX, touch.clientY)?.position;
  const model = editorApi?.getModel();
  if (position === undefined || position === null || model === null || model === undefined) {
    return;
  }
  const peer = binding?.peerAt(model.getOffsetAt(position));
  if (peer !== undefined) {
    peek.show(`${peer.label} · ${peer.role}`);
  }
});
