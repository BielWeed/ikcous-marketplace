import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import type { DownloadedStoreIdentity } from "../src/lib/publicStoreIdentity";
import {
  cloneStoreIdentity,
  identityAssetDescriptors,
  identityRevision,
} from "../src/lib/storeIdentity";
import type {
  IdentityAsset,
  PublicStoreIdentity,
} from "../src/lib/storeIdentity";

export interface PrepareIdentityBuildOptions {
  downloaded: DownloadedStoreIdentity;
  commonPublicDir: string;
  temporaryParent?: string;
  code: { version: string; sha: string };
}
export interface PreparedIdentityBuild {
  readonly publicDir: string;
  readonly identity: PublicStoreIdentity;
  readonly identityRevision: string;
  readonly codeVersion: string;
  readonly codeSha: string;
  readonly deliveryVersion: string;
  readonly localUrls: PublicStoreIdentity["urls"];
  readonly dispose: () => Promise<void>;
}

export class IdentityBuildError extends Error {
  readonly code: "IDENTITY_BUILD_INVALID" | "IDENTITY_BUILD_CLEANUP";
  readonly stagingDir?: string;
  constructor(
    code: "IDENTITY_BUILD_INVALID" | "IDENTITY_BUILD_CLEANUP",
    stagingDir?: string,
  ) {
    super(code);
    this.name = "IdentityBuildError";
    this.code = code;
    // Only our generated staging path is exposed, never native errors or input content.
    this.stagingDir = stagingDir;
  }
}
const invalid = () => new IdentityBuildError("IDENTITY_BUILD_INVALID");
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const retiredPaths = new Set([
  "logo.svg",
  "branding/logo.svg",
  "branding/logo.png",
  "branding/favicon.ico",
  "favicon.ico",
  "apple-touch-icon.png",
  "icons/icon-192x192.png",
  "icons/icon-512x512.png",
  "icons/icon-maskable-512x512.png",
  "og-image.png",
  "sitemap.xml",
  "version.json",
]);

function localPath(value: string): string {
  if (
    typeof value !== "string" ||
    !path.isAbsolute(value) ||
    value.startsWith("\\\\") ||
    value.startsWith("//") ||
    value.includes("\0") ||
    value.split(/[\\/]/).some((part) => part === "." || part === "..")
  )
    throw invalid();
  return path.resolve(value);
}
function within(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}
async function realDirectory(value: string): Promise<string> {
  const absolute = localPath(value);
  // lstat each ancestor: realpath alone would silently resolve a junction.
  for (let current = absolute; ; current = path.dirname(current)) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Validating each ancestor of the explicit local absolute path, without following links.
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw invalid();
    if (current === path.dirname(current)) break;
  }
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- All ancestors were checked above; caller guarantees quiescent paths.
  return fs.realpath(absolute);
}
interface TreeEntry {
  relative: string;
  directory: boolean;
}
async function tree(root: string, relative = ""): Promise<TreeEntry[]> {
  const result: TreeEntry[] = [];
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Root was validated; relative components come only from this directory walk.
  for (const name of await fs.readdir(path.join(root, relative))) {
    const child = path.join(relative, name);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Inspect the directory entry before descending; links are rejected below.
    const stat = await fs.lstat(path.join(root, child));
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()))
      throw invalid();
    result.push({ relative: child, directory: stat.isDirectory() });
    if (stat.isDirectory()) result.push(...(await tree(root, child)));
  }
  return result;
}
function assertCommonEntry(entry: TreeEntry): void {
  const parts = entry.relative.split(path.sep);
  const secretNames = new Set([
    ".env",
    ".git",
    ".ssh",
    ".aws",
    "id_rsa",
    "id_ed25519",
  ]);
  if (
    parts[0].toLowerCase() === "store-identity" ||
    (entry.directory && retiredPaths.has(parts.join("/"))) ||
    parts.some(
      (part) =>
        secretNames.has(part.toLowerCase()) ||
        part.toLowerCase().startsWith(".env.") ||
        /\.(pem|key|p12|pfx)$/i.test(part),
    )
  )
    throw invalid();
}

