/* eslint-disable security/detect-non-literal-fs-filename -- Cache paths are the frozen Vite precache manifest from a verified artifact. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { assertView, assertRevision, serviceOrigin } from './contracts.mjs';
import { hash, write } from './evidence.mjs';

export const safe = value => String(value).replace(/([?&]apikey=)[^&\s"']+/g, '$1[public-key-redacted]');
// Keep the protocol shape and numbers; redact only strings, without flattening metadata.
const safeDetails = value => JSON.parse(JSON.stringify(value, (_key, item) => typeof item === 'string' ? safe(item) : item));
export async function observe(page, browser, evidence) {
  const pending = new Set();
  const listeners = [];
  let offline = false;
  let root;
  const add = (kind, data) => { const entry = { at: Date.now(), kind, offline, ...data }; evidence.push(entry); return entry; };
  const failure = (error, data = {}) => add('observer-error', { ...data, message: safe(error.stack ?? error.message) });
  const track = promise => {
    const task = promise.catch(error => failure(error)).finally(() => pending.delete(task));
    pending.add(task);
  };
  const on = (emitter, event, handler) => { emitter.on(event, handler); listeners.push(() => emitter.off(event, handler)); };
  const drain = async () => { while (pending.size) await Promise.all([...pending]); };
  // One map per session: requestId alone is not a globally unique network identity.
  const network = (client, targetInfo) => {
    const identity = { sessionId: client.id(), targetId: targetInfo.targetId, targetType: targetInfo.type, targetURL: safe(targetInfo.url ?? '') };
    const requests = new Map();
    const correlate = event => {
      let request = requests.get(event.requestId);
      if (!request && targetInfo.type === 'service_worker' && event.response?.url === targetInfo.url) {
        // Chrome reports the already-downloaded bootstrap script in the new SW session.
        // Preserve the actual response URL and missing start; do not synthesize a request.
        request = { url: safe(event.response.url), type: event.type, unassociated: true };
        requests.set(event.requestId, request);
      }
      if (!request) failure(new Error('UNASSOCIATED_NETWORK_EVENT'), { ...identity, requestId: event.requestId, eventURL: safe(event.response?.url ?? '') });
      return { ...identity, requestId: event.requestId, url: request?.url ?? null, type: request?.type, initiator: request?.initiator, unassociated: !request || request.unassociated === true };
    };
    on(client, 'Network.requestWillBeSent', event => {
      const entry = add('request', { ...identity, requestId: event.requestId, url: safe(event.request.url), method: event.request.method, type: event.type, initiator: safe(JSON.stringify(event.initiator)), initiatorDetails: safeDetails(event.initiator), timestamp: event.timestamp,
        redirectFrom: event.redirectResponse ? safe(event.redirectResponse.url) : null, redirectStatus: event.redirectResponse?.status });
      requests.set(event.requestId, entry);
    });
    on(client, 'Network.responseReceived', event => add('network-response', { ...correlate(event), responseURL: safe(event.response.url), status: event.response.status, fromServiceWorker: event.response.fromServiceWorker, fromCache: event.response.fromDiskCache }));
    on(client, 'Network.loadingFailed', event => add('network-failed', { ...correlate(event), error: safe(event.errorText), canceled: event.canceled === true, blockedReason: event.blockedReason, corsErrorStatus: event.corsErrorStatus ? safeDetails(event.corsErrorStatus) : undefined, timestamp: event.timestamp }));
    let bootstrapFinished = false;
    on(client, 'Network.loadingFinished', event => {
      if (!bootstrapFinished && targetInfo.type === 'service_worker' && event.requestId === targetInfo.targetId && !requests.has(event.requestId)) {
        bootstrapFinished = true;
        add('bootstrap-finished', { ...identity, requestId: event.requestId, url: null, unassociated: true, reason: 'script download preceded worker target' });
      } else add('network-finished', correlate(event));
      requests.delete(event.requestId);
    });
    on(client, 'Network.webSocketCreated', event => {
      const entry = add('websocket', { ...identity, requestId: event.requestId, url: safe(event.url), initiator: safe(JSON.stringify(event.initiator)) });
      requests.set(event.requestId, entry);
    });
    on(client, 'Network.webSocketFrameError', event => add('websocket-error', { ...correlate(event), error: safe(event.errorMessage) }));
    if (targetInfo.type !== 'page') {
      on(client, 'Runtime.consoleAPICalled', event => add('sw-console', { ...identity, type: event.type, values: event.args.map(arg => safe(arg.value ?? arg.description ?? '')) }));
      on(client, 'Runtime.exceptionThrown', event => add('sw-exception', { ...identity, text: safe(event.exceptionDetails.exception?.description ?? event.exceptionDetails.text), timestamp: event.timestamp, exceptionDetails: safeDetails(event.exceptionDetails) }));
      on(client, 'Runtime.exceptionRevoked', event => add('sw-exception-revoked', { ...identity, details: safeDetails(event) }));
    }
  };
  on(page, 'console', message => add('console', { type: message.type(), text: safe(message.text()) }));
  on(page, 'pageerror', error => add('pageerror', { message: safe(error.message) }));
  on(page, 'framenavigated', frame => { if (frame === page.mainFrame()) add('navigation', { url: safe(frame.url()) }); });
  on(page, 'response', response => {
    const request = response.request();
    const entry = add('response', { url: safe(response.url()), status: response.status(), fromServiceWorker: response.fromServiceWorker(), fromCache: response.fromCache(), resourceType: request.resourceType() });
    if (response.url().startsWith(serviceOrigin + '/storage/') || request.resourceType() === 'document') track(response.buffer().then(bytes => { entry.bytes = bytes.length; entry.sha256 = hash(bytes); }).catch(error => { entry.bodyError = safe(error.message); failure(error, { url: entry.url }); }));
  });
  const session = await page.createCDPSession();
  const close = async () => {
    await drain();
    // The caller closes Chrome first, preserving observation through final target shutdown.
    for (const client of [root, session]) if (client && !client.detached) {
      try { await client.detach(); } catch (error) { failure(error); }
    }
    await drain();
    for (const remove of listeners) remove();
  };
  try {
    const { targetInfo } = await session.send('Target.getTargetInfo');
    network(session, targetInfo);
    await session.send('Network.enable');
    root = await browser.target().createCDPSession();
    on(root, 'Target.attachedToTarget', event => {
      const client = root.connection()?.session(event.sessionId);
      if (!client) { failure(new Error('ATTACHED_SESSION_MISSING'), { sessionId: event.sessionId }); return; }
      const configure = async () => {
        try {
          add('target-attached', { sessionId: event.sessionId, targetId: event.targetInfo.targetId, targetType: event.targetInfo.type, waitingForDebugger: event.waitingForDebugger });
          if (event.targetInfo.targetId !== targetInfo.targetId) {
            network(client, event.targetInfo);
            await client.send('Network.enable');
            await client.send('Runtime.enable');
          }
        } finally {
          // Even failed instrumentation must release its own debugger pause.
          await client.send('Runtime.runIfWaitingForDebugger');
          add('target-resumed', { sessionId: event.sessionId, targetId: event.targetInfo.targetId });
        }
      };
      track(configure());
    });
    // Browser-scoped autoAttachRelated includes the next SW version. Never combine it
    // with setAutoAttach on this root: those commands cancel each other (CDP Target).
    await root.send('Target.autoAttachRelated', { targetId: targetInfo.targetId, waitForDebuggerOnStart: true });
    await drain();
    return {
      session,
      setOffline(value) { offline = value; },
      async finish() {
        if (!root.detached) {
          try { await root.send('Target.getTargets'); } catch (error) { failure(error); }
        }
        await drain();
      },
      close,
    };
  } catch (error) {
    failure(error);
    await close();
    throw error;
  }
}

export async function view(page) {
  return page.evaluate(() => {
    const img = document.querySelector('header button[aria-label="Ir para o Início"] img');
    const rect = img?.getBoundingClientRect();
    const parent = img?.parentElement?.getBoundingClientRect();
    return { loader: !!document.querySelector('#silent-guardian-loader'), header: !!document.querySelector('header'), alt: img?.alt, currentSrc: img?.currentSrc,
      naturalWidth: img?.naturalWidth ?? 0, naturalHeight: img?.naturalHeight ?? 0, x: rect?.x ?? -1, y: rect?.y ?? -1,
      width: rect?.width ?? 0, height: rect?.height ?? 0, parent: parent ? { x: parent.x, y: parent.y, width: parent.width, height: parent.height } : null,
      objectFit: img ? getComputedStyle(img).objectFit : null, title: document.title,
      viewportWidth: innerWidth, viewportHeight: innerHeight, documentWidth: document.documentElement.clientWidth,
      scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      controller: navigator.serviceWorker?.controller?.scriptURL ?? null, online: navigator.onLine,
      body: document.body.innerText.slice(0, 1000) };
  });
}
export async function capture(directory, label, page, artifact, online) {
  const state = await view(page);
  await write(directory, label + '.png', await page.screenshot({ fullPage: true }));
  await write(directory, label + '-view.json', state);
  assertView(state, artifact.snapshot.identity.storeName);
  assert.equal(state.objectFit, 'contain', 'LOGO_OBJECT_FIT');
  assert(state.parent && state.x >= state.parent.x - 1 && state.x + state.width <= state.parent.x + state.parent.width + 1, 'LOGO_PARENT_CLIP');
  if (online) assert.equal(state.currentSrc, artifact.snapshot.identity.urls.header, 'ONLINE_CANONICAL_LOGO');
  assert.equal(state.title, artifact.snapshot.identity.storeName, 'BUILD_TITLE');
  return state;
}
export async function waitOpen(page) {
  await page.waitForFunction(() => !document.querySelector('#silent-guardian-loader') && !!document.querySelector('header button[aria-label="Ir para o Início"] img')?.naturalWidth, { timeout: 25000 });
}
export async function readCache(page) {
  return page.evaluate(async () => {
    const result = [];
    // Open only names returned by keys; this cannot create an absent cache.
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        const response = await cache.match(request);
        const data = await response.arrayBuffer();
        const sha = await crypto.subtle.digest('SHA-256', data);
        result.push({ cache: name, url: request.url, status: response.status, bytes: data.byteLength, sha256: [...new Uint8Array(sha)].map(x => x.toString(16).padStart(2, '0')).join('') });
      }
    }
    return result;
  });
}
export async function verifyCache(page, directory, label, artifact, origin) {
  const entries = await readCache(page);
  await write(directory, label + '-cache.json', entries);
  const cacheName = 'app-cache-' + artifact.snapshot.deliveryVersion;
  for (const url of new Set(artifact.precache.map(item => item.url))) {
    const stored = entries.find(entry => entry.cache === cacheName && entry.url === new URL(url, origin + '/').href);
    assert(stored, 'PRECACHE_MISSING ' + url);
    const bytes = await fs.readFile(path.join(artifact.directory, url));
    assert.equal(stored.status, 200, 'PRECACHE_STATUS ' + url);
    assert.equal(stored.bytes, bytes.length, 'PRECACHE_BYTES ' + url);
    assert.equal(stored.sha256, hash(bytes), 'PRECACHE_HASH ' + url);
  }
  const revisions = [...new Set(entries.filter(e => e.cache.startsWith('app-cache-')).map(e => e.cache))];
  assert.deepEqual(revisions, [cacheName], 'CACHE_REVISION');
  assertRevision(cacheName.slice('app-cache-'.length), artifact.snapshot.deliveryVersion);
  return entries;
}
