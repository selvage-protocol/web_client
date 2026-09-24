// Smoke: landing with no params.
import { launch } from './tmp-cdp.mjs';
const cdp = await launch({ port: 9333, profile: '.tmp/selvage-prof-2' });
await cdp.navigate('http://127.0.0.1:8081/');
await cdp.shot('/home/user/projects/selvage/ai_notes/.tmp/vision-webflow/01-landing-no-params.png');
const state = await cdp.evaluate(`({
  title: document.title,
  h1: document.querySelector('#join h1')?.textContent,
  invite: document.querySelector('#invite')?.placeholder,
  room: document.querySelector('#room')?.value,
  token: document.querySelector('#token')?.value,
  name: document.querySelector('#name')?.value,
  joinVisible: !document.querySelector('#join').hidden,
  workspaceHidden: document.querySelector('#workspace').hidden,
  err: document.querySelector('#join-error')?.textContent,
})`);
console.log(JSON.stringify(state, null, 2));
await cdp.close();
console.log('SMOKE_DONE');
