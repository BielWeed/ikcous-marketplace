// Cartaz pre-impresso (lote B), o orquestrador: o porteiro le o banner do
// topo junto com a configuracao que ja le, imprime o cartaz NO <body> e marca
// o navegador para a proxima visita nao receber de novo. Tudo com `fetch`
// duble -- nunca rede de verdade.
//
// A regra que manda aqui: em QUALQUER duvida o HTML e byte a byte o de hoje
// (`injetarFichaNoHtml(html, ficha)`), com os MESMOS cabecalhos.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FichaDaLoja } from "@/config/fichaDaLojaContract";
import { ID_DO_CARTAZ } from "@/hospedagem/cartaz";
import {
  CACHE_CARTAZ_FALHA_MS,
  CACHE_CARTAZ_FRESCO_MS,
  PRAZO_BANNERS_MS,
  SELECT_CONFIGURACAO_PUBLICA,
  atenderPorteiro,
  documentoDaLoja,
  injetarFichaNoHtml,
} from "@/hospedagem/porteiro";
import type {
  AmbientePorteiro,
  DependenciasPorteiro,
  EntradaCachePorteiro,
} from "@/hospedagem/porteiro";

const LOJA = "https://lojaaaaaaaaaaaaaaaaa.supabase.co";
const IKCOUS = "https://cafkrminfnokvgjqtkle.supabase.co";
const HOST = "loja-a.exemplo";
const FOTO = `${LOJA}/storage/v1/object/public/banners/1791565996435-7tdkqgfb019.webp`;
const LOADER = '<div id="silent-guardian-loader">';

const HTML_ASSADO = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Loja Fixture | Lugar Nenhum</title>
<meta name="description" content="Produtos e novidades de Loja Fixture" />
<meta name="theme-color" content="#000000" />
<style id="dynamic-branding-style">:root {--primary-color:#000000;}</style>
</head>
<body>
${LOADER}<div class="cinematic-text">Loja Fixture</div></div>
<div id="root"></div>
</body>
</html>`;

function linhaDeIdentidade(origin: string) {
  const hash = "a".repeat(64);
  const asset = (arquivo: string, largura: number, altura: number) => ({
    path: `v1/${hash}/${arquivo}.png`,
    sha256: hash,
    media_type: "image/png",
    bytes: 100,
    width: largura,
    height: altura,
  });
  const header = asset("header", 64, 64);
  return {
    store_name: "Loja A",
    store_city: null,
    store_state: null,
    logo_url: `${origin}/storage/v1/object/public/branding/${header.path}`,
    primary_color: "#111111",
    secondary_color: "#654321",
    accent_color: "#ABCDEF",
    branding_assets: {
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
    },
  };
}

function banner(extra: Record<string, unknown> = {}) {
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

type RespostaDeBanners = (
  url: URL,
  init?: RequestInit,
) => Response | Promise<Response>;

interface Cenario {
  readonly origem?: string;
  readonly manutencao?: boolean;
  readonly bancoDeBanners: RespostaDeBanners;
  readonly html?: string;
}

interface Duble {
  readonly fetchImpl: typeof fetch;
  readonly chamadas: URL[];
  readonly chamadasDeBanners: () => URL[];
  readonly cabecalhosDeBanners: Headers[];
  readonly iniciosDeBanners: RequestInit[];
}

function criarDuble(cenario: Cenario): Duble {
  const origem = cenario.origem ?? LOJA;
  const chamadas: URL[] = [];
  const cabecalhosDeBanners: Headers[] = [];
  const iniciosDeBanners: RequestInit[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    chamadas.push(url);
    if (url.pathname === "/index.html")
      return new Response(cenario.html ?? HTML_ASSADO, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    if (url.pathname === "/rest/v1/v_store_config") {
      const select = url.searchParams.get("select");
      if (select === SELECT_CONFIGURACAO_PUBLICA)
        return new Response(
          JSON.stringify([
            {
              dominio_publico: HOST,
              mp_public_key: null,
              vapid_public_key: null,
              pagamento_online: false,
              manutencao: cenario.manutencao ?? false,
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      return new Response(JSON.stringify([linhaDeIdentidade(origem)]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.pathname === "/rest/v1/banners") {
      cabecalhosDeBanners.push(new Headers(init?.headers));
      iniciosDeBanners.push({ ...init });
      return cenario.bancoDeBanners(url, init);
    }
    throw new Error(`URL nao mapeada no duble: ${url.toString()}`);
  }) as typeof fetch;
  return {
    fetchImpl,
    chamadas,
    chamadasDeBanners: () =>
      chamadas.filter((u) => u.pathname === "/rest/v1/banners"),
    cabecalhosDeBanners,
    iniciosDeBanners,
  };
}

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json" },
  });

function ambiente(
  origem = LOJA,
  extra: Partial<AmbientePorteiro> = {},
): AmbientePorteiro {
  return {
    VITE_SUPABASE_URL: origem,
    VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_a",
    ...extra,
  };
}

/** O que o Chrome manda ao abrir a vitrine pela 1a vez (medido). */
const PRIMEIRA_ABERTURA = {
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
};

function pedido(
  init: RequestInit & { headers?: Record<string, string> } = {},
  host = HOST,
  path = "/",
): Request {
  return new Request(`https://${host}${path}`, {
    ...init,
    headers: { ...PRIMEIRA_ABERTURA, ...(init.headers ?? {}) },
  });
}

