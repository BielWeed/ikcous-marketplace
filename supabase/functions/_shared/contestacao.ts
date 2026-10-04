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
import type { AvisarAdminUmaVez } from "./aviso-ao-lojista.ts";
import type { PedidoParaEstorno } from "./estorno.ts";
import { BASE_URL_PADRAO, extrairValorDaOrder, fetchComTempo } from "./mercadopago.ts";
import { numeroDoPedido } from "./pedido.ts";

/**
 * O `status` CRU da order/pagamento no MP que significa "há contestação" — o
 * gatilho do ledger da contestação, o MESMO no webhook (notificação) e na
 * reconsulta periódica do cron. O mapa de status (`mapearStatusOrder`) traduz
 * isto para 'estornado' e NUNCA decide contestação: quem decide é o caso.
 */
export const STATUS_DA_CONTESTACAO = "charged_back";

/** O aviso "o app não conseguiu registrar sozinho — confira no painel do MP":
 * UM texto para o webhook e para o cron. */
export function avisoContestacaoParaConferir(orderId: string) {
  return {
    title: "Contestação de pagamento para conferir",
    body: `${numeroDoPedido(orderId)} · o Mercado Pago avisou de uma contestação que o app não conseguiu registrar sozinho — confira no painel do Mercado Pago antes de mexer neste pedido`,
    url: "/admin-orders",
  };
}

export type DecisaoDaContestacao = "em_analise" | "contra_a_loja" | "a_favor_da_loja";

export type ResultadoDaConsultaDoCaso =
  | { ok: true; caso: Record<string, unknown> }
  // `transitorio`: rede, 429 ou 5xx — quem chama devolve 500 e o MP reenvia
  // (a reconsulta). Os demais (404, 4xx, case_id ilegível, corpo ilegível)
  // não mudam reenviando: quem chama conserva a reserva e avisa o admin.
  | { ok: false; status: number; transitorio: boolean };

/** O que o ledger da contestação pede do cliente Supabase: só a RPC. Estrutural
 * (e não `ReturnType<typeof createClient>`) para o módulo não amarrar o tipo
 * gerado do banco — o webhook e o cron passam o client de service role. */
