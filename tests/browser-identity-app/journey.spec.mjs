/* eslint-disable security/detect-non-literal-fs-filename -- Optional counterproof source is an explicitly supplied local evidence file. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import * as contracts from './contracts.mjs';

// Execute the unmodified real function body; substitute only IO imports, never its guards.
const source = await fs.readFile(process.env.A6C2_JOURNEY_SOURCE ?? new URL('./journey.mjs', import.meta.url), 'utf8');
async function exercise(injectedPhase, fault) {
  let phase;
  let observed;
  let cut = false;
  let probes = 0;
  let finishCount = 0;
  const closed = [];
  const logs = [];
  const saved = new Map();
  const baseline = { snapshot: { identityRevision: 'old', deliveryVersion: 'old', localUrls:{header:'/store-identity/logo.png'}, identity: { storeName:'Test', urls: { header: contracts.serviceOrigin + '/storage/logo.png' }, assets: { header: { sha256: 'logo',bytes:10 } } } } };
  const update = { snapshot: { ...baseline.snapshot, identityRevision: 'new', deliveryVersion: 'new' } };
  let active=baseline;
  const cacheEntries = () => [{cache:'app-cache-'+active.snapshot.deliveryVersion,url:bench.origin+'/index.html',status:200,bytes:20,sha256:'index'}, {url:bench.origin+'/store-identity/logo.png',status:200,bytes:10,sha256:'logo'}];
  const recovery = () => ({header:true,loader:false,alt:'Test',currentSrc:bench.origin+'/store-identity/logo.png',naturalWidth:10,naturalHeight:10,controller:bench.origin+'/sw.js'});
  const nativeFailure = () => {
    const worker={sessionId:'worker-'+active.snapshot.deliveryVersion,targetId:'target-'+active.snapshot.deliveryVersion,targetType:'service_worker',targetURL:bench.origin+'/sw.js',offline:true};
    const location={url:bench.origin+'/sw.js',lineNumber:0,columnNumber:10};
    observed.push({ ...worker,kind:'request',requestId:'native',url:baseline.snapshot.identity.urls.header,method:'GET',type:'Fetch',initiatorDetails:{type:'script',stack:{callFrames:[location]}} });
    observed.push({ ...worker,kind:'network-failed',requestId:'native',url:baseline.snapshot.identity.urls.header,error:'net::ERR_TUNNEL_CONNECTION_FAILED',canceled:false });
    observed.push({ ...worker,kind:'sw-exception',exceptionDetails:{exceptionId:1,exceptionMetaData:{requestId:'native'},...location,stackTrace:{callFrames:[location]}} });
  };
  const inject = () => {
    if (phase !== injectedPhase) return;
    if (fault === 'deny') bench.events.push({ type: 'deny', reason: 'unknown-service', url: '/rest/v1/users' });
    else if (fault === 'response') bench.events.push({ type: 'response', at: 1, url: bench.origin + '/late.js' });
    else if (fault) observed.push({ kind: fault, url: 'https://clients2.google.com/unexpected', message: 'injected failure' });
  };
  const bench = {
    origin: 'http://127.0.0.1:1234', events: [],
    setPhase(value) { phase = value.slice('test-'.length); inject(); },
    offline(value) { cut = value; this.events.push({ type: 'network-switch', offline: value, at: 1 }); },
    select(next) { active=next; },
    async close() { closed.push('transport'); if (fault === 'close' && injectedPhase === 'final') throw new Error('transport close failed'); },
  };
  const page = {
    async setViewport() {}, async goto() {}, async screenshot() { return Buffer.from('image'); },
    async waitForFunction() {}, async reload() { if (fault === 'response') inject(); if(fault==='native')nativeFailure(); }, async bringToFront() {},
    async evaluate(fn) {
      const text = String(fn);
      if (text.includes("r.json()")) return { identityRevision: 'new', version: 'new' };
      if (text.includes("then(() => false")) { probes++; return fault !== 'probe'; }
      return true;
    },
    async $() { return { async click() {} }; }, async waitForNavigation() {},
  };
  const browser = { connected: true, async newPage() { return page; }, async close() { closed.push('browser'); this.connected = false; if (injectedPhase === 'final' && ['pageerror','sw-exception'].includes(fault)) observed.push({ kind: fault, message: 'late error during close' }); if (injectedPhase === 'final' && fault === 'response') bench.events.push({ type: 'response', at: 1, url: bench.origin + '/late.js' }); } };
  const bindings = {
    assert, ...contracts, files: async () => ['index.html', 'version.json'], console: { log(text) { logs.push({ text, closed: [...closed] }); } },
    transport: async () => bench, launch: async () => browser,
    observe: async (_page, _browser, events) => {
      observed = events;
      for (const suffix of ['/rest/v1/v_store_config?select=*', '/rest/v1/vw_produtos_public?select=*,product_variants(*)&limit=200&order=data_cadastro.desc', '/rest/v1/categorias?select=*&order=nome.asc', '/rest/v1/banners?select=*&order=order.asc']) bench.events.push({ type: 'response', url: contracts.serviceOrigin + suffix });
      events.push({ kind: 'response', url: baseline.snapshot.identity.urls.header, status: 200, sha256: 'logo' });
      return { session: { async send() {} }, setOffline() {}, async finish() { finishCount++; if (injectedPhase === 'drain' && fault === 'observer-error' && phase === 'update-offline-reload') events.push({ kind: 'observer-error', message: 'late collection failure' }); }, async close() { closed.push('observer'); } };
    },
    artifactCallsites:async artifact=>({identityRevision:artifact.snapshot.identityRevision,storeName:'Test',logoURL:baseline.snapshot.identity.urls.header,localLogoURL:bench.origin+'/store-identity/logo.png',logo:{bytes:10,sha256:'logo'},index:{url:bench.origin+'/index.html',bytes:20,sha256:'index'},worker:{sha256:'a'.repeat(64),logo:{url:bench.origin+'/sw.js',lineNumber:0,columnNumber:10},root:{url:bench.origin+'/sw.js',lineNumber:0,columnNumber:20}},warmer:{url:bench.origin+'/assets/index.js',lineNumber:0,columnNumber:5,sha256:'b'.repeat(64)}}),
    capture: async () => recovery(), waitOpen: async () => {}, verifyCache: async () => cacheEntries(), readCache:async()=>cacheEntries(),
    view: async () => ({}), safe: String, write: async (_directory, name, data) => { saved.set(name, structuredClone(data)); },
  };
  const body = source.slice(source.indexOf('export async function journey')).replace('export async function', 'async function');
  const run = vm.runInNewContext(body + '\njourney', bindings);
  const result = await run('memory', 'test', baseline, update, { pin: 'synthetic' });
  return { result, closed, logs, probes, finishCount, saved };
}

for (const phase of ['baseline-first-navigation', 'baseline-offline-first-reload', 'update-published-locally', 'update-offline-reload']) {
  for (const fault of ['deny', 'pageerror', 'sw-exception', 'observer-error', 'request', 'websocket']) {
    test(`real journey rejects ${fault} in ${phase}`, async () => {
      const { result, logs } = await exercise(phase, fault);
      assert.equal(result.status, 'FAIL', `FALSE_ACCEPT ${phase} ${fault}`);
      assert(!logs.some(e => e.text.includes('JOURNEY_PASS')));
    });
  }
}
test('real journey checks both offline cuts by event position, even with equal timestamps', async () => {
  const { result } = await exercise('update-offline-reload', 'response');
  assert.equal(result.status, 'FAIL', 'SECOND_OFFLINE_RESPONSE_ACCEPTED');
  assert.match(result.error, /OFFLINE_NETWORK_RESPONSE/);
});
for (const [phase, fault] of [['final', 'pageerror'], ['final', 'sw-exception'], ['final', 'close'], ['final', 'response'], ['drain', 'observer-error']]) {
  test(`real journey rejects late ${fault} at ${phase}`, async () => {
    const { result, logs, closed } = await exercise(phase, fault);
    assert.equal(result.status, 'FAIL');
    assert(!logs.some(e => e.text.includes('JOURNEY_PASS')), 'PREMATURE_PASS');
    assert(closed.includes('transport'));
  });
}
test('real journey positive control probes twice and only emits PASS after closure', async () => {
  const { result, logs, probes, saved } = await exercise();
  assert.equal(result.status, 'PASS', result.error);
  assert.equal(probes, 2, 'SECOND_OFFLINE_PROBE_MISSING');
  assert.deepEqual(logs.find(e => e.text.includes('JOURNEY_PASS')).closed, ['browser', 'observer', 'transport']);
  assert.equal(saved.get('test-result.json').status, 'PASS');
});

test('real journey supplies both cut premises to the real native-error guard and retains their evidence after closure',async()=>{
  const {result,saved,logs}=await exercise(undefined,'native');
  assert.equal(result.status,'PASS',result.error);
  assert.equal(result.classifications.length,2);
  assert.equal(result.offlineCuts.length,2);
  assert(result.offlineCuts.every(c=>c.beforeCache.length && c.afterCache.length && c.recovery.header));
  assert.equal(saved.get('test-browser-events.json').filter(e=>e.kind==='sw-exception').length,2);
  assert.deepEqual(logs.find(e=>e.text.includes('JOURNEY_PASS')).closed,['browser','observer','transport']);
});
