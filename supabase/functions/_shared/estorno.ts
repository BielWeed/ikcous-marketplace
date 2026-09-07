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

import {
  BASE_URL_PADRAO,
  consultarOrder,
  fetchComTempo,
  idEhClassico,
} from "./mercadopago.ts";

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
    // M-A do laudo (PR #438 rodada 2): `null` quando a consulta confirma o
    // valor mas `refunds[]` ainda não trouxe o id (consistência eventual do
    // MP) — nunca o id do PAGAMENTO nesse campo (a T3/T4 gravam o que vier).
    mp_refund_id: string | null;
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

const MS_POR_DIA = 24 * 60 * 60 * 1000;
const PRAZO_DE_ESTORNO_MS = 180 * MS_POR_DIA;

/**
 * Dinheiro deste arquivo é comparado e somado em CENTAVOS inteiros (C1 do
 * laudo do PR #438, 07/09). A fonte é `numeric(12,2)` do Postgres, exata em
 * centavos — mas o `number` do JS NÃO é: `50 - 4.23` dá `45.769999999999996`,
 * e a guarda do saldo recusava o restante EXATO (o lojista pedia R$45,77 de
 * um pedido de R$50 com R$4,23 já devolvidos e ouvia "valor maior que o
 * disponível" — ~28% dos pares de centavos com estorno anterior caem nesse
 * lado da subtração de float). `Math.round(x*100)` fecha a volta: o numeric
 * de 2 casas sempre representa centavos exatos.
 */
