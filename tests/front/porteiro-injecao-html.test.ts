// `injetarFichaNoHtml` é o que faz "host A e host B, mesmo HTML assado ->
// duas fichas diferentes, dois <style> diferentes, título diferente" (teste
// obrigatório 1 do brief T3) — aqui isolado da rede, só com HTML de entrada
// e a ficha já pronta (`montarFicha`, testado junto).
import { describe, expect, it } from "vitest";

import { injetarFichaNoHtml, montarFicha } from "@/hospedagem/porteiro";
import { parseStoreIdentity } from "@/lib/storeIdentity";
import type { PublicStoreIdentity } from "@/lib/storeIdentity";

// Constrói uma identidade que passa em `parseStoreIdentity` de verdade
// (mesma validação que `readPublicStoreIdentity` aplica em produção) — em
// vez de forjar o formato à mão, o que já quebrou uma vez aqui por
// `logo_url` não bater com a URL derivada do asset.
function identidadeFixture(
  storeName: string,
  primary: string,
  projectRef = "abcdefghijklmnopqrst",
): PublicStoreIdentity {
  const origin = `https://${projectRef}.supabase.co`;
  const hash = "a".repeat(64);
  const asset = (nome: string, largura: number, altura: number) => ({
    path: `v1/${hash}/${nome}.png`,
    sha256: hash,
    media_type: "image/png" as const,
    bytes: 100,
    width: largura,
    height: altura,
  });
  const header = asset("header", 64, 64);
  const branding_assets = {
    version: 1,
    originals: [header],
    header,
    loader: asset("loader", 64, 64),
    favicon: asset("favicon", 32, 32),
    apple_touch: asset("apple", 180, 180),
    icon_192: asset("icon192", 192, 192),
    icon_512: asset("icon512", 512, 512),
    maskable_512: asset("maskable", 512, 512),
    og: asset("og", 1200, 630),
  };
  return parseStoreIdentity(
    {
      store_name: storeName,
      store_city: "Fortaleza",
      store_state: "CE",
      logo_url: `${origin}/storage/v1/object/public/branding/${header.path}`,
      primary_color: primary,
      secondary_color: "#654321",
      accent_color: "#ABCDEF",
      branding_assets,
    },
    origin,
  );
}

