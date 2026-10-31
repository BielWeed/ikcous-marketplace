// Cartaz pre-impresso (lote B): a parte PURA -- escolher o banner do topo,
// validar a URL que a lojista escreveu, montar o trecho de HTML e decidir
// ONDE ele entra. Aqui mora a defesa contra injecao: a URL da foto sai de
// dado escrito pela lojista e vai parar no HTML de TODAS as lojas.
import { describe, expect, it } from "vitest";

import { escapeHtml } from "@/config/identidadeNoHtml";
import {
  ID_DO_CARTAZ,
  MARGEM_DO_FIM_MS,
  escolherBannerDoTopo,
  injetarCartazNoHtml,
  lojaRedimensionaFoto,
  montarCartaz,
  pedidoPodeTerCartaz,
} from "@/hospedagem/cartaz";
import { atributosDeImagem } from "@/lib/imageUrl";
import { IMAGEM_DO_BANNER } from "@/lib/imagem-do-banner";

const LOJA = "https://lojaaaaaaaaaaaaaaaaa.supabase.co";
const FOTO = `${LOJA}/storage/v1/object/public/banners/1791565996435-7tdkqgfb019.webp`;
const AGORA = Date.parse("2026-10-31T12:00:00Z");

/** O que o navegador faz com os atributos: desfaz o escape de `&`. */
function decodificar(html: string): string {
  return html.replaceAll("&amp;", "&");
}

function linha(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "b1",
    image_url: FOTO,
    position: "home_top",
    active: true,
    order: 1,
    title: "",
    subtitle: "",
    button_text: "",
    badge_text: "",
    template_type: "default",
    show_text_overlay: true,
    start_date: null,
    end_date: null,
    ...extra,
  };
}

const NAVEGADOR = {
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
};

function pode(
  caminho: string,
  cabecalhos: Record<string, string> = NAVEGADOR,
): boolean {
  return pedidoPodeTerCartaz(
    new URL(`https://loja-a.exemplo${caminho}`),
    new Headers(cabecalhos),
  );
}

describe("pedidoPodeTerCartaz -- so a 1a abertura da vitrine pelo navegador", () => {
  it("navegador abrindo `/` e `/home` (com ou sem barra final)", () => {
    expect(pode("/")).toBe(true);
    expect(pode("/home")).toBe(true);
    expect(pode("/home/")).toBe(true);
  });
  it("so parametros de campanha", () => {
    expect(pode("/?source=pwa")).toBe(true);
    expect(pode("/?utm_source=ig&utm_medium=bio&fbclid=abc&gclid=x")).toBe(
      true,
    );
  });
  it("categoria, busca, id ou qualquer outro parametro mudam a vitrine: sem cartaz", () => {
    expect(pode("/?category=Bebidas")).toBe(false);
    expect(pode("/?search=bolsa")).toBe(false);
    expect(pode("/?id=123")).toBe(false);
    expect(pode("/?source=pwa&category=x")).toBe(false);
    expect(pode("/?qualquer=1")).toBe(false);
    expect(pode("/?utmx=1")).toBe(false);
  });
  it("outras rotas nao tem o banner do topo na tela", () => {
    for (const caminho of [
      "/product-detail",
      "/cart",
      "/orders",
      "/admin",
      "/homes",
      "/home/x",
      "/a/home",
    ])
      expect(pode(caminho)).toBe(false);
  });
  it("sem os cabecalhos Sec-Fetch (navegador antigo, robo, curl): sem cartaz", () => {
    expect(pode("/", {})).toBe(false);
    expect(pode("/", { "sec-fetch-mode": "navigate" })).toBe(false);
    expect(pode("/", { "sec-fetch-dest": "document" })).toBe(false);
  });
  it("revalidacao e instalacao do service worker (dest=empty) nunca recebem cartaz", () => {
    // Medido no Chrome: a revalidacao tem mode=navigate mas dest=empty; a
    // instalacao tem mode=cors e dest=empty. So o `dest` separa.
    expect(
      pode("/", { "sec-fetch-dest": "empty", "sec-fetch-mode": "navigate" }),
    ).toBe(false);
    expect(
      pode("/", { "sec-fetch-dest": "empty", "sec-fetch-mode": "cors" }),
    ).toBe(false);
    expect(
      pode("/", { "sec-fetch-dest": "document", "sec-fetch-mode": "cors" }),
    ).toBe(false);
  });
  it("outros destinos (iframe, imagem, script) nao recebem", () => {
    for (const dest of [
      "iframe",
      "frame",
      "image",
      "script",
      "worker",
      "serviceworker",
      "style",
      "",
    ])
      expect(pode("/", { ...NAVEGADOR, "sec-fetch-dest": dest })).toBe(false);
  });
  it("Save-Data ligado: sem cartaz", () => {
    expect(pode("/", { ...NAVEGADOR, "save-data": "on" })).toBe(false);
    expect(pode("/", { ...NAVEGADOR, "save-data": " ON " })).toBe(false);
    expect(pode("/", { ...NAVEGADOR, "save-data": "off" })).toBe(true);
  });
});

