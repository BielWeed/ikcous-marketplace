// Instala TODAS as rotas falsas de rede (page.route) para uma `page` do
// harness da vitrine — documento (injeta a ficha da loja), `/identidade.json`,
// REST (`/rest/v1/<tabela>` e `/rest/v1/rpc/<nome>`), Auth (`/auth/v1/...`),
// Storage (imagens) e a edge `calculate-shipping`. Qualquer outra origem é
// BLOQUEADA e registrada em `log.bloqueados` — nunca sai request nenhuma
// para a internet (o Chromium também é lançado com
// `--host-resolver-rules="MAP * 127.0.0.1"` em rodar.mjs: mesmo se uma rota
// escapasse deste roteador, o DNS nunca resolveria de verdade).
import {
  CHAVE_DA_SESSAO_FIXTURA,
  ORIGEM_BANCO_FIXTURA,
  PRODUTOS,
  linhaConfig,
  linhaConfigDoCartao,
  linhasBanners,
  linhasCategorias,
  linhasNotificacoes,
  linhasPedidos,
  montarFicha,
  sessaoFixtura,
  usuarioFixtura,
} from "./fixtures.mjs";

const JSON_HEADERS = { "content-type": "application/json" };

/** PNG plano 8x8 gerado uma vez por cor — sem pngjs, sem rede: um cabeçalho
 * PNG mínimo IHDR+IDAT+IEND feito à mão seria frágil demais; em vez disso
 * usamos um PNG 1x1 fixo (mesmo bloco de tests/e2e/kit-jornadas.ts) — o que
 * importa para o diff de pixel é a GEOMETRIA do layout, não a textura da
 * imagem, e um 1x1 esticado por CSS já ocupa o espaço certo. */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function filtrarPorQuery(linhas, searchParams) {
  let resultado = linhas;
  for (const [chave, valor] of searchParams.entries()) {
    if (
      ["select", "order", "limit", "offset", "or", "abortSignal"].includes(
        chave,
      )
    )
      continue;
    if (valor.startsWith("eq.")) {
      const alvo = valor.slice(3);
      // eslint-disable-next-line security/detect-object-injection -- `chave` é o nome de coluna da query string do PRÓPRIO harness (nunca do navegador real), só leitura, nunca grava nada.
      resultado = resultado.filter((linha) => String(linha?.[chave]) === alvo);
    } else if (valor === "is.null") {
      resultado = resultado.filter(
        // eslint-disable-next-line security/detect-object-injection -- mesma garantia acima.
        (linha) => linha?.[chave] === null || linha?.[chave] === undefined,
      );
    }
  }
  return resultado;
}

/**
 * Responde `/rest/v1/<tabela>` como um PostgREST simplificado, sobre um
 * array MUTÁVEL (as mutações de POST/PATCH/DELETE alteram o array in-place —
 * útil se algum estado de tela grava algo no meio do caminho; nenhuma tela
 * do harness hoje depende disso, mas evita crash silencioso).
 */
async function responderTabela(rota, arrayMutavel, urlObj, log) {
  const pedido = rota.request();
  const metodo = pedido.method();
  const aceitaObjeto = (pedido.headers().accept || "").includes(
    "vnd.pgrst.object",
  );

  if (metodo === "GET" || metodo === "HEAD") {
    const filtradas = filtrarPorQuery(arrayMutavel, urlObj.searchParams);
    if (aceitaObjeto) {
      await rota.fulfill({
        status: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify(filtradas[0] ?? null),
      });
      return;
    }
    await rota.fulfill({
      status: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify(filtradas),
    });
    return;
  }

  let corpo = [];
  try {
    corpo = pedido.postDataJSON();
  } catch {
    corpo = null;
  }

  if (metodo === "POST") {
    const itens = Array.isArray(corpo) ? corpo : corpo ? [corpo] : [];
    const inseridos = itens.map((item) => ({
      id: item.id ?? `harness-${Math.random().toString(36).slice(2, 10)}`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...item,
    }));
    arrayMutavel.push(...inseridos);
    await rota.fulfill({
      status: 201,
      headers: JSON_HEADERS,
      body: JSON.stringify(aceitaObjeto ? (inseridos[0] ?? null) : inseridos),
    });
    return;
  }

  if (metodo === "PATCH") {
    const alvos = filtrarPorQuery(arrayMutavel, urlObj.searchParams);
    for (const linha of alvos) Object.assign(linha, corpo ?? {});
    await rota.fulfill({
      status: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify(aceitaObjeto ? (alvos[0] ?? null) : alvos),
    });
    return;
  }

  if (metodo === "DELETE") {
    const alvos = filtrarPorQuery(arrayMutavel, urlObj.searchParams);
    for (const linha of alvos) {
      const idx = arrayMutavel.indexOf(linha);
      if (idx !== -1) arrayMutavel.splice(idx, 1);
    }
    await rota.fulfill({
      status: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify(alvos),
    });
    return;
  }

  log.avisos.push(`[rede] método sem tratamento: ${metodo} ${urlObj.pathname}`);
  await rota.fulfill({ status: 200, headers: JSON_HEADERS, body: "[]" });
}

