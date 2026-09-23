// wf3: roster detail + follow start/stop + go-to.
import { launch } from './tmp-cdp.mjs';
const SHOT = '/home/user/projects/selvage/ai_notes/.tmp/vision-webflow';
const PAGE = 'http://127.0.0.1:8081/';
// The page is on :8081 and the room's server is the Pi, two origins: a page link names
// its own origin's server now, so the room is handed on as the wire invite and pasted
// into the bare card. The reads below this join are from an earlier round's chrome.
const INVITE = 'ws://100.64.0.3:8080/session?room=r-0c2a06c3766b&token=becfd3f33b70a0a4c0bfc448c8045ca5';
const cdp = await launch({ port: 9346, profile: '.tmp/selvage-prof-wf3' });
await cdp.navigate(PAGE);
await cdp.evaluate(`document.querySelector('#invite').value = ${JSON.stringify(INVITE)}`);
await cdp.evaluate(`document.querySelector('#name').value = 'follower'; document.querySelector('#join-button').click()`);
await cdp.evaluate(`new Promise((res, rej) => {
  const t0 = Date.now();
  const iv = setInterval(() => {
    if (!document.querySelector('#workspace').hidden) { clearInterval(iv); res(true); }
    else if (Date.now() - t0 > 25000) { clearInterval(iv); rej(new Error('join timeout')); }
  }, 200);
})`);
await cdp.sleep(2500);
console.log('ROSTER', JSON.stringify(await cdp.evaluate(`[...document.querySelectorAll('#roster li')].map(li => ({
  cls: li.className,
  name: li.querySelector('.name')?.textContent,
  where: li.querySelector('.where')?.textContent,
  swatch: li.querySelector('.swatch')?.style.backgroundColor,
  buttons: [...li.querySelectorAll('button')].map(b => b.textContent + (b.disabled ? '[disabled]' : '')),
}))`)));
console.log('SHARE', JSON.stringify(await cdp.evaluate(`({
  share: document.querySelector('#share')?.value,
  copyBtn: document.querySelector('#copy-share')?.textContent,
})`)));
// Follow the host (demo-host row = index 1 if self is listed, else 0)
const idx = await cdp.evaluate(`[...document.querySelectorAll('#roster li')].findIndex(li => (li.querySelector('.name')?.textContent ?? '').includes('demo-host'))`);
console.log('HOST_IDX', idx);
await cdp.evaluate(`[...document.querySelectorAll('#roster li')][${idx}].querySelectorAll('button')[1].click()`);
await cdp.sleep(2000);
console.log('BANNER', JSON.stringify(await cdp.evaluate(`({
  hidden: document.querySelector('#follow-banner').hidden,
  text: document.querySelector('#follow-banner').textContent,
  border: document.querySelector('#follow-banner').style.borderColor,
  bg: document.querySelector('#follow-banner').style.backgroundColor,
  rosterAfter: [...document.querySelectorAll('#roster li')].map(li => li.className + ':' + li.querySelector('.name')?.textContent + ':' + [...li.querySelectorAll('button')].map(b=>b.textContent).join('/')),
})`)));
await cdp.shot(`${SHOT}/05-following-banner.png`);
// Stop via banner button
await cdp.evaluate(`document.querySelector('#follow-banner button')?.click()`);
await cdp.sleep(800);
console.log('AFTER_STOP', JSON.stringify(await cdp.evaluate(`({
  hidden: document.querySelector('#follow-banner').hidden,
  text: document.querySelector('#follow-banner').textContent,
})`)));
// Go to host
await cdp.evaluate(`[...document.querySelectorAll('#roster li')][${idx}].querySelectorAll('button')[0].click()`);
await cdp.sleep(1500);
console.log('GOTO_STATUS', JSON.stringify(await cdp.evaluate(`document.querySelector('#session-note').textContent`)));
await cdp.shot(`${SHOT}/06-after-goto.png`);
await cdp.close();
console.log('WF3_DONE');
