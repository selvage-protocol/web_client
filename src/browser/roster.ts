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
  onGoTo(peerId: string): void;
  onFollow(peerId: string): void;
}

/** Draws the self row plus one row per peer, replacing the list contents. */
export function renderRoster(list: HTMLElement, peers: readonly RosterPeer[], view: RosterView): void {
  list.replaceChildren();
  list.appendChild(selfRow(view.selfName));
  for (const peer of peers) {
    list.appendChild(peerRow(peer, peers, view));
  }
}

function selfRow(selfName: string): HTMLElement {
  const row = document.createElement('li');
  row.classList.add('self');
  const who = document.createElement('span');
  who.className = 'who';
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = selfName;
  who.appendChild(name);
  const you = document.createElement('span');
  you.className = 'you';
  you.textContent = 'you';
  who.appendChild(you);
  row.appendChild(who);
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
  go.disabled = peer.path === undefined;
  go.addEventListener('click', () => view.onGoTo(peer.peerId));
  actions.appendChild(go);
  const follow = document.createElement('button');
  follow.type = 'button';
  if (view.followedPeerId === peer.peerId) {
    follow.append(iconSpan('follow'), labelSpan('Following'));
    follow.disabled = true;
  } else {
    follow.append(iconSpan('follow'), labelSpan('Follow'));
    follow.addEventListener('click', () => view.onFollow(peer.peerId));
  }
  actions.appendChild(follow);
  row.appendChild(actions);
  return row;
}
