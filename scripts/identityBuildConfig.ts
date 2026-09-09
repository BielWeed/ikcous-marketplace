/// <reference lib="dom" />
/* eslint-disable security/detect-non-literal-fs-filename -- Paths are fixed files in the validated staging or the closed build output, never identity text. */
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { ConfigEnv, Plugin, UserConfig } from "vite";
import type { VitePWAOptions } from "vite-plugin-pwa";
import type { BuildIdentitySnapshot } from "../src/config/buildIdentityContract";
import type { PreparedIdentityBuild } from "./prepareIdentity";

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
  if (mode === undefined || mode === "database") return "database";
  if (mode === "fixture") return "fixture";
  throw new Error("IDENTITY_MODE: use database ou fixture explicitamente");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function identityHtml(
  html: string,
  snapshot: BuildIdentitySnapshot,
): string {
  const { identity, localUrls, publicUrl } = snapshot;
  const description = `Produtos e novidades de ${identity.storeName}`;
  const place = [identity.city, identity.state].filter(Boolean).join(", ");
  const title = `${identity.storeName}${place ? ` | ${place}` : ""}`;
  const meta = new Map([
    ["description", description],
    ["theme-color", identity.theme.primary],
    ["background-color", identity.theme.primary],
    ["application-name", identity.storeName],
    ["apple-mobile-web-app-title", identity.storeName],
    ["og:title", identity.storeName],
    ["og:description", description],
    ["og:url", `${publicUrl}/`],
    ["og:image", `${publicUrl}${localUrls.og}`],
    ["og:image:type", identity.assets.og.media_type],
    ["twitter:title", identity.storeName],
    ["twitter:description", description],
    ["twitter:image", `${publicUrl}${localUrls.og}`],
  ]);
  let result = html
    .replace(
      /<title>[\s\S]*?<\/title>/,
      () => `<title>${escapeHtml(title)}</title>`,
    )
    .replace(
      /<meta (name|property)="([^"]+)" content="[^"]*"\s*\/>/g,
      (tag, kind: string, name: string) => {
        const value = meta.get(name);
        return value === undefined
          ? tag
          : `<meta ${kind}="${name}" content="${escapeHtml(value)}" />`;
      },
    )
    .replace(
      /<link rel="icon"[^>]*>/,
      () =>
        `<link rel="icon" type="${identity.assets.favicon.media_type}" href="${localUrls.favicon}" />`,
    )
    .replace(
      /<link rel="apple-touch-icon"[^>]*>/,
      () => `<link rel="apple-touch-icon" href="${localUrls.apple_touch}" />`,
    )
    .replace(
      /<link rel="preconnect" href="https:\/\/[^"]+\.supabase\.co" crossorigin\s*\/>/,
      () =>
        `<link rel="preconnect" href="https://${identity.projectRef}.supabase.co" crossorigin />`,
    )
    .replace(
      /<!-- LOGO_START -->[\s\S]*?<!-- LOGO_END -->/,
      () =>
        `<img src="${localUrls.loader}" alt="${escapeHtml(identity.storeName)}" class="guardian-logo" />`,
    )
    .replace(
      /<div class="cinematic-text">[^<]*<\/div>/,
      () =>
        `<div class="cinematic-text">${escapeHtml(identity.storeName)}</div>`,
    );
  const rgba = (color: string, alpha: string) =>
    `${Number.parseInt(color.slice(1, 3), 16)}, ${Number.parseInt(color.slice(3, 5), 16)}, ${Number.parseInt(color.slice(5, 7), 16)}, ${alpha}`;
  const { primary, secondary, accent } = identity.theme;
  const style = `<style id="dynamic-branding-style">:root {--primary-color:${primary};--secondary-color:${secondary};--accent-color:${accent};--orb-1-color:rgba(${rgba(primary, "0.25")});--orb-2-color:rgba(${rgba(secondary, "0.20")});--orb-3-color:rgba(${rgba(accent, "0.20")});--progress-track-color:rgba(${rgba(primary, "0.15")});}</style>`;
  result = result.replace("<head>", () => `<head>${style}`);
  return result;
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
  const dispose = async () => {
    if (prepared) await prepared.dispose();
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
  const plugin: Plugin = {
    name: "store-identity-lifecycle",
    enforce: "pre",
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
        if (source === "fixture") {
          const { createIdentityBuildFixture } = await import(
            "./identityBuildFixture"
          );
          downloaded = await createIdentityBuildFixture();
        } else {
          const { readPublicStoreIdentity, downloadIdentityAssets } =
            await import("../src/lib/publicStoreIdentity");
          const keys = [
            env.VITE_SUPABASE_PUBLISHABLE_KEY,
            env.VITE_SUPABASE_ANON_KEY,
          ].filter(Boolean);
          if (!env.VITE_SUPABASE_URL || !keys.length)
            throw new Error(
              "IDENTITY_INCOMPLETE: configuração pública obrigatória",
            );
          const identity = await readPublicStoreIdentity({
            supabaseUrl: env.VITE_SUPABASE_URL,
            publicKey: keys[0]!,
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
          },
        };
      } catch (error) {
        await dispose();
        throw error;
      }
    },
    async configResolved(config) {
      try {
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
