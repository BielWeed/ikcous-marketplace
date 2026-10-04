/**
 * CONTESTAÇÃO (chargeback) do Mercado Pago — leitura do caso, para o ledger
 * de estorno (`webhook-mercadopago`, `registrarDesfechoDoEstorno`, ramo B).
 * Lote A, 04/10/2026 (R1).
 *
 * POR QUE UM MÓDULO PRÓPRIO: a decisão da disputa NÃO sai do mapa de status
 * (`_shared/mercadopago.ts`, `mapearStatusOrder`) — aquele mapa traduz todo
 * `charged_back` para 'estornado' e continua assim, porque o checkout da
 * `criar-pagamento` depende dele. Aqui ficam as três leituras que o ledger
 * precisa, e só ele usa.
 *
 * FONTES (doc oficial do MP, conferidas em 04/10/2026):
 *  - GET order (reference get-order):
 *    https://www.mercadopago.com.br/developers/en/reference/online-payments/checkout-api/get-order/get
 *    — `transactions.chargebacks[]` com `id` (CBK...), `transaction_id`
 *    (PAY..., o pagamento contestado), `case_id` (string) e `status`. NÃO
 *    traz valor nem moeda do caso.
 *  - Gestão de contestações:
 *    https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-management/chargebacks/management
 *    — GET /v1/chargebacks/{case_id}: `amount`, `currency` e
 *    `coverage_applied` (true = decisão favorável ao vendedor, o valor
 *    retorna a ele; false = contrária, o valor é debitado; null = pendente).
 *  - Status da transação:
 *    https://www.mercadopago.com.br/developers/en/docs/checkout-api-orders/payment-management/status/transaction-status
 *    — `charged_back` + `in_process` (disputa em andamento), `settled` (valor
 *    devolvido ao COMPRADOR), `reimbursed` (valor creditado ao VENDEDOR).
 *    A página de status da ORDER
 *    (https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-management/status/order-status)
 *    descreve `reimbursed` como valor devolvido ao PAGADOR — o contrário. Por
 *    isso o agregado da order nunca decide: vale o caso (`coverage_applied`),
 *    corroborado pelo status do PAGAMENTO contestado.
 *
 * NÃO VERIFICADO CONTRA A API REAL (sem conta de teste com contestação neste
 * ambiente): a forma acima é a da referência; qualquer desvio cai em "não
 * sei", que conserva a reserva e avisa o admin — nunca libera nem conclui.
 */
import { BASE_URL_PADRAO, fetchComTempo } from "./mercadopago.ts";

export type DecisaoDaContestacao = "em_analise" | "contra_a_loja" | "a_favor_da_loja";

export type ResultadoDaConsultaDoCaso =
  | { ok: true; caso: Record<string, unknown> }
  // `transitorio`: rede, 429 ou 5xx — quem chama devolve 500 e o MP reenvia
  // (a reconsulta). Os demais (404, 4xx, case_id ilegível, corpo ilegível)
  // não mudam reenviando: quem chama conserva a reserva e avisa o admin.
  | { ok: false; status: number; transitorio: boolean };

/** `case_id` só entra na URL com forma de identificador (sem barra, espaço). */
const FORMA_DO_CASE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export async function consultarContestacao(args: {
  token: string;
  caseId: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  tempoLimiteMs?: number;
}): Promise<ResultadoDaConsultaDoCaso> {
  if (typeof args.caseId !== "string" || !FORMA_DO_CASE_ID.test(args.caseId)) {
    return { ok: false, status: 0, transitorio: false };
  }
  const f = args.fetchImpl ?? fetch;
  const base = args.baseUrl ?? BASE_URL_PADRAO;
  let resposta: Response;
  try {
    resposta = await fetchComTempo(
      f,
      `${base}/v1/chargebacks/${args.caseId}`,
      { method: "GET", headers: { Authorization: `Bearer ${args.token}` } },
      args.tempoLimiteMs,
    );
  } catch (_err) {
    return { ok: false, status: 0, transitorio: true };
  }
  if (!resposta.ok) {
    // Só o status no log: o corpo do caso pode trazer documentação enviada.
    console.error("mercadopago: chargebacks (consulta) recusou", resposta.status);
    return {
      ok: false,
      status: resposta.status,
      transitorio: resposta.status === 429 || resposta.status >= 500,
    };
  }
  try {
    const corpo = await resposta.json();
    if (corpo && typeof corpo === "object" && !Array.isArray(corpo)) {
      return { ok: true, caso: corpo as Record<string, unknown> };
    }
  } catch (_err) {
    // cai no "corpo ilegível" abaixo
  }
  console.error("mercadopago: chargebacks (consulta) com corpo ilegível", resposta.status);
  return { ok: false, status: resposta.status, transitorio: false };
}

/** A decisão do CASO — `coverage_applied`. Ausente ou fora do vocabulário:
 * `null` ("não sei"), nunca um palpite. */