export interface ClienteDoLedger {
  rpc(nome: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

/** `case_id` só entra na URL com forma de identificador (sem barra, espaço). */
const FORMA_DO_CASE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** O ID do vendedor no MP é numérico (`GET /users/me` -> `id`). */
const FORMA_DO_ID_DO_VENDEDOR = /^[0-9]{1,20}$/;

/**
 * De onde vem o seller ID (header `X-Caller-Id`, OBRIGATÓRIO em
 * `GET /v1/chargebacks/{id}` segundo
 * https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-management/chargebacks/management):
 * da resposta AUTENTICADA de `GET https://api.mercadopago.com/users/me` com o
 * token da PRÓPRIA loja dona do caso — a mesma chamada que a edge
 * `credenciais-mercado-pago` já faz no backend (teste de conexão), que lá só lê
 * o `nickname`. Quem diz "este token pertence ao vendedor X" é o MP; o `id` é
 * a identidade da conta dona do token, sem parse do token, sem env nova, sem
 * `app_settings` novo e sem nenhum dado do comprador, do corpo ou da query.
 *
 * SOMENTE LEITURA: um GET, rota fixa, sem corpo. Dois tipos de falha:
 *  - PERMANENTE (401/403/4xx, 3xx, corpo ilegível, `id` fora da forma numérica
 *    positiva) -> `null`, e quem consulta o caso CONSERVA e avisa o admin;
 *  - TEMPORÁRIA (rede, timeout, 429, 5xx) -> LANÇA `FalhaTemporariaDoVendedor`,
 *    o MESMO contrato da consulta do caso (`transitorio`): quem chama não toca a
 *    linha, conta falha e tenta de novo no próximo ciclo (tópico: 500, o MP
 *    reenvia). Nunca vira "fonte inválida" — isso adiaria 6 h uma falha de segundos.
 * Nem o token nem o id vão ao log.
 */
export class FalhaTemporariaDoVendedor extends Error {
  constructor(motivo: string) {
    super(`users/me (seller ID) indisponível agora: ${motivo}`);
    this.name = "FalhaTemporariaDoVendedor";
  }
}

export async function resolverVendedorIdDoMp(args: {
  token: string;
  fetchImpl?: typeof fetch;
  tempoLimiteMs?: number;
}): Promise<string | null> {
  const f = args.fetchImpl ?? fetch;
  let resposta: Response;
  try {
    resposta = await fetchComTempo(
      f,
      `${BASE_URL_PADRAO}/users/me`,
      // `redirect: "manual"`: o Authorization NUNCA acompanha um redirecionamento
      // para fora da origem confiável; qualquer 3xx é fonte inválida.
      { method: "GET", headers: { Authorization: `Bearer ${args.token}` }, redirect: "manual" },
      args.tempoLimiteMs,
    );
  } catch (_erro) {
    console.error("mercadopago: users/me (seller ID) sem resposta (rede/timeout) — tenta de novo no próximo ciclo");
    throw new FalhaTemporariaDoVendedor("rede/timeout");
  }
  if (resposta.status === 429 || resposta.status >= 500) {
    console.error("mercadopago: users/me (seller ID) indisponível", resposta.status);
    throw new FalhaTemporariaDoVendedor(`status ${resposta.status}`);
  }
  try {
    if (!resposta.ok || resposta.status >= 300) {
      console.error("mercadopago: users/me (seller ID) recusou ou redirecionou", resposta.status);
      return null;
    }
    const corpo = await resposta.json();
    const bruto = corpo && typeof corpo === "object" && !Array.isArray(corpo) ? (corpo as Record<string, unknown>).id : null;
    const id = comoId(bruto);
    // Forma numérica positiva (o ID de conta do MP é inteiro); número só se SEGURO.
    if (id === null || !FORMA_DO_ID_DO_VENDEDOR.test(id) || /^0+$/.test(id)) {
      console.error("mercadopago: users/me (seller ID) sem id numérico positivo legível");
      return null;
    }
    return id;
  } catch (_erro) {
    console.error("mercadopago: users/me (seller ID) com corpo ilegível");
    return null;
  }
}

/**
 * Um resolvedor POR EXECUÇÃO (uma requisição do webhook, um ciclo do cron):
 * a identidade do dono do token não muda dentro dela, então o `/users/me` sai
 * UMA vez (mesmo com vários casos) e o resultado definitivo — inclusive `null`
 * de fonte inválida — é lembrado só na memória daquela execução; falha
 * temporária não é lembrada. Nunca persistido, nunca entre
 * execuções: token trocado pelo lojista vale na execução seguinte.
 */
export function criarResolvedorDeVendedor(args: {
  token: string;
  fetchImpl?: typeof fetch;
}): () => Promise<string | null> {
  let memo: Promise<string | null> | null = null;
  return () => {
    if (memo) return memo;
    const consulta = resolverVendedorIdDoMp(args);
    memo = consulta;
    // Só o resultado DEFINITIVO (id, ou null de fonte inválida) é lembrado. A falha
    // TEMPORÁRIA não: a chamada seguinte da mesma execução tenta de novo, para não
    // marcar como definitivo (nem conservar/girar) o que é só indisponibilidade.
    consulta.catch(() => {
      if (memo === consulta) memo = null;
    });
    return consulta;
  };
}

export async function consultarContestacao(args: {
  token: string;
  caseId: string;
  /** Seller ID da loja dona do caso (ver `resolverVendedorIdDoMp`). Ausente ou fora
   * da forma numérica: NENHUMA chamada ao MP, resultado não transitório. */
  vendedorId?: string | null;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  tempoLimiteMs?: number;
}): Promise<ResultadoDaConsultaDoCaso> {
  if (typeof args.caseId !== "string" || !FORMA_DO_CASE_ID.test(args.caseId)) {
    return { ok: false, status: 0, transitorio: false };
  }
  if (typeof args.vendedorId !== "string" || !FORMA_DO_ID_DO_VENDEDOR.test(args.vendedorId)) {
    // Sem identidade confiável da loja não há consulta: quem chama conserva e
    // avisa. O valor NUNCA vai ao log (nem o token).
    console.error("mercadopago: chargebacks (consulta) sem seller ID confiável da loja — caso conservado, nada consultado");
    return { ok: false, status: 0, transitorio: false };
  }
  const f = args.fetchImpl ?? fetch;
  const base = args.baseUrl ?? BASE_URL_PADRAO;
  let resposta: Response;
  try {
    resposta = await fetchComTempo(
      f,
      `${base}/v1/chargebacks/${args.caseId}`,
      // Sem seguir redirecionamento: Authorization e X-Caller-Id não saem da origem do MP.
      { method: "GET", headers: { Authorization: `Bearer ${args.token}`, "X-Caller-Id": args.vendedorId }, redirect: "manual" },
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
      // O caso devolvido tem de SER o pedido (bloqueio 4 da revisão do Lote
      // A): `id` do recurso = o case_id (doc chargebacks/management). String
      // igual; número só se inteiro SEGURO (acima de 2^53 o JSON já perdeu
      // dígitos e dois casos diferentes viram o mesmo número). Divergente ou
      // ausente: não lê — quem chama conserva a reserva e avisa o admin;
      // nada é decidido em cima do caso de outro.
      const idDevolvido = comoId((corpo as Record<string, unknown>).id);
      if (idDevolvido !== args.caseId) {
        console.error("mercadopago: chargebacks (consulta) devolveu OUTRO caso ou caso sem id — ignorado", {
          esperado: args.caseId,
          tipoDoId: typeof (corpo as Record<string, unknown>).id,
        });
        return { ok: false, status: resposta.status, transitorio: false };
      }
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

/**
 * A ENTREGA da decisão ao banco — o ÚNICO ponto que chama
 * `registrar_contestacao_no_ledger` e traduz o `aviso` que ela devolve em UM
 * push ao admin. Usada pelo caminho da order (`registrarContestacao`) e pelo
 * caminho do CASO CONHECIDO (`registrarContestacaoConhecida`): a regra de
 * dinheiro mora na RPC, e esta função não decide nada.
 */
async function entregarDecisaoAoLedger(args: {
  supabase: ClienteDoLedger;
  orderId: string;
  idContestacao: string;
  caseId: string;
  decisao: DecisaoDaContestacao;
  valorDoCaso: number | null;
  valorEstimado: number | null;
  casosNaOrder: number;
  pedido: PedidoParaEstorno;
  avisar: AvisarAdminUmaVez;
  rotulo: string;
}): Promise<void> {
  const { supabase, orderId, idContestacao, caseId, decisao, pedido, avisar, rotulo } = args;
  const avisoSaldo = {
    title: "Contestação maior que o saldo do pedido",
    body: `${numeroDoPedido(orderId)} · a contestação do Mercado Pago não cabe no que ainda pode ser devolvido deste pedido — o app reservou o que dava e não concluiu nada; confira no painel do Mercado Pago`,
    url: "/admin-orders",
  };
  const avisoRevertida = {
    title: "Contestação mudou de resultado",
    body: `${numeroDoPedido(orderId)} · o Mercado Pago mudou a decisão de uma contestação já registrada — confira no painel do Mercado Pago; o app não desfaz isso sozinho`,
    url: "/admin-orders",
  };
  const { data, error } = await supabase.rpc("registrar_contestacao_no_ledger", {
    p_order_id: orderId,
    p_mp_chargeback_id: idContestacao,
    p_case_id: caseId,
    p_decisao: decisao,
    p_valor_caso: args.valorDoCaso,
    p_valor_estimado: args.valorEstimado,
    p_casos_na_order: args.casosNaOrder,
  });
  if (error) throw error;
  const retorno = (data ?? null) as Record<string, unknown> | null;
  const resultado = typeof retorno?.resultado === "string" ? retorno.resultado : null;
  if (resultado === null) {
    throw new Error(`${rotulo}: registrar_contestacao_no_ledger devolveu retorno ilegível — o MP reenvia`);
  }
  console.log(`${rotulo}: contestação registrada sob a trava do pedido`, { orderId, idContestacao, decisao, resultado });
  // Estado CANÔNICO depois desta decisão (bloqueio 3): nada aqui decide com o
  // acumulado lido no começo da entrega.
  const valorEstornado = Number(retorno?.valor_estornado);
  if (Number.isFinite(valorEstornado)) pedido.valor_estornado = valorEstornado;

  if (retorno?.aviso === "revertida") {
    console.error(`${rotulo}: contestação mudou de resultado depois de registrada — nada reaberto`, {
      orderId,
      idContestacao,
      decisao,
    });
    await avisar(`contestacao_revertida:${orderId}:${idContestacao}:${decisao}`, avisoRevertida);
  } else if (retorno?.aviso === "saldo") {
    console.error(`${rotulo}: contestação não cabe no saldo do pedido — nada concluído além do que cabe`, {
      orderId,
      idContestacao,
      resultado,
    });
    await avisar(`contestacao_saldo:${orderId}:${idContestacao}:${resultado}`, avisoSaldo);
  } else if (retorno?.aviso !== null && retorno?.aviso !== undefined) {
    console.error(`${rotulo}: contestação sem decisão confiável — reserva CONSERVADA, nada liberado nem concluído`, {
      orderId,
      motivo: `a RPC não registrou a decisão (${resultado})`,
      idContestacao,
    });
    await avisar(`contestacao_indefinida:${orderId}:${idContestacao}:${resultado}`, avisoContestacaoParaConferir(orderId));
  }
}

/**
 * CONTESTAÇÃO (chargeback) NO LEDGER — MORA EM `_shared` desde a FASE 2
 * (04/10/2026): o webhook (notificação) e a reconciliação (reconsulta
 * periódica da reserva presa) chamam ESTE miolo, sem duplicar a regra. Lote A
 * (04/10/2026, R1/R1-NULL e
 * bloqueios 1/3/5/6 da revisão). Ramo B de `registrarDesfechoDoEstorno`.
 * Fontes e vocabulário no cabeçalho de `_shared/contestacao.ts`.
 *
 * QUEM DECIDE O DINHEIRO: a RPC `registrar_contestacao_no_ledger`
 * (migration 20261196000000), com o PEDIDO TRAVADO (FOR UPDATE) — reserva,
 * adota linha antiga, ajusta, conclui e libera numa transação só, contra o
 * estado RELIDO sob a trava, e devolve o estado canônico. Aqui NÃO existe
 * mais retrato local do ledger nem conta de saldo: duas entregas paralelas
 * (mesmo caso, ou casos diferentes do mesmo pedido) se serializam no banco.
 * Antes, cada entrega decidia sobre o que leu no começo — reservas somavam
 * acima do pago (60+60 em 100), a liberação do CBK1 não liberava o saldo do
 * CBK2, e a reserva ESTIMADA de outra entrega era concluída às cegas.
 *
 * IDENTIDADE: `transactions.chargebacks[].id` (CBK), ligada ao `case_id`
 * (`mp_chargeback_case_id`). Sem CBK legível: nada vai à RPC (uma linha sem
 * identidade é duplicável) e o admin é avisado uma vez.
 *
 * DECISÃO (o que vai à RPC): pelo CASO (GET /v1/chargebacks/{case_id},
 * `coverage_applied`, com o id devolvido conferido), corroborado pelo
 * `status_detail` do PAGAMENTO contestado quando o caso é o único daquele
 * pagamento, e pelo `status` do item quando vier. Nunca pelo agregado da
 * order. Desconhecido ou conflito: nada vai à RPC (a reserva fica como
 * está) e o admin é avisado uma vez; a próxima notificação reconsulta.
 * Consulta do caso com falha transitória: lança (500, o MP reenvia).
 *
 * VALOR: `p_valor_caso` é SÓ o valor do caso em reais (BRL, positivo);
 * senão NULL. `p_valor_estimado` é o total pago. A RPC só RESERVA com a
 * estimativa — concluir exige o valor do caso, e só se couber no saldo.
 *
 * AVISO: a RPC devolve `aviso` ('conferir', 'saldo', 'revertida'); cada um
 * vira UM push ao admin por (pedido, caso, desfecho) — `avisarAdminUmaVez`.
 * Erro da RPC: lança (500, o MP reenvia; cada chamada é atômica e
 * idempotente, os casos já gravados não se repetem).
 */
export async function registrarContestacao(args: {
  supabase: ClienteDoLedger;
  orderId: string;
  corpo: Record<string, unknown>;
  ehPayments: boolean;
  pedido: PedidoParaEstorno;
  consultarCaso: (caseId: string) => Promise<ResultadoDaConsultaDoCaso>;
  avisar: AvisarAdminUmaVez;
  /** Prefixo dos logs: "webhook-mercadopago" ou "reconciliar-pagamentos". */
  rotulo?: string;
}): Promise<{ entregues: number; conservadas: number }> {
  const { supabase, orderId, corpo, ehPayments, pedido, consultarCaso, avisar } = args;
  let entregues = 0;
  let conservadas = 0;
  const rotulo = args.rotulo ?? "webhook-mercadopago";
  const idCobranca = String(corpo.id ?? "");
  const avisoConferir = avisoContestacaoParaConferir(orderId);
  const conservaEAvisa = async (chave: string, motivo: string, extra: Record<string, unknown> = {}) => {
    console.error(
      `${rotulo}: contestação sem decisão confiável — reserva CONSERVADA, nada liberado nem concluído`,
      { orderId, motivo, ...extra },
    );
    conservadas++;
    await avisar(chave, avisoConferir);
  };

  if (ehPayments) {
    await conservaEAvisa(
      `contestacao_indefinida:${orderId}:${idCobranca}`,
      "pagamento clássico não traz a identidade do caso (transactions.chargebacks[])",
    );
    return { entregues, conservadas };
  }
  const leitura = lerContestacoesDaOrder(corpo);
  if (!leitura.ok) {
    await conservaEAvisa(`contestacao_indefinida:${orderId}:${idCobranca}`, leitura.motivo);
    return { entregues, conservadas };
  }

  const valorPagoBruto = extrairValorDaOrder(corpo);
  const valorEstimado = typeof valorPagoBruto === "number" && Number.isFinite(valorPagoBruto) && valorPagoBruto > 0
    ? Number(valorPagoBruto.toFixed(2))
    : null;

  for (const item of leitura.itens) {
    const consulta = await consultarCaso(item.caseId);
    if (!consulta.ok) {
      if (consulta.transitorio) {
        throw new Error(
          `${rotulo}: consulta do caso da contestação falhou (status ${consulta.status}) — o MP reenvia`,
        );
      }
      await conservaEAvisa(
        `contestacao_indefinida:${orderId}:${item.idContestacao}`,
        `caso da contestação ilegível ou de outro caso (status ${consulta.status})`,
      );
      continue;
    }

    const peloCaso = decisaoDoCaso(consulta.caso);
    const peloPagamento = decisaoDoStatusDoPagamento(item.detalheDoPagamento);
    const peloItem = decisaoDoStatusDoPagamento(item.statusDoItem);
    const conflito = peloCaso === null ||
      (item.casosNoPagamento === 1 && peloPagamento !== peloCaso) ||
      (peloItem !== null && peloItem !== peloCaso);
    if (peloCaso === null || conflito) {
      await conservaEAvisa(
        `contestacao_indefinida:${orderId}:${item.idContestacao}:${peloCaso}:${peloPagamento}`,
        "o caso, o pagamento contestado e o item da contestação não dizem a mesma coisa",
        { idContestacao: item.idContestacao, peloCaso, peloPagamento, peloItem },
      );
      continue;
    }

    await entregarDecisaoAoLedger({
      supabase,
      orderId,
      idContestacao: item.idContestacao,
      caseId: item.caseId,
      decisao: peloCaso,
      valorDoCaso: valorDoCaso(consulta.caso),
      valorEstimado,
      casosNaOrder: leitura.itens.length,
      pedido,
      avisar,
      rotulo,
    });
    entregues++;
  }
  return { entregues, conservadas };
}

/**
 * CASO CONHECIDO — a recuperação de uma contestação cujo VÍNCULO já está
 * gravado e autenticado no ledger (linha `sistema` com `mp_chargeback_id` e
 * `mp_chargeback_case_id`, escritos por `registrar_contestacao_no_ledger` a
 * partir de uma notificação autenticada). Existe para o caso em que a ORDER
 * NÃO diz mais `charged_back` (a documentação do MP NÃO descreve o estado da
 * order depois de a disputa ser resolvida — ver `reconsulta-de-contestacao.ts`)
 * ou deixou de listar `transactions.chargebacks[]`: a decisão sai do CASO
 * pelo id EXATO (`GET /v1/chargebacks/{case_id}`, id devolvido conferido por
 * `consultarContestacao`), nunca de um palpite por valor, tempo ou pagamento.
 *
 * VÍNCULO: o `case_id` gravado na linha (veio da order autenticada do próprio
 * pedido) e o `id` EXATO devolvido pelo GET do caso; a RPC confere
 * `vinculo_divergente`. Não se compara `caso.payments` (id numérico da API v1)
 * com `order.transactions.payments[].id` (PAY01...): são espaços de id diferentes
 * — não se compara, não se converte, não se adivinha a correspondência.
 *  - 'a_favor_da_loja' LIBERA a reserva (o sentido que devolve saldo e que a RPC
 *    grava como decisão final, sem reabrir) — EXCETO com evidência contrária em
 *    mãos (pagamento da order deste pedido com status_detail de outra decisão):
 *    aí CONSERVA e avisa.
 *  - 'contra_a_loja' NUNCA conclui por este caminho — dinheiro que sai,
 *    irreversível, sem corroboração — CONSERVA e avisa (quem conclui é o caminho
 *    da order, com `chargebacks[]` legível e o pagamento da MESMA order).
 *  - Caso ainda em análise: nada a entregar (a reserva já existe); só gira.
 * Falha transitória do MP LANÇA (o chamador repete); o resto conserva e avisa
 * UMA vez. Quem decide o dinheiro continua sendo a RPC, sob a trava do pedido.
 */
/** Os pagamentos da ORDER (`transactions.payments[]`), ou nenhum se não houver order/forma. */
function pagamentosDaOrder(corpoDaOrder: Record<string, unknown> | null): Array<Record<string, unknown>> {
  const transacoes = corpoDaOrder?.transactions;
  if (!transacoes || typeof transacoes !== "object" || Array.isArray(transacoes)) return [];
  const lista = (transacoes as Record<string, unknown>).payments;
  return (Array.isArray(lista) ? lista : []).filter((p): p is Record<string, unknown> => Boolean(p) && typeof p === "object");
}

export type DesfechoDoCasoConhecido = "entregue" | "em_aberto" | "conservada";

export async function registrarContestacaoConhecida(args: {
  supabase: ClienteDoLedger;
  orderId: string;
  /** `mp_chargeback_id` da linha (CBK). */
  idContestacao: string;
  /** `mp_chargeback_case_id` da linha — o vínculo autenticado. */
  caseId: string;
  /** A order reconsultada, SÓ para corroborar e estimar; pode ser `null`. */
  corpoDaOrder: Record<string, unknown> | null;
  casosNaOrder: number;
  pedido: PedidoParaEstorno;
  consultarCaso: (caseId: string) => Promise<ResultadoDaConsultaDoCaso>;
  avisar: AvisarAdminUmaVez;
  rotulo?: string;
}): Promise<DesfechoDoCasoConhecido> {
  const { supabase, orderId, idContestacao, caseId, corpoDaOrder, pedido, consultarCaso, avisar } = args;
  const rotulo = args.rotulo ?? "webhook-mercadopago";
  const conservar = async (motivo: string, extra: Record<string, unknown> = {}): Promise<DesfechoDoCasoConhecido> => {
    console.error(
      `${rotulo}: contestação sem decisão confiável — reserva CONSERVADA, nada liberado nem concluído`,
      { orderId, idContestacao, motivo, ...extra },
    );
    await avisar(`contestacao_indefinida:${orderId}:${idContestacao}`, avisoContestacaoParaConferir(orderId));
    return "conservada";
  };

  const consulta = await consultarCaso(caseId);
  if (!consulta.ok) {
    if (consulta.transitorio) {
      throw new Error(`${rotulo}: consulta do caso da contestação falhou (status ${consulta.status}) — repete`);
    }
    return await conservar(`caso da contestação ilegível ou de outro caso (status ${consulta.status})`);
  }
  const peloCaso = decisaoDoCaso(consulta.caso);
  if (peloCaso === null) return await conservar("o caso não traz decisão legível (coverage_applied)");

  // O VÍNCULO deste caso com ESTE pedido é o `case_id` gravado na linha (veio da
  // order autenticada do próprio pedido) com o `id` devolvido EXATO pelo GET do
  // caso (`consultarContestacao` confere); a RPC ainda cobra `vinculo_divergente`.
  // NÃO se compara `caso.payments` com `order.transactions.payments[].id`: pela
  // doc do MP o primeiro é o id numérico da API v1 (ex.: 86439942806) e o segundo
  // é PAY01..., espaços de id diferentes — nem se compara, nem se converte, nem
  // se adivinha a correspondência. Comparar os dois conservava todo caso com a
  // order presente e avisava o admin com um motivo falso.
  // Sem corroboração por pagamento, só o que DEVOLVE saldo se entrega: 'a favor'
  // libera a reserva (a RPC grava a decisão final e a lápide, sem reabrir);
  // 'contra' (dinheiro que sai, irreversível) CONSERVA e avisa.
  //
  // EVIDÊNCIA CONTRÁRIA EM MÃOS conserva o 'a favor': se a order DESTE pedido
  // (veio do GET autenticado) traz algum pagamento cujo `status_detail` mapeia
  // para outra decisão (ex.: 'settled' = contra a loja), o caso e a order se
  // contradizem — o MESMO conflito que o caminho da order conserva, pelo MESMO
  // mapeamento (`decisaoDoStatusDoPagamento`). Compara ESTADO dentro da mesma
  // order, nunca ids de espaços diferentes. Liberar aqui gravaria a lápide
  // 'a favor' e travaria um 'contra' posterior (viraria só `revertido`).
  // Sem order em mãos, ou sem evidência contrária: o 'a favor' libera.
  // LIMITAÇÃO CONSERVADORA (multicaso): com vários pagamentos na order e sinais
  // MISTOS, basta UM com status contrário (ou diferente do caso) para conservar —
  // sem casar ids, o app não sabe qual pagamento é o contestado, e conservar é o
  // lado seguro (o admin confere no painel do MP). Nenhuma consulta nova ao MP v1.
  if (peloCaso === "a_favor_da_loja") {
    const contrarias = pagamentosDaOrder(corpoDaOrder).filter((p) => {
      const d = decisaoDoStatusDoPagamento(typeof p.status_detail === "string" ? p.status_detail : "");
      return d !== null && d !== peloCaso;
    });
    if (contrarias.length > 0) {
      return await conservar("o caso é a favor da loja mas a order deste pedido tem pagamento com status contrário — nada liberado", {
        peloCaso,
        pagamentosContrarios: contrarias.length,
      });
    }
  }
  if (peloCaso === "em_analise") return "em_aberto";
  if (peloCaso === "contra_a_loja") {
    return await conservar("decisão contra a loja sem corroboração do pagamento contestado — nada concluído", { peloCaso });
  }

  const valorPagoBruto = corpoDaOrder ? extrairValorDaOrder(corpoDaOrder) : undefined;
  const valorEstimado = typeof valorPagoBruto === "number" && Number.isFinite(valorPagoBruto) && valorPagoBruto > 0
    ? Number(valorPagoBruto.toFixed(2))
    : null;
  await entregarDecisaoAoLedger({
    supabase,
    orderId,
    idContestacao,
    caseId,
    decisao: peloCaso,
    valorDoCaso: valorDoCaso(consulta.caso),
    valorEstimado,
    casosNaOrder: Math.max(1, args.casosNaOrder),
    pedido,
    avisar,
    rotulo,
  });
  return "entregue";
}
