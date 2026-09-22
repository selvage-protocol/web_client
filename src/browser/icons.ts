/**
 * Page iconography: inline SVG throughout, no emoji. File rows take the icon
 * for their type; the link/check pair belongs to the share box's copy button.
 *
 * A typed file is a solid page in the type's colour with a bold short label on
 * it, so it still reads in a 14 px tree row — a two-letter label at the old
 * 4.6-unit size was under 4 px and invisible. The colours follow an editor icon
 * theme (TS blue, JS yellow, Rust orange, Nix blue, …); the generic and text
 * files stay the muted outline so an unbacked type is visibly a plain file.
 */

export type IconName =
  | 'file'
  | 'file-txt'
  | 'file-ts'
  | 'file-js'
  | 'file-md'
  | 'file-json'
  | 'file-css'
  | 'file-scss'
  | 'file-html'
  | 'file-xml'
  | 'file-rs'
  | 'file-sh'
  | 'file-toml'
  | 'file-yaml'
  | 'file-nix'
  | 'file-ini'
  | 'file-py'
  | 'file-go'
  | 'file-c'
  | 'file-cpp'
  | 'file-h'
  | 'file-java'
  | 'file-sql'
  | 'file-lua'
  | 'file-docker'
  | 'folder'
  | 'chevron'
  | 'go'
  | 'follow'
  | 'stop'
  | 'link'
  | 'check'
  | 'download';

const FILE_OUTLINE =
  '<path d="M4 1.5h5.5L13 5v9.5H4z"/><path d="M9.5 1.5V5H13"/>';

const OUTLINE_OPEN =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" ' +
  'stroke-linecap="round" stroke-linejoin="round">';
const OUTLINE_CLOSE = '</svg>';

/** A page carrying three ruled lines: the text file, in the set's own stroke. */
const TEXT_FILE =
  OUTLINE_OPEN +
  FILE_OUTLINE +
  '<path d="M6 7.5h4.5M6 10h4.5M6 12.5h2.5"/>' +
  OUTLINE_CLOSE;

/** The configuration file: a settings slider, a shape no other row carries. */
const CONFIG_FILE =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" ' +
  'stroke-linecap="round">' +
  '<path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/>' +
  '<circle cx="5.8" cy="4.5" r="1.5" fill="currentColor" stroke="none"/>' +
  '<circle cx="10.2" cy="8" r="1.5" fill="currentColor" stroke="none"/>' +
  '<circle cx="6.8" cy="11.5" r="1.5" fill="currentColor" stroke="none"/>' +
  '</svg>';

/** One typed page: fill, a folded corner and a label big enough to read. */
interface FileType {
  label: string;
  bg: string;
  fg: string;
}

const PAGE = 'M2.6 1.4h6.8L14 5.8v8.8H2.6z';
const FOLD = 'M9.4 1.4 14 5.8H9.4z';

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function typedFile({ label, bg, fg }: FileType): string {
  return (
    '<svg viewBox="0 0 16 16" fill="none">' +
    `<path d="${PAGE}" fill="${bg}"/>` +
    `<path d="${FOLD}" fill="#000" fill-opacity="0.22"/>` +
    `<text x="8.2" y="12" text-anchor="middle" font-size="7.6" font-weight="700" ` +
    `font-family="ui-monospace,SFMono-Regular,Menlo,monospace" fill="${fg}">${escapeXml(label)}</text>` +
    '</svg>'
  );
}

/** The label and colours one type's page carries. */
const TYPED_FILE_TYPES = {
  'file-ts': { label: 'TS', bg: '#3178c6', fg: '#ffffff' },
  'file-js': { label: 'JS', bg: '#f7df1e', fg: '#111111' },
  'file-md': { label: 'MD', bg: '#519aba', fg: '#ffffff' },
  'file-json': { label: '{}', bg: '#cbcb41', fg: '#111111' },
  'file-css': { label: '#', bg: '#42a5f5', fg: '#0b1a24' },
  'file-scss': { label: 'S', bg: '#cf649a', fg: '#ffffff' },
  'file-html': { label: '<>', bg: '#e44d26', fg: '#ffffff' },
  'file-xml': { label: 'X', bg: '#f1662a', fg: '#2a1006' },
  'file-rs': { label: 'RS', bg: '#f74c00', fg: '#ffffff' },
  'file-sh': { label: '>_', bg: '#2f9e44', fg: '#04130a' },
  'file-toml': { label: 'TM', bg: '#b08968', fg: '#231508' },
  'file-yaml': { label: 'Y', bg: '#cb171e', fg: '#ffffff' },
  'file-nix': { label: 'N', bg: '#5277c3', fg: '#ffffff' },
  'file-py': { label: 'PY', bg: '#3776ab', fg: '#ffd343' },
  'file-go': { label: 'GO', bg: '#00add8', fg: '#052733' },
  'file-c': { label: 'C', bg: '#5c6bc0', fg: '#ffffff' },
  'file-cpp': { label: 'C+', bg: '#f34b7d', fg: '#33091a' },
  'file-h': { label: 'H', bg: '#a074c4', fg: '#1e1030' },
  'file-java': { label: 'J', bg: '#b07219', fg: '#ffffff' },
  'file-sql': { label: 'DB', bg: '#e38c00', fg: '#2b1800' },
  'file-lua': { label: 'L', bg: '#2c2d72', fg: '#ffffff' },
  'file-docker': { label: 'D', bg: '#2496ed', fg: '#08131f' },
} as const satisfies Record<string, FileType>;

