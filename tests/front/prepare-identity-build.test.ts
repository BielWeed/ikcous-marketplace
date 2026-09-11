import { createHash } from "node:crypto";
/* eslint-disable security/detect-non-literal-fs-filename -- All paths are isolated mkdtemp fixtures; real links are explicitly unlinked before fixture cleanup. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DownloadedStoreIdentity } from "@/lib/publicStoreIdentity";
import { identityRevision, parseStoreIdentity } from "@/lib/storeIdentity";
import type { IdentityAsset } from "@/lib/storeIdentity";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareIdentityBuild } from "../../scripts/prepareIdentity";

// Calls the installed decoder unchanged; observes which bytes reach its autodetector.
vi.mock("sharp", { spy: true });

const code = { version: "1.26.0", sha: "a".repeat(40) };
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
type Mutable<T> = {
  -readonly [K in keyof T]: T[K] extends Uint8Array
    ? Uint8Array
    : T[K] extends object
      ? Mutable<T[K]>
      : T[K];
};
const retired = [
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
];
let root: string;
let common: string;
let parent: string;

async function fixture(
  name = "Horizonte",
  ref = "abcdefghijklmnopqrst",
  color = "red",
): Promise<Mutable<DownloadedStoreIdentity>> {
  const files: Mutable<DownloadedStoreIdentity>["files"] = [];
  const add = (
    filename: string,
    bytes: Uint8Array,
    mime: IdentityAsset["media_type"],
    width?: number,
    height?: number,
  ): IdentityAsset => {
    const sha256 = hash(bytes);
    const assetPath = `v1/${sha256}/${filename}`;
    files.push({
      path: assetPath,
      bytes: new Uint8Array(bytes),
      mediaType: mime,
      sha256,
    });
    return {
      path: assetPath,
      sha256,
      media_type: mime,
      bytes: bytes.length,
      ...(width === undefined ? {} : { width, height }),
    };
  };
  const raster = async (
    filename: string,
    width: number,
    height: number,
    format: "png" | "jpeg" | "webp" = "png",
  ) =>
    add(
      filename,
      await sharp({ create: { width, height, channels: 4, background: color } })
        .toFormat(format)
        .toBuffer(),
      `image/${format}`,
      width,
      height,
    );
  const original = add(
    "original.svg",
    new TextEncoder().encode(
      `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><title>${name}</title><rect width="40" height="20" fill="${color}"/></svg>`,
    ),
    "image/svg+xml",
  );
  const assets = {
    version: 1,
    originals: [original],
    header: original,
    loader: await raster("loader.webp", 40, 20, "webp"),
    favicon: original,
    apple_touch: await raster("apple.png", 180, 180),
    icon_192: await raster("192.png", 192, 192),
    icon_512: await raster("512.png", 512, 512),
    maskable_512: await raster("maskable.png", 512, 512),
    og: await raster("og.png", 1200, 630),
  };
  const origin = `https://${ref}.supabase.co`;
  const identity = parseStoreIdentity(
    {
      store_name: name,
      store_city: null,
      store_state: null,
      logo_url: `${origin}/storage/v1/object/public/branding/${original.path}`,
      primary_color: "#123456",
      secondary_color: "#FFFFFF",
      accent_color: "#ABCDEF",
      branding_assets: assets,
    },
    origin,
  );
  return structuredClone({
    identity,
    revision: await identityRevision(identity),
    files,
  }) as Mutable<DownloadedStoreIdentity>;
}

async function put(relative: string, bytes: string | Uint8Array) {
  const target = path.join(common, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, bytes);
}
async function entries(dir: string): Promise<string[]> {
  const result: string[] = [];
  for (const item of await fs.readdir(dir, { withFileTypes: true })) {
    result.push(item.name);
    if (item.isDirectory())
      result.push(
        ...(await entries(path.join(dir, item.name))).map(
          (child) => `${item.name}/${child}`,
        ),
      );
  }
  return result.sort();
}
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "a4a-test-"));
  common = path.join(root, "common");
  parent = path.join(root, "stages");
  await fs.mkdir(common);
  await fs.mkdir(parent);
  await put("robots.txt", "robots comuns");
  await put("fonts/font.woff2", new Uint8Array([0, 1, 2, 255]));
  await fs.mkdir(path.join(common, "empty"));
  for (const filename of retired) await put(filename, "marca antiga");
});
afterEach(async () => {
  vi.restoreAllMocks();
  // Fixtures belong to this test and links introduced below are explicitly unlinked there.
  await fs.rm(root, { recursive: true, force: true });
});

describe("preparação privada da identidade", () => {
  it("isola duas lojas simultâneas e mantém versão determinística", async () => {
    const a = await fixture();
    const b = await fixture("Casa Lima", "zyxwvutsrqponmlkjihg", "blue");
    const [one, two, repeat] = await Promise.all(
      [a, b, a].map((downloaded) =>
        prepareIdentityBuild({
          downloaded,
          commonPublicDir: common,
          temporaryParent: parent,
          code,
        }),
      ),
    );
    expect(new Set([one.publicDir, two.publicDir, repeat.publicDir]).size).toBe(
      3,
    );
    expect(one.deliveryVersion).toBe(repeat.deliveryVersion);
    expect(one.deliveryVersion).not.toBe(two.deliveryVersion);
    expect(
      await entries(path.join(one.publicDir, "store-identity")),
    ).not.toEqual(await entries(path.join(two.publicDir, "store-identity")));
    for (const file of b.files)
      await expect(
        fs.stat(path.join(one.publicDir, "store-identity", file.path)),
      ).rejects.toMatchObject({ code: "ENOENT" });
    await one.dispose();
    expect((await fs.stat(two.publicDir)).isDirectory()).toBe(true);
    await Promise.all([two.dispose(), repeat.dispose()]);
  });
  it("captura todos os argumentos antes do primeiro await", async () => {
    const downloaded = await fixture();
    const saved = structuredClone(downloaded);
    const options = {
      downloaded,
      commonPublicDir: common,
      temporaryParent: parent,
      code: { ...code },
    };
    const pending = prepareIdentityBuild(options);
    downloaded.identity.storeName = "MUTADA";
    downloaded.revision = "b".repeat(64);
    for (const file of downloaded.files) {
      file.bytes.fill(0);
      file.path = "../outra";
    }
    downloaded.files.length = 0;
    options.code.sha = "b".repeat(40);
    options.commonPublicDir = root;
    const prepared = await pending;
    expect(prepared.identity.storeName).toBe(saved.identity.storeName);
    expect(prepared.identityRevision).toBe(saved.revision);
    expect(prepared.codeSha).toBe(code.sha);
    for (const file of saved.files)
      expect(
        await fs.readFile(
          path.join(prepared.publicDir, "store-identity", file.path),
        ),
      ).toEqual(Buffer.from(file.bytes));
    await prepared.dispose();
  });
  it.each([
    "missing",
    "extra",
    "duplicate",
    "traversal",
    "hash",
    "length",
    "mime",
    "revision",
    "identity",
  ])("recusa pacote alterado: %s", async (kind) => {
    const downloaded = await fixture();
    if (kind === "missing") downloaded.files.pop();
    if (kind === "extra")
      downloaded.files.push({
        ...downloaded.files[0],
        path: `v1/${"f".repeat(64)}/extra.svg`,
      });
    if (kind === "duplicate") downloaded.files.push(downloaded.files[0]);
    if (kind === "traversal") downloaded.files[0].path = "../../sentinel";
    if (kind === "hash") downloaded.files[0].sha256 = "f".repeat(64);
    if (kind === "length") downloaded.files[0].bytes = new Uint8Array(0);
    if (kind === "mime") downloaded.files[0].mediaType = "text/html";
    if (kind === "revision") downloaded.revision = "f".repeat(64);
    if (kind === "identity")
      downloaded.identity.urls.loader = "https://other.invalid/logo.svg";
    await expect(
      prepareIdentityBuild({
        downloaded,
        commonPublicDir: common,
        temporaryParent: parent,
        code,
      }),
    ).rejects.toThrow("IDENTITY_BUILD_INVALID");
    expect(await fs.readdir(parent)).toEqual([]);
  });
  it.each([
    { version: "01.2.3", sha: code.sha },
    { version: "1.2.3-beta", sha: code.sha },
    { version: "1.2.3", sha: "a".repeat(7) },
    { version: "1.2.3", sha: "A".repeat(40) },
  ])("recusa release inválida %j", async (invalidCode) => {
    await expect(
      prepareIdentityBuild({
        downloaded: await fixture(),
        commonPublicDir: common,
        temporaryParent: parent,
        code: invalidCode,
      }),
    ).rejects.toThrow("IDENTITY_BUILD_INVALID");
    expect(await fs.readdir(parent)).toEqual([]);
  });
  it.each(["dimensions", "truncated", "format", "bytes"])(
    "confere raster de verdade: %s",
    async (kind) => {
      const downloaded = await fixture();
      const asset = downloaded.identity.assets.og;
      const file = downloaded.files.find((item) => item.path === asset.path)!;
      if (kind === "dimensions") {
        file.bytes = await sharp({
          create: { width: 30, height: 20, channels: 3, background: "red" },
        })
          .png()
          .toBuffer();
      } else if (kind === "truncated") file.bytes = file.bytes.slice(0, 180);
      else if (kind === "format")
        // og agora só aceita PNG (decisão da hub, 11/09/2026): bytes JPEG de
        // verdade sob um descritor que declara PNG é o mesmo tipo de forja
        // que a assinatura barra antes de chamar o sharp.
        file.bytes = await sharp({
          create: { width: 1200, height: 630, channels: 3, background: "red" },
        })
          .jpeg()
          .toBuffer();
      else file.bytes[file.bytes.length - 1] ^= 1;
      if (kind !== "bytes") {
        file.sha256 = hash(file.bytes);
        file.path = `v1/${file.sha256}/og.png`;
        asset.sha256 = file.sha256;
        asset.path = file.path;
        asset.bytes = file.bytes.length;
        downloaded.identity.urls.og = `https://${downloaded.identity.projectRef}.supabase.co/storage/v1/object/public/branding/${file.path}`;
        downloaded.revision = await identityRevision(downloaded.identity);
      }
      await expect(
        prepareIdentityBuild({
          downloaded,
          commonPublicDir: common,
          temporaryParent: parent,
          code,
        }),
      ).rejects.toThrow("IDENTITY_BUILD_INVALID");
      expect(await fs.readdir(parent)).toEqual([]);
    },
  );
  it.each(["store-identity/conflict.txt", ".env", "nested/.env.production"])(
    "recusa namespace reservado ou segredo na fonte: %s",
    async (filename) => {
      await put(filename, "fixture only");
      await expect(
        prepareIdentityBuild({
          downloaded: await fixture(),
          commonPublicDir: common,
          temporaryParent: parent,
          code,
        }),
      ).rejects.toThrow("IDENTITY_BUILD_INVALID");
      expect(await fs.readdir(parent)).toEqual([]);
    },
  );
  it.each(["source", "parent", "ancestor", "inside", "retired"])(
    "não segue junction real em %s",
    async (location) => {
      const target = path.join(root, "external");
      await fs.mkdir(target);
      await fs.writeFile(path.join(target, "sentinel.txt"), "intacta");
      const link = path.join(root, "linked");
      let sourceDir = common;
      let tempDir = parent;
      let created = link;
      if (location === "source") {
        await fs.symlink(common, link, "junction");
        sourceDir = link;
      }
      if (location === "parent") {
        await fs.symlink(parent, link, "junction");
        tempDir = link;
      }
      if (location === "ancestor") {
        await fs.symlink(root, link, "junction");
        sourceDir = path.join(link, "common");
      }
      if (location === "inside") {
        created = path.join(common, "nested-link");
        await fs.symlink(target, created, "junction");
      }
      if (location === "retired") {
        created = path.join(common, "logo.svg");
        await fs.unlink(created);
        await fs.symlink(target, created, "junction");
      }
      try {
        await expect(
          prepareIdentityBuild({
            downloaded: await fixture(),
            commonPublicDir: sourceDir,
            temporaryParent: tempDir,
            code,
          }),
        ).rejects.toThrow("IDENTITY_BUILD_INVALID");
        expect(
          await fs.readFile(path.join(target, "sentinel.txt"), "utf8"),
        ).toBe("intacta");
        expect(await fs.readdir(parent)).toEqual([]);
      } finally {
        await fs.unlink(created);
      }
    },
  );
  it("recusa parent dentro da fonte e caminhos que não são diretórios locais absolutos", async () => {
    const downloaded = await fixture();
    for (const candidate of [
      common,
      path.join(common, "empty"),
      "relative",
      "\\\\server\\share",
      "\\\\?\\C:\\fixture",
    ]) {
      await expect(
        prepareIdentityBuild({
          downloaded,
          commonPublicDir: common,
          temporaryParent: candidate,
          code,
        }),
      ).rejects.toThrow("IDENTITY_BUILD_INVALID");
    }
    await expect(
      prepareIdentityBuild({
        downloaded,
        commonPublicDir: path.join(common, "robots.txt"),
        temporaryParent: parent,
        code,
      }),
    ).rejects.toThrow("IDENTITY_BUILD_INVALID");
    expect(await fs.readdir(parent)).toEqual([]);
  });
  it("limpa somente sua staging após falha tardia de gravação", async () => {
    const downloaded = await fixture();
    const sentinel = path.join(parent, "user-directory");
    await fs.mkdir(sentinel);
    const write = fs.writeFile.bind(fs);
    vi.spyOn(fs, "writeFile").mockImplementation(async (...args) => {
      if (String(args[0]).endsWith("og.png"))
        throw new Error("fixture failure");
      return write(...args);
    });
    await expect(
      prepareIdentityBuild({
        downloaded,
        commonPublicDir: common,
        temporaryParent: parent,
        code,
      }),
    ).rejects.toThrow("IDENTITY_BUILD_INVALID");
    expect(await fs.readdir(parent)).toEqual(["user-directory"]);
    expect(await fs.readFile(path.join(common, "logo.svg"), "utf8")).toBe(
      "marca antiga",
    );
  });
  it("dispose recusa link introduzido e permite repetir depois de removê-lo", async () => {
    const prepared = await prepareIdentityBuild({
      downloaded: await fixture(),
      commonPublicDir: common,
      temporaryParent: parent,
      code,
    });
    const external = path.join(root, "external");
    await fs.mkdir(external);
    await fs.writeFile(path.join(external, "sentinel"), "intacta");
    const linked = path.join(prepared.publicDir, "linked");
    await fs.symlink(external, linked, "junction");
    try {
      await expect(prepared.dispose()).rejects.toMatchObject({
        code: "IDENTITY_BUILD_CLEANUP",
        stagingDir: path.dirname(prepared.publicDir),
      });
      expect(await fs.readFile(path.join(external, "sentinel"), "utf8")).toBe(
        "intacta",
      );
      expect(
        await fs.readFile(path.join(prepared.publicDir, "robots.txt"), "utf8"),
      ).toBe("robots comuns");
    } finally {
      await fs.unlink(linked);
    }
    await Promise.all([prepared.dispose(), prepared.dispose()]);
    await prepared.dispose();
    expect(await fs.readdir(parent)).toEqual([]);
  });
  it("conserva staging identificável se uma falha tardia encontra link na limpeza", async () => {
    const downloaded = await fixture();
    const external = path.join(root, "external");
    await fs.mkdir(external);
    await fs.writeFile(path.join(external, "sentinel"), "intacta");
    const write = fs.writeFile.bind(fs);
    let introduced = "";
    vi.spyOn(fs, "writeFile").mockImplementation(async (...args) => {
      if (String(args[0]).endsWith("og.png")) {
        const stage = (await fs.readdir(parent))[0];
        introduced = path.join(parent, stage, "public", "linked");
        await fs.symlink(external, introduced, "junction");
        throw new Error("sensitive native detail must not escape");
      }
      return write(...args);
    });
    try {
      await expect(
        prepareIdentityBuild({
          downloaded,
          commonPublicDir: common,
          temporaryParent: parent,
          code,
        }),
      ).rejects.toMatchObject({
        code: "IDENTITY_BUILD_CLEANUP",
        stagingDir: expect.stringContaining("ikcous-identity-"),
      });
      expect(await fs.readFile(path.join(external, "sentinel"), "utf8")).toBe(
        "intacta",
      );
      expect(await fs.readdir(parent)).toHaveLength(1);
    } finally {
      if (introduced) await fs.unlink(introduced);
    }
  });
  it("não remove substituição da raiz de staging nem seu conteúdo", async () => {
    const prepared = await prepareIdentityBuild({
      downloaded: await fixture(),
      commonPublicDir: common,
      temporaryParent: parent,
      code,
    });
    const staging = path.dirname(prepared.publicDir);
    const saved = path.join(parent, "saved");
    await fs.rename(staging, saved);
    await fs.mkdir(staging);
    await fs.writeFile(path.join(staging, "sentinel"), "intacta");
    await expect(prepared.dispose()).rejects.toMatchObject({
      code: "IDENTITY_BUILD_CLEANUP",
      stagingDir: staging,
    });
    expect(await fs.readFile(path.join(staging, "sentinel"), "utf8")).toBe(
      "intacta",
    );
    await fs.unlink(path.join(staging, "sentinel"));
    await fs.rmdir(staging);
    await fs.rename(saved, staging);
    await prepared.dispose();
  });
  it("verifica os bytes depois da gravação", async () => {
    const downloaded = await fixture();
    const write = fs.writeFile.bind(fs);
    vi.spyOn(fs, "writeFile").mockImplementation(async (...args) => {
      if (String(args[0]).endsWith("og.png"))
        return write(args[0], "corrupted after write", args[2]);
      return write(...args);
    });
    await expect(
      prepareIdentityBuild({
        downloaded,
        commonPublicDir: common,
        temporaryParent: parent,
        code,
      }),
    ).rejects.toThrow("IDENTITY_BUILD_INVALID");
    expect(await fs.readdir(parent)).toEqual([]);
  });
  it("identifica staging preservada se não consegue estabelecer sua identidade no disco", async () => {
    const downloaded = await fixture();
    const lstat = fs.lstat.bind(fs);
    vi.spyOn(fs, "lstat").mockImplementation((...args) => {
      if (path.basename(String(args[0])).startsWith("ikcous-identity-"))
        return Promise.reject(new Error("fixture failure"));
      return lstat(...args);
    });
    await expect(
      prepareIdentityBuild({
        downloaded,
        commonPublicDir: common,
        temporaryParent: parent,
        code,
      }),
    ).rejects.toMatchObject({
      code: "IDENTITY_BUILD_CLEANUP",
      stagingDir: expect.stringContaining("ikcous-identity-"),
    });
    expect(await fs.readdir(parent)).toHaveLength(1);
  });
  it("recusa ancestral escondido por segmento .. e diretório com nome de marca antiga", async () => {
    const downloaded = await fixture();
    await expect(
      prepareIdentityBuild({
        downloaded,
        commonPublicDir: `${common}${path.sep}..${path.sep}common`,
        temporaryParent: parent,
        code,
      }),
    ).rejects.toThrow("IDENTITY_BUILD_INVALID");
    await fs.unlink(path.join(common, "logo.svg"));
    await fs.mkdir(path.join(common, "logo.svg"));
    await expect(
      prepareIdentityBuild({
        downloaded,
        commonPublicDir: common,
        temporaryParent: parent,
        code,
      }),
    ).rejects.toThrow("IDENTITY_BUILD_INVALID");
    expect(await fs.readdir(parent)).toEqual([]);
  });
  it("recusa raster acima de 8192 mesmo sem dimensões declaradas", async () => {
    const downloaded = await fixture();
    const asset = downloaded.identity.assets.loader;
    const file = downloaded.files.find((item) => item.path === asset.path)!;
    const bytes = await sharp({
      create: { width: 8193, height: 1, channels: 3, background: "red" },
    })
      .webp()
      .toBuffer();
    file.bytes = bytes;
    file.sha256 = hash(bytes);
    file.path = `v1/${file.sha256}/loader.webp`;
    asset.path = file.path;
    asset.sha256 = file.sha256;
    asset.bytes = bytes.length;
    downloaded.identity.assets.loader = {
      path: asset.path,
      sha256: asset.sha256,
      bytes: asset.bytes,
      media_type: asset.media_type,
    };
    downloaded.identity.urls.loader = `https://${downloaded.identity.projectRef}.supabase.co/storage/v1/object/public/branding/${file.path}`;
    downloaded.revision = await identityRevision(downloaded.identity);
    await expect(
      prepareIdentityBuild({
        downloaded,
        commonPublicDir: common,
        temporaryParent: parent,
        code,
      }),
    ).rejects.toThrow("IDENTITY_BUILD_INVALID");
    expect(await fs.readdir(parent)).toEqual([]);
  });
  it("usa a pasta temporária padrão e remove somente a preparação devolvida", async () => {
    const prepared = await prepareIdentityBuild({
      downloaded: await fixture(),
      commonPublicDir: common,
      code,
    });
    expect(path.dirname(path.dirname(prepared.publicDir))).toBe(
      await fs.realpath(os.tmpdir()),
    );
    await prepared.dispose();
    expect(await fs.readFile(path.join(common, "robots.txt"), "utf8")).toBe(
      "robots comuns",
    );
  });
  it("não envia SVG disfarçado de raster ao autodetector sharp", async () => {
    const downloaded = await fixture();
    const asset = downloaded.identity.assets.og;
    const file = downloaded.files.find((item) => item.path === asset.path)!;
    const bytes = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"/>',
    );
    file.bytes = bytes;
    file.sha256 = hash(bytes);
    file.path = `v1/${file.sha256}/og.png`;
    asset.path = file.path;
    asset.sha256 = file.sha256;
    asset.bytes = bytes.length;
    downloaded.identity.urls.og = `https://${downloaded.identity.projectRef}.supabase.co/storage/v1/object/public/branding/${file.path}`;
    downloaded.revision = await identityRevision(downloaded.identity);
    const decode = vi.mocked(sharp);
    decode.mockClear();
    await expect(
      prepareIdentityBuild({
        downloaded,
        commonPublicDir: common,
        temporaryParent: parent,
        code,
      }),
    ).rejects.toThrow("IDENTITY_BUILD_INVALID");
    expect(
      decode.mock.calls.some(
        ([input]) =>
          input instanceof Uint8Array &&
          Buffer.from(input).equals(Buffer.from(bytes)),
      ),
    ).toBe(false);
  });
  it("recusa formato animado com mais de uma página", async () => {
    const downloaded = await fixture();
    const asset = downloaded.identity.assets.loader;
    const file = downloaded.files.find((item) => item.path === asset.path)!;
    const pixels = Buffer.alloc(40 * 40 * 3, 255);
    pixels.fill(0, 40 * 20 * 3);
    const bytes = await sharp(pixels, {
      raw: { width: 40, height: 40, pageHeight: 20, channels: 3 },
    })
      .webp({ loop: 0, delay: [100, 100] })
      .toBuffer();
    expect((await sharp(bytes).metadata()).pages).toBe(2);
    file.bytes = bytes;
    file.sha256 = hash(bytes);
    file.path = `v1/${file.sha256}/loader.webp`;
    asset.path = file.path;
    asset.sha256 = file.sha256;
    asset.bytes = bytes.length;
    downloaded.identity.urls.loader = `https://${downloaded.identity.projectRef}.supabase.co/storage/v1/object/public/branding/${file.path}`;
    downloaded.revision = await identityRevision(downloaded.identity);
    await expect(
      prepareIdentityBuild({
        downloaded,
        commonPublicDir: common,
        temporaryParent: parent,
        code,
      }),
    ).rejects.toThrow("IDENTITY_BUILD_INVALID");
  });
  it("preserva originais, derivados e recursos comuns sem marca antiga ou alteração da fonte", async () => {
    const downloaded = await fixture();
    const before = await entries(common);
    const prepared = await prepareIdentityBuild({
      downloaded,
      commonPublicDir: common,
      temporaryParent: parent,
      code,
    });
    expect(
      await fs.readFile(path.join(prepared.publicDir, "robots.txt"), "utf8"),
    ).toBe("robots comuns");
    expect(
      await fs.readFile(path.join(prepared.publicDir, "fonts/font.woff2")),
    ).toEqual(Buffer.from([0, 1, 2, 255]));
    expect(
      (await fs.stat(path.join(prepared.publicDir, "empty"))).isDirectory(),
    ).toBe(true);
    for (const filename of retired)
      if (filename !== "og-image.png")
        await expect(
          fs.stat(path.join(prepared.publicDir, filename)),
        ).rejects.toMatchObject({ code: "ENOENT" });
    // og-image.png volta a existir, mas com o caminho FIXO: o middleware da
    // Vercel e o worker do Cloudflare Pages usam esse nome como fallback
    // quando o produto não tem foto, e agora ele é a imagem da PRÓPRIA loja
    // (identity.assets.og), nunca a marca antiga genérica da origem comum.
    const ogAsset = downloaded.identity.assets.og;
    const ogFile = downloaded.files.find((file) => file.path === ogAsset.path)!;
    const ogFixo = await fs.readFile(
      path.join(prepared.publicDir, "og-image.png"),
    );
    expect(ogFixo).toEqual(Buffer.from(ogFile.bytes));
    expect(ogFixo.toString("utf8")).not.toBe("marca antiga");
    for (const file of downloaded.files) {
      const written = await fs.readFile(
        path.join(prepared.publicDir, "store-identity", file.path),
      );
      expect(written).toEqual(Buffer.from(file.bytes));
      expect(hash(written)).toBe(file.sha256);
    }
    expect(await entries(common)).toEqual(before);
    for (const filename of retired)
      expect(await fs.readFile(path.join(common, filename), "utf8")).toBe(
        "marca antiga",
      );
    expect(prepared.identity).toEqual(downloaded.identity);
    expect(prepared.identityRevision).toBe(downloaded.revision);
    expect(prepared.deliveryVersion).toBe(
      `1.26.0-sha.aaaaaaa-identity.${downloaded.revision}`,
    );
    expect(prepared.localUrls.header).toBe(
      `/store-identity/${downloaded.identity.assets.header.path}`,
    );
    expect(prepared.localUrls.originals).toEqual(
      downloaded.identity.assets.originals.map(
        (asset) => `/store-identity/${asset.path}`,
      ),
    );
    expect(prepared.codeSha).toBe(code.sha);
    expect(prepared.codeVersion).toBe(code.version);
    expect(Object.isFrozen(prepared)).toBe(true);
    expect(Object.isFrozen(prepared.identity.theme)).toBe(true);
    expect(Object.isFrozen(prepared.localUrls.originals)).toBe(true);
    await prepared.dispose();
    await prepared.dispose();
    expect(await fs.readdir(parent)).toEqual([]);
  });
});
