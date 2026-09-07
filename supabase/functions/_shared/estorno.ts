/**
 * Executor de estorno (devolução de dinheiro pelo Mercado Pago) — Task 2 da
 * frente "estorno pelo app" (plano 20260907-plano-estorno-pelo-app.md).
 *
 * EXECUTOR PURO: zero I/O de banco aqui. Quem grava linha, marca
 * `em_processamento`, soma `valor_estornado` e escreve `ultimo_erro` são a
 * edge do clique do lojista (T3, `estornar-pagamento`) e o cron da
 * reconciliação (T4). Este arquivo só decide três coisas:
 *
 *   1. se PODE chamar o MP (`guardaAntesDeChamar` — antes de gastar a
 *      tentativa e expor a chave de idempotência);
 *   2. COMO chamar (`montarRequisicao` — Payments clássica × Orders API,
 *      decidido pela FORMA do id via `idEhClassico`, nunca pelo código de
 *      erro HTTP: ver o porquê no comentário de `idEhClassico`);
 *   3. o que a resposta SIGNIFICA (`interpretarResposta` — tabela fechada,
 *      uma linha por caso; o que não está na tabela não vira palpite).
 *
 * `fetch` e a consulta da transação da order entram por parâmetro: teste
 * não toca rede (restrição global do plano).
 *
 * IDEMPOTÊNCIA: o `X-Idempotency-Key` é SEMPRE o `order_refunds.id` (uuid
 * da linha). Repetir o POST com a mesma chave é seguro por contrato do MP —
 * é o que o cron faz quando a consulta não mostra o refund (T4).
 */

import { fetchComTempo, idEhClassico } from "./mercadopago.ts";

export type LinhaEstorno = {
  id: string;
  order_id: string;
  amount: number;
  status: "solicitado" | "em_processamento" | "concluido" | "falhou" | "recusado";
  mp_refund_id: string | null;
  tentativas: number;
};

export type PedidoParaEstorno = {
  id: string;
  gateway_payment_id: string;
  total: number;
  valor_estornado: number;
  payment_status: string | null;
  paid_at: string | null;
  status: string;
};

export type ResultadoEstorno =
  | {
    tipo: "concluido";
    mp_refund_id: string;
    mp_status: string;
    mp_status_detail: string | null;
    valor: number;
  }
  | { tipo: "em_processamento"; mp_refund_id: string | null; mp_status: string }
  // Definitivo: não tentar de novo com esta linha (novo pedido = nova linha).
  | { tipo: "falhou"; motivo: string; codigo: string }
  // Guarda recusou ANTES de qualquer chamada ao MP: nada foi gasto.
  | { tipo: "recusado"; motivo: string }
  // 429/5xx/rede/resposta não reconhecida: o cron re-tenta com a MESMA chave.
  | { tipo: "tentar_depois"; motivo: string; retryAfterS?: number };

const API_MP = "https://api.mercadopago.com";
const MS_POR_DIA = 24 * 60 * 60 * 1000;
const PRAZO_DE_ESTORNO_MS = 180 * MS_POR_DIA;

/**
 * Guarda de pré-condições, ANTES de chamar o MP. Tudo o que ela recusa nem
 * chega a gastar tentativa nem a expor a chave de idempotência — por isso o
 * resultado vira `recusado` na linha, não `falhou`.
 *
 * A lista é exatamente a do plano: prazo de 180 dias desde `paid_at`, saldo
 * disponível, pedido pago, id do gateway presente.
 *
 * SOBRE `pago_apos_expirar` (decisão registrada): o plano escreve
 * "payment_status pago", mas a T1 insere linha de estorno para
 * `pago_apos_expirar` do mesmo jeito (dinheiro honrado, política P1). Se a
 * guarda recusasse essa família, criaria a linha que o executor recusa para
 * sempre — o estado impossível que a auto-revisão do plano caça. A guarda
 * aceita os dois estados de dinheiro recebido.
 *
 * MEDIDO 07/09 (parecer GLM 1720, confirmado no plano): `paid_at` é `now()`
 * gravado por `confirmar_pagamento` no instante em que webhook/reconciliação
 * CONFIRMARAM — carimbo LOCAL, posterior à aprovação real no MP por até
 * ~10 min (janela do cron) ou mais se o webhook atrasar. Consequência: a
 * guarda dos 180 dias só pode errar para o lado PERMISSIVO (deixar passar
 * um pedido que o MP já considera vencido), nunca para o restritivo; o MP
 * responde 2024/15016 e a linha vira `falhou` com texto honesto. A guarda é
 * UX antecipada, não a fonte da verdade — a fonte é a resposta do MP.
 */