function deps(
  fetchImpl: typeof fetch,
  extra: Partial<DependenciasPorteiro> = {},
): DependenciasPorteiro {
  return {
    fetchImpl,
    cache: new Map<string, EntradaCachePorteiro>(),
    cacheCartaz: new Map(),
    ...extra,
  };
}

/** O que o porteiro serve HOJE (sem cartaz): a referencia byte a byte. */
async function saidaDeHoje(
  ficha: FichaDaLoja,
  html = HTML_ASSADO,
): Promise<string> {
  return injetarFichaNoHtml(html, ficha);
}

async function fichaDe(duble: Duble, origem = LOJA): Promise<FichaDaLoja> {
  const resp = await atenderPorteiro(
    pedido({}, HOST, "/identidade.json"),
    ambiente(origem),
    deps(duble.fetchImpl),
  );
  return (await resp.json()) as FichaDaLoja;
}

/** Os cabecalhos de hoje; so o `Vary` do caminho do navegador cresceu (o
 * cartaz depende de `Sec-Fetch-*` e `Save-Data`). */
const CABECALHOS_DE_HOJE = {
  "content-type": "text/html; charset=utf-8",
  "x-ikcous-porteiro": "ok",
  "x-ikcous-caderneta": "ausente",
  "cache-control": "no-store",
  vary: "host, sec-fetch-dest, sec-fetch-mode, save-data",
};

function cabecalhosDe(resp: Response): Record<string, string> {
  return Object.fromEntries(resp.headers.entries());
}

afterEach(() => {
  vi.useRealTimers();
});

