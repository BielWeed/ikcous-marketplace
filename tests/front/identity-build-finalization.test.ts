/* eslint-disable security/detect-non-literal-fs-filename -- Only paths created by mkdtemp fixtures are read, written or removed. */
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { build } from "vite";
import type { InlineConfig, Plugin, UserConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import type { VitePWAOptions } from "vite-plugin-pwa";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error Node entry is plain JavaScript; no TypeScript runner or declaration dependency.
import { buildStore } from "../../scripts/buildStore.mjs";
import { createIdentityBuildConfig } from "../../scripts/identityBuildConfig";
import { createIdentityBuildFixture } from "../../scripts/identityBuildFixture";

vi.mock("../../scripts/identityBuildFixture", { spy: true });
const roots: string[] = [];
const project = path.resolve(import.meta.dirname, "../..");
beforeEach(() => {
  for (const key of Object.keys(process.env))
    if (/^(IKCOUS_|VITE_|SUPABASE_|DATABASE_URL|VERCEL|CF_PAGES)/.test(key))
      vi.stubEnv(key, undefined);
  vi.stubEnv("IKCOUS_IDENTITY_MODE", "fixture");
  vi.stubEnv("IKCOUS_CODE_SHA", "a".repeat(40));
  vi.stubGlobal("fetch", () => {
    throw new Error("network forbidden");
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  for (const root of roots.splice(0))
    await fs.rm(root, { recursive: true, force: true });
});

async function setup(extra: Plugin[] = [], pwa = false) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "identity-finalization-"),
  );
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
    path.join(root, "index.html"),
    '<html><head><title>fixture</title></head><body><script type="module" src="/entry.js"></script></body></html>',
  );
  await fs.writeFile(
    path.join(root, "entry.js"),
    "globalThis.version = __APP_VERSION__;",
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
      globPatterns: ["**/*.{js,html}"],
      globIgnores: ["store-identity/**"],
    },
  };
  const identity = createIdentityBuildConfig({
    root,
    env: { IKCOUS_IDENTITY_MODE: "fixture", IKCOUS_CODE_SHA: "a".repeat(40) },
    context: { command: "build", mode: "production" },
    pwaOptions,
    resolvePublicAddress: () => {
      throw new Error("real URL forbidden");
    },
  });
  const options: InlineConfig = {
    root,
    configFile: false,
    envFile: false,
    logLevel: "silent",
    build: { outDir: "dist-test", emptyOutDir: false },
    plugins: [identity.plugin, ...extra, ...(pwa ? VitePWA(pwaOptions) : [])],
  };
  const marker = path.join(root, "dist-test/version.json");
  return {
    root,
    marker,
    options,
    run: (overrides: UserConfig = {}) =>
      buildStore({ ...options, ...overrides }),
  };
}
async function absent(marker: string) {
  await expect(fs.lstat(marker)).rejects.toMatchObject({ code: "ENOENT" });
}

