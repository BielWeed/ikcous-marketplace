// Caça por mutação (25/11/2026) em `src/config/identidadeNoHtml.ts`: a função
// que pinta a identidade de UMA loja num HTML (título, metas do compartilhamento
// e do navegador, ícones, logo da tela de carregamento e o estilo anti-flash).
// Os testes vizinhos (`identity-build-*`, `porteiro-injecao-html`) conferem que
// a loja certa aparece; aqui cada tag é conferida pelo valor EXATO, porque um
// defeito de uma linha (cor errada no `theme-color`, `og:title` com a cidade,
// `og:url` sem a barra, alfa trocado no brilho do fundo) passava sem ninguém ver.
// O HTML de entrada é montado à mão, com valores velhos que NENHUM resultado
// esperado repete — o que sobrar do velho no resultado é defeito.
import { describe, expect, it } from "vitest";

import { escapeHtml, identityHtml } from "@/config/identidadeNoHtml";
import { parseStoreIdentity } from "@/lib/storeIdentity";

const SUPABASE_URL = "https://abcdefghijklmnopqrst.supabase.co";
const HASH = "a".repeat(64);
const PUBLICA = "https://loja-a.exemplo.com";

function asset(
  name: string,
  mediaType: string,
  width?: number,
  height?: number,
) {
  return {
    path: `v1/${HASH}/${name}`,
    sha256: HASH,
    media_type: mediaType,
    bytes: 100,
    ...(width === undefined ? {} : { width, height }),
  };
}

function identidade(
  opcoes: {
    nome?: string;
    cidade?: string | null;
    estado?: string | null;
  } = {},
) {
  const header = asset("header.png", "image/png");
  return parseStoreIdentity(
    {
      store_name: opcoes.nome ?? "Doces da Vovó Maria",
      store_city: opcoes.cidade === undefined ? "Sao Paulo" : opcoes.cidade,
      store_state: opcoes.estado === undefined ? "sp" : opcoes.estado,
      primary_color: "#123456",
      secondary_color: "#abcdef",
      accent_color: "#fedcba",
      logo_url: `${SUPABASE_URL}/storage/v1/object/public/branding/${header.path}`,
      branding_assets: {
        version: 1,
        originals: [header],
        header,
        loader: header,
        favicon: asset("favicon.svg", "image/svg+xml"),
        apple_touch: asset("apple.png", "image/png", 180, 180),
        icon_192: asset("icon192.png", "image/png", 192, 192),
        icon_512: asset("icon512.png", "image/png", 512, 512),
        maskable_512: asset("maskable.png", "image/png", 512, 512),
        og: asset("og.png", "image/png", 1200, 630),
      },
    },
    SUPABASE_URL,
  );
}

// Caminhos locais, como no BUILD (o prefixo da loja entra só no og:image).
const LOCAIS = {
  originals: [],
  header: "/store-identity/header.png",
  loader: "/store-identity/loader.png",
  favicon: "/store-identity/favicon.png",
  apple_touch: "/store-identity/apple.png",
  icon_192: "/store-identity/i192.png",
  icon_512: "/store-identity/i512.png",
  maskable_512: "/store-identity/mask.png",
  og: "/store-identity/og.png",
};

const meta = (tipo: "name" | "property", nome: string, conteudo: string) =>
  `<meta ${tipo}="${nome}" content="${conteudo}" />`;

// HTML assado do build, todo com valores "velhos".
const HTML_VELHO = [
  "<!doctype html><html><head>",
  "<title>Velho</title>",
  meta("name", "description", "velho"),
  meta("name", "theme-color", "#000001"),
  meta("name", "background-color", "#000002"),
  meta("name", "application-name", "velho"),
  meta("name", "apple-mobile-web-app-title", "velho"),
  meta("property", "og:title", "velho"),
  meta("property", "og:description", "velho"),
  meta("property", "og:url", "velho"),
  meta("property", "og:image", "velho"),
  meta("property", "og:image:type", "velho"),
  meta("name", "twitter:title", "velho"),
  meta("name", "twitter:description", "velho"),
  meta("name", "twitter:image", "velho"),
  meta("name", "viewport", "width=device-width"),
  '<link rel="icon" type="image/x-velho" href="/velho.ico" />',
  '<link rel="apple-touch-icon" href="/velho-apple.png" />',
  '<link rel="preconnect" href="https://velho.supabase.co" crossorigin />',
  "</head><body>",
  '<!-- LOGO_START --><img src="/velho-logo.png" alt="velho" /><!-- LOGO_END -->',
  '<div class="cinematic-text">Velho</div>',
  "</body></html>",
].join("\n");