describe("1a visita: o cartaz entra no splash do HTML", () => {
  it("imprime a foto do banner do topo como PRIMEIRO FILHO do splash, no body", async () => {
    const duble = criarDuble({ bancoDeBanners: () => json([banner()]) });
    const resp = await atenderPorteiro(
      pedido(),
      ambiente(),
      deps(duble.fetchImpl),
    );
    expect(resp.status).toBe(200);
    const html = await resp.text();

    const cartaz = html.indexOf(`id="${ID_DO_CARTAZ}"`);
    expect(cartaz).toBeGreaterThan(html.indexOf("<body>"));
    expect(cartaz).toBeGreaterThan(html.indexOf('name="viewport"'));
    expect(html).toContain(`${LOADER}<img id="${ID_DO_CARTAZ}"`);
    expect(html).toContain(
      "/storage/v1/render/image/public/banners/1791565996435-7tdkqgfb019.webp?width=640",
    );
    expect(resp.headers.get("x-ikcous-cartaz")).toBe("ok");
    expect(resp.headers.get("cache-control")).toBe("no-store");
    expect(resp.headers.get("vary")).toBe(CABECALHOS_DE_HOJE.vary);
    // Nenhum estado no navegador: sem cookie, sem Vary: *.
    expect(resp.headers.get("set-cookie")).toBeNull();
    expect(resp.headers.get("vary")).not.toContain("*");
  });

  it("fora o trecho do cartaz, o HTML e exatamente o de hoje", async () => {
    const duble = criarDuble({ bancoDeBanners: () => json([banner()]) });
    const resp = await atenderPorteiro(
      pedido(),
      ambiente(),
      deps(duble.fetchImpl),
    );
    const html = await resp.text();
    const ficha = await fichaDe(duble);
    const inicio = html.indexOf(`<img id="${ID_DO_CARTAZ}"`);
    const fim = html.indexOf(">", inicio) + 1;
    expect(inicio).toBeGreaterThan(-1);
    expect(html.slice(0, inicio) + html.slice(fim)).toBe(
      await saidaDeHoje(ficha),
    );
  });

  it("a requisicao dos banners e de leitura anonima, ativos do topo por order e id, com limite", async () => {
    const duble = criarDuble({ bancoDeBanners: () => json([banner()]) });
    await atenderPorteiro(pedido(), ambiente(), deps(duble.fetchImpl));
    const [chamada] = duble.chamadasDeBanners();
    expect(chamada.origin).toBe(LOJA);
    expect(chamada.searchParams.get("position")).toBe("eq.home_top");
    expect(chamada.searchParams.get("active")).toBe("eq.true");
    expect(chamada.searchParams.get("order")).toBe("order.asc,id.asc");
    // Mais que 2 de proposito: banner vencido/agendado de menor `order` nao
    // pode ocupar uma das vagas e esconder um empate real entre os vigentes.
    expect(chamada.searchParams.get("limit")).toBe("10");
    expect(duble.cabecalhosDeBanners[0].get("apikey")).toBe("sb_publishable_a");
    // Nunca segue redirecionamento nem manda cookie para o banco.
    expect(duble.iniciosDeBanners[0].redirect).toBe("error");
    expect(duble.iniciosDeBanners[0].credentials).toBe("omit");
  });

  it("le o banner EM PARALELO com o documento (nao soma a espera)", async () => {
    let liberar: (r: Response) => void = () => {};
    const duble = criarDuble({
      bancoDeBanners: () =>
        new Promise<Response>((resolve) => {
          liberar = resolve;
        }),
    });
    const promessa = atenderPorteiro(
      pedido(),
      ambiente(),
      deps(duble.fetchImpl),
    );
    await vi.waitFor(() => {
      expect(duble.chamadasDeBanners().length).toBe(1);
      expect(duble.chamadas.some((u) => u.pathname === "/index.html")).toBe(
        true,
      );
    });
    liberar(json([banner()]));
    const resp = await promessa;
    expect(resp.headers.get("x-ikcous-cartaz")).toBe("ok");
  });

  it("o banner NAO entra na ficha: nem no /identidade.json, nem no select da configuracao", async () => {
    const duble = criarDuble({ bancoDeBanners: () => json([banner()]) });
    const resp = await atenderPorteiro(
      pedido({}, HOST, "/identidade.json"),
      ambiente(),
      deps(duble.fetchImpl),
    );
    const corpo = await resp.text();
    expect(corpo).not.toContain("banners");
    expect(corpo).not.toContain("1791565996435");
    expect(SELECT_CONFIGURACAO_PUBLICA).not.toMatch(/banner/);
    expect(duble.chamadasDeBanners()).toHaveLength(0);
  });

  it("a leitura do banner nao toca a ficha: banco de banners fora do ar nao vira 503 nem ficha antiga", async () => {
    const duble = criarDuble({
      bancoDeBanners: () => {
        throw new Error("banners fora");
      },
    });
    const resp = await atenderPorteiro(
      pedido(),
      ambiente(),
      deps(duble.fetchImpl),
    );
    expect(resp.status).toBe(200);
    expect(resp.headers.get("x-ikcous-porteiro")).toBe("ok");
  });
});