describe("lojaRedimensionaFoto -- decidido pela origem, antes de ler banner", () => {
  it("loja comum redimensiona", () => {
    expect(lojaRedimensionaFoto(LOJA)).toBe(true);
  });
  it("IKCOUS (sem redimensionamento) nao", () => {
    expect(
      lojaRedimensionaFoto("https://cafkrminfnokvgjqtkle.supabase.co"),
    ).toBe(false);
  });
  it("origem que nao e https puro nao", () => {
    for (const url of [
      "http://lojaaaaaaaaaaaaaaaaa.supabase.co",
      "lixo",
      "",
      `${LOJA}:8443`,
      `${LOJA}/x`,
      `${LOJA}?a=1`,
    ])
      expect(lojaRedimensionaFoto(url)).toBe(false);
  });
});

describe("escolherBannerDoTopo -- quem aparece no topo", () => {
  it("devolve o unico banner ativo do topo", () => {
    expect(escolherBannerDoTopo([linha()], AGORA)?.id).toBe("b1");
  });
  it("entrada que nao e lista, lista vazia ou lixo: nada", () => {
    expect(escolherBannerDoTopo(null, AGORA)).toBeNull();
    expect(escolherBannerDoTopo({}, AGORA)).toBeNull();
    expect(escolherBannerDoTopo([], AGORA)).toBeNull();
    expect(escolherBannerDoTopo([null, 3, "x"], AGORA)).toBeNull();
  });
  it("banner inativo nao tem cartaz", () => {
    expect(escolherBannerDoTopo([linha({ active: false })], AGORA)).toBeNull();
  });
  it("coluna antiga `ativo` vale como o app a le", () => {
    const antiga = linha({ ativo: false });
    antiga.active = undefined;
    expect(escolherBannerDoTopo([antiga], AGORA)).toBeNull();
  });
  it("posicao que nao e a do topo nao tem cartaz", () => {
    expect(
      escolherBannerDoTopo([linha({ position: "home_middle" })], AGORA),
    ).toBeNull();
    expect(
      escolherBannerDoTopo([linha({ position: "home_bottom" })], AGORA),
    ).toBeNull();
  });
  it("agendado (ainda nao comecou) nao tem cartaz", () => {
    expect(
      escolherBannerDoTopo(
        [linha({ start_date: "2026-11-01T00:00:00Z" })],
        AGORA,
      ),
    ).toBeNull();
  });
  it("expirado nao tem cartaz", () => {
    expect(
      escolherBannerDoTopo(
        [linha({ end_date: "2026-10-30T00:00:00Z" })],
        AGORA,
      ),
    ).toBeNull();
  });
  it("dentro da janela tem cartaz", () => {
    expect(
      escolherBannerDoTopo(
        [
          linha({
            start_date: "2026-10-01T00:00:00Z",
            end_date: "2026-12-01T00:00:00Z",
          }),
        ],
        AGORA,
      )?.id,
    ).toBe("b1");
  });
  it("prestes a expirar (dentro da margem): o app pode tira-lo antes de pintar, sem cartaz", () => {
    const fim = new Date(AGORA + MARGEM_DO_FIM_MS - 1000).toISOString();
    expect(escolherBannerDoTopo([linha({ end_date: fim })], AGORA)).toBeNull();
  });
  it("prestes a comecar (dentro da margem): pode virar o primeiro, sem cartaz", () => {
    const inicio = new Date(AGORA + MARGEM_DO_FIM_MS - 1000).toISOString();
    expect(
      escolherBannerDoTopo([linha({ start_date: inicio })], AGORA),
    ).toBeNull();
  });
  it("data ilegivel: na duvida, nada (o app trata data ruim como 'dentro')", () => {
    expect(
      escolherBannerDoTopo([linha({ start_date: "ontem" })], AGORA),
    ).toBeNull();
    expect(
      escolherBannerDoTopo([linha({ end_date: "amanha" })], AGORA),
    ).toBeNull();
  });
  it("escolhe o de menor `order`", () => {
    const lista = [
      linha({ id: "b2", order: 5 }),
      linha({ id: "b1", order: 1 }),
    ];
    expect(escolherBannerDoTopo(lista, AGORA)?.id).toBe("b1");
  });
  it("empate de `order` entre os dois primeiros: o app pode escolher o outro, sem cartaz", () => {
    const lista = [
      linha({ id: "b1", order: 0 }),
      linha({ id: "b2", order: 0 }),
    ];
    expect(escolherBannerDoTopo(lista, AGORA)).toBeNull();
  });
  it("order ausente conta como 0, como no app", () => {
    const semOrder = linha({ id: "b2" });
    semOrder.order = undefined;
    const lista = [linha({ id: "b1", order: 3 }), semOrder];
    expect(escolherBannerDoTopo(lista, AGORA)?.id).toBe("b2");
  });
  it("banner sem foto nao conta (o app descarta antes de filtrar)", () => {
    expect(escolherBannerDoTopo([linha({ image_url: "" })], AGORA)).toBeNull();
    const [soAntiga] = [linha({ image_url: undefined, imagem_url: FOTO })];
    expect(escolherBannerDoTopo([soAntiga], AGORA)?.id).toBe("b1");
  });
  it("o primeiro precisa estar bom: nao 'cai' para o segundo", () => {
    const lista = [
      linha({ id: "b1", order: 1, active: false }),
      linha({ id: "b2", order: 2 }),
    ];
    // b1 inativo some do app; b2 e o primeiro de fato.
    expect(escolherBannerDoTopo(lista, AGORA)?.id).toBe("b2");
  });
  it("o primeiro ja venceu: sai da fila e o segundo e o do topo (a janela e avaliada por banner)", () => {
    const lista = [
      linha({ id: "b1", order: 1, end_date: "2026-10-30T00:00:00Z" }),
      linha({ id: "b2", order: 2 }),
    ];
    expect(escolherBannerDoTopo(lista, AGORA)?.id).toBe("b2");
  });
  it("o primeiro so comeca daqui a dias: o segundo e o do topo agora", () => {
    const lista = [
      linha({ id: "b1", order: 1, start_date: "2026-11-05T00:00:00Z" }),
      linha({ id: "b2", order: 2 }),
    ];
    expect(escolherBannerDoTopo(lista, AGORA)?.id).toBe("b2");
  });
  it("o primeiro comeca DENTRO da margem e ha um segundo: o app pode trocar de capa antes de pintar, sem cartaz", () => {
    const inicio = new Date(AGORA + MARGEM_DO_FIM_MS - 1000).toISOString();
    const lista = [
      linha({ id: "b1", order: 1, start_date: inicio }),
      linha({ id: "b2", order: 2 }),
    ];
    expect(escolherBannerDoTopo(lista, AGORA)).toBeNull();
  });
  it("o primeiro expira DENTRO da margem e ha um segundo: idem", () => {
    const fim = new Date(AGORA + MARGEM_DO_FIM_MS - 1000).toISOString();
    const lista = [
      linha({ id: "b1", order: 1, end_date: fim }),
      linha({ id: "b2", order: 2 }),
    ];
    expect(escolherBannerDoTopo(lista, AGORA)).toBeNull();
  });
});

