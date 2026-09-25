import type * as monaco from 'monaco-editor';

import { SessionBridge } from '../bridge/index.ts';
import type { Cursor, EditorHost, GrantedRead, LineEnding, Report, TextChange } from '../bridge/index.ts';
import { grantUnion, peerColour, realTimers } from '../bridge/index.ts';
import type { GrantRefusal, Timers } from '../bridge/index.ts';
import type { FolderWork } from './folder.ts';
import { grantLevels } from './tree.ts';
import type { GrantChild } from './tree.ts';
import type { Role } from '../engine/index.ts';
import type { RoomEngine } from './relay.ts';
import { roomGoneMessage } from './ended.ts';
import { languageForPath } from './languages.ts';
import { badgeCss, initials, onePerLine } from './presence.ts';

/**
 * A room-supplied string as literal markdown text.
 *
 * A decoration's `hoverMessage` is markdown, and every peer name in it comes
 * from the room: a host named `![](http://…/l.png)` — 32 characters, so the
 * protocol's own display-name bound admits it — would otherwise make each
 * guest's browser fetch that URL the moment they hovered its caret. Every
 * ASCII punctuation character CommonMark may read as structure is escaped
 * here, so a name paints as the text it is and can build no link, image or
 * code span, while a name of letters (the common case) is untouched.
 */
export function literalMarkdown(text: string): string {
  return text.replace(/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/g, '\\$&');
}

/** What the binding reports to the page, in the page's own vocabulary. */
export type BindingNotice =
  | { kind: 'documents'; documents: string[] }
  | { kind: 'peers'; count: number; names: string[] }
  | { kind: 'roster'; participants: Participant[] }
  | { kind: 'grant'; paths: string[] }
  /**
   * The follow as it stands. `ended` is the reason a follow the person did *not* stop has just
   * gone — the follow bar's own words, since the state it described has left the screen and nothing
   * else says why.
   */
  | { kind: 'follow'; following: Following | undefined; ended?: string }
  | { kind: 'roomGone'; reason: string }
  /** The host's socket detached and the grace window is running, in milliseconds. */
  | { kind: 'grace'; graceMs: number }
  /** The host came back inside the grace; the name is the room's, and may be blank. */
  | { kind: 'hostBack'; name: string }
  | { kind: 'disconnected' }
  /**
   * The socket dropped mid-session and the engine's bounded retry is re-dialling it (`§9.1`). Its
   * own notice rather than a `status` line, because it is the one transient that stands until the
   * room answers: a retry runs for as long as the room's advertised grace, and a page that said
   * nothing through it would look healthy while nothing typed could reach the room.
   */
  | { kind: 'reconnecting' }
  | { kind: 'status'; text: string; topic: StatusTopic; peerId?: string }
  /**
   * Something the person asked for did not happen, and the sentence says why: a write the
   * stale-file guard refused, or a path this host could not read out of its own folder. When the
   * failure is about one path (`path`), the page marks that path's row with it rather than showing a
   * sentence that comes and goes while the file on disk stays behind the room; a failure with no
   * path to sit on is the alert's.
   */
  | { kind: 'failure'; text: string; path?: string }
  /** A write to `path` landed, so the mark a refusal left on its row goes. */
  | { kind: 'saved'; path: string };

/**
 * What a status sentence is about. The binding raises all of them; the page decides which ones it
 * shows, because a sentence whose fact is already on screen — under a control, in the roster, or
 * as the card that came back — is a second reading of the same thing rather than news.
 *
 * - `role`: this connection is a `viewer` (`§13.9`), so its documents take no edit. The editor is
 *   read-only and nothing else on the page says why.
 * - `refusal`: a go-to the room could not answer. The click had no other answer, and the sentence
 *   is carried with the peer it is about (`peerId`) so the page can put it under that row.
 * - `follow`: a follow landing and the end of a follow. The follow banner names who and offers
 *   Stop, the tree and the buffer show where, and the roster shows who left.
 * - `error`: what the room said about the session itself. Nothing else carries it.
 * - `terminal`: the room is over. The card comes back with the room's own sentence.
 */
export type StatusTopic = 'role' | 'refusal' | 'follow' | 'error' | 'terminal';

/** Another participant, as the roster draws one row. */
export interface Participant {
  peerId: string;
  displayName: string;
  role: Role;
  /** The peer's colour: the same mapping the caret wears, so rows and carets agree. */
  colour: string;
  /** The room path the peer is in, when it has one open. */
  path: string | undefined;
}

/** Who this window follows, for the indicator. */
export interface Following {
  peerId: string;
  name: string;
  colour: string;
}

/**
 * How long a caret event waits before its position reaches the room. Monaco reports a
 * selection change for every keystroke of its own, and each one would otherwise cost a
 * read of the whole buffer and a presence frame; a burst — typing, a held arrow key, a
 * drag — becomes one of each instead. The desktop adapters coalesce on this same
 * interval, so a peer sees a caret move after the same delay whichever client sent it.
 */
export const SELECTION_INTERVAL_MS = 100;