describe("so a 1a abertura do navegador recebe o cartaz: o resto e exatamente o de hoje", () => {
  async function semCartaz(init: RequestInit, caminho = "/") {
    const duble = criarDuble({ bancoDeBanners: () => json([banner()]) });
    const req = new Request(`https://${HOST}${caminho}`, init);
    const resp = await atenderPorteiro(req, ambiente(), deps(duble.fetchImpl));
    const ficha = await fichaDe(duble);
    expect(resp.status).toBe(200);
    expect(await resp.text()).toBe(await saidaDeHoje(ficha));
    expect(resp.headers.get("x-ikcous-cartaz")).toBeNull();
    expect(duble.chamadasDeBanners()).toHaveLength(0);
    return resp;
  }

  it("revalidacao do service worker (mode=navigate, dest=empty): sem cartaz e sem ler banner", async () => {
    const resp = await semCartaz({
      headers: { "sec-fetch-dest": "empty", "sec-fetch-mode": "navigate" },
    });
    expect(cabecalhosDe(resp)).toEqual(CABECALHOS_DE_HOJE);
  });
  it("instalacao do service worker (mode=cors, dest=empty)", async () => {
    await semCartaz({
      headers: { "sec-fetch-dest": "empty", "sec-fetch-mode": "cors" },
    });
  });
  it("sem cabecalhos Sec-Fetch (navegador antigo, robo, curl)", async () => {
    await semCartaz({});
  });
  it("Save-Data ligado", async () => {
    await semCartaz({ headers: { ...PRIMEIRA_ABERTURA, "save-data": "on" } });
  });
  it("rota que nao e a vitrine, ou vitrine filtrada", async () => {
    await semCartaz({ headers: PRIMEIRA_ABERTURA }, "/cart");
    await semCartaz({ headers: PRIMEIRA_ABERTURA }, "/?category=Bebidas");
    await semCartaz({ headers: PRIMEIRA_ABERTURA }, "/product-detail?id=1");
  });
  it("campanha (utm, fbclid, source) continua sendo a vitrine: tem cartaz", async () => {
    const duble = criarDuble({ bancoDeBanners: () => json([banner()]) });
    const resp = await atenderPorteiro(
      pedido({}, HOST, "/?utm_source=ig&fbclid=abc&source=pwa"),
      ambiente(),
      deps(duble.fetchImpl),
    );
    expect(resp.headers.get("x-ikcous-cartaz")).toBe("ok");
  });
});

