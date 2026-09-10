/* eslint-disable security/detect-non-literal-fs-filename -- Only isolated mkdtemp kits are mutated; production kit paths are never used. */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createIdentityBuildFixture } from "../../scripts/identityBuildFixture";
import {
  type LocalKitFixture,
  createLocalIdentityBuildFixture,
  readLocalKitFixtureSelector,
} from "../../scripts/localIdentityBuildFixture";
import { identityRevision } from "../../src/lib/storeIdentity";

type Mutable<T> = {
  -readonly [K in keyof T]: T[K] extends object ? Mutable<T[K]> : T[K];
};
const roots: string[] = [];
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    if (
      path.dirname(root) !== os.tmpdir() ||
      !path.basename(root).startsWith("local-kit-test-")
    )
      throw new Error("unsafe cleanup");
    await fs.rm(root, { recursive: true, force: true });
  }
});

async function kit() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "local-kit-test-"));
  roots.push(directory);
  const aurora = await createIdentityBuildFixture();
  const oceano = await createIdentityBuildFixture("oceano");
  const assets = structuredClone(aurora.identity.assets) as Mutable<
    typeof aurora.identity.assets
  >;
  // Same bytes, distinct paths: deduplicating only by SHA must lose this original.
  const duplicate = {
    ...assets.favicon,
    path: assets.favicon.path.replace("favicon.svg", "original.svg"),
  };
  assets.originals.push(duplicate);
  for (const file of [
    ...aurora.files,
    ...oceano.files,
    {
      ...aurora.files.find((file) => file.path === assets.favicon.path)!,
      path: duplicate.path,
    },
  ]) {
    const target = path.join(directory, "objetos", file.path.slice(3));
    await fs.mkdir(path.dirname(target), { recursive: true });
    try {
      await fs.writeFile(target, file.bytes, { flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  const manifest = {
    scope: "local-preparation",
    promotable: false,
    uploaded: false,
    stores: { ikcous: assets, savy: structuredClone(oceano.identity.assets) },
    sources: [{ source: "https://forbidden.invalid" }],
    objects: [{ local: "../../forbidden" }],
  };
  async function save() {
    const bytes = Buffer.from(JSON.stringify(manifest));
    await fs.writeFile(path.join(directory, "manifesto.json"), bytes);
    return hash(bytes);
  }
  const selector = {
    kind: "local-kit",
    directory,
    store: "ikcous",
    expectedManifestSha256: await save(),
    phase: "baseline",
  };
  return { directory, manifest, selector, save, aurora, oceano };
}
// The existing exported function is the tested boundary, so RED is a wrong result,
// never a missing import for the new reader.
const read = (selector: unknown) =>
  createIdentityBuildFixture(selector as never);

// Capture before spying: on Windows path and path.win32 are the same object.
const windowsPath = {
  isAbsolute: path.win32.isAbsolute,
  parse: path.win32.parse,
  dirname: path.win32.dirname,
  join: path.win32.join,
};

describe("namespace de rede recusado antes de I/O", () => {
  const inputs = [
    String.raw`\\server.invalid\share\kit`,
    "//server.invalid/share/kit",
    String.raw`/\server.invalid\share\kit`,
    String.raw`\/server.invalid\share\kit`,
    String.raw`\\?\UNC\server.invalid\share\kit`,
    String.raw`\\?\C:\kit`,
    String.raw`\\.\C:\kit`,
  ];
  for (const boundary of ["seletor", "diretório"] as const) {
    it.each(inputs)(
      `${boundary} recusa %s com zero chamadas`,
      async (input) => {
        // Real local stat shapes; synthetic replies never delegate to filesystem.
        const directoryStat = await fs.lstat(os.tmpdir());
        const fileStat = await fs.lstat(new URL(import.meta.url));
        const selected: LocalKitFixture = {
          kind: "local-kit",
          directory: String.raw`C:\kit`,
          store: "ikcous",
          expectedManifestSha256: "0".repeat(64),
          phase: "baseline",
        };
        const bytes = Buffer.from(JSON.stringify(selected));
        const target =
          boundary === "seletor" ? `${input}\\selector.json` : input;
        fileStat.size = bytes.length;
        fileStat.nlink = 1;
        const stats = vi
          .spyOn(fs, "lstat")
          .mockImplementation(async (value) =>
            String(value).endsWith(".json") ? fileStat : directoryStat,
          );
        const reads = vi.spyOn(fs, "readFile").mockResolvedValue(bytes);
        vi.spyOn(path, "isAbsolute").mockImplementation(windowsPath.isAbsolute);
        vi.spyOn(path, "parse").mockImplementation(windowsPath.parse);
        vi.spyOn(path, "dirname").mockImplementation(windowsPath.dirname);
        vi.spyOn(path, "join").mockImplementation(windowsPath.join);
        try {
          const result = await (boundary === "seletor"
            ? readLocalKitFixtureSelector(target)
            : createLocalIdentityBuildFixture({
                ...selected,
                directory: target,
              })
          ).then(
            (value) => value,
            (error: unknown) => error,
          );
          expect(stats).not.toHaveBeenCalled();
          expect(reads).not.toHaveBeenCalled();
          expect(result).toEqual(new Error("IDENTITY_LOCAL_KIT"));
        } finally {
          vi.restoreAllMocks();
        }
      },
    );
  }
});

describe("kit local fechado de identidade", () => {
  it.each(["ikcous", "savy"] as const)(
    "lê seletor físico local de %s",
    async (store) => {
      const fixture = await kit();
      const selected = { ...fixture.selector, store };
      const file = path.join(fixture.directory, "selector.json");
      await fs.writeFile(file, JSON.stringify(selected));
      const parsed = await readLocalKitFixtureSelector(file);
      expect(parsed).toEqual(selected);
      expect(Object.isFrozen(parsed)).toBe(true);
      expect(await createLocalIdentityBuildFixture(parsed)).toEqual(
        await read(selected),
      );
    },
  );
  it("não aceita objeto no lugar do enum textual", async () => {
    const fixture = await kit();
    const store = { toString: () => "ikcous" };
    await expect(read({ ...fixture.selector, store })).rejects.toThrow(
      /^IDENTITY_LOCAL_KIT$/,
    );
  });
  it("marca selecionada independe dos arquivos da outra marca e proveniência", async () => {
    const fixture = await kit();
    for (const file of fixture.oceano.files)
      await fs.unlink(
        path.join(fixture.directory, "objetos", file.path.slice(3)),
      );
    const selected = await read(fixture.selector);
    expect(selected.identity.storeName).toBe("Ensaio IKCOUS");
  });
  it.each(["ikcous", "savy"])(
    "preserva bytes e revisões nas duas fases de %s",
    async (store) => {
      const fixture = await kit();
      const baseline = await read({ ...fixture.selector, store });
      expect(baseline.identity.storeName).toBe(
        store === "ikcous" ? "Ensaio IKCOUS" : "Ensaio Savy",
      );
      expect(baseline.identity.theme).toEqual({
        primary: "#863B50",
        secondary: "#FFFFFF",
        accent: "#C99730",
      });
      expect(baseline.identity.city).toBeNull();
      expect(baseline.identity.state).toBeNull();
      expect(Object.isFrozen(baseline)).toBe(true);
      expect(Object.isFrozen(baseline.files)).toBe(true);
      for (const file of baseline.files) {
        expect(Buffer.from(file.bytes)).toEqual(
          await fs.readFile(
            path.join(fixture.directory, "objetos", file.path.slice(3)),
          ),
        );
      }
      if (store === "ikcous")
        expect(
          baseline.files.filter(
            (file) =>
              file.sha256 === fixture.manifest.stores.ikcous.favicon.sha256,
          ),
        ).toHaveLength(2);
      const update = await read({
        ...fixture.selector,
        store,
        phase: "update",
      });
      expect(update.identity.storeName).toBe(
        `${baseline.identity.storeName} — atualização`,
      );
      expect(update.files).toEqual(baseline.files);
      expect(update.revision).not.toBe(baseline.revision);
      expect(update.revision).toBe(await identityRevision(update.identity));
      expect((await read({ ...fixture.selector, store })).revision).toBe(
        baseline.revision,
      );
    },
  );
  it("mantém variantes antigas e padrão", async () => {
    expect(await createIdentityBuildFixture()).toEqual(
      await createIdentityBuildFixture("aurora"),
    );
    expect(
      (await createIdentityBuildFixture("oceano")).identity.storeName,
    ).toBe("Loja Oceano — Ensaio");
  });
  it.each([
    "hash",
    "manifest-tampered",
    "missing",
    "swapped",
    "truncated",
    "oversized",
  ])("recusa %s sem aceitar outra assinatura", async (failure) => {
    const fixture = await kit();
    const target = path.join(
      fixture.directory,
      "objetos",
      fixture.manifest.stores.ikcous.header.path.slice(3),
    );
    if (failure === "hash")
      fixture.selector.expectedManifestSha256 = "0".repeat(64);
    if (failure === "manifest-tampered")
      await fs.appendFile(path.join(fixture.directory, "manifesto.json"), " ");
    if (failure === "missing") await fs.unlink(target);
    if (failure === "swapped") {
      const bytes = await fs.readFile(target);
      bytes[0] ^= 1;
      await fs.writeFile(target, bytes);
    }
    if (failure === "truncated") await fs.truncate(target, 1);
    if (failure === "oversized")
      await fs.truncate(target, 20 * 1024 * 1024 + 1);
    const reads = vi.spyOn(fs, "readFile");
    await expect(read(fixture.selector)).rejects.toThrow(
      /^IDENTITY_LOCAL_KIT$/,
    );
    if (["oversized", "missing", "truncated"].includes(failure))
      expect(reads.mock.calls.some(([value]) => value === target)).toBe(false);
  });
  it.each([
    "scope",
    "promotable",
    "uploaded",
    "store",
    "schema",
    "path",
    "conflict",
    "too-many",
  ])("recusa manifesto sintético inválido %s", async (failure) => {
    const fixture = await kit();
    if (failure === "scope") fixture.manifest.scope = "remote";
    if (failure === "promotable") fixture.manifest.promotable = true;
    if (failure === "uploaded") fixture.manifest.uploaded = true;
    if (failure === "store")
      Reflect.deleteProperty(fixture.manifest.stores, "ikcous");
    if (failure === "schema")
      Reflect.set(fixture.manifest.stores.ikcous, "unknown", true);
    if (failure === "path")
      fixture.manifest.stores.ikcous.header.path = "../../private";
    if (failure === "conflict")
      fixture.manifest.stores.ikcous.loader = {
        ...fixture.manifest.stores.ikcous.header,
        bytes: 1,
      };
    if (failure === "too-many")
      fixture.manifest.stores.ikcous.originals = Array.from(
        { length: 9 },
        () => fixture.manifest.stores.ikcous.header,
      );
    fixture.selector.expectedManifestSha256 = await fixture.save();
    await expect(read(fixture.selector)).rejects.toThrow(
      /^IDENTITY_LOCAL_KIT$/,
    );
  });
  it.each([
    "extra",
    "kind",
    "phase",
    "store",
    "sha",
    "empty",
    "url",
    "unc",
    "device",
    "ads",
    "traversal",
    "directory-file",
  ])("recusa seletor %s", async (failure) => {
    const fixture = await kit();
    const selector = { ...fixture.selector };
    if (failure === "extra") Reflect.set(selector, "secret", "never echo this");
    if (failure === "kind") selector.kind = "database";
    if (failure === "phase") selector.phase = "live";
    if (failure === "store") selector.store = "other";
    if (failure === "sha") selector.expectedManifestSha256 = "A".repeat(64);
    if (failure === "empty") selector.directory = "";
    if (failure === "url") selector.directory = "https://forbidden.invalid/kit";
    if (failure === "unc") selector.directory = "\\\\server\\share";
    if (failure === "device") selector.directory = "\\\\?\\C:\\kit";
    if (failure === "ads") selector.directory += ":stream";
    if (failure === "traversal") selector.directory += "/../kit";
    if (failure === "directory-file")
      selector.directory = path.join(fixture.directory, "manifesto.json");
    const remote = ["url", "unc", "device"].includes(failure);
    if (remote) {
      // Even a broken guard must never let a negative test reach the network.
      vi.spyOn(fs, "lstat").mockRejectedValue(new Error("blocked test I/O"));
      vi.spyOn(fs, "readFile").mockRejectedValue(new Error("blocked test I/O"));
    }
    await expect(read(selector)).rejects.toThrow(/^IDENTITY_LOCAL_KIT$/);
    if (remote) {
      expect(fs.lstat).not.toHaveBeenCalled();
      expect(fs.readFile).not.toHaveBeenCalled();
    }
  });
  it("recusa manifesto grande ou diretório antes de leitura", async () => {
    const fixture = await kit();
    const target = path.join(fixture.directory, "manifesto.json");
    await fs.truncate(target, 256 * 1024 + 1);
    const reads = vi.spyOn(fs, "readFile");
    await expect(read(fixture.selector)).rejects.toThrow(
      /^IDENTITY_LOCAL_KIT$/,
    );
    expect(reads).not.toHaveBeenCalled();
    await fs.unlink(target);
    await fs.mkdir(target);
    await expect(read(fixture.selector)).rejects.toThrow(
      /^IDENTITY_LOCAL_KIT$/,
    );
  });
  it("recusa junction em ancestral antes de qualquer leitura", async () => {
    const fixture = await kit();
    const alias = path.join(fixture.directory, "alias");
    await fs.symlink(fixture.directory, alias, "junction");
    try {
      const reads = vi.spyOn(fs, "readFile");
      await expect(
        read({ ...fixture.selector, directory: alias }),
      ).rejects.toThrow(/^IDENTITY_LOCAL_KIT$/);
      expect(reads).not.toHaveBeenCalled();
    } finally {
      await fs.unlink(alias);
    }
  });
  it("recusa link de objeto e manifesto sem seguir o destino", async () => {
    const fixture = await kit();
    for (const target of [
      path.join(
        fixture.directory,
        "objetos",
        fixture.manifest.stores.ikcous.header.path.slice(3),
      ),
      path.join(fixture.directory, "manifesto.json"),
    ]) {
      const preserved = `${target}.preserved`;
      await fs.rename(target, preserved);
      await fs.symlink(preserved, target, "file");
      try {
        await expect(read(fixture.selector)).rejects.toThrow(
          /^IDENTITY_LOCAL_KIT$/,
        );
      } finally {
        await fs.unlink(target);
        await fs.rename(preserved, target);
      }
    }
  });
});