// HTML "assado": já passou pelo build com a identidade da FIXTURE ("a loja
// de ninguém", T6) — placeholders de template já substituídos, exatamente
// como o self-fetch de `/index.html` encontraria em produção.
const HTML_ASSADO = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<title>Loja Fixture | Lugar Nenhum</title>
<meta name="description" content="Produtos e novidades de Loja Fixture" />
<meta name="theme-color" content="#000000" />
<meta property="og:title" content="Loja Fixture" />
<link rel="icon" type="image/png" href="/store-identity/fixture/favicon.png" />
<link rel="apple-touch-icon" href="/store-identity/fixture/apple.png" />
<link rel="preconnect" href="https://fixtureref.supabase.co" crossorigin />
<style id="dynamic-branding-style">:root {--primary-color:#000000;}</style>
</head>
<body>
<img src="/store-identity/fixture/loader.png" alt="Loja Fixture" class="guardian-logo" />
<div class="cinematic-text">Loja Fixture</div>
</body>
</html>`;

// HTML "assado" mais completo: além do que HTML_ASSADO já cobre, traz as
// metas `og:image`/`twitter:image` (achado 2a da revisão — `identityHtml`
// concatenava `publicUrl` na frente de `localUrls.og`, que no BUILD é
// caminho LOCAL mas no PORTEIRO é URL ABSOLUTA do Storage; concatenar as
// duas produz uma URL inválida, ex.:
// `https://loja-a.exemplohttps://<ref>.supabase.co/...`) e o `<img
// class="guardian-logo">` JÁ MATERIALIZADO pelo build com a logo da
// FIXTURE (achado 2b — o comentário `<!-- LOGO_START -->...<!-- LOGO_END
// -->` só existe no HTML cru do repositório; o que o self-fetch de
// `/index.html` encontra em produção é a tag já substituída).
const HTML_ASSADO_PRODUCAO = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<title>Loja Fixture | Lugar Nenhum</title>
<meta name="description" content="Produtos e novidades de Loja Fixture" />
<meta name="theme-color" content="#000000" />
<meta property="og:title" content="Loja Fixture" />
<meta property="og:image" content="https://ickous-marketplace.vercel.app/og-image.png" />
<meta name="twitter:image" content="https://ickous-marketplace.vercel.app/og-image.png" />
<link rel="icon" type="image/png" href="/store-identity/fixture/favicon.png" />
<link rel="apple-touch-icon" href="/store-identity/fixture/apple.png" />
<link rel="preconnect" href="https://fixtureref.supabase.co" crossorigin />
<style id="dynamic-branding-style">:root {--primary-color:#000000;}</style>
</head>
<body>
<img src="/store-identity/fixture/loader.png" alt="Loja Fixture" class="guardian-logo" />
<div class="cinematic-text">Loja Fixture</div>
</body>
</html>`;

describe("injetarFichaNoHtml sobre HTML de PRODUÇÃO (já assado + já materializado) — achado 2 da revisão", () => {
  it("og:image e twitter:image viram a URL ABSOLUTA do Storage, sem o publicUrl colado na frente", async () => {
    const identity = identidadeFixture("Loja A", "#111111");
    const ficha = await montarFicha({
      host: "loja-a.exemplo",
      identity,
      publicUrl: "https://loja-a.exemplo",
      conexao: {
        supabaseUrl: "https://projeto-a.supabase.co",
        publishableKey: "sb_publishable_a",
        origem: "projeto",
      },
      configuracao: {
        mpPublicKey: "TEST-00000000-0000-0000-0000-000000000000",
        vapidPublicKey: "BExampleVapidPublicKeyNaoUsadaNesteTeste",
        pagamentoOnline: true,
        manutencao: false,
      },
    });
    const html = injetarFichaNoHtml(HTML_ASSADO_PRODUCAO, ficha);

    // O valor certo é a URL do Storage tal como está em `identity.urls.og`
    // (já absoluta) — NUNCA duas origens coladas.
    expect(html).toContain(
      `<meta property="og:image" content="${identity.urls.og}" />`,
    );
    expect(html).toContain(
      `<meta name="twitter:image" content="${identity.urls.og}" />`,
    );
    expect(html).not.toContain("https://loja-a.exemplohttps://");
    expect(html).not.toContain(`https://loja-a.exemplo${identity.urls.og}`);
  });

  it('a logo JÁ MATERIALIZADA (<img class="guardian-logo">) é trocada pela da loja, não fica presa na fixture', async () => {
    const identity = identidadeFixture("Loja A", "#111111");
    const ficha = await montarFicha({
      host: "loja-a.exemplo",
      identity,
      publicUrl: "https://loja-a.exemplo",
      conexao: {
        supabaseUrl: "https://projeto-a.supabase.co",
        publishableKey: "sb_publishable_a",
        origem: "projeto",
      },
      configuracao: {
        mpPublicKey: "TEST-00000000-0000-0000-0000-000000000000",
        vapidPublicKey: "BExampleVapidPublicKeyNaoUsadaNesteTeste",
        pagamentoOnline: true,
        manutencao: false,
      },
    });
    const html = injetarFichaNoHtml(HTML_ASSADO_PRODUCAO, ficha);

    // A tag some da fixture e vira a da loja — src e alt certos.
    expect(html).not.toContain("/store-identity/fixture/loader.png");
    expect(html).not.toContain('alt="Loja Fixture"');
    expect(html).toContain(
      `<img src="${identity.urls.loader}" alt="Loja A" class="guardian-logo" />`,
    );
    // Continua existindo exatamente UMA tag `guardian-logo` — nem sumiu,
    // nem duplicou.
    const ocorrencias = html.match(/class="guardian-logo"/g) ?? [];
    expect(ocorrencias.length).toBe(1);
  });
});

