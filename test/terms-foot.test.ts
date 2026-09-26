/**
 * The panel's foot: the deployment's terms link, adopted where the page carries one.
 *
 * The foot is the page's chrome — the prototype draws it centred, small and muted under the create
 * verbs — and the link inside it is not: the demo deployment injects its own aside, and a
 * self-hosted copy has no terms page behind a link. These tests hold both halves: the panel's own
 * foot in the markup, and the href taken from the deployment, or no foot at all.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  TERMS_FALLBACK_SELECTOR,
  TERMS_LINK_ID,
  adoptTermsFoot,
  deploymentTermsLink,
} from '../src/browser/terms.ts';
import type { TermsSource } from '../src/browser/terms.ts';

interface FakeAnchor {
  tagName: string;
  attributes: Record<string, string>;
  parent: { tagName: string } | undefined;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
}

/** An anchor of the deployment's aside, or the page's own. */
function anchor(attributes: Record<string, string>, parent?: { tagName: string }): FakeAnchor {
  return {
    tagName: 'a',
    attributes: { ...attributes },
    parent,
    getAttribute: (name: string) => attributes[name] ?? null,
    setAttribute: (name: string, value: string) => void (attributes[name] = value),
  };
}

/**
 * A page with just enough of a DOM to be searched: the two selectors `terms.ts` asks for, answered
 * over the links it was built from. A selector this does not know is an error rather than a miss, so
 * a change to the query fails here instead of quietly finding nothing.
 */
function pageWith(links: FakeAnchor[]): TermsSource {
  return {
    querySelector: (selector: string) => {
      if (selector === `#${TERMS_LINK_ID}`) {
        return links.find((link) => link.attributes['id'] === TERMS_LINK_ID) ?? null;
      }
      if (selector === TERMS_FALLBACK_SELECTOR) {
        return (
          links.find(
            (link) =>
              link.tagName === 'a' &&
              link.parent?.tagName === 'aside' &&
              (link.attributes['href'] ?? '').endsWith('/terms'),
          ) ?? null
        );
      }
      throw new Error(`the fake page does not know the selector ${selector}`);
    },
  };
}

/** The panel's foot, and the anchor in it, as `main.ts` holds them. */
function foot(): { foot: { hidden: boolean }; link: FakeAnchor } {
  return { foot: { hidden: true }, link: anchor({}) };
}

const ASIDE = { tagName: 'aside' };

describe('the panel’s foot', () => {
  it('appears over the deployment’s link, and takes its href', () => {
    const parts = foot();
    const shown = adoptTermsFoot(pageWith([anchor({ id: TERMS_LINK_ID, href: '/terms' }, ASIDE)]), parts);
    assert.equal(shown, true);
    assert.equal(parts.foot.hidden, false, 'the foot stayed hidden over a link it could show');
    assert.equal(parts.link.getAttribute('href'), '/terms');
  });

  it('prefers the link the deployment gave that id, and leaves the other alone', () => {
    const parts = foot();
    const aside = anchor({ href: '/terms' }, ASIDE);
    const named = anchor({ id: TERMS_LINK_ID, href: '/terms-of-use' });
    adoptTermsFoot(pageWith([aside, named]), parts);
    assert.equal(parts.link.getAttribute('href'), '/terms-of-use', 'the other aside link was taken');
    assert.deepEqual(aside.attributes, { href: '/terms' }, 'the deployment’s other link was changed');
  });

  it('falls back to the aside’s own link when the id is not there', () => {
    const parts = foot();
    adoptTermsFoot(pageWith([anchor({ href: 'https://example.test/terms' }, ASIDE)]), parts);
    assert.equal(parts.link.getAttribute('href'), 'https://example.test/terms');
  });

  it('shows no foot at all on a page that carries no such link', () => {
    const parts = foot();
    const shown = adoptTermsFoot(pageWith([anchor({ href: '/elsewhere' }, ASIDE)]), parts);
    assert.equal(shown, false);
    assert.equal(parts.foot.hidden, true, 'a self-hosted page was given a foot to nowhere');
    assert.equal(parts.link.getAttribute('href'), null, 'the foot’s anchor was given an href');
  });

  it('reads a link whose href is empty as no link', () => {
    const parts = foot();
    assert.equal(adoptTermsFoot(pageWith([anchor({ id: TERMS_LINK_ID }) ]), parts), false);
    assert.equal(parts.foot.hidden, true);
  });

  it('leaves the deployment’s own aside as it stands', () => {
    const parts = foot();
    const aside = anchor({ id: TERMS_LINK_ID, href: '/terms', target: '_blank' }, ASIDE);
    const before = { ...aside.attributes };
    adoptTermsFoot(pageWith([aside]), parts);
    assert.deepEqual(aside.attributes, before, 'the deployment’s own link was rewritten');
    assert.equal(aside.parent, ASIDE, 'the deployment’s own link was moved out of its aside');
    assert.notEqual(parts.link, aside, 'the foot adopted the deployment’s element, not its href');
  });

  it('finds the links it is asked to find', () => {
    // The scan has to reach what it claims to cover: each selector picks its own link, and a page
    // with neither is a miss rather than a match on whatever came first.
    const named = anchor({ id: TERMS_LINK_ID, href: '/terms' });
    const aside = anchor({ href: '/terms' }, ASIDE);
    const source = pageWith([anchor({ href: '/not-terms' }, ASIDE), aside, named]);
    assert.equal(deploymentTermsLink(source), named);
    assert.equal(deploymentTermsLink(pageWith([aside])), aside);
    assert.equal(deploymentTermsLink(pageWith([])), null);
  });
});

describe('the panel’s foot in the page', () => {
  const page = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

  it('is drawn hidden, and its anchor carries no href until one is adopted', () => {
    const markup = /<div id="side-foot"[^>]*>([\s\S]*?)<\/div>/.exec(page)?.[1] ?? '';
    assert.ok(/id="side-foot"[^>]*\shidden/.test(page), 'the panel’s foot is not hidden at rest');
    assert.match(markup, /id="side-terms"/, 'the foot carries no link to fill');
    assert.ok(!/\shref=/.test(markup), `the foot carries an href of its own: ${markup}`);
  });

  it('is drawn quiet, centred and under the tree, as the design has it', () => {
    const rule = /#side-foot \{([^}]*)\}/.exec(page)?.[1] ?? '';
    assert.match(rule, /text-align: center/, `the foot is not centred: ${rule}`);
    assert.match(rule, /border-top: 1px solid var\(--border\)/, `the foot has no rule above it: ${rule}`);
    assert.ok(
      /#side-foot a \{[^}]*color: var\(--muted-foreground\)/.test(page),
      'the foot’s link is not the page’s muted tone',
    );
  });

  it('is filled by the page when a session starts, not left for a reader to notice', () => {
    const main = readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8');
    assert.match(
      main,
      /adoptTermsFoot\(document, \{ foot: sideFoot, link: sideTerms \}\)/,
      'the page never fills the panel’s foot',
    );
  });
});