export interface BindingOptions {
  /**
   * The room this binding drives. `RoomEngine` is what it asks of the engine, and `relay.ts` is
   * where the page's own socket and crypto are wired into it.
   */
  engine: RoomEngine;
  editor: monaco.editor.IStandaloneCodeEditor;
  onNotice: (notice: BindingNotice) => void;
  /**
   * Builds the buffer for a room path. Injected so this module never imports the
   * Monaco runtime — only its types — and the session logic stays importable
   * without a DOM. The page passes `monaco.editor.createModel`.
   */
  createModel: (text: string, language: string) => monaco.editor.ITextModel;
  /**
   * The folder this window was handed, when it was: the page's host half. A guest has none, so
   * its `save` stays a no-op and its reads stay refusals.
   */
  folder?: FolderWork;
  /** The clock the caret interval runs on; real timers unless a test drives its own. */
  timers?: Timers;
}

/**
 * A Monaco editor as the session bridge's host: remote text in, local edits out.
 *
 * Only this module knows about Monaco. Offsets are UTF-16 code units on both sides
 * (what `Y.Text` indices and Monaco's `getOffsetAt`/`getPositionAt` both count), so
 * no conversion sits between the room and the buffer.
 */
export class MonacoBinding implements EditorHost {
  readonly bridge: SessionBridge;

  private readonly engine: RoomEngine;
  private readonly editor: monaco.editor.IStandaloneCodeEditor;
  private readonly onNotice: (notice: BindingNotice) => void;
  private readonly createModel: BindingOptions['createModel'];
  private readonly folder: FolderWork | undefined;
  private readonly models = new Map<string, monaco.editor.ITextModel>();
  private readonly stops: Array<() => void> = [];
  private readonly colours = new Map<string, string>();
  private readonly badges = new Map<string, string>();
  private readonly cursors: monaco.editor.IEditorDecorationsCollection;
  private readonly style: HTMLStyleElement;
  /** The badge rules alone, so a cache restart can drop the rules it no longer names. */
  private readonly badgeStyle: HTMLStyleElement;
  private readonly stopEngine: () => void;
  private readonly timers: Timers;
  private applying = 0;
  /** A caret move whose position is waiting for the interval to pass. */
  private selectionDirty = false;
  private selectionTimer: (() => void) | undefined;
  /** The carets the last frame drew, for a tap (`peerAt`). */
  private drawn: Cursor[] = [];
  private path: string | undefined;
  private disposed = false;
  /** Paths handed to the bridge, whose hold and seed run once per showing. */
  private readonly fronted = new Set<string>();
  /** The peer this window follows, by id: a local view state, never advertised. */
  private followingPeerId: string | undefined;
  private followingName = '';
  /** A go-to whose document has not arrived yet: re-resolved on every room event. */
  private pendingGoTo: string | undefined;
  /** The room's listing and the tree derived from it, held until the set they come from moves. */
  private listing: string[] | undefined;
  private levels: Map<string, GrantChild[]> | undefined;
  /** The room-gone reason once the session has ended terminally, if it has. */
  private terminalReason: string | undefined;
  /** Whether this window has already been told it is a viewer (`§13.4`). */
  private viewerSaid = false;
  /** The read-only state the editor was last given, so a state that changes nothing is not sent. */
  private appliedReadOnly: boolean | undefined;
  /** Every landing stamps the cycle: a newer frame supersedes an older one still opening. */
  private landingCycle = 0;
  constructor(options: BindingOptions) {
    this.engine = options.engine;
    this.editor = options.editor;
    this.onNotice = options.onNotice;
    this.createModel = options.createModel;
    this.folder = options.folder;
    this.timers = options.timers ?? realTimers;
    this.cursors = this.editor.createDecorationsCollection([]);
    this.style = document.createElement('style');
    document.head.appendChild(this.style);
    this.badgeStyle = document.createElement('style');
    document.head.appendChild(this.badgeStyle);
    this.bridge = new SessionBridge({ engine: this.engine, host: this });
    // The selection events this binding's own remote apply raises are that apply's echo, and
    // nothing else can fire while it runs — no input is processed inside a synchronous
    // `pushEditOperations` — so they are not what the room is told. An interval a local move
    // already armed still flushes the position the caret holds when it runs.
    const selection = this.editor.onDidChangeCursorSelection(() => {
      if (this.applying === 0) {
        this.scheduleSelection();
      }
    });
    this.stops.push(() => selection.dispose());
    // The follow and the pending go-to re-resolve on every room event: a caret move
    // and a document arrival both land, and membership changes refresh the roster.
    this.stopEngine = this.engine.on((event) => {
      // The role is re-read on every event: a room state can change this connection's own role
      // without moving the roster or the listing, and neither of those is where this window's
      // role is read from. `applyEditability` skips a state that changes nothing.
      this.roomRole();
      switch (event.type) {
        case 'presenceChanged':
          this.refreshRoster();
          this.backgroundTick();
          break;
        case 'peersChanged':
          this.refreshRoster();
          this.backgroundTick();
          break;
        case 'documentChanged':
          this.backgroundTick();
          this.renderCursors(this.bridge.cursors());
          break;
        case 'documentsChanged':
          // The listing is the grant unioned with the open documents, so a
          // changed set re-renders the tree even when the grant itself is quiet.
          this.forgetListing();
          this.onNotice({ kind: 'grant', paths: this.grantListing() });
          this.backgroundTick();
          break;
        case 'grantChanged':
          this.forgetListing();
          this.onNotice({ kind: 'grant', paths: this.grantListing() });
          break;
        default:
          break;
      }
    });
    this.applyEditability();
  }