type TypedFileIcon = keyof typeof TYPED_FILE_TYPES;

const ICONS: Record<IconName, string> = {
  file: `${OUTLINE_OPEN}${FILE_OUTLINE}${OUTLINE_CLOSE}`,
  'file-txt': TEXT_FILE,
  'file-ini': CONFIG_FILE,
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
  download:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1.5v8.5M4.5 6.5 8 10l3.5-3.5"/><path d="M2 12.5v1.5h12v-1.5"/></svg>',
  ...(Object.fromEntries(
    (Object.keys(TYPED_FILE_TYPES) as TypedFileIcon[]).map((name) => [name, typedFile(TYPED_FILE_TYPES[name])]),
  ) as Record<TypedFileIcon, string>),
};

const FILE_ICON_BY_EXTENSION: ReadonlyMap<string, IconName> = new Map<string, IconName>([
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
  ['mdx', 'file-md'],
  ['mdown', 'file-md'],
  ['mkdn', 'file-md'],
  ['mkd', 'file-md'],
  ['mdwn', 'file-md'],
  ['mdtxt', 'file-md'],
  ['mdtext', 'file-md'],
  ['txt', 'file-txt'],
  ['text', 'file-txt'],
  ['log', 'file-txt'],
  ['json', 'file-json'],
  ['jsonc', 'file-json'],
  ['json5', 'file-json'],
  ['css', 'file-css'],
  ['scss', 'file-scss'],
  ['sass', 'file-scss'],
  ['less', 'file-scss'],
  ['html', 'file-html'],
  ['htm', 'file-html'],
  ['xml', 'file-xml'],
  ['svg', 'file-xml'],
  ['xsl', 'file-xml'],
  ['xslt', 'file-xml'],
  ['rs', 'file-rs'],
  ['sh', 'file-sh'],
  ['bash', 'file-sh'],
  ['zsh', 'file-sh'],
  ['fish', 'file-sh'],
  ['ksh', 'file-sh'],
  ['toml', 'file-toml'],
  ['yaml', 'file-yaml'],
  ['yml', 'file-yaml'],
  ['nix', 'file-nix'],
  ['ini', 'file-ini'],
  ['conf', 'file-ini'],
  ['cfg', 'file-ini'],
  ['properties', 'file-ini'],
  ['editorconfig', 'file-ini'],
  ['py', 'file-py'],
  ['pyw', 'file-py'],
  ['pyi', 'file-py'],
  ['go', 'file-go'],
  ['c', 'file-c'],
  ['cc', 'file-cpp'],
  ['cpp', 'file-cpp'],
  ['cxx', 'file-cpp'],
  ['c++', 'file-cpp'],
  ['hpp', 'file-cpp'],
  ['hh', 'file-cpp'],
  ['hxx', 'file-cpp'],
  ['h', 'file-h'],
  ['java', 'file-java'],
  ['sql', 'file-sql'],
  ['lua', 'file-lua'],
  ['dockerfile', 'file-docker'],
  ['containerfile', 'file-docker'],
]);

/** The types an editor names without an extension. */
const FILE_ICON_BY_NAME: ReadonlyMap<string, IconName> = new Map<string, IconName>([
  ['dockerfile', 'file-docker'],
  ['containerfile', 'file-docker'],
  ['.editorconfig', 'file-ini'],
  ['.gitconfig', 'file-ini'],
]);

/** The tree icon for a room path: its type where backed, a plain file otherwise. */
export function fileIcon(path: string): IconName {
  const slash = path.lastIndexOf('/');
  const name = slash === -1 ? path : path.slice(slash + 1);
  const dot = name.lastIndexOf('.');
  if (dot > 0 && dot < name.length - 1) {
    const byExtension = FILE_ICON_BY_EXTENSION.get(name.slice(dot + 1).toLowerCase());
    if (byExtension !== undefined) {
      return byExtension;
    }
  }
  return FILE_ICON_BY_NAME.get(name.toLowerCase()) ?? 'file';
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