export function guardaAntesDeChamar(
  linha: LinhaEstorno,
  pedido: PedidoParaEstorno,
  agora: Date,
): { ok: true } | { ok: false; motivo: string } {
  if (
    pedido.payment_status !== "pago" &&
    pedido.payment_status !== "pago_apos_expirar"
  ) {
    return { ok: false, motivo: "pedido não está pago" };
  }
  if (!pedido.gateway_payment_id) {
    return {
      ok: false,
      motivo: "pedido sem identificação do pagamento no Mercado Pago",
    };
  }
  if (!pedido.paid_at) {
    return { ok: false, motivo: "pedido sem data de pagamento registrada" };
  }
  const pagoEm = new Date(pedido.paid_at).getTime();
  if (!Number.isFinite(pagoEm)) {
    return { ok: false, motivo: "pedido com data de pagamento ilegível" };
  }
  if (agora.getTime() - pagoEm > PRAZO_DE_ESTORNO_MS) {
    return {
      ok: false,
      motivo: "pagamento com mais de 180 dias não pode mais ser devolvido",
    };
  }
  if (linha.amount > pedido.total - pedido.valor_estornado) {
    return { ok: false, motivo: "valor maior que o disponível para devolver" };
  }
  return { ok: true };
}

/**
 * Monta a requisição SEM credencial: `Authorization` entra só no
 * `executarEstorno`, que é quem tem o token. A função pura não toca segredo —
 * e o teste confere method/URL/body/chave sem nunca ver um token.
 *
 * Payments clássica (id numérico): `POST /v1/payments/{id}/refunds`, body
 * `{}` no total ou `{amount}` no parcial, e o header
 * `X-Render-In-Process-Refunds: true` SEMPRE — é o header da contingência
 * PIX (pesquisa do plano, 07/09): sem ele o MP devolve 400 num estorno que
 * PODERIA ser aprovado depois; com ele, 201 + `in_process`.
 *
 * Orders API (id `ORD…`): `POST /v1/orders/{id}/refund` com
 * `{transactions:[{id: transacaoDaOrder}]}` — o id da transação (formato
 * `PAY01…`, vindo de `GET /v1/orders/{id}` → `transactions.payments[0].id`)
 * NÃO é o payment_id numérico. Valor parcial é STRING com duas casas
 * ("10.00"), a grafia da Orders API (medido em montarCorpoPixOrders). Se a
 * T8 (sandbox) mostrar divergência no campo da transação, é AQUI e no
 * literal de E4 que se troca.
 */
export function montarRequisicao(
  linha: LinhaEstorno,
  pedido: PedidoParaEstorno,
  transacaoDaOrder?: string,
): { url: string; body: unknown; headers: Record<string, string> } {
  const headers: Record<string, string> = {
    // A chave é o id da LINHA: repetir o POST com a mesma chave é o contrato
    // de idempotência do MP — é o que impede dois estornos do mesmo dinheiro.
    "X-Idempotency-Key": linha.id,
    "Content-Type": "application/json",
  };

  if (idEhClassico(pedido.gateway_payment_id)) {
    return {
      url: `${API_MP}/v1/payments/${pedido.gateway_payment_id}/refunds`,
      // Body vazio = devolução TOTAL do pagamento (documentado). Parcial
      // diz o valor — nunca deixar o MP adivinhar "o resto".
      body: linha.amount === pedido.total ? {} : { amount: linha.amount },
      headers: { ...headers, "X-Render-In-Process-Refunds": "true" },
    };
  }

  const transacao: Record<string, string> = { id: transacaoDaOrder ?? "" };
  if (linha.amount !== pedido.total) {
    transacao.amount = linha.amount.toFixed(2);
  }
  return {
    url: `${API_MP}/v1/orders/${pedido.gateway_payment_id}/refund`,
    body: { transactions: [transacao] },
    headers,
  };
}