  /**
   * A frame-driven re-landing: the socket may have dropped — the in-flight open
   * then rejects — and the next frame retries regardless, so failures stay here
   * rather than escaping as unhandled rejections. Explicit `follow`/`goTo` calls
   * still report to their caller.
   */
  private backgroundTick(): void {
    void this.followTick().catch(() => undefined);
    if (this.pendingGoTo !== undefined && this.followingPeerId === undefined) {
      void this.retryGoTo().catch(() => undefined);
    }
  }

  /** The room path currently in front of the editor, if any. */
  currentPath(): string | undefined {
    return this.path;
  }

  /**
   * Puts a room path in front of the editor: asks the room for it on first
   * open, builds the model from the replica, and hands it to the bridge.
   * Re-showing a path already held and fronted touches no wire: a landing that
   * re-opened on every frame would answer its own open with the room event
   * that supersedes it, and follow could never land.
   */
  /** Whether the room is over: the roster is empty, the editor read-only. */
  isTerminal(): boolean {
    return this.terminalReason !== undefined;
  }

  async openDocument(path: string): Promise<void> {
    if (this.disposed) {
      return;
    }
    if (this.terminalReason !== undefined) {
      this.onNotice({ kind: 'status', topic: 'terminal', text: roomGoneMessage(this.terminalReason) });
      return;
    }
    if (this.fronted.has(path) && this.models.get(path)?.isDisposed() === false) {
      this.path = path;
      this.editor.setModel(this.models.get(path) ?? null);
      this.applyEditability();
      this.scheduleSelection();
      this.renderCursors(this.bridge.cursors());
      return;
    }
    if (!this.engine.openDocuments().includes(path)) {
      await this.engine.open(path);
    }
    let model = this.models.get(path);
    if (model === undefined || model.isDisposed()) {
      model = this.createModel(await this.initialText(path), languageForPath(path));
      this.models.set(path, model);
      const changed = model.onDidChangeContent(() => {
        if (this.applying === 0 && this.path === path) {
          // Past the end nothing reaches the room: a keystroke that slipped
          // through the read-only guard echoes the state instead of landing
          // silently in the local model.
          if (this.terminalReason !== undefined) {
            this.onNotice({ kind: 'status', topic: 'terminal', text: roomGoneMessage(this.terminalReason) });
            return;
          }
          // A local edit ends the follow: the caret has moved to the peer's
          // position, so typing on would have the next frame yank it back. A
          // remote apply runs with `applying` raised and never lands here.
          this.localEditEndsFollow();
          this.bridge.documentChanged(path);
        }
      });
      this.stops.push(() => changed.dispose());
    }
    this.path = path;
    this.editor.setModel(model);
    this.applyEditability();
    this.bridge.documentOpened(path);
    this.fronted.add(path);
    this.scheduleSelection();
    this.renderCursors(this.bridge.cursors());
  }

  closeDocument(path: string): void {
    this.bridge.documentClosed(path);
    this.fronted.delete(path);
    if (this.path === path) {
      this.path = undefined;
      this.editor.setModel(null);
      this.applyEditability();
    }
    this.models.get(path)?.dispose();
    this.models.delete(path);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.stopEngine();
    this.cancelSelection();
    this.drawn = [];
    this.followingPeerId = undefined;
    this.pendingGoTo = undefined;
    for (const stop of this.stops.splice(0)) {
      stop();
    }
    this.bridge.dispose();
    for (const model of this.models.values()) {
      model.dispose();
    }
    this.models.clear();
    this.style.remove();
    this.badgeStyle.remove();
  }

  // -- roster, grant tree, follow --------------------------------------------

  /**
   * The room's other participants, read at the moment it is asked for. A peer with
   * no document is still listed: its colour derives from its id, so there is
   * always a caret colour to look it up by.
   */
  participants(): Participant[] {
    // Past the end nobody is here: the roster clears instead of lingering
    // with live-looking actions.
    if (this.terminalReason !== undefined) {
      return [];
    }
    const paths = new Map<string, string>();
    for (const presence of this.engine.presence()) {
      const peer = presence.peer;
      const path = presence.state?.path;
      if (peer !== undefined && path !== undefined) {
        paths.set(peer.peer_id, path);
      }
    }
    return this.engine.peers().map((peer) => ({
      peerId: peer.peer_id,
      displayName: peer.display_name === '' ? peer.peer_id : peer.display_name,
      role: peer.role,
      colour: peerColour(peer.peer_id),
      path: paths.get(peer.peer_id),
    }));
  }

