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
import type {
  DatabaseConnection,
  PreparedStoreDelivery,
} from "../../src/config/storeDeliveryContract";

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

async function setup(
  extra: Plugin[] = [],
  pwa = false,
  // O que varia entre fixture (padrão) e database (Task 3b): o `env` que vai
  // para o plugin, o resolvedor de endereço público e a saída esperada. O
  // corpo inteiro do fixture continua único; só os três campos abaixo mudam.
  variant: {
    env?: Record<string, string | undefined>;
    resolvePublicAddress?: () => string;
    outDir?: string;
  } = {},
) {
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
  const outDir = variant.outDir ?? "dist-test";
  const identity = createIdentityBuildConfig({
    root,
    env: {
      IKCOUS_IDENTITY_MODE: "fixture",
      IKCOUS_CODE_SHA: "a".repeat(40),
      ...variant.env,
    },
    context: { command: "build", mode: "production" },
    pwaOptions,
    resolvePublicAddress:
      variant.resolvePublicAddress ??
      (() => {
        throw new Error("real URL forbidden");
      }),
  });
  const options: InlineConfig = {
    root,
    configFile: false,
    envFile: false,
    logLevel: "silent",
    build: { outDir, emptyOutDir: false },
    plugins: [identity.plugin, ...extra, ...(pwa ? VitePWA(pwaOptions) : [])],
  };
  const marker = path.join(root, outDir, "version.json");
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

describe("entrega preparada chega ao observador e é conferida", () => {
  const syntheticPlugin: Plugin = {
    name: "a6c-like",
    config: () => ({
      define: {
        "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(
          "https://abcdefghijklmnopqrst.supabase.co",
        ),
        "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(
          "a6c-public-artificial-key-no-account",
        ),
      },
    }),
  };

  it("fixture-none confirma marcador e mantém os seis campos de version.json", async () => {
    const fixture = await setup([], true);
    const marker = await fixture.run();
    expect(Object.keys(marker).sort()).toEqual([
      "codeSha",
      "codeVersion",
      "identityRevision",
      "promotable",
      "source",
      "version",
    ]);
    expect(marker.promotable).toBe(false);
    expect(JSON.parse(await fs.readFile(fixture.marker, "utf8"))).toEqual(
      marker,
    );
  });

  it("fixture-synthetic (par A6) confirma e não vira database", async () => {
    let seen: { connection: { kind: string } } | undefined;
    const peek: Plugin = {
      name: "peek",
      enforce: "post",
      configResolved(config) {
        seen = config.plugins
          .find((p) => p.api?.name === "ikcous-store-delivery")!
          .api.get();
      },
    };
    const fixture = await setup([syntheticPlugin, peek], true);
    const marker = await fixture.run();
    expect(seen?.connection.kind).toBe("fixture-synthetic");
    expect(marker.promotable).toBe(false);
    expect(marker.source).toBe("fixture");
  });

  // Task 3b (lacuna da revisão Opus da T3): todo teste de buildStore acima
  // roda em modo fixture, então o ramo `database` de `delivery()` em
  // buildStore.mjs nunca é exercitado por um build real — apagar o `if`
  // inteiro daquele ramo (8 condições) deixava a suíte inteira verde (M5).
  // Transporte fictício no molde de databaseTransport() em
  // identity-build-config-delivery.test.ts:44-74.
  const databaseOrigin = "https://abcdefghijklmnopqrst.supabase.co";
  const databasePublishable = "sb_publishable_fixture_only";
  const databaseAnon = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(
    JSON.stringify({ role: "anon" }),
  ).toString("base64url")}.fixture`;

  async function databaseTransport() {
    const fixture = await createIdentityBuildFixture("oceano");
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === "/rest/v1/v_store_config") {
        const { identity } = fixture;
        return new Response(
          JSON.stringify([
            {
              store_name: identity.storeName,
              store_city: identity.city,
              store_state: identity.state,
              logo_url: identity.urls.header,
              primary_color: identity.theme.primary,
              secondary_color: identity.theme.secondary,
              accent_color: identity.theme.accent,
              branding_assets: identity.assets,
            },
          ]),
          { headers: { "content-type": "application/json" } },
        );
      }
      const file = fixture.files.find((item) =>
        url.pathname.endsWith(item.path),
      );
      if (!file) throw new Error("unexpected request");
      return new Response(Buffer.from(file.bytes), {
        headers: { "content-type": file.mediaType },
      });
    });
    return fixture;
  }

  it.each([
    {
      label: "publishable",
      publishable: databasePublishable,
      anon: databaseAnon,
      url: databaseOrigin,
      keyClass: "publishable" as const,
      expectedKey: databasePublishable,
      expectedUrl: databaseOrigin,
    },
    {
      label: "anon-jwt (publishable só com espaços)",
      publishable: "   ",
      anon: databaseAnon,
      url: databaseOrigin,
      keyClass: "anon-jwt" as const,
      expectedKey: databaseAnon,
      expectedUrl: databaseOrigin,
    },
    {
      label: "url com barra final",
      publishable: databasePublishable,
      anon: databaseAnon,
      url: `${databaseOrigin}/`,
      keyClass: "publishable" as const,
      expectedKey: databasePublishable,
      expectedUrl: `${databaseOrigin}/`,
    },
  ])(
    "database ($label): build real confirma sem vazar segredo",
    async (item) => {
      // beforeEach fixa IKCOUS_IDENTITY_MODE="fixture" e um fetch que lança;
      // os dois precisam ser substituídos aqui, dentro do próprio it.
      vi.stubEnv("IKCOUS_IDENTITY_MODE", undefined);
      await databaseTransport();
      let seen: PreparedStoreDelivery | undefined;
      const peek: Plugin = {
        name: "peek",
        enforce: "post",
        configResolved(config) {
          seen = config.plugins
            .find((p) => p.api?.name === "ikcous-store-delivery")!
            .api.get();
        },
      };
      const fixture = await setup([peek], true, {
        env: {
          IKCOUS_IDENTITY_MODE: undefined,
          VITE_APP_URL: "https://loja-exclusiva.invalid",
          VITE_SUPABASE_URL: item.url,
          VITE_SUPABASE_PUBLISHABLE_KEY: item.publishable,
          VITE_SUPABASE_ANON_KEY: item.anon,
        },
        resolvePublicAddress: () => "https://loja-exclusiva.invalid",
        outDir: "dist",
      });
      const marker = await fixture.run();
      expect(Object.keys(marker).sort()).toEqual([
        "codeSha",
        "codeVersion",
        "identityRevision",
        "promotable",
        "source",
        "version",
      ]);
      expect(marker.promotable).toBe(true);
      expect(marker.source).toBe("database");
      const text = await fs.readFile(fixture.marker, "utf8");
      expect(text).not.toContain(databasePublishable);
      expect(text).not.toContain("abcdefghijklmnopqrst");
      expect(JSON.parse(text)).toEqual(marker);
      expect(seen?.connection.kind).toBe("database");
      const connection = seen?.connection as DatabaseConnection;
      expect(connection.keyClass).toBe(item.keyClass);
      expect(connection.origin).toBe(databaseOrigin);
      expect(seen?.publicDefines).toEqual({
        url: item.expectedUrl,
        publishable: item.keyClass === "publishable" ? item.expectedKey : "",
        anon: item.keyClass === "anon-jwt" ? item.expectedKey : "",
      });
    },
  );

  // As duas abaixo são negativas de propósito: um teste de SUCESSO não pode
  // detectar a remoção de uma guarda que só existe para REJEITAR entrada
  // inválida — em caminho válido a guarda nunca dispara, removida ou não
  // (medido: a mutação M5 apagando o ramo `database` inteiro de delivery()
  // deixou os três `it.each` de sucesso acima 3/3 verdes). Por isso o
  // fornecedor aqui embrulha o plugin real e adultera só o que `api.get()`
  // devolve — `config.define` continua genuíno — para alcançar o ramo sem
  // tropeçar nas guardas do próprio plugin (IDENTITY_DELIVERY_CHANGED), que
  // comparam `config.define`, nunca `api.get()`.
  it.each([
    { label: "campo extra (7 chaves)", tamper: { extra: "unexpected" } },
    { label: "keySource fora da lista", tamper: { keySource: "OUTRA_FONTE" } },
  ])(
    "database: conexão adulterada ($label) não confirma (mata M5)",
    async ({ tamper }) => {
      vi.stubEnv("IKCOUS_IDENTITY_MODE", undefined);
      await databaseTransport();
      const fixture = await setup([], true, {
        env: {
          IKCOUS_IDENTITY_MODE: undefined,
          VITE_APP_URL: "https://loja-exclusiva.invalid",
          VITE_SUPABASE_URL: databaseOrigin,
          VITE_SUPABASE_PUBLISHABLE_KEY: databasePublishable,
        },
        resolvePublicAddress: () => "https://loja-exclusiva.invalid",
        outDir: "dist",
      });
      const identity = fixture.options.plugins![0] as Plugin;
      const tampered: Plugin = {
        ...identity,
        api: {
          ...identity.api,
          get() {
            const value = identity.api.get();
            return {
              ...value,
              connection: { ...value.connection, ...tamper },
            };
          },
        },
      };
      await expect(
        fixture.run({
          plugins: [tampered, ...fixture.options.plugins!.slice(1)],
        }),
      ).rejects.toThrow(/IDENTITY_DELIVERY_SHAPE/);
      await absent(fixture.marker);
    },
  );

  it("database: snapshot do envelope diferente de __STORE_IDENTITY__ não confirma (mata M3)", async () => {
    vi.stubEnv("IKCOUS_IDENTITY_MODE", undefined);
    await databaseTransport();
    const fixture = await setup([], true, {
      env: {
        IKCOUS_IDENTITY_MODE: undefined,
        VITE_APP_URL: "https://loja-exclusiva.invalid",
        VITE_SUPABASE_URL: databaseOrigin,
        VITE_SUPABASE_PUBLISHABLE_KEY: databasePublishable,
      },
      resolvePublicAddress: () => "https://loja-exclusiva.invalid",
      outDir: "dist",
    });
    const identity = fixture.options.plugins![0] as Plugin;
    const tampered: Plugin = {
      ...identity,
      api: {
        ...identity.api,
        get() {
          const value = identity.api.get();
          return {
            ...value,
            snapshot: { ...value.snapshot, codeSha: "b".repeat(40) },
          };
        },
      },
    };
    await expect(
      fixture.run({
        plugins: [tampered, ...fixture.options.plugins!.slice(1)],
      }),
    ).rejects.toThrow(/IDENTITY_DELIVERY_SHAPE/);
    await absent(fixture.marker);
  });

  it("fornecedor duplicado não confirma", async () => {
    const fixture = await setup([], true);
    const fake: Plugin = {
      name: "second-provider",
      api: { name: "ikcous-store-delivery", version: 1, get: () => ({}) },
    };
    await expect(
      fixture.run({ plugins: [...fixture.options.plugins!, fake] }),
    ).rejects.toThrow(/IDENTITY_DELIVERY_PROVIDER/);
    await absent(fixture.marker);
  });

  it("fornecedor sem api (define válido) chega a IDENTITY_DELIVERY_PROVIDER", async () => {
    // Remover o plugin inteiro cai em IDENTITY_SNAPSHOT, porque metadata()
    // roda antes de deliveryProvider() (achado A-4 da revisão Opus da T3).
    // Aqui o plugin real continua de pé — __STORE_IDENTITY__/__APP_VERSION__
    // seguem válidos — só a propriedade `api` externa é removida, então
    // deliveryProvider() conta zero fornecedores de verdade.
    const fixture = await setup([], true);
    const identity = fixture.options.plugins![0] as Plugin;
    const { api: _api, ...withoutApi } = identity;
    await expect(
      fixture.run({
        plugins: [withoutApi, ...fixture.options.plugins!.slice(1)],
      }),
    ).rejects.toThrow(/IDENTITY_DELIVERY_PROVIDER/);
    await absent(fixture.marker);
  });

  it("versão desconhecida do getter não confirma", async () => {
    const fixture = await setup([], true);
    const identity = fixture.options.plugins![0] as Plugin;
    const wrapped: Plugin = {
      ...identity,
      api: { ...identity.api, version: 2 },
    };
    await expect(
      fixture.run({ plugins: [wrapped, ...fixture.options.plugins!.slice(1)] }),
    ).rejects.toThrow(/IDENTITY_DELIVERY_VERSION/);
    await absent(fixture.marker);
  });

  it("define público alterado depois da captura não confirma", async () => {
    let config: import("vite").ResolvedConfig;
    const fixture = await setup(
      [
        {
          name: "mutate-public-define-after-capture",
          configResolved(value) {
            config = value;
          },
          closeBundle() {
            config.define!["import.meta.env.VITE_SUPABASE_URL"] =
              JSON.stringify("https://zzzzzzzzzzzzzzzzzzzz.supabase.co");
          },
        },
      ],
      true,
    );
    await expect(fixture.run()).rejects.toThrow(/IDENTITY_DELIVERY_CHANGED/);
    await absent(fixture.marker);
  });

  it("getter que devolve outro objeto depois não confirma", async () => {
    const fixture = await setup([], true);
    const identity = fixture.options.plugins![0] as Plugin;
    let calls = 0;
    const flaky: Plugin = {
      ...identity,
      api: {
        ...identity.api,
        get() {
          const value = identity.api.get();
          calls++;
          return calls === 1
            ? value
            : { ...value, publicDefines: { ...value.publicDefines, url: "x" } };
        },
      },
    };
    await expect(
      fixture.run({ plugins: [flaky, ...fixture.options.plugins!.slice(1)] }),
    ).rejects.toThrow(/IDENTITY_DELIVERY_CHANGED/);
    await absent(fixture.marker);
  });
});