describe("montarCartaz -- a foto e do storage da PROPRIA loja", () => {
  it("monta a mesma foto e o mesmo srcset/sizes que o carrossel pede (dedupe)", () => {
    const cartaz = montarCartaz(linha(), LOJA);
    expect(cartaz).not.toBeNull();
    const esperado = atributosDeImagem(FOTO, IMAGEM_DO_BANNER);
    const html = cartaz?.html ?? "";
    // `&` vira `&amp;` no atributo; o navegador desfaz, a URL pedida e a mesma.
    expect(html).toContain(`src="${escapeHtml(esperado.src)}"`);
    expect(html).toContain(`srcset="${escapeHtml(esperado.srcSet ?? "")}"`);
    expect(decodificar(html)).toContain(`src="${esperado.src}"`);
    expect(decodificar(html)).toContain(`srcset="${esperado.srcSet}"`);
    expect(html).toContain('sizes="100vw"');
    expect(html).toContain(`id="${ID_DO_CARTAZ}"`);
  });
  it("mesma caixa 2:1 e cover, largura total ate 1040 px centralizado; nao pega toque, nao e lido", () => {
    const html = montarCartaz(linha(), LOJA)?.html ?? "";
    expect(html).toContain("aspect-ratio:2/1");
    expect(html).toContain("object-fit:cover");
    expect(html).toContain("width:100%");
    expect(html).toContain("max-width:1040px");
    expect(html).toContain("margin:0 auto");
    // Mesma geometria do carrossel real: cabecalho (52 + 1) + area segura.
    expect(html).toContain("env(safe-area-inset-top,0px) + 53px");
    // Dentro do splash (fixed): o cartaz so se posiciona, nunca e fixed por conta propria.
    expect(html).toContain("position:absolute");
    expect(html).not.toContain("position:fixed");
    expect(html).toContain("pointer-events:none");
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('alt=""');
    // Sem fade: nenhuma transicao nem animacao de entrada.
    expect(html).not.toMatch(/transition|opacity/);
  });
  it("pede a foto com a mesma prioridade do banner real", () => {
    const html = montarCartaz(linha(), LOJA)?.html ?? "";
    expect(html).toContain('fetchpriority="high"');
    expect(html).toContain('loading="eager"');
    // crossorigin muda a chave do cache de imagem: o app nao usa, o cartaz tambem nao.
    expect(html).not.toContain("crossorigin");
  });
  it("o cartaz e UMA imagem, sem <style>, sem animacao e sem codigo de saida: sai com o splash", () => {
    const html = montarCartaz(linha(), LOJA)?.html ?? "";
    expect(html).toMatch(/^<img /);
    expect(html).not.toMatch(/<style|@keyframes|animation/);
    expect(html.match(/</g)).toHaveLength(1);
  });

  it("loja SEM redimensionamento (IKCOUS, 669 KB) NAO ganha cartaz", () => {
    const ikcous = "https://cafkrminfnokvgjqtkle.supabase.co";
    const foto = `${ikcous}/storage/v1/object/public/banners/grande.webp`;
    expect(montarCartaz(linha({ image_url: foto }), ikcous)).toBeNull();
  });

  it("host de OUTRA loja nao vale", () => {
    const outra = FOTO.replace("lojaaaaaaaaaaaaaaaaa", "outraloja000000000000");
    expect(montarCartaz(linha({ image_url: outra }), LOJA)).toBeNull();
  });
  it("host externo nao vale", () => {
    expect(
      montarCartaz(
        linha({
          image_url:
            "https://evil.example/storage/v1/object/public/banners/a.webp",
        }),
        LOJA,
      ),
    ).toBeNull();
  });
  it("subdominio enganoso / host parecido nao vale", () => {
    for (const host of [
      "lojaaaaaaaaaaaaaaaaa.supabase.co.evil.example",
      "evil.lojaaaaaaaaaaaaaaaaa.supabase.co",
      "lojaaaaaaaaaaaaaaaaa.supabase.co@evil.example",
      "evil.example#@lojaaaaaaaaaaaaaaaaa.supabase.co",
    ]) {
      const url = `https://${host}/storage/v1/object/public/banners/a.webp`;
      expect(montarCartaz(linha({ image_url: url }), LOJA)).toBeNull();
    }
  });
  it("http (sem https) nao vale", () => {
    expect(
      montarCartaz(linha({ image_url: FOTO.replace("https:", "http:") }), LOJA),
    ).toBeNull();
  });
  it("a loja sem https no banco nao ganha cartaz", () => {
    const http = "http://lojaaaaaaaaaaaaaaaaa.supabase.co";
    const foto = `${http}/storage/v1/object/public/banners/a.webp`;
    expect(montarCartaz(linha({ image_url: foto }), http)).toBeNull();
  });
  it("javascript:, data:, blob: e protocolo relativo nao valem", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:image/svg+xml;base64,PHN2Zz4=",
      "blob:https://lojaaaaaaaaaaaaaaaaa.supabase.co/x",
      "//lojaaaaaaaaaaaaaaaaa.supabase.co/storage/v1/object/public/banners/a.webp",
      "/storage/v1/object/public/banners/a.webp",
      "banners/a.webp",
    ]) {
      expect(montarCartaz(linha({ image_url: url }), LOJA)).toBeNull();
    }
  });
  it("outro bucket ou outro caminho do storage nao vale", () => {
    for (const caminho of [
      "/storage/v1/object/public/produtos/a.webp",
      "/storage/v1/object/public/banners-privado/a.webp",
      "/storage/v1/object/sign/banners/a.webp",
      "/storage/v1/object/public/banners/sub/a.webp",
      "/storage/v1/object/public/banners/",
      "/storage/v1/object/public/banners/../produtos/a.webp",
      "/storage/v1/object/public/banners/..",
      "/storage/v1/object/public/banners/%2e%2e%2fa.webp",
      "/rest/v1/banners",
    ]) {
      expect(
        montarCartaz(linha({ image_url: `${LOJA}${caminho}` }), LOJA),
      ).toBeNull();
    }
  });
  it("credencial na URL, porta e fragmento nao valem", () => {
    const base = "/storage/v1/object/public/banners/a.webp";
    for (const url of [
      `https://user:pw@lojaaaaaaaaaaaaaaaaa.supabase.co${base}`,
      `https://lojaaaaaaaaaaaaaaaaa.supabase.co:8443${base}`,
      `${LOJA}${base}#x`,
    ]) {
      expect(montarCartaz(linha({ image_url: url }), LOJA)).toBeNull();
    }
  });

  describe("injecao: a URL e escrita pela lojista e vira HTML", () => {
    const base = `${LOJA}/storage/v1/object/public/banners`;
    const PAYLOADS = [
      `${base}/a.webp" onerror="alert(1)`,
      `${base}/a.webp"onerror=alert(1)`,
      `${base}/a.webp'onerror='alert(1)`,
      `${base}/a.webp"><script>alert(1)</script>`,
      `${base}/a.webp><img src=x onerror=alert(1)>`,
      `${base}/<svg onload=alert(1)>.webp`,
      `${base}/a b.webp`,
      `${base}/a\tb.webp`,
      `${base}/a\nb.webp`,
      `${base}/a\u0000b.webp`,
      `${base}/a\u2028b.webp`,
      `${base}/áção.webp`,
      `${base}/a.webp?x="onerror=alert(1)`,
      `${base}/a.webp?x=1 2`,
      `${base}/a.webp?x=<b>`,
      `${base}/a.webp?x=1&y='z'`,
      `${base}/a.webp\\x`,
      `${base}/a.webp </style><script>alert(1)</script>`,
      `${base}/a.webp--><script>alert(1)</script>`,
      ` ${base}/a.webp`,
      `${base}/a.webp `,
      `${base}/a%22onerror%3Dalert(1).webp`,
      `${base}/a.webp?x=%22`,
      `${base}/a.webp"><meta http-equiv=refresh content="0;url=https://evil.example">`,
      `${base}/a.webp?x=$'`,
      `${base}/a.webp?x=$\``,
      `${base}/$'.webp`,
      `${base}/$&.webp`,
    ];
    it.each(PAYLOADS)("recusa %j", (url) => {
      expect(montarCartaz(linha({ image_url: url }), LOJA)).toBeNull();
    });

    it("tudo que entra no HTML e so [A-Za-z0-9._:/?=&,-] e espaco do srcset", () => {
      const html = montarCartaz(linha(), LOJA)?.html ?? "";
      const atributos = [
        ...decodificar(html).matchAll(/(?:src|srcset)="([^"]*)"/g),
      ].map((m) => m[1]);
      // So `&amp;` pode aparecer escapado; nenhum outro `&...;` nem aspas.
      expect(html.match(/&[a-z#0-9]+;/g)?.every((e) => e === "&amp;")).toBe(
        true,
      );
      expect(atributos.length).toBe(2);
      for (const valor of atributos) {
        expect(valor).toMatch(/^[A-Za-z0-9._:/?=&, -]+$/);
        expect(valor).not.toMatch(/["'<>\\]/);
      }
      // Toda candidata do srcset e do storage da propria loja.
      const srcset = atributos[1] ?? "";
      for (const candidata of srcset.split(",")) {
        expect(candidata.trim()).toMatch(
          /^https:\/\/lojaaaaaaaaaaaaaaaaa\.supabase\.co\/storage\/v1\/render\/image\/public\/banners\/[A-Za-z0-9._-]+\?width=\d+&resize=contain&quality=\d+ \d+w$/,
        );
      }
    });

    it("o trecho nao tem script nem manipulador de evento (a CSP os mataria em silencio)", () => {
      const html = montarCartaz(linha(), LOJA)?.html ?? "";
      expect(html).not.toMatch(/<script/i);
      expect(html).not.toMatch(/\son[a-z]+\s*=/i);
      expect(html).not.toMatch(/javascript:/i);
      expect(html).not.toMatch(/<meta|<link|<iframe|<svg/i);
    });
  });

  it("o texto do banner (titulo etc.) nunca entra no cartaz", () => {
    const html =
      montarCartaz(
        linha({ title: "<b>OFERTA</b>", show_text_overlay: false }),
        LOJA,
      )?.html ?? "";
    expect(html).not.toContain("OFERTA");
  });

  describe("so quando o banner real mostraria a foto CRUA", () => {
    it("modelo pronto (foto + pelicula + texto na vitrine) nao ganha cartaz", () => {
      expect(
        montarCartaz(linha({ template_type: "pronto_foto" }), LOJA),
      ).toBeNull();
      expect(
        montarCartaz(linha({ template_type: "pronto_destaque" }), LOJA),
      ).toBeNull();
    });
    for (const campo of ["title", "subtitle", "button_text", "badge_text"]) {
      it(`texto em ${campo} (a vitrine poe pelicula e texto) nao ganha cartaz`, () => {
        expect(montarCartaz(linha({ [campo]: "Oferta" }), LOJA)).toBeNull();
      });
    }
    it("texto com a sobreposicao desligada continua foto crua: ganha cartaz", () => {
      expect(
        montarCartaz(
          linha({ title: "Oferta", show_text_overlay: false }),
          LOJA,
        ),
      ).not.toBeNull();
    });
    it("so espacos no texto nao e texto", () => {
      expect(
        montarCartaz(linha({ title: "   ", subtitle: "\n" }), LOJA),
      ).not.toBeNull();
    });
    it("tipo de template que a vitrine desenha so quando ha texto continua valendo sem texto", () => {
      expect(
        montarCartaz(linha({ template_type: "glassmorphic" }), LOJA),
      ).not.toBeNull();
    });
  });
});

describe("injetarCartazNoHtml -- onde o cartaz entra", () => {
  const LOADER = '<div id="silent-guardian-loader">';
  const HTML = `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width"><title>x</title></head><body>${LOADER}<div class="aura"></div></div><div id="root"></div></body></html>`;
  const cartaz = { html: '<img id="cartaz-da-loja" src="x">' };

  it("entra como PRIMEIRO FILHO do splash, dentro do body", () => {
    const saida = injetarCartazNoHtml(HTML, cartaz) ?? "";
    expect(saida).toContain(`${LOADER}${cartaz.html}<div class="aura">`);
    expect(saida.indexOf("<body>")).toBeLessThan(
      saida.indexOf("cartaz-da-loja"),
    );
  });
  it("NUNCA antes da meta viewport nem dentro do head (baixou 2 fotos no experimento)", () => {
    const saida = injetarCartazNoHtml(HTML, cartaz) ?? "";
    expect(saida.indexOf("cartaz-da-loja")).toBeGreaterThan(
      saida.indexOf("</head>"),
    );
    expect(saida.indexOf("cartaz-da-loja")).toBeGreaterThan(
      saida.indexOf('name="viewport"'),
    );
  });
  it("fora o trecho inserido, o documento fica byte a byte igual", () => {
    const saida = injetarCartazNoHtml(HTML, cartaz) ?? "";
    expect(saida.replace(cartaz.html, "")).toBe(HTML);
  });
  it("sem o loader no HTML: nao injeta (null)", () => {
    expect(
      injetarCartazNoHtml("<html><body></body></html>", cartaz),
    ).toBeNull();
  });
  it("loader duplicado ou fora do body: nao injeta (null)", () => {
    expect(
      injetarCartazNoHtml(
        `<body>${LOADER}</div>${LOADER}</div></body>`,
        cartaz,
      ),
    ).toBeNull();
    expect(
      injetarCartazNoHtml(`<head>${LOADER}</head><body></body>`, cartaz),
    ).toBeNull();
  });
  it("padroes de troca no trecho (`$&`, `$'`, `$` + crase) NAO copiam pedacos do documento", () => {
    const estranho = { html: '<img alt="$& $\' $` $1">' };
    const saida = injetarCartazNoHtml(HTML, estranho) ?? "";
    expect(saida).toContain(`${LOADER}${estranho.html}<div class="aura">`);
    expect(saida.length).toBe(HTML.length + estranho.html.length);
  });
});
