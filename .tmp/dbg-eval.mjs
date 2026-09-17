import { spawn } from 'node:child_process';
import WebSocket from '/home/user/projects/selvage/web_client/node_modules/ws/wrapper.mjs';
const PORT = 9382;
const PROFILE = '/home/user/projects/selvage/ai_notes/.tmp/web-eyeball/chrome-profile-dbg';
const chrome = spawn('/nix/store/33pxss8h71cl7vmfpy21bidsw0lj1g8q-chromium-152.0.7977.82/bin/chromium',
  ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',`--remote-debugging-port=${PORT}`,`--user-data-dir=${PROFILE}`,'about:blank'],
  { stdio: ['ignore','pipe','pipe'] });
let list;
for (let i=0;i<30;i++){ try{ list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r=>r.json()); break; }catch{ await new Promise(r=>setTimeout(r,1000)); } }
const t = list.find(t=>t.type==='page');
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.on('open',res);ws.on('error',rej);});
let id=0; const pending=new Map();
ws.on('message',raw=>{const m=JSON.parse(raw.toString()); if(m.id&&pending.has(m.id)){const{res}=pending.get(m.id);pending.delete(m.id);res(m.result);}});
const send=(method,params={})=>{const cur=++id;return new Promise(res=>{pending.set(cur,{res});ws.send(JSON.stringify({id:cur,method,params}));});};
await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate',{url:'http://127.0.0.1:8081/?room=x&token=y'});
await new Promise(r=>setTimeout(r,4000));
for (const expr of [`() => window.__selvageJoinArmed === false`, `(() => window.__selvageJoinArmed === false)()`, `window.__selvageJoinArmed === false`]) {
  const r = await send('Runtime.evaluate',{expression: expr, returnByValue:true});
  console.log(JSON.stringify(expr), '=>', JSON.stringify(r.result));
}
ws.close(); chrome.kill('SIGKILL');
