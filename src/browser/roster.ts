/**
 * Roster rows: who is here, glanceable. Each row carries the peer's colour
 * swatch, their name, and the two verbs — never path text (where someone is
 * reads on the grant tree, as a badge on their file). The own name leads
 * with a you marker and no actions. The follow banner owns the one stop
 * control, so a followed row reads Following and offers nothing to press.
 */

import type { Role } from '../engine/index.ts';
import { iconSpan, labelSpan } from './icons.ts';
import { rosterLabel } from './names.ts';

export interface RosterPeer {
  peerId: string;
  displayName: string;
  role: Role;
  /** The peer's colour: the same mapping the caret wears. */
  colour: string;
  /** The room path the peer is in, when it has one open. */
  path: string | undefined;
}

export interface RosterView {
  followedPeerId: string | undefined;
  selfName: string;
  /** The swatch colour for the own row; the page passes the peer-colour mapping. */
  selfColour?: string;
  /**
   * Past the end of the room every action stays drawn but dead, with the
   * reason on hover: a live-looking Go to/Follow on a dead room is the limbo.
   */
  disabled?: boolean;
  disabledReason?: string;
  onGoTo(peerId: string): void;
  onFollow(peerId: string): void;
}

/** Draws the self row plus one row per peer, replacing the list contents. */
export function renderRoster(list: HTMLElement, peers: readonly RosterPeer[], view: RosterView): void {
  list.replaceChildren();
  list.appendChild(selfRow(view));
  for (const peer of peers) {
    list.appendChild(peerRow(peer, peers, view));
  }
}

/**
 * The own row, drawn with the same anatomy as a peer row — swatch, name and
 * actions slot — so it reads as a roster member rather than a section
 * header. The actions stay, disabled with the reason: going to or following
 * yourself is meaningless, and the `you` marker stays quiet beside the name.
 */
function selfRow(view: RosterView): HTMLElement {
  const row = document.createElement('li');
  row.classList.add('self');
  const swatch = document.createElement('span');
  swatch.className = 'swatch';
  if (view.selfColour !== undefined) {
    swatch.style.backgroundColor = view.selfColour;
  }
  swatch.title = 'this is you';
  row.appendChild(swatch);
  const who = document.createElement('span');
  who.className = 'who';
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = view.selfName;
  who.appendChild(name);
  const you = document.createElement('span');
  you.className = 'you';
  you.textContent = 'you';
  who.appendChild(you);
  row.appendChild(who);
  const actions = document.createElement('span');
  actions.className = 'actions';
  const go = document.createElement('button');
  go.type = 'button';
  go.append(iconSpan('go'), labelSpan('Go to'));
  go.disabled = true;
  go.title = 'This is you. There is nowhere to go to';
  actions.appendChild(go);
  const follow = document.createElement('button');
  follow.type = 'button';
  follow.append(iconSpan('follow'), labelSpan('Follow'));
  follow.disabled = true;
  follow.title = "You can't follow yourself.";
  actions.appendChild(follow);
  row.appendChild(actions);
  return row;
}

function peerRow(peer: RosterPeer, all: readonly RosterPeer[], view: RosterView): HTMLElement {
  const row = document.createElement('li');
  row.classList.add('peer');
  if (view.followedPeerId === peer.peerId) {
    row.classList.add('following');
  }
  const swatch = document.createElement('span');
  swatch.className = 'swatch';
  swatch.style.backgroundColor = peer.colour;
  swatch.title = peer.colour;
  row.appendChild(swatch);
  const who = document.createElement('span');
  who.className = 'who';
  const name = document.createElement('span');
  name.className = 'name';
  // Duplicate names share the row text with a short peer id, so two
  // identical names stay two rows.
  const label = rosterLabel(peer, all);
  name.textContent = label;
  if (label !== peer.displayName) {
    name.title = peer.peerId;
  }
  who.appendChild(name);
  row.appendChild(who);
  const actions = document.createElement('span');
  actions.className = 'actions';
  const go = document.createElement('button');
  go.type = 'button';
  go.append(iconSpan('go'), labelSpan('Go to'));
  go.disabled = view.disabled === true || peer.path === undefined;
  if (view.disabled === true && view.disabledReason !== undefined) {
    go.title = view.disabledReason;
  }
  go.addEventListener('click', () => view.onGoTo(peer.peerId));
  actions.appendChild(go);
  const follow = document.createElement('button');
  follow.type = 'button';
  if (view.followedPeerId === peer.peerId && view.disabled !== true) {
    follow.append(iconSpan('follow'), labelSpan('Following'));
    follow.disabled = true;
  } else {
    follow.append(iconSpan('follow'), labelSpan('Follow'));
    if (view.disabled === true) {
      follow.disabled = true;
      if (view.disabledReason !== undefined) {
        follow.title = view.disabledReason;
      }
    } else {
      follow.addEventListener('click', () => view.onFollow(peer.peerId));
    }
  }
  actions.appendChild(follow);
  row.appendChild(actions);
  return row;
}
