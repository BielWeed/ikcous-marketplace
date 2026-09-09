import assert from 'node:assert/strict';

const position = value => Number.isSafeInteger(value) && value >= 0;
const frameAt = (frame, location) => frame && location && frame.url === location.url && frame.lineNumber === location.lineNumber && frame.columnNumber === location.columnNumber;
const sameWorker = (a, b) => a.sessionId === b.sessionId && a.targetId === b.targetId && a.targetType === 'service_worker' && b.targetType === 'service_worker' && a.targetURL === b.targetURL;
const hasBytes = (entries, expected) => entries?.some(e => e.url === expected.url && e.status === 200 && e.bytes === expected.bytes && e.sha256 === expected.sha256);

export function assertCutTransport(cut, transportEvents) {
  assert(position(cut.transportStart) && cut.transportStart < transportEvents.length, 'OFFLINE_CUT_MISSING');
  const end = cut.transportEnd ?? transportEvents.length;
  assert(position(end) && end > cut.transportStart && end <= transportEvents.length, 'OFFLINE_CUT_RANGE');
  const interval = transportEvents.slice(cut.transportStart, end);
  assert(interval[0]?.type === 'network-switch' && interval[0].offline === true, 'OFFLINE_CUT_MISSING');
  assert(!interval.slice(1).some(e => e.type === 'network-switch'), 'OFFLINE_CUT_RECONNECTED');
  assert(!interval.some(e => e.type === 'response'), 'OFFLINE_NETWORK_RESPONSE');
}

