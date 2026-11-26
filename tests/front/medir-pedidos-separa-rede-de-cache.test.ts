// Plano "a primeira visita deixa de baixar o app inteiro" (26/11/2026), T1.
// O medidor conta quantos pedidos a primeira visita faz à REDE (cada um é um
// "CDN Request" da Vercel; no Hobby, 1 milhão no mês estourado pausa o projeto
// e derruba todas as lojas). A conta vem de eventos do Chrome (CDP): os da
// página e os do service worker, que o navegador entrega em alvos separados.
//
// Este teste cobre a parte pura, com eventos FALSOS: o que é rede e o que não
// é. O erro que custa caro aqui é contar cache como rede (o "antes" infla e a
// melhoria parece maior do que é) ou o contrário (o "depois" esconde pedido).
import { describe, expect, it } from "vitest";
import { classificarPedidos } from "../../scripts/medir/classificarPedidos.mjs";

type Origem = "pagina" | "sw";

function pedido(origem: Origem, requestId: string, url: string) {
  return {
    origem,
    method: "Network.requestWillBeSent",
    params: { requestId, request: { url } },
  };
}

function resposta(
  origem: Origem,
  requestId: string,
  url: string,
  extras: Record<string, unknown> = {},
) {
  return {
    origem,
    method: "Network.responseReceived",
    params: { requestId, response: { url, status: 200, ...extras } },
  };
}

function fim(origem: Origem, requestId: string) {
  return {
    origem,
    method: "Network.loadingFinished",
    params: { requestId },
  };
}

/** Pedido completo: saiu, voltou, terminou. */
function completo(
  origem: Origem,
  requestId: string,
  url: string,
  extras: Record<string, unknown> = {},
) {
  return [
    pedido(origem, requestId, url),
    resposta(origem, requestId, url, extras),
    fim(origem, requestId),
  ];
}

const LOJA = "https://loja.exemplo";

