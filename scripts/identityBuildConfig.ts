/// <reference lib="dom" />
/* eslint-disable security/detect-non-literal-fs-filename -- Paths are fixed files in the validated staging or the closed build output, never identity text. */
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { ConfigEnv, Plugin, UserConfig } from "vite";
import type { VitePWAOptions } from "vite-plugin-pwa";
import type { BuildIdentitySnapshot } from "../src/config/buildIdentityContract";
// `identityHtml` mora agora em `src/config/identidadeNoHtml.ts` — extraída
// para ser a MESMA função pura que o porteiro (`src/hospedagem/porteiro.ts`)
// usa em tempo real (etapa 2 da escala, 11/09/2026). Reexportada abaixo
// (`export { ... }`) porque `tests/front/identity-build-integration.test.ts`
// importa `identityHtml` deste módulo; o comportamento não mudou, só o
// endereço da definição.
import { escapeHtml, identityHtml } from "../src/config/identidadeNoHtml";
import {
  PUBLIC_DEFINE_KEYS,
  STORE_DELIVERY_API,
  SYNTHETIC_PUBLIC_SERVICE,
} from "../src/config/storeDeliveryContract";
import type {
  PreparedStoreDelivery,
  PublicDefineValues,
  StoreConnection,
  StoreDeliveryApi,
} from "../src/config/storeDeliveryContract";
import type { OrigemChaveSupabase } from "../src/lib/env-publico-valores";
import { resolverValoresPublicosSupabase } from "../src/lib/env-publico-valores";
import { classifyPublicSupabaseKey } from "../src/lib/publicSupabaseKey";
import { normalizeSupabaseOrigin } from "../src/lib/storeIdentity";
import type { PreparedIdentityBuild } from "./prepareIdentity";

export { escapeHtml, identityHtml };

const essentialRoles = [
  "header",
  "loader",
  "favicon",
  "apple_touch",
  "icon_192",
  "icon_512",
  "maskable_512",
] as const;
const maximumPwaBytes = 10 * 1024 * 1024;

export function selectIdentityMode(
  env: Record<string, string | undefined>,
): "database" | "fixture" {
  const mode = env.IKCOUS_IDENTITY_MODE;
  if (env.IKCOUS_IDENTITY_FIXTURE_FILE !== undefined && mode !== "fixture")
    throw new Error("IDENTITY_FIXTURE: seletor local exige modo fixture");
  if (mode === undefined || mode === "database") return "database";
  if (mode === "fixture") return "fixture";
  throw new Error("IDENTITY_MODE: use database ou fixture explicitamente");
}

function codeSha(
  env: Record<string, string | undefined>,
  root: string,
): string {
  const supplied = [env.IKCOUS_CODE_SHA, env.VERCEL_GIT_COMMIT_SHA].filter(
    (value): value is string => value !== undefined,
  );
  if (
    supplied.some((value) => !/^[a-f0-9]{40}$/.test(value)) ||
    new Set(supplied).size > 1
  )
    throw new Error("IDENTITY_SHA: SHA completo inválido ou conflitante");
  const sha =
    supplied[0] ??
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  if (!/^[a-f0-9]{40}$/.test(sha))
    throw new Error("IDENTITY_SHA: SHA completo obrigatório");
  return sha;
}

function publicAddress(
  env: Record<string, string | undefined>,
  resolver: (env: Record<string, string | undefined>) => string,
): string {
  const candidates = [
    env.VITE_APP_URL,
    env.VERCEL_PROJECT_PRODUCTION_URL,
    env.VERCEL_URL,
  ].filter((value): value is string => !!value);
  if (!candidates.length)
    throw new Error("IDENTITY_PUBLIC_URL: endereço público obrigatório");
  for (const value of candidates) {
    const withProtocol = value.startsWith("https://")
      ? value
      : `https://${value}`;
    let parsed: URL;
    try {
      parsed = new URL(withProtocol);
    } catch {
      throw new Error("IDENTITY_PUBLIC_URL: endereço inválido");
    }
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      parsed.pathname !== "/" ||
      !/^https:\/\/[^/?#@\s]+\/?$/.test(withProtocol)
    )
      throw new Error("IDENTITY_PUBLIC_URL: HTTPS na raiz obrigatório");
  }
  return resolver(env);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value as Record<string, unknown>))
      deepFreeze(item);
  }
  return value;
}