async function validateRaster(
  asset: IdentityAsset,
  bytes: Uint8Array,
): Promise<void> {
  const format = new Map([
    ["image/png", "png"],
    ["image/jpeg", "jpeg"],
    ["image/webp", "webp"],
  ]).get(asset.media_type);
  if (!format) {
    if (
      asset.media_type === "image/vnd.microsoft.icon" &&
      !(
        bytes.length >= 6 &&
        bytes[0] === 0 &&
        bytes[1] === 0 &&
        bytes[2] === 1 &&
        bytes[3] === 0 &&
        (bytes[4] > 0 || bytes[5] > 0)
      )
    )
      throw invalid();
    // SVG is never rendered here. Approved bytes remain intact; ICO follows A3's boundary.
    return;
  }
  // Do not let the autodetector route a forged raster descriptor into the SVG loader.
  const prefix = Buffer.from(
    bytes.buffer,
    bytes.byteOffset,
    Math.min(bytes.byteLength, 12),
  );
  if (
    (format === "png" &&
      !prefix
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
    (format === "jpeg" &&
      !(prefix[0] === 255 && prefix[1] === 216 && prefix[2] === 255)) ||
    (format === "webp" &&
      !(
        prefix.subarray(0, 4).toString("ascii") === "RIFF" &&
        prefix.subarray(8, 12).toString("ascii") === "WEBP"
      ))
  )
    throw invalid();
  const image = sharp(bytes, {
    failOn: "warning",
    limitInputPixels: 8192 * 8192,
  });
  try {
    const metadata = await image.metadata();
    if (
      metadata.format !== format ||
      !metadata.width ||
      !metadata.height ||
      metadata.width > 8192 ||
      metadata.height > 8192 ||
      (metadata.pages ?? 1) !== 1 ||
      (asset.width !== undefined &&
        (metadata.width !== asset.width || metadata.height !== asset.height))
    )
      throw invalid();
    // Decode the image supported by sharp, discard pixels; published bytes are unchanged.
    // APNG frames are not certified by sharp's PNG loader. Visual acceptance remains required.
    await image.raw().toBuffer();
  } finally {
    image.destroy();
  }
}

async function verifiedWrite(target: string, bytes: Uint8Array): Promise<void> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Target is inside this call's new staging, from checked descriptors or directory entries.
  await fs.mkdir(path.dirname(target), { recursive: true });
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Exclusive creation in private staging; never writes an existing caller destination.
  await fs.writeFile(target, bytes, { flag: "wx" });
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Read back only the file just created by this call.
  const written = await fs.readFile(target);
  if (!written.equals(Buffer.from(bytes)) || hash(written) !== hash(bytes))
    throw invalid();
}

function cleanup(
  staging: string,
  parent: string,
  owner: { dev: number; ino: number },
): () => Promise<void> {
  let disposed = false;
  let pending: Promise<void> | undefined;
  async function remove(): Promise<void> {
    if (disposed) return;
    try {
      const actualParent = await realDirectory(parent);
      if (
        actualParent !== parent ||
        path.dirname(staging) !== parent ||
        !path.basename(staging).startsWith("ikcous-identity-")
      )
        throw invalid();
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- Generated staging path retained in closure; parent was validated immediately above.
      const stat = await fs.lstat(staging).catch((error) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          return undefined;
        throw error;
      });
      if (!stat) {
        disposed = true;
        return;
      }
      if (
        stat.isSymbolicLink() ||
        !stat.isDirectory() ||
        stat.dev !== owner.dev ||
        stat.ino !== owner.ino ||
        (await realDirectory(staging)) !== staging
      )
        throw invalid();
      // Preflight the entire tree before deleting anything. Sources/staging must be quiescent.
      const contents = await tree(staging);
      for (const entry of contents.reverse()) {
        const target = path.join(staging, entry.relative);
        if (!within(staging, target)) throw invalid();
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- Recheck preflighted entry inside owned staging before removing it.
        const current = await fs.lstat(target);
        if (
          current.isSymbolicLink() ||
          current.isDirectory() !== entry.directory
        )
          throw invalid();
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- Only an empty directory in our checked staging; never recursive removal.
        if (entry.directory) await fs.rmdir(target);
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- Only the preflighted file in our checked staging, with no link following.
        else await fs.unlink(target);
      }
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- Same dev/inode validated above; contents were removed individually.
      await fs.rmdir(staging);
      disposed = true;
    } catch {
      throw new IdentityBuildError("IDENTITY_BUILD_CLEANUP", staging);
    }
  }
  return () => {
    if (!pending)
      pending = remove().finally(() => {
        pending = undefined;
      });
    return pending;
  };
}

