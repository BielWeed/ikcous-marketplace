import { type Page, type Request, type Route, expect } from "@playwright/test";
import {
  PRODUTO_ACESSORIOS,
  abrirLoja,
  buscarDocumentoDoPreview,
  enderecosFixtura,
  fichaDaLojaFixtura,
  instalarLojaFixtura,
  instalarSessaoClienteFixtura,
  requisicoesNaoPrevistas,
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
 *  - o websocket do realtime (o kit das jornadas o aceita MUDO: nenhum
 *    evento chega, e quem descobre o pedido pago é a verificação periódica de
 *    10 s da tela).
 *
 * NADA sai para a rede e NADA desconhecido é respondido: cada rota daqui é
 * uma LISTA BRANCA de MÉTODO + CAMINHO; o resto cai na guarda do kit das
 * jornadas (`kit-jornadas.ts`), que aborta, registra e faz o teste FALHAR no
 * `afterEach` (`exigirRedeSemImprevistos`). O service worker é bloqueado no
 * config das jornadas: requisição feita por ele não passaria pelas rotas da
 * página.
 *
 * Latência: a resposta da criação do pedido e a da edge podem ser SEGURADAS
 * por um `Portao` que o teste fecha e abre — a janela "com a chamada em voo"
 * existe por ESTADO, nunca por relógio.
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

/** O Device ID que o `security.js` simulado entrega (formato aceito pelo app). */
export const DEVICE_ID_SIMULADO = "dispositivo-simulado-e2e";

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
  /** Requisições NÃO previstas (a lista da guarda do kit). Tem de ficar vazia. */
  readonly naoPrevistas: string[];
  /** URLs simuladas de terceiros que o navegador pediu (SDK, 3DS...). */
  readonly terceirosAtendidos: string[];
  /** Maior número de POSTs de cartão em voo ao mesmo tempo. */
  maximoDeCartoesEmVoo: number;
  /** Quantas leituras da RETOMADA (select com `metodo_online`) devem falhar. */
  falharLeiturasDaRetomada: number;
  /** Segura a resposta da criação do pedido enquanto estiver FECHADO. */
  readonly portaoDaCriacao: Portao;
  /** Segura cada resposta da edge enquanto estiver FECHADO. */
  readonly portaoDaEdge: Portao;
  /** A resposta da edge — escrita por teste. */
  responderPagamento: (
    corpo: CorpoDoPagamento,
    sim: SimuladorDePagamento,
  ) => RespostaDaEdge;
  /** "O webhook confirmou": o pedido passa a pago no banco simulado. */
  marcarPago: (orderId: string) => void;
  /** Quantos POSTs com este `metodo` chegaram. */
  contarPagamentos: (metodo: string) => number;
  /** POSTs à edge por `metodo` (só os que chegaram) — para igualdade EXATA. */
  contagemPorMetodo: () => Record<string, number>;
}

/**
 * Um portão de LATÊNCIA controlada por estado: aberto, a resposta sai na
 * hora; fechado, toda resposta espera até `abrir()`. `parados` diz quantas
 * respostas estão seguradas agora — o teste espera ESTE número, nunca tempo.
 */
export class Portao {
  private aberto = true;
  private espera: Promise<void> = Promise.resolve();
  private soltar: () => void = () => {};
  parados = 0;

  fechar(): void {
    if (!this.aberto) return;
    this.aberto = false;
    this.espera = new Promise((resolver) => {
      this.soltar = resolver;
    });
  }

  abrir(): void {
    this.aberto = true;
    this.soltar();
  }

  async passar(): Promise<void> {
    if (this.aberto) return;
    this.parados += 1;
    try {
      await this.espera;
    } finally {
      this.parados -= 1;
    }
  }
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
    // A MESMA lista da guarda de rede do kit das jornadas.
    naoPrevistas: requisicoesNaoPrevistas(page),
    terceirosAtendidos: [],
    maximoDeCartoesEmVoo: 0,
    falharLeiturasDaRetomada: 0,
    portaoDaCriacao: new Portao(),
    portaoDaEdge: new Portao(),
    responderPagamento: respostaInesperada,
    marcarPago: (orderId) => {
      const pedido = sim.pedidos.get(orderId);
      if (!pedido) throw new Error(`Pedido ${orderId} não está no simulador.`);
      pedido.payment_status = "pago";
    },
    contarPagamentos: (metodo) =>
      sim.chamadasDoPagamento.filter((c) => c.metodo === metodo).length,
    contagemPorMetodo: () => {
      const contagem = new Map<string, number>();
      for (const c of sim.chamadasDoPagamento) {
        const metodo = String(c.metodo);
        contagem.set(metodo, (contagem.get(metodo) ?? 0) + 1);
      }
      return Object.fromEntries(contagem);
    },
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

