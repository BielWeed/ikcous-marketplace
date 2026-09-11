import type { PublicStoreIdentity } from "../lib/storeIdentity";

/**
 * A parte PURA de `identityHtml` que pinta a identidade de uma loja num HTML
 * já montado (título, metas, ícones, o `<style id="dynamic-branding-style">`
 * do anti-flash). Extraída de `scripts/identityBuildConfig.ts:57-124`
 * (etapa 2 da escala, 11/09/2026) para ter UM só lugar que decide como a
 * identidade vira HTML — o build chama isto durante o `transformIndexHtml`
 * (o `<head>` ainda tem os placeholders originais), e o porteiro
 * (`src/hospedagem/porteiro.ts`) chama a MESMA função em tempo real sobre o
 * HTML já assado, para trocar a identidade de build (a fixture, "a loja de
 * ninguém") pela da loja que o host pediu.
 *
 * Continua exigindo os mesmos 122 casos de `tests/front/identity-build-*`
 * passando sem mudança — a extração não pode alterar o resultado.
 */

export interface IdentidadeParaHtml {
  readonly identity: PublicStoreIdentity;
  readonly localUrls: PublicStoreIdentity["urls"];
  readonly publicUrl: string;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function identityHtml(
  html: string,
  snapshot: IdentidadeParaHtml,
): string {
  const { identity, localUrls, publicUrl } = snapshot;
  // No BUILD, `localUrls` é caminho LOCAL (`/store-identity/<path>`,
  // `scripts/prepareIdentity.ts:394`) e precisa do `publicUrl` na frente
  // para virar URL absoluta na meta tag. No PORTEIRO
  // (`src/hospedagem/porteiro.ts`, tempo real), `localUrls` = `identity.urls`
  // do banco, JÁ absolutas (`https://<ref>.supabase.co/storage/...`,
  // `src/lib/storeIdentity.ts:254-255`) — prefixar de novo colaria duas
  // origens na mesma string e produziria uma URL inválida. Só prefixa
  // quando o caminho é relativo (começa com "/"); URL absoluta entra crua.
  const resolveAssetUrl = (caminho: string) =>
    caminho.startsWith("/") ? `${publicUrl}${caminho}` : caminho;
  const description = `Produtos e novidades de ${identity.storeName}`;
  const place = [identity.city, identity.state].filter(Boolean).join(", ");
  const title = `${identity.storeName}${place ? ` | ${place}` : ""}`;
  const ogImage = resolveAssetUrl(localUrls.og);
  const meta = new Map([
    ["description", description],
    ["theme-color", identity.theme.primary],
    ["background-color", identity.theme.primary],
    ["application-name", identity.storeName],
    ["apple-mobile-web-app-title", identity.storeName],
    ["og:title", identity.storeName],
    ["og:description", description],
    ["og:url", `${publicUrl}/`],
    ["og:image", ogImage],
    ["og:image:type", identity.assets.og.media_type],
    ["twitter:title", identity.storeName],
    ["twitter:description", description],
    ["twitter:image", ogImage],
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
    // O porteiro chama esta função sobre HTML JÁ ASSADO pelo build — o
    // comentário LOGO_START/LOGO_END acima já foi consumido na PRIMEIRA
    // passagem (a do build) e virou este `<img class="guardian-logo">`; o
    // replace acima é NO-OP nesse caso, porque não há mais comentário para
    // casar. Sem este segundo replace, a logo da tela de carregamento
    // continuaria sendo a da identidade anterior (a fixture, "a loja de
    // ninguém") em toda requisição do porteiro. No caminho do BUILD (onde o
    // replace acima JÁ substituiu o comentário), este regex casa a tag
    // recém-criada e a substitui de novo pelos MESMOS valores — sem efeito
    // visível, mantendo os 122 casos `identity-build-*` idênticos.
    .replace(
      /<img[^>]*class="guardian-logo"[^>]*\/?>/,
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