  /**
   * What the room offers: its grant, unioned with the documents it holds open, so
   * a server older than `doc.grant` still offers everything the room knows.
   *
   * Held until the set it comes from moves, which is a room event: the listing is read
   * once per render rather than once per directory the tree recurses into, and a tree
   * that is thousands of paths long is the difference between a scan and thousands of
   * them.
   */
  grantListing(): string[] {
    this.listing ??= grantUnion(this.engine.grantedPaths(), this.engine.documents());
    return this.listing;
  }

  /** The paths are read from the engine again after the next room event. */
  private forgetListing(): void {
    this.listing = undefined;
    this.levels = undefined;
  }

  /**
   * Whether a room path holds no published text: listed (or followed into)
   * but never sent by anyone, so its buffer starts empty. Empty is not the
   * same as unpublished — a file that arrived and was emptied reads `has` —
   * and the hold taken by the open brings the sync before it resolves, so
   * this is settled by the time the opener asks. `has` is the engine's
   * receipt and only that: reading a path's text does not fabricate a
   * document, so a window that has merely looked still reads unpublished.
   */
  isUnpublished(path: string): boolean {
    return !this.engine.has(path);
  }

  /**
   * Whether the room holds this path open, which is what puts a file's text in the room.
   *
   * The room's own document set, not this window's holds (`openDocuments`): the tree's `●` answers
   * *has this file's text left its folder?*, which is a fact about the room and not about the person
   * looking at it. Both roles receive the same report, so the dot means the same thing on both.
   */
  isOpenInRoom(path: string): boolean {
    return this.engine.documents().includes(path);
  }

  /** Whether this window holds the path's text, from the room's replica. */
  hasText(path: string): boolean {
    return this.engine.has(path);
  }

  /**
   * Whether the text this window can show for the path is empty.
   *
   * The buffer in front of the editor is what a person sees, so it answers first — a host that has
   * read a file off its own disk holds text the room has not received yet — and the replica behind
   * it answers otherwise.
   */
  isTextEmpty(path: string): boolean {
    const model = this.models.get(path);
    if (model !== undefined && !model.isDisposed()) {
      return model.getValue() === '';
    }
    return this.engine.has(path) && this.engine.text(path) === '';
  }

  /** The immediate children of `directory` in the listing, for one tree level. */
  grantTree(directory = ''): GrantChild[] {
    this.levels ??= grantLevels(this.grantListing());
    return this.levels.get(directory) ?? [];
  }

  /** Who this window follows, for the indicator. */
  following(): Following | undefined {
    if (this.followingPeerId === undefined) {
      return undefined;
    }
    return {
      peerId: this.followingPeerId,
      name: this.followingName,
      colour: peerColour(this.followingPeerId),
    };
  }

  /**
   * Go to a participant: land once where they are. A pending landing is a
   * one-shot follow: the hold taken by the open is what makes the room send the
   * text, so a document that has not arrived yet resolves again on every event.
   * A deliberate navigation stops following first, the same class as typing.
   */
  async goTo(peerId: string): Promise<void> {
    if (this.terminalReason !== undefined) {
      throw new Error(roomGoneMessage(this.terminalReason));
    }
    if (this.followingPeerId !== undefined) {
      this.clearFollow();
    }
    this.pendingGoTo = peerId;
    await this.retryGoTo();
  }

  private async retryGoTo(): Promise<void> {
    const peerId = this.pendingGoTo;
    if (peerId === undefined) {
      return;
    }
    const cycle = (this.landingCycle += 1);
    const valid = (): boolean => cycle === this.landingCycle && this.pendingGoTo === peerId;
    const outcome = await this.landOn(peerId, 'go', valid);
    if (outcome !== 'waiting' && this.pendingGoTo === peerId) {
      this.pendingGoTo = undefined;
    }
  }

  /**
   * Follow a participant: land where they are, and again on every frame. The
   * indicator goes up before the first landing — the target is known and a frame
   * is incoming, so immediate feedback beats silence.
   */
  async follow(peerId: string): Promise<void> {
    if (this.terminalReason !== undefined) {
      throw new Error(roomGoneMessage(this.terminalReason));
    }
    if (this.followingPeerId === peerId) {
      await this.followTick();
      return;
    }
    this.followingPeerId = peerId;
    this.followingName = this.displayLabel(peerId);
    this.pendingGoTo = undefined;
    this.onNotice({ kind: 'follow', following: this.following() });
    await this.followTick();
  }

  /** Stop following. The indicator going down is the whole announcement. */
  stopFollowing(): void {
    this.clearFollow();
  }