export async function prepareIdentityBuild(
  options: PrepareIdentityBuildOptions,
): Promise<PreparedIdentityBuild> {
  let dispose: (() => Promise<void>) | undefined;
  let staging: string | undefined;
  try {
    // Everything caller-owned is copied before the first await, including Buffer views.
    const identity = cloneStoreIdentity(options.downloaded.identity);
    const revision = options.downloaded.revision;
    const codeVersion = options.code.version;
    const codeSha = options.code.sha;
    const sourceInput = localPath(options.commonPublicDir);
    const parentInput = localPath(options.temporaryParent ?? os.tmpdir());
    if (
      !Array.isArray(options.downloaded.files) ||
      options.downloaded.files.length > 16
    )
      throw invalid();
    const files = options.downloaded.files.map((file) => {
      if (
        !(file.bytes instanceof Uint8Array) ||
        file.bytes.length > 20 * 1024 * 1024
      )
        throw invalid();
      return {
        path: file.path,
        bytes: new Uint8Array(file.bytes),
        mediaType: file.mediaType,
        sha256: file.sha256,
      };
    });
    if (
      typeof codeVersion !== "string" ||
      typeof codeSha !== "string" ||
      !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(codeVersion) ||
      !/^[a-f0-9]{40}$/.test(codeSha)
    )
      throw invalid();
    const expected = new Map(
      identityAssetDescriptors(identity.assets).map((asset) => [
        asset.path,
        asset,
      ]),
    );
    if (
      files.length !== expected.size ||
      new Set(files.map((file) => file.path)).size !== files.length
    )
      throw invalid();
    for (const file of files) {
      const asset = expected.get(file.path);
      if (
        !asset ||
        file.mediaType !== asset.media_type ||
        file.bytes.length !== asset.bytes ||
        file.sha256 !== asset.sha256 ||
        hash(file.bytes) !== asset.sha256
      )
        throw invalid();
    }
    const calculatedRevision = await identityRevision(identity);
    if (revision !== calculatedRevision) throw invalid();
    for (const file of files)
      await validateRaster(expected.get(file.path)!, file.bytes);
    const source = await realDirectory(sourceInput);
    const parent = await realDirectory(parentInput);
    if (within(source, parent)) throw invalid();
    const commonEntries = await tree(source);
    for (const entry of commonEntries) assertCommonEntry(entry);
    staging = await fs.mkdtemp(path.join(parent, "ikcous-identity-"));
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Capture ownership of the directory returned by mkdtemp, never a caller destination.
    const owner = await fs.lstat(staging);
    dispose = cleanup(staging, parent, owner);
    if (within(source, staging) || within(staging, source)) throw invalid();
    const publicDir = path.join(staging, "public");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fresh directory below our own non-overlapping staging.
    await fs.mkdir(publicDir);
    for (const entry of commonEntries) {
      if (retiredPaths.has(entry.relative.split(path.sep).join("/"))) continue;
      const target = path.join(publicDir, entry.relative);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- Checked common relative directory, below private staging.
      if (entry.directory) await fs.mkdir(target, { recursive: true });
      else
        await verifiedWrite(
          target,
          // eslint-disable-next-line security/detect-non-literal-fs-filename -- Explicit public source was checked for links and secret filenames; source must stay quiescent.
          await fs.readFile(path.join(source, entry.relative)),
        );
    }
    for (const file of files)
      await verifiedWrite(
        path.join(publicDir, "store-identity", file.path),
        file.bytes,
      );
    const local = (asset: IdentityAsset) => `/store-identity/${asset.path}`;
    const localUrls = Object.freeze({
      originals: Object.freeze(identity.assets.originals.map(local)),
      header: local(identity.assets.header),
      loader: local(identity.assets.loader),
      favicon: local(identity.assets.favicon),
      apple_touch: local(identity.assets.apple_touch),
      icon_192: local(identity.assets.icon_192),
      icon_512: local(identity.assets.icon_512),
      maskable_512: local(identity.assets.maskable_512),
      og: local(identity.assets.og),
    });
    return Object.freeze({
      publicDir,
      identity,
      identityRevision: calculatedRevision,
      codeVersion,
      codeSha,
      deliveryVersion: `${codeVersion}-sha.${codeSha.slice(0, 7)}-identity.${calculatedRevision}`,
      localUrls,
      dispose,
    });
  } catch {
    if (dispose) await dispose();
    else if (staging)
      throw new IdentityBuildError("IDENTITY_BUILD_CLEANUP", staging);
    throw invalid();
  }
}
