import { SelvageEngine, sessionUrl } from '../engine/index.ts';
import type { SessionInfo } from '../engine/index.ts';
import { MonacoBinding } from './editor.ts';
import type { BindingNotice, Following, Participant } from './editor.ts';
import { buildShareLink, pageQueryParams, persistJoinUrl } from './share.ts';
import type { monaco as monacoApi } from './monaco.ts';
import {
  createJoinGate,
  initJoinCard,
  joinOnEnter,
  resolveJoin,
  saveDisplayName,
  validateDisplayName,
} from './join.ts';
import type { JoinTarget } from './join.ts';
import type { GuardableOpenerService } from './links.ts';
import { registerLinkGuard } from './links.ts';
import { dirOpen } from './tree-state.ts';
import { fileIcon, iconSpan, iconSvg, labelSpan } from './icons.ts';
import { initials } from './presence.ts';
import { renderRoster } from './roster.ts';
import { describeJoinErrorForDisplay, joinFailureDetail, nativeWebSocketFactory } from './transport.ts';
import { defaultServerForPage, schemeMatchBase } from './servers.ts';

(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
  getWorkerUrl: (_moduleId: string, label: string) =>
    label === 'typescript' || label === 'javascript' ? 'ts.worker.js' : 'editor.worker.js',
};

const DEFAULT_SERVER = 'ws://100.64.0.3:8080';

/** The page's own scheme: an https page speaks TLS to the server, always. */
const pageProtocol = window.location.protocol;
/** The default room for this page: the TLS proxy over https, plaintext otherwise. */
const pageDefaultServer = defaultServerForPage(pageProtocol, DEFAULT_SERVER);

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
          { token: 'comment', foreground: '7f849c' },
          { token: 'keyword', foreground: 'cba6f7' },
          { token: 'string', foreground: 'a6e3a1' },
          { token: 'number', foreground: 'fab387' },
          { token: 'type', foreground: 'f9e2af' },
        ],
        colors: {
          'editor.background': '#1e1e2e',
          'editor.foreground': '#cdd6f4',
          'editor.lineHighlightBackground': '#31324466',
          'editorLineNumber.foreground': '#6c7086',
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
      throw new Error('the editor code failed to load — reload the page and retry');
    }
  }
  return monacoReady;
}

const joinPane = document.getElementById('join') as HTMLElement;
const previewPane = document.getElementById('preview') as HTMLElement;
const veilPane = document.getElementById('veil') as HTMLElement;
const joinForm = document.getElementById('join-form') as HTMLFormElement;
const joinRoomline = document.getElementById('join-roomline') as HTMLElement;
const inviteWrap = document.getElementById('invite-wrap') as HTMLElement;
const inviteInput = document.getElementById('invite') as HTMLInputElement;
const nameInput = document.getElementById('name') as HTMLInputElement;
const joinButton = document.getElementById('join-button') as HTMLButtonElement;
const joinError = document.getElementById('join-error') as HTMLElement;
const sessionBar = document.getElementById('session') as HTMLElement;
const statusLabel = document.getElementById('status') as HTMLElement;
const shareInput = document.getElementById('share') as HTMLInputElement;
const copyButton = document.getElementById('copy-share') as HTMLButtonElement;
const workspacePane = document.getElementById('workspace') as HTMLElement;
const editorHost = document.getElementById('editor') as HTMLElement;
const rosterList = document.getElementById('roster') as HTMLElement;
const treePane = document.getElementById('tree') as HTMLElement;
const followBanner = document.getElementById('follow-banner') as HTMLElement;