  /**
   * One landing on a peer's presence: open, resolve, place the caret and reveal
   * it. Never lands at offset zero for an anchor that does not resolve: without
   * the text that is a frame still to come, and with the text it is a refusal.
   */
  private async landOn(
    peerId: string,
    mode: 'go' | 'follow',
    valid: () => boolean,
  ): Promise<'landed' | 'waiting' | 'refused' | 'gone'> {
    const record = this.engine.presence().find((candidate) => candidate.peer?.peer_id === peerId);
    if (record === undefined) {
      if (this.engine.peers().some((peer) => peer.peer_id === peerId)) {
        return 'waiting';
      }
      if (mode === 'go') {
        this.onNotice({
          kind: 'status',
          topic: 'refusal',
          peerId,
          text: `nothing to go to: ${this.displayLabel(peerId)} is not in a document`,
        });
        return 'refused';
      }
      return 'gone';
    }
    if (record.peer !== undefined && mode === 'follow') {
      this.followingName = peerName(record.peer.display_name, peerId);
    }
    const path = record.state?.path;
    if (path === undefined) {
      return 'waiting';
    }
    await this.openDocument(path);
    // A newer frame supersedes this one: placing now would land where the peer was.
    if (!valid()) {
      return 'waiting';
    }
    const selection = record.state?.selection;
    // A path without a selection is a caret still unknown — an empty document
    // publishes no anchors — and the next frame brings it.
    if (selection === undefined) {
      return 'waiting';
    }
    const resolved = this.engine.resolveSelection(path, selection);
    if (resolved === undefined) {
      if (!this.engine.has(path)) {
        return 'waiting';
      }
      if (mode === 'go') {
        this.onNotice({
          kind: 'status',
          topic: 'refusal',
          peerId,
          text: `nothing to go to: ${this.displayLabel(peerId)}'s caret does not resolve here`,
        });
      }
      return 'refused';
    }
    const model = this.models.get(path);
    const position = model?.getPositionAt(resolved.head);
    if (position !== undefined) {
      this.editor.setPosition({ lineNumber: position.lineNumber, column: position.column });
      this.editor.revealPositionInCenter({ lineNumber: position.lineNumber, column: position.column });
    }
    this.scheduleSelection();
    // A follow re-landing says who and where: the strip's own segment carries both, so a sentence
    // here would be the same fact in a second place.
    if (mode === 'follow') {
      this.onNotice({ kind: 'follow', following: this.following() });
    }
    return 'landed';
  }

  /** The follow's every frame: re-read presence and land again. */
  private async followTick(): Promise<void> {
    const peerId = this.followingPeerId;
    if (peerId === undefined) {
      return;
    }
    const cycle = (this.landingCycle += 1);
    const valid = (): boolean => cycle === this.landingCycle && this.followingPeerId === peerId;
    const outcome = await this.landOn(peerId, 'follow', valid);
    if (outcome === 'gone' && this.followingPeerId === peerId) {
      const name = this.followingName;
      this.clearFollow();
      this.onNotice({ kind: 'follow', following: undefined, ended: `${name} left the room, so following stopped.` });
    }
  }

  private localEditEndsFollow(): void {
    if (this.followingPeerId === undefined) {
      return;
    }
    const name = this.followingName;
    this.clearFollow();
    this.onNotice({ kind: 'follow', following: undefined, ended: `Stopped following ${name} — you moved.` });
  }

  private clearFollow(): void {
    this.followingPeerId = undefined;
    this.onNotice({ kind: 'follow', following: undefined });
  }

  private refreshRoster(): void {
    this.onNotice({ kind: 'roster', participants: this.participants() });
  }

  /**
   * Enters the terminal state: the follow and any pending landing end, the
   * editor goes read-only so keystrokes never land silently, and the page
   * learns the room is over as its own notice — ahead of the `disconnected`
   * that follows, so the resting state keeps the reason.
   */
  private enterTerminal(reason: string): void {
    if (this.terminalReason !== undefined) {
      return;
    }
    this.terminalReason = reason;
    this.pendingGoTo = undefined;
    this.landingCycle += 1;
    if (this.followingPeerId !== undefined) {
      this.clearFollow();
    }
    this.applyEditability();
    this.onNotice({ kind: 'roomGone', reason });
  }

  /**
   * The role the room's state gives this connection (`§13.4`), read on every event.
   *
   * A room seats a connection as `viewer` and never as anything else: `§13.9` has a
   * viewer keep its own edit and publish none of it, so a buffer that accepted a keystroke would
   * show text the room never receives, and the sentence is said once rather than on every state
   * that arrives. It is read here rather than at the events that name a roster or a listing,
   * because this connection's own role is in neither: a state can relabel it and move nothing
   * else.
   */
  private roomRole(): void {
    this.applyEditability();
    if (this.engine.session().role === 'viewer' && !this.viewerSaid) {
      this.viewerSaid = true;
      this.onNotice({
        kind: 'status',
        topic: 'role',
        text: 'you are a viewer in this room, so its documents are read-only.',
      });
    }
  }