/**
 * Extrai o código de erro do corpo, nas DUAS grafias que as APIs do MP usam:
 * Payments clássica (`cause[].code`, número) e Orders API
 * (`error_messages[].code`, nome). Tolerante de propósito — a taxonomia
 * exata de cada endpoint não é contrato estável; o NOME do código é.
 */
function acharCodigo(corpo: unknown): string | null {
  if (!corpo || typeof corpo !== "object") return null;
  const c = corpo as Record<string, unknown>;
  const deLista = (lista: unknown): string | null => {
    if (!Array.isArray(lista)) return null;
    for (const item of lista) {
      const code = (item as Record<string, unknown> | null)?.code;
      if (typeof code === "string" || typeof code === "number") {
        return String(code);
      }
    }
    return null;
  };
  return deLista(c.cause) ?? deLista(c.error_messages) ??
    ((typeof c.code === "string" || typeof c.code === "number")
      ? String(c.code)
      : null);
}

function comoObjeto(corpo: unknown): Record<string, unknown> {
  return corpo && typeof corpo === "object"
    ? corpo as Record<string, unknown>
    : {};
}

function detailOuNull(corpo: Record<string, unknown>): string | null {
  return typeof corpo.status_detail === "string" ? corpo.status_detail : null;
}

function idComoString(valor: unknown): string {
  return valor === null || valor === undefined ? "" : String(valor);
}

/**
 * Tabela fechada da Payments clássica (id numérico). Cada linha tem teste
 * correspondente (E5–E13).
 *
 * 2xx com `status` fora de approved/in_process não vira NADA: afirmar
 * conclusão sem evidência é o pior erro deste arquivo (dinheiro), e matar a
 * linha por status desconhecido também — `tentar_depois` deixa o cron
 * re-consultar, que é o caminho que sempre esclarece.
 */
function interpretarPayments(
  status: number,
  corpo: unknown,
  linha: LinhaEstorno,
): ResultadoEstorno {
  const c = comoObjeto(corpo);
  const codigo = acharCodigo(corpo);
  const mpStatus = typeof c.status === "string" ? c.status : "";

  if (status === 200 || status === 201) {
    if (mpStatus === "approved") {
      const valor = Number(c.amount);
      return {
        tipo: "concluido",
        mp_refund_id: idComoString(c.id),
        mp_status: mpStatus,
        mp_status_detail: detailOuNull(c),
        valor: Number.isFinite(valor) ? valor : linha.amount,
      };
    }
    if (mpStatus === "in_process") {
      return {
        tipo: "em_processamento",
        mp_refund_id: idComoString(c.id),
        mp_status: mpStatus,
      };
    }
    return {
      tipo: "tentar_depois",
      motivo: "resposta do Mercado Pago não reconhecida",
    };
  }

  if (status === 429 || status === 408 || status >= 500) {
    return {
      tipo: "tentar_depois",
      motivo: "o Mercado Pago está ocupado ou instável agora",
    };
  }

  switch (codigo) {
    case "2063":
      return {
        tipo: "falhou",
        motivo: "pagamento não está em estado que permita devolução",
        codigo: "2063",
      };
    case "4040":
    case "4041":
      return { tipo: "falhou", motivo: "valor inválido", codigo };
    case "2024":
    case "15016":
      return {
        tipo: "falhou",
        motivo: "pagamento com mais de 180 dias não pode mais ser devolvido",
        codigo,
      };
    case "3024":
      return {
        tipo: "falhou",
        motivo: "este pagamento só aceita devolução total",
        codigo: "3024",
      };
    // "Já estornado": a tabela manda CONSULTAR o payment antes de decidir.
    // O interpretar é puro (sem I/O), então devolve o pré-veredito com este
    // código; o `executarEstorno` reconhece, faz o GET e converte em
    // concluido/falhou definitivos (E11).
    case "4296":
      return {
        tipo: "falhou",
        motivo: "pagamento já estornado — confirmando com o Mercado Pago",
        codigo: "4296",
      };
    case "2000":
      return {
        tipo: "falhou",
        motivo: "pagamento não encontrado no Mercado Pago",
        codigo: "2000",
      };
    default:
      return {
        tipo: "falhou",
        motivo: `erro não reconhecido do Mercado Pago (HTTP ${status})`,
        codigo: codigo ?? `http_${status}`,
      };
  }
}

