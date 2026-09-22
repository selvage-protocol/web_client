import { SelvageEngine, fetchMeta, metaAccepts, sessionBase, sessionUrl } from '../engine/index.ts';
import type { SessionInfo } from '../engine/index.ts';
import type * as monacoTypes from 'monaco-editor';
import { MonacoBinding } from './editor.ts';
import type { BindingNotice, Following, Participant } from './editor.ts';
import { handCopy, showDisplay } from './hand-copy.ts';
import { buildShareLink, displayShareLink, fitReadout, pageQueryParams, persistJoinUrl } from './share.ts';
import type { monaco as monacoApi } from './monaco.ts';
import {
  createJoinGate,
  initJoinCard,
  joinOnEnter,
  addressBarInvite,
  resolveJoin,
  saveDisplayName,
  showRejoinCard,
  validateDisplayName,
} from './join.ts';
import type { JoinTarget } from './join.ts';
import type { GuardableOpenerService } from './links.ts';
import { registerLinkGuard } from './links.ts';
import { iconSpan, iconSvg, labelSpan } from './icons.ts';
import {
  FolderWorkingCopy,
  folderPickerOf,
  pickFolder,
} from './folder.ts';
import {
  HOST_TAB_WARNING,
  HOST_NEEDS_THE_SERVERS_PAGE,
  clearHostingMark,
  hostAvailability,
  markHosting,
  takeHostingNotice,
} from './host.ts';
import { downloadDocument } from './download.ts';
import type { DownloadSink } from './download.ts';
import { GrantTreeView } from './tree-view.ts';
import { renderRoster } from './roster.ts';
import { wireShareBox } from './share-box.ts';
import {
  HOST_BACK_STAND_MS,
  hostBackSentence,
  hostPresent,
  wireFailureAlert,
  wireSessionNote,
  wireTapPeek,
} from './notice.ts';
import {
  SESSION_ENDED_MESSAGE,
  dropSession,
  roomGoneSentence,
  sessionOverMessage,
} from './ended.ts';
import type { ShareBox } from './share-box.ts';
import { describeJoinErrorForDisplay, joinFailureDetail, nativeWebSocketFactory } from './transport.ts';
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
const previewPane = document.getElementById('preview') as HTMLElement;
const veilPane = document.getElementById('veil') as HTMLElement;
const joinForm = document.getElementById('join-form') as HTMLFormElement;
const inviteWrap = document.getElementById('invite-wrap') as HTMLElement;
const inviteInput = document.getElementById('invite') as HTMLInputElement;
const nameInput = document.getElementById('name') as HTMLInputElement;
const joinButton = document.getElementById('join-button') as HTMLButtonElement;
const joinMessage = document.getElementById('join-message') as HTMLElement;
const joinError = document.getElementById('join-error') as HTMLElement;
const sessionBar = document.getElementById('session') as HTMLElement;
const shareInput = document.getElementById('share') as HTMLInputElement;
const shareGroup = document.getElementById('share-group') as HTMLElement;
const downloadButton = document.getElementById('download') as HTMLButtonElement;
const hostWrap = document.getElementById('host-wrap') as HTMLElement;
const hostButton = document.getElementById('host-button') as HTMLButtonElement;
const hostNote = document.getElementById('host-note') as HTMLElement;
const workspacePane = document.getElementById('workspace') as HTMLElement;
const editorHost = document.getElementById('editor') as HTMLElement;
const rosterList = document.getElementById('roster') as HTMLElement;
const treePane = document.getElementById('tree') as HTMLElement;
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
const linkRoom = (params.get('room') ?? '').trim();
const linkToken = (params.get('token') ?? '').trim();
// A share link carries the room and its token, so the card asks one thing —
// the name — behind a plain invite line that names no id. A bare page open
// shows the paste box instead; the link stays the whole guest flow either way.
// A room that closes takes that link with it: the card comes back and the
// address-bar link is no longer the way in.
let linkIsTheInvite = linkRoom !== '' && linkToken !== '';
// The card shell is inline HTML, so it paints before this bundle arrives: wire
// only the variant the address bar calls for, prefill only an untouched name
// field, and land focus past first paint without stealing a typed-into field.
const focusTarget = initJoinCard({ inviteWrap, inviteInput, nameInput }, params, window.localStorage);
settleFocusWhenReady(focusTarget === 'name' ? nameInput : inviteInput);
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
let engine: SelvageEngine | undefined;
/** The editor's opener guard, one registration per join, dropped with the session. */
let linkGuard: { dispose(): void } | undefined;
/** The editor widget the binding drew into, dropped with the session. */
let editorApi: monacoTypes.editor.IStandaloneCodeEditor | undefined;
/** What the editor was created with on this device, to return to under a pointer. */
let desktopEditorOptions: monacoTypes.editor.IEditorOptions | undefined;
let opening: string | undefined;
/** The full guest link: the bar shows it abbreviated, the clipboard keeps it whole. */
let fullShareLink = '';
/** The abbreviation the bar carries at rest, kept apart from the field's own value because
 * the clipboard-less fallback fields the whole link there and may leave it. */