  /**
   * The editor accepts text only while a room document is in front of it: an
   * editor with no document bound to the room is a buffer in no document at all,
   * and anything typed there is a ghost — nothing publishes it and no peer sees
   * it, while it looks like a file. A room that shares no document therefore
   * opens nothing and stays read-only until a document arrives (`openDocument`);
   * closing the last one locks it again and the room being over locks it for
   * good. A `selvage/2` room's `viewer` is the room's own word on top of that:
   * nothing it types is published either (§13.9). No sentence is coined for the
   * document case: Monaco answers the attempt itself (`Cannot edit in read-only
   * editor`) and the grant tree already reads `The host has not shared any files
   * yet.` when the room offers nothing.
   */
  private applyEditability(): void {
    const readOnly =
      this.terminalReason !== undefined ||
      this.path === undefined ||
      this.engine.session().role === 'viewer';
    if (readOnly === this.appliedReadOnly) {
      return;
    }
    this.appliedReadOnly = readOnly;
    const options = this.editor as unknown as { updateOptions?: (next: { readOnly: boolean }) => void };
    options.updateOptions?.({ readOnly });
  }

  /**
   * The text a document starts with.
   *
   * The room's own text when the room has any for the path — a path the room already holds is
   * the room's, and this window does not put its disk copy over an edit a peer made
   * (`seed`'s rule in the bridge, read here rather than after the fact). When the room holds
   * nothing and this window is the host, the file is read out of the folder *now*, because the
   * open is the host's own click and the disk is the source of truth: `engine.text` is empty
   * for a path nobody has published, and a model built from it would leave the host looking at
   * an empty buffer for a file it can plainly see. The text then reaches the replica through
   * the bridge's ordinary `documentOpened` seed. A refusal is said out loud and the buffer
   * starts empty, which is what a listing the host cannot serve looks like.
   */
  private async initialText(path: string): Promise<string> {
    if (this.folder === undefined || this.bridge.role() !== 'host' || this.engine.has(path)) {
      return this.engine.text(path);
    }
    const read = await this.folder.read(path);
    if (read.kind === 'text') {
      return read.text;
    }
    this.onNotice({ kind: 'failure', text: hostReadSentence(read.cause, path) });
    return this.engine.text(path);
  }

  /**
   * Asks the room for a path's text without putting it in front of the editor.
   *
   * This is the engine's own `open`, the same call opening a file makes, and it is the only way a
   * room sends text: there is no read-only fetch in the protocol, and a second mechanism would be a
   * second thing to keep true (`§6.3`, `§12`). What it does not do is build a model or change what
   * the editor shows, so a download of a file the person is not looking at leaves the buffer where
   * it was.
   */
  async requestText(path: string): Promise<void> {
    if (this.terminalReason !== undefined) {
      throw new Error(roomGoneMessage(this.terminalReason));
    }
    await this.engine.open(path);
  }

  /** The name a sentence says: the room's, or the id when the room left it blank. */
  private displayLabel(peerId: string): string {
    const peer = this.engine.peers().find((candidate) => candidate.peer_id === peerId);
    const display =
      peer?.display_name ??
      this.engine.presence().find((record) => record.peer?.peer_id === peerId)?.peer?.display_name ??
      '';
    return peerName(display, peerId);
  }

  // -- EditorHost ----------------------------------------------------------

  text(path: string): string | undefined {
    return this.models.get(path)?.getValue();
  }

  lineEnding(path: string): LineEnding {
    return this.models.get(path)?.getEOL() === '\r\n' ? '\r\n' : '\n';
  }

  async applyChange(path: string, change: TextChange): Promise<boolean> {
    const model = this.models.get(path);
    if (model === undefined || model.isDisposed()) {
      return false;
    }
    const range = toRange(model, change.start, change.end);
    this.applying += 1;
    try {
      model.pushEditOperations(
        [],
        [{ range, text: change.text, forceMoveMarkers: true }],
        () => null,
      );
    } finally {
      this.applying -= 1;
    }
    return true;
  }

  async save(path: string): Promise<boolean> {
    const model = this.models.get(path);
    if (this.folder === undefined || model === undefined || model.isDisposed()) {
      // A guest's save is a no-op: its document is virtual and there is no file to write. So is
      // a host's for a path it does not hold — nothing here knows the text to write.
      return true;
    }
    const outcome = await this.folder.write(path, model.getValue());
    if (outcome.kind === 'refused') {
      // Thrown rather than `false`, so the sentence reaches the person: the bridge reports a
      // rejected save with the reason it was given, and a bare `false` would arrive as a
      // verb-less notice (`write` in the bridge).
      throw new Error(outcome.sentence);
    }
    this.onNotice({ kind: 'saved', path });
    return true;
  }

  /**
   * Reads a file out of the folder this window was handed, for a path the room asked for.
   *
   * The path came from a peer and is not trusted, so the folder's own read applies the shared
   * grant rule before it resolves anything, and this window's answer is the text or the reason
   * there is none. A window with no folder shares nothing and says so in the cause that carries
   * no sentence: the guest role never serves a path.
   */
  async readGrantedFile(path: string): Promise<GrantedRead> {
    if (this.folder === undefined) {
      return { kind: 'refused', cause: 'not-granted' };
    }
    return this.folder.read(path);
  }