function pintar(
  opcoes: Parameters<typeof identidade>[0] = {},
  html = HTML_VELHO,
  localUrls: Record<string, unknown> = LOCAIS,
) {
  return identityHtml(html, {
    identity: identidade(opcoes),
    localUrls: localUrls as ReturnType<typeof identidade>["urls"],
    publicUrl: PUBLICA,
  });
}

describe("escapeHtml — os cinco caracteres, e o '&' primeiro", () => {
  it("troca & < > aspas e apóstrofo pelos códigos, uma vez só", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });

  it("não escapa duas vezes: o '&' do código que acabou de entrar não vira '&amp;'", () => {
    expect(escapeHtml("<")).toBe("&lt;");
    expect(escapeHtml("a & b")).toBe("a &amp; b");
  });
});

describe("identityHtml — título e metas pelo valor exato", () => {
  const saida = pintar();

  it("título com nome, barra e cidade, UF em maiúsculas", () => {
    expect(saida).toContain(
      "<title>Doces da Vovó Maria | Sao Paulo, SP</title>",
    );
    expect(saida).not.toContain("Velho</title>");
  });

  it("descrição de busca e do compartilhamento levam o nome da loja", () => {
    const texto = "Produtos e novidades de Doces da Vovó Maria";
    expect(saida).toContain(meta("name", "description", texto));
    expect(saida).toContain(meta("property", "og:description", texto));
    expect(saida).toContain(meta("name", "twitter:description", texto));
  });

  it("theme-color e background-color são a cor PRIMÁRIA", () => {
    expect(saida).toContain(meta("name", "theme-color", "#123456"));
    expect(saida).toContain(meta("name", "background-color", "#123456"));
  });

  it("application-name é o nome inteiro; o rótulo do iPhone é o nome curto", () => {
    expect(saida).toContain(
      meta("name", "application-name", "Doces da Vovó Maria"),
    );
    expect(saida).toContain(
      meta("name", "apple-mobile-web-app-title", "Doces"),
    );
  });

  it("og:title e twitter:title são o nome da loja, sem a cidade", () => {
    expect(saida).toContain(
      meta("property", "og:title", "Doces da Vovó Maria"),
    );
    expect(saida).toContain(
      meta("name", "twitter:title", "Doces da Vovó Maria"),
    );
  });

  it("og:url é o endereço público COM a barra final", () => {
    expect(saida).toContain(meta("property", "og:url", `${PUBLICA}/`));
  });

  it("imagem de compartilhamento: caminho local ganha o endereço público; o tipo vem da imagem og (PNG), não do ícone da aba (SVG)", () => {
    const imagem = `${PUBLICA}/store-identity/og.png`;
    expect(saida).toContain(meta("property", "og:image", imagem));
    expect(saida).toContain(meta("name", "twitter:image", imagem));
    expect(saida).toContain(meta("property", "og:image:type", "image/png"));
  });

  it("imagem de compartilhamento que já é endereço absoluto (porteiro) entra crua, sem prefixo", () => {
    const absoluta = "https://abcdefghijklmnopqrst.supabase.co/x/og.png";
    const pronta = pintar({}, HTML_VELHO, { ...LOCAIS, og: absoluta });
    expect(pronta).toContain(meta("property", "og:image", absoluta));
    expect(pronta).toContain(meta("name", "twitter:image", absoluta));
  });

  it("meta que a loja não decide (viewport) fica exatamente como estava", () => {
    expect(saida).toContain(meta("name", "viewport", "width=device-width"));
  });
});

describe("identityHtml — o lugar no título", () => {
  it("só o estado: 'Nome | SP' (sem vírgula sobrando)", () => {
    expect(pintar({ cidade: null })).toContain(
      "<title>Doces da Vovó Maria | SP</title>",
    );
  });

  it("só a cidade: 'Nome | Sao Paulo'", () => {
    expect(pintar({ estado: null })).toContain(
      "<title>Doces da Vovó Maria | Sao Paulo</title>",
    );
  });

  it("sem cidade nem estado: só o nome, sem a barra", () => {
    expect(pintar({ cidade: null, estado: null })).toContain(
      "<title>Doces da Vovó Maria</title>",
    );
  });
});