  // ── O banco e a edge simulados: LISTA BRANCA de método + caminho. O que
  // não está aqui segue para os kits de baixo (sessão, loja), e o que nenhum
  // deles conhece é negado e registrado pela guarda do kit das jornadas.
  await page.route(`${ORIGEM_DO_BANCO}/**`, async (rota: Route) => {
    const pedido = rota.request();
    const url = new URL(pedido.url());
    const chave = `${pedido.method()} ${url.pathname}`;
    const responder = (corpo: unknown, status = 200) =>
      rota.fulfill({
        status,
        headers: JSON_HEADERS,
        body: JSON.stringify(corpo),
      });

    // A conta fixture não tem CPF guardado (a RPC real devolve `text|null`).
    if (chave === "POST /rest/v1/rpc/get_my_cpf") {
      await responder(null);
      return;
    }

    if (chave === "GET /rest/v1/config_pagamento_cartao") {
      await responder([{ credito: true, debito: false, parcelas_max: 1 }]);
      return;
    }

    // Só a v24 (pedido com pagamento pelo app). A v23 ("na entrega") NÃO
    // está na lista: se o app a chamar aqui, a guarda nega e o teste cai.
    if (chave === "POST /rest/v1/rpc/create_marketplace_order_v24") {
      const corpo = corpoJson(pedido) as { p_total_amount?: number } | null;
      sim.criacoesDePedido.push({
        rpc: "create_marketplace_order_v24",
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
      await sim.portaoDaCriacao.passar();
      await responder(id);
      return;
    }

    if (chave === "GET /rest/v1/marketplace_orders") {
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

    if (chave === "POST /functions/v1/criar-pagamento") {
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
        await sim.portaoDaEdge.passar();
        await responder(resposta.corpo, resposta.status);
      } finally {
        if (ehCartao) cartoesEmVoo -= 1;
      }
      return;
    }

    await rota.fallback();
  });

  // ── Terceiros SIMULADOS e a ficha com o pagamento ligado. Registrada por
  // ÚLTIMO, roda PRIMEIRO; o que não é dela segue para a guarda do kit. ──
  await page.route("**/*", async (rota: Route) => {
    const pedido = rota.request();
    const url = new URL(pedido.url());
    const ehGet = pedido.method() === "GET";

    if (url.origin === ORIGEM_DO_PREVIEW && ehGet) {
      // A ficha com o pagamento ligado vai no HTML e no JSON do porteiro.
      if (pedido.resourceType() === "document") {
        const resposta = await buscarDocumentoDoPreview(rota);
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
    }

    if (ehGet && pedido.url() === URL_DO_SDK_MP) {
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
    if (ehGet && pedido.url() === URL_DO_SECURITY_JS) {
      sim.terceirosAtendidos.push(pedido.url());
      await rota.fulfill({
        status: 200,
        headers: { "content-type": "application/javascript" },
        body: `window.MP_DEVICE_SESSION_ID = "${DEVICE_ID_SIMULADO}";`,
      });
      return;
    }
    if (
      ehGet &&
      (pedido.url() === URL_DO_DESAFIO_3DS ||
        pedido.url() === URL_DE_ORIGEM_IMPOSTORA)
    ) {
      sim.terceirosAtendidos.push(pedido.url());
      await rota.fulfill({
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
        body: "<!doctype html><title>desafio simulado</title><p>Desafio 3DS simulado</p>",
      });
      return;
    }

    await rota.fallback();
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

/**
 * Espera a TELA ASSENTAR — por estado, não por relógio: dá voltas no laço de
 * eventos do navegador (uma mensagem de `MessageChannel`, que é a mesma fila
 * em que o agendador do React trabalha, mais um quadro de animação) até uma
 * volta inteira passar SEM nenhuma mudança no DOM. Serve para afirmar uma
 * AUSÊNCIA ("o aviso ignorado não virou tela", "nada repetiu sozinho") só
 * depois de o app ter processado o que já estava na fila.
 *
 * Limite honesto: não pega o que o app agendaria por TEMPORIZADOR para
 * depois (um `setTimeout` de segundos); para isso valem as contagens
 * EXATAS no fim de cada jornada.
 */
export async function esperarTelaAssentar(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const pingar = () =>
      new Promise<void>((resolver) => {
        const canal = new MessageChannel();
        canal.port1.onmessage = () => resolver();
        canal.port2.postMessage(null);
      });
    const quadro = () =>
      new Promise<void>((resolver) => requestAnimationFrame(() => resolver()));
    let mudancas = 0;
    const observador = new MutationObserver((lista) => {
      mudancas += lista.length;
    });
    observador.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
    try {
      for (let volta = 0; volta < 200; volta += 1) {
        mudancas = 0;
        await pingar();
        await quadro();
        await pingar();
        if (mudancas === 0) return;
      }
      throw new Error("A tela não assentou em 200 voltas do laço de eventos.");
    } finally {
      observador.disconnect();
    }
  });
}

/**
 * UMA criação de pedido, pela v24 (pagamento pelo app), com o corpo EXATO
 * que o checkout monta para o Boné + entrega local do endereço principal.
 * A chave de idempotência é gerada pelo app: só a forma (uuid) é conferida.
 */
export function exigirCriacaoDoPedido(sim: SimuladorDePagamento): void {
  expect(sim.criacoesDePedido).toEqual([
    {
      rpc: "create_marketplace_order_v24",
      corpo: {
        p_items: [
          {
            product_id: "jornada-produto-acessorios",
            variant_id: null,
            quantity: 1,
          },
        ],
        p_total_amount: 40,
        p_shipping_cost: 10,
        p_payment_method: "online",
        p_address_id: "00000000-0000-4000-8000-0000000ad000",
        p_coupon_code: null,
        p_customer_name: "Cliente das Jornadas",
        p_customer_phone: "(34) 99999-0000",
        p_observation: "Frete Escolhido: Entrega local (Prazo: 1 dias)",
        p_address_data: null,
        p_destination_cep: "38500-000",
        p_shipping_option_id: "local-delivery",
        p_idempotency_key: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        ),
      },
    },
  ]);
}
