import type * as monaco from 'monaco-editor';

import { SessionBridge } from '../bridge/index.ts';
import type { Cursor, EditorHost, LineEnding, Report, TextChange } from '../bridge/index.ts';
import { grantUnion, peerColour } from '../bridge/index.ts';
import { grantChildren } from './tree.ts';
import type { GrantChild } from './tree.ts';
import type { Role, SelvageEngine } from '../engine/index.ts';
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
  | { kind: 'follow'; following: Following | undefined }
  | { kind: 'roomGone'; reason: string }
  | { kind: 'disconnected' }
  | { kind: 'status'; text: string };

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

export interface BindingOptions {
  engine: SelvageEngine;
  editor: monaco.editor.IStandaloneCodeEditor;
  onNotice: (notice: BindingNotice) => void;
  /**
   * Builds the buffer for a room path. Injected so this module never imports the
   * Monaco runtime — only its types — and the session logic stays importable
   * without a DOM. The page passes `monaco.editor.createModel`.
   */
  createModel: (text: string, language: string) => monaco.editor.ITextModel;
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

  private readonly engine: SelvageEngine;
  private readonly editor: monaco.editor.IStandaloneCodeEditor;
  private readonly onNotice: (notice: BindingNotice) => void;
  private readonly createModel: BindingOptions['createModel'];
  private readonly models = new Map<string, monaco.editor.ITextModel>();
  private readonly stops: Array<() => void> = [];
  private readonly colours = new Map<string, string>();
  private readonly badges = new Map<string, string>();
  private readonly cursors: monaco.editor.IEditorDecorationsCollection;
  private readonly style: HTMLStyleElement;
  private readonly stopEngine: () => void;
  private applying = 0;
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
  /** The room-gone reason once the session has ended terminally, if it has. */
  private terminalReason: string | undefined;
  /** Every landing stamps the cycle: a newer frame supersedes an older one still opening. */
  private landingCycle = 0;

  constructor(options: BindingOptions) {
    this.engine = options.engine;
    this.editor = options.editor;
    this.onNotice = options.onNotice;
    this.createModel = options.createModel;
    this.cursors = this.editor.createDecorationsCollection([]);
    this.style = document.createElement('style');
    document.head.appendChild(this.style);
    this.bridge = new SessionBridge({ engine: this.engine, host: this });
    const selection = this.editor.onDidChangeCursorSelection(() => this.publishSelection());
    this.stops.push(() => selection.dispose());
    // The follow and the pending go-to re-resolve on every room event: a caret move
    // and a document arrival both land, and membership changes refresh the roster.
    this.stopEngine = this.engine.on((event) => {
      switch (event.type) {
        case 'presenceChanged':
        case 'peersChanged':
          this.refreshRoster();
          this.backgroundTick();
          break;
        case 'documentChanged':
          this.backgroundTick();
          break;
        case 'documentsChanged':
          // The listing is the grant unioned with the open documents, so a
          // changed set re-renders the tree even when the grant itself is quiet.
          this.onNotice({ kind: 'grant', paths: this.grantListing() });
          this.backgroundTick();
          break;
        case 'grantChanged':
          this.onNotice({ kind: 'grant', paths: this.grantListing() });
          break;
        default:
          break;
      }
    });
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
      this.onNotice({ kind: 'status', text: roomGoneMessage(this.terminalReason) });
      return;
    }
    if (this.fronted.has(path) && this.models.get(path)?.isDisposed() === false) {
      this.path = path;
      this.editor.setModel(this.models.get(path) ?? null);
      this.publishSelection();
      return;
    }
    if (!this.engine.openDocuments().includes(path)) {
      await this.engine.open(path);
    }
    let model = this.models.get(path);
    if (model === undefined || model.isDisposed()) {
      model = this.createModel(this.engine.text(path), languageForPath(path));
      this.models.set(path, model);
      const changed = model.onDidChangeContent(() => {
        if (this.applying === 0 && this.path === path) {
          // Past the end nothing reaches the room: a keystroke that slipped
          // through the read-only guard echoes the state instead of landing
          // silently in the local model.
          if (this.terminalReason !== undefined) {
            this.onNotice({ kind: 'status', text: roomGoneMessage(this.terminalReason) });
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
    this.bridge.documentOpened(path);
    this.fronted.add(path);
    this.publishSelection();
  }

  closeDocument(path: string): void {
    this.bridge.documentClosed(path);
    this.fronted.delete(path);
    if (this.path === path) {
      this.path = undefined;
      this.editor.setModel(null);
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
   */
  grantListing(): string[] {
    return grantUnion(this.engine.grantedPaths(), this.engine.documents());
  }

  /**
   * Whether a room path holds no published text: listed (or followed into)
   * but never sent by anyone, so its buffer starts empty. Empty is not the
   * same as unpublished — a file that arrived and was emptied reads `has` —
   * and the hold taken by the open brings the sync before it resolves, so
   * this is settled by the time the opener asks.
   */
  isUnpublished(path: string): boolean {
    return !this.engine.has(path);
  }

  /** The immediate children of `directory` in the listing, for one tree level. */
  grantTree(directory = ''): GrantChild[] {
    return grantChildren(this.grantListing(), directory);
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
    this.publishSelection();
    // A follow re-landing says who and where; a go-to landing needs no
    // words — the tree highlight and the editor buffer already name the
    // file, and the status line stays for news.
    if (mode === 'follow') {
      this.onNotice({ kind: 'follow', following: this.following() });
      this.onNotice({ kind: 'status', text: `Following ${this.followingName} in ${path}` });
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
      this.onNotice({ kind: 'status', text: `${name} left the room, so following stopped` });
    }
  }

  private localEditEndsFollow(): void {
    if (this.followingPeerId !== undefined) {
      this.clearFollow();
    }
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
    const options = this.editor as unknown as { updateOptions?: (options: { readOnly: boolean }) => void };
    options.updateOptions?.({ readOnly: true });
    this.onNotice({ kind: 'roomGone', reason });
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

  async save(_path: string): Promise<boolean> {
    return true;
  }

  async readGrantedFile(_path: string): Promise<string | undefined> {
    return undefined;
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
        this.onNotice({
          kind: 'status',
          text: `host left — the room closes in ${Math.round(report.graceMs / 1000)}s unless the host returns`,
        });
        break;
      case 'hostAttached':
        this.onNotice({ kind: 'status', text: `host ${report.peer.display_name} is back` });
        break;
      case 'roomGone':
        this.onNotice({ kind: 'status', text: `room closed: ${report.reason}` });
        this.enterTerminal(report.reason);
        break;
      case 'sessionError':
        this.onNotice({ kind: 'status', text: `session error ${report.code}: ${report.message}` });
        break;
      case 'reconnecting':
        this.onNotice({ kind: 'status', text: 'Connection dropped. Reconnecting…' });
        break;
      case 'disconnected':
        this.onNotice({ kind: 'status', text: 'disconnected' });
        this.onNotice({ kind: 'disconnected' });
        break;
      default:
        break;
    }
  }

  // -- local selection out ---------------------------------------------------

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
   * so past the bound the cache restarts — the next frame repaints it.
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
    }
    const className = `selvage-badge-${this.badges.size}`;
    this.badges.set(key, className);
    this.style.append(`${badgeCss(className, text, cursor.colour)}\n`);
    return className;
  }
}

function peerName(displayName: string, peerId: string): string {
  return displayName === '' ? peerId : displayName;
}

/** How many badge classes a rename loop may mint before the cache restarts. */
const MAX_BADGE_CLASSES = 64;

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
