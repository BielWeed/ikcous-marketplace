import path from "node:path";
import { resolveConfig } from "vite";
import type { Plugin, ResolvedConfig } from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createIdentityBuildConfig } from "../../scripts/identityBuildConfig";
import { createIdentityBuildFixture } from "../../scripts/identityBuildFixture";
import {
  PUBLIC_DEFINE_KEYS,
  SYNTHETIC_PUBLIC_SERVICE,
} from "../../src/config/storeDeliveryContract";
import type { PreparedStoreDelivery } from "../../src/config/storeDeliveryContract";

const root = path.resolve(import.meta.dirname, "../..");
const origin = "https://abcdefghijklmnopqrst.supabase.co";
const publishable = "sb_publishable_fixture_only";
const anon = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role: "anon" })).toString("base64url")}.fixture`;
const disposals: Array<() => Promise<void>> = [];

// `build.outDir` tem de ser fixado em `resolve()`: sem a chave o Vite assume
// "dist", que só coincide com o modo database; em fixture ("dist-test") a
// divergência faz `assertConfiguration` lançar IDENTITY_OUTPUT e mascarar a
// asserção real. Mesmo padrão de identity-build-finalization.test.ts:88 e
// identity-build-integration.test.ts:95.
function make(env: Record<string, string | undefined>, isPreview = false) {
  const { plugin, outDir } = createIdentityBuildConfig({
    root,
    env: { IKCOUS_CODE_SHA: "a".repeat(40), ...env },
    context: { command: "build", mode: "production", isPreview },
    resolvePublicAddress: () => "https://loja-exclusiva.invalid",
    pwaOptions: { manifest: {} },
  });
  const close = plugin.closeBundle;
  if (close && typeof close === "object")
    disposals.push(() => Promise.resolve(close.handler.call({} as never)));
  return { plugin, outDir };
}

const resolve = (plugins: Plugin[], outDir: string) =>
  resolveConfig(
    { root, configFile: false, envFile: false, plugins, build: { outDir } },
    "build",
  );

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
    const file = fixture.files.find((item) => url.pathname.endsWith(item.path));
    if (!file) throw new Error("unexpected request");
    return new Response(Buffer.from(file.bytes), {
      headers: { "content-type": file.mediaType },
    });
  });
  return fixture;
}

const databaseEnv = (keys: Record<string, string | undefined>) => ({
  VITE_APP_URL: "https://loja-exclusiva.invalid",
  VITE_SUPABASE_URL: origin,
  ...keys,
});

afterEach(async () => {
  for (const dispose of disposals.splice(0)) await dispose();
  vi.unstubAllGlobals();
});

describe("entrega preparada exposta em plugin.api", () => {
  it("getter antes de selar recusa sem fabricar valor", () => {
    const { plugin } = make({ IKCOUS_IDENTITY_MODE: "fixture" });
    expect(() => plugin.api!.get()).toThrow(/IDENTITY_DELIVERY_UNSEALED/);
  });

  it.each([
    {
      nova: publishable,
      legada: anon,
      keyClass: "publishable",
      slot: "publishable",
      other: "anon",
      source: "VITE_SUPABASE_PUBLISHABLE_KEY",
    },
    {
      nova: "   ",
      legada: anon,
      keyClass: "anon-jwt",
      slot: "anon",
      other: "publishable",
      source: "VITE_SUPABASE_ANON_KEY",
    },
  ] as const)(
    "database: chave escolhida no seu slot, o outro vazio ($keyClass)",
    async (item) => {
      const fixture = await databaseTransport();
      const { plugin, outDir } = make(
        databaseEnv({
          VITE_SUPABASE_PUBLISHABLE_KEY: item.nova,
          VITE_SUPABASE_ANON_KEY: item.legada,
        }),
      );
      const config = await resolve([plugin], outDir);
      const expectedKey = item.keyClass === "publishable" ? publishable : anon;
      expect(JSON.parse(config.define![PUBLIC_DEFINE_KEYS.url])).toBe(origin);
      expect(JSON.parse(config.define![PUBLIC_DEFINE_KEYS[item.slot]])).toBe(
        expectedKey,
      );
      expect(JSON.parse(config.define![PUBLIC_DEFINE_KEYS[item.other]])).toBe(
        "",
      );
      const delivery = plugin.api!.get() as PreparedStoreDelivery;
      expect(delivery.deliveryApiVersion).toBe(1);
      expect(delivery.snapshot).toEqual(
        JSON.parse(config.define!.__STORE_IDENTITY__),
      );
      expect(delivery.snapshot.identityRevision).toBe(fixture.revision);
      expect(delivery.connection).toEqual({
        kind: "database",
        origin,
        projectRef: "abcdefghijklmnopqrst",
        key: expectedKey,
        keyClass: item.keyClass,
        keySource: item.source,
      });
      expect(delivery.publicDefines).toEqual({
        url: origin,
        publishable: item.slot === "publishable" ? expectedKey : "",
        anon: item.slot === "anon" ? expectedKey : "",
      });
      expect(plugin.api!.get()).toBe(delivery);
      expect(Object.isFrozen(delivery)).toBe(true);
      expect(Object.isFrozen(delivery.connection)).toBe(true);
      expect(Object.isFrozen(delivery.publicDefines)).toBe(true);
      expect(JSON.stringify(delivery.snapshot)).not.toContain(expectedKey);
    },
  );

  it("database: define sobrescrito por plugin posterior é recusado", async () => {
    await databaseTransport();
    const { plugin, outDir } = make(
      databaseEnv({ VITE_SUPABASE_PUBLISHABLE_KEY: publishable }),
    );
    const late: Plugin = {
      name: "late-override",
      config: () => ({
        define: {
          [PUBLIC_DEFINE_KEYS.publishable]: JSON.stringify(
            "sb_publishable_other",
          ),
        },
      }),
    };
    await expect(resolve([plugin, late], outDir)).rejects.toThrow(
      /IDENTITY_DELIVERY_CHANGED/,
    );
  });

  it("fixture sem serviço: três vazios viram fixture-none", async () => {
    const { plugin, outDir } = make({ IKCOUS_IDENTITY_MODE: "fixture" });
    const config = await resolve([plugin], outDir);
    for (const key of Object.values(PUBLIC_DEFINE_KEYS)) {
      // eslint-disable-next-line security/detect-object-injection -- Key comes from the closed PUBLIC_DEFINE_KEYS tuple.
      expect(config.define![key]).toBe('""');
    }
    const delivery = plugin.api!.get() as PreparedStoreDelivery;
    expect(delivery.connection).toEqual({ kind: "fixture-none" });
    expect(delivery.publicDefines).toEqual({
      url: "",
      publishable: "",
      anon: "",
    });
    expect(delivery.snapshot.source).toBe("fixture");
  });

  it("fixture com o par da bancada A6 vira fixture-synthetic e mantém a correspondência de projeto", async () => {
    const { plugin, outDir } = make({ IKCOUS_IDENTITY_MODE: "fixture" });
    const bench: Plugin = {
      name: "a6c-like",
      config: () => ({
        define: {
          [PUBLIC_DEFINE_KEYS.url]: JSON.stringify(
            SYNTHETIC_PUBLIC_SERVICE.origin,
          ),
          [PUBLIC_DEFINE_KEYS.publishable]: JSON.stringify(
            SYNTHETIC_PUBLIC_SERVICE.publishableKey,
          ),
        },
      }),
    };
    await resolve([plugin, bench], outDir);
    expect(plugin.api!.get().connection).toEqual({
      kind: "fixture-synthetic",
      origin: SYNTHETIC_PUBLIC_SERVICE.origin,
      projectRef: "abcdefghijklmnopqrst",
      key: SYNTHETIC_PUBLIC_SERVICE.publishableKey,
    });
  });

  it.each([
    {
      [PUBLIC_DEFINE_KEYS.url]: JSON.stringify(SYNTHETIC_PUBLIC_SERVICE.origin),
    },
    {
      [PUBLIC_DEFINE_KEYS.url]: JSON.stringify(SYNTHETIC_PUBLIC_SERVICE.origin),
      [PUBLIC_DEFINE_KEYS.publishable]: JSON.stringify(publishable),
    },
    {
      [PUBLIC_DEFINE_KEYS.url]: JSON.stringify(SYNTHETIC_PUBLIC_SERVICE.origin),
      [PUBLIC_DEFINE_KEYS.publishable]: JSON.stringify(
        SYNTHETIC_PUBLIC_SERVICE.publishableKey,
      ),
      [PUBLIC_DEFINE_KEYS.anon]: JSON.stringify(anon),
    },
    {
      [PUBLIC_DEFINE_KEYS.url]: JSON.stringify(
        "https://zzzzzzzzzzzzzzzzzzzz.supabase.co",
      ),
      [PUBLIC_DEFINE_KEYS.publishable]: JSON.stringify(
        SYNTHETIC_PUBLIC_SERVICE.publishableKey,
      ),
    },
  ])("fixture: parcial ou chave arbitrária reprova %#", async (define) => {
    const { plugin, outDir } = make({ IKCOUS_IDENTITY_MODE: "fixture" });
    await expect(
      resolve(
        [plugin, { name: "partial", config: () => ({ define }) }],
        outDir,
      ),
    ).rejects.toThrow(/IDENTITY_DELIVERY_DEFINES/);
    expect(() => plugin.api!.get()).toThrow(/IDENTITY_DELIVERY_UNSEALED/);
  });

  it("substituição integral de import.meta.env é recusada", async () => {
    const { plugin, outDir } = make({ IKCOUS_IDENTITY_MODE: "fixture" });
    const whole: Plugin = {
      name: "whole-env",
      config: () => ({ define: { "import.meta.env": "{}" } }),
    };
    await expect(resolve([plugin, whole], outDir)).rejects.toThrow(
      /IDENTITY_DELIVERY_ENV/,
    );
  });

  it("observador post lê a entrega de forma síncrona dentro do próprio configResolved", async () => {
    const { plugin, outDir } = make({ IKCOUS_IDENTITY_MODE: "fixture" });
    let seen: PreparedStoreDelivery | undefined;
    const observer: Plugin = {
      name: "sync-observer",
      enforce: "post",
      configResolved(config: ResolvedConfig) {
        const provider = config.plugins.find(
          (p) => p.api?.name === "ikcous-store-delivery",
        );
        seen = provider!.api.get();
      },
    };
    await resolve([plugin, observer], outDir);
    expect(seen?.connection).toEqual({ kind: "fixture-none" });
  });

  it("preview não prepara nem sela", async () => {
    const { plugin, outDir } = make({ IKCOUS_IDENTITY_MODE: "fixture" }, true);
    await resolve([plugin], outDir);
    expect(() => plugin.api!.get()).toThrow(/IDENTITY_DELIVERY_UNSEALED/);
  });
});