describe("montarFicha + injetarFichaNoHtml — host A e host B nunca produzem o mesmo HTML", () => {
  it("duas fichas diferentes viram dois <style>, dois títulos e dois data blocks diferentes", async () => {
    const fichaA = await montarFicha({
      host: "loja-a.exemplo",
      identity: identidadeFixture("Loja A", "#111111"),
      publicUrl: "https://loja-a.exemplo",
      conexao: {
        supabaseUrl: "https://projeto-a.supabase.co",
        publishableKey: "sb_publishable_a",
        origem: "projeto",
      },
      configuracao: {
        mpPublicKey: "TEST-00000000-0000-0000-0000-000000000000",
        vapidPublicKey: "BExampleVapidPublicKeyNaoUsadaNesteTeste",
        pagamentoOnline: true,
        manutencao: false,
      },
    });
    const fichaB = await montarFicha({
      host: "loja-b.exemplo",
      identity: identidadeFixture("Loja B", "#222222"),
      publicUrl: "https://loja-b.exemplo",
      conexao: {
        supabaseUrl: "https://projeto-b.supabase.co",
        publishableKey: "sb_publishable_b",
        origem: "projeto",
      },
      configuracao: {
        mpPublicKey: "TEST-00000000-0000-0000-0000-000000000000",
        vapidPublicKey: "BExampleVapidPublicKeyNaoUsadaNesteTeste",
        pagamentoOnline: true,
        manutencao: false,
      },
    });

    const htmlA = injetarFichaNoHtml(HTML_ASSADO, fichaA);
    const htmlB = injetarFichaNoHtml(HTML_ASSADO, fichaB);

    expect(htmlA).not.toBe(htmlB);
    expect(htmlA).toContain("<title>Loja A | Fortaleza, CE</title>");
    expect(htmlB).toContain("<title>Loja B | Fortaleza, CE</title>");
    expect(htmlA).toContain("--primary-color:#111111");
    expect(htmlB).toContain("--primary-color:#222222");

    // Só UM <style id="dynamic-branding-style"> sobrevive por HTML — o
    // assado (fixture, "#000000") foi substituído, não duplicado.
    const stylesA = htmlA.match(/<style id="dynamic-branding-style">/g) ?? [];
    const stylesB = htmlB.match(/<style id="dynamic-branding-style">/g) ?? [];
    expect(stylesA.length).toBe(1);
    expect(stylesB.length).toBe(1);
    expect(htmlA).not.toContain("#000000");
    expect(htmlB).not.toContain("#000000");

    // Cada HTML carrega a ficha DA SUA PRÓPRIA loja no data block — nunca a
    // da outra (é o mesmo cruzamento que `decidirConcordancia` protege,
    // agora visto do lado do HTML final).
    const idA = htmlA.match(
      /<script type="application\/json" id="ikcous-loja">([\s\S]*?)<\/script>/,
    );
    const idB = htmlB.match(
      /<script type="application\/json" id="ikcous-loja">([\s\S]*?)<\/script>/,
    );
    expect(idA).not.toBeNull();
    expect(idB).not.toBeNull();
    const dadosA = JSON.parse(idA![1]);
    const dadosB = JSON.parse(idB![1]);
    expect(dadosA.host).toBe("loja-a.exemplo");
    expect(dadosB.host).toBe("loja-b.exemplo");
    expect(dadosA.conexao.supabaseUrl).toBe("https://projeto-a.supabase.co");
    expect(dadosB.conexao.supabaseUrl).toBe("https://projeto-b.supabase.co");
    expect(htmlA).not.toContain("projeto-b.supabase.co");
    expect(htmlB).not.toContain("projeto-a.supabase.co");
  });

  it("o data block entra logo depois de <head>, antes do <style>", async () => {
    const ficha = await montarFicha({
      host: "loja-a.exemplo",
      identity: identidadeFixture("Loja A", "#111111"),
      publicUrl: "https://loja-a.exemplo",
      conexao: {
        supabaseUrl: "https://projeto-a.supabase.co",
        publishableKey: "sb_publishable_a",
        origem: "projeto",
      },
      configuracao: {
        mpPublicKey: "TEST-00000000-0000-0000-0000-000000000000",
        vapidPublicKey: "BExampleVapidPublicKeyNaoUsadaNesteTeste",
        pagamentoOnline: true,
        manutencao: false,
      },
    });
    const html = injetarFichaNoHtml(HTML_ASSADO, ficha);
    const posicaoHead = html.indexOf("<head>");
    const posicaoDataBlock = html.indexOf('id="ikcous-loja"');
    const posicaoStyle = html.indexOf('id="dynamic-branding-style"');
    expect(posicaoHead).toBeGreaterThanOrEqual(0);
    expect(posicaoDataBlock).toBeGreaterThan(posicaoHead);
    expect(posicaoStyle).toBeGreaterThan(posicaoDataBlock);
  });

  it("host lowercased na ficha, mesmo se o Host chegar com maiúsculas", async () => {
    const ficha = await montarFicha({
      host: "Loja-A.Exemplo",
      identity: identidadeFixture("Loja A", "#111111"),
      publicUrl: "https://loja-a.exemplo",
      conexao: {
        supabaseUrl: "https://projeto-a.supabase.co",
        publishableKey: "sb_publishable_a",
        origem: "projeto",
      },
      configuracao: {
        mpPublicKey: "TEST-00000000-0000-0000-0000-000000000000",
        vapidPublicKey: "BExampleVapidPublicKeyNaoUsadaNesteTeste",
        pagamentoOnline: true,
        manutencao: false,
      },
    });
    expect(ficha.host).toBe("loja-a.exemplo");
  });
});
