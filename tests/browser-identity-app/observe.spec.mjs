import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { assertObservations, serviceOrigin } from "./contracts.mjs";
import { control, write } from "./evidence.mjs";
import { observe, safe } from "./observe.mjs";
import { launch } from "./preflight.mjs";

class Session extends EventEmitter {
  constructor(name) {
    super();
    this.name = name;
    this.commands = [];
  }
  id() {
    return this.name;
  }
  async send(method) {
    this.commands.push(method);
    if (method === "Network.enable")
      assert(
        this.listenerCount("Network.requestWillBeSent") > 0,
        "HANDLER_AFTER_ENABLE",
      );
    if (method === "Runtime.enable" && this.failRuntime)
      throw new Error("runtime setup failed");
    return { targetInfo: { targetId: "page-target", type: "page" } };
  }
  async detach() {
    this.detached = true;
  }
}
async function setup() {
  const sessions = new Map();
  const root = new Session("root");
  root.connection = () => ({ session: (id) => sessions.get(id) });
  const pageSession = new Session("page-session");
  const page = Object.assign(new EventEmitter(), {
    createCDPSession: async () => pageSession,
    evaluateOnNewDocument: async () => {},
  });
  const browser = Object.assign(new EventEmitter(), {
    target: () => ({ createCDPSession: async () => root }),
  });
  const evidence = [];
  const observer = await observe(page, browser, evidence);
  async function attach(name, failRuntime = false) {
    const worker = new Session(name);
    worker.failRuntime = failRuntime;
    sessions.set(name, worker);
    // Legacy observer uses targetcreated, corrected observer uses browser CDP auto-attach.
    browser.emit("targetcreated", {
      type: () => "service_worker",
      createCDPSession: async () => worker,
    });
    root.emit("Target.attachedToTarget", {
      sessionId: name,
      targetInfo: {
        targetId: `${name}-target`,
        type: "service_worker",
        url: "http://127.0.0.1/sw.js",
      },
      waitingForDebugger: true,
    });
    await observer.finish();
    return worker;
  }
  return { evidence, observer, attach, root, pageSession };
}
const request = (url, id = "same") => ({
  requestId: id,
  request: { url, method: "GET" },
  type: "Fetch",
  initiator: { type: "script" },
});
test("native exception details, revocation and network cause survive collection without mutating events", async () => {
  const { evidence, attach, observer } = await setup();
  const worker = await attach("worker");
  const details = {
    exceptionId: 1,
    text: "Uncaught (in promise)",
    lineNumber: 0,
    columnNumber: 14667,
    exceptionMetaData: { requestId: "25004.96" },
    exception: {
      type: "object",
      subtype: "error",
      className: "TypeError",
      description: "Failed to fetch",
    },
  };
  worker.emit(
    "Network.requestWillBeSent",
    request("http://127.0.0.1/allowed", "25004.96"),
  );
  worker.emit("Network.loadingFailed", {
    requestId: "25004.96",
    timestamp: 123,
    type: "Fetch",
    errorText: "net::ERR_FAILED",
    corsErrorStatus: { corsError: "InvalidResponse" },
    blockedReason: "csp",
  });
  worker.emit("Runtime.exceptionThrown", {
    timestamp: 456,
    exceptionDetails: details,
  });
  worker.emit("Runtime.exceptionRevoked", {
    exceptionId: 1,
    reason: "Handler added to rejected promise",
  });
  await observer.finish();
  const original = evidence.find((e) => e.kind === "sw-exception");
  assert.deepEqual(original.exceptionDetails, details, "NATIVE_METADATA_LOST");
  assert.equal(original.timestamp, 456);
  assert.equal(original.sessionId, "worker");
  assert.deepEqual(
    evidence.find((e) => e.kind === "sw-exception-revoked").details,
    { exceptionId: 1, reason: "Handler added to rejected promise" },
  );
  assert.deepEqual(
    evidence.find((e) => e.kind === "network-failed").corsErrorStatus,
    { corsError: "InvalidResponse" },
  );
  assert.equal(
    evidence.find((e) => e.kind === "network-failed").timestamp,
    123,
  );
  assert.deepEqual(
    evidence.find((e) => e.kind === "request").initiatorDetails,
    { type: "script" },
  );
  assert(evidence.includes(original), "REVOCATION_ERASED_EXCEPTION");
});
test("worker request URL survives failure; same requestId in separate sessions never merges", async () => {
  const { evidence, attach, observer } = await setup();
  const a = await attach("worker-a");
  const b = await attach("worker-b");
  a.emit(
    "Network.requestWillBeSent",
    request("https://example.invalid/unexpected?apikey=secret"),
  );
  b.emit("Network.requestWillBeSent", request("http://127.0.0.1/allowed"));
  a.emit("Network.loadingFailed", {
    requestId: "same",
    type: "Fetch",
    errorText: "net::ERR_TUNNEL_CONNECTION_FAILED",
  });
  b.emit("Network.responseReceived", {
    requestId: "same",
    response: { url: "http://127.0.0.1/allowed", status: 200 },
  });
  await observer.finish();
  const failed = evidence.find((e) => e.kind === "network-failed");
  assert.equal(
    failed?.url,
    "https://example.invalid/unexpected?apikey=[public-key-redacted]",
    "SW_URL_LOST",
  );
  assert.equal(failed.sessionId, "worker-a");
  assert.equal(failed.targetId, "worker-a-target");
  assert.equal(
    evidence.find((e) => e.kind === "network-response").sessionId,
    "worker-b",
  );
  assert(!JSON.stringify(evidence).includes("=secret"));
});
test("redirect chain and unassociated failures remain explicit", async () => {
  const { evidence, attach, observer } = await setup();
  const worker = await attach("worker");
  worker.emit("Network.requestWillBeSent", request("http://127.0.0.1/a"));
  worker.emit("Network.requestWillBeSent", {
    ...request("https://example.invalid/redirect"),
    redirectResponse: { url: "http://127.0.0.1/a", status: 302 },
  });
  worker.emit("Network.loadingFailed", {
    requestId: "missing",
    errorText: "net::ERR_FAILED",
  });
  await observer.finish();
  assert(
    evidence.some(
      (e) => e.kind === "request" && e.redirectFrom === "http://127.0.0.1/a",
    ),
  );
  assert(
    evidence.some(
      (e) => e.kind === "observer-error" && e.requestId === "missing",
    ),
  );
});
test("SW bootstrap response retains its supplied URL without inventing a request start", async () => {
  const { evidence, attach, observer } = await setup();
  const worker = await attach("worker");
  worker.emit("Network.responseReceived", {
    requestId: "bootstrap",
    response: { url: "http://127.0.0.1/sw.js", status: 200 },
    type: "Script",
  });
  worker.emit("Network.loadingFinished", { requestId: "bootstrap" });
  worker.emit("Network.loadingFinished", { requestId: "worker-target" });
  await observer.finish();
  const response = evidence.find((e) => e.kind === "network-response");
  assert.equal(response.url, "http://127.0.0.1/sw.js");
  assert.equal(response.unassociated, true);
  assert(!evidence.some((e) => e.kind === "request"), "INVENTED_REQUEST_START");
  assert(!evidence.some((e) => e.kind === "observer-error"));
  assert(
    evidence.some((e) => e.kind === "bootstrap-finished" && e.url === null),
  );
});
test("unknown response URL without requestWillBeSent and orphan failure cannot certify a worker", async () => {
  const { evidence, attach, observer } = await setup();
  const worker = await attach("worker");
  worker.emit("Network.responseReceived", {
    requestId: "unknown",
    response: { url: "https://example.invalid/no-start", status: 200 },
    type: "Fetch",
  });
  worker.emit("Network.loadingFailed", {
    requestId: "orphan",
    errorText: "net::ERR_FAILED",
  });
  await observer.finish();
  assert(
    evidence.some(
      (e) =>
        e.kind === "network-response" &&
        e.responseURL === "https://example.invalid/no-start" &&
        e.unassociated,
    ),
  );
  assert(
    evidence.some(
      (e) =>
        e.kind === "network-failed" &&
        e.requestId === "orphan" &&
        e.url === null,
    ),
  );
  assert.throws(
    () => assertObservations(evidence, [], contract),
    /OBSERVATION_FAILURE/,
  );
});
test("listeners precede Network.enable and paused worker resumes only after collection is enabled", async () => {
  const { attach, root } = await setup();
  const worker = await attach("worker");
  assert(
    root.commands.includes("Target.autoAttachRelated"),
    "EARLY_AUTOATTACH_MISSING",
  );
  assert(
    worker.commands.indexOf("Network.enable") <
      worker.commands.indexOf("Runtime.runIfWaitingForDebugger"),
  );
});
test("failed worker instrumentation is drained, recorded and still releases its debugger pause", async () => {
  const { attach, evidence } = await setup();
  const worker = await attach("worker", true);
  assert(worker.commands.includes("Runtime.runIfWaitingForDebugger"));
  assert(
    evidence.some(
      (e) =>
        e.kind === "observer-error" &&
        e.message.includes("runtime setup failed"),
    ),
  );
  assert.throws(
    () => assertObservations(evidence, [], contract),
    /OBSERVATION_FAILURE/,
  );
});

