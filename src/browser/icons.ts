/**
 * Page iconography: inline SVG throughout, no emoji. File rows take the icon
 * for their type; the link/check pair belongs to the share box's copy button.
 */

export type IconName =
  | 'file'
  | 'file-ts'
  | 'file-js'
  | 'file-md'
  | 'file-txt'
  | 'folder'
  | 'chevron'
  | 'go'
  | 'follow'
  | 'stop'
  | 'link'
  | 'check';

const FILE_OUTLINE =
  '<path d="M4 1.5h5.5L13 5v9.5H4z"/><path d="M9.5 1.5V5H13"/>';

/** A file outline carrying its two-letter type, in the set's stroke. */
function typedFile(letters: string): string {
  return (
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" ' +
    'stroke-linecap="round" stroke-linejoin="round">' +
    `${FILE_OUTLINE}<text x="8" y="12.8" text-anchor="middle" font-size="4.6" ` +
    `font-weight="bold" font-family="monospace" fill="currentColor" stroke="none">${letters}</text></svg>`
  );
}

const ICONS: Record<IconName, string> = {
  file:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" ' +
    `stroke-linecap="round" stroke-linejoin="round">${FILE_OUTLINE}</svg>`,
  'file-ts': typedFile('TS'),
  'file-js': typedFile('JS'),
  'file-md': typedFile('MD'),
  'file-txt': typedFile('TXT'),
  folder:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 4.5c0-.8.7-1.5 1.5-1.5h3l1.5 2H13c.8 0 1.5.7 1.5 1.5v5c0 .8-.7 1.5-1.5 1.5H3c-.8 0-1.5-.7-1.5-1.5z"/></svg>',
  chevron:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l4 4-4 4"/></svg>',
  go: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8h11M9 4l4 4-4 4"/></svg>',
  follow:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/></svg>',
  stop: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
  link: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M6.5 9.5a3 3 0 0 0 4.2 0l2-2a3 3 0 0 0-4.2-4.2l-1 1"/><path d="M9.5 6.5a3 3 0 0 0-4.2 0l-2 2a3 3 0 0 0 4.2 4.2l1-1"/></svg>',
  check:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 8.5l3.5 3.5 7-8"/></svg>',
};

const FILE_ICON_BY_EXTENSION: ReadonlyMap<string, IconName> = new Map([
  ['ts', 'file-ts'],
  ['tsx', 'file-ts'],
  ['cts', 'file-ts'],
  ['mts', 'file-ts'],
  ['js', 'file-js'],
  ['jsx', 'file-js'],
  ['mjs', 'file-js'],
  ['cjs', 'file-js'],
  ['md', 'file-md'],
  ['markdown', 'file-md'],
  ['mdown', 'file-md'],
  ['mkdn', 'file-md'],
  ['mkd', 'file-md'],
  ['txt', 'file-txt'],
]);

/** The tree icon for a room path: its type where backed, a plain file otherwise. */
export function fileIcon(path: string): IconName {
  const slash = path.lastIndexOf('/');
  const name = slash === -1 ? path : path.slice(slash + 1);
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) {
    return 'file';
  }
  return FILE_ICON_BY_EXTENSION.get(name.slice(dot + 1).toLowerCase()) ?? 'file';
}

export function iconSpan(name: IconName): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = name === 'chevron' ? 'icon chev' : 'icon';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = ICONS[name];
  return span;
}

/** The raw SVG for one icon, for buttons that swap glyphs. */
export function iconSvg(name: IconName): string {
  return ICONS[name];
}

export function labelSpan(text: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.textContent = text;
  return span;
}