let shareDisplay = '';
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

joinForm.addEventListener('submit', (event) => {
  event.preventDefault();
  attemptJoin();
});

// Enter joins from any card field without relying on implicit submission:
// the keydown default is prevented, so no second submit follows it.
joinForm.addEventListener('keydown', (event) => {
  joinOnEnter(event, attemptJoin);
});

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
if (window.__selvagePendingJoin === true) {
  window.__selvagePendingJoin = false;
  attemptJoin();
}

function attemptJoin(): void {
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
    joinError.textContent = describeJoinErrorForDisplay(error, base, params.get('debug') === '1');
    // Nothing left the page, but a held early submit disabled the button
    // before this bundle arrived: a refused pre-flight (a blank name, a link
    // that names no session) hands the card back the way a refused join does,
    // or the guest's only way on is Enter.
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
    joinError.textContent = describeJoinErrorForDisplay(error, base, params.get('debug') === '1');
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

/** The client identity every connection from this page carries. */
const CLIENT_OPTIONS = {
  webSocketFactory: nativeWebSocketFactory,
  client: 'web_client/0.1.0',
} as const;

/** What the host button says, before and after an attempt. */
const HOST_BUTTON_LABEL = 'Start a session here';

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
  engine: SelvageEngine;
  session: SessionInfo;
  displayName: string;
  /** The link the session bar carries and the clipboard copies. */
  shareLink: string;
  /** The folder this window was handed, when it is the host: absent for a guest. */
  folder?: FolderWorkingCopy;
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
  selfName = seat.displayName;
  fullShareLink = seat.shareLink;
  // The bar shows the link with the page's own origin dropped and its long parts shortened,
  // and sized to what it shows; the title and the clipboard below keep the full bytes.
  shareDisplay = displayShareLink(fullShareLink, window.location.origin);
  shareInput.value = shareDisplay;
  fitReadout(shareInput, shareDisplay);
  shareInput.title = fullShareLink;
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
  const invite = sessionUrl(base, figured.room, figured.token);
  lastBase = base;
  joinError.textContent = '';
  // A stack that never arrives throws before the button disables, so the card keeps its copy
  // and the guest can retry.
  const monaco = await prepareEditor();
  // The default `/meta` check runs: same-origin it reads the version, and where
  // the page is cross-origin the read fails like any unreachable endpoint —
  // advisory, never a refusal — while the handshake negotiates the truth.
  // The button stays `Joining…` throughout: attemptJoin owns it, and the gate
  // makes a second submit while this runs a duplicate, never a second join.
  const engine = await SelvageEngine.join(invite, displayName, CLIENT_OPTIONS);
  await seatSession({
    monaco,
    engine,
    session: engine.session(),
    displayName,
    shareLink: buildShareLink(base, figured.room, figured.token),
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
  const engine = await SelvageEngine.host(base, displayName, CLIENT_OPTIONS);
  const session = engine.session();
  try {
    await engine.grant(await folder.list());
  } catch (error) {
    // A server older than `doc.grant` answers `unknown_method` rather than faulting, and the
    // room still works: it offers what someone opens and nothing more, which is worth saying.
    failureAlert.show(
      `The room could not be told what the folder holds, so it offers only what someone opens: ${describe(error)}`,
    );
  }
  await seatSession({
    monaco,
    engine,
    session,
    displayName,
    shareLink: buildShareLink(base, session.roomId, session.token ?? ''),
    folder,
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
  let displayName: string;
  try {
    displayName = validateDisplayName(nameInput.value);
  } catch (error) {
    joinError.textContent = describe(error);
    return;
  }
  hosting = true;
  hostButton.disabled = true;
  hostButton.textContent = 'Opening…';
  try {
    const picked = await pickFolder(folderPicker);
    if (picked.kind === 'refused') {
      joinError.textContent = picked.sentence;
      return;
    }
    joinError.textContent = '';
    await host(picked.folder, displayName);
  } catch (error) {
    console.error(`[selvage] hosting failed (${describe(error)})`);
    joinError.textContent = describe(error);
  } finally {
    hosting = false;
    hostButton.disabled = false;
    hostButton.textContent = HOST_BUTTON_LABEL;
  }
}

/**
 * Reveals the host action, or the sentence that stands where it would be.
 *
 * Two facts decide it, and both are settled before any control is offered: this browser can hand
 * a page a folder, and this page's own origin answers `/meta` as a Selvage server. A page that
 * is not the server's own page — the page-only image in front of other servers, a bare `file://`
 * open, a static dev server — gets the sentence instead, because a room started there would
 * have no server to be seated on and its invite would point at an address the room does not
 * live at.
 */
async function offerHosting(): Promise<void> {
  if (linkIsTheInvite) {
    // A page opened with an invite is the join flow: one action, one click, and nothing added.
    return;
  }
  const picker = folderPicker !== undefined;
  const serverHere = picker && (await pageAnswersMeta());
  const availability = hostAvailability({ picker, serverHere });
  hostWrap.hidden = false;
  hostNote.textContent = availability.kind === 'offered' ? HOST_TAB_WARNING : availability.sentence;
  hostButton.hidden = availability.kind !== 'offered';
}

/** Whether this page's own origin answers `/meta`, for a wire version this client speaks. */
async function pageAnswersMeta(): Promise<boolean> {
  const base = sessionBase(serverBaseOf(window.location.href));
  if (base === undefined) {
    return false;
  }
  try {
    return metaAccepts(await fetchMeta(base));
  } catch {
    return false;
  }
}

/**
 * The server a failure message names before any attempt resolved one: this
 * page's own address read back as the server, which is where the room's link
 * would have pointed. A page that names no server of its own (a `file://`
 * page) yields none, and the diagnostic names none.
 */
function fallbackBase(): string {
  const page = sessionBase(serverBaseOf(window.location.href));
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

async function copyShareLink(): Promise<void> {
  // Every attempt starts from the bar's rest state: a fallback that failed may have
  // left the whole link in the readout, and the abbreviation is what belongs there
  // once a copy — by either route — has worked. On a narrow bar this is also what
  // puts the readout back behind its label.
  shareGroup.classList.remove('hand-copy');
  showDisplay({ readout: shareInput, shown: shareDisplay, fit: (value) => fitReadout(shareInput, value) });
  try {
    if (navigator.clipboard === undefined) {
      throw new Error('no clipboard');
    }
    await navigator.clipboard.writeText(fullShareLink);
  } catch {
    // The fallback copies from the field, so it fields the whole link while the
    // browser's own copy command runs, and the abbreviated display comes back once
    // that worked. A copy that failed leaves the whole link where the person can
    // select it: the abbreviation is a paint, and what it would leave behind is a
    // link no room answers.
    shareInput.focus();
    const done = handCopy({
      readout: shareInput,
      full: fullShareLink,
      shown: shareDisplay,
      exec: () => document.execCommand('copy'),
      fit: (value) => fitReadout(shareInput, value),
    });
    if (!done) {
      // The bar hides the readout on a narrow screen, where the label stands in
      // for it; a copy that failed needs the field itself, because that is the
      // only thing the person has left to select.
      shareGroup.classList.add('hand-copy');
      failureAlert.show('Select the link and copy it by hand.');
      return;
    }
  }
  // The bar's brief morph is the whole confirmation: nothing is announced.
  shareBox.confirm();
}

/**
 * Who is here: the own name first, then one row per peer. Where someone is
 * reads on the grant tree, not here; the follow banner owns the one stop.
 */
function syncRoster(participants: Participant[]): void {
  renderRoster(rosterList, participants, {
    followedPeerId: binding?.following()?.peerId,
    selfName,
    selfColour: engine === undefined ? undefined : peerColour(engine.session().peer.peer_id),
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
 * way in (`linkIsTheInvite`): the paste box is what gets anyone back.
 */
function leaveSession(sentence: string): void {
  if (binding === undefined) {
    // No live session: a notice that arrives twice, or before anything joined,
    // has nothing to leave. The card is already the card.
    return;
  }
  dropSession({ linkGuard, binding, editor: editorApi, engine });
  // Monaco takes its own DOM with it; anything it leaves behind must not sit in
  // the host when the next session builds another editor there.
  editorHost.replaceChildren();
  linkGuard = undefined;
  binding = undefined;
  engine = undefined;
  editorApi = undefined;
  desktopEditorOptions = undefined;
  opening = undefined;
  renderedPath = undefined;
  tree = undefined;
  openDirs.clear();
  fullShareLink = '';
  shareDisplay = '';
  shareGroup.classList.remove('hand-copy');
  shareInput.value = '';
  shareInput.title = '';
  rosterList.replaceChildren();
  treePane.replaceChildren();
  followBanner.replaceChildren();
  followBanner.hidden = true;
  sessionNote.hide();
  peek.dismiss();
  sessionBar.hidden = true;
  workspacePane.hidden = true;
  linkIsTheInvite = false;
  // The room this tab was hosting is over cleanly, so the next load has nothing to explain.
  clearHostingMark(window.sessionStorage);
  syncDownload();
  showRejoinCard(
    {
      join: joinPane,
      preview: previewPane,
      veil: veilPane,
      message: joinMessage,
      error: joinError,
      inviteWrap,
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
    case 'hostBack':
      sessionNote.say(hostBackSentence(notice.name), HOST_BACK_STAND_MS);
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
