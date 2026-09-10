/* eslint-disable security/detect-non-literal-fs-filename -- Every ancestor is checked before reading fixed, bounded local kit files. */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { DownloadedStoreIdentity } from "../src/lib/publicStoreIdentity";
import {
  identityAssetDescriptors,
  identityRevision,
  parseStoreIdentity,
} from "../src/lib/storeIdentity";

export type LocalKitFixture = Readonly<{
  kind: "local-kit";
  directory: string;
  store: "ikcous" | "savy";
  expectedManifestSha256: string;
  phase: "baseline" | "update";
}>;

const failure = () => new Error("IDENTITY_LOCAL_KIT");
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function localPath(value: unknown): string {
  if (
    typeof value !== "string" ||
    !path.isAbsolute(value) ||
    // Windows treats every pair of leading separators as UNC/device syntax.
    /^[\\/]{2}/.test(value)
  )
    throw failure();
  const parts = value.slice(path.parse(value).root.length).split(/[\\/]/);
  if (
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        /[. ]$|[<>:"|?*]/.test(part) ||
        [...part].some((char) => char.charCodeAt(0) < 32) ||
        /^(con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(
          part,
        ),
    )
  )
    throw failure();
  return value;
}

// Quiescent local paths only: lstat checks do not defeat malicious concurrent swaps.
async function physicalDirectory(value: string): Promise<void> {
  localPath(value);
  const ancestors: string[] = [];
  for (let current = value; ; current = path.dirname(current)) {
    ancestors.unshift(current);
    if (current === path.dirname(current)) break;
  }
  for (const ancestor of ancestors) {
    const stat = await fs.lstat(ancestor);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw failure();
  }
}

async function boundedFile(
  value: string,
  maximum: number,
  exact?: number,
): Promise<Buffer> {
  localPath(value);
  await physicalDirectory(path.dirname(value));
  const stat = await fs.lstat(value);
  if (
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    stat.nlink !== 1 ||
    stat.size < 1 ||
    stat.size > maximum ||
    (exact !== undefined && stat.size !== exact)
  )
    throw failure();
  const bytes = await fs.readFile(value);
  if (
    bytes.length !== stat.size ||
    bytes.length > maximum ||
    (exact !== undefined && bytes.length !== exact)
  )
    throw failure();
  return bytes;
}

function selector(value: unknown): LocalKitFixture {
  const fields = [
    "kind",
    "directory",
    "store",
    "expectedManifestSha256",
    "phase",
  ];
  if (
    !object(value) ||
    Object.keys(value).length !== fields.length ||
    fields.some((key) => !Object.hasOwn(value, key)) ||
    value.kind !== "local-kit" ||
    (value.store !== "ikcous" && value.store !== "savy") ||
    (value.phase !== "baseline" && value.phase !== "update") ||
    typeof value.expectedManifestSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.expectedManifestSha256)
  )
    throw failure();
  localPath(value.directory);
  return Object.freeze({ ...value }) as LocalKitFixture;
}

export async function readLocalKitFixtureSelector(
  file: string,
): Promise<LocalKitFixture> {
  try {
    return selector(
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          await boundedFile(file, 4096),
        ),
      ),
    );
  } catch {
    throw failure();
  }
}

export async function createLocalIdentityBuildFixture(
  value: LocalKitFixture,
): Promise<DownloadedStoreIdentity> {
  try {
    const input = selector(value);
    await physicalDirectory(input.directory);
    const bytes = await boundedFile(
      path.join(input.directory, "manifesto.json"),
      256 * 1024,
    );
    if (hash(bytes) !== input.expectedManifestSha256) throw failure();
    const manifest: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    if (
      !object(manifest) ||
      manifest.scope !== "local-preparation" ||
      manifest.promotable !== false ||
      manifest.uploaded !== false ||
      !object(manifest.stores) ||
      !Object.hasOwn(manifest.stores, input.store)
    )
      throw failure();
    const assets: unknown = Reflect.get(manifest.stores, input.store);
    const origin = "https://abcdefghijklmnopqrst.supabase.co";
    const header =
      object(assets) && object(assets.header) ? assets.header.path : undefined;
    const identity = parseStoreIdentity(
      {
        store_name: `${input.store === "ikcous" ? "Ensaio IKCOUS" : "Ensaio Savy"}${input.phase === "update" ? " — atualização" : ""}`,
        store_city: null,
        store_state: null,
        logo_url: `${origin}/storage/v1/object/public/branding/${header}`,
        // Deliberately artificial palette; never read live brand colors.
        primary_color: "#863B50",
        secondary_color: "#FFFFFF",
        accent_color: "#C99730",
        branding_assets: assets,
      },
      origin,
    );
    // A3 rejects conflicting descriptors at the same path, and caps refs at 16.
    const selected = new Map(
      identityAssetDescriptors(identity.assets).map((asset) => [
        asset.path,
        asset,
      ]),
    );
    const files: DownloadedStoreIdentity["files"][number][] = [];
    for (const asset of selected.values()) {
      // Never use manifest sources/provenance or objects.local as a filesystem path.
      const target = path.join(input.directory, "objetos", asset.path.slice(3));
      const data = await boundedFile(target, 20 * 1024 * 1024, asset.bytes);
      if (hash(data) !== asset.sha256) throw failure();
      files.push(
        Object.freeze({
          path: asset.path,
          bytes: new Uint8Array(data),
          mediaType: asset.media_type,
          sha256: asset.sha256,
        }),
      );
    }
    return Object.freeze({
      identity,
      revision: await identityRevision(identity),
      files: Object.freeze(files),
    });
  } catch {
    throw failure();
  }
}
