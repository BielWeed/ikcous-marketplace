// Quem entra na conta de "visitas da loja", e por qual canal -- a classificacao
// PURA que o porteiro usa na borda (spec "visitas da loja", 02/11/2026,
// decisao 3). Sem rede, sem relogio: so cabecalhos e URL entrando, uma classe
// saindo. O que dói aqui e' errar PARA CIMA (robo contado como pessoa infla o
// numero da lojista) ou PARA BAIXO (pessoa perdida), por isso os casos de
// borda: prefetch, navegador embutido do Instagram, revalidacao do service
// worker e hostnames que PARECEM os do Instagram/WhatsApp sem ser.
import { describe, expect, it } from "vitest";

import { classificarEntrada, ehPaginaContavel } from "@/hospedagem/contador";

const UA_CHROME =
  "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const UA_INSTAGRAM =
  "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 Instagram 330.0.0.40.97 Android";
const UA_WHATSAPP_ROBO = "WhatsApp/2.23.20.0 A";
const UA_ANTIGO =
  "Mozilla/5.0 (Windows NT 6.1; Trident/7.0; rv:11.0) like Gecko";

const NAVEGACAO = {
  "sec-fetch-mode": "navigate",
  "sec-fetch-dest": "document",
  "user-agent": UA_CHROME,
};

function entrada(
  url: string,
  cabecalhos: Record<string, string> = NAVEGACAO,
  metodo = "GET",
) {
  return classificarEntrada({
    metodo,
    url: new URL(url),
    cabecalhos: new Headers(cabecalhos),
  });
}

const LOJA = "https://loja-a.exemplo";

describe("classificarEntrada -- quem e' pessoa", () => {
  it("navegacao de documento aberta direto -> pessoa/direto", () => {
    expect(entrada(`${LOJA}/`)).toEqual({ tipo: "pessoa", canal: "direto" });
  });

  it("navegacao com dest=empty (o service worker revalida a pagina em segundo plano) -> pessoa", () => {
    expect(
      entrada(`${LOJA}/`, {
        "sec-fetch-mode": "navigate",
        "sec-fetch-dest": "empty",
        "user-agent": UA_CHROME,
      }),
    ).toEqual({ tipo: "pessoa", canal: "direto" });
  });

  it("instalacao do service worker (mode=cors, dest=empty) -> fora da conta", () => {
    expect(
      entrada(`${LOJA}/`, {
        "sec-fetch-mode": "cors",
        "sec-fetch-dest": "empty",
        "user-agent": UA_CHROME,
      }),
    ).toBeNull();
  });

  it("navegacao para iframe/objeto (dest que nao e' documento nem empty) -> fora da conta", () => {
    for (const dest of ["iframe", "frame", "object", "embed"])
      expect(
        entrada(`${LOJA}/`, { ...NAVEGACAO, "sec-fetch-dest": dest }),
      ).toBeNull();
  });

  it("navegador antigo (sem Sec-Fetch, Mozilla/ e Accept com text/html) -> pessoa", () => {
    expect(
      entrada(`${LOJA}/`, {
        "user-agent": UA_ANTIGO,
        accept: "text/html,application/xhtml+xml",
      }),
    ).toEqual({ tipo: "pessoa", canal: "direto" });
  });

  it("sem Sec-Fetch mas sem Accept de html, ou sem Mozilla/ -> fora da conta", () => {
    expect(
      entrada(`${LOJA}/`, { "user-agent": UA_ANTIGO, accept: "*/*" }),
    ).toBeNull();
    expect(
      entrada(`${LOJA}/`, { "user-agent": "Foo/1.0", accept: "text/html" }),
    ).toBeNull();
  });

  it("curl e monitores (sem Sec-Fetch, sem Mozilla/) -> fora da conta", () => {
    expect(
      entrada(`${LOJA}/`, { "user-agent": "curl/8.4.0", accept: "*/*" }),
    ).toBeNull();
    expect(entrada(`${LOJA}/`, {})).toBeNull();
  });

  it("HEAD e outros metodos nunca contam", () => {
    expect(entrada(`${LOJA}/`, NAVEGACAO, "HEAD")).toBeNull();
    expect(entrada(`${LOJA}/`, NAVEGACAO, "POST")).toBeNull();
  });
});

describe("classificarEntrada -- caminhos que nao sao pagina da loja", () => {
  it.each([
    "/assets/x.js",
    "/x.txt",
    "/api/x",
    "/api",
    "/.well-known/x",
    "/identidade.json",
    "/manifest.webmanifest",
    "/robots.txt",
    "/sitemap.xml",
    "/sw.js",
    "/pasta/foto.png",
    "/admin",
    "/admin/",
    "/admin/pedidos",
    "/admin-orders",
  ])("%s -> fora da conta", (caminho) => {
    expect(entrada(`${LOJA}${caminho}`)).toBeNull();
    expect(ehPaginaContavel("GET", new URL(`${LOJA}${caminho}`))).toBe(false);
  });

  it.each(["/", "/home", "/product-detail?id=1", "/produtos/", "/v1.2/oferta"])(
    "%s -> pagina da loja",
    (caminho) => {
      expect(ehPaginaContavel("GET", new URL(`${LOJA}${caminho}`))).toBe(true);
      expect(entrada(`${LOJA}${caminho}`)).not.toBeNull();
    },
  );

  it("o ponto de uma PASTA nao faz arquivo: so a extensao do ultimo trecho conta", () => {
    expect(entrada(`${LOJA}/v1.2/oferta`)).toEqual({
      tipo: "pessoa",
      canal: "direto",
    });
  });

  it("HEAD nao e' pagina contavel mesmo na raiz", () => {
    expect(ehPaginaContavel("HEAD", new URL(`${LOJA}/`))).toBe(false);
  });
});