const params = pageQueryParams(window.location.search);
const linkRoom = (params.get('room') ?? '').trim();
const linkToken = (params.get('token') ?? '').trim();
// A share link carries the room and its token, so the card asks one thing —
// the name — behind a plain invite line that names no id. A bare page open
// shows the paste box instead; the link stays the whole guest flow either way.
const linkMode = linkRoom !== '' && linkToken !== '';
// The card shell is inline HTML, so it paints before this bundle arrives: wire
// only the variant the address bar calls for, prefill only an untouched name
// field, and land focus past first paint without stealing a typed-into field.
const focusTarget = initJoinCard({ joinRoomline, inviteWrap, inviteInput, nameInput }, params, window.localStorage);
settleFocusWhenReady(focusTarget === 'name' ? nameInput : inviteInput);

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
let opening: string | undefined;
/** The server the last join attempt reached for, for the unreachable-server copy. */
let lastBase = '';
/** The joined display name, for the roster's self row. */
let selfName = '';
/** The tree's guest-pinned directories, kept across re-renders. */
const openDirs = new Set<string>();
/** The path the tree last highlighted, so landings re-render it. */
let renderedPath: string | undefined;
/** A dropped socket with no room event since: the next one means reseated. */
let linkDown = false;

joinForm.addEventListener('submit', (event) => {
  event.preventDefault();
  attemptJoin();
});

// Enter joins from any card field without relying on implicit submission:
// the keydown default is prevented, so no second submit follows it.
joinForm.addEventListener('keydown', (event) => {
  joinOnEnter(event, attemptJoin);
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
// held it) still joins now, once, instead of dying silently.
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
      figured: resolveJoin(params, linkMode ? '' : inviteInput.value, pageDefaultServer),
    };
  } catch (error: unknown) {
    const base = fallbackBase();
    console.error(`[selvage] join failed (${joinFailureDetail(error, base)})`);
    joinError.textContent = describeJoinErrorForDisplay(error, base, params.get('debug') === '1');
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
    // A held early submit disables the button for feedback (see the inline
    // guard): a refused join hands the card back, so the guest can retry.
    joinGate.release();
    joinButton.disabled = false;
    joinButton.textContent = 'Join';
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
  // The editor stack loads on join, never before: the card is interactive
  // while the megabytes it needs are still arriving. A stack that never
  // arrives throws before the button disables, so the card keeps its copy
  // and the guest can retry.
  const monaco = await ensureMonaco();
  // Shared text may name links the page must never follow: a `file:` target
  // would drive the page itself at `file:///...`. The guard swallows
  // everything but web and mail links before the default opener runs.
  const services = await import('./monaco.ts');
  registerLinkGuard(services.StandaloneServices.get<GuardableOpenerService>(services.IOpenerService));
  // The default `/meta` check runs: same-origin it reads the version, and where
  // the page is cross-origin the read fails like any unreachable endpoint —
  // advisory, never a refusal — while the handshake negotiates the truth.
  // The button stays `Joining…` throughout: attemptJoin owns it, and the gate
  // makes a second submit while this runs a duplicate, never a second join.
  engine = await SelvageEngine.join(invite, displayName, {
    webSocketFactory: nativeWebSocketFactory,
    client: 'web_client/0.1.0',
  });
  const session = engine.session();
  selfName = displayName;
  shareInput.value = buildShareLink(
    window.location.origin,
    window.location.pathname,
    figured.room,
    figured.token,
    base,
    pageDefaultServer,
  );
  joinPane.hidden = true;
  previewPane.hidden = true;
  veilPane.hidden = true;
  sessionBar.hidden = false;
  workspacePane.hidden = false;

  const editor = monaco.editor.create(editorHost, {
    automaticLayout: true,
    glyphMargin: true,
    minimap: { enabled: true, side: 'right' },
    theme: 'selvage-mocha',
  });
  binding = new MonacoBinding({
    engine,
    editor,
    onNotice: (notice: BindingNotice) => onNotice(notice),
    createModel: (text: string, language: string) => monaco.editor.createModel(text, language),
  });
  syncRoster(binding.participants());
  syncGrant();
  await openFirst(session);
  // The first file opens focused: typing starts at once, no click-to-type.
  editor.focus();
  // A typed room/token join lands in the address bar, so a reload rejoins
  // from it instead of losing what was typed. Same-origin only; elsewhere
  // the link stays in the session bar.
  try {
    persistJoinUrl(window.history, shareInput.value);
  } catch {
    // Leave the address bar alone.
  }
  // The joined name is the prefill next time: localStorage only, never the wire.
  saveDisplayName(window.localStorage, displayName);
  // A name already in the room is allowed in, with its row told apart.
  if (binding.participants().some((peer) => peer.displayName === displayName)) {
    setStatus(`${statusLabel.textContent} — '${displayName}' is already here, so your row carries a short id`);
  }
}

