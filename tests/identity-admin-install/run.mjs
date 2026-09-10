/* eslint-disable security/detect-non-literal-fs-filename -- All paths are fixed repository/evidence roots or validated local emitted files; writes are exclusive. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "acorn";
import puppeteer from "puppeteer";
import { buildStore } from "../../scripts/buildStore.mjs";

const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const control =
  "C:/Users/Gabriel/recuperacao-ikcous/20260909-ecossistema/controle";
const targets = [
  "src/components/admin/settings/IdentitySettingsSection.tsx",
  "src/lib/prepareIdentityImage.ts",
  "src/lib/uploadIdentityImage.ts",
  "node_modules/tus-js-client/lib.esm/browser/index.js",
  "node_modules/image-dimensions/index.js",
];
const sources = [
  "vite.config.ts",
  "tests/identity-admin-install/run.mjs",
  "tests/identity-admin-install/README.md",
];
const roles = [
  "header",
  "loader",
  "favicon",
  "apple_touch",
  "icon_192",
  "icon_512",
  "maskable_512",
];
const normalized = (value) => value?.replaceAll("\\", "/");
const absolute = (value) => normalized(path.resolve(root, value));
const hash = (value) => createHash("sha256").update(value).digest("hex");
const relative = (value) =>
  value ? normalized(path.relative(root, value)) : null;
const write = (directory, name, value) =>
  fs.writeFile(
    path.join(directory, name),
    typeof value === "string" ? value : JSON.stringify(value, null, 2),
    { flag: "wx" },
  );

// Only literal object arrays are accepted; Vite preload arrays contain strings.
export function readPrecache(code) {
  const candidates = [];
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "ArrayExpression" && node.elements.length > 0) {
      const entries = node.elements.map((element) => {
        if (element?.type !== "ObjectExpression") return null;
        const fields = new Map();
        for (const property of element.properties) {
          if (
            property.type !== "Property" ||
            property.computed ||
            property.value.type !== "Literal"
          )
            return null;
          fields.set(
            property.key.name ?? property.key.value,
            property.value.value,
          );
        }
        return fields.size === 2 &&
          typeof fields.get("url") === "string" &&
          (fields.get("revision") === null ||
            typeof fields.get("revision") === "string")
          ? Object.fromEntries(fields)
          : null;
      });
      if (entries.every(Boolean)) candidates.push(entries);
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") visit(value);
    }
  };
  visit(parse(code, { ecmaVersion: "latest", sourceType: "module" }));
  assert.equal(candidates.length, 1, "PRECACHE_AST_UNAMBIGUOUS");
  const entries = candidates[0];
  const revisions = new Map();
  for (const entry of entries) {
    if (revisions.has(entry.url))
      assert.equal(
        revisions.get(entry.url),
        entry.revision,
        "PRECACHE_CONFLICTING_REVISION",
      );
    revisions.set(entry.url, entry.revision);
  }
  return entries;
}

// Installation must contain the complete static closure, irrespective of chunk names.
export function assertStaticPrecache(graph, precache) {
  const chunks = new Map(graph.map((chunk) => [chunk.fileName, chunk]));
  assert.equal(chunks.size, graph.length, "STATIC_GRAPH_DUPLICATE");
  const entries = graph.filter(
    (chunk) => chunk.isEntry && chunk.moduleIds.includes("src/main.tsx"),
  );
  assert.equal(entries.length, 1, "STATIC_MAIN_ENTRY_ONCE");
  const required = new Set();
  const pending = [entries[0].fileName];
  while (pending.length) {
    const name = pending.pop();
    if (required.has(name)) continue;
    const chunk = chunks.get(name);
    assert(chunk, `STATIC_GRAPH_EDGE_MISSING: ${name}`);
    required.add(name);
    pending.push(...chunk.imports);
  }
  const urls = new Set(precache.map((item) => item.url));
  for (const name of required)
    assert(urls.has(name), `STATIC_PRECACHE_MISSING: ${name}`);
  return [...required].sort();
}

function checkStaticPrecache() {
  const chunk = (fileName, imports = [], dynamicImports = []) => ({
    fileName,
    imports,
    dynamicImports,
    isEntry: fileName === "entry.js",
    moduleIds: fileName === "entry.js" ? ["src/main.tsx"] : [],
  });
  const graph = [
    chunk("entry.js", ["direct.js", "direct.js"], ["lazy.js"]),
    chunk("direct.js", ["indirect.js"]),
    chunk("indirect.js", ["entry.js"]),
    chunk("lazy.js", ["lazy-child.js"]),
    chunk("lazy-child.js"),
  ];
  const precache = ["entry.js", "direct.js", "indirect.js"].map((url) => ({
    url,
    revision: null,
  }));
  const required = assertStaticPrecache(graph, precache);
  assert.deepEqual(required, precache.map((item) => item.url).sort());
  assert.deepEqual(assertStaticPrecache(graph, precache), required);
  assert.deepEqual(
    assertStaticPrecache(graph, [...precache, precache[0]]),
    required,
  );
  assert.throws(() => assertStaticPrecache([], []), /STATIC_MAIN_ENTRY_ONCE/);
  assert.throws(
    () => assertStaticPrecache(graph.slice(1), precache),
    /STATIC_MAIN_ENTRY_ONCE/,
  );
  assert.throws(
    () =>
      assertStaticPrecache(
        [...graph, { ...graph[0], fileName: "second-entry.js" }],
        precache,
      ),
    /STATIC_MAIN_ENTRY_ONCE/,
  );
  assert.throws(
    () => assertStaticPrecache([...graph, graph[1]], precache),
    /STATIC_GRAPH_DUPLICATE/,
  );
  assert.throws(
    () =>
      assertStaticPrecache(
        graph.filter((item) => item.fileName !== "indirect.js"),
        precache,
      ),
    /STATIC_GRAPH_EDGE_MISSING: indirect\.js/,
  );
  for (const name of required)
    assert.throws(
      () =>
        assertStaticPrecache(
          graph,
          precache.filter((item) => item.url !== name),
        ),
      (error) => error.message === `STATIC_PRECACHE_MISSING: ${name}`,
    );
}

const chunkKey = (chunk) =>
  JSON.stringify([
    chunk.facadeModuleId,
    chunk.isEntry,
    chunk.isDynamicEntry,
    [...chunk.moduleIds].sort(),
  ]);
export function assertCoverage(before, after, precache) {
  const urls = new Set(precache.map((item) => item.url));
  const oldUrls = new Set(before.precache.map((item) => item.url));
  const current = new Map(after.graph.map((chunk) => [chunkKey(chunk), chunk]));
  assert.equal(current.size, after.graph.length, "DUPLICATE_CHUNK_IDENTITY");
  assert.equal(current.size, before.graph.length, "GRAPH_PARTITION_CHANGED");
  for (const previous of before.graph) {
    const next = current.get(chunkKey(previous));
    assert(next, "GRAPH_MODULE_COVERAGE_CHANGED");
    const expected =
      oldUrls.has(previous.fileName) &&
      !targets.includes(previous.facadeModuleId);
    assert.equal(
      urls.has(next.fileName),
      expected,
      `SHARED_COVERAGE: ${previous.facadeModuleId ?? previous.fileName}`,
    );
  }
}

async function localFile(output, name) {
  assert(
    !name.includes("\\") &&
      !name.includes("\0") &&
      !name.split("/").includes(".."),
    "LOCAL_PATH",
  );
  const target = path.resolve(output, name);
  const relation = path.relative(output, target);
  assert(
    relation && !relation.startsWith("..") && !path.isAbsolute(relation),
    "LOCAL_PATH",
  );
  for (
    let current = target;
    current !== output;
    current = path.dirname(current)
  ) {
    const stat = await fs.lstat(current);
    assert(!stat.isSymbolicLink(), "LOCAL_SYMLINK");
  }
  assert((await fs.stat(target)).isFile(), "LOCAL_FILE");
  return target;
}

export async function installation(directory, output, evidence) {
  const requests = [];
  const responses = [];
  const denied = [];
  const consoleMessages = [];
  let origin;
  let browser;
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, origin);
      if (
        url.origin !== origin ||
        request.headers.host !== new URL(origin).host ||
        request.method !== "GET"
      ) {
        denied.push({ origin: url.origin, method: request.method });
        response.writeHead(403).end();
        return;
      }
      const name = decodeURIComponent(url.pathname).slice(1);
      requests.push(name);
      if (name === "__identity_install_bench.html") {
        response.writeHead(200, {
          "Content-Type": "text/html",
          "Content-Security-Policy":
            "default-src 'none'; script-src 'unsafe-inline'; connect-src 'self'; worker-src 'self'",
          "Cache-Control": "no-store",
        });
        response.end(
          "<!doctype html><title>Identity install bench</title><body>Neutral SW installation bench</body>",
        );
        return;
      }
      const file = await localFile(output, name);
      const type =
        new Map([
          [".js", "text/javascript"],
          [".html", "text/html"],
          [".css", "text/css"],
          [".webmanifest", "application/manifest+json"],
        ]).get(path.extname(file)) ?? "application/octet-stream";
      response.writeHead(200, {
        "Content-Type": type,
        "Cache-Control": "no-store",
        "Service-Worker-Allowed": "/",
      });
      const body = await fs.readFile(file);
      responses.push({
        path: name,
        status: 200,
        mime: type,
        bytes: body.length,
        sha256: hash(body),
      });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  server.on("connect", (_request, socket) => {
    denied.push({ method: "CONNECT" });
    socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
  });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    origin = `http://127.0.0.1:${server.address().port}`;
    // Chromium CacheStorage adds deep paths; use a short, private Windows temp root.
    const profile = await fs.mkdtemp(path.join(os.tmpdir(), "a5d3c-"));
    evidence.profile = profile;
    browser = await puppeteer.launch({
      headless: true,
      userDataDir: profile,
      args: [
        `--proxy-server=${origin}`,
        "--proxy-bypass-list=<-loopback>",
        "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-sync",
        "--no-first-run",
      ],
    });
    evidence.chrome = await browser.version();
    const page = await browser.newPage();
    const diagnostics = await page.createCDPSession();
    diagnostics.on("ServiceWorker.workerErrorReported", (event) =>
      consoleMessages.push({ workerError: event }),
    );
    diagnostics.on("ServiceWorker.workerVersionUpdated", (event) =>
      consoleMessages.push({ workerVersions: event }),
    );
    await diagnostics.send("ServiceWorker.enable");
    page.on("console", (message) =>
      consoleMessages.push({ type: message.type(), text: message.text() }),
    );
    await page.goto(`${origin}/__identity_install_bench.html`);
    evidence.install = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.register("/sw.js");
      await new Promise((resolve, reject) => {
        const workers = [
          registration.installing,
          registration.waiting,
          registration.active,
        ].filter(Boolean);
        const timeout = setTimeout(
          () => reject(new Error("SW_ACTIVATION_TIMEOUT")),
          45000,
        );
        const check = () => {
          if (registration.active?.state === "activated") {
            clearTimeout(timeout);
            resolve();
          }
          if (workers.some((worker) => worker.state === "redundant")) {
            clearTimeout(timeout);
            reject(new Error("SW_INSTALL_REDUNDANT"));
          }
        };
        for (const worker of workers)
          worker.addEventListener("statechange", check);
        check();
      });
      const entries = [];
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        entries.push({
          name,
          paths: (await cache.keys()).map((request) =>
            new URL(request.url).pathname.slice(1),
          ),
        });
      }
      return {
        state: registration.active.state,
        caches: entries,
        scripts: [...document.scripts].map((script) => script.src),
      };
    });
    assert.deepEqual(evidence.install.scripts, [], "APP_MUST_NOT_EXECUTE");
    const cached = new Set(
      evidence.install.caches.flatMap((cache) => cache.paths),
    );
    for (const item of evidence.precache)
      assert(cached.has(item.url), `INSTALL_CACHE_MISSING: ${item.url}`);
    for (const item of evidence.targets) {
      assert(!cached.has(item.fileName), "ADMIN_CACHED");
      assert(!requests.includes(item.fileName), "ADMIN_DOWNLOADED");
    }
    evidence.install.downloadedTargets = 0;
  } finally {
    try {
      if (browser) await browser.close();
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      evidence.shutdown = {
        browserConnected: browser?.connected ?? false,
        serverListening: server.listening,
      };
      await write(directory, "network.json", {
        requests,
        responses,
        denied,
        consoleMessages,
        externalForwarded: 0,
        shutdown: evidence.shutdown,
      });
    }
  }
}

function describe(value) {
  return JSON.parse(
    JSON.stringify(value, (_key, item) =>
      typeof item === "function" ? { function: item.toString() } : item,
    ),
  );
}

async function assertSourcesUnchanged(inputs) {
  for (const input of inputs)
    assert.equal(
      hash(await fs.readFile(path.join(root, input.path))),
      input.sha256,
      `SOURCE_CHANGED_DURING_PAIR: ${input.path}`,
    );
}

async function measure(directory, evidence, isControl) {
  const naming = isControl
    ? {
        name: "identity-install-control-naming",
        enforce: "post",
        config(config) {
          const output = config.build?.rollupOptions?.output;
          assert(output && !Array.isArray(output), "SINGLE_OUTPUT_REQUIRED");
          assert.equal(
            typeof output.chunkFileNames,
            "function",
            "REAL_NAMING_REQUIRED",
          );
          naming.normalOutput = describe(output);
          return {
            build: {
              rollupOptions: {
                output: {
                  chunkFileNames: "assets/[name]-[hash].js",
                },
              },
            },
          };
        },
      }
    : undefined;
  let snapshot;
  let captures = 0;
  let emittedChunks;
  const consumed = new Map();
  const observer = {
    name: "identity-install-graph-observer",
    async configResolved(config) {
      snapshot = JSON.parse(config.define.__STORE_IDENTITY__);
      evidence.publicFiles = [];
      for (const item of await fs.readdir(config.publicDir, {
        recursive: true,
        withFileTypes: true,
      })) {
        if (!item.isFile()) continue;
        const file = path.join(item.parentPath, item.name);
        evidence.publicFiles.push({
          path: normalized(path.relative(config.publicDir, file)),
          sha256: hash(await fs.readFile(file)),
        });
      }
      evidence.publicFiles.sort((a, b) => a.path.localeCompare(b.path));
      const output = config.build.rollupOptions.output;
      const normalOutput = naming?.normalOutput ?? describe(output);
      const expected = isControl
        ? { ...normalOutput, chunkFileNames: "assets/[name]-[hash].js" }
        : normalOutput;
      assert.deepEqual(describe(output), expected, "ONLY_NAMING_OVERRIDE");
      evidence.configuration = {
        normalOutput,
        actualOutput: describe(output),
        changedOutputKeys: Object.keys(describe(output)).filter(
          (key) =>
            JSON.stringify(Reflect.get(describe(output), key)) !==
            JSON.stringify(Reflect.get(normalOutput, key)),
        ),
        root: config.root,
        base: config.base,
        mode: config.mode,
        envDir: config.envDir,
        publicDir: config.publicDir,
        build: describe({
          ...config.build,
          rollupOptions: {
            ...config.build.rollupOptions,
            output: normalOutput,
          },
        }),
        define: describe(config.define),
        plugins: config.plugins
          .map((plugin) => plugin.name)
          .filter((name) => name !== "identity-install-control-naming"),
      };
      assert.deepEqual(
        evidence.configuration.changedOutputKeys,
        isControl ? ["chunkFileNames"] : [],
        "ONLY_NAMING_OVERRIDE",
      );
    },
    transform: {
      order: "pre",
      async handler(_code, id) {
        const file = id.split("?")[0];
        if (
          !path.isAbsolute(file) ||
          file.includes("\0") ||
          file.startsWith("/@")
        )
          return;
        const source = {
          path: relative(file),
          sha256: hash(await fs.readFile(file)),
        };
        const previous = consumed.get(source.path);
        if (previous)
          assert.deepEqual(source, previous, "SOURCE_CHANGED_WHILE_CONSUMED");
        consumed.set(source.path, source);
      },
    },
    generateBundle: {
      order: "post",
      handler(_options, bundle) {
        const chunks = Object.values(bundle).filter(
          (item) => item.type === "chunk",
        );
        if (
          !chunks.some(
            (item) =>
              item.isEntry &&
              item.moduleIds.map(normalized).includes(absolute("src/main.tsx")),
          )
        )
          return;
        captures++;
        emittedChunks = chunks;
        // Keep Rollup objects alive: later Vite hooks can update preload code.
        evidence.graph = chunks.map((item) => ({
          fileName: item.fileName,
          facadeModuleId: relative(item.facadeModuleId),
          isEntry: item.isEntry,
          isDynamicEntry: item.isDynamicEntry,
          imports: item.imports,
          dynamicImports: item.dynamicImports,
          moduleIds: item.moduleIds.map(relative),
          bytes: Buffer.byteLength(item.code),
        }));
      },
    },
  };
  evidence.build = await buildStore({
    root,
    mode: "production",
    envFile: false,
    plugins: [...(naming ? [naming] : []), observer],
  });
  assert.equal(captures, 1, "MAIN_GRAPH_CAPTURE_ONCE");
  assert.equal(evidence.build.source, "fixture", "FIXTURE_REQUIRED");
  assert.equal(evidence.build.promotable, false, "FIXTURE_NOT_PROMOTABLE");
  evidence.graph = emittedChunks.map((item) => ({
    fileName: item.fileName,
    facadeModuleId: relative(item.facadeModuleId),
    isEntry: item.isEntry,
    isDynamicEntry: item.isDynamicEntry,
    imports: [...item.imports],
    dynamicImports: [...item.dynamicImports],
    moduleIds: item.moduleIds.map(relative),
    bytes: Buffer.byteLength(item.code),
  }));
  evidence.consumed = [...consumed.values()].sort((a, b) =>
    a.path.localeCompare(b.path),
  );
  await assertSourcesUnchanged([
    ...evidence.inputs,
    ...evidence.sources,
    ...evidence.consumed,
  ]);
  for (const input of evidence.inputs)
    assert.equal(
      hash(await fs.readFile(path.join(root, input.path))),
      input.sha256,
      `INPUT_CHANGED_DURING_BUILD: ${input.path}`,
    );
  const output = path.join(root, "dist-test");
  for (const chunk of evidence.graph) {
    const bytes = (await fs.stat(await localFile(output, chunk.fileName))).size;
    assert.equal(
      chunk.bytes,
      bytes,
      `OBSERVER_MUST_CAPTURE_FINAL_BYTES: ${chunk.fileName}`,
    );
  }
  const sw = await fs.readFile(path.join(output, "sw.js"), "utf8");
  evidence.precache = readPrecache(sw);
  const urls = new Set(evidence.precache.map((item) => item.url));
  for (const facade of targets) {
    const chunks = evidence.graph.filter(
      (item) => item.facadeModuleId === facade,
    );
    assert.equal(
      chunks.length,
      1,
      `EXACT_FACADE_MISSING_OR_DUPLICATE: ${facade}`,
    );
    assert(chunks[0].isDynamicEntry, `NOT_DYNAMIC: ${facade}`);
    evidence.targets.push({
      ...chunks[0],
      inPrecache: urls.has(chunks[0].fileName),
    });
  }
  evidence.targetBytes = evidence.targets.reduce(
    (sum, item) => sum + item.bytes,
    0,
  );
  const graph = new Map(evidence.graph.map((item) => [item.fileName, item]));
  const entry = evidence.graph.filter(
    (item) => item.isEntry && item.moduleIds.includes("src/main.tsx"),
  );
  assert.equal(entry.length, 1, "MAIN_ENTRY_ONCE");
  const administrative = evidence.graph.filter(
    (item) =>
      item.isDynamicEntry &&
      (item.facadeModuleId?.startsWith("src/views/admin/") ||
        item.facadeModuleId?.startsWith("src/components/admin/")),
  );
  evidence.administrativeCuts = administrative.map((item) => ({
    fileName: item.fileName,
    facadeModuleId: item.facadeModuleId,
  }));
  const removed = new Set(administrative.map((item) => item.fileName));
  const seen = new Set();
  const visit = (name) => {
    if (removed.has(name) || seen.has(name)) return;
    seen.add(name);
    const chunk = graph.get(name);
    assert(chunk, `GRAPH_EDGE_MISSING: ${name}`);
    for (const child of [...chunk.imports, ...chunk.dynamicImports])
      visit(child);
  };
  visit(entry[0].fileName);
  for (const target of evidence.targets)
    assert(
      !seen.has(target.fileName),
      `NOT_ADMIN_EXCLUSIVE: ${target.facadeModuleId}`,
    );
  evidence.importers = evidence.targets.map((target) => ({
    target: target.facadeModuleId,
    importers: evidence.graph
      .filter((item) =>
        [...item.imports, ...item.dynamicImports].includes(target.fileName),
      )
      .map((item) => item.facadeModuleId ?? item.fileName),
  }));
  for (const chunk of evidence.graph) {
    for (const name of [
      chunk.fileName,
      ...chunk.imports,
      ...chunk.dynamicImports,
    ])
      await localFile(output, name);
  }
  assert(
    urls.has("index.html") && urls.has(entry[0].fileName),
    "ENTRY_PRECACHE",
  );
  evidence.essential = roles.map((role) => ({
    role,
    url: Reflect.get(snapshot.localUrls, role).slice(1),
  }));
  for (const item of evidence.essential)
    assert(urls.has(item.url), `ESSENTIAL_MISSING: ${item.role}`);
  for (const url of [snapshot.localUrls.og, ...snapshot.localUrls.originals])
    assert(!urls.has(url.slice(1)), "ORIGINAL_OG_CACHED");
  const required = assertStaticPrecache(evidence.graph, evidence.precache);
  evidence.staticPrecache = { required, chunks: [], mutations: [] };
  for (const name of required) {
    const body = await fs.readFile(await localFile(output, name));
    evidence.staticPrecache.chunks.push({
      fileName: name,
      bytes: body.length,
      sha256: hash(body),
    });
    assert.throws(
      () =>
        assertStaticPrecache(
          evidence.graph,
          evidence.precache.filter((item) => item.url !== name),
        ),
      (error) => error.message === `STATIC_PRECACHE_MISSING: ${name}`,
    );
    evidence.staticPrecache.mutations.push({
      removedInMemory: name,
      rejected: true,
    });
  }
  evidence.artifacts = [];
  for (const name of [
    "sw.js",
    "index.html",
    "manifest.webmanifest",
    "version.json",
    ...evidence.targets.map((item) => item.fileName),
  ])
    evidence.artifacts.push({
      path: name,
      sha256: hash(await fs.readFile(await localFile(output, name))),
    });
  await write(directory, "sw.js", sw);
  await write(directory, "graph.json", evidence.graph);
  await write(directory, "precache.json", evidence.precache);

  evidence.status = isControl ? "CONTROL" : "CANDIDATE";
  assert.equal(
    evidence.targets.filter((item) => item.inPrecache).length,
    isControl ? 5 : 0,
    isControl ? "CONTROL_FIVE_PRECACHE" : "ADMIN_INSTALL_PARTIAL_EXCLUSION",
  );
  evidence.finishedAt = new Date().toISOString();
}

export async function run() {
  assert.equal(process.argv.length, 2, "NO_ARGUMENTS");
  checkStaticPrecache();
  assert.throws(
    () => readPrecache("const manifest=[]"),
    /PRECACHE_AST_UNAMBIGUOUS/,
  );
  assert.throws(
    () =>
      readPrecache(
        "const manifest=[{url:'x',revision:'1'},{url:'x',revision:'2'}]",
      ),
    /PRECACHE_CONFLICTING_REVISION/,
  );
  assert.equal(
    readPrecache(
      "const manifest=[{url:'x',revision:'1'},{url:'x',revision:'1'}]",
    ).length,
    2,
  );
  const envFiles = (await fs.readdir(root)).filter(
    (name) => name.startsWith(".env") && name !== ".env.example",
  );
  assert.deepEqual(envFiles, [], "REAL_ENV_FILE_FORBIDDEN");
  assert.equal(
    await fs.realpath(control),
    path.resolve(control),
    "EVIDENCE_ROOT",
  );
  const directory = path.join(
    control,
    `tarefa-A6c1-${Date.now()}-${randomUUID()}`,
  );
  await fs.mkdir(directory);
  const evidence = {
    startedAt: new Date().toISOString(),
    status: "SETUP",
    root,
    sources: [],
    graph: [],
    precache: [],
    targets: [],
  };
  const previousCwd = process.cwd();
  const savedEnv = new Map(Object.entries(process.env));
  const nativeFetch = globalThis.fetch;
  try {
    for (const name of sources)
      evidence.sources.push({
        path: name,
        sha256: hash(await fs.readFile(path.join(root, name))),
      });
    for (const name of [
      "vite",
      "rollup",
      "vite-plugin-pwa",
      "acorn",
      "puppeteer",
    ]) {
      const pkg = JSON.parse(
        await fs.readFile(
          path.join(root, "node_modules", name, "package.json"),
          "utf8",
        ),
      );
      (evidence.versions ??= []).push({ name, version: pkg.version });
    }
    evidence.node = process.version;
    evidence.head = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    evidence.inputs = [];
    for (const folder of ["src", "scripts", "public"]) {
      for (const item of await fs.readdir(path.join(root, folder), {
        recursive: true,
        withFileTypes: true,
      })) {
        if (!item.isFile()) continue;
        const file = path.join(item.parentPath, item.name);
        evidence.inputs.push({
          path: relative(file),
          sha256: hash(await fs.readFile(file)),
        });
      }
    }
    for (const name of [
      "index.html",
      "package.json",
      "package-lock.json",
      "postcss.config.js",
      "tailwind.config.js",
      "tsconfig.json",
      "tsconfig.app.json",
      "tsconfig.node.json",
    ]) {
      evidence.inputs.push({
        path: name,
        sha256: hash(await fs.readFile(path.join(root, name))),
      });
    }
    process.chdir(root);
    for (const key of Object.keys(process.env)) {
      if (
        /^(VITE_|SUPABASE_|DATABASE_URL$|VERCEL|CF_PAGES$|IKCOUS_|ANALYZE$)/.test(
          key,
        )
      )
        Reflect.deleteProperty(process.env, key);
    }
    process.env.IKCOUS_IDENTITY_MODE = "fixture";
    process.env.IKCOUS_CODE_SHA = evidence.head;
    globalThis.fetch = () => {
      throw new Error("BUILD_NETWORK_FORBIDDEN");
    };
    const baselineDirectory = path.join(directory, "paired-control");
    await fs.mkdir(baselineDirectory);
    const baseline = {
      startedAt: new Date().toISOString(),
      status: "SETUP",
      experiment: "present control; not historical RED",
      root,
      head: evidence.head,
      sources: evidence.sources,
      inputs: evidence.inputs,
      graph: [],
      precache: [],
      targets: [],
    };
    evidence.pairedControl = "paired-control/result.json";
    try {
      await measure(baselineDirectory, baseline, true);
    } catch (error) {
      baseline.failure = error.message;
      throw error;
    } finally {
      await write(baselineDirectory, "result.json", baseline);
    }
    await assertSourcesUnchanged([
      ...evidence.inputs,
      ...evidence.sources,
      ...baseline.consumed,
    ]);
    await measure(directory, evidence, false);
    assert.deepEqual(
      evidence.sources,
      baseline.sources,
      "PAIR_SOURCE_MISMATCH",
    );
    assert.deepEqual(
      evidence.consumed,
      baseline.consumed,
      "PAIR_CONSUMED_SOURCE_MISMATCH",
    );
    const {
      actualOutput: _controlOutput,
      publicDir: _controlStaging,
      changedOutputKeys: _controlChanges,
      ...controlConfiguration
    } = baseline.configuration;
    const {
      actualOutput: _candidateOutput,
      publicDir: _candidateStaging,
      changedOutputKeys: _candidateChanges,
      ...candidateConfiguration
    } = evidence.configuration;
    assert.deepEqual(
      candidateConfiguration,
      controlConfiguration,
      "PAIR_CONFIGURATION_CHANGED",
    );
    assert.deepEqual(
      evidence.build,
      baseline.build,
      "PAIR_BUILD_METADATA_CHANGED",
    );
    assert.deepEqual(
      evidence.publicFiles,
      baseline.publicFiles,
      "PAIR_PUBLIC_CONTENT_CHANGED",
    );
    evidence.pairedComparison = {
      sourcesIdentical: true,
      consumedSourcesIdentical: true,
      soleControlledProperty: "build.rollupOptions.output.chunkFileNames",
      configurationIdenticalApartFromNaming: true,
      historicalEvidenceRead: false,
      freshIdentityStagingComparedByContent: true,
    };
    const output = path.join(root, "dist-test");
    const urls = new Set(evidence.precache.map((item) => item.url));
    assertCoverage(baseline, evidence, evidence.precache);
    const shared = evidence.graph.find(
      (item) =>
        item.fileName.startsWith("assets/vendor-react-") &&
        urls.has(item.fileName),
    );
    assert(shared, "SHARED_MUTATION_TARGET_REQUIRED");
    assert.throws(
      () =>
        assertCoverage(
          baseline,
          evidence,
          evidence.precache.filter((item) => item.url !== shared.fileName),
        ),
      /SHARED_COVERAGE/,
    );
    evidence.coverageMutation = {
      removedInMemory: shared.fileName,
      rejected: true,
    };
    globalThis.fetch = nativeFetch;
    await installation(directory, output, evidence);
    await assertSourcesUnchanged([
      ...evidence.inputs,
      ...evidence.sources,
      ...evidence.consumed,
    ]);
    evidence.status = "GREEN";
    console.log(
      `GREEN: five entries excluded, ${evidence.targetBytes} bytes; real SW activated; shared coverage retained; static closure precached and every required chunk mutation rejected.`,
    );
  } catch (error) {
    evidence.failure = error.message;
    throw error;
  } finally {
    globalThis.fetch = nativeFetch;
    for (const key of Object.keys(process.env))
      if (!savedEnv.has(key)) Reflect.deleteProperty(process.env, key);
    for (const [key, value] of savedEnv) Reflect.set(process.env, key, value);
    process.chdir(previousCwd);
    evidence.finishedAt = new Date().toISOString();
    await write(directory, "result.json", evidence);
    console.log(`Evidence: ${directory}`);
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  run().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
