import { type Page, type Request, type Route, expect } from "@playwright/test";
import {
  PRODUTO_ACESSORIOS,
  abrirLoja,
  enderecosFixtura,
  fichaDaLojaFixtura,
  instalarLojaFixtura,
  instalarSessaoClienteFixtura,
} from "./kit-jornadas";

/**
 * KIT DAS JORNADAS DE PAGAMENTO (04/10/2026).
 *
 * Em cima do kit das jornadas (`kit-jornadas.ts`: loja fixture + cliente
 * logado FALSO), liga o pagamento pelo app e põe no lugar do servidor um
 * SIMULADOR determinístico, em memória, dono de tudo o que o pagamento toca:
 *
 *  - o "banco" dos pedidos (`create_marketplace_order_v24`, leituras de
 *    `marketplace_orders`, `config_pagamento_cartao`);
 *  - a edge `criar-pagamento` (métodos `pix`, `cartao` e `verificar`), cuja
 *    resposta é escrita POR TESTE;
 *  - o SDK do Mercado Pago (o script de `sdk.mercadopago.com` responde vazio;
 *    o global `MercadoPago` é um DUBLÊ instalado por `addInitScript`, com a
 *    MESMA forma do dublê dos testes de unidade —
 *    `tests/front/pagamento-com-cartao.test.tsx`, `instalarSdkFalso`), o
 *    `security.js` do Device ID e as páginas do desafio 3DS;
 *  - o websocket do realtime (aceito e mudo: nenhum evento chega, e quem
 *    descobre o pedido pago é a verificação periódica de 10 s da tela).
 *
 * NADA sai para a rede: o roteador de guarda (registrado POR ÚLTIMO, então
 * roda PRIMEIRO — Playwright executa a rota mais nova antes) aborta e REGISTRA
 * qualquer requisição a uma origem não prevista; cada jornada exige essa
 * lista vazia no fim. O service worker é bloqueado nos specs
 * (`serviceWorkers: "block"`): requisição feita por ele não passaria pelas
 * rotas da página, e a jornada não depende dele.
 *
 * O que este simulador NÃO é: a edge real, o banco real, o Mercado Pago real.
 * Ele prova o que a TELA faz com cada resposta, e quantas vezes ela pergunta
 * — nunca que o servidor responde assim.
 */

const ORIGEM_DO_PREVIEW = "http://127.0.0.1:4173";
// Mesma origem do kit das jornadas (REF_FIXTURA de `kit-jornadas.ts`).
const ORIGEM_DO_BANCO = "https://jornadase2efixture01.supabase.co";

// Chave PÚBLICA FICTÍCIA de formato aceito pela ficha (string não vazia).
// Nunca tocou um Mercado Pago: o SDK que a receberia é o dublê abaixo.
const CHAVE_PUBLICA_MP_FICTICIA = "TEST-chave-ficticia-das-jornadas-e2e";

export const URL_DO_SDK_MP = "https://sdk.mercadopago.com/js/v2";
const URL_DO_SECURITY_JS = "https://www.mercadopago.com/v2/security.js";
const URL_DA_FONTE_DO_GOOGLE = "https://fonts.googleapis.com/css2?";

/** Página do desafio 3DS simulada — host do Mercado Pago, servida pelo teste. */
export const URL_DO_DESAFIO_3DS =
  "https://desafio-simulado.mercadopago.com.br/3ds/challenge?sim=jornadas";
/** Host que IMITA o Mercado Pago (sufixo enganoso) — a tela tem de ignorar. */
export const URL_DE_ORIGEM_IMPOSTORA =
  "https://mercadopago.com.golpe-simulado.example/pagina";

const ID_CLIENTE_FIXTURA = "00000000-0000-4000-8000-00000000c11e";

/** WhatsApp FICTÍCIO (DDD 34 + 9 dígitos) — o perfil fixture não tem um. */
export const WHATSAPP_FICTICIO = "34999990000";

const JSON_HEADERS = { "content-type": "application/json" };

const PNG_1X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

export const CODIGO_PIX_SIMULADO =
  "00020126580014br.gov.bcb.pix0136simulado-jornadas-e2e-nao-pagavel5204000053039865802BR6304ABCD";

