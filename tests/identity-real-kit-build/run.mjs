/* eslint-disable security/detect-non-literal-fs-filename -- Fixed local roots, checked ancestors, exclusive evidence files; never deletes output or recovery directories. */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "acorn";
import { JSDOM } from "jsdom";
import { buildStore } from "../../scripts/buildStore.mjs";
import { identityRevision } from "../../src/lib/storeIdentity.ts";

const root = path.resolve(import.meta.dirname, "../..");
const control =
  "C:/Users/Gabriel/recuperacao-ikcous/20260909-ecossistema/controle";
const kit = path.join(control, "identidade-real-a6");
const approvedHash =
  "cb5d259e7a35cd1e1ea7ed1c97e3d73b73cc55e8b71701c2604a59989382d74c";
const base = "915185ff06c5920de63af9d7f4b18fe943d7082e";
const roles = [
  "header",
  "loader",
  "favicon",
  "apple_touch",
  "icon_192",
  "icon_512",
  "maskable_512",
  "og",
];
const essentialRoles = roles.filter((role) => role !== "og");
const sourcePaths = [
  "scripts",
  "src",
  "public",
  "index.html",
  "vite.config.ts",
  "package.json",
  "package-lock.json",
  "tsconfig.app.json",
  "tsconfig.node.json",
  "tests/front/local-identity-build-fixture.test.ts",
  "tests/front/identity-build-config.test.ts",
  "tests/identity-real-kit-build/run.mjs",
  "tests/identity-real-kit-build/README.md",
];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const git = (args) =>
  execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

// Same reviewed literal-array parser as identity-admin-install; never executes SW.
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