describe("classificarEntrada -- robos e previas de link", () => {
  it("WhatsApp no UA SEM Sec-Fetch-Mode -> previa", () => {
    expect(
      entrada(`${LOJA}/`, { "user-agent": UA_WHATSAPP_ROBO, accept: "*/*" }),
    ).toEqual({ tipo: "previa" });
  });

  it("navegador embutido do Instagram com navigate -> pessoa/instagram, NAO previa", () => {
    expect(
      entrada(`${LOJA}/`, { ...NAVEGACAO, "user-agent": UA_INSTAGRAM }),
    ).toEqual({ tipo: "pessoa", canal: "instagram" });
  });

  it("navegador embutido do WhatsApp (com Sec-Fetch-Mode) -> pessoa/whatsapp, NAO previa", () => {
    expect(
      entrada(`${LOJA}/`, {
        ...NAVEGACAO,
        "user-agent": `${UA_CHROME} WhatsApp/2.24.1`,
      }),
    ).toEqual({ tipo: "pessoa", canal: "whatsapp" });
  });

  it.each([
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "facebookcatalog/1.0",
    "meta-externalagent/1.1",
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "LinkedInBot/1.0 (compatible; Mozilla/5.0; +https://www.linkedin.com)",
    "TelegramBot (like TwitterBot)",
    "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
    "Twitterbot/1.0",
    "Mozilla/5.0 (compatible; bingbot/2.0)",
    "Mozilla/5.0 (compatible; Yahoo! Slurp)",
    "Embedly/0.2",
    "Iframely/1.3.1",
    "Mozilla/5.0 Chrome-Lighthouse",
    "Mozilla/5.0 HeadlessChrome/120.0",
    "Mozilla/5.0 (compatible; SomeCrawler/1.0)",
    "Mozilla/5.0 (compatible; AhrefsSpider/7.0)",
    "SomePreviewFetcher/2",
  ])(
    "UA de robo inequivoco '%s' -> previa MESMO com Sec-Fetch de navegador",
    (ua) => {
      expect(entrada(`${LOJA}/`, { ...NAVEGACAO, "user-agent": ua })).toEqual({
        tipo: "previa",
      });
    },
  );

  it.each([
    ["sec-purpose", "prefetch"],
    ["sec-purpose", "prefetch;prerender"],
    ["purpose", "prefetch"],
    ["x-purpose", "preview"],
    ["sec-purpose", "Prefetch"],
  ])(
    "cabecalho %s: %s -> previa (o navegador pre-carrega, a pessoa ainda nao abriu)",
    (nome, valor) => {
      expect(entrada(`${LOJA}/`, { ...NAVEGACAO, [nome]: valor })).toEqual({
        tipo: "previa",
      });
    },
  );

  it("celular CUBOT (\"Android 11; CUBOT P50\") com navigate e' PESSOA: o `BOT` do modelo nao e' robo", () => {
    const ua =
      "Mozilla/5.0 (Linux; Android 11; CUBOT P50) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
    expect(entrada(`${LOJA}/`, { ...NAVEGACAO, "user-agent": ua })).toEqual({
      tipo: "pessoa",
      canal: "direto",
    });
  });

  it.each([
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "TelegramBot (like TwitterBot)",
    "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
    "Twitterbot/1.0",
    "LinkedInBot/1.0",
    "Mozilla/5.0 (compatible; bingbot/2.0)",
    "Mozilla/5.0 (compatible; YandexBot/3.0)",
    "Mozilla/5.0 (compatible; AhrefsBot/7.0)",
    "Mozilla/5.0 (compatible; GPTBot/1.0)",
  ])("robo que escreve Bot/bot ('%s') segue previa", (ua) => {
    expect(entrada(`${LOJA}/`, { ...NAVEGACAO, "user-agent": ua })).toEqual({
      tipo: "previa",
    });
  });

  it("robo sem user-agent e sem Sec-Fetch -> fora da conta (nem pessoa nem previa)", () => {
    expect(entrada(`${LOJA}/`, { accept: "text/html" })).toBeNull();
  });
});

