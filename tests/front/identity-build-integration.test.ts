/* eslint-disable security/detect-non-literal-fs-filename -- Isolated mkdtemp fixtures; all removal targets are retained from mkdtemp. */
import { createHash } from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
// @ts-expect-error The installed jsdom has no type package; no dependency is added for this test.
import { JSDOM } from "jsdom";
import { createServer } from "vite";
import type { ResolvedConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import type { VitePWAOptions } from "vite-plugin-pwa";
import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error Node entry is plain JavaScript; no TypeScript runner or declaration dependency.
import { buildStore } from "../../scripts/buildStore.mjs";
import {
  createIdentityBuildConfig,
  identityHtml,
} from "../../scripts/identityBuildConfig";
import { createIdentityBuildFixture } from "../../scripts/identityBuildFixture";
import type { BuildIdentitySnapshot } from "../../src/config/buildIdentityContract";

vi.mock("../../scripts/identityBuildFixture", { spy: true });
const roots: string[] = [];
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const project = path.resolve(import.meta.dirname, "../..");
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  for (const root of roots.splice(0))
    await fs.rm(root, { recursive: true, force: true });
});

async function setup(command: "build" | "serve" = "build") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "identity-vite-test-"));
  roots.push(root);
  await fs.mkdir(path.join(root, "public"));
  await fs.mkdir(path.join(root, "src/sw"), { recursive: true });
  await fs.writeFile(
    path.join(root, "package.json"),
    '{"version":"1.26.0","type":"module"}',
  );
  await fs.copyFile(
    path.join(project, "public/silent-guardian.js"),
    path.join(root, "public/silent-guardian.js"),
  );
  await fs.writeFile(
    path.join(root, "public/loading.css"),
    ":root {color:red}",
  );
  const template = (
    await fs.readFile(path.join(project, "index.html"), "utf8")
  ).replace("/src/main.tsx", "/entry.js");
  await fs.writeFile(path.join(root, "index.html"), template);
  await fs.writeFile(
    path.join(root, "entry.js"),
    "globalThis.snapshot = __STORE_IDENTITY__; globalThis.version = __APP_VERSION__;",
  );
  await fs.writeFile(
    path.join(root, "src/sw/sw.ts"),
    "self.precached = self.__WB_MANIFEST;",
  );
  const pwaOptions: Partial<VitePWAOptions> = {
    strategies: "injectManifest",
    srcDir: "src/sw",
    filename: "sw.ts",
    manifest: { name: "pending", icons: [] },
    injectManifest: {
      globPatterns: ["**/*.{js,css,html}"],
      globIgnores: ["store-identity/**"],
      maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
    },
  };
  const identity = createIdentityBuildConfig({
    root,
    env: { IKCOUS_IDENTITY_MODE: "fixture", IKCOUS_CODE_SHA: "a".repeat(40) },
    context: { command, mode: "production" },
    pwaOptions,
    resolvePublicAddress: () => {
      throw new Error("fixture cannot resolve real URL");
    },
  });
  let snapshot: BuildIdentitySnapshot;
  let staging = "";
  return {
    root,
    dev: () =>
      createServer({
        root,
        configFile: false,
        envFile: false,
        logLevel: "silent",
        build: { outDir: identity.outDir },
        server: { port: 0, host: "127.0.0.1" },
        plugins: [identity.plugin],
      }),
    run: async (fail = false) => {
      vi.stubEnv("IKCOUS_IDENTITY_MODE", "fixture");
      await buildStore({
        root,
        configFile: false,
        envFile: false,
        logLevel: "warn",
        build: {
          outDir: identity.outDir,
          ...(fail ? { rollupOptions: { input: "missing-entry.js" } } : {}),
        },
        plugins: [
          identity.plugin,
          {
            name: "capture-delivery",
            configResolved(config: ResolvedConfig) {
              snapshot = JSON.parse(config.define!.__STORE_IDENTITY__);
              staging = config.publicDir;
            },
          },
          VitePWA(pwaOptions),
        ],
      });
      return {
        snapshot: snapshot!,
        staging,
        output: path.join(root, identity.outDir),
      };
    },
  };
}