describe("identityHtml — ícones, preconnect e a tela de carregamento", () => {
  const saida = pintar();

  it("ícone da aba: tipo da imagem da loja e endereço como veio (não ganha prefixo)", () => {
    expect(saida).toContain(
      '<link rel="icon" type="image/svg+xml" href="/store-identity/favicon.png" />',
    );
  });

  it("ícone do iPhone usa a imagem apple_touch", () => {
    expect(saida).toContain(
      '<link rel="apple-touch-icon" href="/store-identity/apple.png" />',
    );
  });

  it("preconnect aponta para o projeto da loja", () => {
    expect(saida).toContain(
      '<link rel="preconnect" href="https://abcdefghijklmnopqrst.supabase.co" crossorigin />',
    );
    expect(saida).not.toContain("velho.supabase");
  });

  it("logo da carga: só o PRIMEIRO bloco LOGO_START/END é trocado; o que está entre blocos fica", () => {
    const html = [
      "<head></head><body>",
      "<!-- LOGO_START -->velho-1<!-- LOGO_END -->",
      "ENTRE-OS-BLOCOS",
      "<!-- LOGO_START -->velho-2<!-- LOGO_END -->",
      "</body>",
    ].join("");
    const pronta = pintar({}, html);
    expect(pronta).toContain(
      '<img src="/store-identity/loader.png" alt="Doces da Vovó Maria" class="guardian-logo" />ENTRE-OS-BLOCOS',
    );
  });

  it("HTML já assado (a logo virou <img class=guardian-logo>): o porteiro troca pela logo da loja", () => {
    const html =
      '<head></head><body><img src="/outra-loja.png" alt="Outra" class="guardian-logo" /></body>';
    expect(pintar({}, html)).toContain(
      '<img src="/store-identity/loader.png" alt="Doces da Vovó Maria" class="guardian-logo" />',
    );
  });

  it("texto da tela de carregamento: o nome da loja, também quando o texto velho está vazio", () => {
    expect(pintar()).toContain(
      '<div class="cinematic-text">Doces da Vovó Maria</div>',
    );
    const vazio = pintar(
      {},
      '<head></head><body><div class="cinematic-text"></div></body>',
    );
    expect(vazio).toContain(
      '<div class="cinematic-text">Doces da Vovó Maria</div>',
    );
  });
});

describe("identityHtml — o estilo anti-flash com as cores da loja", () => {
  it("entra logo depois do <head>, com o id certo e cada cor no seu lugar", () => {
    const saida = pintar();
    const estilo =
      '<style id="dynamic-branding-style">:root {--primary-color:#123456;--secondary-color:#ABCDEF;--accent-color:#FEDCBA;--orb-1-color:rgba(18, 52, 86, 0.25);--orb-2-color:rgba(171, 205, 239, 0.20);--orb-3-color:rgba(254, 220, 186, 0.20);--progress-track-color:rgba(18, 52, 86, 0.15);}</style>';
    expect(saida).toContain(`<head>${estilo}\n<title>`);
  });
});

describe("identityHtml — nome com caracteres de HTML nunca vira tag", () => {
  const NOME = `A&B <Doces> "x" 'y'`;
  const saida = pintar({ nome: NOME });

  it("título, metas, texto alternativo da logo e texto da carga saem escapados", () => {
    const seguro = "A&amp;B &lt;Doces&gt; &quot;x&quot; &#39;y&#39;";
    expect(saida).toContain(`<title>${seguro} | Sao Paulo, SP</title>`);
    expect(saida).toContain(meta("property", "og:title", seguro));
    expect(saida).toContain(meta("name", "application-name", seguro));
    expect(saida).toContain(`alt="${seguro}" class="guardian-logo"`);
    expect(saida).toContain(`<div class="cinematic-text">${seguro}</div>`);
  });

  it("nenhum '<Doces>' cru sobrou no HTML", () => {
    expect(saida).not.toContain("<Doces>");
  });
});