describe("classificarEntrada -- o canal da pessoa", () => {
  it("?utm_source=whatsapp -> whatsapp", () => {
    expect(entrada(`${LOJA}/?utm_source=whatsapp`)).toEqual({
      tipo: "pessoa",
      canal: "whatsapp",
    });
  });

  it.each([
    ["utm_source=instagram", "instagram"],
    ["utm_source=ig", "instagram"],
    ["source=instagram", "instagram"],
    ["utm_source=WhatsApp", "whatsapp"],
    ["utm_source=wa", "whatsapp"],
    ["utm_source=wpp", "whatsapp"],
    ["utm_source=zap", "whatsapp"],
    ["source=whatsapp", "whatsapp"],
    ["source=pwa", "direto"],
    ["utm_source=%20PWA%20", "direto"],
  ])("?%s -> %s", (consulta, canal) => {
    expect(entrada(`${LOJA}/?${consulta}`)).toEqual({ tipo: "pessoa", canal });
  });

  it("o parametro vence o user-agent e o referer", () => {
    expect(
      entrada(`${LOJA}/?source=pwa`, {
        ...NAVEGACAO,
        "user-agent": UA_INSTAGRAM,
        referer: "https://l.instagram.com/",
      }),
    ).toEqual({ tipo: "pessoa", canal: "direto" });
    expect(
      entrada(`${LOJA}/?utm_source=whatsapp`, {
        ...NAVEGACAO,
        referer: "https://l.instagram.com/",
      }),
    ).toEqual({ tipo: "pessoa", canal: "whatsapp" });
  });

  it("utm_source tem prioridade sobre source quando os dois sao reconhecidos", () => {
    expect(entrada(`${LOJA}/?utm_source=instagram&source=pwa`)).toEqual({
      tipo: "pessoa",
      canal: "instagram",
    });
  });

  it("valor de campanha que nao e' canal nosso nao decide: cai no referer", () => {
    expect(
      entrada(`${LOJA}/?utm_source=newsletter`, {
        ...NAVEGACAO,
        referer: "https://www.google.com/",
      }),
    ).toEqual({ tipo: "pessoa", canal: "outros_sites" });
  });

  it("o user-agent embutido decide antes do referer", () => {
    expect(
      entrada(`${LOJA}/`, {
        ...NAVEGACAO,
        "user-agent": UA_INSTAGRAM,
        referer: "https://www.google.com/",
      }),
    ).toEqual({ tipo: "pessoa", canal: "instagram" });
  });

  it.each([
    ["https://l.instagram.com/?u=x", "instagram"],
    ["https://www.instagram.com/", "instagram"],
    ["https://instagram.com/", "instagram"],
    ["https://wa.me/5511999999999", "whatsapp"],
    ["https://web.whatsapp.com/", "whatsapp"],
    ["https://api.whatsapp.com/send", "whatsapp"],
    ["https://mmg.whatsapp.net/", "whatsapp"],
    ["https://www.google.com/search?q=loja", "outros_sites"],
    ["https://exemplo.org/blog", "outros_sites"],
  ])("referer %s -> %s", (referer, canal) => {
    expect(entrada(`${LOJA}/`, { ...NAVEGACAO, referer })).toEqual({
      tipo: "pessoa",
      canal,
    });
  });

  it("hostname que so PARECE o do Instagram/WhatsApp e' outro site", () => {
    for (const referer of [
      "https://evilinstagram.com/",
      "https://instagram.com.golpe.example/",
      "https://notwa.me/",
      "https://whatsapp.com.golpe.example/",
      "https://meuwhatsapp.net/",
    ])
      expect(entrada(`${LOJA}/`, { ...NAVEGACAO, referer })).toEqual({
        tipo: "pessoa",
        canal: "outros_sites",
      });
  });

  it("referer do mesmo host da loja (navegando dentro dela), ou sem referer -> direto", () => {
    expect(
      entrada(`${LOJA}/`, {
        ...NAVEGACAO,
        referer: "https://loja-a.exemplo/x",
      }),
    ).toEqual({ tipo: "pessoa", canal: "direto" });
    expect(
      entrada(`${LOJA}/`, {
        ...NAVEGACAO,
        referer: "https://LOJA-A.exemplo:8443/y",
      }),
    ).toEqual({ tipo: "pessoa", canal: "direto" });
    expect(entrada(`${LOJA}/`)).toEqual({ tipo: "pessoa", canal: "direto" });
  });

  it("referer invalido, vazio ou de esquema que nao e' web -> direto (na duvida, nao inventa um canal)", () => {
    for (const referer of [
      "isto nao e' uma url",
      "",
      "android-app://com.google.android.gm/",
    ])
      expect(entrada(`${LOJA}/`, { ...NAVEGACAO, referer })).toEqual({
        tipo: "pessoa",
        canal: "direto",
      });
  });

  it("a saida nunca carrega o hostname: so a classe", () => {
    const saida = entrada(`${LOJA}/`, {
      ...NAVEGACAO,
      referer: "https://um-site-qualquer.example/pagina?token=segredo",
    });
    expect(JSON.stringify(saida)).not.toContain("um-site-qualquer");
    expect(JSON.stringify(saida)).not.toContain("segredo");
  });
});
