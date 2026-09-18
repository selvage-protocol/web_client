/**
 * Which editor links may open. Room content is shared text, so a link it
 * names must never navigate the session page itself: the editor's default
 * external opener answers any non-http(s) target with `location.href = href`,
 * and a `file:` target reaches `file:///...` — refused with a Security Error
 * while attempting to leave the session. Web and mail links keep the default
 * handling; everything else (`file:`, `command:`, relative) is swallowed.
 */

/** A link target the guard reads the scheme from: the editor's URI or a raw string. */
export type LinkTarget = { scheme: string } | string;

/** The handler the guard registers with the editor's opener service. */
export interface LinkGuardOpener {
  open(target: LinkTarget, options?: unknown): boolean | Promise<boolean>;
}

/** The slice of the editor's opener service the guard needs. */
export interface GuardableOpenerService {
  registerOpener(opener: LinkGuardOpener): { dispose(): void };
}

/** Web and mail links open; anything else stays in the room. */
export function linkOpensExternally(scheme: string): boolean {
  switch (scheme.toLowerCase()) {
    case 'http':
    case 'https':
    case 'mailto':
      return true;
    default:
      return false;
  }
}

/** The scheme of a link target, whether the editor passed a URI or a string. */
export function linkTargetScheme(target: LinkTarget): string {
  if (typeof target === 'string') {
    const at = target.indexOf(':');
    return at === -1 ? '' : target.slice(0, at);
  }
  return target.scheme;
}

/**
 * Registers the guard with the editor's opener service. It runs first and
 * answers `true` (handled — the default opener never runs) for anything that
 * is not a web or mail link, so no shared-text link can navigate the page.
 *
 * The registration is returned: an opener on the editor's service lives until
 * it is disposed, and a page that joins a second room would otherwise leave
 * one behind per join. The caller owns it and drops it with the session.
 */
export function registerLinkGuard(service: GuardableOpenerService): { dispose(): void } {
  return service.registerOpener({
    open: (target) => !linkOpensExternally(linkTargetScheme(target)),
  });
}
