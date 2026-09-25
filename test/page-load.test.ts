/**
 * The page's own load, evaluated as the module it is written as.
 *
 * `main.ts` sets its load-time state with top-level calls — the panel's first shape, the card's read
 * of its own origin, a join the inline guard held — and a top-level `let` written *below* one of
 * those calls is in its temporal dead zone when the call reads it. `?.` does not help: the binding
 * itself is what is unborn, and `editorApi?.layout()` throws `Cannot access 'editorApi' before
 * initialization` rather than doing nothing. Every bundler in use lowers a top-level `let` to `var`,
 * so the fault is invisible in `dist/` — the shipped page is fine — and only the unbundled module
 * shows it. Two fix passes fixed one instance at a time for that reason; this is the guard for the
 * class: load the module, in both device shapes the page loads in, and let a read of an unborn
 * binding fail the test with its own stack, which names the reader and the declaration.
 *
 * The document, window and `matchMedia` here are the smallest stand-in the module needs to reach its
 * own end, and they are deliberately permissive: this test is about the *order* the module's own
 * statements run in, so anything the page asks of a browser is answered rather than asserted.
 * `window.__selvageJoinArmed` is asserted afterwards, so a module that threw early and was caught
 * somewhere cannot pass this by doing nothing.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/** What the page asked the document for, so a load that reached no chrome is not a clean load. */
const asked: string[] = [];
let phone = true;

function element(tag = 'div') {
  const listeners = new Map();
  const el = {
    tag,
    children: [],
    className: '',
    textContent: '',
    title: '',
    value: '',
    type: '',
    role: '',
    hidden: false,
    disabled: false,
    open: false,
    focused: false,
    spellcheck: undefined,
    autocomplete: undefined,
    maxLength: undefined,
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    replaceChildren() {},
    append() {},
    appendChild() {},
    remove() {},
    addEventListener(type, run) {
      const held = listeners.get(type) ?? [];
      held.push(run);
      listeners.set(type, held);
    },
    removeEventListener() {},
    setAttribute() {},
    getAttribute: () => null,
    removeAttribute() {},
    focus() {},
    blur() {},
    click() {},
    closest: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    getClientRects: () => [],
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }),
  };
  return el;
}

class HTMLElement {}
class HTMLInputElement extends HTMLElement {}
class HTMLTextAreaElement extends HTMLElement {}
class HTMLDetailsElement extends HTMLElement {}
class HTMLButtonElement extends HTMLElement {}

/** The document the module reads its chrome from, and `matchMedia` the shape it reports. */
function install(): { window: Record<string, unknown> } {
  Object.assign(globalThis, {
    HTMLElement,
    HTMLInputElement,
    HTMLTextAreaElement,
    HTMLDetailsElement,
    HTMLButtonElement,
    Element: HTMLElement,
  });
  const document = {
    readyState: 'complete',
    activeElement: null,
    getElementById: (id: string) => {
      asked.push(id);
      return element();
    },
    createElement: (tag: string) => element(tag),
    createElementNS: (_namespace: string, tag: string) => element(tag),
    createTextNode: (text: string) => ({ textContent: text, children: [] }),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
    body: element('body'),
    head: element('head'),
    documentElement: element('html'),
  };
  const storage = { getItem: () => null, setItem() {}, removeItem() {}, clear() {} };
  const matchMedia = (query: string) => ({
    media: query,
    matches: phone,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });
  const window = {
    matchMedia,
    location: { protocol: 'file:', search: '', href: 'file:///page/index.html', hash: '', host: '' },
    localStorage: storage,
    sessionStorage: storage,
    addEventListener() {},
    removeEventListener() {},
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    requestAnimationFrame: (run: () => void) => setTimeout(run, 0),
    cancelAnimationFrame: clearTimeout,
    navigator: { userAgent: 'node', clipboard: { writeText: async () => {} } },
    innerWidth: 390,
    innerHeight: 844,
    devicePixelRatio: 1,
    history: { replaceState() {}, pushState() {} },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    visualViewport: { addEventListener() {}, height: 844, offsetTop: 0 },
  };
  Object.assign(globalThis, {
    document,
    window,
    self: window,
    location: window.location,
    matchMedia,
    localStorage: storage,
    sessionStorage: storage,
    requestAnimationFrame: window.requestAnimationFrame,
    addEventListener() {},
    getComputedStyle: window.getComputedStyle,
  });
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
  return { window };
}

/** A second instance of the module in one process: one load per device shape. */
async function loadPage(shape: 'phone' | 'desktop'): Promise<Record<string, unknown>> {
  asked.length = 0;
  phone = shape === 'phone';
  const { window } = install();
  await import(`../src/browser/main.ts?load=${shape}`);
  return window;
}

describe('the page loads unbundled', () => {
  for (const shape of ['phone', 'desktop'] as const) {
    it(`runs its own top-level statements in order on a ${shape}`, async () => {
      const window = await loadPage(shape);
      // Not vacuous: the module evaluated to its own end, and it reached the page's chrome on the
      // way. An import that threw and was swallowed by a stub would leave both of these false.
      assert.equal(window['__selvageJoinArmed'], true, 'the module never reached its own load-time wiring');
      assert.ok(asked.includes('file-strip'), `the load never asked for the page\u2019s chrome: ${asked.join(', ')}`);
      assert.ok(asked.length > 20, `the load read too little of the page to be the page: ${asked.length} elements`);
    });
  }

  it('is a guard at all: the same load fails on a binding read before it is initialized', async () => {
    // The control for the two above. A module that reads its own later `let` at load throws the same
    // error the page threw, through the same evaluation, so a green run above is a real reading of
    // `main.ts` and not a harness that catches everything.
    const unborn = `const ready = () => late; ready(); let late = 1;`;
    await assert.rejects(
      import(`data:text/javascript,${encodeURIComponent(unborn)}`),
      (error: unknown) => error instanceof ReferenceError && /late/.test(error.message),
      'a top-level read of an unborn binding did not throw here',
    );
  });
});