const contract = {
  origin: "http://127.0.0.1",
  localPaths: new Set(["allowed", "version.json"]),
  logos: new Set([`${serviceOrigin}/storage/logo.png`]),
};
test("same closed classification for page/SW, with explicit font, Realtime and offline refusals", () => {
  const font =
    "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap";
  const realtime = `${serviceOrigin.replace("https:", "wss:")}/realtime/v1/websocket?apikey=[public-key-redacted]&vsn=2.0.0&events_per_second=10`;
  for (const targetType of ["page", "service_worker"]) {
    for (const url of [font, realtime, "http://127.0.0.1/allowed"]) {
      const kind = url === realtime ? "websocket-error" : "network-failed";
      assert.doesNotThrow(() =>
        assertObservations(
          [{ kind, url, targetType, offline: url.includes("/allowed") }],
          [],
          contract,
        ),
      );
    }
    for (const url of [
      "https://clients2.google.com/unexpected",
      "https://fonts.googleapis.com/unexpected",
      `${serviceOrigin}/rest/v1/users`,
      "http://127.0.0.1/unknown",
      `${realtime}&vsn=2.0.0`,
    ]) {
      assert.throws(
        () =>
          assertObservations(
            [
              {
                kind: "request",
                url,
                method: "GET",
                targetType,
                offline: true,
              },
            ],
            [],
            contract,
          ),
        /UNEXPECTED/,
      );
    }
  }
  assert.throws(
    () =>
      assertObservations(
        [
          {
            kind: "network-failed",
            url: "http://127.0.0.1/allowed",
            error: "net::ERR_FAILED",
          },
        ],
        [],
        contract,
      ),
    /NETWORK_FAILURE/,
  );
  assert.throws(
    () =>
      assertObservations(
        [
          {
            kind: "network-response",
            url: "http://127.0.0.1/allowed",
            responseURL: "https://example.invalid/mismatched-response",
            status: 200,
          },
        ],
        [],
        contract,
      ),
    /UNEXPECTED/,
  );
});