function emCentavos(valor: number): number {
  return Math.round(valor * 100);
}

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
  // C1 (laudo PR #438): subtração de float recusava o restante EXATO
  // (50 − 4,23 → 45,7699… recusava 45,77). Em centavos inteiros o saldo é
  // exato porque a fonte (`numeric(12,2)`) é.
  if (
    emCentavos(linha.amount) >
      emCentavos(pedido.total) - emCentavos(pedido.valor_estornado)
  ) {
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
      url: `${BASE_URL_PADRAO}/v1/payments/${pedido.gateway_payment_id}/refunds`,
      // Body vazio = devolução TOTAL do pagamento (documentado). Parcial
      // diz o valor — nunca deixar o MP adivinhar "o resto". Total × parcial
      // em CENTAVOS (C1): float cru trairia o mesmo par que a guarda.
      body: emCentavos(linha.amount) === emCentavos(pedido.total)
        ? {}
        : { amount: linha.amount },
      headers: { ...headers, "X-Render-In-Process-Refunds": "true" },
    };
  }

  const transacao: Record<string, string> = { id: transacaoDaOrder ?? "" };
  if (emCentavos(linha.amount) !== emCentavos(pedido.total)) {
    transacao.amount = linha.amount.toFixed(2);
  }
  return {
    url: `${BASE_URL_PADRAO}/v1/orders/${pedido.gateway_payment_id}/refund`,
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

  // C2 do laudo (PR #438): 401/403 é a CREDENCIAL (token errado ou
  // rotacionado no deploy), não o estado do dinheiro — marcar `falhou`
  // definitivo aqui mataria até 20 linhas por ciclo do cron em silêncio,
  // sem retry em lugar nenhum. `tentar_depois` mantém a linha viva; repetir
  // o POST depois é seguro (mesma chave de idempotência). O motivo é texto
  // leigo — o status HTTP vive em log (M2) e em `codigo`, nunca no motivo.
  if (status === 401 || status === 403) {
    return {
      tipo: "tentar_depois",
      motivo: "não consegui autenticar no Mercado Pago agora",
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
        // I3 do laudo: motivo é o que o lojista LÊ (a T3 mostra cru) — nada
        // de "HTTP 401"; o número mora em `codigo`.
        motivo: "erro não reconhecido do Mercado Pago",
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

  // C2 do laudo (PR #438): o mesmo 401/403 da Payments — credencial, não
  // dinheiro. Fica DEPOIS do switch nomeado de propósito: `forbidden` é
  // código do PAGAMENTO (permissão sobre aquela cobrança, lido pelo switch
  // acima como `falhou`) mesmo quando chega com HTTP 403; 401/403 SEM código
  // nomeado é a credencial e vira `tentar_depois`.
  if (status === 401 || status === 403) {
    return {
      tipo: "tentar_depois",
      motivo: "não consegui autenticar no Mercado Pago agora",
    };
  }

  return {
    tipo: "falhou",
    // I3 do laudo: sem "HTTP xxx" no motivo — número mora em `codigo`.
    motivo: "erro não reconhecido do Mercado Pago",
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

/** `date_created` do refund em milissegundos; sem data (ou ilegível) perde
 * qualquer desempate — nunca vence um candidato datado. */
function dataCreatedMs(refund: Record<string, unknown>): number {
  const bruto = refund.date_created;
  if (typeof bruto !== "string") return -Infinity;
  const t = Date.parse(bruto);
  return Number.isFinite(t) ? t : -Infinity;
}

/**
 * M-A do laudo (PR #438 rodada 2): a lista de refunds é do PEDIDO inteiro —
 * pode haver mais de um refund com o MESMO valor (duas linhas do mesmo
 * pedido, ou uma repetição). Medido: a versão anterior (`find` = primeiro
 * que bate) devolvia o refund mais VELHO (o de uma linha anterior) quando
 * dois batiam o valor, e SEM `refunds[]` devolvia o id do PAGAMENTO no campo
 * de refund (confunde conciliação, embora sem dano de dinheiro). Correção:
 * desempata pelo `date_created` mais RECENTE entre os candidatos com o
 * mesmo valor — o refund novo é o desta chamada; nenhum candidato (lista
 * vazia ou nenhum bate o valor) devolve `null`, nunca um id que não é de
 * refund.
 */
function refundIdDaConsulta(
  refunds: Array<Record<string, unknown>>,
  linha: LinhaEstorno,
): string | null {
  const centavosDaLinha = emCentavos(linha.amount);
  const candidatos = refunds.filter((r) => {
    const valor = Number(r.amount);
    return Number.isFinite(valor) && emCentavos(valor) === centavosDaLinha;
  });
  if (candidatos.length === 0) return null;
  let melhor = candidatos[0];
  let melhorData = dataCreatedMs(melhor);
  for (const candidato of candidatos.slice(1)) {
    const data = dataCreatedMs(candidato);
    if (data > melhorData) {
      melhor = candidato;
      melhorData = data;
    }
  }
  return melhor.id !== undefined && melhor.id !== null
    ? idComoString(melhor.id)
    : null;
}

/**
 * O GET que decide os casos "já feito": o MP disse 4296 /
 * order_already_refunded / idempotency_key_already_used e só a consulta do
 * objeto prova se o valor desta linha está coberto (Payments:
 * `transaction_amount_refunded`; Orders: soma de `transactions.refunds[]`).
 *
 * EXPORTADA (I1 do laudo, PR #438): a T4 (cron) chama esta função DIRETO
 * para linhas `em_processamento` — conclui SEM POST. Uma decisão, dois
 * chamadores; reimplementá-la lá seria o segundo produtor de `concluido`
 * que esta frente existe para não ter.
 *
 * TRÊS DESFECHOS (C3 do laudo): valor presente e cobre → `concluido`;
 * presente e não cobre → `falhou`; AUSENTE/ilegível → `tentar_depois` —
 * "não sei" não é prova de falha, e é depois de o MP já ter dito "já
 * devolvida": matar a linha aqui seria divergência no caso em que o
 * dinheiro provavelmente saiu. A T4 tem o teto de 5 tentativas e o texto
 * honesto; a dúvida morre lá, não aqui.
 *
 * O COMPARATIVO é ACUMULADO × ACUMULADO (I2 do laudo): o MP devolve o
 * total JÁ devolvido do pagamento; a linha é INCREMENTAL. Cobrado ⇔
 * devolvido_no_MP >= `pedido.valor_estornado` (o que o ledger já somou
 * ANTES desta linha) + `linha.amount` (esta linha) — tudo em centavos (C1).
 *
 * INVARIANTE I-B (laudo do PR #438 rodada 2): `pedido.valor_estornado` tem
 * de ser lido FRESCO, imediatamente antes desta chamada; snapshot velho
 * conclui sem dinheiro sair (duas linhas do mesmo pedido no mesmo lote, a
 * 1ª soma no ledger, a 2ª com o snapshot velho vê `valor_estornado` menor do
 * que já é de verdade e conclui cedo demais). Quem chama por item, dentro de
 * um laço (T4), releia o pedido a cada iteração — nunca um SELECT único
 * antes do laço.
 *
 * ALTERNATIVA B DO I-A (laudo do PR #438 rodada 2, decidida 07/09): quando o
 * valor devolvido no MP ainda não cobre o esperado, o desfecho depende de
 * COMO chegamos aqui — `args.codigo` é o marcador de quem já tem uma
 * confirmação DEFINITIVA do MP (4296/`order_already_refunded`: "já
 * devolvido, mas o valor não bate" é uma contradição real do MP, e é
 * `falhou`). SEM `codigo` — o caminho DIRETO que a T4 usa para linhas
 * `em_processamento` — "ainda não cobre" é só CONSISTÊNCIA EVENTUAL (o
 * refund pode não ter aparecido ainda): `tentar_depois`, nunca `falhou`;
 * matar a linha aqui tornaria o retry do POST (R3 da T4) inalcançável para o
 * caso mais comum.
 */
export async function confirmarPorConsulta(args: {
  buscar: typeof fetch;
  token: string;
  linha: LinhaEstorno;
  pedido: PedidoParaEstorno;
  codigo?: string;
}): Promise<ResultadoEstorno> {
  const { buscar, token, linha, pedido } = args;
  // Alternativa B do I-A: só existe confirmação DEFINITIVA (falhou) quando
  // um pré-veredito do MP trouxe até aqui; sem ele (caminho direto da T4) a
  // insuficiência é sempre "ainda não apareceu" — tentar_depois.
  const temPreVeredito = args.codigo !== undefined;
  const ehPayments = idEhClassico(pedido.gateway_payment_id);
  const url = ehPayments
    ? `${BASE_URL_PADRAO}/v1/payments/${pedido.gateway_payment_id}`
    : `${BASE_URL_PADRAO}/v1/orders/${pedido.gateway_payment_id}`;

  let resposta: Response;
  try {
    resposta = await buscar(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    // M2 do laudo: falha de rede some em silêncio sem log — o padrão da
    // casa (`mercadopago.ts`) é logar. O erro de rede não carrega token.
    console.error("estorno: falha de rede na confirmação", err);
    return {
      tipo: "tentar_depois",
      motivo: "falha de rede ao confirmar o estorno com o Mercado Pago",
    };
  }
  if (resposta.status !== 200) {
    // I3: o status HTTP vai no LOG (aqui) e nunca no motivo que o lojista lê.
    console.error(
      "estorno: consulta de confirmação recusada",
      resposta.status,
    );
    return {
      tipo: "tentar_depois",
      motivo: "não consegui confirmar o estorno com o Mercado Pago agora",
    };
  }
  let corpo: Record<string, unknown>;
  try {
    corpo = comoObjeto(await resposta.json());
  } catch (err) {
    console.error("estorno: confirmação com corpo ilegível", err);
    return {
      tipo: "tentar_depois",
      motivo: "resposta ilegível ao confirmar o estorno",
    };
  }

  const precisoEmCentavos = emCentavos(pedido.valor_estornado) +
    emCentavos(linha.amount);

  if (ehPayments) {
    // C3: campo presente e legível decide; AUSENTE é "não sei" → depois.
    // `Number(null)` seria 0 (falso "nada devolvido") — por isso a checagem
    // de tipo ANTES da conversão.
    const bruto = corpo.transaction_amount_refunded;
    const devolvido = typeof bruto === "number" || typeof bruto === "string"
      ? Number(bruto)
      : NaN;
    if (!Number.isFinite(devolvido)) {
      return {
        tipo: "tentar_depois",
        motivo: "não consegui confirmar o estorno com o Mercado Pago agora",
      };
    }
    if (emCentavos(devolvido) >= precisoEmCentavos) {
      const refunds = Array.isArray(corpo.refunds)
        ? corpo.refunds.filter((r) => r && typeof r === "object") as Array<
          Record<string, unknown>
        >
        : [];
      return {
        tipo: "concluido",
        mp_refund_id: refundIdDaConsulta(refunds, linha),
        mp_status: idComoString(corpo.status),
        mp_status_detail: detailOuNull(corpo),
        valor: linha.amount,
      };
    }
    return insuficiente(
      temPreVeredito,
      "o Mercado Pago informa que o pagamento já foi estornado, mas o valor confirmado não cobre esta devolução",
    );
  }

  const soma = somarRefundsDaOrder(corpo);
  if (soma === null) {
    // C3: order `refunded` sem `refunds[]` materializado (consistência
    // eventual do MP) não é prova de NADA — "não sei" vira depois, não falhou.
    return {
      tipo: "tentar_depois",
      motivo: "não consegui confirmar o estorno com o Mercado Pago agora",
    };
  }
  if (emCentavos(soma) >= precisoEmCentavos) {
    return {
      tipo: "concluido",
      mp_refund_id: refundIdDaConsulta(refundsDaOrder(corpo), linha),
      mp_status: idComoString(corpo.status),
      mp_status_detail: detailOuNull(corpo),
      valor: linha.amount,
    };
  }
  return insuficiente(
    temPreVeredito,
    "a cobrança já foi devolvida no Mercado Pago, mas o valor confirmado não cobre esta devolução",
  );
}

/**
 * Alternativa B do I-A (laudo do PR #438 rodada 2): um único ponto de
 * decisão para os dois desfechos de "o MP ainda não confirma o valor
 * inteiro" — com pré-veredito DEFINITIVO do MP (4296/`order_already_refunded`)
 * é `falhou`; sem ele (caminho direto que a T4 usa para `em_processamento`)
 * é `tentar_depois`, porque a consistência eventual do MP ainda pode
 * alcançar. O código sempre é o mesmo marcador (`confirmacao_insuficiente`)
 * — quem consome não precisa saber qual dos dois códigos nomeados do MP
 * trouxe até aqui, só que a confirmação não fechou.
 */
function insuficiente(
  temPreVeredito: boolean,
  motivoDefinitivo: string,
): ResultadoEstorno {
  if (!temPreVeredito) {
    return {
      tipo: "tentar_depois",
      motivo: "a devolução ainda não aparece no Mercado Pago",
    };
  }
  return {
    tipo: "falhou",
    motivo: motivoDefinitivo,
    codigo: "confirmacao_insuficiente",
  };
}

/**
 * Status de PAGAMENTO (não de order) que este arquivo aceita como "cobrança
 * aprovada" dentro de `transactions.payments[]`. Cobre as duas grafias
 * conhecidas da casa: a clássica (`approved`, ver `interpretarPayments`) e a
 * da Orders API (par status/status_detail "processed"/"accredited" da RAIZ
 * da order, `MAPA_STATUS_ORDER` em mercadopago.ts) — o campo por-PAGAMENTO
 * nunca foi medido contra a API real (Restrição Global veda fetch real em
 * teste), então as duas entram por precaução. Se a T8 (sandbox) achar uma
 * terceira grafia, é AQUI que se acrescenta.
 */
const STATUS_DE_PAGAMENTO_APROVADO = new Set(["approved", "processed", "accredited"]);

/**
 * Escolhe, dentro de `order.transactions.payments[]`, o id da transação de
 * pagamento que o refund-order da Orders API exige no corpo
 * (`transactions:[{id}]`) — NUNCA `order.id` (esse é o id da ORDER, campo
 * diferente; ver o comentário grande em `webhook-mercadopago/index.ts` sobre
 * por que a raiz da order e `payments[0]` não são a mesma coisa).
 *
 * Um pagamento só (o caso comum: um PIX, uma tentativa): usa o id dele sem
 * checar status — é o mesmo que `extrairQrCode`/`extrairDataExpiracaoOrder`
 * já fazem em `mercadopago.ts`. MAIS DE UM (retry do cliente, PIX reemitido):
 * escolhe o único com status de pagamento aprovado; em empate (0 ou 2+
 * candidatos) devolve `null` com log — nunca chuta qual id é o certo.
 */
function transacaoPagaDaOrder(order: Record<string, unknown>): string | null {
  const transacoes = order.transactions as Record<string, unknown> | undefined;
  const pagamentos = transacoes?.payments;
  if (!Array.isArray(pagamentos) || pagamentos.length === 0) return null;

  if (pagamentos.length === 1) {
    const unico = pagamentos[0] as Record<string, unknown> | null;
    return idComoString(unico?.id) || null;
  }

  const aprovados = pagamentos.filter((p) => {
    const status = (p as Record<string, unknown> | null)?.status;
    return typeof status === "string" && STATUS_DE_PAGAMENTO_APROVADO.has(status);
  });
  if (aprovados.length !== 1) {
    console.error(
      "estorno: order com múltiplos pagamentos sem discriminador claro",
      pagamentos.length,
      aprovados.length,
    );
    return null;
  }
  return idComoString((aprovados[0] as Record<string, unknown>).id) || null;
}

/**
 * `consultarTransacaoDaOrder` — o `GET /v1/orders/{orderId}` que o executor
 * (`executarEstorno`, abaixo) precisa ANTES de montar o refund de uma order
 * (PIX, único método vivo da loja): `pedido.gateway_payment_id` guarda o id
 * da ORDER, não o da transação de pagamento dentro dela.
 *
 * Reusa `consultarOrder` (mercadopago.ts) — mesmo GET que o webhook e a
 * reconciliação já fazem contra a Orders API; escrever um segundo cliente
 * HTTP para a mesma chamada seria a doença do #53 (regra repetida) de novo.
 * O `buscar` default de `consultarOrder` é o `fetch` cru envolvido pelo
 * PRÓPRIO `fetchComTempo` (15 s) — o teste passa um dublê e nunca toca rede.
 *
 * Nunca lança: HTTP não-2xx, corpo ilegível, `order` sem `transactions` ou
 * timeout viram `null` — o executor já trata `null` como `tentar_depois`
 * (nunca chama o MP às cegas).
 */
export async function consultarTransacaoDaOrder(args: {
  orderId: string;
  token: string;
  buscar?: typeof fetch;
}): Promise<string | null> {
  const resultado = await consultarOrder({
    token: args.token,
    orderId: args.orderId,
    fetchImpl: args.buscar,
  });
  if (!resultado.ok) {
    console.error(
      "estorno: consultarTransacaoDaOrder não conseguiu consultar a order",
      resultado.status,
      resultado.erro,
    );
    return null;
  }
  return transacaoPagaDaOrder(resultado.order);
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

  let transacaoDaOrder: string | null | undefined;
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
    } catch (err) {
      console.error("estorno: falha ao consultar a transação da order", err);
      transacaoDaOrder = null;
    }
    if (!transacaoDaOrder) {
      return {
        tipo: "tentar_depois",
        motivo: "não consegui obter a transação da order no Mercado Pago",
      };
    }
  }

  const req = montarRequisicao(linha, pedido, transacaoDaOrder ?? undefined);
  let resposta: Response;
  try {
    resposta = await buscar(req.url, {
      method: "POST",
      headers: { ...req.headers, Authorization: `Bearer ${token}` },
      body: JSON.stringify(req.body),
    });
  } catch (err) {
    // M2 do laudo: sem log, falha de rede some — o padrão da casa
    // (`mercadopago.ts`) é logar. O `err` de rede não carrega o token.
    console.error("estorno: falha de rede no POST", err);
    return {
      tipo: "tentar_depois",
      motivo: "falha de rede ao falar com o Mercado Pago",
    };
  }

  let corpo: unknown = null;
  try {
    corpo = await resposta.json();
  } catch (err) {
    console.error("estorno: resposta com corpo ilegível", resposta.status, err);
    corpo = null;
  }
  if (!resposta.ok) {
    // M2: o corpo do erro do MP vai para o log da função (padrão da casa),
    // nunca para o texto do lojista — e sem ele o POST reprovado some.
    console.error("estorno: mercado pago recusou o POST", resposta.status, corpo);
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
    // I1 do laudo: a MESMA decisão que a T4 chama direto (sem POST) para
    // linhas `em_processamento` — uma função, dois chamadores.
    return confirmarPorConsulta({
      buscar,
      token,
      linha,
      pedido,
      codigo: resultado.codigo,
    });
  }
  return resultado;
}
