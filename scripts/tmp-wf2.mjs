// wf2: link landing -> empty-name validation -> join -> first sight of tree+editor.
//
// The room's server is the Pi and the page is `dist/` on :8081, two origins: a
// page link names its own origin's server now, so the room is handed on as the
// wire invite and pasted into the bare card. The reads below this join are from
// the round this driver was written for and have not been kept up with the
// join card since.
import { launch } from './tmp-cdp.mjs';
const SHOT = '/home/user/projects/selvage/ai_notes/.tmp/vision-webflow';
const PAGE = 'http://127.0.0.1:8081/';
const INVITE = 'ws://100.64.0.3:8080/session?room=r-0c2a06c3766b&token=becfd3f33b70a0a4c0bfc448c8045ca5';

const cdp = await launch({ port: 9344, profile: '/tmp/selvage-prof-wf2' });
const errors = [];
cdp.on('Log.entryAdded', (p) => errors.push('LOG: ' + JSON.stringify(p.entry).slice(0, 300)));
cdp.on('Runtime.exceptionThrown', (p) => errors.push('EXC: ' + JSON.stringify(p.exceptionDetails).slice(0, 300)));

await cdp.navigate(PAGE);
await cdp.evaluate(`document.querySelector('#invite').value = ${JSON.stringify(INVITE)}`);
await cdp.shot(`${SHOT}/02-landing-with-link.png`);
console.log('PREFILL', JSON.stringify(await cdp.evaluate(`({
  room: document.querySelector('#room').value,
  token: document.querySelector('#token').value,
  name: document.querySelector('#name').value,
})`)));

// Click Join with empty name -> validation
await cdp.evaluate(`document.querySelector('#join-button').click()`);
await cdp.sleep(500);
console.log('EMPTY_NAME_ERR', JSON.stringify(await cdp.evaluate(`document.querySelector('#join-error').textContent`)));
await cdp.shot(`${SHOT}/03-name-validation-empty.png`);

// Whitespace-only name
await cdp.evaluate(`document.querySelector('#name').value = '   '; document.querySelector('#join-button').click()`);
await cdp.sleep(500);
console.log('SPACE_NAME_ERR', JSON.stringify(await cdp.evaluate(`document.querySelector('#join-error').textContent`)));

// Real join
await cdp.evaluate(`document.querySelector('#name').value = 'webflow-guest'; document.querySelector('#join-button').click()`);
await cdp.evaluate(`new Promise((res, rej) => {
  const t0 = Date.now();
  const iv = setInterval(() => {
    if (!document.querySelector('#workspace').hidden) { clearInterval(iv); res(true); }
    else if (Date.now() - t0 > 25000) { clearInterval(iv); rej(new Error('join timeout')); }
  }, 200);
})`);
await cdp.sleep(2500);
await cdp.shot(`${SHOT}/04-first-sight-tree-editor.png`);
console.log('JOINED', JSON.stringify(await cdp.evaluate(`({
  roomLabel: document.querySelector('#room-label').textContent,
  status: document.querySelector('#session-note').textContent,
  docs: [...document.querySelector('#docs').options].map(o => o.value + (o.selected ? ' [sel]' : '')),
  roster: [...document.querySelectorAll('#roster li')].map(li => li.textContent),
  tree: document.querySelector('#tree').textContent.slice(0, 400),
  editorText: document.querySelector('#editor').innerText.slice(0, 300),
  bannerHidden: document.querySelector('#follow-banner').hidden,
})`, null, 2)));
console.log('CONSOLE', JSON.stringify(errors.slice(0, 10), null, 2));
await cdp.close();
console.log('WF2_DONE');