export interface PedidoSimulado {
  id: string;
  total: number;
  status: string;
  payment_status: string;
  metodo_online: string | null;
  gateway_payment_id: string | null;
  expires_at: string;
  created_at: string;
}

/** Corpo que a tela mandou à edge — o que o teste confere. */
export type CorpoDoPagamento = {
  orderId?: string;
  metodo?: string;
  token?: string;
  paymentTypeId?: string;
  parcelas?: number;
  [campo: string]: unknown;
};

export interface RespostaDaEdge {
  status: number;
  corpo: unknown;
}

export interface SimuladorDePagamento {
  readonly pedidos: Map<string, PedidoSimulado>;
  /** Cada POST à edge `criar-pagamento`, na ordem em que chegou. */
  readonly chamadasDoPagamento: CorpoDoPagamento[];
  /** Cada chamada às RPCs de criação de pedido (v23 e v24). */
  readonly criacoesDePedido: { rpc: string; corpo: unknown }[];
  /** Leituras de `marketplace_orders` (o `select` de cada uma). */
  readonly leiturasDePedido: { select: string; falhou: boolean }[];
  /** Requisições a origens NÃO previstas — abortadas. Tem de ficar vazia. */
  readonly naoPrevistas: string[];
  /** URLs simuladas de terceiros que o navegador pediu (SDK, 3DS...). */
  readonly terceirosAtendidos: string[];
  /** Maior número de POSTs de cartão em voo ao mesmo tempo. */
  maximoDeCartoesEmVoo: number;
  /** Quantas leituras da RETOMADA (select com `metodo_online`) devem falhar. */
  falharLeiturasDaRetomada: number;
  /** Atraso artificial da resposta da criação do pedido (clique duplo). */
  atrasoDaCriacaoMs: number;
  /** Atraso artificial de cada resposta da edge. */
  atrasoDaEdgeMs: number;
  /** A resposta da edge — escrita por teste. */
  responderPagamento: (
    corpo: CorpoDoPagamento,
    sim: SimuladorDePagamento,
  ) => RespostaDaEdge;
  /** "O webhook confirmou": o pedido passa a pago no banco simulado. */
  marcarPago: (orderId: string) => void;
  /** Quantos POSTs com este `metodo` chegaram. */
  contarPagamentos: (metodo: string) => number;
}

/** O pedido mais recente criado pela tela (falha alto se nenhum). */
export function ultimoPedido(sim: SimuladorDePagamento): PedidoSimulado {
  const pedido = Array.from(sim.pedidos.values()).at(-1);
  if (!pedido) throw new Error("Nenhum pedido no banco simulado.");
  return pedido;
}

// ── Respostas prontas da edge (o CONTRATO lido em useOrders.ts:
// `RespostaCriarPagamento`; os erros como `criarPagamento` os lê do corpo) ──

export function respostaPixComQr(orderId: string): RespostaDaEdge {
  return {
    status: 200,
    corpo: {
      paymentId: `pix-simulado-${orderId.slice(-4)}`,
      statusPagamento: "aguardando",
      expiraEm: new Date(Date.now() + 30 * 60_000).toISOString(),
      qrCode: CODIGO_PIX_SIMULADO,
      qrCodeBase64: PNG_1X1_BASE64,
    },
  };
}

export function respostaCartaoPago(orderId: string): RespostaDaEdge {
  return {
    status: 200,
    corpo: {
      paymentId: `cartao-simulado-${orderId.slice(-4)}`,
      statusPagamento: "pago",
      expiraEm: new Date(Date.now() + 30 * 60_000).toISOString(),
    },
  };
}

export const MOTIVO_DA_RECUSA_SIMULADA =
  "Cartão recusado pelo banco (simulado). Tente outro cartão ou pague com PIX.";

export function respostaCartaoRecusado(): RespostaDaEdge {
  return {
    status: 200,
    corpo: {
      paymentId: null,
      statusPagamento: "recusado",
      expiraEm: new Date(Date.now() + 30 * 60_000).toISOString(),
      motivoRecusa: MOTIVO_DA_RECUSA_SIMULADA,
      podeTentarDeNovo: true,
    },
  };
}

