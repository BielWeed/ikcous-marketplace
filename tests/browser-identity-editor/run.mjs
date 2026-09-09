/* eslint-disable security/detect-non-literal-fs-filename -- Fixed evidence/repository roots, own generated filenames. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, mkdtemp, stat } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import sharp from "sharp";
import { hash } from "../identity-admin-http/environment.mjs";
import { adminId, createDatabaseBench, virtualOrigin } from "./database.mjs";
import { createTransport, installFetchBridge, storageOrigin } from "./transport.mjs";

assert.equal(process.argv.length, 2, "NO_ARGUMENTS");
const root = fileURLToPath(new URL("../../", import.meta.url));
const runId = `${Date.now()}_${randomBytes(2).toString("hex")}`;
const output = `C:/Users/Gabriel/recuperacao-ikcous/20260909-ecossistema/controle/tarefa-A5e2-${runId}`;
await mkdir(output);
const expectedCases = [
  "initial-desktop-mobile-accessibility", "draft-survives-context-config", "common-upload-save-original-bytes",
  "explicit-opening-association", "invalid-role-zero-upload", "explicit-source-without-reupload",
  "cancel-first-chunk", "reload-resume-same-original", "real-conflict-no-automatic-save", "explicit-conflict-reconciliation",
  "lost-real-200-readback", "lost-real-200-pending", "failed-manual-read-stays-pending", "manual-read-confirms-without-save",
  "pending-different-read-conflict", "inactive-upload-ignores-late-response", "inactive-save-after-real-200",
  "changed-user-save-after-real-200", "same-identity-no-op", "server-denies-fixture-admin", "gesture-oracle-refutation",
];
const evidence = { runId, startedAt: new Date().toISOString(), expectedCases, cases: [], images: [], resources: [],
  sources: [], events: [], http: [], tus: [], captures: [], console: [], requestFailures: [], blockedBackground: [], unexpected: [], complete: false };
const bench = createDatabaseBench(root, runId, evidence);
const objects = new Map(), originals = new Map();
const transport = createTransport(objects, originals, bench.sessions, evidence);
const modes = { lost: false, readsBlocked: false, holdSave: false, heldSave: false, releaseSave: null };
let browser, server, local, page, baselineSchema, sourceBefore;
let currentCase = "setup";
const writeJSON = (name, value) => writeFile(path.join(output, name), JSON.stringify(value, null, 2));
const counts = () => ({ formSave: evidence.http.filter((c) => c.actor === "form" && c.rpc === "save_store_identity").length,
  formRead: evidence.http.filter((c) => c.actor === "form" && c.rpc === "read_store_identity").length,
  actorSave: evidence.http.filter((c) => c.actor === "other-actor" && c.rpc === "save_store_identity").length,
  post: evidence.tus.filter((c) => c.method === "POST").length,
  patch: evidence.tus.filter((c) => c.method === "PATCH").length });
async function test(name, fn) {
  currentCase = name;
  assert(expectedCases.includes(name) && !evidence.cases.some((c) => c.name === name));
  const before = counts();
  console.log(`START ${name}`);
  try { await fn(); evidence.cases.push({ name, result: "PASS", before, after: counts() }); console.log(`PASS ${name}`); }
  catch (error) {
    evidence.cases.push({ name, result: "FAIL", before, after: counts(), assertion: error.code ?? error.name });
    throw error;
  }
  await writeJSON("evidence.json", evidence);
}
async function waitNode(check, code, timeout = 60000) {
  const end = Date.now() + timeout;
  while (!check()) { assert(Date.now() < end, code); await delay(50); }
}
async function textPresent(text) {
  await page.waitForFunction((value) => document.body.innerText.includes(value), { timeout: 60000 }, text);
}
async function click(text) {
  const button = await page.waitForSelector(`::-p-text(${text})`, { timeout: 15000 });
  await button.click();
}
async function button(text) {
  const handle = await page.evaluateHandle((value) => [...document.querySelectorAll("button")].find((node) => node.textContent.trim() === value), text);
  const element = handle.asElement(); assert(element, "BUTTON_MISSING"); return element;
}
async function clickButton(text) { const target = await button(text); await target.click(); await target.dispose(); }
async function field(id, value) {
  const input = await page.$(`#${id}`); assert(input);
  await input.click({ clickCount: 3 }); await page.keyboard.down("Control"); await page.keyboard.press("A"); await page.keyboard.up("Control"); await page.keyboard.type(value);
}
const value = (id) => page.$eval(`#${id}`, (input) => input.value);
const preview = (role = "Cabeçalho") => page.$eval(`section[aria-label="Prévia: ${role}"] img`, (img) => img.getAttribute("src"));
const fixtureState = () => page.$eval("[data-fixture-state]", (node) => ({ dirty: node.dataset.dirty, refreshes: Number(node.dataset.refreshes), active: node.dataset.active, user: node.dataset.user }));
async function context(patch) {
  await page.evaluate((next) => window.identityFixtureContext(next), patch);
  await delay(75);
}
async function file(label, filePath) {
  const handle = await page.$(`input[id="identity-upload-${encodeURIComponent(label)}"]`); assert(handle, "FILE_INPUT_MISSING");
  await handle.uploadFile(filePath);
  await handle.dispose();
}
async function snapshot(label) {
  const httpRead = await bench.rpc("read_store_identity");
  assert.equal(httpRead.status, 200);
  const sql = bench.metadata();
  assert.deepEqual(httpRead.data, { revision: sql.revision, identity: sql.identity });
  await writeJSON(`database-${label}.json`, { http: httpRead.data, sql });
  return httpRead.data;
}
async function actorChange(patch) {
  const before = await bench.rpc("read_store_identity");
  const response = await bench.rpc("save_store_identity", { expected_revision: before.data.revision,
    expected_identity: before.data.identity, desired_identity: { ...before.data.identity, ...patch } }, "other-actor");
  assert.equal(response.status, 200); return response.data;
}
async function saved(readback = false) {
  await textPresent(readback ? "Esta identidade está salva no cadastro." : "Identidade salva no cadastro.");
  await page.waitForFunction(() => document.querySelector("[data-fixture-state]")?.dataset.dirty === "false");
}
async function capture(state) {
  for (const width of [1280, 390]) {
    await page.setViewport({ width, height: 1000, deviceScaleFactor: 1 });
    await page.evaluate(async () => {
      for (const image of document.querySelectorAll('section[aria-label^="Prévia:"] img')) await image.decode();
    });
    const geometry = await page.evaluate(() => {
      const previews = [...document.querySelectorAll('section[aria-label^="Prévia:"] img')];
      const inputs = [...document.querySelectorAll('input')];
      const labelErrors = inputs.filter((input) => input.labels.length === 0).map((input) => input.id);
      const overflowing = [...document.querySelectorAll('main button, main input, main [role="status"]')].filter((node) => {
        if (!node.getClientRects().length) return false;
        const r = node.getBoundingClientRect(); return r.left < -1 || r.right > innerWidth + 1;
      }).map((node) => node.tagName);
      return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
        previews: previews.map((img) => ({ width: img.naturalWidth, height: img.naturalHeight })), labelErrors, overflowing };
    });
    assert.equal(geometry.previews.length, 4);
    assert(geometry.previews.every((img) => img.width > 0 && img.height > 0));
    assert.equal(geometry.scrollWidth, width, "HORIZONTAL_OVERFLOW");
    assert.deepEqual(geometry.labelErrors, [], "MISSING_INPUT_LABEL");
    assert.deepEqual(geometry.overflowing, [], "CONTROL_OUTSIDE_VIEWPORT");
    const scroll = await page.$eval("[data-bench-scroll]", (node) => ({ height: node.clientHeight, content: node.scrollHeight, overflow: getComputedStyle(node).overflowY }));
    assert.equal(scroll.overflow, "auto");
    const offsets = [...new Set([0, Math.floor(Math.max(0, scroll.content - scroll.height) / 2), Math.max(0, scroll.content - scroll.height)])];
    for (const [part, offset] of offsets.entries()) {
      await page.$eval("[data-bench-scroll]", (node, top) => { node.scrollTop = top; }, offset);
      // Production CSS uses smooth scrolling. A requested offset is not a reached offset.
      await page.waitForFunction((top) => Math.abs(document.querySelector("[data-bench-scroll]").scrollTop - top) < 1, { timeout: 10000 }, offset);
      const filename = `${state}-${width}-${part}.png`;
      await page.screenshot({ path: path.join(output, filename) });
      const actualOffset = await page.$eval("[data-bench-scroll]", (node) => node.scrollTop);
      assert(Math.abs(actualOffset - offset) < 1, "SCREENSHOT_SCROLL_NOT_SETTLED");
      evidence.captures.push({ filename, state, part, offset, actualOffset, scroll, ...geometry });
    }
    // Bottom actions must be reachable without removing any product CSS.
    const action = await button(state === "pending" ? "Conferir novamente" : state === "conflict" ? "Conferir configuração atual" : state === "upload-progress" ? "Cancelar envio" : "Salvar identidade");
    await action.scrollIntoView();
    const visible = await action.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, height: innerHeight, disabled: node.disabled,
        hit: node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)) };
    });
    assert(visible.top >= 0 && visible.bottom <= visible.height && (visible.disabled || visible.hit), "ACTION_UNREACHABLE");
    evidence.events.push({ phase: "action-reachable", state, width, ...visible });
    await action.dispose();
  }
  await page.setViewport({ width: 1280, height: 1000 });
}
async function reload() {
  await page.reload({ waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(() => typeof window.identityFixtureContext === "function");
  await context({ user: bench.sessions.admin.user, session: bench.sessions.admin, active: true, isAdmin: true, adminStatus: "admin" });
  await page.waitForSelector("#store-name", { timeout: 60000 });
}

try {
  evidence.versions = { node: process.version };
  for (const dependency of ["react", "esbuild", "puppeteer", "sharp", "tus-js-client", "@supabase/supabase-js"]) {
    const manifest = JSON.parse(await readFile(path.join(root, "node_modules", dependency, "package.json"), "utf8"));
    evidence.versions = { ...evidence.versions, [dependency]: manifest.version };
  }
  const require = createRequire(import.meta.url);
  const fixtureBundle = await build({ absWorkingDir: root, stdin: { contents:
    'export { createIdentityBuildFixture } from "./scripts/identityBuildFixture.ts"; export { parseStoreIdentity } from "./src/lib/storeIdentity.ts";',
    resolveDir: root }, bundle: true, platform: "node", format: "esm", write: false,
    plugins: [{ name: "local-sharp-only", setup(api) { api.onResolve({ filter: /^sharp$/ }, () => ({ path: pathToFileURL(require.resolve("sharp")).href, external: true })); } }] });
  const fixtureApi = await import(`data:text/javascript;base64,${Buffer.from(fixtureBundle.outputFiles[0].text).toString("base64")}`);
  const fixtures = await Promise.all([fixtureApi.createIdentityBuildFixture("aurora"), fixtureApi.createIdentityBuildFixture("oceano")]);
  for (const fixture of fixtures) for (const object of fixture.files) objects.set(object.path, { ...object, bytes: Buffer.from(object.bytes) });
  const first = fixtures[0].identity;
  const raw = { store_name: first.storeName, store_city: null, store_state: null, primary_color: first.theme.primary,
    secondary_color: first.theme.secondary, accent_color: first.theme.accent,
    logo_url: `${virtualOrigin}/storage/v1/object/public/branding/${first.assets.header.path}`, branding_assets: first.assets };
  fixtureApi.parseStoreIdentity(raw, virtualOrigin);
  evidence.fixtures = fixtures.map((fixture) => ({ name: fixture.identity.storeName,
    objects: fixture.files.map(({ path, mediaType, sha256, bytes }) => ({ path, mediaType, sha256, bytes: bytes.length })) }));
  const makeOriginal = async (label, color, large = false) => {
    const small = await sharp({ create: { width: 32, height: 16, channels: 3, background: color } }).jpeg().toBuffer();
    let bytes = small;
    if (large) {
      let remaining = 20971520 - small.length;
      const comments = [];
      while (remaining > 0) {
        let length = Math.min(65537, remaining);
        if (remaining - length > 0 && remaining - length < 4) length -= 4 - (remaining - length);
        assert(length >= 4);
        const segment = Buffer.alloc(length, 65); segment[0] = 255; segment[1] = 254; segment.writeUInt16BE(length - 2, 2);
        comments.push(segment); remaining -= length;
      }
      bytes = Buffer.concat([small.subarray(0, 2), ...comments, small.subarray(2)]);
      assert.equal(bytes.length, 20971520);
      assert.equal(hash(await sharp(bytes, { failOn: "warning" }).raw().toBuffer()), hash(await sharp(small).raw().toBuffer()));
    }
    const sha256 = hash(bytes), objectPath = `v1/${sha256}/image.jpg`, filename = path.join(output, `${label}.jpg`);
    await writeFile(filename, bytes);
    const record = { filename, bytes, sha256, objectPath, mediaType: "image/jpeg" };
    originals.set(objectPath, record); return record;
  };
  const common = await makeOriginal("common-20MiB", "#3579ab", true);
  const resume = await makeOriginal("resume-20MiB", "#a5632b", true);
  const linked = await makeOriginal("opening-original", "#325f7c");
  const late = await makeOriginal("late-20MiB", "#c25183", true);
  evidence.originals = [...originals.values()].map(({ filename, bytes, sha256, objectPath }) => ({ filename, bytes: bytes.length, sha256, objectPath }));
  const cssPath = "C:/Users/Gabriel/recuperacao-ikcous/20260909-ecossistema/controle/tarefa-A5e2-css-39f3549a.css";
  const css = await readFile(cssPath);
  assert.equal(hash(css), "39f3549aa9f0751872b8754e27b83f282ef2cb355a47329cdd750c1be8345b0d");
  assert.equal(css.length, 279500);
  evidence.css = { path: cssPath, sha256: hash(css), bytes: css.length, provenance: "Frozen dist-test/assets/index-B3NC8_h5.css, base 34d6716 plus UI matching 9e81022; not a publication" };
  const replacements = [];
  const bundled = await build({ absWorkingDir: root, entryPoints: ["tests/browser-identity-editor/entry.tsx"], bundle: true,
    platform: "browser", mainFields: ["browser", "module", "main"], format: "esm", target: "chrome150", jsx: "automatic", write: false, metafile: true,
    define: { "import.meta.env": JSON.stringify({ VITE_SUPABASE_URL: virtualOrigin, VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic" }), "process.env.NODE_ENV": '"production"' },
    alias: { "@": path.join(root, "src") },
    plugins: [{ name: "only-context-boundaries", setup(api) {
      api.onResolve({ filter: /^@\/(hooks\/useAuth|contexts\/StoreContext)$/ }, ({ path: replaced }) => {
        replacements.push(replaced); return { path: path.join(root, "tests/browser-identity-editor/contexts.tsx") };
      });
    } }],
  });
  const inputs = Object.keys(bundled.metafile.inputs);
  for (const forbidden of [/AuthContext/, /src\/lib\/supabase\./, /src\/App\./, /vite\.config/, /\.env(?:\.|$)/]) assert(!inputs.some((name) => forbidden.test(name)), "BUNDLE_FORBIDDEN_IMPORT");
  for (const required of ["src/components/admin/settings/IdentitySettingsSection.tsx", "src/hooks/useStoreIdentityEditor.ts", "src/lib/adminStoreIdentity.ts", "src/lib/prepareIdentityImage.ts", "src/lib/uploadIdentityImage.ts", "node_modules/tus-js-client/lib.esm/browser/index.js"]) assert(inputs.includes(required), `BUNDLE_REQUIRED_${required}`);
  assert.deepEqual([...new Set(replacements)].sort(), ["@/contexts/StoreContext", "@/hooks/useAuth"]);
  const script = bundled.outputFiles[0].contents;
  await writeFile(path.join(output, "bundle.js"), script);
  await writeFile(path.join(output, "frozen.css"), css);
  await writeJSON("metafile.json", { ...bundled.metafile, fixtureReplacements: replacements });
  evidence.bundle = { bytes: script.length, sha256: hash(script), replacements, inputs };
  sourceBefore = await Promise.all([...inputs.filter((p) => !p.startsWith("node_modules/") && !p.startsWith("<define:")), "scripts/identityBuildFixture.ts", "tests/identity-admin-http/environment.mjs", "package-lock.json", "src/index.css", "src/App.tsx", "src/components/layouts/AdminArea.tsx"].map(async (p) => ({ path: p, sha256: hash(await readFile(path.join(root, p))) })));
  evidence.layoutSources = { theme: "src/App.tsx:543 adds dark to documentElement for every admin view", scroll: "src/components/layouts/AdminArea.tsx:533 provides the bounded admin scroll container" };
  evidence.sources.push(...sourceBefore);
  console.log("SETUP bundle and real synthetic assets ready");
  await bench.start(raw);
  baselineSchema = bench.schema();
  const initial = await snapshot("initial");
  assert.deepEqual(initial.identity, raw);
  evidence.baselineSchemaSha256 = hash(baselineSchema);
  server = http.createServer(async (req, res) => {
    try {
      let route = req.url;
      if (/^http:/.test(route)) {
        const url = new URL(route);
        if (url.origin === "http://clients2.google.com" && url.pathname === "/time/1/current") {
          evidence.blockedBackground.push({ host: url.host, method: req.method, phase: currentCase, refusal: 403, forwarded: false });
          res.writeHead(403).end(); return;
        }
        assert.equal(url.origin, local, "PROXY_EXTERNAL_HTTP"); route = url.pathname;
      }
      if (req.method === "GET" && route === "/") {
        res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store", "Content-Security-Policy":
          `default-src 'none'; script-src 'self'; connect-src 'self'; img-src 'self' blob: ${virtualOrigin}; style-src 'self' 'unsafe-inline'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-src 'none'` });
        res.end('<!doctype html><html lang="pt-BR" class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/style.css"><title>Identidade — bancada local</title></head><body class="bg-zinc-950"><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>'); return;
      }
      if (req.method === "GET" && route === "/favicon.svg") {
        res.writeHead(200, { "Content-Type": "image/svg+xml" });
        res.end(objects.get(raw.branding_assets.favicon.path).bytes); return;
      }
      if (req.method === "GET" && ["/bundle.js", "/style.css"].includes(route)) {
        res.writeHead(200, { "Content-Type": route.endsWith("css") ? "text/css" : "application/javascript", "Cache-Control": "no-store" });
        res.end(route.endsWith("css") ? css : script); return;
      }
      assert(route.startsWith("/wire/"), "LOCAL_ROUTE_FORBIDDEN");
      const chunks = []; let length = 0;
      for await (const chunk of req) { length += chunk.length; assert(length <= 6291456, "WIRE_BODY_LIMIT"); chunks.push(chunk); }
      const body = Buffer.concat(chunks), rpc = /^\/wire\/rest\/v1\/rpc\/(read_store_identity|save_store_identity)$/.exec(route);
      if (rpc) {
        assert.equal(req.method, "POST"); assert(body.length <= 1048576);
        if (rpc[1] === "read_store_identity" && modes.readsBlocked) {
          evidence.events.push({ phase: "injected-read-unavailable", case: currentCase, route });
          res.writeHead(200, { "x-bench-fault": "read-unavailable" }); res.end(); return;
        }
        const headers = new Headers();
        for (const [key, header] of Object.entries(req.headers)) {
          if (["authorization", "apikey", "content-type", "accept", "content-profile"].includes(key) && typeof header === "string") headers.set(key, header);
        }
        const reply = await bench.forward(rpc[1], { method: "POST", headers, body: body.toString("utf8"), redirect: "error", credentials: "omit", cache: "no-store" });
        if (rpc[1] === "save_store_identity" && reply.status === 200) {
          if (modes.holdSave) {
            modes.holdSave = false; modes.heldSave = true;
            evidence.events.push({ phase: "hold-after-real-200", case: currentCase });
            await new Promise((done) => { modes.releaseSave = done; }); modes.heldSave = false;
          }
          if (modes.lost) {
            modes.lost = false;
            evidence.events.push({ phase: "lose-after-real-200", case: currentCase, responseSha256: hash(reply.body) });
            reply.headers["x-bench-fault"] = "lost-real-200";
          }
        }
        if (!res.destroyed) { res.writeHead(reply.status, reply.headers); res.end(reply.body); }
        return;
      }
      await transport.handle(route.slice("/wire".length), req, res, body);
    } catch (error) {
      evidence.unexpected.push({ phase: "server", case: currentCase, code: error.code ?? error.message, message: String(error.message).slice(0, 120), route: req.url });
      if (!res.destroyed) res.writeHead(500).end();
    }
  });
  server.on("connect", (req, socket) => {
    const knownBackground = ["accounts.google.com:443", "android.clients.google.com:443", "content-autofill.googleapis.com:443"].includes(req.url);
    const event = { host: req.url, method: "CONNECT", phase: currentCase, refusal: 403, forwarded: false };
    if (knownBackground) evidence.blockedBackground.push(event);
    else evidence.unexpected.push({ ...event, phase: "blocked-unknown-proxy-connect" });
    socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  local = `http://127.0.0.1:${server.address().port}`;
  evidence.localOrigin = local;
  const profile = await mkdtemp(path.join(os.tmpdir(), "a5e2-"));
  evidence.profile = profile;
  browser = await puppeteer.launch({ headless: true, userDataDir: profile, args: [
    `--proxy-server=${local}`, "--proxy-bypass-list=<-loopback>", "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
    "--disable-background-networking", "--disable-component-update", "--disable-sync", "--no-first-run", "--disable-domain-reliability",
  ] });
  evidence.chrome = await browser.version();
  page = await browser.newPage(); await page.setRequestInterception(true);
  page.on("request", (request) => {
    const url = request.url();
    if (url.startsWith(`${local}/`) || url.startsWith("blob:") || url === "data:,") { void request.continue(); return; }
    const prefix = `${virtualOrigin}/storage/v1/object/public/branding/`;
    if (request.resourceType() === "image" && url.startsWith(prefix)) {
      const object = objects.get(url.slice(prefix.length));
      if (object) { void request.respond({ status: 200, contentType: object.mediaType, body: object.bytes }); return; }
    }
    evidence.unexpected.push({ phase: "blocked-browser-request", url }); void request.abort();
  });
  page.on("console", (message) => evidence.console.push({ type: message.type(), text: message.text(), location: message.location().url, case: currentCase }));
  page.on("pageerror", (error) => evidence.unexpected.push({ phase: "pageerror", name: error.name, message: error.message }));
  page.on("requestfailed", (request) => {
    const response = request.response();
    const headers = response?.headers() ?? {};
    const entry = { url: request.url(), method: request.method(), status: response?.status() ?? null, error: request.failure()?.errorText, case: currentCase };
    const canceled = ["cancel-first-chunk", "inactive-upload-ignores-late-response", "inactive-save-after-real-200", "changed-user-save-after-real-200"].includes(currentCase)
      && entry.error === "net::ERR_ABORTED" && /^\/wire\/(?:storage\/v1\/upload\/resumable\/id[0-9]+|rest\/v1\/rpc\/save_store_identity)$/.test(new URL(entry.url).pathname);
    const traceId = Number(headers["x-bench-tus-trace"]), trace = evidence.tus[traceId - 1];
    const discard = entry.error === "net::ERR_ABORTED" && trace && trace.method === entry.method
      && `${local}/wire${trace.route}` === entry.url && trace.status === entry.status
      && ((entry.method === "POST" && entry.status === 201) || (entry.method === "HEAD" && entry.status === 200) || (entry.method === "PATCH" && entry.status === 204));
    const fault = headers["x-bench-fault"];
    const injected = entry.error === "net::ERR_ABORTED" && entry.status === 200
      && ((fault === "lost-real-200" && entry.url === `${local}/wire/rest/v1/rpc/save_store_identity`)
        || (fault === "read-unavailable" && entry.url === `${local}/wire/rest/v1/rpc/read_store_identity`));
    evidence.requestFailures.push({ ...entry, classification: canceled ? "context-or-user-abort" : discard ? "tus-discard-body-after-headers" : injected ? fault : "unexpected", ...(discard ? { traceId } : {}) });
    if (!canceled && !discard && !injected) evidence.unexpected.push({ phase: "requestfailed", ...entry });
  });
  await page.evaluateOnNewDocument(installFetchBridge, virtualOrigin, storageOrigin, local);
  await page.goto(local, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => typeof window.identityFixtureContext === "function");
  await context({ user: bench.sessions.admin.user, session: bench.sessions.admin });
  await page.waitForSelector("#store-name", { timeout: 60000 });
  await test("initial-desktop-mobile-accessibility", async () => {
    assert.equal(await value("store-name"), raw.store_name);
    await capture("initial");
    await page.focus("#store-name"); await page.keyboard.press("Tab");
    const focus = await page.evaluate(() => ({ id: document.activeElement.id, ring: getComputedStyle(document.activeElement).boxShadow, outline: getComputedStyle(document.activeElement).outlineStyle }));
    assert.equal(focus.id, "store-city"); assert(focus.ring !== "none" || focus.outline !== "none", "NO_KEYBOARD_FOCUS_INDICATOR");
    evidence.keyboard = focus;
  });
  await test("draft-survives-context-config", async () => {
    await field("store-name", "Loja Horizonte — Ensaio"); await field("store-color-hex", "#34678A");
    await context({ config: { businessHours: "Fixture 10h–20h", shippingFee: 99 } });
    assert.equal(await value("store-name"), "Loja Horizonte — Ensaio"); assert.equal(await value("store-color-hex"), "#34678A");
    assert.equal(counts().formSave, 0);
  });
  await test("common-upload-save-original-bytes", async () => {
    const before = counts(), refreshes = (await fixtureState()).refreshes;
    await file("Trocar cabeçalho", common.filename); await textPresent("Imagem conferida no rascunho.");
    assert((await preview()).endsWith(common.objectPath)); assert.equal(await preview("Abertura"), raw.logo_url);
    assert.equal(counts().formSave, before.formSave); await capture("draft-image");
    await (await button("Salvar identidade")).focus(); await page.keyboard.press("Enter"); await saved();
    assert.equal(counts().formSave, before.formSave + 1); assert.equal((await fixtureState()).refreshes, refreshes + 1);
    const actual = await snapshot("common-save");
    assert.equal(actual.identity.store_name, "Loja Horizonte — Ensaio"); assert.equal(actual.identity.primary_color, "#34678A");
    assert.equal(actual.identity.branding_assets.header.sha256, common.sha256);
    assert.equal(actual.identity.branding_assets.header.bytes, common.bytes.length);
    assert.equal(hash(objects.get(common.objectPath).bytes), common.sha256);
    assert.deepEqual(actual.identity, { ...raw, store_name: "Loja Horizonte — Ensaio", primary_color: "#34678A",
      logo_url: `${virtualOrigin}/storage/v1/object/public/branding/${common.objectPath}`,
      branding_assets: { ...raw.branding_assets, header: { path: common.objectPath, sha256: common.sha256, bytes: common.bytes.length, media_type: "image/jpeg", width: 32, height: 16 } } });
    assert.deepEqual(Object.fromEntries(Object.entries(actual.identity.branding_assets).filter(([key]) => key !== "header")),
      Object.fromEntries(Object.entries(raw.branding_assets).filter(([key]) => key !== "header")));
  });
  await test("explicit-opening-association", async () => {
    await page.click('section[aria-label="Prévia: Cabeçalho"] input[type="checkbox"]');
    await file("Trocar cabeçalho", linked.filename); await textPresent("Imagem conferida no rascunho.");
    assert((await preview()).endsWith(linked.objectPath)); assert.equal(await preview("Abertura"), await preview());
  });
  await test("invalid-role-zero-upload", async () => {
    const before = counts(); await file("Trocar compartilhamento", linked.filename);
    await textPresent("Não foi possível conferir esta imagem."); assert.deepEqual(counts(), before);
    assert((await preview("Compartilhamento")).endsWith(raw.branding_assets.og.path));
  });
  await test("explicit-source-without-reupload", async () => {
    await page.click("details summary"); const before = counts();
    await clickButton("Guardar cabeçalho como fonte"); await textPresent("Fontes guardadas (2/8)");
    assert.equal(counts().post, before.post); await clickButton("Salvar identidade"); await saved();
    const actual = await snapshot("source"); assert.equal(actual.identity.branding_assets.originals[1].sha256, linked.sha256);
    assert.equal(actual.identity.branding_assets.loader.sha256, linked.sha256); await page.click("details summary");
  });
  let canceledPreview;
  await test("cancel-first-chunk", async () => {
    canceledPreview = await preview(); const before = counts(); transport.pause();
    await file("Trocar cabeçalho", resume.filename); await waitNode(() => transport.held === 1, "FIRST_CHUNK_NOT_HELD");
    await capture("upload-progress");
    await clickButton("Cancelar envio"); await textPresent("Envio cancelado.");
    transport.release(); await delay(400);
    assert.equal(await preview(), canceledPreview); assert.equal(counts().formSave, before.formSave);
    assert.equal(counts().patch, before.patch + 1); assert.equal(evidence.tus.at(-1).accepted, 6291456);
  });
  await test("reload-resume-same-original", async () => {
    const before = counts(); await reload(); await file("Trocar cabeçalho", resume.filename); await textPresent("Imagem conferida no rascunho.");
    assert.equal(counts().post, before.post);
    assert(evidence.tus.some((entry) => entry.method === "HEAD" && entry.offset === 6291456));
    const chunks = evidence.tus.filter((entry) => entry.method === "PATCH" && entry.resource === evidence.tus.find((entry) => entry.heldAfterAccept)?.resource);
    assert.deepEqual(chunks.map((entry) => entry.offset), [0, 6291456, 12582912, 18874368]);
    await clickButton("Salvar identidade"); await saved(); const actual = await snapshot("resumed");
    assert.equal(actual.identity.branding_assets.header.sha256, resume.sha256); assert.equal(hash(objects.get(resume.objectPath).bytes), resume.sha256);
  });
  await test("real-conflict-no-automatic-save", async () => {
    await field("store-name", "Meu rascunho conservado"); const before = counts();
    await actorChange({ store_city: "Cidade do outro ator" }); await clickButton("Salvar identidade"); await textPresent("Outra configuração foi encontrada.");
    assert.equal(counts().formSave, before.formSave + 1); assert.equal(counts().actorSave, before.actorSave + 1);
    assert.equal(await value("store-name"), "Meu rascunho conservado");
    assert.equal(evidence.http.filter((c) => c.actor === "form" && c.rpc === "save_store_identity").at(-1).status, 400);
    await capture("conflict");
  });
  await test("explicit-conflict-reconciliation", async () => {
    const before = counts(); await clickButton("Conferir configuração atual"); await textPresent("Sua escolha / configuração atual:");
    assert.equal(counts().formSave, before.formSave); await clickButton("Revisar meu rascunho"); await textPresent("Rascunho revisado.");
    assert.equal(await value("store-city"), "Cidade do outro ator"); assert.equal(await value("store-name"), "Meu rascunho conservado");
    assert.equal(counts().formSave, before.formSave); await clickButton("Salvar identidade"); await saved();
    const actual = await snapshot("reconciled"); assert.equal(actual.identity.store_city, "Cidade do outro ator"); assert.equal(actual.identity.store_name, "Meu rascunho conservado");
  });
  await test("lost-real-200-readback", async () => {
    const before = counts(); await field("store-name", "Resposta perdida com leitura"); modes.lost = true;
    await clickButton("Salvar identidade"); await saved(true);
    assert.equal(counts().formSave, before.formSave + 1); assert.equal(counts().formRead, before.formRead + 1);
    assert.equal((await snapshot("lost-readback")).identity.store_name, "Resposta perdida com leitura");
  });
  let pendingCounts;
  await test("lost-real-200-pending", async () => {
    const before = counts(); await field("store-name", "Pendente até conferir"); modes.lost = true; modes.readsBlocked = true;
    await clickButton("Salvar identidade"); await textPresent("A confirmação está pendente."); pendingCounts = counts();
    assert.equal(pendingCounts.formSave, before.formSave + 1);
    assert.equal(await value("store-name"), "Pendente até conferir");
    assert.equal(await (await button("Salvar identidade")).evaluate((node) => node.disabled), true);
    assert.equal(await page.$eval('input[type="file"]', (node) => node.disabled), true);
    assert.equal((await snapshot("pending-committed")).identity.store_name, "Pendente até conferir"); await capture("pending");
  });
  await test("failed-manual-read-stays-pending", async () => {
    const injections = evidence.events.filter((event) => event.phase === "injected-read-unavailable").length;
    await clickButton("Conferir novamente"); await textPresent("Não foi possível conferir agora.");
    assert.equal(evidence.events.filter((event) => event.phase === "injected-read-unavailable").length, injections + 1);
    assert.equal(counts().formSave, pendingCounts.formSave); assert.equal(await value("store-name"), "Pendente até conferir");
  });
  await test("manual-read-confirms-without-save", async () => {
    modes.readsBlocked = false; const before = counts(); await clickButton("Conferir novamente"); await saved(true);
    assert.equal(counts().formSave, before.formSave); assert.equal(counts().formRead, before.formRead + 1);
  });
  await test("pending-different-read-conflict", async () => {
    await field("store-name", "Rascunho de pendência divergente"); modes.lost = true; modes.readsBlocked = true;
    await clickButton("Salvar identidade"); await textPresent("A confirmação está pendente.");
    await actorChange({ store_city: "Mudou enquanto pendente" }); modes.readsBlocked = false;
    const before = counts(); await clickButton("Conferir novamente"); await textPresent("Outra configuração foi encontrada.");
    assert.equal(counts().formSave, before.formSave); assert.equal(await value("store-name"), "Rascunho de pendência divergente");
    await clickButton("Usar configuração atual");
  });
  await test("inactive-upload-ignores-late-response", async () => {
    await field("store-name", "Texto mantido ao inativar"); const before = counts(), previous = await preview(); transport.pause();
    await file("Trocar cabeçalho", late.filename); await waitNode(() => transport.held === 1, "INACTIVE_CHUNK_NOT_HELD");
    await context({ active: false }); transport.release(); await delay(400);
    assert.equal(await preview(), previous); assert.equal(counts().formSave, before.formSave);
    await context({ active: true }); assert.equal(await value("store-name"), "Texto mantido ao inativar");
    assert.equal(await preview(), previous); assert.equal(counts().patch, before.patch + 1);
  });
  await test("inactive-save-after-real-200", async () => {
    const refreshes = (await fixtureState()).refreshes; modes.holdSave = true;
    await clickButton("Salvar identidade"); await waitNode(() => modes.heldSave, "SAVE_NOT_COMMITTED_BEFORE_HOLD");
    assert.equal((await snapshot("inactive-save-committed")).identity.store_name, "Texto mantido ao inativar");
    await context({ active: false }); modes.releaseSave(); await delay(300);
    assert.equal((await fixtureState()).refreshes, refreshes);
    await context({ active: true }); await textPresent("A confirmação está pendente.");
    assert.equal((await fixtureState()).refreshes, refreshes); await clickButton("Conferir novamente"); await saved(true);
  });
  await test("changed-user-save-after-real-200", async () => {
    const refreshes = (await fixtureState()).refreshes; await field("store-name", "Gravou antes de trocar usuário"); modes.holdSave = true;
    await clickButton("Salvar identidade"); await waitNode(() => modes.heldSave, "USER_SAVE_NOT_COMMITTED");
    await context({ user: bench.sessions.customer.user, session: bench.sessions.customer, isAdmin: false, adminStatus: "customer" });
    modes.releaseSave(); await delay(300); await textPresent("Entre com uma sessão de administrador");
    assert.equal((await fixtureState()).refreshes, refreshes);
    assert.equal(await page.$("#store-name"), null);
    assert.equal((await snapshot("changed-user-committed")).identity.store_name, "Gravou antes de trocar usuário");
    await context({ user: bench.sessions.admin.user, session: bench.sessions.admin, isAdmin: true, adminStatus: "admin" });
    await page.waitForSelector("#store-name"); assert.equal((await fixtureState()).dirty, "false");
  });
  await test("same-identity-no-op", async () => {
    const before = bench.metadata(), previous = counts();
    assert.equal(await (await button("Salvar identidade")).evaluate((node) => node.disabled), true);
    await (await button("Salvar identidade")).click(); assert.equal(counts().formSave, previous.formSave);
    const response = await bench.rpc("save_store_identity", { expected_revision: before.revision, expected_identity: before.identity, desired_identity: before.identity }, "independent-no-op");
    assert.equal(response.status, 200); assert.deepEqual(bench.metadata(), before);
  });
  await test("server-denies-fixture-admin", async () => {
    const before = bench.metadata();
    // Preserve the displayed editor scope but rotate only its JWT to a real customer JWT.
    await context({ session: { user: bench.sessions.admin.user, access_token: bench.sessions.customer.access_token } });
    await field("store-name", "Servidor deve recusar"); const count = counts().formSave;
    await clickButton("Salvar identidade"); await textPresent("A identidade não foi gravada.");
    assert.equal(counts().formSave, count + 1);
    assert.deepEqual(bench.metadata(), before);
    const response = evidence.http.filter((entry) => entry.actor === "form" && entry.rpc === "save_store_identity").at(-1);
    assert.equal(response.status, 403); assert.equal(response.code, "42501");
    await context({ session: bench.sessions.admin });
  });
  await test("gesture-oracle-refutation", async () => {
    // A real click bypasses the harness's declared checkpoint, not product behavior.
    // The same count oracle must reject the unexpected early write.
    const expected = counts().formSave; await clickButton("Salvar identidade"); await saved();
    let rejected = false;
    try { assert.equal(counts().formSave, expected, "ZERO_SAVE_BEFORE_GESTURE"); } catch (error) { rejected = error.code === "ERR_ASSERTION"; }
    assert(rejected, "GESTURE_ORACLE_DID_NOT_REFUTE");
    evidence.refutation = { realEarlyClick: true, oracleRejected: rejected, expected, observed: counts().formSave };
  });
  assert.equal(bench.schema(), baselineSchema, "SQL_SCHEMA_OR_OTHER_ROW_CHANGED");
  await snapshot("final");
  assert.equal(await page.evaluate(() => window.identityBridgeViolation === true), false);
  evidence.serviceWorkers = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length);
  assert.equal(evidence.serviceWorkers, 0);
  // RPC's intentional 400/403 emits browser console errors; retain exact messages.
  const allowedConsole = new Map([
    ["real-conflict-no-automatic-save", "Failed to load resource: the server responded with a status of 400 (Bad Request)"],
    ["server-denies-fixture-admin", "Failed to load resource: the server responded with a status of 403 (Forbidden)"],
  ]);
  for (const message of evidence.console) {
    if (message.text !== allowedConsole.get(message.case) || message.location !== `${local}/wire/rest/v1/rpc/save_store_identity`)
      evidence.unexpected.push({ phase: "console", ...message });
  }
  assert.deepEqual(evidence.unexpected, [], "UNEXPECTED_BROWSER_OR_SERVER_EVENT");
  assert.equal(evidence.cases.length, expectedCases.length);
  evidence.complete = true;
} catch (error) {
  evidence.failure = { case: currentCase, name: error.name, code: error.code ?? "BENCH_FAILED", message: String(error.message).slice(0, 900) };
  console.log(`FAIL ${currentCase}: ${error.code ?? error.name} ${String(error.message).slice(0, 250)}`);
  process.exitCode = 1;
} finally {
  transport.release(); modes.releaseSave?.();
  if (page && !page.isClosed()) {
    try { await page.screenshot({ path: path.join(output, "last-state.png"), fullPage: true }); } catch { evidence.events.push({ phase: "last-capture-unavailable" }); }
  }
  if (browser) {
    try { await browser.close(); evidence.browserStopped = browser.process()?.exitCode !== null; }
    catch { evidence.browserStopped = false; evidence.complete = false; process.exitCode = 1; }
  }
  if (server) {
    try { server.closeAllConnections(); await new Promise((done) => server.close(done)); evidence.serverStopped = !server.listening; }
    catch { evidence.serverStopped = false; evidence.complete = false; process.exitCode = 1; }
  }
  try { await bench.stop(); evidence.environmentStopped = true; } catch { evidence.environmentStopped = false; evidence.complete = false; process.exitCode = 1; }
  if (sourceBefore) {
    evidence.sourcesAfter = await Promise.all(sourceBefore.map(async ({ path: file }) => ({ path: file, sha256: hash(await readFile(path.join(root, file))) })));
    if (JSON.stringify(evidence.sourcesAfter) !== JSON.stringify(sourceBefore)) { evidence.complete = false; process.exitCode = 1; evidence.events.push({ phase: "SOURCE_CHANGED_DURING_RUN" }); }
  }
  evidence.harnessHashes = await Promise.all(["run.mjs", "database.mjs", "transport.mjs", "entry.tsx", "contexts.tsx", "README.md"].map(async (file) => ({ file, sha256: hash(await readFile(path.join(root, "tests/browser-identity-editor", file))) })));
  if (evidence.profile) evidence.profilePreserved = (await stat(evidence.profile)).isDirectory();
  evidence.finishedAt = new Date().toISOString();
  for (const name of expectedCases) if (!evidence.cases.some((entry) => entry.name === name)) evidence.cases.push({ name, result: "NOT_RUN" });
  await writeJSON("evidence.json", evidence);
  console.log(JSON.stringify({ output, complete: evidence.complete, cases: evidence.cases.map(({ name, result }) => ({ name, result })), browserStopped: evidence.browserStopped, serverStopped: evidence.serverStopped, environmentStopped: evidence.environmentStopped }));
}
