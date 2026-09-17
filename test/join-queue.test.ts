/**
 * S2 (2026-09-18): a join attempted before the page finishes loading never
 * fails — it queues until `load`, then lands exactly once. A second submit
 * while queued or running is a duplicate, never a second join.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createJoinGate } from '../src/browser/join.ts';

/** A controllable page load: `loaded` flips only when the test fires it. */
function fakePage() {
  let loaded = false;
  let onLoad: (() => void) | undefined;
  return {
    isLoaded: () => loaded,
    whenLoaded: (cb: () => void) => {
      onLoad = cb;
    },
    fireLoad: () => {
      loaded = true;
      onLoad?.();
    },
    loadHooks: () => (onLoad === undefined ? 0 : 1),
  };
}

describe('join gate', () => {
  it('queues a join attempted during load and lands it exactly once after ready', () => {
    const page = fakePage();
    const gate = createJoinGate(page.isLoaded, page.whenLoaded);
    let landings = 0;
    assert.equal(gate.request(() => {
      landings += 1;
    }), 'queued');
    assert.equal(landings, 0);
    // A second submit while queued is a duplicate, not a second flight.
    assert.equal(gate.request(() => {
      landings += 1;
    }), 'duplicate');
    page.fireLoad();
    assert.equal(landings, 1);
  });

  it('runs the held closure after load, so callers snapshot submit-time values into it', () => {
    const page = fakePage();
    const gate = createJoinGate(page.isLoaded, page.whenLoaded);
    // main.ts snapshots the name, invite, room and token at submit time and
    // closes over the snapshot: the gate only guarantees *when* it runs.
    const snapshot = 'typed-ahead';
    let heldName: string | undefined;
    assert.equal(gate.request(() => {
      heldName = snapshot;
    }), 'queued');
    assert.equal(heldName, undefined);
    page.fireLoad();
    assert.equal(heldName, 'typed-ahead');
  });

  it('starts immediately when already loaded, still single-flight', () => {
    const page = fakePage();
    page.fireLoad();
    const gate = createJoinGate(page.isLoaded, page.whenLoaded);
    let landings = 0;
    assert.equal(gate.request(() => {
      landings += 1;
    }), 'started');
    assert.equal(landings, 1);
    assert.equal(page.loadHooks(), 0);
    assert.equal(gate.request(() => {
      landings += 1;
    }), 'duplicate');
    assert.equal(landings, 1);
  });

  it('a refused join releases the gate so the guest can retry', () => {
    const page = fakePage();
    page.fireLoad();
    const gate = createJoinGate(page.isLoaded, page.whenLoaded);
    let landings = 0;
    assert.equal(gate.request(() => {
      landings += 1;
    }), 'started');
    gate.release();
    assert.equal(gate.request(() => {
      landings += 1;
    }), 'started');
    assert.equal(landings, 2);
  });
});