describe("classificarPedidos", () => {
  it("sem evento nenhum, zero em tudo", () => {
    const r = classificarPedidos([]);
    expect(r.rede).toBe(0);
    expect(r.pagina).toEqual({
      rede: 0,
      cache: 0,
      servidosPeloSW: 0,
      falhas: 0,
      semResposta: 0,
      urls: [],
    });
    expect(r.sw).toEqual(r.pagina);
  });

  it("resposta sem marca de cache é REDE, e cada origem conta a sua", () => {
    const r = classificarPedidos([
      ...completo("pagina", "1", `${LOJA}/`),
      ...completo("pagina", "2", `${LOJA}/assets/index-a.js`),
      ...completo("sw", "1", `${LOJA}/assets/HomeView-b.js`),
    ]);
    expect(r.pagina.rede).toBe(2);
    expect(r.sw.rede).toBe(1);
    expect(r.rede).toBe(3);
  });

  it("lista as URLs que o service worker buscou na rede", () => {
    const r = classificarPedidos([
      ...completo("sw", "7", `${LOJA}/assets/a.js`),
      ...completo("sw", "8", `${LOJA}/offline.html`),
      ...completo("sw", "9", `${LOJA}/assets/c.js`, { fromDiskCache: true }),
    ]);
    expect(r.sw.urls).toEqual([`${LOJA}/assets/a.js`, `${LOJA}/offline.html`]);
  });

  it.each([["fromDiskCache"], ["fromMemoryCache"], ["fromPrefetchCache"]])(
    "resposta com %s NÃO é rede",
    (marca) => {
      const r = classificarPedidos([
        ...completo("pagina", "1", `${LOJA}/assets/a.js`, { [marca]: true }),
      ]);
      expect(r.pagina.rede).toBe(0);
      expect(r.pagina.cache).toBe(1);
      expect(r.pagina.urls).toEqual([]);
    },
  );

  it("resposta da página que veio do service worker NÃO é rede da página", () => {
    // Se o SW foi à rede para atender, o pedido aparece no alvo do SW, e é lá
    // que ele conta — contar dos dois lados dobraria o número.
    const r = classificarPedidos([
      ...completo("pagina", "1", `${LOJA}/assets/a.js`, {
        fromServiceWorker: true,
      }),
      ...completo("sw", "1", `${LOJA}/assets/a.js`),
    ]);
    expect(r.pagina.rede).toBe(0);
    expect(r.pagina.servidosPeloSW).toBe(1);
    expect(r.sw.rede).toBe(1);
    expect(r.rede).toBe(1);
  });

  it("304 servido do cache em memória (requestServedFromCache) NÃO conta", () => {
    const r = classificarPedidos([
      pedido("pagina", "1", `${LOJA}/assets/a.js`),
      // O Chrome avisa o cache em memória ANTES da resposta; a ordem não importa.
      {
        origem: "pagina",
        method: "Network.requestServedFromCache",
        params: { requestId: "1" },
      },
      resposta("pagina", "1", `${LOJA}/assets/a.js`, { status: 304 }),
      fim("pagina", "1"),
    ]);
    expect(r.pagina.rede).toBe(0);
    expect(r.pagina.cache).toBe(1);
  });

  it("requestServedFromCache depois da resposta também tira o pedido da rede", () => {
    const r = classificarPedidos([
      ...completo("pagina", "1", `${LOJA}/assets/a.js`),
      {
        origem: "pagina",
        method: "Network.requestServedFromCache",
        params: { requestId: "1" },
      },
    ]);
    expect(r.pagina.rede).toBe(0);
  });

  it("304 que veio da REDE (revalidação no CDN) conta", () => {
    const r = classificarPedidos([
      ...completo("pagina", "1", `${LOJA}/`, { status: 304 }),
    ]);
    expect(r.pagina.rede).toBe(1);
  });

  it("o mesmo requestId em origens diferentes são pedidos diferentes", () => {
    const r = classificarPedidos([
      ...completo("pagina", "42", `${LOJA}/a.js`),
      ...completo("sw", "42", `${LOJA}/b.js`, { fromDiskCache: true }),
    ]);
    expect(r.pagina.rede).toBe(1);
    expect(r.sw.rede).toBe(0);
    expect(r.sw.cache).toBe(1);
  });

  it("duas respostas para o mesmo pedido contam uma vez só", () => {
    const r = classificarPedidos([
      pedido("pagina", "1", `${LOJA}/a.js`),
      resposta("pagina", "1", `${LOJA}/a.js`),
      resposta("pagina", "1", `${LOJA}/a.js`),
      fim("pagina", "1"),
    ]);
    expect(r.pagina.rede).toBe(1);
    expect(r.pagina.urls).toEqual([`${LOJA}/a.js`]);
  });

  it("redirecionamento: cada salto que foi à rede conta", () => {
    // O CDN cobra o 308 e o destino: são dois pedidos.
    const r = classificarPedidos([
      pedido("pagina", "1", `${LOJA}/velho`),
      {
        origem: "pagina",
        method: "Network.requestWillBeSent",
        params: {
          requestId: "1",
          request: { url: `${LOJA}/novo` },
          redirectResponse: { url: `${LOJA}/velho`, status: 308 },
        },
      },
      resposta("pagina", "1", `${LOJA}/novo`),
      fim("pagina", "1"),
    ]);
    expect(r.pagina.rede).toBe(2);
    expect(r.pagina.urls).toEqual([`${LOJA}/velho`, `${LOJA}/novo`]);
  });

  it("redirecionamento que veio do cache em disco não conta o salto", () => {
    const r = classificarPedidos([
      pedido("pagina", "1", `${LOJA}/velho`),
      {
        origem: "pagina",
        method: "Network.requestWillBeSent",
        params: {
          requestId: "1",
          request: { url: `${LOJA}/novo` },
          redirectResponse: {
            url: `${LOJA}/velho`,
            status: 301,
            fromDiskCache: true,
          },
        },
      },
      resposta("pagina", "1", `${LOJA}/novo`),
      fim("pagina", "1"),
    ]);
    expect(r.pagina.rede).toBe(1);
    expect(r.pagina.cache).toBe(1);
  });

  it("pedido que falhou sem resposta não é rede: conta em falhas", () => {
    const r = classificarPedidos([
      pedido("sw", "1", `${LOJA}/assets/a.js`),
      {
        origem: "sw",
        method: "Network.loadingFailed",
        params: { requestId: "1", errorText: "net::ERR_ABORTED" },
      },
    ]);
    expect(r.sw.rede).toBe(0);
    expect(r.sw.falhas).toBe(1);
  });

  it("pedido que saiu e não voltou até o fim da medição conta em semResposta", () => {
    const r = classificarPedidos([pedido("sw", "1", `${LOJA}/assets/a.js`)]);
    expect(r.sw.rede).toBe(0);
    expect(r.sw.semResposta).toBe(1);
  });

  it("data: e blob: não são pedido de rede", () => {
    const r = classificarPedidos([
      ...completo("pagina", "1", "data:image/png;base64,AAAA"),
      ...completo("pagina", "2", "blob:https://loja.exemplo/uuid"),
    ]);
    expect(r.pagina).toEqual({
      rede: 0,
      cache: 0,
      servidosPeloSW: 0,
      falhas: 0,
      semResposta: 0,
      urls: [],
    });
  });

  it("evento de outro tipo ou de origem desconhecida é ignorado", () => {
    const r = classificarPedidos([
      {
        origem: "pagina",
        method: "Network.dataReceived",
        params: { requestId: "1" },
      },
      ...completo("outra" as Origem, "1", `${LOJA}/a.js`),
    ]);
    expect(r.rede).toBe(0);
  });
});
