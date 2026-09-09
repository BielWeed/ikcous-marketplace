/* eslint-disable security/detect-non-literal-fs-filename -- Temporary fixtures and repository-owned public files only. */
import childProcess from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { mergeConfig, resolveConfig } from "vite";
import type { ConfigEnv, UserConfig, UserConfigFnPromise } from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createIdentityBuildFixture } from "../../scripts/identityBuildFixture";

const root = path.resolve(import.meta.dirname, "../..");
const sha = "a".repeat(40);
const environment = [
  "IKCOUS_IDENTITY_MODE",
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
});

describe("fronteira da configuração de identidade", () => {
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
  it("override Rollup de diretório não contorna dist-test", async () => {
    fixtureEnv();
    const staging = vi.spyOn(fs, "mkdtemp");
    await expect(
      config({ build: { rollupOptions: { output: { dir: "dist" } } } }),
    ).rejects.toThrow(/IDENTITY_OUTPUT/);
    expect(staging).not.toHaveBeenCalled();
  });
});