// Classification is a separate proof. Original exceptions, including revoked ones, remain immutable.
export function classifyOfflineException(index, events, transportEvents, contract) {
  // eslint-disable-next-line security/detect-object-injection -- Array index is supplied by events.entries in the real guard, never by app input.
  const exception = events[index];
  const details = exception.exceptionDetails;
  const id = details?.exceptionMetaData?.requestId;
  assert(typeof id === 'string' && id.length > 0 && Number.isSafeInteger(details.exceptionId), 'OFFLINE_NATIVE_METADATA');
  assert(exception.targetType === 'service_worker' && exception.sessionId && exception.targetId && exception.targetURL === contract.origin + '/sw.js', 'OFFLINE_WORKER_IDENTITY');
  const linked = events.map((event, i) => ({ event, i })).filter(x => sameWorker(x.event, exception) && x.event.requestId === id);
  const starts = linked.filter(x => x.event.kind === 'request');
  const failures = linked.filter(x => x.event.kind === 'network-failed');
  assert(starts.length === 1 && failures.length === 1, 'OFFLINE_NATIVE_CHAIN');
  const { event: request, i: startIndex } = starts[0];
  const { event: failure, i: failureIndex } = failures[0];
  assert(startIndex < failureIndex && failureIndex < index, 'OFFLINE_NATIVE_ORDER');
  assert(!linked.some(x => ['network-response','network-finished'].includes(x.event.kind)), 'OFFLINE_NATIVE_RESPONSE');
  assert(events.filter(e => e.kind === 'sw-exception' && sameWorker(e, exception) && (e.exceptionDetails?.exceptionMetaData?.requestId === id || e.exceptionDetails?.exceptionId === details.exceptionId)).length === 1, 'OFFLINE_AMBIGUOUS_EXCEPTION');
  assert(!request.unassociated && !failure.unassociated && !request.redirectFrom && request.redirectStatus === undefined && request.method === 'GET' && request.type === 'Fetch', 'OFFLINE_REQUEST_SHAPE');
  assert(failure.url === request.url && !failure.canceled && !failure.blockedReason && !failure.corsErrorStatus, 'OFFLINE_FAILURE_SHAPE');
  const cuts = (contract.offlineCuts ?? []).filter(c => position(c.eventStart) && c.eventStart <= startIndex && index < (c.eventEnd ?? events.length));
  assert(cuts.length === 1, 'OFFLINE_EVENT_INTERVAL');
  const cut = cuts[0];
  assert(['baseline-offline-first-reload','update-offline-reload'].includes(cut.phase), 'OFFLINE_PHASE');
  assertCutTransport(cut, transportEvents);
  const proof = cut.proof;
  assert(proof?.identityRevision && /^[a-f0-9]{64}$/.test(proof.worker?.sha256 ?? ''), 'OFFLINE_ARTIFACT_PROOF');
  const kind = request.url === proof.logoURL ? 'logo' : request.url === contract.origin + '/' ? 'root' : null;
  assert(kind && contract.logos.has(proof.logoURL), 'OFFLINE_EXACT_URL');
  const location = kind === 'logo' ? proof.worker.logo : proof.worker.root;
  assert(frameAt(details, location) && frameAt(details.stackTrace?.callFrames?.[0], location) && frameAt(request.initiatorDetails?.stack?.callFrames?.[0], location) && request.initiatorDetails.type === 'script', 'OFFLINE_NATIVE_CALLSITE');
  assert(failure.error === (kind === 'logo' ? 'net::ERR_TUNNEL_CONNECTION_FAILED' : 'net::ERR_EMPTY_RESPONSE'), 'OFFLINE_UNMEASURED_ERROR');
  assert(Array.isArray(cut.beforeCache) && !cut.beforeCache.some(e => e.url === request.url), 'OFFLINE_NOT_PREVIOUSLY_ABSENT');
  assert(proof.index?.url === contract.origin + '/index.html' && hasBytes(cut.beforeCache,proof.index) && hasBytes(cut.afterCache,proof.index), 'OFFLINE_INDEX_INTEGRITY');
  const recovery = cut.recovery;
  assert(recovery?.header && recovery.loader === false && recovery.alt === proof.storeName && recovery.naturalWidth > 0 && recovery.naturalHeight > 0 && recovery.controller === contract.origin + '/sw.js', 'OFFLINE_RECOVERY');
  assert(recovery.currentSrc === proof.localLogoURL || (kind === 'root' && recovery.currentSrc === proof.logoURL), 'OFFLINE_RECOVERY_LOGO');
  if (kind === 'logo') {
    const logo = { url: proof.localLogoURL, ...proof.logo };
    assert(hasBytes(cut.beforeCache,logo) && hasBytes(cut.afterCache,logo), 'OFFLINE_LOCAL_LOGO_INTEGRITY');
  }
  let pageRequest;
  if (kind === 'root') {
    assert(/^[a-f0-9]{64}$/.test(proof.warmer?.sha256 ?? ''), 'OFFLINE_WARMER_ARTIFACT');
    const pages = events.map((event,i)=>({event,i})).filter(({event,i})=>i >= cut.eventStart && i < (cut.eventEnd ?? events.length) && event.kind === 'request' && event.targetType === 'page' && event.url === request.url && event.type === 'Fetch');
    assert(pages.length === 1 && pages[0].event.sessionId && pages[0].event.targetId && pages[0].event.requestId && !pages[0].event.redirectFrom && pages[0].event.method === 'GET' && pages[0].event.initiatorDetails?.type === 'script' && frameAt(pages[0].event.initiatorDetails.stack?.callFrames?.[0], proof.warmer), 'OFFLINE_WARMER_REQUEST');
    // This is a distinct page initiator proof, NEVER a fabricated page-to-worker requestId link.
    pageRequest = { eventIndex: pages[0].i, sessionId: pages[0].event.sessionId, targetId: pages[0].event.targetId, requestId: pages[0].event.requestId };
  }
  return { case: kind, exceptionIndex: index, exceptionId: details.exceptionId, requestIndex: startIndex, failureIndex, sessionId: exception.sessionId, targetId: exception.targetId, requestId: id, cutIndex: contract.offlineCuts.indexOf(cut), identityRevision: proof.identityRevision, workerSha256: proof.worker.sha256, pageRequest };
}