describe("confirmação somente após Vite resolver por inteiro", () => {
  it.each(["writeBundle", "closeBundle"] as const)(
    "erro tardio %s com PWA não deixa marcador",
    async (hook) => {
      const fixture = await setup(
        [
          {
            name: "late-failure",
            [hook]: {
              order: "post",
              sequential: true,
              handler() {
                throw new Error("controlled late failure");
              },
            },
          },
        ],
        true,
      );
      await expect(fixture.run()).rejects.toThrow("controlled late failure");
      await absent(fixture.marker);
    },
    60000,
  );

  it("sucesso confirma metadados, prepara uma vez e preserva outra saída", async () => {
    const fixture = await setup([], true);
    await fs.mkdir(path.join(fixture.root, "dist"));
    await fs.writeFile(
      path.join(fixture.root, "dist/version.json"),
      "outra entrega",
    );
    const calls = vi.mocked(createIdentityBuildFixture).mock.calls.length;
    const result = await fixture.run();
    const marker = JSON.parse(await fs.readFile(fixture.marker, "utf8"));
    expect(result).toEqual(marker);
    expect(marker).toMatchObject({
      source: "fixture",
      promotable: false,
      codeVersion: "1.26.0",
      codeSha: "a".repeat(40),
    });
    expect(marker.identityRevision).toMatch(/^[a-f0-9]{64}$/);
    expect(marker.version).toBe(
      `1.26.0-sha.aaaaaaa-identity.${marker.identityRevision}`,
    );
    expect(
      vi.mocked(createIdentityBuildFixture).mock.calls.length - calls,
    ).toBe(1);
    expect(
      await fs.readFile(path.join(fixture.root, "dist/version.json"), "utf8"),
    ).toBe("outra entrega");
    expect(
      await fs.readFile(path.join(fixture.root, "dist-test/sw.js"), "utf8"),
    ).toContain("store-identity/");
  }, 60000);

  it("invalida só marcador anterior antes de erro precoce", async () => {
    const fixture = await setup([
      {
        name: "early-failure",
        config() {
          throw new Error("early failure");
        },
      },
    ]);
    await fs.mkdir(path.dirname(fixture.marker));
    await fs.writeFile(fixture.marker, "marcador antigo");
    await fs.writeFile(
      path.join(path.dirname(fixture.marker), "sentinel"),
      "intacta",
    );
    await expect(fixture.run()).rejects.toThrow("early failure");
    await absent(fixture.marker);
    expect(
      await fs.readFile(
        path.join(path.dirname(fixture.marker), "sentinel"),
        "utf8",
      ),
    ).toBe("intacta");
  });

  it.each([
    { write: false },
    { watch: {} },
    { outDir: "elsewhere" },
    { rollupOptions: { output: { dir: "elsewhere" } } },
  ])("recusa override de saída antes de preparar: %j", async (buildOptions) => {
    const fixture = await setup();
    const calls = vi.mocked(createIdentityBuildFixture).mock.calls.length;
    await expect(fixture.run({ build: buildOptions })).rejects.toThrow(
      /IDENTITY_/,
    );
    expect(vi.mocked(createIdentityBuildFixture).mock.calls.length).toBe(calls);
    await absent(fixture.marker);
  });

  it("Vite direto em saída nova não confirma entrega", async () => {
    const fixture = await setup();
    await build(fixture.options);
    await absent(fixture.marker);
  });

  it.each(["__STORE_IDENTITY__", "__APP_VERSION__"])(
    "define inválido %s não confirma entrega",
    async (key) => {
      const fixture = await setup([
        {
          name: "invalid-snapshot",
          enforce: "post",
          config(config) {
            config.define = { ...config.define, [key]: '"invalid"' };
          },
        },
      ]);
      await expect(fixture.run()).rejects.toThrow(/IDENTITY_/);
      await absent(fixture.marker);
    },
  );

  it("sem fotografia não confirma entrega", async () => {
    const fixture = await setup();
    await expect(fixture.run({ plugins: [] })).rejects.toThrow(/IDENTITY_/);
    await absent(fixture.marker);
  });

  it("captura duplicada reprova sem marcador", async () => {
    const fixture = await setup([
      {
        name: "duplicate-capture",
        configResolved(config) {
          const observer = config.plugins.find(
            (plugin) => plugin.name === "store-build-finalization-observer",
          )!;
          const hook = observer.configResolved!;
          if (typeof hook === "function") hook.call(this, config);
          else hook.handler.call(this, config);
        },
      },
    ]);
    await expect(fixture.run()).rejects.toThrow(/IDENTITY_SNAPSHOT_DUPLICATE/);
    await absent(fixture.marker);
  });

  it("Vite sem chamar observador não pode devolver confirmação", async () => {
    const fixture = await setup();
    vi.doMock("vite", async () => ({
      ...(await vi.importActual("vite")),
      build: async () => ({
        output: [{ type: "asset", fileName: "index.html" }],
      }),
    }));
    try {
      await expect(fixture.run()).rejects.toThrow(/IDENTITY_SNAPSHOT_MISSING/);
      await absent(fixture.marker);
    } finally {
      vi.doUnmock("vite");
    }
  });

  it("fotografia alterada depois da captura não pode confirmar", async () => {
    let config: import("vite").ResolvedConfig;
    const fixture = await setup([
      {
        name: "mutate-after-capture",
        configResolved(value) {
          config = value;
        },
        closeBundle() {
          config.define!.__APP_VERSION__ = '"changed"';
        },
      },
    ]);
    await expect(fixture.run()).rejects.toThrow(/IDENTITY_SNAPSHOT_CHANGED/);
    await absent(fixture.marker);
  });

  it.each([
    "source",
    "codeSha",
    "identityRevision",
    "codeVersion",
    "schemaVersion",
  ])("metadado %s incoerente não confirma", async (key) => {
    const fixture = await setup([
      {
        name: "invalid-metadata",
        enforce: "post",
        config(config) {
          const value = JSON.parse(config.define!.__STORE_IDENTITY__ as string);
          Reflect.set(value, key, "invalid");
          config.define!.__STORE_IDENTITY__ = JSON.stringify(value);
        },
      },
    ]);
    await expect(fixture.run()).rejects.toThrow(/IDENTITY_SNAPSHOT/);
    await absent(fixture.marker);
  });

  it("marcador anterior que é diretório ou link não é removido", async () => {
    const fixture = await setup();
    await fs.mkdir(fixture.marker, { recursive: true });
    await fs.writeFile(path.join(fixture.marker, "sentinel"), "intacta");
    await expect(fixture.run()).rejects.toThrow(/IDENTITY_OUTPUT/);
    expect(
      await fs.readFile(path.join(fixture.marker, "sentinel"), "utf8"),
    ).toBe("intacta");
    const second = await setup();
    await fs.mkdir(path.dirname(second.marker));
    const sentinel = path.join(second.root, "sentinel");
    await fs.writeFile(sentinel, "intacta");
    await fs.symlink(sentinel, second.marker, "file");
    try {
      await expect(second.run()).rejects.toThrow(/IDENTITY_OUTPUT/);
    } finally {
      await fs.unlink(second.marker);
    }
    expect(await fs.readFile(sentinel, "utf8")).toBe("intacta");
  });

  it("importação é inerte e opção desconhecida não desliga guardas", async () => {
    const fixture = await setup();
    const before = { ...process.env };
    const writes = vi.spyOn(fs, "writeFile");
    const staging = vi.spyOn(fs, "mkdtemp");
    vi.resetModules();
    // @ts-expect-error Import the plain Node entry as above, without adding a TS runner.
    const imported = await import("../../scripts/buildStore.mjs");
    expect(writes).not.toHaveBeenCalled();
    expect(staging).not.toHaveBeenCalled();
    expect(process.env).toEqual(before);
    await expect(
      imported.buildStore({ ...fixture.options, snapshot: {} } as never),
    ).rejects.toThrow(/IDENTITY_OPTIONS/);
    await absent(fixture.marker);
  });

  it("CLI lê modo do env fictício e remove marcador antes de config falhar", async () => {
    const fixture = await setup();
    await fs.mkdir(path.dirname(fixture.marker));
    await fs.writeFile(fixture.marker, "antigo");
    await fs.mkdir(path.join(fixture.root, "dist"));
    await fs.writeFile(path.join(fixture.root, "dist/version.json"), "outra");
    await fs.writeFile(
      path.join(fixture.root, ".env"),
      "IKCOUS_IDENTITY_MODE=fixture\n",
    );
    await fs.writeFile(
      path.join(fixture.root, "vite.config.js"),
      'throw new Error("controlled config failure");',
    );
    const env = { ...process.env, IKCOUS_IDENTITY_MODE: undefined };
    const result = spawnSync(
      process.execPath,
      [path.join(project, "scripts/buildStore.mjs")],
      { cwd: fixture.root, env, encoding: "utf8", timeout: 15000 },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("IDENTITY_BUILD_FAILED");
    await absent(fixture.marker);
    expect(
      await fs.readFile(path.join(fixture.root, "dist/version.json"), "utf8"),
    ).toBe("outra");
  });

  it("CLI recusa argumento desconhecido sem imprimir seu conteúdo", async () => {
    const fixture = await setup();
    const result = spawnSync(
      process.execPath,
      [path.join(project, "scripts/buildStore.mjs"), "--segredo-ficticio"],
      { cwd: fixture.root, env: process.env, encoding: "utf8", timeout: 15000 },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("IDENTITY_BUILD_FAILED");
    expect(result.stderr).not.toContain("segredo-ficticio");
    await absent(fixture.marker);
  });

  it("falha ao invalidar anterior impede preparo e não remove sentinela", async () => {
    const fixture = await setup();
    await fs.mkdir(path.dirname(fixture.marker));
    await fs.writeFile(fixture.marker, "antigo");
    const unlink = fs.unlink.bind(fs);
    vi.spyOn(fs, "unlink").mockImplementation(async (target) => {
      if (target === fixture.marker) throw new Error("remove refused");
      return unlink(target);
    });
    const calls = vi.mocked(createIdentityBuildFixture).mock.calls.length;
    await expect(fixture.run()).rejects.toThrow();
    expect(vi.mocked(createIdentityBuildFixture).mock.calls.length).toBe(calls);
    expect(await fs.readFile(fixture.marker, "utf8")).toBe("antigo");
  });

  it.each(["writeFile", "rename"] as const)(
    "falha final %s não vira sucesso",
    async (operation) => {
      const fixture = await setup();
      if (operation === "writeFile") {
        const write = fs.writeFile.bind(fs);
        vi.spyOn(fs, "writeFile").mockImplementation(async (...args) => {
          if (String(args[0]).includes("version.json."))
            throw new Error("final write refused");
          return write(...args);
        });
      } else {
        const rename = fs.rename.bind(fs);
        vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
          if (to === fixture.marker) throw new Error("final rename refused");
          return rename(from, to);
        });
      }
      await expect(fixture.run()).rejects.toThrow();
      await absent(fixture.marker);
    },
  );

  it("recusa links na saída e no ancestral sem tocar destino", async () => {
    const fixture = await setup();
    const target = path.join(fixture.root, "untouched");
    await fs.mkdir(target);
    await fs.writeFile(path.join(target, "version.json"), "intacta");
    const link = path.join(fixture.root, "dist-test");
    await fs.symlink(target, link, "junction");
    try {
      await expect(fixture.run()).rejects.toThrow(/IDENTITY_/);
    } finally {
      await fs.unlink(link);
    }
    expect(await fs.readFile(path.join(target, "version.json"), "utf8")).toBe(
      "intacta",
    );
    const alias = path.join(fixture.root, "alias");
    await fs.symlink(fixture.root, alias, "junction");
    try {
      await expect(fixture.run({ root: alias })).rejects.toThrow(/IDENTITY_/);
    } finally {
      await fs.unlink(alias);
    }
  });
});