/**
 * Tabela fechada da Orders API (id `ORD…`). Cada linha tem teste
 * correspondente (E14–E18). Código nomeado tem prioridade sobre o status
 * HTTP: é o código que identifica "já feito / já em curso / recusa", e o
 * mesmo nome chega em 400 ou 409 conforme o caso.
 */
function interpretarOrders(
  status: number,
  corpo: unknown,
  linha: LinhaEstorno,
): ResultadoEstorno {
  const c = comoObjeto(corpo);
  const codigo = acharCodigo(corpo);

  switch (codigo) {
    case "order_refund_already_in_process":
      return {
        tipo: "em_processamento",
        mp_refund_id: null,
        mp_status: "order_refund_already_in_process",
      };
    // Os três abaixo mandam CONSULTAR a order (pré-veredito puro; o GET é
    // do executor — E16/E18):
    case "order_already_refunded":
      return {
        tipo: "falhou",
        motivo: "cobrança já devolvida — confirmando com o Mercado Pago",
        codigo: "order_already_refunded",
      };
    case "idempotency_key_already_used":
      return {
        tipo: "falhou",
        motivo: "esta devolução já foi pedida — confirmando o resultado com o Mercado Pago",
        codigo: "idempotency_key_already_used",
      };
    case "refund_amount_exceeds":
      return {
        tipo: "falhou",
        motivo: "valor maior que o disponível para devolver",
        codigo: "refund_amount_exceeds",
      };
    // Motivos INLINE, sem lookup dinâmico de Record por variável: além de a
    // tabela ser fechada (cada case é uma linha da tabela), o lookup
    // `MOTIVOS[codigo]` dispara `security/detect-object-injection` — warning
    // novo que a catraca do lint:ratchet reprova no CI.
    case "cannot_refund_order":
      return {
        tipo: "falhou",
        motivo: "esta cobrança não pode ser devolvida",
        codigo,
      };
    case "order_not_found":
      return {
        tipo: "falhou",
        motivo: "pagamento não encontrado no Mercado Pago",
        codigo,
      };
    case "transaction_not_found":
      return {
        tipo: "falhou",
        motivo: "transação não encontrada no Mercado Pago",
        codigo,
      };
    case "forbidden":
      return {
        tipo: "falhou",
        motivo: "sem permissão para devolver este pagamento",
        codigo,
      };
  }

  const mpStatus = typeof c.status === "string" ? c.status : "";
  const detail = detailOuNull(c);

  if (status === 200 || status === 201) {
    // refunded = total; processed + partially_refunded = parcial confirmado
    // (par documentado — ver MAPA_STATUS_ORDER, PEDIDO-05). O valor da
    // devolução é o da LINHA: o corpo da order não traz o valor do refund
    // no topo, e quem sabe quanto foi pedido é o nosso ledger.
    if (mpStatus === "refunded" || detail === "partially_refunded") {
      return {
        tipo: "concluido",
        mp_refund_id: idComoString(c.id),
        mp_status: mpStatus,
        mp_status_detail: detail,
        valor: linha.amount,
      };
    }
    return {
      tipo: "tentar_depois",
      motivo: "resposta do Mercado Pago não reconhecida",
    };
  }

  if (status === 429 || status === 408 || status >= 500) {
    return {
      tipo: "tentar_depois",
      motivo: "o Mercado Pago está ocupado ou instável agora",
    };
  }

  return {
    tipo: "falhou",
    motivo: `erro não reconhecido do Mercado Pago (HTTP ${status})`,
    codigo: codigo ?? `http_${status}`,
  };
}

/**
 * Interpreta a resposta do POST de estorno pela tabela fechada. Pura e
 * síncrona: as três linhas da tabela que exigem CONSULTA (Payments 4296,
 * Orders order_already_refunded / idempotency_key_already_used) saem daqui
 * como `falhou` com o código marcador, e é o `executarEstorno` quem faz o
 * GET e devolve o veredito final — I/O não entra na função pura.
 */