  /**
   * The peer whose caret sits at `offset` in the showing document, or whose
   * selection covers it — the peer the guest has just put a finger on.
   *
   * A pointer device reads a peer's `label · role` from the caret decoration's
   * hover; a finger has no hover and a native tooltip never paints on touch, so
   * the page taps that decoration and says the same line (`main.ts`). The exact
   * position is tried first, because a tap lands on a character, and a peer's
   * selection second, so a tap inside their fill names them too.
   *
   * The path is read here rather than trusted from the frame: opening a document
   * changes `path` and the model in one step, and the room's next frame — the one
   * that re-draws the carets — arrives later. An offset into the new buffer must
   * never be answered with the previous document's carets.
   */
  peerAt(offset: number): Cursor | undefined {
    if (this.disposed) {
      return undefined;
    }
    const here = this.drawn.filter((cursor) => cursor.path === this.path);
    const exact = here.find((cursor) => cursor.head === offset);
    if (exact !== undefined) {
      return exact;
    }
    return here.find(
      (cursor) =>
        cursor.anchor !== cursor.head &&
        offset >= Math.min(cursor.anchor, cursor.head) &&
        offset <= Math.max(cursor.anchor, cursor.head),
    );
  }

  renderCursors(cursors: Cursor[]): void {
    const model = this.path === undefined ? undefined : this.models.get(this.path);
    if (model === undefined) {
      this.cursors.clear();
      this.drawn = [];
      return;
    }
    const here = cursors.filter((cursor) => cursor.path === this.path);
    this.drawn = cursors;
    // One glyph-margin badge per line: badges on one line share a lane and
    // would draw over one another, so the lowest peer id wins the lane.
    const badged = onePerLine(here, (cursor) => model.getPositionAt(cursor.head).lineNumber);
    this.cursors.set(
      here.flatMap((cursor) => {
        const caretRange = toRange(model, cursor.head, cursor.head);
        const line = model.getPositionAt(cursor.head).lineNumber;
        const caretOptions: monaco.editor.IModelDecorationOptions = {
          className: this.colourClass(`caret:${cursor.colour}`, `border-left: 2px solid ${cursor.colour};`),
          hoverMessage: { value: `${literalMarkdown(cursor.label)} · ${literalMarkdown(cursor.role)}` },
          overviewRuler: {
            color: cursor.colour,
            position: 4 as monaco.editor.OverviewRulerLane,
          },
          stickiness: CURSOR_STICKINESS,
        };
        if (badged.get(line)?.peerId === cursor.peerId) {
          caretOptions.glyphMarginClassName = this.badgeClass(cursor);
        }
        const caret = { range: caretRange, options: caretOptions };
        // A peer draws as a caret bar, a selection fill and nothing else — the
        // pair the desktop client draws. A whole-line marker under the peer's
        // line reads as the document's own rule and says nothing the bar does
        // not, so there is none.
        if (cursor.anchor === cursor.head) {
          return [caret];
        }
        return [
          caret,
          {
            range: toRange(model, cursor.anchor, cursor.head),
            options: {
              inlineClassName: this.colourClass(
                `fill:${cursor.fill}`,
                `background-color: ${cursor.fill};`,
              ),
              stickiness: CURSOR_STICKINESS,
            },
          },
        ];
      }),
    );
  }

  report(report: Report): void {
    switch (report.kind) {
      case 'documents':
        this.onNotice({ kind: 'documents', documents: report.documents });
        break;
      case 'grant':
        this.onNotice({ kind: 'grant', paths: this.grantListing() });
        break;
      case 'peers':
        this.onNotice({
          kind: 'peers',
          count: report.peers.length,
          names: report.peers.map((peer) => peer.display_name),
        });
        break;
      case 'hostDetached':
        // The window, not a sentence: the page is where the sentence and the number counting
        // in it live, and a duration on this side would have to be re-derived from prose.
        this.onNotice({ kind: 'grace', graceMs: report.graceMs });
        break;
      case 'hostAttached':
        this.onNotice({ kind: 'hostBack', name: report.peer.display_name });
        break;
      case 'roomGone':
        this.onNotice({ kind: 'status', topic: 'terminal', text: `room closed: ${report.reason}` });
        this.enterTerminal(report.reason);
        break;
      case 'sessionError':
        this.onNotice({ kind: 'status', topic: 'error', text: `session error ${report.code}: ${report.message}` });
        break;
      case 'saveFailed':
        this.onNotice({
          kind: 'failure',
          text: report.message ?? `The room's text could not be written to ${report.path}.`,
          path: report.path,
        });
        break;
      case 'reconnecting':
        this.onNotice({ kind: 'reconnecting' });
        break;
      case 'disconnected':
        this.onNotice({ kind: 'status', topic: 'terminal', text: 'disconnected' });
        this.onNotice({ kind: 'disconnected' });
        break;
      default:
        break;
    }
  }

  // -- local selection out ---------------------------------------------------