describe("falha segura: HTML e cabecalhos identicos aos de hoje", () => {
  async function esperarIgualAHoje(
    cenario: Cenario,
    opcoes: { ambiente?: AmbientePorteiro; origem?: string } = {},
  ) {
    const duble = criarDuble(cenario);
    const resp = await atenderPorteiro(
      pedido(),
      opcoes.ambiente ?? ambiente(opcoes.origem),
      deps(duble.fetchImpl),
    );
    expect(resp.status).toBe(200);
    const ficha = await fichaDe(duble, opcoes.origem);
    expect(await resp.text()).toBe(await saidaDeHoje(ficha, cenario.html));
    expect(cabecalhosDe(resp)).toEqual(CABECALHOS_DE_HOJE);
    return duble;
  }

  it("a leitura dos banners lanca (rede)", async () => {
    await esperarIgualAHoje({
      bancoDeBanners: () => {
        throw new Error("rede caiu");
      },
    });
  });
  it("a leitura devolve erro HTTP", async () => {
    await esperarIgualAHoje({
      bancoDeBanners: () => json({ message: "x" }, 500),
    });
    await esperarIgualAHoje({ bancoDeBanners: () => json({}, 401) });
    // Status de erro com um corpo que PARECE um banner valido: o status manda.
    await esperarIgualAHoje({ bancoDeBanners: () => json([banner()], 500) });
    await esperarIgualAHoje({ bancoDeBanners: () => json([banner()], 404) });
  });
  it("resposta malformada: nao-JSON, objeto no lugar de lista, lista de lixo", async () => {
    await esperarIgualAHoje({
      bancoDeBanners: () => new Response("<html>oops</html>", { status: 200 }),
    });
    await esperarIgualAHoje({ bancoDeBanners: () => json({ a: 1 }) });
    await esperarIgualAHoje({ bancoDeBanners: () => json([1, null, "x"]) });
    await esperarIgualAHoje({ bancoDeBanners: () => json([]) });
  });
  it("resposta enorme (acima do teto de bytes)", async () => {
    await esperarIgualAHoje({
      bancoDeBanners: () =>
        // Um banner VALIDO (sem texto) com um campo inutil enorme: so o teto
        // de bytes o impede de virar cartaz.
        new Response(JSON.stringify([banner({ lixo: "x".repeat(400_000) })]), {
          status: 200,
        }),
    });
  });
  it("o mesmo banner valido, sem o campo enorme, vira cartaz (o teste acima prova o TETO, nao outra coisa)", async () => {
    const duble = criarDuble({
      bancoDeBanners: () => json([banner({ lixo: "x".repeat(1_000) })]),
    });
    const resp = await atenderPorteiro(
      pedido(),
      ambiente(),
      deps(duble.fetchImpl),
    );
    expect(resp.headers.get("x-ikcous-cartaz")).toBe("ok");
  });
  it("falha INESPERADA dentro da decisao do cartaz (cache que lanca): pagina sai como hoje", async () => {
    const duble = criarDuble({ bancoDeBanners: () => json([banner()]) });
    const cacheQueLanca = new Map<string, never>();
    cacheQueLanca.get = () => {
      throw new Error("cache quebrado");
    };
    const resp = await atenderPorteiro(
      pedido(),
      ambiente(),
      deps(duble.fetchImpl, { cacheCartaz: cacheQueLanca as never }),
    );
    expect(resp.status).toBe(200);
    const ficha = await fichaDe(duble);
    expect(await resp.text()).toBe(await saidaDeHoje(ficha));
    expect(cabecalhosDe(resp)).toEqual(CABECALHOS_DE_HOJE);
  });
  it("o prazo da leitura e curto (<= 250 ms)", () => {
    expect(PRAZO_BANNERS_MS).toBeLessThanOrEqual(250);
  });
  it("banco que nunca responde: o prazo corta e a pagina sai como hoje", async () => {
    vi.useFakeTimers();
    const duble = criarDuble({
      bancoDeBanners: (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("abortado")),
          );
        }),
    });
    const promessa = atenderPorteiro(
      pedido(),
      ambiente(),
      deps(duble.fetchImpl),
    );
    // Espera a leitura comecar (o prazo so existe depois disso) e so entao
    // deixa o relogio correr.
    await vi.waitFor(() => expect(duble.chamadasDeBanners()).toHaveLength(1));
    await vi.advanceTimersByTimeAsync(5_000);
    const resp = await promessa;
    expect(resp.status).toBe(200);
    vi.useRealTimers();
    const ficha = await fichaDe(duble);
    expect(await resp.text()).toBe(await saidaDeHoje(ficha));
    expect(cabecalhosDe(resp)).toEqual(CABECALHOS_DE_HOJE);
  });
  it("banco que ignora o sinal e nunca responde tambem nao prende a pagina", async () => {
    vi.useFakeTimers();
    const duble = criarDuble({
      bancoDeBanners: () => new Promise<Response>(() => {}),
    });
    const promessa = atenderPorteiro(
      pedido(),
      ambiente(),
      deps(duble.fetchImpl),
    );
    await vi.waitFor(() => expect(duble.chamadasDeBanners()).toHaveLength(1));
    await vi.advanceTimersByTimeAsync(5_000);
    const resp = await promessa;
    expect(resp.status).toBe(200);
    expect(resp.headers.get("set-cookie")).toBeNull();
  });

  it("banner inativo", async () => {
    await esperarIgualAHoje({
      bancoDeBanners: () => json([banner({ active: false })]),
    });
  });
  it("banner agendado para o futuro", async () => {
    const futuro = new Date(Date.now() + 86_400_000).toISOString();
    await esperarIgualAHoje({
      bancoDeBanners: () => json([banner({ start_date: futuro })]),
    });
  });
  it("banner expirado", async () => {
    const passado = new Date(Date.now() - 86_400_000).toISOString();
    await esperarIgualAHoje({
      bancoDeBanners: () => json([banner({ end_date: passado })]),
    });
  });
  it("banner que nao e o do topo", async () => {
    await esperarIgualAHoje({
      bancoDeBanners: () => json([banner({ position: "home_middle" })]),
    });
  });
  it("banner com texto sobre a foto", async () => {
    await esperarIgualAHoje({
      bancoDeBanners: () => json([banner({ title: "Promocao" })]),
    });
  });
  it("loja sem redimensionamento de foto (origem da IKCOUS): decidido ANTES, nem le o banco", async () => {
    const foto = `${IKCOUS}/storage/v1/object/public/banners/grande.webp`;
    const duble = await esperarIgualAHoje(
      {
        origem: IKCOUS,
        bancoDeBanners: () => json([banner({ image_url: foto })]),
      },
      { origem: IKCOUS },
    );
    expect(duble.chamadasDeBanners()).toHaveLength(0);
  });
  it("foto de outro host", async () => {
    await esperarIgualAHoje({
      bancoDeBanners: () =>
        json([
          banner({
            image_url:
              "https://evil.example/storage/v1/object/public/banners/a.webp",
          }),
        ]),
    });
  });
  it("URL com tentativa de injecao", async () => {
    await esperarIgualAHoje({
      bancoDeBanners: () =>
        json([banner({ image_url: `${FOTO}" onerror="alert(1)` })]),
    });
    await esperarIgualAHoje({
      bancoDeBanners: () =>
        json([
          banner({
            image_url: `${LOJA}/storage/v1/object/public/banners/a b.webp`,
          }),
        ]),
    });
  });
  it("HTML sem o splash (documento desconhecido): nada muda, nem a marca", async () => {
    const semLoader = HTML_ASSADO.replace(LOADER, '<div id="outra-coisa">');
    await esperarIgualAHoje({
      html: semLoader,
      bancoDeBanners: () => json([banner()]),
    });
  });
  it("foto no storage de OUTRA loja do mesmo projeto de hospedagem", async () => {
    await esperarIgualAHoje({
      bancoDeBanners: () =>
        json([
          banner({
            image_url:
              "https://outraloja000000000000.supabase.co/storage/v1/object/public/banners/a.webp",
          }),
        ]),
    });
  });
  it("banner de modelo pronto (foto com pelicula e texto ao lado)", async () => {
    await esperarIgualAHoje({
      bancoDeBanners: () => json([banner({ template_type: "pronto_foto" })]),
    });
  });
  it("empate de order no topo (o app escolhe sem criterio)", async () => {
    await esperarIgualAHoje({
      bancoDeBanners: () =>
        json([banner({ id: "b1", order: 0 }), banner({ id: "b2", order: 0 })]),
    });
  });
  it("interruptor desligado (IKCOUS_CARTAZ_DESLIGADO=1): nem le os banners", async () => {
    const duble = await esperarIgualAHoje(
      { bancoDeBanners: () => json([banner()]) },
      { ambiente: ambiente(LOJA, { IKCOUS_CARTAZ_DESLIGADO: "1" }) },
    );
    expect(duble.chamadasDeBanners()).toHaveLength(0);
  });
  it("loja em manutencao: o cartaz nao disputa a tela com o aviso", async () => {
    const duble = await esperarIgualAHoje({
      manutencao: true,
      bancoDeBanners: () => json([banner()]),
    });
    expect(duble.chamadasDeBanners()).toHaveLength(0);
  });
});