/**
 * Instala as rotas do cenário nesta `page`. `estado` é o pacote mutável de
 * fixtures (endereços, favoritos, carrinho, notificações, pedidos — ver
 * `criarEstadoDoCliente` em fixtures.mjs) e `sessao` diz se — e como — a
 * pessoa está logada.
 */
export async function instalarRede(
  page,
  { origemDoPreview, host, estado, sessao, log },
) {
  const ficha = montarFicha(host, origemDoPreview);

  await page.route("**/*", async (rota) => {
    try {
      await tratarRota(rota, { origemDoPreview, ficha, estado, sessao, log });
    } catch (erro) {
      // Uma exceção aqui dentro faria o Playwright abortar a requisição —
      // e o lado do app veria "TypeError: Failed to fetch" sem pista
      // nenhuma de qual rota falhou. Registra e devolve algo inofensivo em
      // vez de deixar a página quebrada por um bug do PRÓPRIO harness.
      log.avisos.push(
        `[rede] exceção tratando ${rota.request().url()}: ${erro?.stack ?? erro}`,
      );
      await rota
        .fulfill({ status: 200, headers: JSON_HEADERS, body: "null" })
        .catch(() => {});
    }
  });

  if (typeof page.routeWebSocket === "function") {
    try {
      await page.routeWebSocket(/.*/, (ws) => {
        if (!ws.url().startsWith(origemDoPreview)) {
          log.bloqueados.push(`ws:${ws.url()}`);
        }
        ws.close();
      });
    } catch (erro) {
      log.avisos.push(`[rede] routeWebSocket indisponível: ${String(erro)}`);
    }
  }
}