test(
  "real closed-proxy fixture captures first SW request and its next version",
  { skip: !process.env.A6C2_EVIDENCE, timeout: 45000 },
  async () => {
    const directory = path.resolve(process.env.A6C2_EVIDENCE);
    assert.equal(path.dirname(directory), path.resolve(control));
    assert(/^tarefa-A6c[24]-/.test(path.basename(directory)));
    let version = 1;
    const sockets = new Set();
    const network = [];
    const events = [];
    const profiles = [];
    let origin;
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, origin);
      if (url.origin !== origin || req.headers.host !== new URL(origin).host) {
        network.push({ type: "deny", url: safe(url.href) });
        res.writeHead(403).end();
        return;
      }
      network.push({ type: "local", url: url.href });
      res.setHeader("Cache-Control", "no-store");
      if (url.pathname === "/") {
        res.setHeader("Content-Type", "text/html");
        res.end("<!doctype html><title>Observer fixture</title>");
      } else if (url.pathname === "/sw.js") {
        res.setHeader("Content-Type", "text/javascript");
        res.end(`const started = fetch('https://example.invalid/start-v${version}').catch(() => 'refused');
        const local = fetch('/allowed-v${version}');
        self.addEventListener('install', event => event.waitUntil(Promise.all([started, local]).then(() => self.skipWaiting())));
        self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
        setTimeout(() => {
          fetch('/native-error-v${version}');
          Promise.reject(new TypeError('Failed to fetch'));
          const late = Promise.reject(new TypeError('Failed to fetch'));
          setTimeout(() => late.catch(() => {}), 200);
        }, 0);`);
      } else if (
        ["/native-error-v1", "/native-error-v2"].includes(url.pathname)
      )
        requestFailure();
      else if (
        ["/allowed-v1", "/allowed-v2", "/favicon.ico"].includes(url.pathname)
      )
        res.end("local fixture");
      else res.writeHead(404).end();
      function requestFailure() {
        req.socket.destroy();
      }
    });
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("error", () => {});
      socket.once("close", () => sockets.delete(socket));
    });
    server.on("connect", (req, socket) => {
      network.push({ type: "connect-denied", url: safe(req.url) });
      socket.end(
        "HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
      );
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
    let browser;
    let observer;
    let outcome = "INCOMPLETE";
    try {
      browser = await launch(
        { proxy: origin },
        null,
        profiles,
        "a6c2-observer-fixture-only",
      );
      const page = await browser.newPage();
      observer = await observe(page, browser, events);
      await page.goto(origin, { waitUntil: "load" });
      await page.evaluate(async () => {
        await navigator.serviceWorker.register("/sw.js");
        await navigator.serviceWorker.ready;
      });
      await page.waitForFunction(() => !!navigator.serviceWorker.controller);
      await observer.finish();
      version = 2;
      await page.evaluate(async () => {
        await (await navigator.serviceWorker.getRegistration()).update();
      });
      const deadline = Date.now() + 10000;
      while (
        (!events.some(
          (e) =>
            e.kind === "network-response" && e.url === `${origin}/allowed-v2`,
        ) ||
          events.filter((e) => e.kind === "sw-exception-revoked").length < 2) &&
        Date.now() < deadline
      )
        await new Promise((resolve) => setTimeout(resolve, 25));
      await observer.finish();
      const starts = [1, 2].map((v) =>
        events.find(
          (e) =>
            e.kind === "request" &&
            e.targetType === "service_worker" &&
            e.url === `https://example.invalid/start-v${v}`,
        ),
      );
      assert(starts.every(Boolean), "FIRST_OR_NEXT_SW_REQUEST_MISSING");
      assert.notEqual(starts[0].sessionId, starts[1].sessionId);
      assert.notEqual(starts[0].targetId, starts[1].targetId);
      for (const start of starts) {
        const errors = events.filter(
          (e) => e.kind === "sw-exception" && e.sessionId === start.sessionId,
        );
        const native = errors.filter(
          (e) => e.exceptionDetails?.exceptionMetaData?.requestId,
        );
        const controls = errors.filter(
          (e) => !e.exceptionDetails?.exceptionMetaData?.requestId,
        );
        assert.equal(native.length, 1, "NATIVE_EXCEPTION_NOT_COLLECTED");
        assert.equal(controls.length, 2, "HOMONYMOUS_CONTROLS_NOT_COLLECTED");
        const nativeId = native[0].exceptionDetails.exceptionMetaData.requestId;
        assert(
          events.some(
            (e) =>
              e.kind === "request" &&
              e.sessionId === start.sessionId &&
              e.requestId === nativeId &&
              e.url.startsWith(`${origin}/native-error-v`),
          ),
          "NATIVE_REQUEST_LINK",
        );
        assert(
          events.some(
            (e) =>
              e.kind === "network-failed" &&
              e.sessionId === start.sessionId &&
              e.requestId === nativeId,
          ),
          "NATIVE_FAILURE_LINK",
        );
        assert(
          controls.some((c) =>
            events.some(
              (e) =>
                e.kind === "sw-exception-revoked" &&
                e.sessionId === c.sessionId &&
                e.details.exceptionId === c.exceptionDetails.exceptionId,
            ),
          ),
          "NATIVE_REVOCATION_MISSING",
        );
        assert(
          controls.every((c) =>
            c.exceptionDetails.exception.description.includes(
              "Failed to fetch",
            ),
          ),
        );
      }
      for (const start of starts)
        assert(
          events.some(
            (e) =>
              e.kind === "network-failed" &&
              e.url === start.url &&
              e.sessionId === start.sessionId &&
              e.requestId === start.requestId,
          ),
          "FAILED_REQUEST_IDENTITY_MISSING",
        );
      const fixtureContract = {
        origin,
        localPaths: new Set([
          "index.html",
          "sw.js",
          "allowed-v1",
          "allowed-v2",
          "favicon.ico",
        ]),
        logos: new Set(),
      };
      assert.throws(
        () => assertObservations(events, [], fixtureContract),
        /UNEXPECTED_APP_REQUEST.*example.invalid/,
      );
      // Local allowed requests are a positive control using the same observer/contract.
      const allowed = events.filter((e) =>
        e.url?.startsWith(`${origin}/allowed-v`),
      );
      assert(
        allowed.some(
          (e) =>
            e.kind === "network-response" &&
            e.url.endsWith("v1") &&
            e.status === 200,
        ),
      );
      assert(
        allowed.some(
          (e) =>
            e.kind === "network-response" &&
            e.url.endsWith("v2") &&
            e.status === 200,
        ),
      );
      assert.doesNotThrow(() =>
        assertObservations(allowed, [], fixtureContract),
      );
      assert(
        !events.some((e) => e.kind === "observer-error"),
        JSON.stringify(events.filter((e) => e.kind === "observer-error")),
      );
      outcome = "PASS";
    } finally {
      const closeErrors = [];
      for (const close of [
        async () => {
          if (browser?.connected) await browser.close();
        },
        async () => {
          await observer?.close();
        },
        async () => {
          for (const socket of sockets) socket.destroy();
          await new Promise((resolve) => server.close(resolve));
        },
      ]) {
        try {
          await close();
        } catch (error) {
          closeErrors.push(safe(error.stack));
        }
      }
      if (
        closeErrors.length ||
        events.some((e) => e.kind === "observer-error") ||
        profiles.some((profile) => !profile.closed) ||
        server.listening
      )
        outcome = "FAIL";
      await write(directory, "fixture-browser-events.json", events);
      await write(directory, "fixture-proxy-events.json", network);
      await write(directory, "fixture-result.json", {
        outcome,
        profiles,
        closeErrors,
        listening: server.listening,
        sockets: sockets.size,
        scope:
          "minimal fixture only; no app build, artifact, TLS, SW or cache changed",
      });
    }
    assert.equal(outcome, "PASS");
    assert(profiles.every((profile) => profile.closed));
    assert(!server.listening);
    assert(
      !events.some((e) => e.kind === "observer-error"),
      "LATE_OBSERVER_FAILURE",
    );
  },
);