export function interpretarResposta(
  status: number,
  corpo: unknown,
  linha: LinhaEstorno,
  pedido: PedidoParaEstorno,
): ResultadoEstorno {
  if (idEhClassico(pedido.gateway_payment_id)) {
    return interpretarPayments(status, corpo, linha);
  }
  return interpretarOrders(status, corpo, linha);
}

/** Os códigos cujo veredito final depende de uma CONSULTA (GET). */
const CODIGOS_QUE_EXIGEM_CONFIRMACAO = new Set([
  "4296",
  "order_already_refunded",
  "idempotency_key_already_used",
]);

function refundsDaOrder(
  order: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const coletar = (lista: unknown): Array<Record<string, unknown>> => {
    if (!Array.isArray(lista)) return [];
    return lista.flatMap((item) => {
      const refunds = (item as Record<string, unknown> | null)?.refunds;
      return Array.isArray(refunds)
        ? refunds.filter((r) => r && typeof r === "object") as Array<
          Record<string, unknown>
        >
        : [];
    });
  };
  // A order consultada traz transactions como lista (cada transação com os
  // seus refunds); aceitar também o formato objeto é defesa, não palpite.
  const t = order.transactions;
  if (Array.isArray(t)) return coletar(t);
  if (t && typeof t === "object") return coletar([t]);
  return [];
}

function somarRefundsDaOrder(order: Record<string, unknown>): number | null {
  const refunds = refundsDaOrder(order);
  if (refunds.length === 0) return null;
  let soma = 0;
  for (const r of refunds) {
    const v = Number(r.amount);
    if (!Number.isFinite(v)) return null;
    soma += v;
  }
  return soma;
}

function refundIdDaConsulta(
  corpo: Record<string, unknown>,
  refunds: Array<Record<string, unknown>>,
): string {
  const ultimo = refunds.length > 0 ? refunds[refunds.length - 1] : null;
  return idComoString(ultimo?.id ?? corpo.id);
}

/**
 * O GET que decide os casos "já feito": o MP disse 4296 /
 * order_already_refunded / idempotency_key_already_used e só a consulta do
 * objeto prova se o valor desta linha está coberto (Payments:
 * `transaction_amount_refunded`; Orders: soma de `transactions.refunds[]`).
 * Consulta que falha ou não esclarece vira `tentar_depois` — nunca matar
 * linha por falta de confirmação.
 */
