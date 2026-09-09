/* eslint-disable security/detect-non-literal-fs-filename -- Paths are validated local build roots and fixed output names; the temporary marker is exclusively reserved. */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const failure = (code) => new Error(`IDENTITY_${code}`);
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const samePath = (one, two) => path.relative(one, two) === "";

async function statOrMissing(target) {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function localDirectory(value, missing = false) {
  if (
    typeof value !== "string" ||
    !path.isAbsolute(value) ||
    value.startsWith("\\\\") ||
    value.startsWith("//") ||
    value.includes("\0") ||
    value.split(/[\\/]/).some((part) => part === "." || part === "..")
  )
    throw failure("OUTPUT");
  if (process.platform === "win32") {
    const parts = value.slice(path.parse(value).root.length).split(/[\\/]/);
    if (
      parts.some(
        (part) =>
          /[. ]$|[<>:"|?*]/.test(part) ||
          [...part].some((char) => char.charCodeAt(0) < 32) ||
          /^(con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(
            part,
          ),
      )
    )
      throw failure("OUTPUT");
  }
  const absolute = path.resolve(value);
  for (let current = absolute; ; current = path.dirname(current)) {
    const stat = await statOrMissing(current);
    if (
      (!stat && !(missing && current === absolute)) ||
      (stat && (stat.isSymbolicLink() || !stat.isDirectory()))
    )
      throw failure("OUTPUT");
    if (current === path.dirname(current)) break;
  }
  const stat = await statOrMissing(absolute);
  return stat
    ? fs.realpath(absolute)
    : path.join(
        await fs.realpath(path.dirname(absolute)),
        path.basename(absolute),
      );
}

function configuration(config, root, output) {
  const build = config.build ?? {};
  const outputs = Array.isArray(build.rollupOptions?.output)
    ? build.rollupOptions.output
    : [build.rollupOptions?.output];
  if (
    (config.root !== undefined && !samePath(path.resolve(config.root), root)) ||
    (build.outDir !== undefined &&
      !samePath(path.resolve(root, build.outDir), output)) ||
    outputs.some((item) => item?.dir !== undefined || item?.file !== undefined)
  )
    throw failure("OUTPUT");
  if (build.watch) throw failure("WATCH");
  if (build.write === false) throw failure("WRITE");
}

function metadata(define, source, version) {
  let snapshot;
  let appVersion;
  try {
    snapshot = JSON.parse(define?.__STORE_IDENTITY__);
    appVersion = JSON.parse(define?.__APP_VERSION__);
  } catch {
    throw failure("SNAPSHOT");
  }
  const keys = [
    "schemaVersion",
    "source",
    "identity",
    "localUrls",
    "publicUrl",
    "codeVersion",
    "codeSha",
    "identityRevision",
    "deliveryVersion",
  ];
  if (
    !object(snapshot) ||
    Object.keys(snapshot).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(snapshot, key)) ||
    snapshot.schemaVersion !== 1 ||
    snapshot.source !== source ||
    !object(snapshot.identity) ||
    snapshot.identity.schemaVersion !== 1 ||
    !object(snapshot.localUrls) ||
    typeof snapshot.publicUrl !== "string" ||
    typeof snapshot.codeVersion !== "string" ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(snapshot.codeVersion) ||
    snapshot.codeVersion !== version ||
    typeof snapshot.codeSha !== "string" ||
    !/^[a-f0-9]{40}$/.test(snapshot.codeSha) ||
    typeof snapshot.identityRevision !== "string" ||
    !/^[a-f0-9]{64}$/.test(snapshot.identityRevision) ||
    snapshot.deliveryVersion !==
      `${snapshot.codeVersion}-sha.${snapshot.codeSha.slice(0, 7)}-identity.${snapshot.identityRevision}` ||
    appVersion !== snapshot.deliveryVersion
  )
    throw failure("SNAPSHOT");
  const publicUrl = new URL(snapshot.publicUrl);
  if (
    publicUrl.protocol !== "https:" ||
    publicUrl.username ||
    publicUrl.password ||
    publicUrl.search ||
    publicUrl.hash ||
    publicUrl.pathname !== "/"
  )
    throw failure("SNAPSHOT");
  return Object.freeze({
    version: snapshot.deliveryVersion,
    codeVersion: snapshot.codeVersion,
    codeSha: snapshot.codeSha,
    identityRevision: snapshot.identityRevision,
    source,
    promotable: source === "database",
  });
}

/**
 * One quiescent local destination, one Vite call, one private config snapshot.
 * A marker confirms this completed build only, never permission to publish it.
 * @param {import("vite").InlineConfig} options
 */
export async function buildStore(options = {}) {
  const allowed = new Set([
    "root",
    "mode",
    "configFile",
    "envFile",
    "plugins",
    "build",
    "logLevel",
  ]);
  if (!object(options) || Object.keys(options).some((key) => !allowed.has(key)))
    throw failure("OPTIONS");
  const root = await localDirectory(options.root ?? process.cwd());
  const mode = options.mode ?? "production";
  if (typeof mode !== "string" || !/^[a-zA-Z0-9_-]+$/.test(mode))
    throw failure("MODE");
  const { build, loadEnv } = await import("vite");
  const env = options.envFile === false ? process.env : loadEnv(mode, root, "");
  const source = env.IKCOUS_IDENTITY_MODE ?? "database";
  if (source !== "database" && source !== "fixture") throw failure("MODE");
  const output = path.join(root, source === "fixture" ? "dist-test" : "dist");
  configuration(options, root, output);
  await localDirectory(output, true);
  const marker = path.join(output, "version.json");
  const previous = await statOrMissing(marker);
  if (previous) {
    if (!previous.isFile() || previous.isSymbolicLink() || previous.nlink !== 1)
      throw failure("OUTPUT");
    // Only this marker is invalidated; unrelated output and temporaries are untouched.
    await fs.unlink(marker);
  }
  const { version } = JSON.parse(
    await fs.readFile(path.join(root, "package.json"), "utf8"),
  );
  let captured;
  let resolved;
  let identityDefine;
  let versionDefine;
  let captures = 0;
  const observer = {
    name: "store-build-finalization-observer",
    enforce: "post",
    configResolved(config) {
      captures++;
      if (captures !== 1) throw failure("SNAPSHOT_DUPLICATE");
      configuration(config, root, output);
      const envMatches =
        options.envFile === false
          ? config.envDir === false
          : typeof config.envDir === "string" &&
            samePath(path.resolve(config.envDir), root);
      if (!envMatches || config.mode !== mode || config.build.write !== true)
        throw failure("OUTPUT");
      captured = metadata(config.define, source, version);
      identityDefine = config.define.__STORE_IDENTITY__;
      versionDefine = config.define.__APP_VERSION__;
      resolved = config;
    },
  };
  // No plugin emits version.json. Vite rejects errors from write AND close hooks.
  const result = await build({
    ...options,
    root,
    mode,
    plugins: [...(options.plugins ?? []), observer],
  });
  if (captures !== 1 || !captured || !resolved)
    throw failure("SNAPSHOT_MISSING");
  configuration(resolved, root, output);
  if (
    resolved.define.__STORE_IDENTITY__ !== identityDefine ||
    resolved.define.__APP_VERSION__ !== versionDefine
  )
    throw failure("SNAPSHOT_CHANGED");
  const results = Array.isArray(result) ? result : [result];
  if (
    !results.length ||
    results.some((item) => !Array.isArray(item?.output) || !item.output.length)
  )
    throw failure("WRITE");
  if (
    !samePath(await localDirectory(root), root) ||
    !samePath(await localDirectory(output), output)
  )
    throw failure("OUTPUT");
  if (await statOrMissing(marker)) throw failure("MARKER_UNEXPECTED");
  const temporary = path.join(output, `version.json.${randomUUID()}.tmp`);
  // A failed write/rename propagates; only our exclusive temporary may remain.
  await fs.writeFile(temporary, JSON.stringify(captured, null, 2), {
    flag: "wx",
    encoding: "utf8",
  });
  await localDirectory(output);
  if (await statOrMissing(marker)) throw failure("MARKER_UNEXPECTED");
  await fs.rename(temporary, marker);
  return captured;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (process.argv.length !== 2) throw failure("OPTIONS");
    await buildStore();
  } catch {
    console.error("IDENTITY_BUILD_FAILED: entrega não confirmada.");
    process.exitCode = 1;
  }
}