function projectRefOf(origin: string): string {
  return new URL(origin).hostname.split(".")[0];
}

// Lê os três define públicos do config resolvido. Recusa ambiente inteiro e ausência.
function readPublicDefines(
  define: Record<string, string> | undefined,
): PublicDefineValues {
  if (!define || Object.hasOwn(define, "import.meta.env"))
    throw new Error(
      "IDENTITY_DELIVERY_ENV: substituição integral de import.meta.env recusada",
    );
  const read = (key: string): string => {
    // eslint-disable-next-line security/detect-object-injection -- Key comes from the closed PUBLIC_DEFINE_KEYS tuple; the value is re-validated as string + JSON string below.
    const raw = define[key];
    if (typeof raw !== "string")
      throw new Error("IDENTITY_DELIVERY_DEFINES: define público ausente");
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new Error("IDENTITY_DELIVERY_DEFINES: define público ilegível");
    }
    if (typeof value !== "string")
      throw new Error("IDENTITY_DELIVERY_DEFINES: define público não textual");
    return value;
  };
  return {
    url: read(PUBLIC_DEFINE_KEYS.url),
    publishable: read(PUBLIC_DEFINE_KEYS.publishable),
    anon: read(PUBLIC_DEFINE_KEYS.anon),
  };
}

function fixtureConnection(
  values: PublicDefineValues,
  projectRef: string,
): StoreConnection {
  if (values.url === "" && values.publishable === "" && values.anon === "")
    return { kind: "fixture-none" };
  if (
    values.url === SYNTHETIC_PUBLIC_SERVICE.origin &&
    values.publishable === SYNTHETIC_PUBLIC_SERVICE.publishableKey &&
    values.anon === ""
  ) {
    if (projectRefOf(values.url) !== projectRef)
      throw new Error(
        "IDENTITY_CONNECTION: projeto sintético não corresponde à marca",
      );
    return {
      kind: "fixture-synthetic",
      origin: SYNTHETIC_PUBLIC_SERVICE.origin,
      projectRef,
      key: SYNTHETIC_PUBLIC_SERVICE.publishableKey,
    };
  }
  throw new Error(
    "IDENTITY_DELIVERY_DEFINES: fixture aceita só ausência total ou o par sintético",
  );
}

