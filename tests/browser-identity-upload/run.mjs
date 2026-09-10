/* eslint-disable security/detect-non-literal-fs-filename -- Fixed repository/evidence roots and harness-owned names only. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import sharp from "sharp";

const root = fileURLToPath(new URL("../../", import.meta.url));
const output = path.join(
  "C:/Users/Gabriel/recuperacao-ikcous/20260909-ecossistema/controle",
  `tarefa-A5c3b-browser-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`,
);
await mkdir(output, { recursive: true });
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const bundle = await build({
  absWorkingDir: root,
  entryPoints: ["tests/browser-identity-upload/entry.ts"],
  bundle: true,
  platform: "browser",
  mainFields: ["browser", "module", "main"],
  format: "iife",
  target: "chrome150",
  tsconfigRaw: { compilerOptions: { target: "ES2022", module: "ESNext" } },
  write: false,
  metafile: true,
});
const inputs = Object.keys(bundle.metafile.inputs);
assert(inputs.includes("node_modules/tus-js-client/lib.esm/browser/index.js"));
assert(
  inputs.every(
    (name) =>
      !/(lib\.es5|lib\.esm\/node|node:|proper-lockfile|node_modules\/sharp\/)/.test(
        name,
      ),
  ),
  "unapproved Node/CJS bundle input",
);
const tusInputs = inputs.filter((name) =>
  name.startsWith("node_modules/tus-js-client/"),
);
assert(
  tusInputs.every((name) =>
    name.startsWith("node_modules/tus-js-client/lib.esm/"),
  ),
);
const script = bundle.outputFiles[0].contents;
await writeFile(path.join(output, "bundle.js"), script);
await writeFile(
  path.join(output, "metafile.json"),
  JSON.stringify(bundle.metafile, null, 2),
);
const small = await sharp({
  create: { width: 32, height: 16, channels: 3, background: "#3579ab" },
})
  .jpeg()
  .toBuffer();
// Insert well-formed COM segments after SOI, before SOF. Their payload is opaque;
// the image is never re-encoded after this insertion.
let missing = 20 * 1024 * 1024 - small.length;
const comments = [];
while (missing > 0) {
  let total = Math.min(65537, missing);
  if (missing - total > 0 && missing - total < 4)
    total -= 4 - (missing - total);
  assert(total >= 4);
  const segment = Buffer.alloc(total, 65);
  segment[0] = 255;
  segment[1] = 254;
  segment.writeUInt16BE(total - 2, 2);
  comments.push(segment);
  missing -= total;
}
const big = Buffer.concat([
  small.subarray(0, 2),
  ...comments,
  small.subarray(2),
]);
assert.equal(big.length, 20971520);
assert.equal(
  hash(await sharp(big, { failOn: "warning" }).raw().toBuffer()),
  hash(await sharp(small).raw().toBuffer()),
);
await writeFile(path.join(output, "original-20MiB.jpg"), big);
await writeFile(path.join(output, "original-small.jpg"), small);
const states = new Map();
const traces = [];
const results = [];
let trap = 0;
let external = 0;
const pageErrors = [];
function fresh(label, large = false, mode = "normal") {
  const state = {
    label,
    mode,
    fixture: large ? big : small,
    resources: new Map(),
    posts: 0,
    headCount: 0,
    publicBytes: null,
    lost: false,
    trace: [],
  };
  states.set(label, state);
  return state;
}
const metadata = (state, record) => {
  const values = { ...record.metadata, cacheControl: "max-age=31536000" };
  if (state.mode === "wrong-binding")
    values.objectName = `v1/${"a".repeat(64)}/other.jpg`;
  return Object.entries(values)
    .map(([key, value]) => `${key} ${Buffer.from(value).toString("base64")}`)
    .join(",");
};
const server = http.createServer(async (req, res) => {
  try {
    if (req.url === "/") {
      res.writeHead(200, {
        "Content-Type": "text/html",
        "Content-Security-Policy":
          "default-src 'none'; script-src 'self'; connect-src 'self'; img-src 'self' blob:; style-src 'unsafe-inline'",
      });
      res.end(
        '<!doctype html><meta charset="utf-8"><title>Local identity upload proof</title><body><script src="/bundle.js"></script>',
      );
      return;
    }
    if (req.url === "/bundle.js") {
      res.writeHead(200, { "Content-Type": "application/javascript" });
      res.end(script);
      return;
    }
    if (req.url === "/fixture-big" || req.url === "/fixture-small") {
      res.writeHead(200, { "Content-Type": "image/jpeg" });
      res.end(req.url === "/fixture-big" ? big : small);
      return;
    }
    if (req.url === "/trap") {
      trap++;
      res.writeHead(200);
      res.end("trap");
      return;
    }
    const match = /^\/wire\/([a-z0-9-]+)(\/storage\/v1\/.*)$/.exec(
      req.url ?? "",
    );
    if (!match) {
      res.writeHead(404);
      res.end();
      return;
    }
    const state = states.get(match[1]);
    assert(state);
    const route = match[2];
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const trace = {
      label: state.label,
      method: req.method,
      offset: req.headers["upload-offset"] ?? null,
      bytes: body.length,
      bodySHA256: hash(body),
      status: null,
      authorization: req.headers.authorization ? "[redacted]" : null,
    };
    state.trace.push(trace);
    traces.push(trace);
    assert(!req.headers["x-upsert"]);
    assert.notEqual(req.method, "DELETE");
    function reply(status, headers = {}, data = null) {
      trace.status = status;
      res.writeHead(status, headers);
      res.end(data);
    }
    if (req.method === "GET") {
      assert(!req.headers.authorization);
      assert(!req.headers.cookie);
      if (state.mode === "redirect-get") {
        reply(302, { Location: "/trap" });
        return;
      }
      let publicBytes = state.publicBytes;
      if (!publicBytes) {
        reply(404);
        return;
      }
      if (state.mode === "public-hash") {
        publicBytes = Buffer.from(publicBytes);
        publicBytes[publicBytes.length - 1] ^= 1;
      }
      if (state.mode === "public-size")
        publicBytes = publicBytes.subarray(0, publicBytes.length - 1);
      reply(
        state.mode === "public-status" ? 206 : 200,
        {
          "Content-Type":
            state.mode === "public-mime" ? "image/png" : "image/jpeg",
        },
        publicBytes,
      );
      return;
    }
    assert.equal(req.headers.authorization, "Bearer only-synthetic-token");
    assert.equal(req.headers["tus-resumable"], "1.0.0");
    if (req.method === "POST") {
      state.posts++;
      assert.equal(body.length, 0);
      assert.equal(Number(req.headers["upload-length"]), state.fixture.length);
      if (state.mode === "redirect-post") {
        reply(302, { Location: "/trap" });
        return;
      }
      if (state.mode === "post-401" || state.mode === "post-403") {
        reply(Number(state.mode.slice(5)));
        return;
      }
      if (state.mode.startsWith("conflict")) {
        state.publicBytes = Buffer.from(state.fixture);
        if (state.mode === "conflict-wrong")
          state.publicBytes[state.publicBytes.length - 1] ^= 1;
        reply(409);
        return;
      }
      const tags = Object.fromEntries(
        String(req.headers["upload-metadata"])
          .split(",")
          .map((pair) => {
            const [key, value] = pair.split(" ");
            return [key, Buffer.from(value, "base64").toString()];
          }),
      );
      assert.deepEqual(Object.keys(tags).sort(), [
        "bucketName",
        "cacheControl",
        "contentType",
        "objectName",
      ]);
      assert.equal(tags.bucketName, "branding");
      assert.equal(tags.cacheControl, "31536000");
      assert.equal(tags.contentType, "image/jpeg");
      assert.equal(tags.objectName, `v1/${hash(state.fixture)}/image.jpg`);
      const id = `id${state.posts}`;
      state.resources.set(id, { metadata: tags, parts: [], offset: 0 });
      reply(201, {
        "Tus-Resumable": "1.0.0",
        Location: `https://aaaaaaaaaaaaaaaaaaaa.storage.supabase.co/storage/v1/upload/resumable/${id}`,
      });
      return;
    }
    const id = route.split("/").at(-1);
    const record = state.resources.get(id);
    if (req.method === "HEAD") {
      state.headCount++;
      if (state.mode === "expired" && state.headCount === 1) {
        reply(404);
        return;
      }
      if (state.mode.startsWith("head-") && state.headCount === 1) {
        reply(Number(state.mode.slice(5)));
        return;
      }
      if (!record) {
        reply(404);
        return;
      }
      reply(200, {
        "Tus-Resumable": "1.0.0",
        "Upload-Length": String(state.fixture.length),
        "Upload-Offset": String(record.offset),
        "Upload-Metadata": metadata(state, record),
      });
      return;
    }
    assert.equal(req.method, "PATCH");
    assert(record);
    if (state.mode === "redirect-patch") {
      reply(302, { Location: "/trap" });
      return;
    }
    // A lost socket can be retried by the native HTTP transport. TUS answers a
    // stale offset with 409; it must never append the already accepted prefix.
    if (Number(req.headers["upload-offset"]) !== record.offset) {
      reply(409);
      return;
    }
    assert(body.length > 0 && body.length <= 6291456);
    assert.equal(
      req.headers["content-type"],
      "application/offset+octet-stream",
    );
    record.parts.push(body);
    record.offset += body.length;
    if (record.offset === state.fixture.length) {
      state.publicBytes = Buffer.concat(record.parts);
      assert.equal(hash(state.publicBytes), hash(state.fixture));
      trace.acceptedObjectSHA256 = hash(state.publicBytes);
    }
    if (
      state.mode === "lost-final" &&
      record.offset === state.fixture.length &&
      !state.lost
    ) {
      state.lost = true;
      trace.status = "lost-after-accept";
      res.destroy();
      return;
    }
    reply(204, {
      "Tus-Resumable": "1.0.0",
      "Upload-Offset":
        state.mode === "bad-patch-offset"
          ? `${record.offset}junk`
          : String(record.offset),
    });
  } catch (error) {
    pageErrors.push(`server: ${error.message}`);
    res.writeHead(500);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await puppeteer.launch({
    headless: true,
    args: [
      "--disable-background-networking",
      "--disable-component-update",
      "--no-first-run",
    ],
  });
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    if (
      request.url().startsWith(`${origin}/`) ||
      request.url().startsWith("blob:")
    ) {
      void request.continue();
    } else {
      external++;
      void request.abort();
    }
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  async function load(clear = true, probe = null) {
    await page.goto(origin);
    await page.waitForFunction(() => Boolean(window.identityUploadHarness));
    if (clear) await page.evaluate(() => localStorage.clear());
    await page.evaluate((value) => {
      if (value === null) localStorage.removeItem("tusSupport");
      else localStorage.setItem("tusSupport", value);
    }, probe);
  }
  async function run(state, extra = {}) {
    const result = await page.evaluate(
      (opts) => window.identityUploadHarness.run(opts),
      { label: state.label, large: state.fixture === big, ...extra },
    );
    results.push({ label: state.label, mode: state.mode, ...result });
    return result;
  }
  function accepted(state) {
    return state.trace.filter((t) => t.method === "PATCH" && t.status === 204);
  }
  function release(state) {
    state.publicBytes = null;
    for (const r of state.resources.values()) r.parts = [];
  }
  await load(true, "existing-value");
  let state = fresh("full", true);
  let result = await run(state);
  assert.equal(result.code, "OK");
  assert.equal(result.probe, "existing-value");
  assert.deepEqual(result.probeActions, ["set"]);
  assert.equal(result.asset.bytes, 20971520);
  assert.deepEqual(
    accepted(state).map((t) => t.bytes),
    [6291456, 6291456, 6291456, 2097152],
  );
  assert.equal(result.asset.sha256, hash(big));
  assert.equal(
    result.keys.filter((k) => k.startsWith("ikcous.identityUpload.")).length,
    0,
  );
  release(state);
  await load();
  state = fresh("reload", true);
  result = await run(state, { cancelChunk: true });
  assert.equal(result.code, "IDENTITY_UPLOAD_CANCELED");
  assert.equal(result.probe, null);
  assert.deepEqual(result.probeActions, ["set", "remove"]);
  assert.equal(accepted(state).length, 1);
  assert.equal(result.keys.length, 1);
  const firstKeys = result.keys;
  await load(false);
  result = await run(state);
  assert.equal(result.code, "OK");
  assert.equal(state.posts, 1);
  assert.equal(state.headCount, 1);
  assert.deepEqual(
    accepted(state).map((t) => t.offset),
    ["0", "6291456", "12582912", "18874368"],
  );
  release(state);
  await load();
  state = fresh("another-user", true);
  await run(state, { cancelChunk: true });
  await load(false);
  result = await run(state, { userId: "u1.child" });
  assert.equal(result.code, "OK");
  assert.equal(state.posts, 2);
  assert.equal(state.headCount, 0);
  assert(result.keys.includes(firstKeys[0]));
  release(state);
  for (const mode of [
    "wrong-binding",
    "expired",
    "head-401",
    "head-403",
    "head-429",
    "head-500",
  ]) {
    await load();
    state = fresh(mode, true);
    await run(state, { cancelChunk: true });
    state.mode = mode;
    await load(false);
    const before = state.trace.length;
    result = await run(state);
    const failed = ["wrong-binding", "head-401", "head-403"].includes(mode);
    assert.equal(
      result.code,
      failed
        ? mode === "wrong-binding"
          ? "IDENTITY_UPLOAD_PROTOCOL"
          : "IDENTITY_UPLOAD_SESSION"
        : "OK",
    );
    if (failed) {
      assert(
        !state.trace
          .slice(before)
          .some((t) => t.method === "PATCH" || t.method === "GET"),
      );
      assert.equal(state.posts, 1);
    } else {
      assert.equal(state.posts, mode === "expired" ? 2 : 1);
    }
    release(state);
  }
  for (const [mode, expected] of [
    ["conflict-equal", "OK"],
    ["conflict-wrong", "IDENTITY_UPLOAD_UNCONFIRMED"],
    ["lost-final", "OK"],
    ["post-401", "IDENTITY_UPLOAD_SESSION"],
    ["post-403", "IDENTITY_UPLOAD_SESSION"],
    ["bad-patch-offset", "IDENTITY_UPLOAD_PROTOCOL"],
    ["redirect-post", "IDENTITY_UPLOAD_UNCONFIRMED"],
    ["redirect-patch", "IDENTITY_UPLOAD_UNCONFIRMED"],
    ["redirect-get", "IDENTITY_UPLOAD_UNCONFIRMED"],
    ["public-mime", "IDENTITY_UPLOAD_UNCONFIRMED"],
    ["public-status", "IDENTITY_UPLOAD_UNCONFIRMED"],
    ["public-size", "IDENTITY_UPLOAD_UNCONFIRMED"],
    ["public-hash", "IDENTITY_UPLOAD_UNCONFIRMED"],
  ]) {
    await load();
    state = fresh(mode, false, mode);
    result = await run(state);
    assert.equal(result.code, expected, mode);
    if (mode.startsWith("post-"))
      assert(!state.trace.some((t) => t.method === "GET"));
    if (mode.startsWith("conflict")) assert.equal(state.posts, 1);
    release(state);
  }
  for (const flag of ["authChange", "abortAuth"]) {
    await load();
    state = fresh(flag.toLowerCase());
    result = await run(state, { [flag]: true });
    assert.equal(
      result.code,
      flag === "authChange"
        ? "IDENTITY_UPLOAD_SESSION"
        : "IDENTITY_UPLOAD_CANCELED",
    );
    assert.equal(state.trace.length, 0);
  }
  assert.equal(trap, 0);
  assert.equal(external, 0);
  assert.deepEqual(pageErrors, []);
  await page.screenshot({ path: path.join(output, "representative.png") });
  const sourceHashes = new Map();
  for (const input of inputs)
    sourceHashes.set(input, hash(await readFile(path.join(root, input))));
  await writeFile(
    path.join(output, "evidence.json"),
    JSON.stringify(
      {
        chrome: await browser.version(),
        bundleBytes: script.length,
        bundleSHA256: hash(script),
        fixtureSHA256: hash(big),
        smallSHA256: hash(small),
        sourceHashes: Object.fromEntries(sourceHashes),
        results,
        traces,
        trap,
        external,
        pageErrors,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      {
        result: "PASS",
        cases: results.length,
        fixtureBytes: big.length,
        fixtureSHA256: hash(big),
        bundleBytes: script.length,
        chrome: await browser.version(),
        trap,
        external,
        output,
      },
      null,
      2,
    ),
  );
} finally {
  await writeFile(
    path.join(output, "traces.json"),
    JSON.stringify({ results, traces, pageErrors, trap, external }, null, 2),
  );
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