export function respostaDesafio3ds(paymentId: string): RespostaDaEdge {
  return {
    status: 200,
    corpo: {
      paymentId,
      statusPagamento: "aguardando",
      expiraEm: new Date(Date.now() + 30 * 60_000).toISOString(),
      desafio3ds: { url: URL_DO_DESAFIO_3DS },
    },
  };
}

/** O 503 da edge sem credencial do MP AGORA — marcado `terminal: true`. */
export function respostaIndisponivel503(): RespostaDaEdge {
  return {
    status: 503,
    corpo: { error: "Pagamento indisponível.", terminal: true },
  };
}

function respostaInesperada(corpo: CorpoDoPagamento): RespostaDaEdge {
  return {
    status: 500,
    corpo: {
      error: `Simulador: nenhuma resposta escrita para ${String(corpo.metodo)}.`,
    },
  };
}

/**
 * O DUBLÊ do SDK do Mercado Pago, dentro do navegador. Mesma forma do dublê
 * de unidade: `new MercadoPago(chave)` → `{ bricks: () => ({ create }) }` e
 * `create()` devolve `{ unmount }`. O "formulário" é UM botão dentro do
 * contêiner que o app entregou ao Brick; tocar nele chama o `onSubmit` do app
 * com um CardData FICTÍCIO (token de uso único novo a cada envio).
 */
function instalarDubleDoMercadoPago() {
  type Ajustes = {
    callbacks: {
      onReady: () => void;
      onSubmit: (dados: unknown, adicionais: unknown) => Promise<unknown>;
    };
  };
  const estado = {
    chaves: [] as string[],
    criados: 0,
    desmontados: 0,
    envios: 0,
    enviosQueFalharam: 0,
  };
  (window as unknown as { __mpSimulado: typeof estado }).__mpSimulado = estado;

  function MercadoPagoSimulado(chave: string) {
    estado.chaves.push(chave);
    return {
      bricks: () => ({
        create: async (
          _tipo: string,
          idDoContainer: string,
          ajustes: Ajustes,
        ) => {
          estado.criados += 1;
          const container = document.getElementById(idDoContainer);
          if (!container) throw new Error("contêiner do Brick ausente");
          const botao = document.createElement("button");
          botao.type = "button";
          botao.textContent = "Pagar com o cartão simulado";
          botao.dataset.testid = "cartao-simulado-pagar";
          botao.addEventListener("click", () => {
            estado.envios += 1;
            const n = estado.envios;
            ajustes.callbacks
              .onSubmit(
                {
                  token: `tok-simulado-${n}`,
                  payment_method_id: "master",
                  payment_type_id: "credit_card",
                  installments: 1,
                  payer: {
                    email: "cliente.jornada@exemplo.invalid",
                    identification: { type: "CPF", number: "000.000.001-91" },
                  },
                },
                { paymentTypeId: "credit_card" },
              )
              .catch(() => {
                // O app RELANÇA erro para o Brick sair do "processando" — o
                // Brick real engole; o dublê só conta.
                estado.enviosQueFalharam += 1;
              });
          });
          container.appendChild(botao);
          setTimeout(() => ajustes.callbacks.onReady(), 0);
          return {
            unmount: () => {
              estado.desmontados += 1;
              botao.remove();
            },
          };
        },
      }),
    };
  }
  (window as unknown as { MercadoPago: unknown }).MercadoPago =
    MercadoPagoSimulado;
}

function linhaDoPedido(pedido: PedidoSimulado) {
  return {
    ...pedido,
    user_id: ID_CLIENTE_FIXTURA,
    customer_name: "Cliente das Jornadas",
    customer_data: {
      name: "Cliente das Jornadas",
      whatsapp: WHATSAPP_FICTICIO,
    },
    subtotal: pedido.total,
    shipping: 0,
    discount: 0,
    payment_method: "online",
    notes: null,
    coupon_code: null,
    tracking_code: null,
    updated_at: pedido.created_at,
    items: [],
    address: null,
  };
}

function corpoJson(pedido: Request): unknown {
  try {
    return pedido.postDataJSON();
  } catch {
    return null;
  }
}

function esperar(ms: number) {
  return new Promise((resolver) => setTimeout(resolver, ms));
}

