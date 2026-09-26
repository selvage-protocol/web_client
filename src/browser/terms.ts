/**
 * The panel's foot: the deployment's own terms link, where the page carries one.
 *
 * The demo deployment appends an aside of its own to the page — a non-commercial notice and a link
 * to its terms — and a self-hosted copy of this page has no such notice and no terms page behind a
 * link. So the foot is not the page's own: it adopts the href of the deployment's link, and a page
 * with none shows no foot at all rather than one that leads nowhere.
 *
 * The aside is left as it stands. Its notice is the deployment's to make, and this is not the place
 * to move it.
 */

/** The id the deployment's own link carries, which is the one preferred. */
export const TERMS_LINK_ID = 'terms-link';

/** The second choice: any link in an aside whose href is the deployment's terms path. */
export const TERMS_FALLBACK_SELECTOR = 'aside a[href$="/terms"]';

/** What is searched for the link: the document, read once the deployment's own markup is in it. */
export type TermsSource = Pick<ParentNode, 'querySelector'>;

/** The panel's foot and the link inside it, as the two things this fills. */
export interface TermsFoot {
  /** Shown only where there is an href to put in it. */
  foot: { hidden: boolean };
  /** The foot's anchor, which takes the deployment's href. */
  link: { setAttribute(name: string, value: string): void };
}

/** The deployment's own terms link, where the page carries one. */
export function deploymentTermsLink(source: TermsSource): Element | null {
  return source.querySelector(`#${TERMS_LINK_ID}`) ?? source.querySelector(TERMS_FALLBACK_SELECTOR);
}

/**
 * Fills the panel's foot from the deployment's link, and leaves it hidden where there is none.
 * Answers whether the page carried one, which is all a caller can want back.
 */
export function adoptTermsFoot(source: TermsSource, foot: TermsFoot): boolean {
  const href = deploymentTermsLink(source)?.getAttribute('href') ?? null;
  if (href === null || href === '') {
    return false;
  }
  foot.link.setAttribute('href', href);
  foot.foot.hidden = false;
  return true;
}
