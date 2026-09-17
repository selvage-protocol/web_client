// wf2b: join and dump state robustly.
import { launch } from './tmp-cdp.mjs';
const SHOT = '/home/user/projects/selvage/ai_notes/.tmp/vision-webflow';
const PAGE = 'http://127.0.0.1:8081/?room=r-0c2a06c3766b&token=becfd3f33b70a0a4c0bfc448c8045ca5&server=ws%3A%2F%2F100.64.0.3%3A8080';
const cdp = await launch({ port: 9345, profile: '/tmp/selvage-prof-wf2b' });
await cdp.navigate(PAGE);
await cdp.evaluate(`document.querySelector('#name').value = 'webflow-guest'; document.querySelector('#join-button').click()`);
await cdp.sleep(6000);
console.log('STATE', JSON.stringify(await cdp.evaluate(`({
  joinHidden: document.querySelector('#join').hidden,
  sessionHidden: document.querySelector('#session')?.hidden,
  workspaceHidden: document.querySelector('#workspace')?.hidden,
  joinError: document.querySelector('#join-error')?.textContent,
  hasDocs: !!document.querySelector('#docs'),
  body: document.body.innerHTML.slice(0, 500),
})`)));
await cdp.shot(`${SHOT}/04b-join-state.png`);
await cdp.sleep(6000);
console.log('STATE2', JSON.stringify(await cdp.evaluate(`({
  workspaceHidden: document.querySelector('#workspace')?.hidden,
  joinError: document.querySelector('#join-error')?.textContent,
  status: document.querySelector('#status')?.textContent,
  roomLabel: document.querySelector('#room-label')?.textContent,
})`)));
await cdp.shot(`${SHOT}/04-first-sight-tree-editor.png`);
console.log('FULL', JSON.stringify(await cdp.evaluate(`({
  docs: document.querySelector('#docs') ? [...document.querySelector('#docs').options].map(o => o.value + (o.selected ? ' [sel]' : '')) : null,
  roster: [...document.querySelectorAll('#roster li')].map(li => li.textContent),
  tree: document.querySelector('#tree')?.textContent.slice(0, 300),
  bannerHidden: document.querySelector('#follow-banner')?.hidden,
})`)));
await cdp.close();
console.log('WF2B_DONE');
