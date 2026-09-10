import path from "node:path";
import { resolveConfig } from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createIdentityBuildConfig } from "../../scripts/identityBuildConfig";
import { createIdentityBuildFixture } from "../../scripts/identityBuildFixture";
import {
  lerChaveSupabase,
  lerOrigemChaveSupabase,
  lerSupabaseUrl,
} from "../../src/lib/env-valores";

const root = path.resolve(import.meta.dirname, "../..");
const origin = "https://abcdefghijklmnopqrst.supabase.co";
const publishable = "sb_publishable_fixture_only";
const anon = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(
  JSON.stringify({ role: "anon" }),
).toString("base64url")}.fixture`;
const disposals: Array<() => Promise<void>> = [];

async function prepare(env: Record<string, string | undefined>) {
  const { plugin } = createIdentityBuildConfig({
    root,
    env: {
      IKCOUS_CODE_SHA: "a".repeat(40),
      VITE_APP_URL: "https://loja-exclusiva.invalid",
      ...env,
    },
    context: { command: "build", mode: "production" },
    resolvePublicAddress: () => "https://loja-exclusiva.invalid",
    pwaOptions: { manifest: {} },
  });
  const close = plugin.closeBundle;
  if (close && typeof close === "object") {
    disposals.push(() => Promise.resolve(close.handler.call({} as never)));
  }
  return resolveConfig(
    { root, configFile: false, envFile: false, plugins: [plugin] },
    "build",
  );
}

afterEach(async () => {
  for (const dispose of disposals.splice(0)) await dispose();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("ambiente público igual no preparo e nos leitores vivos", () => {
  it("limpa antes da precedência e acompanha trocas sem reimportar", async () => {
    const fixture = await createIdentityBuildFixture("oceano");
    const { identity } = fixture;
    const requests: Array<{ origin: string; key: string | null }> = [];
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input),
        );
        if (url.pathname === "/rest/v1/v_store_config") {
          requests.push({
            origin: url.origin,
            key: new Headers(init?.headers).get("apikey"),
          });
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
      },
    );
    const cases = [
      {
        url: origin,
        nova: publishable,
        legada: anon,
        key: publishable,
        source: "VITE_SUPABASE_PUBLISHABLE_KEY",
      },
      {
        url: origin,
        nova: "   ",
        legada: anon,
        key: anon,
        source: "VITE_SUPABASE_ANON_KEY",
      },
      {
        url: `\uFEFF ${origin}\n\u200B`,
        nova: "\t\n\u00A0\u200B",
        legada: ` ${anon}\n`,
        key: anon,
        source: "VITE_SUPABASE_ANON_KEY",
      },
      {
        url: origin,
        nova: ` \uFEFF${publishable}\n`,
        legada: anon,
        key: publishable,
        source: "VITE_SUPABASE_PUBLISHABLE_KEY",
      },
      {
        url: origin,
        nova: undefined,
        legada: anon,
        key: anon,
        source: "VITE_SUPABASE_ANON_KEY",
      },
    ];
    for (const item of cases) {
      const env = {
        VITE_SUPABASE_URL: item.url,
        VITE_SUPABASE_PUBLISHABLE_KEY: item.nova,
        VITE_SUPABASE_ANON_KEY: item.legada,
      };
      vi.stubEnv("VITE_SUPABASE_URL", item.url);
      vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", item.nova);
      vi.stubEnv("VITE_SUPABASE_ANON_KEY", item.legada);
      expect(lerSupabaseUrl()).toBe(origin);
      expect(lerChaveSupabase()).toBe(item.key);
      expect(lerOrigemChaveSupabase()).toBe(item.source);
      const result = await prepare(env);
      expect(requests.at(-1)).toEqual({ origin, key: item.key });
      const snapshot = JSON.parse(result.define!.__STORE_IDENTITY__);
      expect(snapshot.identityRevision).toBe(fixture.revision);
      expect(snapshot.identity.urls.header).toBe(identity.urls.header);
      expect(JSON.stringify(snapshot)).not.toContain(item.key);
    }
    expect(requests).toHaveLength(cases.length);
  });

  it.each([
    { VITE_SUPABASE_URL: origin },
    {
      VITE_SUPABASE_URL: origin,
      VITE_SUPABASE_PUBLISHABLE_KEY: " \n",
      VITE_SUPABASE_ANON_KEY: "\u200B",
    },
    { VITE_SUPABASE_URL: " \n", VITE_SUPABASE_PUBLISHABLE_KEY: publishable },
  ])("ausência após limpeza mantém erro explícito sem rede %#", async (env) => {
    const network = vi.fn();
    vi.stubGlobal("fetch", network);
    await expect(prepare(env)).rejects.toThrow(/IDENTITY_INCOMPLETE/);
    expect(network).not.toHaveBeenCalled();
  });

  it.each([
    "sb_secret_fixture_only",
    `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.fixture`,
  ])(
    "chave administrativa não cai para anon válida nem chega à rede %#",
    async (key) => {
      const network = vi.fn();
      vi.stubGlobal("fetch", network);
      await expect(
        prepare({
          VITE_SUPABASE_URL: origin,
          VITE_SUPABASE_PUBLISHABLE_KEY: ` ${key}\n`,
          VITE_SUPABASE_ANON_KEY: anon,
        }),
      ).rejects.toThrow(/IDENTITY_KEY/);
      expect(network).not.toHaveBeenCalled();
    },
  );

  it.each([
    "http://abcdefghijklmnopqrst.supabase.co",
    "https://other.invalid",
    `${origin}/path`,
    "https://user@abcdefghijklmnopqrst.supabase.co",
  ])("origem inválida segue recusada antes da rede: %s", async (url) => {
    const network = vi.fn();
    vi.stubGlobal("fetch", network);
    await expect(
      prepare({
        VITE_SUPABASE_URL: url,
        VITE_SUPABASE_PUBLISHABLE_KEY: publishable,
      }),
    ).rejects.toThrow(/IDENTITY_ORIGIN/);
    expect(network).not.toHaveBeenCalled();
  });

  it("fixture recusa ambiente mesmo quando a limpeza o tornaria vazio", async () => {
    const network = vi.fn();
    vi.stubGlobal("fetch", network);
    await expect(
      prepare({
        IKCOUS_IDENTITY_MODE: "fixture",
        VITE_APP_URL: undefined,
        VITE_SUPABASE_PUBLISHABLE_KEY: "   ",
      }),
    ).rejects.toThrow(/IDENTITY_FIXTURE/);
    expect(network).not.toHaveBeenCalled();
  });
});
