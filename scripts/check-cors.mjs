#!/usr/bin/env node
// check-cors: the demo TLS proxy answers CORS on /meta so an off-origin https
// page reads the meta document instead of dying on Same-Origin Policy.
// Live by default; point at the fixture with SELVAGE_CORS_BASE=http://127.0.0.1:18443.
// Fails red where the proxy passes through byte-identical (no ACAO headers).
const BASE = process.env.SELVAGE_CORS_BASE ?? 'https://lumi-raspberrypi.muskellunge-yo.ts.net:8444';
const ORIGIN = 'https://cors-check.example';

let failures = 0;
function check(name, condition, detail = '') {
  console.log(`${condition ? 'ok' : 'FAIL'}  ${name}${detail !== '' && !condition ? ` — ${detail}` : ''}`);
  if (!condition) failures += 1;
}

const get = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(15000) });

const echoed = await get(`${BASE}/meta`, { headers: { Origin: ORIGIN } });
check('GET /meta answers 200', echoed.status === 200, `status ${echoed.status}`);
check('GET /meta echoes the request Origin', echoed.headers.get('access-control-allow-origin') === ORIGIN,
  `ACAO: ${echoed.headers.get('access-control-allow-origin')}`);
check('GET /meta varies on Origin', (echoed.headers.get('vary') ?? '').includes('Origin'));
const body = await echoed.text();
check('GET /meta body is still the meta document', body.includes('"wire_versions":["selvage/1"]'), body.slice(0, 80));

const star = await get(`${BASE}/meta`);
check('GET /meta without Origin answers *', star.headers.get('access-control-allow-origin') === '*',
  `ACAO: ${star.headers.get('access-control-allow-origin')}`);
await star.text();

const preflight = await get(`${BASE}/meta`, {
  method: 'OPTIONS',
  headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'GET' },
});
check('OPTIONS /meta answers 204', preflight.status === 204, `status ${preflight.status}`);
check('OPTIONS /meta echoes the request Origin', preflight.headers.get('access-control-allow-origin') === ORIGIN);
check('OPTIONS /meta allows GET', (preflight.headers.get('access-control-allow-methods') ?? '').includes('GET'));
await preflight.text();

if (failures > 0) {
  console.log(`CORS VERDICT: FAIL (${failures})`);
  process.exit(1);
}
console.log('CORS VERDICT: PASS');