/** The server a failure message names before any attempt resolved one. */
function fallbackBase(): string {
  const raw = (params.get('server') ?? '').trim() || pageDefaultServer;
  return schemeMatchBase(raw, pageProtocol);
}

async function openFirst(session: SessionInfo): Promise<void> {
  const first = session.documents.slice().sort()[0];
  if (first !== undefined) {
    await openPath(first);
  } else {
    setStatus('joined — waiting for the room to name a document');
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
    // A listed path nobody published reads empty like a cleared file; the
    // advisory tells the two apart. A plain open says nothing — the tree
    // highlight and the buffer already name the file.
    if (binding.isUnpublished(path)) {
      setStatus(`${path} — the host hasn't shared its text yet`);
    }
  } catch (error) {
    setStatus(`could not open ${path}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (opening === path) {
      opening = undefined;
    }
  }
}

/** Copies the guest link: the clipboard where it exists, a selection otherwise. */
copyButton.addEventListener('click', () => {
  void copyShareLink();
});

/** A copy the icon button confirms itself: check glyph, then back. */
let copyConfirm: ReturnType<typeof setTimeout> | undefined;

function confirmCopied(): void {
  const glyph = copyButton.querySelector('.icon');
  if (glyph === null) {
    return;
  }
  glyph.innerHTML = iconSvg('check');
  copyButton.classList.add('copied');
  if (copyConfirm !== undefined) {
    clearTimeout(copyConfirm);
  }
  copyConfirm = setTimeout(() => {
    glyph.innerHTML = iconSvg('link');
    copyButton.classList.remove('copied');
    copyConfirm = undefined;
  }, 1500);
}

async function copyShareLink(): Promise<void> {
  try {
    if (navigator.clipboard === undefined) {
      throw new Error('no clipboard');
    }
    await navigator.clipboard.writeText(shareInput.value);
  } catch {
    shareInput.focus();
    shareInput.select();
    let done = false;
    try {
      done = document.execCommand('copy');
    } catch {
      done = false;
    }
    if (!done) {
      setStatus('select the link and copy it by hand');
      return;
    }
  }
  confirmCopied();
  setStatus('invite link copied — anyone holding it joins while the room lives');
}

/**
 * Who is here: the own name first, then one row per peer. Where someone is
 * reads on the grant tree, not here; the follow banner owns the one stop.
 */
function syncRoster(participants: Participant[]): void {
  renderRoster(rosterList, participants, {
    followedPeerId: binding?.following()?.peerId,
    selfName,
    onGoTo: (peerId) => {
      const participant = participants.find((candidate) => candidate.peerId === peerId);
      void binding?.goTo(peerId).catch((error: unknown) => {
        setStatus(`could not go to ${participant?.displayName ?? peerId}: ${describe(error)}`);
      });
    },
    onFollow: (peerId) => {
      const participant = participants.find((candidate) => candidate.peerId === peerId);
      void binding?.follow(peerId).catch((error: unknown) => {
        setStatus(`could not follow ${participant?.displayName ?? peerId}: ${describe(error)}`);
      });
    },
  });
}

/** The room's listing as a tree. Directories open and shut; files open and fetch. */
function syncGrant(): void {
  if (binding === undefined) {
    return;
  }
  treePane.replaceChildren();
  const listing = binding.grantListing();
  if (listing.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'the room shares no listing yet';
    treePane.appendChild(empty);
    return;
  }
  const presence = new Map<string, Participant[]>();
  for (const participant of binding.participants()) {
    if (participant.path !== undefined) {
      const known = presence.get(participant.path) ?? [];
      known.push(participant);
      presence.set(participant.path, known);
    }
  }
  treePane.appendChild(treeLevel(binding, '', 0, presence));
}

/**
 * Who is in one file, as initials badges in peer colours: where someone is
 * reads here, glanceable, instead of path text under roster names.
 */
function presenceBadges(present: readonly Participant[]): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'presence';
  for (const participant of present) {
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.style.backgroundColor = participant.colour;
    badge.textContent = initials(participant.displayName);
    badge.title = participant.displayName;
    wrap.appendChild(badge);
  }
  return wrap;
}

function treeLevel(
  owner: MonacoBinding,
  directory: string,
  depth: number,
  presence: ReadonlyMap<string, readonly Participant[]>,
): HTMLElement {
  const list = document.createElement('ul');
  if (depth === 0) {
    list.style.paddingLeft = '0';
  }
  const current = owner.currentPath();
  for (const child of owner.grantTree(directory)) {
    const item = document.createElement('li');
    if (child.directory) {
      const details = document.createElement('details');
      details.dataset.dir = child.path;
      // Openness is the guest's pin, or an ancestor of the open file — never
      // the open file alone, so re-renders keep folders as left.
      details.open = dirOpen(child.path, openDirs, current);
      // Untrusted toggles are the render above, not the guest: only the
      // guest's own opening and shutting pins a directory.
      details.addEventListener('toggle', (event) => {
        if (!event.isTrusted) {
          return;
        }
        if (details.open) {
          openDirs.add(child.path);
        } else {
          openDirs.delete(child.path);
        }
      });
      const head = document.createElement('summary');
      head.append(iconSpan('chevron'), iconSpan('folder'), labelSpan(child.name));
      details.appendChild(head);
      details.appendChild(treeLevel(owner, child.path, depth + 1, presence));
      item.appendChild(details);
    } else {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'row';
      row.append(iconSpan(fileIcon(child.path)), labelSpan(child.name));
      row.append(presenceBadges(presence.get(child.path) ?? []));
      if (child.path === current) {
        row.classList.add('open');
      }
      row.addEventListener('click', () => {
        // Opening a file is a deliberate navigation, the same class as
        // typing or going to someone: the follow ends instead of landing
        // back over the file just opened.
        binding?.stopFollowing();
        void openPath(child.path);
      });
      item.appendChild(row);
    }
    list.appendChild(item);
  }
  return list;
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

function onNotice(notice: BindingNotice): void {
  // A landing moves the current path outside openPath: the tree highlight
  // follows it here, on every notice kind, so go-to and follow re-lands
  // mark the row the editor shows.
  syncTreeIfMoved();
  switch (notice.kind) {
    case 'documents':
      reseated();
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
      reseated();
      if (binding !== undefined) {
        syncRoster(binding.participants());
        // Where someone is reads on the tree, so presence moves re-render it.
        syncGrant();
      }
      break;
    case 'roster':
      reseated();
      syncRoster(notice.participants);
      // Where someone is reads on the tree, so presence moves re-render it.
      syncGrant();
      break;
    case 'grant':
      reseated();
      syncGrant();
      break;
    case 'follow':
      syncFollow(notice.following);
      break;
    case 'status':
      setStatus(notice.text);
      linkDown = notice.text.startsWith('connection dropped');
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

/**
 * The first room event after a drop arrives on the reseated socket, so it
 * retires the reconnecting status: even when the re-hello wins the race and
 * nobody saw the drop, the room still says it reconnected.
 */
function reseated(): void {
  if (!linkDown || binding === undefined) {
    return;
  }
  linkDown = false;
  const current = binding.currentPath();
  setStatus(
    current === undefined
      ? 'reconnected — waiting for the room to name a document'
      : 'reconnected',
  );
}

function setStatus(text: string): void {
  statusLabel.textContent = text;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}



window.addEventListener('beforeunload', () => {
  binding?.dispose();
  void engine?.disconnect();
});
