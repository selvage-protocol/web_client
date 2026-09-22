/**
 * The clipboard-less copy fallback.
 *
 * The share bar shows the link abbreviated and the clipboard gets the whole one.
 * Where the clipboard API cannot be reached the readout itself is the fallback,
 * and the failure path is the one that matters: an alert saying `Select the link
 * and copy it by hand.` over an abbreviated link is an instruction the field
 * cannot obey, and the invite it produces answers no room.
 *
 * Proven in Chromium 152 before the fix, with `navigator.clipboard.writeText`
 * refused and `document.execCommand` answering false: `#share` read
 * `/?room=r-edb2…f8f75&token=411853…55578`, the selection sat collapsed at its
 * end, and the alert stood under the bar.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { handCopy } from '../src/browser/hand-copy.ts';

const FULL = 'http://127.0.0.1:8096/?room=r-edb2d9cf8f75&token=4118535a6ba274ae9642c609f0655578';
const SHOWN = '/?room=r-edb2…f8f75&token=411853…55578';

function makeReadout() {
  return {
    value: SHOWN,
    selected: 0,
    fits: [],
    select() {
      this.selected += 1;
    },
  };
}

describe('copying the invite by hand', () => {
  it('leaves the whole link in the readout when the copy failed', () => {
    const readout = makeReadout();
    const done = handCopy({ readout, full: FULL, shown: SHOWN, exec: () => false });
    assert.equal(done, false);
    assert.equal(
      readout.value,
      FULL,
      'the abbreviation came back over an alert that says to copy the link by hand',
    );
  });

  it('sizes the readout to the link it is left holding', () => {
    const readout = makeReadout();
    handCopy({
      readout,
      full: FULL,
      shown: SHOWN,
      exec: () => false,
      fit: (value) => void readout.fits.push(value),
    });
    assert.deepEqual(readout.fits, [FULL], 'the field is sized for a value it no longer holds');
  });

  it('puts the abbreviation back once the copy worked', () => {
    const readout = makeReadout();
    const done = handCopy({ readout, full: FULL, shown: SHOWN, exec: () => true });
    assert.equal(done, true);
    assert.equal(readout.value, SHOWN, 'the credential stays on the bar after a copy');
  });

  it('selects the whole link before asking the browser to copy it', () => {
    const readout = makeReadout();
    let valueAtCopy = '';
    handCopy({
      readout,
      full: FULL,
      shown: SHOWN,
      exec: () => {
        valueAtCopy = readout.value;
        return true;
      },
    });
    assert.equal(readout.selected, 1, 'nothing was selected to copy');
    assert.equal(valueAtCopy, FULL, 'the copy command ran over the abbreviation');
  });

  it('treats a copy command that threw as a copy that failed', () => {
    const readout = makeReadout();
    const done = handCopy({
      readout,
      full: FULL,
      shown: SHOWN,
      exec: () => {
        throw new Error('not supported');
      },
    });
    assert.equal(done, false);
    assert.equal(readout.value, FULL, 'a throwing copy command left the abbreviation behind');
  });
});
