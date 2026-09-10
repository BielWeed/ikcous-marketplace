import assert from "node:assert/strict";
import test from "node:test";
import { assertObservations, serviceOrigin } from "./contracts.mjs";

// Native fields from A6c3 raw-cdp-events.json, SHA b083f2ffb950ea2110bb68e42592e7941643dbc31d880916a180f26d946c9232.
// Cache/recovery are unit premises, NOT evidence that the neutral probe ran Header or useCacheWarmer.
const origin = "http://127.0.0.1:62272";
const logo = `${serviceOrigin}/storage/v1/object/public/branding/v1/9a4e33a9c2f2b9f2bfb2404fdf390c961bbc9b6b78b793a0d9bfd18ced21234b/logo.svg`;
const sha = "9a4e33a9c2f2b9f2bfb2404fdf390c961bbc9b6b78b793a0d9bfd18ced21234b";
const local = `/store-identity/v1/${sha}/logo.svg`;
function fixture(kind = "logo") {
  const location = {
    url: `${origin}/sw.js`,
    lineNumber: 0,
    columnNumber: kind === "logo" ? 14667 : 15174,
  };
  const worker = {
    sessionId: "0BEFE3C1806647A4F9956E402CA8CB65",
    targetId: "B6CC570A93625899C3BEAB880939E62C",
    targetType: "service_worker",
    targetURL: location.url,
    offline: true,
  };
  const requestId = kind === "logo" ? "25004.96" : "25004.98";
  const url = kind === "logo" ? logo : `${origin}/`;
  const warm = {
    url: `${origin}/assets/index-jyJtWIjx.js`,
    lineNumber: 4,
    columnNumber: 10592,
  };
  const events = [
    {
      ...worker,
      kind: "request",
      requestId,
      url,
      method: "GET",
      type: "Fetch",
      initiatorDetails: { type: "script", stack: { callFrames: [location] } },
    },
    {
      ...worker,
      kind: "network-failed",
      requestId,
      url,
      type: "Fetch",
      error:
        kind === "logo"
          ? "net::ERR_TUNNEL_CONNECTION_FAILED"
          : "net::ERR_EMPTY_RESPONSE",
      canceled: false,
    },
    {
      ...worker,
      kind: "sw-exception",
      exceptionDetails: {
        exceptionId: kind === "logo" ? 1 : 3,
        text: "Uncaught (in promise)",
        ...location,
        scriptId: "3",
        stackTrace: { callFrames: [{ ...location, scriptId: "3" }] },
        exception: {
          type: "object",
          subtype: "error",
          className: "TypeError",
          description: "TypeError: Failed to fetch",
        },
        exceptionMetaData: { requestId },
      },
    },
  ];
  if (kind === "root")
    events.unshift({
      kind: "request",
      sessionId: "page-session",
      targetId: "page-target",
      targetType: "page",
      requestId: "different-page-id",
      url,
      method: "GET",
      type: "Fetch",
      offline: true,
      initiatorDetails: { type: "script", stack: { callFrames: [warm] } },
    });
  const index = {
    url: `${origin}/index.html`,
    status: 200,
    bytes: 5758,
    sha256: "974fca3dd263b5047e9c1123ab3af3f1f40878afdf9f77f3654e1359615e9bd6",
  };
  const cachedLogo = {
    url: origin + local,
    status: 200,
    bytes: 6224,
    sha256: sha,
  };
  const proof = {
    identityRevision: "active",
    storeName: "Ensaio Savy",
    logoURL: logo,
    localLogoURL: origin + local,
    logo: { bytes: 6224, sha256: sha },
    index,
    worker: {
      sha256:
        "c1a2dc3c139bd605341a1e771a5c1d569bdf8d0cb3ed2dceb6ea12b530e6e6e7",
      logo: { ...location, columnNumber: 14667 },
      root: { ...location, columnNumber: 15174 },
    },
    warmer: { ...warm, sha256: "a".repeat(64) },
  };
  const cut = {
    phase: "baseline-offline-first-reload",
    eventStart: 0,
    transportStart: 0,
    proof,
    beforeCache: [index, cachedLogo],
    afterCache: [index, cachedLogo],
    recovery: {
      currentSrc: origin + local,
      alt: "Ensaio Savy",
      header: true,
      loader: false,
      naturalWidth: 500,
      naturalHeight: 157,
      controller: `${origin}/sw.js`,
    },
  };
  const transport = [
    { type: "network-switch", offline: true },
    { type: "offline", url },
  ];
  const contract = {
    origin,
    logos: new Set([logo]),
    localPaths: new Set([
      "index.html",
      "sw.js",
      "assets/index-jyJtWIjx.js",
      local.slice(1),
    ]),
    offlineCuts: [cut],
  };
  return {
    events,
    transport,
    contract,
    cut,
    exception: events.find((e) => e.kind === "sw-exception"),
    request: events.find(
      (e) => e.targetType === "service_worker" && e.kind === "request",
    ),
    failure: events.find((e) => e.kind === "network-failed"),
  };
}
// Diagnostic controls 5/7 from the same A6c3 recording. Neither carried exceptionMetaData;
// only 7 was revoked. These are programming errors, not replacements for native events.
for (const [exceptionId, columnNumber, scriptId, revoked] of [
  [5, 20, "81", false],
  [7, 55, "82", true],
]) {
  test(`measured homonymous control ${exceptionId} remains fatal${revoked ? " after revocation" : ""}`, () => {
    const x = fixture("logo");
    const control = {
      ...x.exception,
      exceptionDetails: {
        exceptionId,
        text: "Uncaught (in promise)",
        lineNumber: 0,
        columnNumber,
        scriptId,
        stackTrace: {
          callFrames: [
            {
              functionName: "",
              scriptId,
              url: "",
              lineNumber: 0,
              columnNumber,
            },
          ],
        },
        exception: {
          type: "object",
          subtype: "error",
          className: "TypeError",
          description: "TypeError: Failed to fetch",
        },
      },
    };
    x.events.push(control);
    if (revoked)
      x.events.push({
        ...control,
        kind: "sw-exception-revoked",
        details: { exceptionId, reason: "Handler added to rejected promise" },
      });
    assert.throws(
      () => assertObservations(x.events, x.transport, x.contract),
      /OFFLINE_NATIVE_METADATA/,
    );
    assert(x.events.includes(control), "CONTROL_REMOVED");
  });
}
for (const kind of ["logo", "root"]) {
  test(`native ${kind} rejection passes only with the separate recovery and physical-cut proof`, () => {
    const x = fixture(kind);
    const before = structuredClone(x.events);
    const classified = assertObservations(x.events, x.transport, x.contract);
    assert.equal(classified.length, 1);
    assert.equal(classified[0].case, kind);
    assert.equal(classified[0].requestId, x.request.requestId);
    assert.deepEqual(x.events, before, "CLASSIFICATION_MUTATED_RAW_EVENTS");
    if (kind === "root")
      assert.notEqual(
        classified[0].pageRequest.requestId,
        classified[0].requestId,
      );
  });
  const mutations = {
    // Simulates metadata ABSENT (no key), not present-with-undefined: presence, not
    // just the value, matters for in/hasOwnProperty/serialization semantics.
    metadata: (x) => {
      const { exceptionMetaData, ...rest } = x.exception.exceptionDetails;
      x.exception.exceptionDetails = rest;
    },
    malformed: (x) =>
      (x.exception.exceptionDetails.exceptionMetaData.requestId = 123),
    requestId: (x) =>
      (x.exception.exceptionDetails.exceptionMetaData.requestId = "unknown"),
    session: (x) => (x.failure.sessionId = "other"),
    target: (x) => (x.failure.targetId = "other"),
    method: (x) => (x.request.method = "POST"),
    query: (x) => (x.request.url += "?extra=1"),
    url: (x) => (x.request.url = `${logo}/wrong-brand`),
    failureURL: (x) => (x.failure.url = `${origin}/other`),
    orphan: (x) => (x.failure.unassociated = true),
    redirect: (x) => (x.request.redirectFrom = `${origin}/old`),
    cors: (x) => (x.failure.corsErrorStatus = { corsError: "InvalidResponse" }),
    csp: (x) => (x.failure.blockedReason = "csp"),
    errorCode: (x) => (x.failure.error = "net::ERR_CONNECTION_RESET"),
    canceled: (x) => (x.failure.canceled = true),
    initiator: (x) =>
      x.request.initiatorDetails.stack.callFrames[0].columnNumber++,
    location: (x) => x.exception.exceptionDetails.columnNumber++,
    exceptionStack: (x) =>
      (x.exception.exceptionDetails.stackTrace.callFrames[0].url = "eval"),
    notWorker: (x) => (x.exception.targetType = "page"),
    outsideCut: (x) => (x.cut.eventStart = x.events.length),
    failureOutsideCut: (x) => (x.cut.eventEnd = x.events.indexOf(x.failure)),
    noPhysicalCut: (x) => (x.transport.length = 0),
    onlineSwitch: (x) =>
      x.transport.push({ type: "network-switch", offline: false }),
    physicalResponse: (x) =>
      x.transport.push({ type: "response", status: 200 }),
    noRecovery: (x) => (x.cut.recovery = null),
    wrongLogo: (x) => (x.cut.recovery.currentSrc = `${origin}/wrong-logo.svg`),
    loader: (x) => (x.cut.recovery.loader = true),
    noHeader: (x) => (x.cut.recovery.header = false),
    missingIndex: (x) => x.cut.afterCache.shift(),
    duplicateException: (x) => x.events.push(structuredClone(x.exception)),
    duplicateRequest: (x) => x.events.unshift(structuredClone(x.request)),
    revokedOnly: (x) => {
      const { exceptionMetaData, ...rest } = x.exception.exceptionDetails;
      x.exception.exceptionDetails = rest;
      x.events.push({
        ...x.exception,
        kind: "sw-exception-revoked",
        details: {
          exceptionId: 1,
          reason: "Handler added to rejected promise",
        },
      });
    },
    lateUnexpected: (x) =>
      x.events.push({ kind: "sw-exception", text: "Failed to fetch" }),
  };
  if (kind === "logo") {
    mutations.previouslyCached = (x) =>
      x.cut.beforeCache.push({ url: logo, status: 200 });
    mutations.missingLocalLogo = (x) => x.cut.afterCache.pop();
  } else {
    mutations.previouslyCached = (x) =>
      x.cut.beforeCache.push({ url: `${origin}/`, status: 200 });
    mutations.noWarmer = (x) => x.events.shift();
    mutations.wrongWarmer = (x) =>
      x.events[0].initiatorDetails.stack.callFrames[0].columnNumber++;
    mutations.ambiguousWarmer = (x) =>
      x.events.unshift(structuredClone(x.events[0]));
    mutations.unknownCompetingWarmer = (x) => {
      const other = structuredClone(x.events[0]);
      other.initiatorDetails.stack.callFrames[0].url = "unknown";
      x.events.unshift(other);
    };
  }
  for (const [name, mutate] of Object.entries(mutations))
    test(`${kind} refuses ${name}`, () => {
      const x = fixture(kind);
      mutate(x);
      assert.throws(() =>
        assertObservations(x.events, x.transport, x.contract),
      );
    });
}