export function decisaoDoCaso(caso: Record<string, unknown>): DecisaoDaContestacao | null {
  if (!("coverage_applied" in caso)) return null;
  const c = caso.coverage_applied;
  if (c === null) return "em_analise";
  if (c === true) return "a_favor_da_loja";
  if (c === false) return "contra_a_loja";
  return null;
}

/** O status do PAGAMENTO contestado (transaction-status) na mesma régua. */
export function decisaoDoStatusDoPagamento(detalhe: string): DecisaoDaContestacao | null {
  if (detalhe === "in_process") return "em_analise";
  if (detalhe === "settled") return "contra_a_loja";
  if (detalhe === "reimbursed") return "a_favor_da_loja";
  return null;
}

/** Valor do CASO em reais. Outra moeda, ausente ou não positivo: `null`
 * (quem chama usa o total pago como ESTIMATIVA, dito no motivo da linha). */
export function valorDoCaso(caso: Record<string, unknown>): number | null {
  if (caso.currency !== "BRL") return null;
  if (caso.amount === null || caso.amount === undefined || caso.amount === "") return null;
  const valor = Number(caso.amount);
  return Number.isFinite(valor) && valor > 0 ? Number(valor.toFixed(2)) : null;
}

export interface ItemDaContestacao {
  /** `chargebacks[].id` (CBK...) — a identidade da contestação no ledger. */
  idContestacao: string;
  /** `chargebacks[].case_id` — SEMPRE string (id longo não passa por Number). */
  caseId: string;
  /** `chargebacks[].transaction_id` — o pagamento contestado. */
  idTransacao: string;
  /** `status_detail` do PAGAMENTO cujo id é `idTransacao`. */
  detalheDoPagamento: string;
  /** `chargebacks[].status`, quando vier ("" quando não). */
  statusDoItem: string;
  /** Quantos casos apontam para o MESMO pagamento: com mais de um, o status
   * do pagamento é agregado e não decide nenhum caso sozinho. */
  casosNoPagamento: number;
}

function comoId(valor: unknown): string | null {
  if (typeof valor === "string" && valor.length > 0) return valor;
  // Número só se for inteiro SEGURO — acima disso o JSON já perdeu dígitos.
  if (typeof valor === "number" && Number.isSafeInteger(valor) && valor >= 0) return String(valor);
  return null;
}

/**
 * Lê `transactions.chargebacks[]` da ORDER consultada. Qualquer item sem id,
 * sem case_id, ou apontando para um pagamento que a order não lista → não lê
 * NADA (`ok: false`): meia leitura de dinheiro é pior que nenhuma — quem
 * chama conserva a reserva e avisa o admin.
 */
export function lerContestacoesDaOrder(
  corpo: Record<string, unknown>,
): { ok: true; itens: ItemDaContestacao[] } | { ok: false; motivo: string } {
  const transacoes = corpo.transactions;
  if (!transacoes || typeof transacoes !== "object" || Array.isArray(transacoes)) {
    return { ok: false, motivo: "order sem transactions" };
  }
  const t = transacoes as Record<string, unknown>;
  const brutos = Array.isArray(t.chargebacks) ? t.chargebacks : [];
  if (brutos.length === 0) return { ok: false, motivo: "order sem transactions.chargebacks[]" };
  const pagamentos = (Array.isArray(t.payments) ? t.payments : []).filter(
    (p): p is Record<string, unknown> => Boolean(p) && typeof p === "object",
  );

  const lidos: Array<Omit<ItemDaContestacao, "casosNoPagamento">> = [];
  for (const bruto of brutos) {
    if (!bruto || typeof bruto !== "object") return { ok: false, motivo: "item de chargebacks[] ilegível" };
    const c = bruto as Record<string, unknown>;
    const idContestacao = comoId(c.id);
    const caseId = comoId(c.case_id);
    const idTransacao = comoId(c.transaction_id);
    if (!idContestacao) return { ok: false, motivo: "contestação sem id (CBK)" };
    if (!caseId) return { ok: false, motivo: `contestação ${idContestacao} sem case_id legível` };
    if (!idTransacao) return { ok: false, motivo: `contestação ${idContestacao} sem transaction_id` };
    const pagamento = pagamentos.find((p) => comoId(p.id) === idTransacao);
    if (!pagamento) {
      return { ok: false, motivo: `contestação ${idContestacao} aponta para um pagamento que a order não lista` };
    }
    lidos.push({
      idContestacao,
      caseId,
      idTransacao,
      detalheDoPagamento: typeof pagamento.status_detail === "string" ? pagamento.status_detail : "",
      statusDoItem: typeof c.status === "string" ? c.status : "",
    });
  }
  return {
    ok: true,
    itens: lidos.map((item) => ({
      ...item,
      casosNoPagamento: lidos.filter((outro) => outro.idTransacao === item.idTransacao).length,
    })),
  };
}