async function tratarRota(
  rota,
  { origemDoPreview, ficha, estado, sessao, log },
) {
  const pedido = rota.request();
  let url;
  try {
    url = new URL(pedido.url());
  } catch {
    await rota.abort();
    return;
  }

  // 1) Documento do próprio preview: injeta a ficha da loja no <head>.
  if (pedido.resourceType() === "document" && url.origin === origemDoPreview) {
    const resposta = await rota.fetch();
    const corpo = (await resposta.text()).replace(
      "<head>",
      `<head><script type="application/json" id="ikcous-loja">${ficha}</script>`,
    );
    await rota.fulfill({
      status: resposta.status(),
      headers: { "content-type": "text/html; charset=utf-8" },
      body: corpo,
    });
    return;
  }

  // 2) Ficha em JSON puro (caminho do service worker/porteiro).
  if (url.origin === origemDoPreview && url.pathname === "/identidade.json") {
    await rota.fulfill({ status: 200, headers: JSON_HEADERS, body: ficha });
    return;
  }

  // 3) Qualquer outro estático do próprio preview: deixa passar.
  if (url.origin === origemDoPreview) {
    await rota.fallback();
    return;
  }

  // 4) Fora do banco fixture: bloqueia e registra (nada sai para a
  // internet — nem o Chromium, por causa do host-resolver-rules, chegaria
  // a resolver o host de verdade).
  if (url.origin !== ORIGEM_BANCO_FIXTURA) {
    log.bloqueados.push(url.toString());
    // ACHADO REAL DA PROVA DE DETERMINISMO: um `<iframe>` de origem externa
    // (o mapa em AboutStoreView) que recebe `route.abort()` cai na página
    // de ERRO INTERNA do PRÓPRIO Chromium ("não foi possível acessar este
    // site") — layout/fonte/timing PRÓPRIOS, fora do nosso controle, que
    // renderizavam ligeiramente diferente a cada carga de PROCESSO do
    // Chromium. Como o mapa fica embaixo de um badge com 90% de opacidade,
    // essa diferença vazava por baixo dele no blend alfa. O frame externo
    // continua BLOQUEADO (o Google nunca aparece), mas com um HTML em
    // branco NOSSO — 200 OK, sem página de erro do navegador.
    if (pedido.resourceType() === "document") {
      await rota.fulfill({
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
        body: "<!doctype html><html><head></head><body></body></html>",
      });
      return;
    }
    await rota.abort();
    return;
  }

  // 5) Storage — qualquer imagem da marca/produto/banner. PNG 1x1 (nada de
  // rede; o que importa para o diff é geometria, não textura).
  if (
    url.pathname.startsWith("/storage/v1/object/public/") ||
    url.pathname.startsWith("/storage/v1/render/image/public/")
  ) {
    await rota.fulfill({
      status: 200,
      headers: {
        "content-type": "image/png",
        "cache-control": "public, max-age=31536000",
      },
      body: PNG_1X1,
    });
    return;
  }

  // 6) Auth.
  if (url.pathname === "/auth/v1/user") {
    if (!sessao) {
      await rota.fulfill({
        status: 401,
        headers: JSON_HEADERS,
        body: JSON.stringify({ message: "sem sessão" }),
      });
      return;
    }
    await rota.fulfill({
      status: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify(usuarioFixtura(sessao === "admin")),
    });
    return;
  }
  if (url.pathname === "/auth/v1/token") {
    await rota.fulfill({
      status: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify(sessaoFixtura(sessao === "admin")),
    });
    return;
  }
  if (url.pathname === "/auth/v1/logout") {
    await rota.fulfill({ status: 204, body: "" });
    return;
  }

  // 7) RPCs.
  if (url.pathname.startsWith("/rest/v1/rpc/")) {
    const nome = url.pathname.slice("/rest/v1/rpc/".length);
    let args = {};
    try {
      args = pedido.postDataJSON() ?? {};
    } catch {
      args = {};
    }
    const resposta = await responderRpc(nome, args, { sessao, estado });
    await rota.fulfill({
      status: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify(resposta),
    });
    return;
  }

  // 8) Edge functions.
  if (url.pathname === "/functions/v1/calculate-shipping") {
    let cep = "";
    try {
      cep = String(pedido.postDataJSON()?.cep ?? "").replace(/\D/g, "");
    } catch {
      cep = "";
    }
    const opcoes =
      cep === "38500000"
        ? [
            {
              id: "local-delivery",
              name: "Entrega local",
              price: 10,
              deliveryDays: 1,
              provider: "local",
            },
          ]
        : [
            {
              id: "melhorenvio-pac",
              name: "PAC",
              price: 24.9,
              deliveryDays: 6,
              provider: "melhor_envio",
            },
          ];
    await rota.fulfill({
      status: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({ options: opcoes }),
    });
    return;
  }

  // 9) Tabelas conhecidas.
  const nomeTabela = url.pathname.startsWith("/rest/v1/")
    ? url.pathname.slice("/rest/v1/".length)
    : null;
  if (nomeTabela) {
    const tabela = tabelaPara(nomeTabela, estado);
    if (tabela) {
      await responderTabela(rota, tabela, url, log);
      return;
    }
    // Tabela sem fixture — lista vazia, nunca quebra a tela.
    log.avisos.push(`[rede] tabela sem fixture: ${nomeTabela}`);
    await rota.fulfill({ status: 200, headers: JSON_HEADERS, body: "[]" });
    return;
  }

  // 10) Qualquer outra coisa dentro do banco fixture (ex.: WebSocket de
  // realtime tentando um upgrade HTTP): recusa sem derrubar a página.
  await rota.fulfill({ status: 404, headers: JSON_HEADERS, body: "{}" });
}

