import { sessionBase, sessionUrl } from '../engine/index.ts';
import type { SessionBase } from '../engine/index.ts';
import type { RoomEngine } from './relay.ts';
import { hostRoom, joinRoom, listingSource } from './relay.ts';
import type { SessionInfo } from '../engine/index.ts';
import type * as monacoTypes from 'monaco-editor';
import { MonacoBinding } from './editor.ts';
import type { BindingNotice, Following, Participant, StatusTopic } from './editor.ts';
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
  createJoinGate,
  initJoinCard,
  joinOnEnter,
  primaryActionOf,
  addressBarInvite,
  resolveJoin,
  saveDisplayName,
  showJoinFailure,
  showRejoinCard,
  validateDisplayName,
} from './join.ts';
import type { CardIntent, JoinTarget } from './join.ts';
import type { GuardableOpenerService } from './links.ts';
import { registerLinkGuard } from './links.ts';
import { iconSpan, iconSvg, labelSpan } from './icons.ts';
import {
  FolderWorkingCopy,
  folderPickerOf,
  pickFolder,
} from './folder.ts';
import type { NewEntryKind } from './folder.ts';
import { createInFolder, newFolderCreatedSentence, wireNewEntry } from './new-entry.ts';
import type { CreateOutcome } from './new-entry.ts';
import {
  HOST_GUESTS_NOTE,
  HOST_NEEDS_THE_SERVERS_PAGE,
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
import { renderRoster } from './roster.ts';
import { renameSelf } from './rename.ts';
import { HOST_LEAVE_QUESTION, LEAVE_ASK_MS, wireLeave } from './leave.ts';
import { wireShareBox } from './share-box.ts';
import {
  HOST_BACK_STAND_MS,
  RECONNECTING_NOTE,
  TRANSIENT_STAND_MS,
  hostBackSentence,
  hostPresent,
  wireFailureAlert,
  wireSessionNote,
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
  keyboardInsetFor,
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
          // two dims a reader reads most (comments, line numbers) — so both
          // step one shade lighter: 4.9:1, still quiet.
          { token: 'comment', foreground: '868ca2' },
          { token: 'keyword', foreground: 'cba6f7' },
          { token: 'string', foreground: 'a6e3a1' },
          { token: 'number', foreground: 'fab387' },
          { token: 'type', foreground: 'f9e2af' },
        ],
        colors: {
          'editor.background': '#1e1e2e',
          'editor.foreground': '#cdd6f4',
          'editor.lineHighlightBackground': '#31324466',
          'editorLineNumber.foreground': '#868ca2',
          'editorLineNumber.activeForeground': '#cba6f7',
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
const hostError = document.getElementById('host-error') as HTMLElement;
const sessionBar = document.getElementById('session') as HTMLElement;
const shareInput = document.getElementById('share') as HTMLInputElement;
const shareGroup = document.getElementById('share-group') as HTMLElement;
const downloadButton = document.getElementById('download') as HTMLButtonElement;
const leaveButton = document.getElementById('leave') as HTMLButtonElement;
const hostWrap = document.getElementById('host-wrap') as HTMLElement;
const hostButton = document.getElementById('host-button') as HTMLButtonElement;
const hostShare = document.getElementById('host-share') as HTMLElement;
const hostNote = document.getElementById('host-note') as HTMLElement;
const workspacePane = document.getElementById('workspace') as HTMLElement;
const editorHost = document.getElementById('editor') as HTMLElement;
const rosterList = document.getElementById('roster') as HTMLElement;
const treePane = document.getElementById('tree') as HTMLElement;
const newEntryRow = document.getElementById('new-entry') as HTMLElement;
const newFileName = document.getElementById('new-name') as HTMLInputElement;
const newFileButton = document.getElementById('new-file') as HTMLButtonElement;
const newFolderButton = document.getElementById('new-folder') as HTMLButtonElement;
const newEntryMessage = document.getElementById('new-message') as HTMLElement;
const followBanner = document.getElementById('follow-banner') as HTMLElement;
const appPane = document.getElementById('app') as HTMLElement;
const sidePane = document.getElementById('side') as HTMLElement;
const panelToggle = document.getElementById('panel-toggle') as HTMLButtonElement;

/**
 * The chrome's lifecycle line: the host-leave warning while the grace runs, counting its
 * window down. Every other transient sentence either has a home of its own or is dropped
 * (see `onNotice`).
 */
const sessionNote = wireSessionNote(document.getElementById('session-note') as HTMLElement);
/** Failures of an action the guest took: shown, then gone on their own. */
const failureAlert = wireFailureAlert(document.getElementById('alert') as HTMLElement);
/**
 * What a fingertip touched: the words a `title` would have shown a pointer, and
 * the reason a disabled action would have given on hover. It stands briefly and
 * takes itself down, the way a failure does.
 */
const peek = wireTapPeek(document.getElementById('peek') as HTMLElement, { standMs: 4000 });

/**
 * The panel is a disclosure on a phone and simply a column on anything else.
 * Rotating out of the phone shape opens it rather than leaving the tree with no
 * way to be reached: the control that would open it is gone at that width.
 */
function showPanel(open: boolean): void {
  sidePane.hidden = !open;
  panelToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
}

panelToggle.addEventListener('click', () => showPanel(sidePane.hidden));
phoneLayout.addEventListener('change', () => showPanel(!phoneLayout.matches));
// The panel competes with the editor on a phone (a 42 % cut of a 844 px screen)
// and starts shut there; every other device has the room for both.
showPanel(!phoneLayout.matches);

/** Shuts the panel after a navigation, so the file that opened gets the screen. */
function collapsePanel(): void {
  if (phoneLayout.matches) {
    showPanel(false);
  }
}

const params = pageQueryParams(window.location.search);
// Which of the card's two intents this page has: a room and its token in the address bar
// are the invite the host sent, and the card asks the name alone and joins it. With neither,
// this page is where a room starts, and the invite path is a disclosure the person opens
// only if they turn out to have a link. A room the address bar named that is now gone
// leaves the card in the join shape anyway (`leaveSession`): a fresh link is the way in.
let cardIntent: CardIntent = cardIntentOf(params);
// The address bar's invite is the way in until the room it names is over.
let linkIsTheInvite = cardIntent === 'join';
// The card shell is inline HTML, so it paints before this bundle arrives: wire only the intent
// the address bar calls for, prefill only an untouched name field, and land focus past first
// paint without stealing a field the guest already typed into. The name is the question both
// intents ask — each action needs it — so focus belongs there either way.
initJoinCard(
  { pane: joinPane, startHeading, joinHeading, invitePath, inviteReveal, inviteWrap, inviteInput, nameInput },
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

let binding: MonacoBinding | undefined;
let engine: RoomEngine | undefined;
/** The editor's opener guard, one registration per join, dropped with the session. */
let linkGuard: { dispose(): void } | undefined;
/** The editor widget the binding drew into, dropped with the session. */
let editorApi: monacoTypes.editor.IStandaloneCodeEditor | undefined;
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
/** The joined display name, for the roster's self row. */
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
 * Creates a file or a directory in the folder this tab picked, and puts it in the room.
 *
 * The order is the one that makes each step true. The create is the folder's own, and its refusals
 * are the folder's own sentences. The re-walk is what a listing is, so the new path is published
 * because the folder holds it and not because this function names it — the same walk a watcher
 * would have triggered had the create been made by something else on the disk. And a created file
 * is opened, which is what makes its text reach the room at all: content arrives when a file is
 * opened, so a listed path nobody opened reads empty to every guest.
 */
async function createEntry(path: string, entry: NewEntryKind): Promise<string | undefined> {
  const folder = hostFolder;
  if (folder === undefined || binding === undefined) {
    return undefined;
  }
  let outcome: CreateOutcome;
  try {
    outcome = await createInFolder({ folder, publish: republishGrant, open: openPath }, path, entry);
  } catch (error: unknown) {
    // What reaches here is the folder layer's own unnamed failure, thrown before the entry was made:
    // the steps after it belong to the act and report themselves (`CreateOutcome`), so a file that
    // did land is never reported as one that did not.
    return `${path} was not created: ${describe(error)}`;
  }
  if (outcome.kind === 'refused' || outcome.kind === 'incomplete') {
    return outcome.sentence;
  }
  syncGrant();
  return outcome.entry === 'file' ? undefined : newFolderCreatedSentence(path);
}

/**
 * The control that asks for a name, offered only to a window that holds a folder: a guest has
 * nothing to create in, and the sentence the empty tree carries is its own answer.
 */
const newEntry = wireNewEntry({
  surface: {
    row: newEntryRow,
    file: newFileButton,
    folder: newFolderButton,
    name: newFileName,
    message: newEntryMessage,
  },
  create: createEntry,
});

// Enter runs the action the field belongs to: the name is the card's own field and runs what
// the card leads with, while the paste box is the invite path and always joins.
joinForm.addEventListener('submit', (event) => {
  event.preventDefault();
  attemptJoin();
});
nameInput.addEventListener('keydown', (event) => {
  joinOnEnter(event, runPrimary);
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
  // attempt.
  hostError.textContent = '';
  let held: HeldJoin;
  try {
    // Read at submit time: a queued join holds these until load, so anything
    // typed meanwhile must not rewrite the attempt.
    held = {
      displayName: validateDisplayName(nameInput.value),
      figured: resolveJoin(
        addressBarInvite(linkIsTheInvite, params),
        linkIsTheInvite ? '' : inviteInput.value,
        window.location.href,
      ),
    };
  } catch (error: unknown) {
    const base = fallbackBase();
    console.error(`[selvage] join failed (${joinFailureDetail(error, base)})`);
    showJoinFailure(
      { invitePath, joinError },
      describeJoinErrorForDisplay(error, base, params.get('debug') === '1'),
    );
    // Nothing left the page, but a held early submit disabled the button
    // before this bundle arrived: a refused pre-flight (a blank name, a link
    // that names no session) hands the card back the way a refused join does,
    // or the guest's only way on is Enter.
    joinButton.disabled = false;
    joinButton.textContent = 'Join';
    return;
  }
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

/** What the host button says, before and after an attempt. */
const HOST_BUTTON_LABEL = 'Choose a folder to share';

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
 * the editor and its binding, the tree, the roster, the first document and the focus.
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
  republishGrant = seat.republish;
  newEntry.show(seat.folder !== undefined);
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
    open: (path) => {
      binding?.stopFollowing();
      void openPath(path);
    },
  });
  syncRoster(binding.participants());
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
  // A name already in the room is allowed in, and the roster row carries the
  // short id that tells the two apart, so no sentence is needed here.
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
    throw new Error(HOST_NEEDS_THE_SERVERS_PAGE);
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
  // attempt, and a refusal lands under the button that asked for it.
  hostError.textContent = '';
  joinError.textContent = '';
  let displayName: string;
  try {
    displayName = validateDisplayName(nameInput.value);
  } catch (error) {
    // The name is asked for here, so the refusal about it stands here: under the button
    // that needed it, never under the invite path above.
    hostError.textContent = describe(error);
    return;
  }
  hosting = true;
  hostButton.disabled = true;
  hostButton.textContent = 'Opening…';
  try {
    const picked = await pickFolder(folderPicker);
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
    // A page whose own address names no server at all (a `file://` open) has no origin to ask,
    // and it is not a server's own page either way: the answer is the sentence, not an offer.
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
 * Puts one read of the page's own origin on the card: the note beside the action, what choosing a
 * folder shares, and whether there is an action at all.
 *
 * The warning is worded for the card it stands on: a guest's card offers the start action as the
 * alternative under Join, so the tab warning there opens with that (`host.ts`), and a guest who
 * never touches the button is not told about a tab that is not theirs.
 */
function showHosting(picker: boolean, read: ServerRead): void {
  const availability = hostAvailability({ picker, read, scope: cardIntent });
  hostWrap.hidden = false;
  hostShare.textContent = availability.kind === 'explained' ? '' : HOST_GUESTS_NOTE;
  hostNote.textContent = availability.note;
  hostButton.hidden = availability.kind === 'explained';
}

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
    // A plain open says nothing — the tree highlight and the buffer already
    // name the file. A listed path nobody published reads empty like a
    // cleared file; the open row's badge tells the two apart, never a message.
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
const shareBox: ShareBox = wireShareBox(shareGroup, () => copyShareLink(), {
  checkSvg: iconSvg('check'),
});
// The download button is icon-only, so its icon is drawn here rather than in the shell: the
// bar is hidden until a session is seated, so nothing flashes before the bundle puts it in.
downloadButton.append(iconSpan('download'));
downloadButton.addEventListener('click', () => {
  downloadOpen();
});

/**
 * The leave control: a guest's press drops the session and brings the card back with a fresh link
 * as the way in; a host's press asks first, because its connection is the room's (`leave.ts`). The
 * words on the control are the page's, the two sentences are the module's, and the question stands
 * in the strip that is already the page's one line about the room.
 */
const leaveControl = wireLeave({
  hosting: () => hostFolder !== undefined,
  button: leaveButton,
  ask: () => sessionNote.say(HOST_LEAVE_QUESTION, LEAVE_ASK_MS),
  leave: () => leaveSession(LEFT_SESSION_SENTENCE),
});
leaveButton.addEventListener('click', () => {
  leaveControl.press();
});

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
  // The bar's brief morph is the whole confirmation: nothing is announced.
  shareBox.confirm();
}

/**
 * Who is here: the own name first, then one row per peer. Where someone is
 * reads on the grant tree, not here; the follow banner owns the one stop.
 *
 * An own-name edit holds the list still (`renamingName`): a presence frame lands
 * every few hundred milliseconds while anybody types, and a list redrawn under
 * the field would take the cursor with it. The rows the person cannot see for
 * those seconds are redrawn the moment the edit ends, and nothing is lost — a
 * roster is a read of the room as it stands, not a queue.
 */
function syncRoster(participants: Participant[]): void {
  if (renamingName !== undefined) {
    return;
  }
  drawRoster(participants);
}

/** The list as it stands, with the own-name edit open if one is. */
function drawRoster(participants: Participant[]): void {
  renderRoster(rosterList, participants, {
    followedPeerId: binding?.following()?.peerId,
    selfName,
    selfColour: engine === undefined ? undefined : peerColour(engine.session().peer.peer_id),
    selfRole: engine?.session().role,
    renaming:
      renamingName === undefined
        ? undefined
        : {
            value: renamingName,
            maxLength: MAX_DISPLAY_NAME_UNITS,
            commit: (value) => void commitRename(value),
            cancel: () => endRename(),
          },
    onRename: () => startRename(),
    onGoTo: (peerId) => {
      const participant = participants.find((candidate) => candidate.peerId === peerId);
      void binding?.goTo(peerId).catch((error: unknown) => {
        failureAlert.show(`Could not go to ${participant?.displayName ?? peerId}: ${describe(error)}`);
      });
    },
    onFollow: (peerId) => {
      const participant = participants.find((candidate) => candidate.peerId === peerId);
      void binding?.follow(peerId).catch((error: unknown) => {
        failureAlert.show(`Could not follow ${participant?.displayName ?? peerId}: ${describe(error)}`);
      });
    },
  });
}

/**
 * The own-name edit, open or not. The page owns it rather than the row: the
 * name the row shows and the name the room is told are both the page's, and
 * the row is drawn from this state (`drawRoster`).
 */
let renamingName: string | undefined;

function startRename(): void {
  if (renamingName !== undefined || binding === undefined) {
    return;
  }
  renamingName = selfName;
  // Opening the field is the one drawing that happens while an edit is open, so it does
  // not go through the hold `syncRoster` keeps.
  drawRoster(binding.participants());
}

function endRename(): void {
  renamingName = undefined;
  syncRoster(binding?.participants() ?? []);
}

/**
 * Sends the typed name and answers for it, over the page.
 *
 * `rename.ts` owns the order of the answers and the words; what is here is what
 * the page is: the row it redraws, the strip it says the confirmation in, the
 * alert a refusal stands on, and the two places the name in force lives — the
 * own row's `selfName` and the prefill the next join reads.
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
    said: (sentence) => sessionNote.say(sentence, TRANSIENT_STAND_MS),
  });
  syncRoster(binding?.participants() ?? []);
}

/** The room's listing as a tree. Directories open and shut; files open and fetch. */
function syncGrant(): void {
  tree?.render();
  // The one control whose state is the open document re-reads it here, where every event that
  // can move the open document already lands.
  syncDownload();
}

/**
 * The download control: the file in front of the editor, out of the room and onto the disk.
 *
 * It is off while no document is open — an editor with nothing in it has nothing to save — and
 * its label names the file so a pointer device reads it in the `title` and a finger reads it on
 * the button's own `aria-label`.
 */
function syncDownload(): void {
  const path = binding?.currentPath();
  downloadButton.disabled = path === undefined;
  const label = path === undefined ? 'Download the open file' : `Download ${path}`;
  downloadButton.title = label;
  downloadButton.setAttribute('aria-label', label);
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

function downloadOpen(): void {
  const path = binding?.currentPath();
  if (path === undefined) {
    return;
  }
  // The buffer first: it is what the person is looking at, and it can be a keystroke ahead of
  // the replica. The replica is the fallback for a path this window has no model for.
  const text = binding?.text(path) ?? engine?.text(path) ?? '';
  try {
    downloadDocument(path, text, downloadSink);
  } catch (error) {
    failureAlert.show(`Could not download ${path}: ${describe(error)}`);
  }
}

/**
 * The follow indicator: a banner in the followed peer's colour — the mapping the
 * caret wears, so the two cannot disagree — with the stop control on it.
 */
function syncFollow(following: Following | undefined): void {
  followBanner.replaceChildren();
  if (binding !== undefined) {
    // The toggle mirrors the indicator: a follow ended by typing or by the
    // peer leaving re-renders here, not on the next room event.
    syncRoster(binding.participants());
  }
  if (following === undefined) {
    followBanner.hidden = true;
    return;
  }
  followBanner.hidden = false;
  followBanner.style.borderColor = following.colour;
  followBanner.style.backgroundColor = `${following.colour}22`;
  const label = document.createElement('span');
  label.textContent = `Following ${following.name}`;
  followBanner.appendChild(label);
  const stop = document.createElement('button');
  stop.type = 'button';
  stop.append(iconSpan('stop'), labelSpan('Stop following'));
  stop.addEventListener('click', () => {
    binding?.stopFollowing();
  });
  followBanner.appendChild(stop);
}

/**
 * Enters the terminal state: the session note carries this sentence to the
 * end, the roster clears with dead actions, the share link retires, and the
 * tree freezes on the snapshot taken here — the engine sheds its local grant
 * on the terminal close, so the snapshot must precede it.
 */
/**
 * Leaves the session when it ends: the binding, the editor and the socket are
 * dropped, the session chrome and the tree come down, and the card returns over
 * the blurred preview carrying the reason and the next step. Nothing of the
 * dead room stays on screen — no frozen tree, no dead roster, no retired link —
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
  newEntry.show(false);
  newEntry.reset();
  editorApi = undefined;
  desktopEditorOptions = undefined;
  opening = undefined;
  renderedPath = undefined;
  tree = undefined;
  openDirs.clear();
  fullShareLink = '';
  shareGroup.classList.remove('hand-copy');
  shareInput.value = '';
  rosterList.replaceChildren();
  treePane.replaceChildren();
  followBanner.replaceChildren();
  followBanner.hidden = true;
  sessionNote.hide();
  peek.dismiss();
  sessionBar.hidden = true;
  workspacePane.hidden = true;
  linkIsTheInvite = false;
  cardIntent = 'join';
  // The room this tab was hosting is over cleanly, so the next load has nothing to explain.
  clearHostingMark(window.sessionStorage);
  syncDownload();
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
  // The join gate was left settled by the join that just ended: another join
  // from this card has to start clean.
  joinGate.release();
  inviteInput.focus();
}

/**
 * The status sentences the page shows, by topic — the ones whose fact nothing else on the page
 * states.
 *
 * The binding raises every topic and this is where the page decides. A follow's sentences repeat
 * the follow banner that is on screen (who, and a Stop control) and the tree row and buffer that
 * say where; the roster is where a peer's arrival and departure read; the role is the editor's own
 * read-only state; and a room that is over comes back as the card carrying the room's own
 * sentence. Showing those here would be the same fact twice, one copy of it chrome that appears
 * and disappears. What is left is what has no other surface: the viewer's read-only line — which
 * is the one the owner could not discover — a go-to the room could not answer, and what the room
 * said about the session itself.
 */
const SHOWN_STATUS_TOPICS: ReadonlySet<StatusTopic> = new Set(['role', 'refusal', 'error']);

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
      sessionNote.endDropped();
      // The tree is the listing, so a changed set re-renders it here as well
      // as on the grant event itself.
      syncGrant();
      if (binding?.currentPath() === undefined && notice.documents.length > 0) {
        const first = notice.documents.slice().sort()[0];
        if (first !== undefined) {
          void openPath(first);
        }
      }
      break;
    case 'peers':
      sessionNote.endDropped();
      if (binding !== undefined) {
        const present = binding.participants();
        // The membership report is the room's own word on who is here, so a
        // report that names the host ends the warning the attach frame may
        // never have delivered (S1, 2026-09-18). It ends the countdown and
        // not the line: the host's return may be standing there, and the
        // strip is the only place the guest reads it.
        if (hostPresent(present)) {
          sessionNote.endCountdown();
        }
        syncRoster(present);
        // Where someone is reads on the tree, so presence moves re-render it.
        syncGrant();
      }
      break;
    case 'roster':
      if (hostPresent(notice.participants)) {
        sessionNote.endCountdown();
      }
      syncRoster(notice.participants);
      // Where someone is reads on the tree, so presence moves re-render it.
      syncGrant();
      break;
    case 'grace':
      sessionNote.countdown(notice.graceMs);
      break;
    case 'reconnecting':
      // The socket is down and the engine is re-dialling it: the line stands for as long as that
      // lasts, and the room's own reports are what take it down.
      sessionNote.dropped(RECONNECTING_NOTE);
      break;
    case 'hostBack':
      sessionNote.say(hostBackSentence(notice.name), HOST_BACK_STAND_MS);
      break;
    case 'status':
      // News with no other home, and never a second copy of a control: see `SHOWN_STATUS_TOPICS`.
      // The strip holds one line, so a later sentence replaces an earlier one and the room's own
      // warning is not the news's to take down (`SessionNote.status`).
      if (SHOWN_STATUS_TOPICS.has(notice.topic)) {
        sessionNote.status(notice.text);
      }
      break;
    case 'grant':
      syncGrant();
      break;
    case 'follow':
      syncFollow(notice.following);
      break;
    case 'failure':
      // Something the person asked for was refused, and the sentence says why: a write the
      // stale-file guard stopped, or a path this host cannot read out of its own folder.
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
 * too. A layout that did change gets its editor re-measured. The transient
 * lines are fixed against the layout viewport, which the keyboard leaves
 * alone, so they are told the distance up to the floor the guest can see.
 */
function fitVisualViewport(): void {
  const height = touchOnly
    ? appHeightFor(window.visualViewport ?? undefined, window.innerHeight)
    : undefined;
  appPane.style.height = height === undefined ? '' : `${height}px`;
  const inset = touchOnly
    ? keyboardInsetFor(window.visualViewport ?? undefined, window.innerHeight)
    : 0;
  document.documentElement.style.setProperty('--keyboard-inset', `${inset}px`);
  editorApi?.layout();
}

window.visualViewport?.addEventListener('resize', fitVisualViewport);
// A pan scrolls the visual viewport without resizing it, and the inset is
// measured from its offset, so the same rule runs on the scroll too.
window.visualViewport?.addEventListener('scroll', fitVisualViewport);

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
