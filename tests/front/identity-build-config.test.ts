/* eslint-disable security/detect-non-literal-fs-filename -- Temporary fixtures and repository-owned public files only. */
import childProcess from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mergeConfig, resolveConfig } from "vite";
import type { ConfigEnv, UserConfig, UserConfigFnPromise } from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createIdentityBuildFixture } from "../../scripts/identityBuildFixture";

const root = path.resolve(import.meta.dirname, "../..");
const sha = "a".repeat(40);
const environment = [
  "IKCOUS_IDENTITY_MODE",
  "IKCOUS_IDENTITY_FIXTURE_FILE",
  "IKCOUS_CODE_SHA",
  "VERCEL_GIT_COMMIT_SHA",
  "VERCEL",
  "CF_PAGES",
  "VITE_APP_URL",
  "VERCEL_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_ANON_KEY",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
];
const disposals: Array<() => Promise<void>> = [];
const localRoots: string[] = [];
async function localSelector() {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "local-config-test-"),
  );
  localRoots.push(directory);
  const fixture = await createIdentityBuildFixture("oceano");
  for (const file of fixture.files) {
    const target = path.join(directory, "objetos", file.path.slice(3));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, file.bytes, { flag: "wx" });
  }
  const manifest = Buffer.from(
    JSON.stringify({
      scope: "local-preparation",
      promotable: false,
      uploaded: false,
      stores: { savy: fixture.identity.assets },
    }),
  );
  await fs.writeFile(path.join(directory, "manifesto.json"), manifest, {
    flag: "wx",
  });
  const selector = {
    kind: "local-kit",
    directory,
    store: "savy",
    expectedManifestSha256: createHash("sha256").update(manifest).digest("hex"),
    phase: "baseline",
  };
  const file = path.join(directory, "selector.json");
  await fs.writeFile(file, JSON.stringify(selector), { flag: "wx" });
  vi.stubEnv("IKCOUS_IDENTITY_FIXTURE_FILE", file);
  return { directory, file, selector };
}
function fixtureEnv() {
  for (const key of environment) vi.stubEnv(key, undefined);
  vi.stubEnv("IKCOUS_IDENTITY_MODE", "fixture");
  vi.stubEnv("IKCOUS_CODE_SHA", sha);
}
async function config(extra: UserConfig = {}, preview = false) {
  const factory = (await import("../../vite.config"))
    .default as UserConfigFnPromise;
  const context: ConfigEnv = {
    command: preview ? "serve" : "build",
    mode: "production",
    isPreview: preview,
  };
  const initial = await factory(context);
  const resolved = await resolveConfig(
    { ...mergeConfig(initial, extra), root, configFile: false, envFile: false },
    context.command,
    "production",
    "production",
    preview,
  );
  const lifecycle = resolved.plugins.find(
    (plugin) => plugin.name === "store-identity-lifecycle",
  );
  if (lifecycle?.closeBundle && typeof lifecycle.closeBundle === "object") {
    const handler = lifecycle.closeBundle.handler;
    disposals.push(() => Promise.resolve(handler.call({} as never)));
  }
  return resolved;
}
afterEach(async () => {
  for (const dispose of disposals.splice(0)) await dispose();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  for (const directory of localRoots.splice(0)) {
    if (
      path.dirname(directory) !== os.tmpdir() ||
      !path.basename(directory).startsWith("local-config-test-")
    )
      throw new Error("unsafe cleanup");
    await fs.rm(directory, { recursive: true, force: true });
  }
});