describe("so o navegador, so GET", () => {
  it("HEAD nao recebe cartaz nem marca", async () => {
    const duble = criarDuble({ bancoDeBanners: () => json([banner()]) });
    const resp = await atenderPorteiro(
      pedido({ method: "HEAD" }),
      ambiente(),
      deps(duble.fetchImpl),
    );
    expect(resp.headers.get("set-cookie")).toBeNull();
    expect(duble.chamadasDeBanners()).toHaveLength(0);
  });
  it("o caminho do robo (documentoDaLoja sem opcao de cartaz) nunca recebe cartaz", async () => {
    const duble = criarDuble({ bancoDeBanners: () => json([banner()]) });
    const ficha = await fichaDe(duble);
    const resp = await documentoDaLoja(
      pedido(),
      ficha,
      "ausente",
      { fetchImpl: duble.fetchImpl },
      { "x-ikcous-og": "sem-produto" },
    );
    expect(await resp.text()).toBe(await saidaDeHoje(ficha));
    expect(resp.headers.get("set-cookie")).toBeNull();
    expect(resp.headers.get("vary")).toBe("host");
    expect(duble.chamadasDeBanners()).toHaveLength(0);
  });
  it("outras rotas do porteiro (manifest, identidade, robots) nao leem banner", async () => {
    const duble = criarDuble({ bancoDeBanners: () => json([banner()]) });
    for (const caminho of ["/identidade.json", "/robots.txt"]) {
      await atenderPorteiro(
        pedido({}, HOST, caminho),
        ambiente(),
        deps(duble.fetchImpl),
      );
    }
    expect(duble.chamadasDeBanners()).toHaveLength(0);
  });
});