/**
 * Instala loja + cliente logado + pagamento ligado + simulador. Chamar UMA vez
 * por teste, antes do primeiro `goto`. `pedidosIniciais` semeia o banco
 * (retomada).
 */
export async function instalarPagamentoSimulado(
  page: Page,
  opcoes: { pedidosIniciais?: PedidoSimulado[] } = {},
): Promise<SimuladorDePagamento> {
  const sim: SimuladorDePagamento = {
    pedidos: new Map(
      (opcoes.pedidosIniciais ?? []).map((p) => [p.id, { ...p }]),
    ),
    chamadasDoPagamento: [],
    criacoesDePedido: [],
    leiturasDePedido: [],
    naoPrevistas: [],
    terceirosAtendidos: [],
    maximoDeCartoesEmVoo: 0,
    falharLeiturasDaRetomada: 0,
    atrasoDaCriacaoMs: 0,
    atrasoDaEdgeMs: 150,
    responderPagamento: respostaInesperada,
    marcarPago: (orderId) => {
      const pedido = sim.pedidos.get(orderId);
      if (!pedido) throw new Error(`Pedido ${orderId} não está no simulador.`);
      pedido.payment_status = "pago";
    },
    contarPagamentos: (metodo) =>
      sim.chamadasDoPagamento.filter((c) => c.metodo === metodo).length,
  };
  let cartoesEmVoo = 0;

  // A ficha da loja fixture com o pagamento pelo app LIGADO e uma chave
  // pública fictícia — a mesma ficha validada contra o contrato real pelo
  // kit, só com `configuracao` trocada.
  const fichaBase = JSON.parse(await fichaDaLojaFixtura()) as {
    configuracao: Record<string, unknown>;
  };
  fichaBase.configuracao = {
    mpPublicKey: CHAVE_PUBLICA_MP_FICTICIA,
    vapidPublicKey: null,
    pagamentoOnline: true,
    manutencao: false,
  };
  const ficha = JSON.stringify(fichaBase).replaceAll("</", "<\\/");

  await instalarLojaFixtura(page);
  await instalarSessaoClienteFixtura(page, {
    enderecos: enderecosFixtura(1),
  });
  await page.addInitScript(instalarDubleDoMercadoPago);

  // ── O banco e a edge simulados (rodam ANTES do kit da sessão e da loja) ──
  await page.route(`${ORIGEM_DO_BANCO}/**`, async (rota: Route) => {
    const pedido = rota.request();
    const url = new URL(pedido.url());
    const responder = (corpo: unknown, status = 200) =>
      rota.fulfill({
        status,
        headers: JSON_HEADERS,
        body: JSON.stringify(corpo),
      });

    // A conta fixture não tem CPF guardado (a RPC real devolve `text|null`;
    // o "[]" genérico do kit chegaria à tela como CPF e quebraria a máscara).
    if (url.pathname === "/rest/v1/rpc/get_my_cpf") {
      await responder(null);
      return;
    }

    if (url.pathname === "/rest/v1/config_pagamento_cartao") {
      await responder([{ credito: true, debito: false, parcelas_max: 1 }]);
      return;
    }

    if (
      url.pathname === "/rest/v1/rpc/create_marketplace_order_v24" ||
      url.pathname === "/rest/v1/rpc/create_marketplace_order_v23"
    ) {
      const corpo = corpoJson(pedido) as { p_total_amount?: number } | null;
      sim.criacoesDePedido.push({
        rpc: url.pathname.split("/").at(-1) ?? "",
        corpo,
      });
      const numero = sim.criacoesDePedido.length;
      const id = `00000000-0000-4000-8000-000000e2e${String(numero).padStart(3, "0")}`;
      const agora = new Date();
      sim.pedidos.set(id, {
        id,
        total: Number(corpo?.p_total_amount ?? 0),
        status: "pending",
        payment_status: "aguardando",
        metodo_online: null,
        gateway_payment_id: null,
        expires_at: new Date(agora.getTime() + 30 * 60_000).toISOString(),
        created_at: agora.toISOString(),
      });
      if (sim.atrasoDaCriacaoMs > 0) await esperar(sim.atrasoDaCriacaoMs);
      await responder(id);
      return;
    }

    if (url.pathname === "/rest/v1/marketplace_orders") {
      if (pedido.method() !== "GET") {
        // Nenhuma jornada daqui escreve no pedido pelo REST: escrita é
        // não prevista (fica registrada e o teste falha).
        sim.naoPrevistas.push(
          `${pedido.method()} ${url.pathname}${url.search}`,
        );
        await rota.abort("blockedbyclient");
        return;
      }
      const select = url.searchParams.get("select") ?? "";
      const ehLeituraDaRetomada = select.includes("metodo_online");
      if (ehLeituraDaRetomada && sim.falharLeiturasDaRetomada > 0) {
        sim.falharLeiturasDaRetomada -= 1;
        sim.leiturasDePedido.push({ select, falhou: true });
        await responder(
          {
            code: "XX000",
            message: "falha simulada da leitura",
            details: null,
            hint: null,
          },
          500,
        );
        return;
      }
      sim.leiturasDePedido.push({ select, falhou: false });
      const filtroId = url.searchParams.get("id");
      // Todo pedido do simulador é do cliente fixture: filtro de OUTRO dono
      // não vê nada (o que a RLS real faria).
      const filtroDono = url.searchParams.get("user_id");
      const donoConfere =
        !filtroDono || filtroDono === `eq.${ID_CLIENTE_FIXTURA}`;
      const linhas = Array.from(sim.pedidos.values())
        .filter((p) => donoConfere && (!filtroId || filtroId === `eq.${p.id}`))
        .reverse()
        .map(linhaDoPedido);
      const querObjeto = (pedido.headers().accept ?? "").includes(
        "vnd.pgrst.object",
      );
      if (!querObjeto) {
        await responder(linhas);
        return;
      }
      if (linhas.length !== 1) {
        await responder(
          {
            code: "PGRST116",
            message: "JSON object requested, multiple (or no) rows returned",
            details: null,
            hint: null,
          },
          406,
        );
        return;
      }
      await responder(linhas[0]);
      return;
    }

    if (url.pathname === "/functions/v1/criar-pagamento") {
      const corpo = (corpoJson(pedido) ?? {}) as CorpoDoPagamento;
      sim.chamadasDoPagamento.push(corpo);
      const ehCartao = corpo.metodo === "cartao";
      if (ehCartao) {
        cartoesEmVoo += 1;
        sim.maximoDeCartoesEmVoo = Math.max(
          sim.maximoDeCartoesEmVoo,
          cartoesEmVoo,
        );
      }
      try {
        const resposta = sim.responderPagamento(corpo, sim);
        if (sim.atrasoDaEdgeMs > 0) await esperar(sim.atrasoDaEdgeMs);
        await responder(resposta.corpo, resposta.status);
      } finally {
        if (ehCartao) cartoesEmVoo -= 1;
      }
      return;
    }

    await rota.fallback();
  });

  // ── O realtime: aceito e MUDO (nunca conecta a servidor nenhum) ──
  await page.routeWebSocket(/.*/, (ws) => {
    const url = new URL(ws.url());
    if (
      url.origin.replace(/^wss:/, "https:") !== ORIGEM_DO_BANCO ||
      !url.pathname.startsWith("/realtime/")
    ) {
      sim.naoPrevistas.push(`websocket ${ws.url()}`);
      ws.close();
    }
    // Sem `connectToServer()`: nada sai para a rede; nada responde.
  });

  // ── Guarda (registrada por ÚLTIMO, roda PRIMEIRO) ──
  await page.route("**/*", async (rota: Route) => {
    const pedido = rota.request();
    const url = new URL(pedido.url());

    if (url.origin === ORIGEM_DO_PREVIEW) {
      // A ficha com o pagamento ligado vai no HTML e no JSON do porteiro.
      if (pedido.resourceType() === "document") {
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
      if (url.pathname === "/identidade.json") {
        await rota.fulfill({ status: 200, headers: JSON_HEADERS, body: ficha });
        return;
      }
      await rota.fallback();
      return;
    }

    if (url.origin === ORIGEM_DO_BANCO) {
      await rota.fallback();
      return;
    }

    if (pedido.url().startsWith(URL_DA_FONTE_DO_GOOGLE)) {
      // A fonte Inter do index.html: CSS vazio (a tela cai na fonte do
      // sistema). Prevista, mas nunca vai à rede.
      sim.terceirosAtendidos.push(pedido.url());
      await rota.fulfill({
        status: 200,
        headers: { "content-type": "text/css" },
        body: "/* fonte simulada (jornadas e2e) */",
      });
      return;
    }
    if (pedido.url() === URL_DO_SDK_MP) {
      sim.terceirosAtendidos.push(pedido.url());
      // O global vem do dublê (`addInitScript`); o script só precisa
      // carregar para o `load` do carregador do app disparar.
      await rota.fulfill({
        status: 200,
        headers: { "content-type": "application/javascript" },
        body: "/* SDK do Mercado Pago SIMULADO (jornadas e2e) */",
      });
      return;
    }
    if (pedido.url() === URL_DO_SECURITY_JS) {
      sim.terceirosAtendidos.push(pedido.url());
      await rota.fulfill({
        status: 200,
        headers: { "content-type": "application/javascript" },
        body: 'window.MP_DEVICE_SESSION_ID = "dispositivo-simulado-e2e";',
      });
      return;
    }
    if (
      pedido.url() === URL_DO_DESAFIO_3DS ||
      pedido.url() === URL_DE_ORIGEM_IMPOSTORA
    ) {
      sim.terceirosAtendidos.push(pedido.url());
      await rota.fulfill({
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
        body: "<!doctype html><title>desafio simulado</title><p>Desafio 3DS simulado</p>",
      });
      return;
    }

    sim.naoPrevistas.push(`${pedido.method()} ${pedido.url()}`);
    await rota.abort("blockedbyclient");
  });

  return sim;
}

/**
 * Do zero até a tela "Finalize o pagamento": abre a loja (boot verificado
 * pelo kit), põe o Boné no carrinho, vai ao checkout, preenche o WhatsApp
 * fictício, escolhe a forma pelo app e toca "Finalizar pedido" UMA vez (ou
 * duas, num clique duplo; ou nenhuma, para o teste disparar o clique à mão).
 */
export async function abrirLojaEFinalizar(
  page: Page,
  forma: "pix" | "cartao",
  opcoes: { cliqueDuplo?: boolean; semClicar?: boolean } = {},
): Promise<() => { erros: string[] }> {
  const errosNoFim = await abrirLoja(page);

  const cardDoBone = page
    .locator("div.group")
    .filter({
      has: page.getByRole("button", { name: PRODUTO_ACESSORIOS, exact: true }),
    })
    .first();
  await cardDoBone.getByTestId("product-card-action").click();
  await page
    .getByRole("navigation", { name: "Navegação principal" })
    .getByRole("button", { name: /Carrinho/ })
    .click();
  await page.getByRole("button", { name: "Finalizar Compra" }).click();

  // O perfil fixture não tem WhatsApp: o cliente abre "Seus dados" e digita
  // um número FICTÍCIO (sem ele o "Finalizar pedido" fica apagado).
  await expect(page.getByText("Informe seu WhatsApp").first()).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Editar" }).first().click();
  await page
    .getByRole("textbox", { name: "WhatsApp para Contato" })
    .fill(WHATSAPP_FICTICIO);
  // Frete local cotado pelo kit da sessão (CEP principal → R$ 10).
  await expect(
    page.getByRole("region", { name: "Entrega e frete" }),
  ).toContainText("Entrega local", { timeout: 30_000 });

  const rotulo = forma === "pix" ? "Pagar agora com PIX" : "Cartão de crédito";
  const opcao = page.getByRole("radio", { name: rotulo });
  await opcao.click();
  await expect(opcao).toHaveAttribute("aria-checked", "true");

  const finalizar = page.getByRole("button", { name: "Finalizar pedido" });
  await expect(finalizar).toBeEnabled({ timeout: 30_000 });
  if (opcoes.semClicar) return errosNoFim;
  if (opcoes.cliqueDuplo) {
    await finalizar.dblclick();
  } else {
    await finalizar.click();
  }
  return errosNoFim;
}
