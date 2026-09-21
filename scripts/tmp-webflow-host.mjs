import { applyChange, SessionBridge } from '../src/bridge/index.ts';
import { SelvageEngine as Engine } from '../src/engine/index.ts';

const BASE = process.env.SELVAGE_BASE ?? 'ws://100.64.0.3:8080';

class MemHost {
  texts = new Map();
  text(path) { return this.texts.get(path); }
  lineEnding(_path) { return '\n'; }
  async applyChange(path, change) {
    const current = this.texts.get(path);
    if (current === undefined) return false;
    this.texts.set(path, applyChange(current, change));
    return true;
  }
  async save(_path) { return true; }
  async readGrantedFile(_path) { return undefined; }
  renderCursors(_cursors) {}
  report(_report) {}
}

const hostEngine = await Engine.host(BASE, 'demo-host', { client: 'webflow-review/host' });
const invite = hostEngine.inviteUrl();
const session = hostEngine.session();
console.log(`ROOM=${session.roomId}`);
console.log(`INVITE=${invite}`);
// The page is served from an origin of its own here, and a page link names the
// server of its own origin now: this room is handed on as the wire invite
// above, pasted into the card a bare page open shows.
console.log(`PAGE=http://127.0.0.1:8081/`);

const hostFiles = new MemHost();
hostFiles.texts.set('notes.md', '# Room notes\nA shared markdown file for the review.\n\n- item one\n- item two\n');
hostFiles.texts.set('src/main.ts', 'const greeting = "hello";\n\nexport function add(a: number, b: number): number {\n  return a + b;\n}\n');
hostFiles.texts.set('todo.txt', 'buy milk\nfix the thing\n');
const bridge = new SessionBridge({ engine: hostEngine, host: hostFiles });
bridge.documentOpened('notes.md');
bridge.documentOpened('src/main.ts');
await hostEngine.grant(['notes.md', 'src/main.ts', 'todo.txt']);
console.log('GRANTED=notes.md,src/main.ts,todo.txt');
hostEngine.setSelection('notes.md', { anchor: 0, head: 10 });

setInterval(() => {
  try { hostEngine.setSelection('notes.md', { anchor: 0, head: 10 }); } catch {}
}, 15000);

process.on('SIGTERM', async () => { try { await hostEngine.disconnect(); } catch {} process.exit(0); });
console.log('HOST_ALIVE');
await new Promise(() => {});