export function createIdentityBuildConfig(options: {
  env: Record<string, string | undefined>;
  context: ConfigEnv;
  root: string;
  resolvePublicAddress: (env: Record<string, string | undefined>) => string;
  pwaOptions: Partial<VitePWAOptions>;
}) {
  const { env, context, root, pwaOptions } = options;
  const source = selectIdentityMode(env);
  const outDir = source === "fixture" ? "dist-test" : "dist";
  let prepared: PreparedIdentityBuild | undefined;
  let snapshot: BuildIdentitySnapshot | undefined;
  let delivery: PreparedStoreDelivery | undefined;
  let publicDefines: PublicDefineValues | undefined;
  const dispose = async () => {
    if (prepared) await prepared.dispose();
  };
  const seal = (connection: StoreConnection, values: PublicDefineValues) => {
    if (delivery)
      throw new Error("IDENTITY_DELIVERY_SEALED: entrega já selada");
    if (!snapshot) throw new Error("IDENTITY_INCOMPLETE: fotografia ausente");
    delivery = deepFreeze({
      deliveryApiVersion: 1 as const,
      snapshot,
      publicDefines: values,
      connection,
    });
  };
  const api: StoreDeliveryApi = {
    name: STORE_DELIVERY_API.name,
    version: STORE_DELIVERY_API.version,
    get() {
      if (!delivery)
        throw new Error("IDENTITY_DELIVERY_UNSEALED: entrega ainda não selada");
      return delivery;
    },
  };
  const assertOutput = (output: string | undefined) => {
    if (
      output !== undefined &&
      path.resolve(root, output) !== path.join(root, outDir)
    )
      throw new Error("IDENTITY_OUTPUT: saída fixa para o modo escolhido");
  };
  const assertConfiguration = async (
    config: Pick<UserConfig, "root" | "build">,
  ) => {
    assertOutput(config.build?.outDir);
    const output = config.build?.rollupOptions?.output;
    const outputs = Array.isArray(output) ? output : [output];
    if (
      (config.root && path.resolve(config.root) !== root) ||
      outputs.some(
        (item) => item?.dir !== undefined || item?.file !== undefined,
      )
    )
      throw new Error(
        "IDENTITY_OUTPUT: raiz e saída Rollup não podem sobrepor a entrega",
      );
    const stat = await fs
      .lstat(path.join(root, outDir))
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
    if (stat && (stat.isSymbolicLink() || !stat.isDirectory()))
      throw new Error(
        "IDENTITY_OUTPUT: saída deve ser diretório local sem link",
      );
  };
  const plugin: Plugin<StoreDeliveryApi> = {
    name: "store-identity-lifecycle",
    enforce: "pre",
    api,
    async config(config) {
      await assertConfiguration(config);
      if (config.build?.watch)
        throw new Error("IDENTITY_WATCH: build watch não suportado");
      if (context.isPreview) return;
      try {
        if (
          source === "fixture" &&
          Object.entries(env).some(
            ([key, value]) =>
              !!value &&
              (/^(VERCEL|CF_PAGES)$/.test(key) ||
                /^(VITE_SUPABASE_|SUPABASE_|DATABASE_URL$|VITE_APP_URL$|VERCEL_URL$|VERCEL_PROJECT_PRODUCTION_URL$|VITE_APP_NAME$|VITE_BRAND_|VITE_STORE_)/.test(
                  key,
                )),
          )
        )
          throw new Error(
            "IDENTITY_FIXTURE: configuração real ou hospedagem recusada",
          );
        const sha = codeSha(env, root);
        const publicUrl =
          source === "fixture"
            ? "https://loja-ensaio.invalid"
            : publicAddress(env, options.resolvePublicAddress);
        const { prepareIdentityBuild } = await import("./prepareIdentity");
        let downloaded;
        let publicSelection:
          | {
              supabaseUrl: string;
              chave: { valor: string; origem: OrigemChaveSupabase };
            }
          | undefined;
        if (source === "fixture") {
          const { createIdentityBuildFixture } = await import(
            "./identityBuildFixture"
          );
          if (env.IKCOUS_IDENTITY_FIXTURE_FILE !== undefined) {
            const { readLocalKitFixtureSelector } = await import(
              "./localIdentityBuildFixture"
            );
            downloaded = await createIdentityBuildFixture(
              await readLocalKitFixtureSelector(
                env.IKCOUS_IDENTITY_FIXTURE_FILE,
              ),
            );
          } else {
            downloaded = await createIdentityBuildFixture();
          }
        } else {
          const { readPublicStoreIdentity, downloadIdentityAssets } =
            await import("../src/lib/publicStoreIdentity");
          const { supabaseUrl, chave } = resolverValoresPublicosSupabase({
            VITE_SUPABASE_URL: env.VITE_SUPABASE_URL,
            VITE_SUPABASE_PUBLISHABLE_KEY: env.VITE_SUPABASE_PUBLISHABLE_KEY,
            VITE_SUPABASE_ANON_KEY: env.VITE_SUPABASE_ANON_KEY,
          });
          if (!supabaseUrl || !chave.valor)
            throw new Error(
              "IDENTITY_INCOMPLETE: configuração pública obrigatória",
            );
          publicSelection = { supabaseUrl, chave };
          const identity = await readPublicStoreIdentity({
            supabaseUrl,
            publicKey: chave.valor,
          });
          downloaded = await downloadIdentityAssets(identity);
        }
        for (const role of essentialRoles) {
          // eslint-disable-next-line security/detect-object-injection -- Role belongs to the closed constant tuple above; A3 validates every descriptor.
          if (downloaded.identity.assets[role].bytes > maximumPwaBytes)
            throw new Error(
              `IDENTITY_PWA_SIZE: ${role} excede 10 MiB; fornecer derivado aprovado sem alterar o original`,
            );
        }
        const pkg = JSON.parse(
          await fs.readFile(path.join(root, "package.json"), "utf8"),
        ) as { version: string };
        prepared = await prepareIdentityBuild({
          downloaded,
          commonPublicDir: path.join(root, "public"),
          code: { version: pkg.version, sha },
        });
        snapshot = Object.freeze({
          schemaVersion: 1,
          source,
          identity: prepared.identity,
          localUrls: prepared.localUrls,
          publicUrl,
          codeVersion: prepared.codeVersion,
          codeSha: prepared.codeSha,
          identityRevision: prepared.identityRevision,
          deliveryVersion: prepared.deliveryVersion,
        });
        if (source === "database") {
          const { supabaseUrl, chave } = publicSelection!;
          const keyClass = classifyPublicSupabaseKey(chave.valor);
          const origin = normalizeSupabaseOrigin(supabaseUrl);
          const projectRef = projectRefOf(origin);
          if (snapshot.identity.projectRef !== projectRef)
            throw new Error(
              "IDENTITY_CONNECTION: origem do banco não corresponde à marca",
            );
          publicDefines = {
            url: supabaseUrl,
            publishable: keyClass === "publishable" ? chave.valor : "",
            anon: keyClass === "anon-jwt" ? chave.valor : "",
          };
          seal(
            {
              kind: "database",
              origin,
              projectRef,
              key: chave.valor,
              keyClass,
              keySource: chave.origem,
            },
            publicDefines,
          );
        } else {
          publicDefines = { url: "", publishable: "", anon: "" };
        }
        const guardianPath = path.join(
          prepared.publicDir,
          "silent-guardian.js",
        );
        const guardian = await fs.readFile(guardianPath, "utf8");
        if (!guardian.includes('"1773003981700"'))
          throw new Error("IDENTITY_GUARDIAN: ponto de sincronização ausente");
        await fs.writeFile(
          guardianPath,
          guardian.replace(
            '"1773003981700"',
            JSON.stringify(snapshot.deliveryVersion),
          ),
        );
        await fs.writeFile(
          path.join(prepared.publicDir, "sitemap.xml"),
          `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${escapeHtml(publicUrl)}/</loc></url></urlset>`,
        );
        const { identity, localUrls } = snapshot;
        Object.assign(pwaOptions.manifest!, {
          name: identity.storeName,
          short_name: identity.storeName,
          description: `Produtos e novidades de ${identity.storeName}`,
          theme_color: identity.theme.primary,
          background_color: identity.theme.primary,
          icons: [
            { src: localUrls.icon_192, sizes: "192x192", type: "image/png" },
            { src: localUrls.icon_512, sizes: "512x512", type: "image/png" },
            {
              src: localUrls.maskable_512,
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
        });
        pwaOptions.includeAssets = [
          // eslint-disable-next-line security/detect-object-injection -- Closed tuple of validated identity roles, not caller input.
          ...new Set(essentialRoles.map((role) => localUrls[role].slice(1))),
        ];
        return {
          publicDir: prepared.publicDir,
          define: {
            __STORE_IDENTITY__: JSON.stringify(snapshot),
            __APP_VERSION__: JSON.stringify(snapshot.deliveryVersion),
            [PUBLIC_DEFINE_KEYS.url]: JSON.stringify(publicDefines.url),
            [PUBLIC_DEFINE_KEYS.publishable]: JSON.stringify(
              publicDefines.publishable,
            ),
            [PUBLIC_DEFINE_KEYS.anon]: JSON.stringify(publicDefines.anon),
          },
        };
      } catch (error) {
        await dispose();
        throw error;
      }
    },
    async configResolved(config) {
      try {
        // Síncrono e ANTES de qualquer await: configResolved roda em Promise.all,
        // e só este trecho tem ordem garantida frente ao observador (enforce post).
        if (!context.isPreview && snapshot) {
          const values = readPublicDefines(config.define);
          if (source === "database") {
            const emitted = publicDefines!;
            if (
              values.url !== emitted.url ||
              values.publishable !== emitted.publishable ||
              values.anon !== emitted.anon
            )
              throw new Error(
                "IDENTITY_DELIVERY_CHANGED: define público alterado após o preparo",
              );
          } else {
            seal(
              fixtureConnection(values, snapshot.identity.projectRef),
              values,
            );
          }
        }
        await assertConfiguration(config);
      } catch (error) {
        await dispose();
        throw error;
      }
    },
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        if (!snapshot)
          throw new Error("IDENTITY_INCOMPLETE: fotografia ausente");
        return identityHtml(html, snapshot);
      },
    },
    configureServer(server) {
      const close = server.close.bind(server);
      server.close = async () => {
        await close();
        await dispose();
      };
    },
    async buildEnd(error) {
      if (error) {
        await dispose();
      }
    },
    closeBundle: {
      order: "post",
      sequential: true,
      async handler() {
        if (context.command !== "build") return;
        await dispose();
        // Confirmation belongs to buildStore, after Vite has also finished closing.
      },
    },
  };
  return { plugin, outDir };
}