async function physical(target, directory) {
  assert(
    path.isAbsolute(target) &&
      !target.startsWith("\\\\") &&
      !target.startsWith("//"),
    "local path required",
  );
  const parts = target.slice(path.parse(target).root.length).split(/[\\/]/);
  assert(
    parts.every(
      (part) =>
        part && part !== "." && part !== ".." && !/[. ]$|[<>:"|?*]/.test(part),
    ),
    "closed path required",
  );
  const ancestors = [];
  for (let current = target; ; current = path.dirname(current)) {
    ancestors.unshift(current);
    if (current === path.dirname(current)) break;
  }
  for (const current of ancestors) {
    const stat = await fs.lstat(current);
    assert(!stat.isSymbolicLink(), "links forbidden");
    assert(
      current === target && !directory
        ? stat.isFile() && stat.nlink === 1
        : stat.isDirectory(),
      "physical path required",
    );
  }
}
async function writeNew(target, bytes) {
  await physical(path.dirname(target), true);
  await fs.writeFile(target, bytes, { flag: "wx" });
}
async function absentEnv() {
  // Vite config calls loadEnv itself: envFile:false alone is insufficient.
  for (const name of [
    ".env",
    ".env.local",
    ".env.production",
    ".env.production.local",
  ]) {
    let stat;
    try {
      stat = await fs.lstat(path.join(root, name));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    assert(!stat, "A6B_ENV_FILE_PRESENT");
  }
}
async function filesIn(directory, relative = "") {
  await physical(path.join(directory, relative), true);
  const files = [];
  for (const name of (
    await fs.readdir(path.join(directory, relative))
  ).sort()) {
    const child = path.join(relative, name);
    const stat = await fs.lstat(path.join(directory, child));
    assert(!stat.isSymbolicLink(), "tree links forbidden");
    if (stat.isDirectory()) files.push(...(await filesIn(directory, child)));
    else {
      assert(stat.isFile() && stat.nlink === 1, "regular files required");
      files.push(child);
    }
  }
  return files;
}
async function digestFiles(directory, names) {
  const result = [];
  for (const name of names) {
    const target = path.join(directory, name);
    await physical(target, false);
    const bytes = await fs.readFile(target);
    result.push({
      path: name.replaceAll("\\", "/"),
      bytes: bytes.length,
      sha256: hash(bytes),
    });
  }
  return result;
}
async function sources() {
  const names = new Set(
    git(["ls-files", "-z", "--", ...sourcePaths])
      .split("\0")
      .filter(Boolean),
  );
  for (const name of [
    "scripts/localIdentityBuildFixture.ts",
    "tests/front/local-identity-build-fixture.test.ts",
    "tests/identity-real-kit-build/run.mjs",
    "tests/identity-real-kit-build/README.md",
  ])
    names.add(name);
  assert(
    [...names].every((name) => !/(^|\/)\.env(?:\.|$)/.test(name)),
    "environment contents forbidden",
  );
  return digestFiles(root, [...names].sort());
}
async function preserve(source, destination) {
  await physical(source, true);
  await physical(path.dirname(destination), true);
  const names = await filesIn(source);
  await fs.mkdir(destination);
  for (const name of names) {
    const target = path.join(destination, name);
    assert(
      !path.relative(destination, target).startsWith(".."),
      "copy containment",
    );
    await fs.mkdir(path.dirname(target), { recursive: true });
    await physical(path.dirname(target), true);
    await fs.copyFile(path.join(source, name), target, constants.COPYFILE_EXCL);
  }
  const copied = await digestFiles(destination, names);
  assert.deepEqual(
    copied,
    await digestFiles(source, names),
    "preserved output bytes",
  );
  return copied;
}

// Called in a clean child; this plugin only observes resolved inputs and snapshot.
export async function buildSelectedKit(destination, store, codeSha) {
  assert(["ikcous", "savy"].includes(store), "closed store");
  await physical(destination, true);
  assert(
    path.dirname(destination) === path.resolve(control) &&
      path.basename(destination).startsWith("tarefa-A6b-"),
    "owned evidence root",
  );
  await absentEnv();
  assert.equal(git(["rev-parse", "HEAD"]), codeSha);
  const before = await sources();
  let snapshot;
  let inputs;
  let captures = 0;
  const observer = {
    name: "a6b-read-only-observer",
    configResolved(config) {
      captures++;
      snapshot = JSON.parse(config.define.__STORE_IDENTITY__);
      inputs = {
        root: config.root,
        mode: config.mode,
        outDir: config.build.outDir,
        envDir: config.envDir,
        input: config.build.rollupOptions.input ?? "index.html",
        plugins: config.plugins.map((plugin) => plugin.name),
      };
    },
  };
  const confirmed = await buildStore({
    root,
    mode: "production",
    envFile: false,
    logLevel: "warn",
    plugins: [observer],
  });
  // No output assertion or evidence of success occurs before buildStore resolves.
  assert.equal(captures, 1);
  const output = path.join(root, "dist-test");
  const artifact = path.join(destination, store);
  const hashes = await preserve(output, artifact);
  await writeNew(path.join(destination, `${store}-hashes.json`), json(hashes));
  await writeNew(
    path.join(destination, `${store}-snapshot.json`),
    json(snapshot),
  );
  await writeNew(path.join(destination, `${store}-inputs.json`), json(inputs));
  assert.deepEqual(await sources(), before, "sources changed during build");
  assert.equal(inputs.outDir, "dist-test");
  assert.equal(path.resolve(inputs.root), root);
  assert.equal(inputs.envDir, false);
  assert.equal(inputs.input, "index.html");
  assert.equal(snapshot.source, "fixture");
  assert.equal(snapshot.codeSha, codeSha);
  assert.equal(
    snapshot.identity.storeName,
    store === "ikcous" ? "Ensaio IKCOUS" : "Ensaio Savy",
  );
  assert.equal(snapshot.publicUrl, "https://loja-ensaio.invalid");
  assert.deepEqual(snapshot.identity.theme, {
    primary: "#863B50",
    secondary: "#FFFFFF",
    accent: "#C99730",
  });
  assert.equal(snapshot.identity.city, null);
  assert.equal(snapshot.identity.state, null);
  const version = JSON.parse(
    await fs.readFile(path.join(artifact, "version.json"), "utf8"),
  );
  assert.deepEqual(version, confirmed);
  assert.equal(version.source, "fixture");
  assert.equal(version.promotable, false);
  assert.equal(version.codeSha, codeSha);
  assert.equal(version.identityRevision, snapshot.identityRevision);
  assert.equal(
    snapshot.identityRevision,
    await identityRevision(snapshot.identity),
  );
  assert.equal(version.version, snapshot.deliveryVersion);
  assert.equal(
    version.version,
    `${snapshot.codeVersion}-sha.${codeSha.slice(0, 7)}-identity.${snapshot.identityRevision}`,
  );
  const manifestBytes = await fs.readFile(path.join(kit, "manifesto.json"));
  assert.equal(hash(manifestBytes), approvedHash);
  const manifest = JSON.parse(manifestBytes);
  const selected = Reflect.get(manifest.stores, store);
  assert.deepEqual(snapshot.identity.assets, selected);
  const descriptors = new Map(
    [
      ...selected.originals,
      ...roles.map((role) => Reflect.get(selected, role)),
    ].map((asset) => [asset.path, asset]),
  );
  assert.equal(descriptors.size, store === "ikcous" ? 7 : 10);
  const local = (asset) => `/store-identity/${asset.path}`;
  for (const role of roles)
    assert.equal(
      Reflect.get(snapshot.localUrls, role),
      local(Reflect.get(selected, role)),
    );
  assert.deepEqual(snapshot.localUrls.originals, selected.originals.map(local));
  for (const asset of descriptors.values()) {
    const input = path.join(kit, "objetos", asset.path.slice(3));
    await physical(input, false);
    const original = await fs.readFile(input);
    const delivered = await fs.readFile(
      path.join(artifact, "store-identity", asset.path),
    );
    assert.equal(delivered.length, asset.bytes);
    assert.equal(hash(delivered), asset.sha256);
    assert.deepEqual(delivered, original);
  }
  assert.deepEqual(
    (await filesIn(path.join(artifact, "store-identity")))
      .map((name) => name.replaceAll("\\", "/"))
      .sort(),
    [...descriptors.keys()].sort(),
  );
  for (const value of [
    ...snapshot.identity.urls.originals,
    ...roles.map((role) => Reflect.get(snapshot.identity.urls, role)),
  ])
    assert(
      value.startsWith(
        "https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/branding/",
      ),
    );
  const html = await fs.readFile(path.join(artifact, "index.html"), "utf8");
  const document = new JSDOM(html).window.document;
  assert.equal(document.title, snapshot.identity.storeName);
  const meta = (name) =>
    document
      .querySelector(`meta[name="${name}"],meta[property="${name}"]`)
      ?.getAttribute("content");
  for (const name of [
    "application-name",
    "apple-mobile-web-app-title",
    "og:title",
    "twitter:title",
  ])
    assert.equal(meta(name), snapshot.identity.storeName);
  for (const name of ["description", "og:description", "twitter:description"])
    assert.equal(
      meta(name),
      `Produtos e novidades de ${snapshot.identity.storeName}`,
    );
  assert.equal(meta("theme-color"), snapshot.identity.theme.primary);
  assert.equal(meta("background-color"), snapshot.identity.theme.primary);
  assert.equal(meta("og:url"), `${snapshot.publicUrl}/`);
  for (const name of ["og:image", "twitter:image"])
    assert.equal(meta(name), `${snapshot.publicUrl}${snapshot.localUrls.og}`);
  assert.equal(
    document.querySelector('link[rel="icon"]')?.getAttribute("href"),
    snapshot.localUrls.favicon,
  );
  assert.equal(
    document
      .querySelector('link[rel="apple-touch-icon"]')
      ?.getAttribute("href"),
    snapshot.localUrls.apple_touch,
  );
  assert.equal(
    document.querySelector(".guardian-logo")?.getAttribute("src"),
    snapshot.localUrls.loader,
  );
  assert(
    snapshot.localUrls.loader.endsWith(".svg"),
    "real approved SVG loader",
  );
  assert.equal(
    document.querySelector(".cinematic-text")?.textContent,
    snapshot.identity.storeName,
  );
  assert(
    !html.includes("ickous-marketplace.vercel.app"),
    "no inherited real public origin",
  );
  const webmanifest = JSON.parse(
    await fs.readFile(path.join(artifact, "manifest.webmanifest"), "utf8"),
  );
  assert.equal(webmanifest.name, snapshot.identity.storeName);
  assert.equal(webmanifest.short_name, snapshot.identity.storeName);
  assert.equal(webmanifest.theme_color, snapshot.identity.theme.primary);
  assert.deepEqual(
    webmanifest.icons.map((icon) => icon.src),
    [
      snapshot.localUrls.icon_192,
      snapshot.localUrls.icon_512,
      snapshot.localUrls.maskable_512,
    ],
  );
  const sw = await fs.readFile(path.join(artifact, "sw.js"), "utf8");
  const essentials = new Set(
    essentialRoles.map((role) =>
      Reflect.get(snapshot.localUrls, role).slice(1),
    ),
  );
  const precached = readPrecache(sw)
    .map((entry) => entry.url)
    .filter((url) => url.startsWith("store-identity/"));
  assert.deepEqual(
    [...new Set(precached)].sort(),
    [...essentials].sort(),
    "precache selected by role, including shared originals",
  );
  for (const url of [...snapshot.localUrls.originals, snapshot.localUrls.og])
    if (!essentials.has(url.slice(1)))
      assert(
        !precached.includes(url.slice(1)),
        "exclusive original/OG excluded",
      );
  assert(
    (
      await fs.readFile(path.join(artifact, "silent-guardian.js"), "utf8")
    ).includes(JSON.stringify(snapshot.deliveryVersion)),
  );
  await writeNew(
    path.join(destination, `${store}-result.json`),
    json({
      status: "PASS_BUILD_ONLY",
      objects: descriptors.size,
      essentialPaths: essentials.size,
      identityRevision: snapshot.identityRevision,
      deliveryVersion: snapshot.deliveryVersion,
      source: "fixture",
      promotable: false,
    }),
  );
  console.log(
    `A6B_PASS ${store}: ${descriptors.size} paths; ${essentials.size} essential paths; fixture; promotable=false`,
  );
}

async function main() {
  assert.equal(process.argv.length, 2, "no arguments accepted");
  await physical(root, true);
  await physical(control, true);
  await physical(kit, true);
  await absentEnv();
  git(["merge-base", "--is-ancestor", base, "HEAD"]);
  const codeSha = git(["rev-parse", "HEAD"]);
  assert(/^[a-f0-9]{40}$/.test(codeSha));
  const runId = `${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}`;
  const destination = path.join(control, `tarefa-A6b-${runId}`);
  await fs.mkdir(destination);
  const before = await sources();
  await writeNew(path.join(destination, "sources-before.json"), json(before));
  await writeNew(
    path.join(destination, "run.json"),
    json({
      codeSha,
      base,
      approvedManifestSha256: approvedHash,
      scope: "real-build-only",
      promotable: false,
      environmentFiles: "absent by filename only",
      childEnvironment:
        "OS allowlist plus fixture mode, code SHA and local selector",
    }),
  );
  const output = path.join(root, "dist-test");
  let previous;
  try {
    previous = await fs.lstat(output);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (previous)
    await writeNew(
      path.join(destination, "previous-output-hashes.json"),
      json(await preserve(output, path.join(destination, "previous-output"))),
    );
  console.log(`A6B_EVIDENCE ${destination}`);
  for (const store of ["ikcous", "savy"]) {
    await absentEnv();
    assert.deepEqual(
      await sources(),
      before,
      "sources must stay frozen between builds",
    );
    const selectorFile = path.join(destination, `${store}-selector.json`);
    await writeNew(
      selectorFile,
      json({
        kind: "local-kit",
        directory: kit,
        store,
        expectedManifestSha256: approvedHash,
        phase: "baseline",
      }),
    );
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) =>
        /^(PATH|SYSTEMROOT|WINDIR|SYSTEMDRIVE|COMSPEC|PATHEXT|TEMP|TMP|USERPROFILE|LOCALAPPDATA|APPDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|PROGRAMDATA|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE)$/i.test(
          key,
        ),
      ),
    );
    Object.assign(env, {
      IKCOUS_IDENTITY_MODE: "fixture",
      IKCOUS_CODE_SHA: codeSha,
      IKCOUS_IDENTITY_FIXTURE_FILE: selectorFile,
    });
    const script = `import { buildSelectedKit } from ${JSON.stringify(import.meta.url)}; await buildSelectedKit(${JSON.stringify(destination)}, ${JSON.stringify(store)}, ${JSON.stringify(codeSha)});`;
    const child = spawn(
      process.execPath,
      ["--input-type=module", "--eval", script],
      { cwd: root, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
    );
    const chunks = [];
    child.stdout.on("data", (chunk) => {
      chunks.push(chunk);
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      chunks.push(chunk);
      process.stderr.write(chunk);
    });
    const status = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    await writeNew(
      path.join(destination, `${store}-build.log`),
      Buffer.concat(chunks),
    );
    assert.equal(status, 0, "real pipeline must complete before next store");
  }
  const after = await sources();
  await writeNew(path.join(destination, "sources-after.json"), json(after));
  assert.deepEqual(after, before);
  await writeNew(
    path.join(destination, "result.json"),
    json({
      status: "PASS_BUILD_ONLY",
      stores: ["ikcous", "savy"],
      codeSha,
      promotable: false,
      limits:
        "No app boot, Header, browser, installed SW, offline, update UI, services or production verification. A6c remains mandatory.",
    }),
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