async function confirmarPelaConsulta(
  buscar: typeof fetch,
  token: string,
  linha: LinhaEstorno,
  pedido: PedidoParaEstorno,
  preliminar: { tipo: "falhou"; motivo: string; codigo: string },
): Promise<ResultadoEstorno> {
  const ehPayments = idEhClassico(pedido.gateway_payment_id);
  const url = ehPayments
    ? `${API_MP}/v1/payments/${pedido.gateway_payment_id}`
    : `${API_MP}/v1/orders/${pedido.gateway_payment_id}`;

  let resposta: Response;
  try {
    resposta = await buscar(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (_err) {
    return {
      tipo: "tentar_depois",
      motivo: "falha de rede ao confirmar o estorno com o Mercado Pago",
    };
  }
  if (resposta.status !== 200) {
    return {
      tipo: "tentar_depois",
      motivo:
        `não consegui confirmar o estorno com o Mercado Pago (HTTP ${resposta.status})`,
    };
  }
  let corpo: Record<string, unknown>;
  try {
    corpo = comoObjeto(await resposta.json());
  } catch (_err) {
    return {
      tipo: "tentar_depois",
      motivo: "resposta ilegível ao confirmar o estorno",
    };
  }

  if (ehPayments) {
    const devolvido = Number(corpo.transaction_amount_refunded);
    if (Number.isFinite(devolvido) && devolvido >= linha.amount) {
      const refunds = Array.isArray(corpo.refunds)
        ? corpo.refunds.filter((r) => r && typeof r === "object") as Array<
          Record<string, unknown>
        >
        : [];
      return {
        tipo: "concluido",
        mp_refund_id: refundIdDaConsulta(corpo, refunds),
        mp_status: idComoString(corpo.status),
        mp_status_detail: detailOuNull(corpo),
        valor: linha.amount,
      };
    }
    return {
      tipo: "falhou",
      motivo:
        "o Mercado Pago informa que o pagamento já foi estornado, mas o valor confirmado não cobre esta devolução",
      codigo: preliminar.codigo,
    };
  }

  const soma = somarRefundsDaOrder(corpo);
  if (soma !== null && soma >= linha.amount) {
    return {
      tipo: "concluido",
      mp_refund_id: refundIdDaConsulta(corpo, refundsDaOrder(corpo)),
      mp_status: idComoString(corpo.status),
      mp_status_detail: detailOuNull(corpo),
      valor: linha.amount,
    };
  }
  return {
    tipo: "falhou",
    motivo:
      "a cobrança já foi devolvida no Mercado Pago, mas o valor confirmado não cobre esta devolução",
    codigo: preliminar.codigo,
  };
}

/**
 * Fluxo completo: guarda → (Orders: acha a transação) → POST → interpreta →
 * (se a tabela manda consultar) GET de confirmação. NUNCA lança: toda falha
 * de rede/timeout/ilegível vira `tentar_depois` (E19), e guarda recusada não
 * gasta NENHUMA chamada (E20) — nem o POST, nem a consulta da transação.
 *
 * Em produção o `buscar` default é o `fetchComTempo` da casa (15 s de teto
 * em toda chamada ao MP — laudo P-4). `consultarTransacaoDaOrder` é
 * injetado pela T3/T4 (quem tem o token e o cliente HTTP de verdade);
 * ausente, estorno de ORDER fica `tentar_depois` em vez de chamar às cegas.
 */
export async function executarEstorno(args: {
  linha: LinhaEstorno;
  pedido: PedidoParaEstorno;
  token: string;
  buscar?: typeof fetch;
  consultarTransacaoDaOrder?: (orderId: string) => Promise<string | null>;
}): Promise<ResultadoEstorno> {
  const { linha, pedido, token } = args;
  const buscar: typeof fetch = args.buscar ??
    ((input: RequestInfo | URL, init?: RequestInit) =>
      fetchComTempo(fetch, typeof input === "string" ? input : String(input), init));

  const guarda = guardaAntesDeChamar(linha, pedido, new Date());
  if (!guarda.ok) return { tipo: "recusado", motivo: guarda.motivo };

  let transacaoDaOrder: string | undefined;
  if (!idEhClassico(pedido.gateway_payment_id)) {
    if (!args.consultarTransacaoDaOrder) {
      return {
        tipo: "tentar_depois",
        motivo: "consulta da transação da order não disponível",
      };
    }
    try {
      transacaoDaOrder = await args.consultarTransacaoDaOrder(
        pedido.gateway_payment_id,
      );
    } catch (_err) {
      transacaoDaOrder = null;
    }
    if (!transacaoDaOrder) {
      return {
        tipo: "tentar_depois",
        motivo: "não consegui obter a transação da order no Mercado Pago",
      };
    }
  }

  const req = montarRequisicao(linha, pedido, transacaoDaOrder);
  let resposta: Response;
  try {
    resposta = await buscar(req.url, {
      method: "POST",
      headers: { ...req.headers, Authorization: `Bearer ${token}` },
      body: JSON.stringify(req.body),
    });
  } catch (_err) {
    return {
      tipo: "tentar_depois",
      motivo: "falha de rede ao falar com o Mercado Pago",
    };
  }

  let corpo: unknown = null;
  try {
    corpo = await resposta.json();
  } catch (_err) {
    corpo = null;
  }

  let resultado = interpretarResposta(resposta.status, corpo, linha, pedido);

  // O Retry-After mora no header da resposta, que o interpretar (puro) não
  // vê: o executor enriquece o `tentar_depois` do 429 com o prazo (E13).
  if (resultado.tipo === "tentar_depois" && resposta.status === 429) {
    const bruto = resposta.headers?.get?.("Retry-After");
    const segundos = bruto === null ? NaN : Number(bruto);
    if (Number.isFinite(segundos) && segundos > 0) {
      resultado = { ...resultado, retryAfterS: segundos };
    }
  }

  if (
    resultado.tipo === "falhou" &&
    CODIGOS_QUE_EXIGEM_CONFIRMACAO.has(resultado.codigo)
  ) {
    return confirmarPelaConsulta(buscar, token, linha, pedido, resultado);
  }
  return resultado;
}