  /**
   * Arms the one flush the interval allows. The flush reads the selection when it runs,
   * so what a burst publishes is where the caret ended — and a document that closed in
   * the meantime publishes nothing — rather than every step of the way there.
   */
  private scheduleSelection(): void {
    this.selectionDirty = true;
    if (this.selectionTimer !== undefined) {
      return;
    }
    this.selectionTimer = this.timers.after(SELECTION_INTERVAL_MS, () => {
      this.selectionTimer = undefined;
      this.flushSelection();
    });
  }

  /** Drops the armed flush, so a disposed binding leaves no timer behind. */
  private cancelSelection(): void {
    if (this.selectionTimer !== undefined) {
      this.selectionTimer();
      this.selectionTimer = undefined;
    }
    this.selectionDirty = false;
  }

  private flushSelection(): void {
    if (!this.selectionDirty) {
      return;
    }
    this.selectionDirty = false;
    this.publishSelection();
  }

  private publishSelection(): void {
    if (this.disposed || this.applying > 0) {
      return;
    }
    const path = this.path;
    const model = path === undefined ? undefined : this.models.get(path);
    const selection = this.editor.getSelection();
    if (path === undefined || model === undefined || selection === null) {
      return;
    }
    this.bridge.selectionChanged(path, {
      anchor: model.getOffsetAt({
        lineNumber: selection.selectionStartLineNumber,
        column: selection.selectionStartColumn,
      }),
      head: model.getOffsetAt({
        lineNumber: selection.positionLineNumber,
        column: selection.positionColumn,
      }),
    });
  }

  private colourClass(name: string, rule: string): string {
    const known = this.colours.get(name);
    if (known !== undefined) {
      return known;
    }
    const className = `selvage-${this.colours.size}`;
    this.colours.set(name, className);
    this.style.append(`.${className} { ${rule} }\n`);
    return className;
  }

  /**
   * The glyph-margin badge class for one peer, cached per (initials, colour)
   * so a cursor move never mints a rule. Bounded: a rename loop churns keys,
   * so past the bound the cache restarts — the next frame repaints it — and
   * its rules go with it, so the sheet stays as bounded as the cache.
   */
  private badgeClass(cursor: Pick<Cursor, 'label' | 'colour'>): string {
    const text = initials(cursor.label);
    const key = `${text}\0${cursor.colour}`;
    const known = this.badges.get(key);
    if (known !== undefined) {
      return known;
    }
    if (this.badges.size >= MAX_BADGE_CLASSES) {
      this.badges.clear();
      this.badgeStyle.textContent = '';
    }
    const className = `selvage-badge-${this.badges.size}`;
    this.badges.set(key, className);
    this.badgeStyle.append(`${badgeCss(className, text, cursor.colour)}\n`);
    return className;
  }
}

function peerName(displayName: string, peerId: string): string {
  return displayName === '' ? peerId : displayName;
}

/**
 * What a refusal to read a path for the host's *own* open says, in the page's words.
 *
 * The bridge has its own sentences for a refusal it reports after a *peer* asked for a path
 * (`refusalSentence`), and they are deliberately anonymous for a name the grant excludes. This
 * one is for the person who clicked a row in their own tree, so it names the file and says what
 * they can do; the cause that carries no sentence to a peer is said here, because the host is
 * not guessing at its own folder.
 */
function hostReadSentence(cause: GrantRefusal, path: string): string {
  switch (cause) {
    case 'not-granted':
      return `${path} is not a path this room shares, so it cannot be opened.`;
    case 'missing':
      return `${path} is not in the folder any more, so there is nothing to open.`;
    case 'not-a-file':
      return `${path} is not a plain file in the folder, so there is nothing to open.`;
    case 'too-large':
      return `${path} is larger than the text a session will carry, so it cannot be shared or opened here.`;
    case 'binary':
      return `${path} is not text, and a room carries text, so it cannot be opened here.`;
  }
}

/** How many badge classes a rename loop may mint before the cache restarts. */
const MAX_BADGE_CLASSES = 64;

/**
 * The stickiness a peer's caret bar and selection fill are tracked with.
 *
 * Monaco's default (`AlwaysGrowsWhenTypingAtEdges`, `0`) widens a decoration whose
 * edge the local person types at, and three Enters pressed at a peer's own position
 * stretch their zero-width caret over lines 11–14: a bar across all four and its
 * glyph-margin badge repeated on each. The desktop client draws both decorations
 * with `DecorationRangeBehavior.ClosedClosed`, the value Monaco names
 * `NeverGrowsWhenTypingAtEdges` (`1`), so a peer's caret stays the point it is
 * between frames. Named numerically because this module imports Monaco's types only.
 */
export const CURSOR_STICKINESS = 1;

function toRange(model: monaco.editor.ITextModel, from: number, to: number): monaco.IRange {
  const start = model.getPositionAt(Math.min(from, to));
  const end = model.getPositionAt(Math.max(from, to));
  return {
    startLineNumber: start.lineNumber,
    startColumn: start.column,
    endLineNumber: end.lineNumber,
    endColumn: end.column,
  };
}