function tabelaPara(nomeTabela, estado) {
  switch (nomeTabela) {
    case "v_store_config":
    case "store_config":
      return [linhaConfig()];
    case "config_pagamento_cartao":
      return [linhaConfigDoCartao()];
    case "categorias":
      return linhasCategorias();
    case "banners":
      return linhasBanners();
    case "vw_produtos_public":
    case "vw_produtos_admin":
    case "produtos":
      return PRODUTOS;
    case "product_variants":
      return PRODUTOS.flatMap((p) => p.product_variants);
    case "user_addresses":
      return estado.enderecos;
    case "favorites":
      return estado.favoritos;
    case "cart_items":
      return estado.cartItems;
    case "notificacoes":
      return estado.notificacoes;
    case "marketplace_orders":
      return estado.pedidos;
    case "public_profiles":
    case "profiles":
    // Q&A e avaliações: fora do escopo deste harness (loja fixture nasce
    // com enable_reviews:false) — vazio de propósito, nunca "sem fixture".
    case "vw_questions_public":
    case "reviews":
    case "review_votes":
    case "coupons":
    case "push_subscriptions":
    case "analytics_events":
      return [];
    default:
      return null;
  }
}

async function responderRpc(nome, _args, { sessao, estado: _estado }) {
  switch (nome) {
    case "is_admin":
      return sessao === "admin";
    case "get_my_complete_profile":
      return [
        {
          id:
            sessao === "admin"
              ? "00000000-0000-4000-8000-0000000adm00"
              : "00000000-0000-4000-8000-0000000c11e0",
          full_name: sessao === "admin" ? "Admin da Loja" : "Camila Ferreira",
          avatar_url: "",
          cover_url: "",
          role: sessao === "admin" ? "admin" : "customer",
          whatsapp: "31999998888",
          created_at: "2026-03-01T00:00:00.000Z",
        },
      ];
    case "update_my_profile_secure":
      return null;
    case "get_my_cpf":
      return null;
    case "set_my_cpf":
      return true;
    case "sync_cart_atomic":
      return null;
    case "devolucao_elegibilidade": {
      // Forma exigida por `lerElegibilidade` (src/lib/devolucao.ts) — sem
      // ESTES campos ela devolve `null` e a tela some com a seção inteira,
      // em silêncio (nenhum erro visível, só a ausência). Pedido entregue
      // fixture (PEDIDO_ENTREGUE, 1 item: Tênis Branco Casual).
      const tenis = PRODUTOS.find((p) => p.id === "prod-tenis-branco");
      return {
        pode: true,
        motivo_bloqueio: null,
        entregue_em: "2026-09-13T13:00:00.000Z",
        dias_desde_entrega: 15,
        modalidade: "local",
        metodos: ["entrega_na_loja", "coleta"],
        prazos: {
          arrependimento_ate: null,
          troca_ate: "2026-10-13T13:00:00.000Z",
          vicio_ate: "2026-12-12T13:00:00.000Z",
        },
        janelas: { arrependimento: false, troca: true, vicio: true },
        itens: [
          {
            order_item_id: "item-tenis-branco",
            product_id: tenis.id,
            product_name: tenis.nome,
            image_url: tenis.imagem_urls[0],
            quantidade: 1,
            ja_devolvida: 0,
            disponivel: 1,
            valor_unitario: tenis.preco_venda,
          },
        ],
        politica: {
          prazo_arrependimento_dias: 7,
          prazo_troca_dias: 30,
          prazo_vicio_dias: 90,
          aceita_troca: true,
          aceita_vale: true,
          exige_fotos_vicio: true,
          metodos_locais: ["entrega_na_loja", "coleta"],
          metodos_nacionais: ["etiqueta_reversa", "envio_proprio"],
          reembolso_momento: "apos_inspecao",
        },
      };
    }
    case "devolucoes_do_pedido":
      return [];
    case "devolucao_detalhe":
      return null;
    default:
      return null;
  }
}

export function criarEstadoDoCliente({
  enderecos,
  favoritos,
  cartItems,
  notificacoes,
  pedidos,
}) {
  return {
    enderecos: [...enderecos],
    favoritos: [...favoritos],
    cartItems: [...cartItems],
    notificacoes: [...notificacoes],
    pedidos: [...pedidos],
  };
}

export { linhasNotificacoes, linhasPedidos };