describe("artefato real de Vite/PWA", () => {
  it("entrega dois pacotes independentes, preserva bytes e precache por papel", async () => {
    const originalFixture = createIdentityBuildFixture;
    const one = await originalFixture("aurora");
    const two = await originalFixture("oceano");
    vi.mocked(createIdentityBuildFixture)
      .mockResolvedValueOnce(one)
      .mockResolvedValueOnce(two);
    vi.stubGlobal("fetch", () => {
      throw new Error("network forbidden");
    });
    const revisions: string[] = [];
    for (const downloaded of [one, two]) {
      const { root, run } = await setup();
      await fs.mkdir(path.join(root, "dist"));
      await fs.writeFile(
        path.join(root, "dist/sentinel"),
        "real output intact",
      );
      const { snapshot, staging, output } = await run();
      const version = JSON.parse(
        await fs.readFile(path.join(output, "version.json"), "utf8"),
      );
      const manifest = JSON.parse(
        await fs.readFile(path.join(output, "manifest.webmanifest"), "utf8"),
      );
      const html = await fs.readFile(path.join(output, "index.html"), "utf8");
      const sw = await fs.readFile(path.join(output, "sw.js"), "utf8");
      expect(version).toMatchObject({
        version: snapshot.deliveryVersion,
        identityRevision: snapshot.identityRevision,
        source: "fixture",
        promotable: false,
        codeSha: "a".repeat(40),
      });
      expect(path.basename(output)).toBe("dist-test");
      expect(manifest.name).toBe(snapshot.identity.storeName);
      expect(manifest.icons.map((icon: { src: string }) => icon.src)).toEqual([
        snapshot.localUrls.icon_192,
        snapshot.localUrls.icon_512,
        snapshot.localUrls.maskable_512,
      ]);
      expect(
        hash(await fs.readFile(path.join(output, snapshot.localUrls.header))),
      ).toBe(downloaded.identity.assets.header.sha256);
      const document = new JSDOM(html).window.document;
      expect(document.title).toBe(snapshot.identity.storeName);
      expect(
        document.querySelector(".guardian-logo")?.getAttribute("src"),
      ).toBe(snapshot.localUrls.loader);
      expect(html).not.toContain("/branding/logo.png");
      expect(html).not.toContain("ickous-marketplace.vercel.app");
      const urls = [
        ...new Set(
          [
            "header",
            "loader",
            "favicon",
            "apple_touch",
            "icon_192",
            "icon_512",
            "maskable_512",
          ].map((role) => Reflect.get(snapshot.localUrls, role).slice(1)),
        ),
      ];
      for (const url of urls) expect(sw.split(url).length - 1).toBe(1);
      expect(sw).not.toContain(snapshot.localUrls.og.slice(1));
      expect(sw).not.toContain(snapshot.localUrls.originals[0].slice(1));
      expect(
        await fs.readFile(path.join(output, "silent-guardian.js"), "utf8"),
      ).toContain(JSON.stringify(snapshot.deliveryVersion));
      expect(
        await fs.readFile(path.join(output, "sitemap.xml"), "utf8"),
      ).toContain(`${snapshot.publicUrl}/`);
      expect(await fs.readFile(path.join(root, "dist/sentinel"), "utf8")).toBe(
        "real output intact",
      );
      await expect(fs.stat(staging)).rejects.toMatchObject({ code: "ENOENT" });
      revisions.push(snapshot.identityRevision);
    }
    expect(revisions[0]).not.toBe(revisions[1]);
  }, 60000);

  it("texto hostil permanece texto e conserva o script inline existente", async () => {
    const fixture = await createIdentityBuildFixture();
    const hostile = `</title><script>globalThis.injected=1</script> & " '`;
    const snapshot: BuildIdentitySnapshot = {
      schemaVersion: 1,
      source: "fixture",
      identity: {
        ...fixture.identity,
        storeName: hostile,
        city: null,
        state: null,
      },
      localUrls: fixture.identity.urls,
      publicUrl: "https://fixture.invalid",
      codeVersion: "1.26.0",
      codeSha: "a".repeat(40),
      identityRevision: fixture.revision,
      deliveryVersion: "fixture",
    };
    const template = await fs.readFile(
      path.join(project, "index.html"),
      "utf8",
    );
    const result = identityHtml(template, snapshot);
    const document = new JSDOM(result).window.document;
    expect(document.title).toBe(hostile);
    expect(
      document
        .querySelector('meta[name="description"]')
        ?.getAttribute("content"),
    ).toBe(`Produtos e novidades de ${hostile}`);
    expect(document.querySelectorAll("script")).toHaveLength(
      new JSDOM(template).window.document.querySelectorAll("script").length,
    );
    expect(
      document.querySelector('script[type="speculationrules"]')?.textContent,
    ).toBe(
      new JSDOM(template).window.document.querySelector(
        'script[type="speculationrules"]',
      )?.textContent,
    );
    expect(result).toContain("&lt;/title&gt;");
    expect(result).toContain("&#39;");
    expect(result).not.toContain("frete grátis");
  });

  it("falha de compilação não cria marcador de sucesso novo", async () => {
    const { root, run } = await setup();
    await expect(run(true)).rejects.toThrow();
    await expect(
      fs.stat(path.join(root, "dist-test/version.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  }, 60000);
  it("fixture recusa junction de dist-test para outra entrega", async () => {
    const { root, run } = await setup();
    const target = path.join(root, "dist");
    const link = path.join(root, "dist-test");
    await fs.mkdir(target);
    await fs.writeFile(path.join(target, "sentinel"), "intacta");
    await fs.symlink(target, link, "junction");
    try {
      await expect(run()).rejects.toThrow(/IDENTITY_OUTPUT/);
      expect(await fs.readFile(path.join(target, "sentinel"), "utf8")).toBe(
        "intacta",
      );
    } finally {
      await fs.unlink(link);
    }
  }, 60000);
  it("servidor fecha antes de descartar estágio e fechar de novo é seguro", async () => {
    const { dev } = await setup("serve");
    const server = await dev();
    const staging = server.config.publicDir;
    try {
      await server.listen();
      let existedOnClose = false;
      server.httpServer!.on("close", () => {
        existedOnClose = fsSync.existsSync(staging);
      });
      expect(await fs.stat(staging)).toBeTruthy();
      await server.close();
      expect(existedOnClose).toBe(true);
      await expect(fs.stat(staging)).rejects.toMatchObject({ code: "ENOENT" });
      await server.close();
    } finally {
      await server.close();
    }
  });
  it("falha de escrita da versão reprova build e não deixa marcador de sucesso", async () => {
    const { root, run } = await setup();
    const write = fs.writeFile.bind(fs);
    vi.spyOn(fs, "writeFile").mockImplementation(async (...args) => {
      if (/version\.json\.[a-f0-9-]+\.tmp$/.test(String(args[0])))
        throw new Error("version write refused");
      return write(...args);
    });
    await expect(run()).rejects.toThrow("version write refused");
    await expect(
      fs.stat(path.join(root, "dist-test/version.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  }, 60000);
  it("recurso essencial acima de 10 MiB falha legivelmente antes do estágio", async () => {
    const fixture = await createIdentityBuildFixture();
    const oversized = {
      ...fixture,
      identity: {
        ...fixture.identity,
        assets: {
          ...fixture.identity.assets,
          header: {
            ...fixture.identity.assets.header,
            bytes: 10 * 1024 * 1024 + 1,
          },
        },
      },
    };
    vi.mocked(createIdentityBuildFixture).mockResolvedValueOnce(oversized);
    const { run } = await setup();
    const staging = vi.spyOn(fs, "mkdtemp");
    await expect(run()).rejects.toThrow(
      /IDENTITY_PWA_SIZE: header excede 10 MiB/,
    );
    expect(staging).not.toHaveBeenCalled();
  });
});