describe("cache dos banners (15 s) -- curto: a lojista troca o banner e confere em aba anonima", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("duas visitas seguidas: uma leitura", async () => {
    let agora = 1_000_000;
    const duble = criarDuble({ bancoDeBanners: () => json([banner()]) });
    const d = deps(duble.fetchImpl, { agora: () => agora });
    const a = await atenderPorteiro(pedido(), ambiente(), d);
    agora += CACHE_CARTAZ_FRESCO_MS - 1_000;
    const b = await atenderPorteiro(pedido(), ambiente(), d);
    expect(a.headers.get("x-ikcous-cartaz")).toBe("ok");
    expect(b.headers.get("x-ikcous-cartaz")).toBe("ok");
    expect(duble.chamadasDeBanners()).toHaveLength(1);
  });
  it("passados 15 s, le de novo (banner trocado aparece), e nunca guarda mais que isso", async () => {
    expect(CACHE_CARTAZ_FRESCO_MS).toBeLessThanOrEqual(15_000);
    expect(CACHE_CARTAZ_FALHA_MS).toBeLessThanOrEqual(15_000);
    let agora = 1_000_000;
    const duble = criarDuble({ bancoDeBanners: () => json([banner()]) });
    const d = deps(duble.fetchImpl, { agora: () => agora });
    await atenderPorteiro(pedido(), ambiente(), d);
    agora += CACHE_CARTAZ_FRESCO_MS + 1_000;
    await atenderPorteiro(pedido(), ambiente(), d);
    expect(duble.chamadasDeBanners()).toHaveLength(2);
  });
  it("leitura que falhou nao e repetida a cada visita (nao empilha espera)", async () => {
    let agora = 1_000_000;
    const duble = criarDuble({
      bancoDeBanners: () => {
        throw new Error("fora do ar");
      },
    });
    const d = deps(duble.fetchImpl, { agora: () => agora });
    await atenderPorteiro(pedido(), ambiente(), d);
    agora += 3_000;
    await atenderPorteiro(pedido(), ambiente(), d);
    expect(duble.chamadasDeBanners()).toHaveLength(1);
    agora += CACHE_CARTAZ_FALHA_MS + 1_000;
    await atenderPorteiro(pedido(), ambiente(), d);
    expect(duble.chamadasDeBanners()).toHaveLength(2);
  });
  it("o cache e por loja: o banner de uma nunca aparece na outra", async () => {
    const agora = 1_000_000;
    const outraLoja = "https://outraloja000000000000.supabase.co";
    const cache = new Map();
    const duble = criarDuble({ bancoDeBanners: () => json([banner()]) });
    const d = deps(duble.fetchImpl, { agora: () => agora, cacheCartaz: cache });
    await atenderPorteiro(pedido(), ambiente(), d);
    expect(cache.size).toBe(1);
    const [chave] = [...cache.keys()];
    expect(chave).toContain(LOJA);
    expect(chave).not.toContain(outraLoja);
  });
});