describe("fronteira da configuração de identidade", () => {
  it("seletor local percorre a config real e update muda só identidade", async () => {
    fixtureEnv();
    const kit = await localSelector();
    const network = vi.fn(() => {
      throw new Error("network forbidden");
    });
    vi.stubGlobal("fetch", network);
    const baseline = JSON.parse((await config()).define!.__STORE_IDENTITY__);
    expect(baseline.identity.storeName).toBe("Ensaio Savy");
    expect(baseline.source).toBe("fixture");
    expect(baseline.publicUrl).toBe("https://loja-ensaio.invalid");
    expect(JSON.stringify(baseline)).not.toContain(kit.directory);
    expect(JSON.stringify(baseline)).not.toMatch(
      /publishable|expectedManifestSha256|selector.json/,
    );
    await fs.writeFile(
      kit.file,
      JSON.stringify({ ...kit.selector, phase: "update" }),
    );
    const update = JSON.parse((await config()).define!.__STORE_IDENTITY__);
    expect(update.identity.storeName).toBe("Ensaio Savy — atualização");
    expect(update.identityRevision).not.toBe(baseline.identityRevision);
    expect(update.identity.assets).toEqual(baseline.identity.assets);
    expect(network).not.toHaveBeenCalled();
  });
  it.each(["database", undefined])(
    "seletor fora de fixture (%s) recusa antes de leitura/rede inclusive preview",
    async (mode) => {
      fixtureEnv();
      vi.stubEnv("IKCOUS_IDENTITY_MODE", mode);
      vi.stubEnv("IKCOUS_IDENTITY_FIXTURE_FILE", "private-invalid-path");
      const reads = vi.spyOn(fs, "readFile");
      const staging = vi.spyOn(fs, "mkdtemp");
      const network = vi.fn();
      vi.stubGlobal("fetch", network);
      const { createIdentityBuildConfig } = await import(
        "../../scripts/identityBuildConfig"
      );
      for (const isPreview of [false, true]) {
        expect(() =>
          createIdentityBuildConfig({
            env: process.env,
            context: { mode: "production", command: "build", isPreview },
            root,
            pwaOptions: {},
            resolvePublicAddress: () => "https://loja.invalid",
          }),
        ).toThrow(/IDENTITY_FIXTURE/);
      }
      expect(reads).not.toHaveBeenCalled();
      expect(staging).not.toHaveBeenCalled();
      expect(network).not.toHaveBeenCalled();
    },
  );
  it.each([
    "",
    "invalid JSON",
    "[]",
    "{}",
    '{"kind":"local-kit","secret":"DO_NOT_ECHO"}',
  ])("recusa seletor inválido sem expor conteúdo: %s", async (body) => {
    fixtureEnv();
    const kit = await localSelector();
    await fs.writeFile(kit.file, body);
    await expect(config()).rejects.toThrow(/^IDENTITY_LOCAL_KIT$/);
  });
  it.each(["extra", "oversized", "utf8", "directory", "link", "empty-path"])(
    "recusa arquivo seletor %s",
    async (failure) => {
      fixtureEnv();
      const kit = await localSelector();
      if (failure === "extra")
        await fs.writeFile(
          kit.file,
          JSON.stringify({ ...kit.selector, secret: "DO_NOT_ECHO" }),
        );
      if (failure === "oversized") await fs.truncate(kit.file, 4097);
      if (failure === "utf8") await fs.writeFile(kit.file, Buffer.from([255]));
      if (failure === "directory")
        vi.stubEnv("IKCOUS_IDENTITY_FIXTURE_FILE", kit.directory);
      if (failure === "empty-path")
        vi.stubEnv("IKCOUS_IDENTITY_FIXTURE_FILE", "");
      const alias = path.join(kit.directory, "alias.json");
      if (failure === "link") {
        await fs.symlink(kit.file, alias, "file");
        vi.stubEnv("IKCOUS_IDENTITY_FIXTURE_FILE", alias);
      }
      try {
        await expect(config()).rejects.toThrow(/^IDENTITY_LOCAL_KIT$/);
      } finally {
        if (failure === "link") await fs.unlink(alias);
      }
    },
  );
  it.each([
    "VERCEL",
    "CF_PAGES",
    "SUPABASE_URL",
    "DATABASE_URL",
    "VITE_STORE_NAME",
    "VITE_BRAND_PRIMARY",
  ])("hosting/config real %s recusa sem ler kit", async (key) => {
    fixtureEnv();
    vi.stubEnv("IKCOUS_IDENTITY_FIXTURE_FILE", "private-invalid-path");
    vi.stubEnv(key, "provided");
    const reads = vi.spyOn(fs, "readFile");
    const network = vi.fn();
    vi.stubGlobal("fetch", network);
    await expect(config()).rejects.toThrow(/IDENTITY_FIXTURE/);
    expect(
      reads.mock.calls.some(([value]) => value === "private-invalid-path"),
    ).toBe(false);
    expect(network).not.toHaveBeenCalled();
  });
  it("importar não baixa, prepara, cria processo nem registra listener", async () => {
    vi.resetModules();
    const fetch = vi.fn(() => {
      throw new Error("network forbidden");
    });
    vi.stubGlobal("fetch", fetch);
    const staging = vi.spyOn(fs, "mkdtemp");
    const spawn = vi.spyOn(childProcess, "execFileSync");
    const listener = vi.spyOn(process, "on");
    await import("../../vite.config");
    expect(fetch).not.toHaveBeenCalled();
    expect(staging).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });
  it("produção e desenvolvimento sem identidade falham antes da rede", async () => {
    fixtureEnv();
    vi.stubEnv("IKCOUS_IDENTITY_MODE", undefined);
    vi.stubGlobal("fetch", () => {
      throw new Error("network forbidden");
    });
    await expect(config()).rejects.toThrow(/IDENTITY/);
  });
  it("fixture explícita usa dist-test, fotografia pública e nenhuma rede", async () => {
    fixtureEnv();
    vi.stubGlobal("fetch", () => {
      throw new Error("network forbidden");
    });
    const result = await config();
    expect(result.build.outDir).toBe("dist-test");
    const snapshot = JSON.parse(result.define!.__STORE_IDENTITY__);
    expect(snapshot.source).toBe("fixture");
    expect(JSON.parse(result.define!.__APP_VERSION__)).toBe(
      snapshot.deliveryVersion,
    );
    expect(snapshot.codeSha).toBe(sha);
    expect(JSON.stringify(snapshot)).not.toContain("publishable");
    expect(await fs.stat(result.publicDir)).toBeTruthy();
  });
  it.each(["typo", "Fixture", " database ", ""])(
    "recusa modo desconhecido %s",
    async (mode) => {
      fixtureEnv();
      vi.stubEnv("IKCOUS_IDENTITY_MODE", mode);
      await expect(config()).rejects.toThrow(/IDENTITY_MODE/);
    },
  );
  it.each([
    "VERCEL",
    "CF_PAGES",
    "VITE_SUPABASE_URL",
    "VITE_SUPABASE_ANON_KEY",
    "VITE_APP_URL",
  ])("fixture recusa configuração externa %s", async (key) => {
    fixtureEnv();
    vi.stubEnv(key, "provided");
    await expect(config()).rejects.toThrow(/IDENTITY_FIXTURE/);
  });
  it("recusa override de output e watch antes de preparar", async () => {
    fixtureEnv();
    const staging = vi.spyOn(fs, "mkdtemp");
    await expect(config({ build: { outDir: "dist" } })).rejects.toThrow(
      /IDENTITY_OUTPUT/,
    );
    await expect(config({ build: { watch: {} } })).rejects.toThrow(
      /IDENTITY_WATCH/,
    );
    expect(staging).not.toHaveBeenCalled();
  });
  it("preview serve saída existente sem identidade, git ou staging", async () => {
    fixtureEnv();
    vi.stubEnv("IKCOUS_CODE_SHA", "invalid");
    const staging = vi.spyOn(fs, "mkdtemp");
    const spawn = vi.spyOn(childProcess, "execFileSync");
    const result = await config({}, true);
    expect(result.build.outDir).toBe("dist-test");
    expect(result.define?.__STORE_IDENTITY__).toBeUndefined();
    expect(staging).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });
  it.each(["short", "A".repeat(40), ""])(
    "SHA fornecido inválido não vira relógio: %s",
    async (value) => {
      fixtureEnv();
      vi.stubEnv("IKCOUS_CODE_SHA", value);
      await expect(config()).rejects.toThrow(/IDENTITY_SHA/);
    },
  );
  it("SHA explícitos conflitantes falham", async () => {
    fixtureEnv();
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "b".repeat(40));
    await expect(config()).rejects.toThrow(/IDENTITY_SHA/);
  });
  it.each([
    "http://loja.invalid",
    "https://user@loja.invalid",
    "https://loja.invalid/path",
    "https://loja.invalid/?q=x",
    "https://loja.invalid/#hash",
  ])("endereço público inválido falha antes da rede: %s", async (url) => {
    fixtureEnv();
    vi.stubEnv("IKCOUS_IDENTITY_MODE", "database");
    vi.stubEnv("VITE_APP_URL", url);
    vi.stubGlobal("fetch", () => {
      throw new Error("network forbidden");
    });
    await expect(config()).rejects.toThrow(/IDENTITY_PUBLIC_URL/);
  });
  it("identidade real percorre A3 com transporte fictício, sem fallback", async () => {
    fixtureEnv();
    vi.stubEnv("IKCOUS_IDENTITY_MODE", "database");
    vi.stubEnv("VITE_APP_URL", "https://loja-exclusiva.invalid");
    vi.stubEnv("VITE_SUPABASE_URL", "https://abcdefghijklmnopqrst.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_fixture_only");
    const fixture = await createIdentityBuildFixture("oceano");
    const { identity } = fixture;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === "/rest/v1/v_store_config")
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
      const file = fixture.files.find((item) =>
        url.pathname.endsWith(item.path),
      );
      if (!file) throw new Error("unexpected request");
      return new Response(Buffer.from(file.bytes), {
        headers: { "content-type": file.mediaType },
      });
    });
    const result = await config();
    const snapshot = JSON.parse(result.define!.__STORE_IDENTITY__);
    expect(result.build.outDir).toBe("dist");
    expect(snapshot.source).toBe("database");
    expect(snapshot.identityRevision).toBe(fixture.revision);
    expect(snapshot.publicUrl).toBe("https://loja-exclusiva.invalid");
    expect(snapshot.identity.urls.header).toBe(identity.urls.header);
    expect(snapshot.localUrls.header).toMatch(/^\/store-identity\//);
  });
  it("permissão ausente reprova a identidade real sem gerar fixture", async () => {
    fixtureEnv();
    vi.stubEnv("IKCOUS_IDENTITY_MODE", "database");
    vi.stubEnv("VITE_APP_URL", "https://loja.invalid");
    vi.stubEnv("VITE_SUPABASE_URL", "https://abcdefghijklmnopqrst.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_fixture_only");
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 403 }));
    await expect(config()).rejects.toThrow("IDENTITY_PERMISSION");
  });
  // Achado 4 da rodada de correção (revisor Opus): catraca contra o
  // endereço assado errado quando o build roda NA VERCEL sem VITE_APP_URL —
  // a hub já neutralizou o sitemap errado cadastrando VITE_APP_URL no
  // projeto Vercel (PR #545); esta trava impede a repetição se a variável
  // sumir de novo (`VERCEL_PROJECT_PRODUCTION_URL` é o domínio de produção
  // MAIS CURTO do projeto e, num projeto multi-loja, pode apontar para
  // outra loja).
  it("build NA VERCEL (VERCEL=1) sem VITE_APP_URL -> lança antes da rede, mensagem nomeia a causa", async () => {
    fixtureEnv();
    vi.stubEnv("IKCOUS_IDENTITY_MODE", "database");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "outra-loja.vercel.app");
    vi.stubGlobal("fetch", () => {
      throw new Error("network forbidden");
    });
    await expect(config()).rejects.toThrow(
      "IDENTITY_PUBLIC_URL: VITE_APP_URL obrigatorio na Vercel - VERCEL_PROJECT_PRODUCTION_URL e o dominio de producao MAIS CURTO do projeto e num projeto multi-loja aponta para outra loja",
    );
  });

  it("build NA VERCEL (VERCEL=1) com VITE_APP_URL só de espaços -> a MESMA mensagem da catraca (em branco conta como ausente)", async () => {
    fixtureEnv();
    vi.stubEnv("IKCOUS_IDENTITY_MODE", "database");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VITE_APP_URL", "   ");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "outra-loja.vercel.app");
    vi.stubGlobal("fetch", () => {
      throw new Error("network forbidden");
    });
    await expect(config()).rejects.toThrow(
      "IDENTITY_PUBLIC_URL: VITE_APP_URL obrigatorio na Vercel",
    );
  });

  it("build NA VERCEL (VERCEL=1) COM VITE_APP_URL -> usa ela normalmente (a trava só cobra a ausência)", async () => {
    fixtureEnv();
    vi.stubEnv("IKCOUS_IDENTITY_MODE", "database");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VITE_APP_URL", "https://loja-exclusiva.invalid");
    vi.stubEnv("VITE_SUPABASE_URL", "https://abcdefghijklmnopqrst.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_fixture_only");
    const fixture = await createIdentityBuildFixture("oceano");
    const { identity } = fixture;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === "/rest/v1/v_store_config")
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
      const file = fixture.files.find((item) =>
        url.pathname.endsWith(item.path),
      );
      if (!file) throw new Error("unexpected request");
      return new Response(Buffer.from(file.bytes), {
        headers: { "content-type": file.mediaType },
      });
    });
    const result = await config();
    const snapshot = JSON.parse(result.define!.__STORE_IDENTITY__);
    expect(snapshot.publicUrl).toBe("https://loja-exclusiva.invalid");
  });

  it("sem VERCEL (fora da Vercel), só VERCEL_PROJECT_PRODUCTION_URL -> continua funcionando como hoje (a trava só cobra dentro da Vercel)", async () => {
    fixtureEnv();
    vi.stubEnv("IKCOUS_IDENTITY_MODE", "database");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "loja-exclusiva.invalid");
    vi.stubEnv("VITE_SUPABASE_URL", "https://abcdefghijklmnopqrst.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_fixture_only");
    const fixture = await createIdentityBuildFixture("oceano");
    const { identity } = fixture;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === "/rest/v1/v_store_config")
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
      const file = fixture.files.find((item) =>
        url.pathname.endsWith(item.path),
      );
      if (!file) throw new Error("unexpected request");
      return new Response(Buffer.from(file.bytes), {
        headers: { "content-type": file.mediaType },
      });
    });
    const result = await config();
    const snapshot = JSON.parse(result.define!.__STORE_IDENTITY__);
    expect(snapshot.publicUrl).toBe("https://loja-exclusiva.invalid");
  });

  it("override Rollup de diretório não contorna dist-test", async () => {
    fixtureEnv();
    const staging = vi.spyOn(fs, "mkdtemp");
    await expect(
      config({ build: { rollupOptions: { output: { dir: "dist" } } } }),
    ).rejects.toThrow(/IDENTITY_OUTPUT/);
    expect(staging).not.toHaveBeenCalled();
  });
});
