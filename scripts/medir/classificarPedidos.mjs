/**
 * Quantos pedidos de uma visita foram à REDE (plano "a primeira visita deixa
 * de baixar o app inteiro", 26/11/2026). Cada pedido que chega ao CDN é um
 * "CDN Request" da Vercel; no Hobby, 1 milhão no mês estourado pausa o projeto
 * e derruba todas as lojas. Esta função é a conta; quem coleta os eventos é
 * `pedidos-da-primeira-visita.mjs`.
 *
 * Entrada: eventos CDP do domínio Network, cada um marcado com a origem —
 * `"pagina"` (o alvo da aba) ou `"sw"` (o alvo do service worker, onde o Chrome
 * entrega os pedidos que o próprio SW faz, como o precache do `install`).
 * Formato: `{ origem, method, params }`.
 *
 * O que NÃO é rede: resposta marcada `fromDiskCache`, `fromMemoryCache`,
 * `fromPrefetchCache`, ou pedido com `Network.requestServedFromCache` (o cache
 * em memória do Chrome — vale também para um 304 que veio dali). Resposta da
 * página com `fromServiceWorker` também não é rede DA PÁGINA: se o SW foi à
 * rede para atender, o pedido aparece no alvo do SW e conta lá (contar dos dois
 * lados dobraria o número). Um 304 que veio da rede CONTA: a revalidação bateu
 * no CDN. Redirecionamento: cada salto que foi à rede conta (o CDN cobra o 308
 * e o destino). URL fora de http(s) (`data:`, `blob:`) não é pedido.
 */

const ORIGENS = ["pagina", "sw"];

function ehHttp(url) {
  return typeof url === "string" && /^https?:/i.test(url);
}

function veioDeCache(resposta) {
  return (
    resposta?.fromDiskCache === true ||
    resposta?.fromMemoryCache === true ||
    resposta?.fromPrefetchCache === true
  );
}

function contagemVazia() {
  return {
    rede: 0,
    cache: 0,
    servidosPeloSW: 0,
    falhas: 0,
    semResposta: 0,
    urls: [],
  };
}

/**
 * @param {ReadonlyArray<{origem: string, method: string, params: any}>} eventos
 * @returns {{rede: number, pagina: ReturnType<typeof contagemVazia>, sw: ReturnType<typeof contagemVazia>}}
 */
export function classificarPedidos(eventos) {
  // Um pedido por origem + requestId: o requestId só é único dentro do alvo.
  const pedidos = new Map();
  const pegar = (origem, requestId) => {
    const chave = `${origem}\u0000${requestId}`;
    let estado = pedidos.get(chave);
    if (!estado) {
      estado = {
        origem,
        url: null,
        saltos: [],
        resposta: null,
        daMemoria: false,
        falhou: false,
      };
      pedidos.set(chave, estado);
    }
    return estado;
  };

  for (const evento of eventos) {
    if (!ORIGENS.includes(evento?.origem)) continue;
    const params = evento.params ?? {};
    if (params.requestId === undefined) continue;
    switch (evento.method) {
      case "Network.requestWillBeSent": {
        const estado = pegar(evento.origem, params.requestId);
        // O mesmo requestId volta a cada salto de redirecionamento, com a
        // resposta do salto anterior em `redirectResponse`.
        if (params.redirectResponse)
          estado.saltos.push(params.redirectResponse);
        estado.url = params.request?.url ?? estado.url;
        break;
      }
      case "Network.responseReceived":
        // Duas respostas para o mesmo pedido: vale a última, conta uma vez.
        pegar(evento.origem, params.requestId).resposta = params.response ?? {};
        break;
      case "Network.requestServedFromCache":
        pegar(evento.origem, params.requestId).daMemoria = true;
        break;
      case "Network.loadingFailed":
        pegar(evento.origem, params.requestId).falhou = true;
        break;
      default:
        break;
    }
  }

  const resultado = { pagina: contagemVazia(), sw: contagemVazia() };
  for (const estado of pedidos.values()) {
    const conta = resultado[estado.origem];
    for (const salto of estado.saltos) {
      if (!ehHttp(salto.url)) continue;
      if (veioDeCache(salto)) conta.cache += 1;
      else {
        conta.rede += 1;
        conta.urls.push(salto.url);
      }
    }
    const url = estado.resposta?.url ?? estado.url;
    if (!ehHttp(url)) continue;
    if (estado.daMemoria || (estado.resposta && veioDeCache(estado.resposta)))
      conta.cache += 1;
    else if (estado.resposta?.fromServiceWorker === true)
      conta.servidosPeloSW += 1;
    else if (estado.resposta) {
      conta.rede += 1;
      conta.urls.push(url);
    } else if (estado.falhou) conta.falhas += 1;
    else conta.semResposta += 1;
  }

  return {
    rede: resultado.pagina.rede + resultado.sw.rede,
    ...resultado,
  };
}
