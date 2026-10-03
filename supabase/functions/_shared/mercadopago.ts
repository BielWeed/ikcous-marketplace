// @ts-nocheck
/**
 * Cliente da API do Mercado Pago, compartilhado entre as edge functions.
 *
 * POR QUE ELE EXISTE SEPARADO DA FUNCTION
 *
 * A `criar-pagamento` (Fase 2) e a `webhook-mercadopago` (Fase 3) falam com a
 * mesma API e precisam do MESMO mapa de status. Duplicar esse mapa é como este
 * repositório chegou a ter a regra de frete grátis escrita em sete lugares
 * (#53) — e aqui a divergência silenciosa marcaria pedido como pago quando o
 * MP disse outra coisa. Mesmo motivo do `_shared/webpush.ts`.
 *
 * `fetch` entra por parâmetro para o teste não tocar rede.
 */

// Exportada pelo M1 do laudo do PR #438 (07/09): o executor de estorno
// (`estorno.ts`) precisava da MESMA base e a redeclarava — segunda cópia da
// mesma URL é o defeito #53 (regra em dois lugares) esperando para divergir.
export const BASE_URL_PADRAO = "https://api.mercadopago.com";

/**
 * Teto de espera para todo fetch deste arquivo, em milissegundos.
 *
 * LAUDO VARREDURA 01/09 (P-4): até este conserto as quatro chamadas à API do
 * MP (`criarOrder`, `consultarOrder`, `criarPagamento`, `consultarPagamento`)
 * penduravam sem limite nenhum — gateway lento/pendurado segurava a
 * requisição até o wall-clock da plataforma, com o cliente olhando
 * "Finalizar" girando e a conexão do webhook/reconciliação presa. O valor é
 * o MESMO do padrão da casa (`buscarComTempo` do calculate-shipping, laudo
 * 31/08 D2): o MP responde em segundos quando está de pé; 15s já é folga
 * generosa para um gateway de pagamento.
 */
export const TEMPO_LIMITE_MS = 15000;

/**
 * Fetch com TEMPO DE ESPERA — o padrão da casa (`buscarComTempo` do
 * calculate-shipping, laudo 31/08 D2), trazido para cá pelo P-4 do laudo de
 * varredura de 01/09. O AbortController corta no tempo; quem chama vê o
 * aborto como qualquer falha de rede e cai no tratamento que já existe
 * (aqui: `catch` → `{ ok: false, status: 0 }`).
 *
 * O `buscar` entra como parâmetro (o fetch de fora, injetável — mesma regra
 * das funções deste arquivo) para o teste não tocar rede nem esperar os 15s
 * do default: passa um teto curto e um fetch que só desiste quando o sinal
 * dispara. Em produção nada muda: chama-se com o `fetch` de sempre.
 */
export async function fetchComTempo(
  buscar: typeof fetch,
  url: string,
  init: RequestInit = {},
  tempoMs: number = TEMPO_LIMITE_MS,
): Promise<Response> {
  const controle = new AbortController();
  const despertar = setTimeout(() => controle.abort(), tempoMs);
  try {
    return await buscar(url, { ...init, signal: controle.signal });
  } finally {
    // Sem o clear, cada chamada deixaria um timer pendurado no event loop
    // até estourar — em webhook/reconciliação de lote, dezenas de timers
    // vivos à toa.
    clearTimeout(despertar);
  }
}

/**
 * Decide se um `gateway_payment_id` tem a FORMA de um id CLÁSSICO de
 * pagamento (só dígitos, ex.: "123456789012") — em oposição à forma de uma
 * order da Orders API (ULID maiúsculo, prefixo "ORD" em produção, "ORDTST"
 * em teste).
 *
 * ORIGEM ÚNICA: extraída de `webhook-mercadopago/index.ts` (que já decidia
 * assim, pela forma, quando o `type` do evento vem ausente — ver o
 * comentário grande de `rota` lá) para `reconciliar-pagamentos/index.ts` e
 * `criar-pagamento/index.ts` (Tarefa 4, CHECKOUT-070) pararem de escrever a
 * MESMA regex `/^\d+$/` pela terceira vez — a doença do #53 (regra repetida
 * em mais de um lugar) de novo.
 *
 * POR QUE FORMA, NÃO CÓDIGO DE ERRO HTTP: os dois arquivos que consomem esta
 * função discriminavam antes pelo status HTTP que `GET /v1/orders/{id}`
 * devolvia, esperando 404 para todo id legado. O MP não devolve 404 para um
 * id sem forma de order — devolve 400 `invalid_path_param` ("must begin with
 * the prefix 'ORD' and be followed by 26 characters"); 404 só existe quando a
 * FORMA já é de order, mas a order não existe. Um id clássico (numérico)
 * nunca tem forma de order, então batia 400, nunca 404 — o fallback para o
 * legado nunca disparava, e um PIX legado pago sumia da fila de reconciliação
 * (ou devolvia 502 pro cliente em `criar-pagamento`). Decidir pela forma não
 * depende de o MP manter essa taxonomia de erro.
 */
export function idEhClassico(id: string): boolean {
  return /^\d+$/.test(id);
}

/**
 * Traduz o status do MP para o `payment_status` deste banco.
 *
 * Devolve `null` para o que não conhece, DE PROPÓSITO: um status novo do MP
 * não pode virar 'pago' por default otimista. Quem chama decide — e o que a
 * `criar-pagamento` faz é registrar e deixar o pedido em 'aguardando', que é o
 * estado que a expiração já sabe tratar.
 */
export function mapearStatus(status: string): string | null {
  switch (status) {
    case "approved":
      return "pago";
    case "rejected":
    case "cancelled":
      return "recusado";
    case "pending":
    case "in_process":
    case "authorized":
      return "aguardando";
    case "refunded":
    case "charged_back":
      return "estornado";
    default:
      return null;
  }
}

/**
 * Esta função não converte fuso horário — ela normaliza o offset que o MP
 * exige. `date_of_expiration` terminado em 'Z' é recusado; qualquer offset
 * explícito serve, desde que denote o mesmo instante. Por isso o
 * deslocamento (-3h) e o rótulo (-03:00) SEMPRE mudam juntos: trocar só um
 * dos dois desloca a expiração real sem que nenhum teste de formato acuse.
 */
export function formatarExpiracao(iso: string): string {
  const d = new Date(iso);
  const deslocado = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  return `${deslocado.toISOString().replace("Z", "")}-03:00`;
}

export function montarCorpoPix(args: {
  valor: number;
  descricao: string;
  email: string;
  expiraEm: string;
  orderId: string;
  documento?: { type: string; number: string };
  notificationUrl?: string;
}): Record<string, unknown> {
  const payer: Record<string, unknown> = { email: args.email };
  // A-2 da revisão final: sem isso o documento entrava pelo front e sumia
  // aqui — montarCorpoCartao já aceitava o mesmo parâmetro; a documentação
  // de PIX do MP monta o payer com identification igual à de cartão.
  if (args.documento) payer.identification = args.documento;

  return {
    transaction_amount: args.valor,
    description: args.descricao,
    payment_method_id: "pix",
    date_of_expiration: args.expiraEm,
    payer,
    // Sem isso o MP não guarda ponteiro de volta para o pedido, e a
    // reconciliação da Fase 3 teria que casar valor + e-mail + horário na
    // mão. Com isso vira GET /v1/payments/search?external_reference=<id>.
    external_reference: args.orderId,
    // Sem isto o webhook depende de configuracao no painel do MP — que ninguem
    // percebe quando some, e nenhum teste pega. Herança nº 4 da Fase 2.
    ...(args.notificationUrl ? { notification_url: args.notificationUrl } : {}),
  };
}

/**
 * TABELA ÚNICA status+status_detail → `payment_status` deste banco. Único
 * consumidor hoje: `mapearStatusOrder` (abaixo). Até CHECKOUT-080 também
 * alimentava `traduzirStatusOrderParaClassico` (`criar-pagamento/index.ts`),
 * que traduzia para o vocabulário CLÁSSICO do MP que o front lia — essa
 * segunda tradução foi apagada porque `criar-pagamento` passou a emitir o
 * MESMO `payment_status` deste banco para o front, fechando a divergência de
 * vocabulário entre backend e tela (issue CHECKOUT-080, #213).
 *
 * A tabela continua ÚNICA mesmo com um consumidor só: é o achado que
 * sobrevive à mudança acima. Achado da revisão do PR (Tarefa 2,
 * CHECKOUT-070): antes desta tabela existir, os dois mapas (o deste arquivo
 * e o que hoje foi removido de `criar-pagamento/index.ts`) viviam em
 * ARQUIVOS DIFERENTES, cada um com o próprio switch sobre o mesmo par — e já
 * tinham divergido em 6 pares (estornos, chargeback, `expired`, que só
 * existiam no mapa do banco). É o defeito #53 deste repositório (a mesma
 * regra escrita em mais de um lugar) se repetindo dentro da MESMA função de
 * negócio. Um segundo consumidor pode voltar a existir amanhã; a tabela não
 * volta a ser reescrita por lugar quando isso acontecer.
 *
 * "processed:partially_refunded" NÃO está nesta tabela, de propósito
 * (PEDIDO-05, auditoria de 26/08/2026). Estava mapeado para "estornado" — o
 * MESMO rótulo do estorno TOTAL ("refunded:refunded") — e este banco NÃO
 * distinguia "quanto voltou" pelo `payment_status`. `confirmar_pagamento`
 * não distingue os dois rótulos, e as nove agregações do analítico filtram
 * `payment_status IN ('pago', 'pago_apos_expirar')`
 * (`20260822000100_analitico_conta_so_dinheiro_reconhecido.sql`) — um
 * estorno de R$ 5 num pedido de R$ 200 apagava os R$ 200 inteiros do
 * faturamento, não só os R$ 5. A doc oficial do MP (checkout-api-orders/
 * payment-management/status/order-status, context7, 26/08/2026) confirma que
 * "processed" + "partially_refunded" é o par documentado para devolução
 * PARCIAL — distinto de "refunded" + "refunded" (devolução TOTAL, estado
 * terminal). ATUALIZAÇÃO (T5 do plano de estorno pelo app, 08/09/2026): esta
 * tabela continua devolvendo `null` para o par PARCIAL de propósito — o
 * `payment_status` nunca ganhou um terceiro rótulo para "parcialmente
 * estornado". O que mudou é que "quanto voltou" agora TEM onde morar: a
 * coluna `marketplace_orders.valor_estornado` e o ledger `order_refunds`
 * (migration `2026110000000_o_estorno_nasce_no_ledger.sql`), registrados
 * pelo passo novo do `webhook-mercadopago`
 * (`registrarDesfechoDoEstorno`) — não por esta tabela nem por
 * `mapearStatusOrder`. Continua certo NÃO AFIRMAR pelo `payment_status` o
 * que ele não tem vocabulário para dizer: par ausente cai no `?? null` de
 * `mapearStatusOrder` (abaixo), a MESMA regra que o resto deste arquivo já
 * segue para todo par desconhecido — o pedido fica intacto e o caso vira
 * log (ou, agora, linha no ledger), em vez de apagar uma venda inteira em
 * silêncio.
 *
 * OUTROS PARES REVISADOS PELA MESMA REGRA, E MANTIDOS: "charged_back:*"
 * (in_process/settled/reimbursed) não têm "partial" no nome nem na doc do MP
 * (checkout-api-orders/payment-management/chargebacks/management — dispute é
 * do PAGAMENTO inteiro, resolvida por settled=perda ou reimbursed=vitória do
 * vendedor), então não sofrem da MESMA ambiguidade de valor que
 * partially_refunded sofria. Achado à parte, fora do escopo desta correção:
 * "charged_back:in_process" marca o pedido 'estornado' antes da disputa ter
 * um DESFECHO (a decisão ainda não saiu), e "charged_back:reimbursed" é a
 * decisão FAVORÁVEL ao vendedor (o valor volta PARA ELE) mapeando para o
 * mesmo rótulo que uma perda definitiva — os dois merecem uma correção
 * própria, revisada à parte, não incluída aqui.
 *
 * CARTÃO (Fase 3.5, 26/09/2026): três pares de ESPERA novos — o desafio
 * 3-D Secure pendente (`action_required:pending_challenge`) e as duas
 * análises antifraude (`processing:in_review`,
 * `processing:pending_review_manual`). Todos 'aguardando': o dinheiro ainda
 * não entrou, e quem fecha o desfecho é o webhook/reconciliação. Além da
 * tabela, TODO `failed:<detalhe>` vira 'recusado' (ver `mapearStatusOrder`,
 * abaixo): a recusa de cartão chega com o motivo no `status_detail`
 * (`failed:rejected_by_issuer`, `failed:high_risk`…), e enumerar cada motivo
 * aqui deixaria o próximo que o MP inventar cair em `null` — um cartão
 * recusado que ninguém liberaria.
 */
export const MAPA_STATUS_ORDER: Record<string, string> = {
  "processed:accredited": "pago",
  "created:created": "aguardando",
  "processing:in_process": "aguardando",
  "processing:in_review": "aguardando",
  "processing:pending_review_manual": "aguardando",
  "action_required:waiting_payment": "aguardando",
  "action_required:waiting_capture": "aguardando",
  // waiting_transfer é o estado do PIX recém-criado — o mais comum em produção.
  "action_required:waiting_transfer": "aguardando",
  // Cartão com desafio 3-D Secure pedido pelo banco: a URL do desafio vem em
  // `extrairDesafio3ds` (abaixo).
  "action_required:pending_challenge": "aguardando",
  "refunded:refunded": "estornado",
  "charged_back:in_process": "estornado",
  "charged_back:settled": "estornado",
  "charged_back:reimbursed": "estornado",
  // Mesmo rótulo que o mapearStatus clássico dá para 'cancelled': este banco
  // não tem um valor 'cancelado' separado de 'recusado'.
  "canceled:canceled": "recusado",
  "failed:failed": "recusado",
  "expired:expired": "expirado",
};

/**
 * Traduz status + status_detail da Orders API para o `payment_status` que
 * este banco já usa (CHECK constraint marketplace_orders_payment_status_check,
 * espelhada em src/types/index.ts: 'aguardando' | 'pago' | 'recusado' |
 * 'expirado' | 'estornado' | 'pago_apos_expirar').
 *
 * NÃO é um mapa de `status` sozinho: `processed` também aparece em
 * `processed + partially_refunded`, que não é pago (nem "estornado" — ver o
 * comentário grande de MAPA_STATUS_ORDER, acima, PEDIDO-05). Por isso a
 * chave é o PAR — igual ao motivo pelo qual mapearStatus (acima) nunca teve
 * esse problema: o clássico só tinha um campo para olhar.
 *
 * `pago_apos_expirar` não é produzido aqui de propósito: essa transição
 * depende do estado ATUAL do pedido no banco (se já expirou), e quem decide
 * isso é a RPC confirmar_pagamento — igual ao clássico mapearStatus, que
 * também só devolve 'pago'.
 *
 * Combinação desconhecida devolve `null`, nunca um palpite — mesma regra
 * herdada do mapearStatus clássico. Leitor fino de MAPA_STATUS_ORDER, acima.
 *
 * REGRAS fora da tabela — `status` sozinho decide, qualquer `status_detail`
 * (Fase 3.5, e adendo 2 da 8ª rodada de risco, 26/09/2026, para as duas de
 * baixo): os três são estados TERMINAIS documentados da Orders API, sem
 * dinheiro NOVO capturável — o detalhe só diz o motivo, nunca muda o
 * desfecho:
 *   - `"failed"` → 'recusado' (já existia, Fase 3.5).
 *   - `"canceled"`/`"cancelled"` → 'recusado' (achado do adendo 2: só a
 *     tabela cobria `"canceled:canceled"` — um detalhe novo, como
 *     `"canceled_transaction"`/`"canceled_by_api"` (medido por WebSearch
 *     contra a doc do MP, domínios mercadopago.* bloqueados para fetch
 *     direto neste ambiente — UNVERIFIED contra a API real), caía em `null`
 *     e a vaga ficava "em análise" para sempre, mesmo com a order já
 *     cancelada. A Orders API só cancela order em `action_required`/
 *     `created` — SEM dinheiro capturado ainda, em qualquer detalhe.
 *   - `"expired"` → 'expirado' (achado do adendo 2, mesma lacuna): a doc do
 *     MP descreve `expired` como "uma order cancelada sem pagamento
 *     aprovado ou pendente" — terminal por definição, qualquer detalhe.
 */
export function mapearStatusOrder(
  status: string,
  statusDetail: string,
): string | null {
  if (typeof status !== "string" || typeof statusDetail !== "string") return null;
  const mapeado = MAPA_STATUS_ORDER[`${status}:${statusDetail}`];
  if (mapeado) return mapeado;
  if (status === "failed" || status === "canceled" || status === "cancelled") return "recusado";
  if (status === "expired") return "expirado";
  return null;
}

// ─── Cartão pela Orders API (Fase 3.5, 26/09/2026) ─────────────────────────
//
// Spec: docs/superpowers/specs/2026-09-26-cartao-online-design.md. O dado do
// cartão NUNCA passa por aqui: o Card Payment Brick tokeniza no navegador e o
// servidor recebe só o token de uso único (PCI SAQ-A). Nada deste bloco loga
// token, CPF/CNPJ ou e-mail — as mensagens de erro são genéricas de propósito.

/** Os dois tipos de cartão que a Orders API aceita neste app. */
const TIPOS_DE_CARTAO = new Set(["credit_card", "debit_card"]);

/** Token de uso único do Brick: letras, dígitos e hífen, 16..128. Fonte única
 * — `criar-pagamento` valida o corpo com ESTA função antes de tocar o banco,
 * e `montarCorpoCartaoOrders` confere de novo antes de montar (defesa em
 * profundidade: o mesmo teste nos dois lugares, nunca duas regex). */
export function tokenDeCartaoValido(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9-]{16,128}$/.test(token);
}

/** `payment_method.id` da bandeira (ex.: "master", "visa", "debelo"). */
export function metodoDeCartaoValido(id: unknown): id is string {
  return typeof id === "string" && /^[a-z0-9_]{2,30}$/.test(id);
}

/** `credit_card` ou `debit_card` — nada mais vira cobrança de cartão. */
export function tipoDeCartaoValido(tipo: unknown): tipo is "credit_card" | "debit_card" {
  return typeof tipo === "string" && TIPOS_DE_CARTAO.has(tipo);
}

/** Parcelas: inteiro de 1 a 12 (o teto da loja é conferido por quem chama). */
export function parcelasValidas(parcelas: unknown): parcelas is number {
  return Number.isInteger(parcelas) && (parcelas as number) >= 1 && (parcelas as number) <= 12;
}

/**
 * Documento do titular, normalizado: aceita a máscara que o Brick ou uma
 * pessoa digita (ponto, hífen, barra, espaço) e devolve só os dígitos, com 11
 * para CPF e 14 para CNPJ. Qualquer outra coisa (letra, tamanho errado, tipo
 * desconhecido) devolve `null` — nunca um documento "consertado" por palpite.
 */
export function normalizarDocumento(
  documento: unknown,
): { type: "CPF" | "CNPJ"; number: string } | null {
  if (!documento || typeof documento !== "object") return null;
  const { type, number } = documento as Record<string, unknown>;
  if (type !== "CPF" && type !== "CNPJ") return null;
  if (typeof number !== "string") return null;
  const digitos = number.replace(/[.\-/\s]/g, "");
  const tamanho = type === "CPF" ? 11 : 14;
  if (!/^\d+$/.test(digitos) || digitos.length !== tamanho) return null;
  return { type, number: digitos };
}

/**
 * Monta o corpo de `POST /v1/orders` para CARTÃO (crédito ou débito).
 *
 * Mesmas três regras de grafia do PIX (`montarCorpoPixOrders`): valores em
 * STRING de duas casas, `external_reference` = id do pedido,
 * `processing_mode: "automatic"`. As diferenças do cartão:
 *
 * - `capture_mode: "automatic_async"` — captura automática, assíncrona (o
 *   desfecho pode chegar depois, pelo webhook).
 * - `config.online.transaction_security` — 3-D Secure quando o MP vê risco de
 *   fraude, com a responsabilidade transferida ao emissor (`liability_shift:
 *   required`). Quando o banco pede desafio, a resposta traz a URL
 *   (`extrairDesafio3ds`).
 * - Débito vai SEMPRE com `installments: 1`, qualquer que seja o valor
 *   recebido — débito não parcela.
 * - `issuer_id` e o `processing_mode` que o Brick devolve NÃO entram: o
 *   emissor sai do token, e o modo de processamento é decisão do servidor.
 *
 * Valida tudo e LANÇA em entrada inválida (este arquivo tem `@ts-nocheck`:
 * só o `throw` barra). As mensagens nunca carregam o valor recusado — um
 * token, CPF ou e-mail não pode parar no log por uma mensagem de erro.
 */
export function montarCorpoCartaoOrders(args: {
  orderId: string;
  valor: number;
  email: string;
  nome?: string;
  documento: { type: "CPF" | "CNPJ"; number: string };
  token: string;
  paymentMethodId: string;
  paymentTypeId: "credit_card" | "debit_card";
  parcelas: number;
}): Record<string, unknown> {
  if (typeof args.orderId !== "string" || args.orderId.length === 0) {
    throw new Error("montarCorpoCartaoOrders: orderId obrigatório.");
  }
  if (typeof args.valor !== "number" || !Number.isFinite(args.valor) || args.valor <= 0) {
    throw new Error("montarCorpoCartaoOrders: valor precisa ser um número maior que zero.");
  }
  if (typeof args.email !== "string" || !/^\S+@\S+\.\S+$/.test(args.email)) {
    throw new Error("montarCorpoCartaoOrders: e-mail do pagador inválido.");
  }
  if (!tokenDeCartaoValido(args.token)) {
    throw new Error("montarCorpoCartaoOrders: token do cartão com formato inválido.");
  }
  if (!metodoDeCartaoValido(args.paymentMethodId)) {
    throw new Error("montarCorpoCartaoOrders: paymentMethodId com formato inválido.");
  }
  if (!tipoDeCartaoValido(args.paymentTypeId)) {
    throw new Error("montarCorpoCartaoOrders: paymentTypeId precisa ser credit_card ou debit_card.");
  }
  if (!parcelasValidas(args.parcelas)) {
    throw new Error("montarCorpoCartaoOrders: parcelas precisa ser um inteiro de 1 a 12.");
  }
  const documento = normalizarDocumento(args.documento);
  if (!documento) {
    throw new Error("montarCorpoCartaoOrders: documento precisa ser CPF (11 dígitos) ou CNPJ (14).");
  }

  const valorFormatado = args.valor.toFixed(2);
  const parcelas = args.paymentTypeId === "debit_card" ? 1 : args.parcelas;

  const payer: Record<string, unknown> = { email: args.email };
  if (args.nome) payer.first_name = args.nome;
  payer.identification = documento;

  return {
    type: "online",
    processing_mode: "automatic",
    capture_mode: "automatic_async",
    external_reference: args.orderId,
    total_amount: valorFormatado,
    payer,
    transactions: {
      payments: [
        {
          amount: valorFormatado,
          payment_method: {
            id: args.paymentMethodId,
            type: args.paymentTypeId,
            token: args.token,
            installments: parcelas,
          },
        },
      ],
    },
    config: {
      online: {
        transaction_security: {
          validation: "on_fraud_risk",
          liability_shift: "required",
        },
      },
    },
  };
}

/** `transactions.payments[0]` da order, ou `undefined` — leitor comum dos
 * extratores de cartão abaixo (mesmo caminho que `extrairQrCode` percorre). */
function primeiroPagamentoDaOrder(
  order: Record<string, unknown> | null | undefined,
): Record<string, unknown> | undefined {
  if (!order || typeof order !== "object") return undefined;
  const transacoes = order.transactions as Record<string, unknown> | undefined;
  const pagamentos = transacoes?.payments as unknown[] | undefined;
  const pagamento = pagamentos?.[0];
  return pagamento && typeof pagamento === "object"
    ? pagamento as Record<string, unknown>
    : undefined;
}

/**
 * O TIPO do meio de pagamento da order: "credit_card", "debit_card",
 * "bank_transfer" (PIX)… `null` quando a order não diz. É o que separa, no
 * webhook e na reconciliação, a recusa de CARTÃO (libera a vaga — o cliente
 * tenta de novo) da recusa de PIX (cancela o pedido, como sempre).
 */
export function tipoDoPagamentoDaOrder(
  order: Record<string, unknown> | null | undefined,
): string | null {
  const metodo = primeiroPagamentoDaOrder(order)?.payment_method as
    | Record<string, unknown>
    | undefined;
  return typeof metodo?.type === "string" ? metodo.type : null;
}

/**
 * As parcelas do PAGAMENTO da order — `transactions.payments[0].payment_
 * method.installments`, o MESMO campo que `montarCorpoCartaoOrders` manda na
 * criação (débito sempre 1). `null` quando a order não é de cartão ou o campo
 * não veio (a Orders API não promete ecoar tudo que recebeu de volta).
 *
 * Achado S3 (3ª revisão de risco, 26/09/2026): a ADOÇÃO da vaga
 * (`webhook-mercadopago/index.ts`, Achado B2) lia só `gateway_payment_id` da
 * cobrança aprovada — `metodo_online` e `parcelas` ficavam NULL mesmo para um
 * cartão de verdade, e o comprovante/Financeiro contavam a venda como PIX.
 * Fonte única para não duplicar a leitura de `payment_method.installments` no
 * dia em que outro chamador precisar do mesmo dado.
 *
 * Menor (4ª revisão de risco, 26/09/2026): antes aceitava QUALQUER inteiro —
 * a CHECK de `parcelas` no banco só aceita 1..12 (`parcelasValidas`, acima,
 * é a MESMA regra), e um valor fora da faixa (a Orders API nunca prometeu o
 * teto; um bug do lado dela também não pode virar 500 daqui) rejeitava a
 * ADOÇÃO inteira — a cobrança aprovada ficava sem registro por causa de uma
 * coluna cosmética. Fora da faixa vira `null` (desconhecido), nunca quebra
 * quem chama.
 */
export function parcelasDaOrder(
  order: Record<string, unknown> | null | undefined,
): number | null {
  const metodo = primeiroPagamentoDaOrder(order)?.payment_method as
    | Record<string, unknown>
    | undefined;
  const installments = metodo?.installments;
  return parcelasValidas(installments) ? installments : null;
}

/** `true` quando a order é de cartão (crédito ou débito). */
export function orderEhDeCartao(order: Record<string, unknown> | null | undefined): boolean {
  return tipoDeCartaoValido(tipoDoPagamentoDaOrder(order));
}

/**
 * A recusa desta order LIBERA a vaga da cobrança (`liberar_cobranca_do_pedido`)
 * em vez de chegar a `confirmar_pagamento`? A RPC, no ramo 'recusado',
 * CANCELA o pedido e devolve o estoque — certo para PIX, errado para cartão,
 * em que a recusa é o começo da próxima tentativa (spec, decisão 3).
 *
 * Duas portas, só em desfecho SEM dinheiro ('recusado' ou 'expirado'):
 *
 * 1. Order de CARTÃO — recusada, cancelada ou expirada (o desafio 3DS que
 *    ninguém concluiu, por exemplo).
 * 2. Order CANCELADA (`status: "canceled"`), de qualquer tipo. Quem cancela
 *    order neste app é o próprio app: `criar-pagamento` cancela o PIX em
 *    aberto quando o cliente troca para cartão. A notificação desse
 *    cancelamento pode chegar ANTES de a própria `criar-pagamento` liberar a
 *    vaga — se ela caísse em `confirmar_pagamento('recusado')`, o pedido
 *    morreria no meio da troca. Liberar é inofensivo nos dois casos: a RPC só
 *    solta a vaga se ela ainda for desta cobrança e o pedido ainda estiver
 *    'aguardando', e o pg_cron continua expirando a reserva no prazo.
 *
 * PIX recusado (`failed`) ou expirado continua exatamente como antes.
 */
export function recusaLiberaAVaga(
  order: Record<string, unknown> | null | undefined,
  statusMapeado: string | null,
): boolean {
  if (statusMapeado !== "recusado" && statusMapeado !== "expirado") return false;
  if (orderEhDeCartao(order)) return true;
  return orderCancelada(order);
}

/**
 * URL do desafio 3-D Secure, quando o banco pediu um
 * (`transactions.payments[0].payment_method.transaction_security.url`, com a
 * order em `action_required`). Só `https://` — a tela abre isto num iframe, e
 * um valor que não seja URL segura vira `null`, nunca um iframe com lixo.
 * Order fora de `action_required` também devolve `null`: um desafio já
 * resolvido não pode ser reaberto.
 */
export function extrairDesafio3ds(
  order: Record<string, unknown> | null | undefined,
): string | null {
  if (!order || typeof order !== "object" || order.status !== "action_required") return null;
  const metodo = primeiroPagamentoDaOrder(order)?.payment_method as
    | Record<string, unknown>
    | undefined;
  const seguranca = metodo?.transaction_security as Record<string, unknown> | undefined;
  const url = seguranca?.url;
  return typeof url === "string" && /^https:\/\/\S+$/.test(url) ? url : null;
}

/** Frase padrão da recusa — também a de todo motivo que o mapa não conhece. */
export const MOTIVO_RECUSA_PADRAO = "Pagamento recusado. Tente outro cartão ou pague com PIX.";

/** Frase da recusa por dado do cartão (também usada para o 400 do MP). */
export const MOTIVO_RECUSA_DADOS_DO_CARTAO = "Confira os dados do cartão e tente de novo.";

// `Map`, não objeto literal: o detalhe vem do MP (dado de fora) e indexar
// objeto por ele é o `security/detect-object-injection` que a catraca reprova
// — mesmo motivo do ROTULO_PAGAMENTO em `_shared/pedido.ts`.
const MOTIVOS_DE_RECUSA = new Map<string, string>([
  ["bad_filled_card_data", MOTIVO_RECUSA_DADOS_DO_CARTAO],
  ["insufficient_amount", "Saldo ou limite insuficiente neste cartão."],
  ["card_insufficient_amount", "Saldo ou limite insuficiente neste cartão."],
  ["amount_limit_exceeded", "Saldo ou limite insuficiente neste cartão."],
  ["rejected_by_issuer", "O banco emissor recusou o pagamento."],
  ["high_risk", "Pagamento recusado por segurança. Tente outro cartão ou pague com PIX."],
  ["required_call_for_authorize", "Seu banco pede autorização: ligue para ele e tente de novo."],
  ["card_disabled", "Cartão desabilitado. Fale com o seu banco."],
  ["max_attempts_exceeded", "Limite de tentativas atingido para este cartão. Use outro cartão."],
  ["invalid_installments", "Esse parcelamento não está disponível para este cartão."],
  ["3ds_challenge_expired", "A autenticação do banco não foi concluída."],
  ["cc_rejected_3ds_challenge", "A autenticação do banco não foi concluída."],
  ["invalid_card_token", "Os dados do cartão expiraram. Digite de novo."],
]);

/**
 * O motivo da recusa em português de gente, a partir do `status_detail` do
 * PAGAMENTO (`transactions.payments[0]` — onde o MP põe o motivo; a raiz
 * costuma dizer só "failed") e, se ele não for conhecido, do da raiz.
 * Desconhecido devolve a frase padrão, que sempre oferece uma saída (outro
 * cartão ou PIX) — nunca o código cru do MP.
 */
export function motivoDaRecusa(order: Record<string, unknown> | null | undefined): string {
  const detalhes = [
    primeiroPagamentoDaOrder(order)?.status_detail,
    order && typeof order === "object" ? order.status_detail : undefined,
  ];
  for (const detalhe of detalhes) {
    if (typeof detalhe === "string" && MOTIVOS_DE_RECUSA.has(detalhe)) {
      return MOTIVOS_DE_RECUSA.get(detalhe) as string;
    }
  }
  return MOTIVO_RECUSA_PADRAO;
}

/**
 * O motivo a partir do CORPO DE ERRO de uma criação recusada (HTTP 402). A
 * Orders API devolve a order recusada dentro de `data`; o motivo pode vir
 * também em `errors[].details[]`, no formato "<id do pagamento>:
 * <status_detail>". Tenta `data` primeiro e, sem motivo conhecido lá, o
 * sufixo dos `details` — os dois são leitura defensiva de um formato que
 * este repositório ainda não mediu contra a API real; o que não casar cai na
 * frase padrão. Nada disso volta ao cliente além da frase traduzida.
 */
export function motivoDaRecusaDoErro(corpoDoErro: unknown): string {
  if (!corpoDoErro || typeof corpoDoErro !== "object") return MOTIVO_RECUSA_PADRAO;
  const corpo = corpoDoErro as Record<string, unknown>;
  const data = corpo.data && typeof corpo.data === "object"
    ? corpo.data as Record<string, unknown>
    : null;
  const peloData = motivoDaRecusa(data);
  if (peloData !== MOTIVO_RECUSA_PADRAO) return peloData;

  const erros = Array.isArray(corpo.errors) ? corpo.errors : [];
  for (const erro of erros) {
    const detalhes = (erro as Record<string, unknown> | null)?.details;
    if (!Array.isArray(detalhes)) continue;
    for (const detalhe of detalhes) {
      if (typeof detalhe !== "string") continue;
      const sufixo = detalhe.slice(detalhe.lastIndexOf(":") + 1).trim();
      if (MOTIVOS_DE_RECUSA.has(sufixo)) return MOTIVOS_DE_RECUSA.get(sufixo) as string;
    }
  }
  return MOTIVO_RECUSA_PADRAO;
}

/**
 * Achado A4 (revisão de risco, 26/09/2026): `criar-pagamento` tratava TODO
 * HTTP 400 de `POST /v1/orders` como "confira os dados do cartão" — mas a
 * doc de erros da Orders API (`checkout-api-orders/payment-management/
 * integration-errors`; bloqueada para fetch direto neste ambiente, pesquisada
 * por WebSearch) também documenta causas de 400 que NÃO são do cartão, ex.:
 * "o valor de total_amount não é equivalente à soma de
 * transactions.payments.amount" ou o order_id do PATH malformado — as duas
 * são bug de integração DESTE servidor (corpo montado errado, id sujo), não
 * "cliente digitou o cartão errado". Confundir os dois manda o cliente trocar
 * de cartão à toa e esconde um defeito nosso atrás de uma mensagem que é
 * mentira.
 *
 * Curada, não "todo 400 é cartão": só os códigos abaixo (`errors[].code`, o
 * MESMO formato que `motivoDaRecusaDoErro`/`resumoSemDadoPessoal` já leem
 * para o 402) são, comprovadamente, sobre o DADO do cartão — o cliente
 * corrige tentando de novo com um token novo:
 *   - "invalid_card_token" — o código que este repositório já testa para
 *     token vencido/reusado (`criar-pagamento/index_test.ts`); relatado por
 *     terceiros (groups.google.com/g/mercadopago-developers) como a causa
 *     2062 "Invalid card token" do vocabulário clássico do MP, reaproveitada
 *     pela Orders API.
 *   - "card_token_not_found" — mesma família: o MP não reconhece mais o
 *     token (relatos de terceiros na mesma comunidade de desenvolvedores).
 *   - "bad_filled_card_data" — já é `status_detail` conhecido da RECUSA (402,
 *     `MOTIVOS_DE_RECUSA` acima); citado pela doc de erros de preenchimento
 *     do cartão (`checkout-api/response-handling/data-insertion-errors`)
 *     como o corpo do cartão malformado ANTES de tentar processar.
 * Código AUSENTE, corpo ilegível, ou código desconhecido: NÃO é cartão
 * comprovado — 502 (quem chama decide; nunca "confira os dados" para um bug
 * que pode não ser do cliente). Pesquisa feita por WebSearch — os domínios
 * mercadopago.* estão bloqueados para fetch direto neste ambiente, então a
 * lista é o que deu para confirmar por fontes de terceiros, não a doc oficial
 * completa; ver o relatório da tarefa.
 */
const CODIGOS_400_DE_DADO_DO_CARTAO = new Set([
  "invalid_card_token",
  "card_token_not_found",
  "bad_filled_card_data",
]);

export function erro400EhDeDadoDoCartao(corpoDoErro: unknown): boolean {
  if (!corpoDoErro || typeof corpoDoErro !== "object") return false;
  const erros = Array.isArray((corpoDoErro as Record<string, unknown>).errors)
    ? (corpoDoErro as Record<string, unknown>).errors as unknown[]
    : [];
  return erros.some((erro) => {
    const codigo = (erro as Record<string, unknown> | null)?.code;
    return typeof codigo === "string" && CODIGOS_400_DE_DADO_DO_CARTAO.has(codigo);
  });
}

/**
 * Achado B2 (2ª revisão de risco, 26/09/2026): a Orders API documenta a
 * semântica REAL de `X-Idempotency-Key` — a MESMA chave com um corpo
 * DIFERENTE dentro de 24h devolve HTTP 409 com o código
 * `idempotency_key_already_used` (`_shared/estorno.ts:395` já trata esse
 * código no fluxo de estorno; aqui é a MESMA constante do vocabulário do MP,
 * não uma segunda regra divergente). O harness da suite original assumia —
 * sem citar fonte — que a MESMA chave sempre devolvia a mesma resposta
 * (replay), inclusive com corpo diferente; a doc NÃO promete isso, e a 2ª
 * revisão de risco mediu contra essa semântica documentada.
 *
 * Isto NUNCA aparece para o PIX (mesma chave, MESMO corpo em todo retry —
 * `payer`/`documento` vêm sempre do mesmo pedido) — só o CARTÃO, cujo corpo
 * inclui um TOKEN novo a cada tentativa do Brick (retry do front nunca reusa
 * token). Ver `respostaCartaoEmVerificacao`, `criar-pagamento/index.ts`, para
 * o que a function faz com isto.
 */
export function idempotencyKeyJaUsado(corpoDoErro: unknown): boolean {
  if (!corpoDoErro || typeof corpoDoErro !== "object") return false;
  const erros = Array.isArray((corpoDoErro as Record<string, unknown>).errors)
    ? (corpoDoErro as Record<string, unknown>).errors as unknown[]
    : [];
  return erros.some((erro) => (erro as Record<string, unknown> | null)?.code === "idempotency_key_already_used");
}

/**
 * Prefixo do SENTINELA que `criar-pagamento` grava na vaga (`gateway_
 * payment_id`) quando o MP responde 409 `idempotency_key_already_used`
 * (`idempotencyKeyJaUsado`, acima) — a cobrança da tentativa ANTERIOR pode
 * estar aprovada, sem id para reconsultar (Achado B2, 2ª revisão de risco,
 * 26/09/2026; ver o comentário grande de `respostaCartaoEmVerificacao`,
 * `criar-pagamento/index.ts`). Mora aqui, não em `criar-pagamento/index.ts`,
 * porque `webhook-mercadopago/index.ts` PRECISA reconhecer o MESMO
 * sentinela para ADOTAR a vaga quando a cobrança aparecer aprovada — duas
 * function distintas (cada uma chama `serve()` no import, então uma nunca
 * importa a outra) não podem cada uma ter a sua PRÓPRIA cópia do prefixo,
 * sob pena de divergirem em silêncio (a doença do #53 de novo).
 */
export const PREFIXO_VAGA_EM_VERIFICACAO = "verificando:";

export function vagaEmVerificacao(idGateway: unknown): boolean {
  return typeof idGateway === "string" && idGateway.startsWith(PREFIXO_VAGA_EM_VERIFICACAO);
}

/**
 * Margem de tolerância a relógio DIVERGENTE entre esta function e o MP —
 * usada em TRÊS lugares que precisam da MESMA folga (achado B1, 5ª revisão
 * de risco, 26/09/2026, e sua extensão à criação ambígua na 6ª rodada):
 *   1. `begin_date`/`end_date` de `buscarOrdersDoPedido`, abaixo — a janela
 *      da busca não pode ficar mais estreita que o relógio real por causa de
 *      um desvio de alguns segundos/minutos entre os dois relógios;
 *   2. a comparação em `resolverSentinela` entre o LIMITE INFERIOR gravado no
 *      sentinela e a data de criação de uma order MORTA encontrada — sem
 *      folga, um relógio do MP um pouco atrasado faria uma order de VERDADE
 *      da tentativa atual parecer "criada antes do limite" e nunca liberar.
 * 2 minutos: folga generosa contra desvio de relógio, mas OBRIGATORIAMENTE
 * menor que o tempo entre duas tentativas de pagamento de verdade (o cliente
 * digita o cartão, erra, tenta de novo — nunca em menos de alguns segundos,
 * mas a folga não pode chegar perto do tempo de uma reserva inteira, 30 min,
 * sob pena de aceitar uma order de uma tentativa BEM anterior como se fosse
 * da atual — o mesmo buraco que o Ponto B1 fecha).
 */
export const MARGEM_RELOGIO_BUSCA_MS = 2 * 60_000;

/**
 * `page_size` que `buscarOrdersDoPedido`, abaixo, manda — o MÁXIMO documentado
 * da busca de orders.
 */
const PAGE_SIZE_BUSCA_ORDERS = 100;

/**
 * O `page_size` DEFAULT documentado da busca de orders (20) — o tamanho que a
 * API serve se IGNORAR o `page_size` que pedimos. É o limiar da regra de
 * completude SEM `paging` utilizável: só uma lista com MENOS que isto é
 * reconhecidamente a última página, porque vale nos dois mundos (API que honra
 * `page_size=100` e API que o ignora e serve 20). Usar o 100 pedido como limiar
 * deixaria uma 1ª página de 20 de uma API que ignora o parâmetro passar por
 * "curta" = completa, e a lista parcial soltaria a vaga. Custo aceito: sem
 * `paging` e com 20 a 99 orders a busca fica inconclusiva (`{ ok: false }`, o
 * lado seguro).
 */
const PAGE_SIZE_PADRAO_BUSCA_ORDERS = 20;

/**
 * `paging.total` da resposta da busca como inteiro >= 0, ou `null` se ausente
 * ou inválido. A doc devolve os campos de `paging` como STRING ("21"), então
 * aceita string numérica e number. Só `typeof number`/`string` não-vazio passa
 * para `Number()`: `Number(null)`, `Number("")`, `Number("  ")`,
 * `Number(false)` e `Number([])` valem 0 e transformariam um `paging` ilegível
 * em "total 0 -> lista completa" — o oposto do lado seguro.
 */
function totalDoPaging(paging: unknown): number | null {
  if (!paging || typeof paging !== "object") return null;
  const bruto = (paging as Record<string, unknown>).total;
  const legivel = typeof bruto === "number" || (typeof bruto === "string" && bruto.trim().length > 0);
  if (!legivel) return null;
  const total = Number(bruto);
  return Number.isInteger(total) && total >= 0 ? total : null;
}

/**
 * A lista CRUA da busca (n itens, antes do refiltro por `external_reference`)
 * é reconhecidamente COMPLETA? Só em dois casos: (a) `paging.total` válido e
 * `total <= n`; (b) `total` ausente/inválido e `n < PAGE_SIZE_PADRAO_BUSCA_ORDERS`
 * (20 — mais curta que a menor página que a API serviria, é a última). Todo o
 * resto é INCOMPLETO — `total > n`, ou sem `total` com 20 itens ou mais.
 */
function listaDaBuscaEstaCompleta(n: number, paging: unknown): boolean {
  const total = totalDoPaging(paging);
  if (total !== null) return total <= n;
  return n < PAGE_SIZE_PADRAO_BUSCA_ORDERS;
}

/**
 * BLOQUEIO da 7ª rodada de risco (26/09/2026): `resolverSentinela`, abaixo,
 * usava `MARGEM_RELOGIO_BUSCA_MS` (2 min) PARA TRÁS na comparação de
 * liberação (`criadaEm >= limiteInferiorMs - MARGEM_RELOGIO_BUSCA_MS`) — a
 * margem apontava na direção ERRADA. `limiteInferiorMs` é o instante em que
 * a vaga foi LIBERADA para a tentativa atual (`limiteInferiorDaTentativa`,
 * `criar-pagamento/index.ts`) — e a order da tentativa ANTERIOR (a que
 * acabou de morrer e CAUSAR essa liberação) é, por construção, criada
 * segundos ANTES desse instante, nunca depois. Uma margem PARA TRÁS de 2 min
 * inclui quase sempre essa order antiga na janela — exatamente o cenário
 * Q3 que B1 deveria fechar (achado R6-Q3 do 6º revisor, com relógio
 * realista: c0 criada ~1s antes da liberação).
 *
 * A margem certa aponta PARA A FRENTE: só conta como "desta tentativa" uma
 * order de cartão criada DEPOIS de `limiteInferiorMs + MARGEM_LIBERAR_
 * APOS_LIMITE_MS` — o cliente precisa reabrir o formulário e digitar o
 * cartão de novo (o Brick nunca reusa token), o que leva bem mais que
 * alguns segundos; um valor entre 10 e 30s cobre um retry automático
 * plausível sem confundir com a order da tentativa anterior. 15s: dentro
 * dessa faixa, com folga para o pior caso de latência de rede entre esta
 * function e o MP. Uma order da tentativa AMBÍGUA criada DENTRO dessa
 * margem nunca conta — a vaga fica presa até `expires_at` (o lado seguro:
 * "não libera" nunca cobra duas vezes; "libera cedo demais" já cobrou).
 * `MARGEM_RELOGIO_BUSCA_MS` continua só para a janela de busca
 * (`begin_date`/`end_date`, abaixo) — não decide liberação.
 */
export const MARGEM_LIBERAR_APOS_LIMITE_MS = 15_000;

/**
 * Monta o SENTINELA com o LIMITE INFERIOR embutido (achado B1, 5ª revisão de
 * risco, 26/09/2026): `<prefixo><chave>:<limiteInferiorMs>` — o prefixo e a
 * chave continuam exatamente como antes (`vagaEmVerificacao` só olha o
 * prefixo; `idEhClassico`/comparações de igualdade não olham o MEIO da
 * string), então todo detector e toda comparação por igualdade já existentes
 * continuam funcionando sem mudança. O sufixo NOVO é o instante (epoch ms)
 * a partir do qual uma order de cartão DESTA tentativa pode ter sido criada
 * — `resolverSentinela`/`limiteInferiorDoSentinela`, abaixo, é quem lê de
 * volta. Nunca leva `:` a mais que os dois já esperados (um da chave —
 * `<pedido>:c<n>` — um deste sufixo), então `limiteInferiorDoSentinela`
 * sempre acha o número no ÚLTIMO pedaço.
 */
export function montarSentinela(chave: string, limiteInferiorMs: number): string {
  return `${PREFIXO_VAGA_EM_VERIFICACAO}${chave}:${limiteInferiorMs}`;
}

/**
 * Chave de idempotência da tentativa de CARTÃO atual de um pedido —
 * `<pedido>:c<tentativas_de_pagamento>` (Achado A1: o token não entra).
 * Fonte única: `chaveDeIdempotencia` (criar-pagamento) e o fallback de
 * liberação do sentinela (webhook-mercadopago) montam a chave por aqui.
 */
export function chaveDoCartaoDaTentativa(pedidoId: string, tentativasDePagamento: unknown): string {
  const bruto = Number(tentativasDePagamento);
  const tentativas = Number.isInteger(bruto) && bruto >= 0 ? bruto : 0;
  return `${pedidoId}:c${tentativas}`;
}

/**
 * `true` quando `idGateway` é o SENTINELA gravado para esta MESMA chave de
 * idempotência — `verificando:<chave>` (formato antigo) ou
 * `verificando:<chave>:<ms>` (`montarSentinela`). O `:` depois da chave é o
 * que separa `c1` de `c10`. Revisões de risco de 30/09/2026: um sentinela de
 * chave ANTERIOR (a tentativa já avançou) nunca é recriado nem liberado pela
 * busca — o limite inferior dele pode enxergar só a order morta de uma
 * tentativa posterior, e liberar abriria um POST com chave nova ao lado da
 * cobrança ambígua ainda não indexada (duas capturas).
 */
export function sentinelaDaChave(idGateway: unknown, chave: string): boolean {
  if (typeof idGateway !== "string") return false;
  const prefixo = `${PREFIXO_VAGA_EM_VERIFICACAO}${chave}`;
  return idGateway === prefixo || idGateway.startsWith(`${prefixo}:`);
}

/**
 * Lê de volta o LIMITE INFERIOR gravado por `montarSentinela` (achado B1).
 * `null` quando `idGateway` não é sequer um sentinela, OU quando é um
 * sentinela no formato ANTIGO (gravado antes desta rodada — pré-existentes
 * em produção quando isto ligar), sem o sufixo `:<ms>` — pela MESMA regra de
 * segurança do resto deste arquivo, `null` é "não sei", nunca um palpite:
 * `resolverSentinela` trata `null` como "nunca libera por data", exatamente
 * como trata uma order sem `date_created` legível.
 */
export function limiteInferiorDoSentinela(idGateway: unknown): number | null {
  if (!vagaEmVerificacao(idGateway)) return null;
  const resto = (idGateway as string).slice(PREFIXO_VAGA_EM_VERIFICACAO.length);
  const partes = resto.split(":");
  if (partes.length < 3) return null; // formato antigo, sem o sufixo — UNVERIFIED em produção
  const ms = Number(partes[partes.length - 1]);
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

/**
 * Monta o corpo de `POST /v1/orders` para PIX — o caminho que a Orders API
 * atende (a `/v1/payments` clássica devolve 500 para payment_method_id
 * "pix" hoje; ver montarCorpoPix acima, que continua existindo porque as
 * Tasks 2-4 ainda não migraram).
 *
 * Formato medido e confirmado funcionando contra a API real, com três
 * detalhes que a documentação não deixa óbvios:
 *
 * 1. `total_amount` e `transactions.payments[0].amount` são STRING com duas
 *    casas ("50.00"), não número — o clássico usava `transaction_amount`
 *    numérico.
 * 2. `external_reference` continua sendo o nosso `orderId`: é o que a
 *    reconciliação usa para achar a cobrança a partir do pagamento.
 * 3. Ambiente de teste (credencial TEST-/APP_USR de sandbox) exige
 *    `payer.email` terminando em "@testuser.com", senão devolve
 *    `400 invalid_email_for_sandbox`. Esta função NÃO decide isso — ela
 *    monta o que recebe. Quem decide o e-mail (produção vs. sandbox) é a
 *    function que chama (Task 2).
 *
 * SOBRE EXPIRAÇÃO (Achado 1 da revisão do PR): a Orders API não tem um campo
 * equivalente a `date_of_expiration` (data absoluta). O campo confirmado na
 * documentação é `transactions.payments[].expiration_time`, em formato
 * DURAÇÃO ISO 8601 (ex.: "PT30M"), não instante — mínimo 30 minutos, default
 * 24 HORAS se omitido. `expiracao` é OBRIGATÓRIO e validado com `throw` em
 * runtime, não com um parâmetro opcional de tipo: este arquivo tem
 * `// @ts-nocheck` e `npm run test:edge` roda `deno test --no-check` — nada
 * neste arquivo é checado por tipo, então "obrigatório" do TypeScript não
 * obriga NADA aqui. Só o `throw` barra.
 *
 * O QUE ACONTECE SEM ISTO: a reserva de estoque desta loja é de 30 MINUTOS
 * (`20260807000000_reserva_com_expiracao.sql`, pg_cron cancela e devolve
 * estoque). Sem `expiration_time`, o MP usa o default de 24h — o cliente
 * fica com um QR pagável por ~23,5h para um pedido já cancelado e com
 * estoque já devolvido. A rede de segurança (`pagamentos_a_reconciliar()`,
 * `20260808000100_reconciliacao.sql`) filtra `expires_at > now() - interval
 * '24 hours'`, com `expires_at` = criação + 30 min — ou seja a fila fecha em
 * criação + 24,5h contra um QR que morreria em ~24h sem este campo. A folga
 * medida era de ~48x e cairia para 1,02x. Dois acoplamentos NOVOS que este
 * campo cria, e que quem mexer nos dois lados precisa saber:
 *   1. Se algum clone desta loja encurtar a reserva de estoque para MENOS de
 *      30 minutos, o MP RECUSA a order inteira — 30 min é o mínimo aceito
 *      pela Orders API, não uma sugestão.
 *   2. O `interval '24 hours'` de `pagamentos_a_reconciliar` deixou de ser
 *      folgado com este campo em produção: encurtá-lo sem entender a conta
 *      acima vira dinheiro que entra e nunca é reconciliado.
 */
/**
 * Converte uma duração ISO 8601 no formato que `expiration_time` da Orders
 * API aceita (ex.: "PT30M", "PT2H") em MINUTOS. Devolve `null` para o que não
 * casa `/^PT\d+[MH]$/` — "30M" sem prefixo, "PT" sem número, "PT30S" em
 * segundos (não aceito) e ausência caem aqui. Nunca lança: quem precisa do
 * `throw` (`montarCorpoPixOrders`, logo abaixo) decide isso a partir do
 * `null` — mesma regra do resto deste arquivo (nunca um palpite).
 *
 * ORIGEM ÚNICA (Achado 1 da revisão do realinhamento de expires_at,
 * 14/08/2026): antes, só `montarCorpoPixOrders` fazia este parse, para
 * VALIDAR o valor mandado ao MP — e `expiracaoRealinhavel`
 * (`criar-pagamento/index.ts`) tinha `30` HARDCODED para calcular a janela sã
 * que decide se o realinhamento é aceito. Os dois liam o mesmo conceito
 * ("quantos minutos o PIX dura") de lugares que não se falavam: trocar só a
 * literal que esta function manda ao MP (hoje "PT30M", em
 * `criar-pagamento/index.ts`) deixaria a janela sã presa em 30 min, e o
 * realinhamento morreria em silêncio para todo PIX novo — reintroduzindo o
 * bug que ele existe para fechar. Com um parser só, `expiracaoRealinhavel`
 * deriva o teto da MESMA string que esta função valida e manda ao MP — mudar
 * uma muda a outra junto.
 */
export function minutosDaExpiracaoPix(expiracao: string): number | null {
  // /^PT\d+[MH]$/: duração ISO 8601 só em minutos ou horas (M/H) — o formato
  // que a Orders API documenta para expiration_time.
  const casamento = typeof expiracao === "string"
    ? expiracao.match(/^PT(\d+)([MH])$/)
    : null;
  if (!casamento) return null;
  const numero = Number(casamento[1]);
  // Achado da revisão (14/08/2026): a regex casa só dígitos, então
  // `Number(...)` nunca dá NaN aqui — mas uma string de dígitos absurdamente
  // longa (ex.: 400 dígitos) estoura para `Infinity`, que passaria batido
  // sem esta checagem. Duração não-finita é entrada inválida, igual a
  // qualquer outra que não casa o formato: devolve `null`, nunca um valor
  // que um consumidor (ex.: `expiracaoRealinhavel`) usaria como teto
  // "infinito" e aceitaria qualquer data futura.
  if (!Number.isFinite(numero)) return null;
  return casamento[2] === "H" ? numero * 60 : numero;
}

export function montarCorpoPixOrders(args: {
  valor: number;
  email: string;
  orderId: string;
  expiracao: string;
  nome?: string;
  documento?: { type: string; number: string };
}): Record<string, unknown> {
  const minutos = minutosDaExpiracaoPix(args.expiracao);
  if (minutos === null) {
    throw new Error(
      'montarCorpoPixOrders: expiracao obrigatória, em duração ISO 8601 (ex.: "PT30M"), ' +
        "formato /^PT\\d+[MH]$/. Sem ela o MP usa o default de 24h contra uma reserva de " +
        "estoque de 30 min — ver o comentário acima desta função.",
    );
  }

  // Tarefa 2 (CHECKOUT-070), achado da revisão: a regex de minutosDaExpiracaoPix
  // só validava SINTAXE, não FAIXA. "PT0M", "PT1M" e "PT29M" (abaixo do
  // mínimo de 30 min que o MP aceita) e "PT721H"/"PT99999H" (acima do máximo
  // de 30 dias = 43200 min) passavam. O docstring desta função promete o
  // mínimo como restrição DURA — a checagem abaixo cumpre essa promessa. Não
  // se sabe se o MP RECUSA (400, barulhento) ou TROCA em silêncio pelo
  // default de 24h (o desastre que expiration_time existe para evitar) um
  // valor fora da faixa — na dúvida, a validação é nossa.
  if (minutos < 30 || minutos > 43200) {
    throw new Error(
      `montarCorpoPixOrders: expiracao "${args.expiracao}" fora da faixa aceita pelo MP ` +
        "(mínimo 30 minutos, máximo 43200 minutos = 30 dias).",
    );
  }

  const valorFormatado = args.valor.toFixed(2);

  const payer: Record<string, unknown> = { email: args.email };
  if (args.nome) payer.first_name = args.nome;
  if (args.documento) payer.identification = args.documento;

  return {
    type: "online",
    // Doc oficial (checkout-api-orders/payment-integration/pix, context7,
    // 13/08/2026) lista `processing_mode` como Required no corpo e o inclui
    // em todo exemplo de requisição (Pix e cartão); o SDK oficial Node.js
    // faz o mesmo. Medido contra a API real sem este campo o MP aceitou
    // (201) — mas aqui doc e SDK concordam entre si, ao contrário do caso de
    // x-signature (onde divergiam e o SDK ganhava), então não há motivo para
    // omitir o que os dois pedem.
    processing_mode: "automatic",
    external_reference: args.orderId,
    total_amount: valorFormatado,
    payer,
    transactions: {
      payments: [
        {
          amount: valorFormatado,
          payment_method: { id: "pix", type: "bank_transfer" },
          expiration_time: args.expiracao,
        },
      ],
    },
  };
}

type ResultadoOrder =
  | { ok: true; order: Record<string, unknown> }
  | {
    ok: false;
    erro: string;
    status: number;
    // Fase 3.5 (cartão): o corpo de erro do MP, já parseado quando é JSON —
    // para quem CHAMA decidir no servidor (a recusa de cartão volta como
    // HTTP 402 com a order recusada dentro). NUNCA vai para a resposta ao
    // cliente: carrega detalhe de conta e, no cartão, do pagador. Ausente
    // quando o corpo não era JSON (ou quando nem houve resposta HTTP).
    corpoDoErro?: Record<string, unknown>;
  };

/**
 * Resumo do corpo de erro do MP SEM dado pessoal — só códigos e status. É o
 * que vai para o log quando quem chama pede `corpoNoLog: false` (cartão): o
 * corpo inteiro da recusa traz a order com o pagador (e-mail, CPF), que não
 * pode parar no log da função.
 */
function resumoSemDadoPessoal(corpo: Record<string, unknown> | undefined): string {
  if (!corpo) return "(corpo não-JSON)";
  const erros = Array.isArray(corpo.errors) ? corpo.errors : [];
  const codigos = erros
    .map((e) => (e && typeof e === "object" ? (e as Record<string, unknown>).code : undefined))
    .filter((c) => typeof c === "string");
  const data = corpo.data && typeof corpo.data === "object"
    ? corpo.data as Record<string, unknown>
    : undefined;
  const pagamento = primeiroPagamentoDaOrder(data);
  return JSON.stringify({
    codigos,
    status: typeof data?.status === "string" ? data.status : undefined,
    status_detail: typeof data?.status_detail === "string" ? data.status_detail : undefined,
    pagamento_status_detail: typeof pagamento?.status_detail === "string"
      ? pagamento.status_detail
      : undefined,
  });
}

/**
 * Miolo comum de `criarOrder`, `consultarOrder` e `cancelarOrder` — as três
 * mandam a requisição de jeitos diferentes e leem a resposta do MESMO jeito
 * (mesma lição do `interpretarRespostaDePagamento` clássico, mais abaixo:
 * duas leituras da mesma resposta divergem em silêncio). Nunca rejeita. O
 * `rotulo` mantém as linhas de log de cada chamador exatamente como eram
 * ("mercadopago: orders recusou", "mercadopago: orders (consulta) recusou").
 */
async function interpretarRespostaDeOrder(
  resposta: Response,
  opcoes: { rotulo: string; mensagemDeFalha: string; corpoNoLog: boolean },
): Promise<ResultadoOrder> {
  if (!resposta.ok) {
    // O corpo do erro do MP vai para o log da função, NUNCA para o cliente:
    // ele carrega detalhe de credencial e de conta.
    const detalhe = await resposta.text().catch(() => "");
    let corpoDoErro: Record<string, unknown> | undefined;
    try {
      const parseado = JSON.parse(detalhe);
      if (parseado && typeof parseado === "object") corpoDoErro = parseado;
    } catch {
      corpoDoErro = undefined;
    }
    console.error(
      `mercadopago: ${opcoes.rotulo} recusou`,
      resposta.status,
      opcoes.corpoNoLog ? detalhe : resumoSemDadoPessoal(corpoDoErro),
    );
    return {
      ok: false,
      erro: opcoes.mensagemDeFalha,
      status: resposta.status,
      ...(corpoDoErro ? { corpoDoErro } : {}),
    };
  }

  // A leitura do corpo mora no MESMO try que trata resposta ilegível: um 2xx
  // com corpo HTML, vazio ou "null" faria json() rejeitar — mesma regra do
  // interpretarRespostaDePagamento clássico, abaixo.
  let json: Record<string, unknown> | null;
  try {
    json = await resposta.json();
  } catch (_err) {
    console.error(`mercadopago: ${opcoes.rotulo} 2xx com corpo ilegível`, resposta.status);
    return { ok: false, erro: "Resposta inválida do gateway.", status: resposta.status };
  }

  if (json?.id === undefined || json?.id === null) {
    console.error(
      `mercadopago: ${opcoes.rotulo} 2xx sem id`,
      resposta.status,
      opcoes.corpoNoLog ? JSON.stringify(json) : "(corpo omitido: pode ter dado do pagador)",
    );
    return { ok: false, erro: "Resposta inválida do gateway.", status: resposta.status };
  }

  return { ok: true, order: json };
}

/**
 * `criarOrder` — faz `POST {base}/v1/orders`: o PIX e, desde a Fase 3.5, o
 * cartão (o `criarPagamento` clássico de cartão, código morto desde a Fase
 * 3, foi removido quando o cartão veio para cá).
 *
 * `X-Idempotency-Key` para um retry do nosso lado não cobrar o cliente duas
 * vezes, `fetch` por parâmetro para o teste não tocar rede, corpo do erro do
 * MP só no log (carrega detalhe de credencial e de conta), e nenhum caminho
 * rejeita — até um 2xx com corpo ilegível ou sem `id` volta como
 * `{ ok: false }`.
 *
 * Devolve a `order` inteira, já parseada: a extração do QR (formato
 * aninhado, ver extrairQrCode), do status (par status + status_detail, ver
 * mapearStatusOrder) e do desafio 3DS (extrairDesafio3ds) são passos
 * separados de propósito, para quem chama poder usar cada um sem depender
 * dos outros.
 *
 * `corpoNoLog: false` (cartão): o corpo da recusa traz a order com o pagador
 * — o log recebe só o resumo sem dado pessoal (`resumoSemDadoPessoal`). O
 * default mantém o log do PIX exatamente como era.
 */
export async function criarOrder(args: {
  token: string;
  corpo: Record<string, unknown>;
  chaveIdempotencia: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  // P-4 (laudo 01/09): teto de espera da chamada, em ms. Em produção não se
  // passa — cai no TEMPO_LIMITE_MS. O parâmetro existe para o teste provar o
  // aborto sem esperar os 15s.
  tempoLimiteMs?: number;
  corpoNoLog?: boolean;
}): Promise<ResultadoOrder> {
  const f = args.fetchImpl ?? fetch;
  const base = args.baseUrl ?? BASE_URL_PADRAO;

  let resposta: Response;
  try {
    resposta = await fetchComTempo(
      f,
      `${base}/v1/orders`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${args.token}`,
          "Content-Type": "application/json",
          // Sem isso, um retry do nosso lado cobra o cliente duas vezes.
          "X-Idempotency-Key": args.chaveIdempotencia,
        },
        body: JSON.stringify(args.corpo),
      },
      args.tempoLimiteMs,
    );
  } catch (_err) {
    // status 0 = nem chegou a haver resposta HTTP.
    return { ok: false, erro: "Falha ao falar com o gateway.", status: 0 };
  }

  return interpretarRespostaDeOrder(resposta, {
    rotulo: "orders",
    mensagemDeFalha: "Não foi possível gerar a cobrança.",
    corpoNoLog: args.corpoNoLog !== false,
  });
}

/**
 * `cancelarOrder` — `POST {base}/v1/orders/{id}/cancel` (Fase 3.5). Único uso
 * hoje: `criar-pagamento` cancela o PIX em aberto quando o cliente troca para
 * cartão, para nunca existirem duas cobranças vivas para o mesmo pedido. O
 * MP só cancela order que ainda não capturou dinheiro — PIX já pago devolve
 * erro, e quem chama trata isso como "não deu para trocar agora".
 *
 * Mesmo contrato de `criarOrder`: nunca rejeita, corpo do erro só no log,
 * `X-Idempotency-Key` (é escrita — um retry não pode virar duas operações).
 * O id vai codificado no caminho: ele sai do banco, mas caminho montado com
 * dado nunca vai cru.
 */
export async function cancelarOrder(args: {
  token: string;
  orderId: string;
  chaveIdempotencia: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  tempoLimiteMs?: number;
}): Promise<ResultadoOrder> {
  const f = args.fetchImpl ?? fetch;
  const base = args.baseUrl ?? BASE_URL_PADRAO;

  let resposta: Response;
  try {
    resposta = await fetchComTempo(
      f,
      `${base}/v1/orders/${encodeURIComponent(args.orderId)}/cancel`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${args.token}`,
          "X-Idempotency-Key": args.chaveIdempotencia,
        },
      },
      args.tempoLimiteMs,
    );
  } catch (_err) {
    return { ok: false, erro: "Falha ao falar com o gateway.", status: 0 };
  }

  return interpretarRespostaDeOrder(resposta, {
    rotulo: "orders (cancelamento)",
    mensagemDeFalha: "Não foi possível cancelar a cobrança.",
    corpoNoLog: false,
  });
}

/** A order voltou cancelada? O MP escreve `canceled`; `cancelled` (grafia
 * britânica, a do vocabulário clássico) também conta, por defesa. */
export function orderCancelada(order: Record<string, unknown> | null | undefined): boolean {
  return order?.status === "canceled" || order?.status === "cancelled";
}

/**
 * `consultarOrder` — reconsulta uma ORDER já criada (Tarefa 2, CHECKOUT-070,
 * migração de `criar-pagamento` para a Orders API).
 *
 * Mesmo motivo do `consultarPagamento` clássico (mais abaixo): o navegador
 * mobile descarta a aba enquanto o cliente paga pelo app do banco, e a tela
 * remonta pedindo o MESMO QR sem criar uma segunda cobrança. MEDIDO em
 * 14/08/2026 contra a API real: o GET devolve `qr_code` e `qr_code_base64`
 * IDÊNTICOS aos da criação, em `transactions.payments[0].payment_method` —
 * este ramo basta, e não é preciso gravar o QR no banco. (Este comentário já
 * afirmou que o QR "só existe na resposta da CRIAÇÃO": era suposição herdada
 * do endpoint clássico, nunca medida, e a medição a refutou.) A diferença para o clássico é o ENDPOINT:
 * `gateway_payment_id` passa a guardar o id da ORDER (ver `extrairQrCode`
 * acima), não o de um pagamento — reconsultar com `consultarPagamento` (GET
 * /v1/payments/{id}) chamaria o endpoint ERRADO com um id de order, e o MP
 * devolveria 404 para toda cobrança PIX criada depois desta migração. Achado
 * ao migrar `criar-pagamento` (a Tarefa não pedia esta função por nome, mas
 * sem ela o ramo "reconsultar" — o caminho principal, com 63 dos 64 pedidos
 * da loja em PIX — ficaria quebrado para todo pedido novo).
 *
 * Mesmo contrato de `criarOrder`: nunca rejeita, corpo do erro do MP só no
 * log, GET sem corpo e sem `X-Idempotency-Key` (não é escrita).
 */
export async function consultarOrder(args: {
  token: string;
  orderId: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  // P-4 (laudo 01/09): ver criarOrder.
  tempoLimiteMs?: number;
  // Achado R6 (2ª revisão de risco, 26/09/2026): até esta correção o corpo
  // do erro (ou o 2xx sem id) SEMPRE ia cru para o log — inofensivo enquanto
  // só o PIX chamava esta função (a order de PIX não carrega CPF do titular).
  // Desde a Fase 3.5 o CARTÃO também chama `consultarOrder` (a reconsulta da
  // vaga ocupada, e — Achados A3/B1 — a reconsulta da cobrança GRAVADA antes
  // de aplicar um status/estorno): uma order de cartão carrega e-mail e CPF
  // do titular (`montarCorpoCartaoOrders`), e logar o corpo cru vazaria os
  // dois num erro de rede comum. Default `true` — byte a byte o
  // comportamento de antes para quem já chamava sem passar nada (o PIX, e as
  // reconsultas de vaga que também podem ser PIX); os chamadores NOVOS de
  // cartão passam `corpoNoLog: false` explicitamente.
  corpoNoLog?: boolean;
}): Promise<ResultadoOrder> {
  const f = args.fetchImpl ?? fetch;
  const base = args.baseUrl ?? BASE_URL_PADRAO;

  let resposta: Response;
  try {
    resposta = await fetchComTempo(
      f,
      `${base}/v1/orders/${args.orderId}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${args.token}` },
      },
      args.tempoLimiteMs,
    );
  } catch (_err) {
    return { ok: false, erro: "Falha ao falar com o gateway.", status: 0 };
  }

  return interpretarRespostaDeOrder(resposta, {
    rotulo: "orders (consulta)",
    mensagemDeFalha: "Não foi possível consultar a cobrança.",
    corpoNoLog: args.corpoNoLog !== false,
  });
}

/**
 * `buscarOrdersDoPedido` — GET /v1/orders?external_reference=<pedido>&
 * begin_date=<criação>&end_date=<agora> (Ponto 1, 4ª revisão de risco,
 * 26/09/2026, achado do 4º revisor de risco).
 *
 * POR QUE ISTO EXISTE: resolver um SENTINELA (`vagaEmVerificacao`, acima) por
 * FATO — a Orders API sabe dizer se a cobrança da tentativa anterior existe e
 * o que ela virou — em vez de um teto fixo de relógio
 * (`MINUTOS_SENTINELA_PRESO`, removido de `criar-pagamento/index.ts`): o
 * revisor mediu dois cenários (Q1: cartão `processing`, que pode levar dias
 * em análise antifraude; Q2: webhook atrasado/reenviado) em que o relógio
 * soltava a vaga com a cobrança da tentativa anterior ainda VIVA, e o PIX
 * criado por cima virava uma SEGUNDA cobrança capturada para o mesmo pedido.
 *
 * NÃO VERIFICADO CONTRA A API REAL (o proxy de rede deste ambiente bloqueia
 * mercadopago.*, e a doc pública também não estava alcançável daqui — ver
 * AGENTS.md/mapa de risco): os NOMES exatos dos parâmetros de busca, a
 * paginação, e o atraso de indexação entre a Orders API criar/mudar uma
 * order e ela aparecer nesta busca. A referência usada (achado do revisor) é
 * https://www.mercadopago.com.br/developers/en/reference/online-payments/
 * checkout-api/search-order/get — que documenta `external_reference`,
 * `begin_date` e `end_date` como parâmetros de query OBRIGATÓRIOS em RFC
 * 3339 (o que esta função já manda: `Date.toISOString()`), e a RESPOSTA como
 * `{ data: [...], paging: { ... } }` — nome confirmado também no SDK oficial
 * Node (mercadopago@3.2.1); segue UNVERIFIED contra a API viva (o proxy
 * deste ambiente bloqueia mercadopago.*). ATÉ o achado, o nome da lista era
 * UNVERIFIED e só os nomes adivinhados eram aceitos (`results`, o do
 * `/v1/payments/search` clássico; `elements`, usado por outros recursos; e
 * um array na RAIZ) — com o corpo REAL, a busca voltava `{ ok: false }`
 * SEMPRE e a liberação do sentinela por busca (Ponto 1 da criar-pagamento e
 * o webhook, Ponto 2) era código morto: só `expires_at` liberava. `data`
 * vem PRIMEIRO; os nomes antigos ficam como defesa. PAGINAÇÃO (02/10/2026;
 * referência oficial "Search order", consultada nesse dia): `page` começa em
 * 1, `page_size` tem default 20 e máximo 100, a ordem default é
 * `sort_by=created_date`/`sort_order=desc`, e a resposta traz `paging` =
 * `{ total, total_pages, offset, limit }` com os quatro campos como STRING.
 * A versão anterior desta função não mandava `page_size` nem ordenação e
 * devolvia `{ ok: true }` com a 1ª página (20) como se fosse a lista inteira —
 * o comentário que havia aqui dizia que a lista parcial "não libera", e isso
 * era FALSO: um pedido com 21+ orders na janela, e a viva (ou a capturada) só
 * na página 2, soltava a vaga (e abria cobrança nova). Agora a busca MANDA
 * `page_size=100`, `sort_by=created_date` e `sort_order=desc`, e só devolve
 * `{ ok: true }` quando a lista CRUA (antes do refiltro por
 * `external_reference`, abaixo) é reconhecidamente COMPLETA:
 *   (a) `paging.total` é um inteiro >= 0 e `total <= n` (n = tamanho da lista
 *       crua); ou
 *   (b) `total` ausente/inválido e `n < 20` (o `page_size` DEFAULT da API, não
 *       os 100 que pedimos: se a API ignorar o parâmetro serve no máximo 20, e
 *       uma página de 20 sem `paging` é ambígua; só uma lista mais curta que
 *       isso é necessariamente a última nos dois mundos).
 * Qualquer outro caso — `total > n`, ou sem `total` com `n >= 20` — volta
 * `{ ok: false }`, o MESMO resultado de uma busca que falhou: quem chama já
 * trata isso como "não decide" (nunca libera, nunca recusa, nunca cria
 * cobrança nova). NÃO paginamos além disso (sem laço): lista incompleta é
 * indecisão, não motivo para buscar a página 2. NÃO VERIFICADO contra a API
 * viva: se `paging` chega mesmo na resposta, e se a API aceita/ignora cada
 * parâmetro novo (um 400 por parâmetro desconhecido também cai em
 * `{ ok: false }`, o lado seguro). Qualquer OUTRO formato (corpo
 * sem lista reconhecível, corpo não-JSON, HTTP não-2xx, erro de rede)
 * volta como `{ ok: false }`, NUNCA como lista vazia: quem chama
 * (`resolverSentinela`, abaixo, e os dois chamadores em `criar-pagamento/
 * index.ts` e `webhook-mercadopago/index.ts`) trata falha e "nada
 * encontrado" como coisas DIFERENTES — nenhuma das duas libera a vaga.
 *
 * Nunca rejeita — mesmo contrato de `criarOrder`/`consultarOrder`. O corpo
 * de erro (e a lista de orders, que pode trazer cartão com e-mail/CPF do
 * pagador) nunca vai para o log cru — só o resumo sem dado pessoal.
 *
 * B2 (5ª revisão de risco, 26/09/2026): a lista devolvida é filtrada por
 * `external_reference === pedidoId` NESTA function, antes de qualquer
 * chamador ver uma única order — `external_reference` no filtro de query é
 * o lado do SERVIDOR do MP, que o próprio corretor da doc marca como não
 * verificado; se o MP ignorar o filtro (ou usar outro nome de campo por
 * baixo), uma order de OUTRO pedido — inclusive uma cobrança APROVADA e
 * órfã de um pedido morto (casos A1/R2) — voltaria na lista e seria tratada
 * como se fosse DESTE pedido. Sem este filtro, `resolverSentinela` (abaixo)
 * podia gravar/adotar a vaga com o id de uma order que nunca teve nada a ver
 * com este pedido.
 *
 * B1 (5ª revisão de risco, 26/09/2026): `begin_date`/`end_date` sempre em
 * ISO normalizado (`new Date(x).toISOString()`) — o PostgREST devolve
 * `created_at` cru, com microssegundos e `+00:00`, formato que a doc da
 * busca (exemplo com `.000Z`) não confirma que a Orders API aceita
 * (UNVERIFIED). `end_date` ganha `MARGEM_RELOGIO_BUSCA_MS` de folga PARA A
 * FRENTE (o relógio do MP pode estar adiantado; uma order criada
 * "agora mesmo" não pode ficar de fora só por um desvio de segundos) e
 * `begin_date` a MESMA folga PARA TRÁS (o relógio do MP pode estar
 * atrasado; uma order criada um instante antes do que este servidor acha
 * que é `pedido.created_at` não pode sair da janela).
 */
export async function buscarOrdersDoPedido(args: {
  token: string;
  pedidoId: string;
  // ISO — geralmente `pedido.created_at`: o começo da janela de busca.
  // `undefined`/inválido é aceito pela Orders API do jeito que a doc
  // encontrada não deixa claro (UNVERIFIED); mandar mesmo assim é mais
  // seguro que omitir, se o parâmetro for obrigatório de verdade. Ilegível
  // (`Date.parse` não entende) vai CRU mesmo assim, pela mesma razão.
  desde: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  tempoLimiteMs?: number;
}): Promise<{ ok: true; orders: Record<string, unknown>[] } | { ok: false }> {
  const f = args.fetchImpl ?? fetch;
  const base = args.baseUrl ?? BASE_URL_PADRAO;
  const desdeMs = Date.parse(args.desde);
  const beginDate = Number.isFinite(desdeMs)
    ? new Date(desdeMs - MARGEM_RELOGIO_BUSCA_MS).toISOString()
    : args.desde;
  const endDate = new Date(Date.now() + MARGEM_RELOGIO_BUSCA_MS).toISOString();
  const params = new URLSearchParams({
    external_reference: args.pedidoId,
    begin_date: beginDate,
    end_date: endDate,
    // Paginação (02/10/2026): explícitos mesmo sendo (sort) o default da API —
    // a regra de completude, abaixo, depende de `page_size` ser o MÁXIMO.
    page_size: String(PAGE_SIZE_BUSCA_ORDERS),
    sort_by: "created_date",
    sort_order: "desc",
  });

  let resposta: Response;
  try {
    resposta = await fetchComTempo(
      f,
      `${base}/v1/orders?${params.toString()}`,
      { method: "GET", headers: { Authorization: `Bearer ${args.token}` } },
      args.tempoLimiteMs,
    );
  } catch (_err) {
    // Nit (5ª revisão de risco, 26/09/2026): sem isto, "busca fora do ar"
    // (rede, timeout) e "nada encontrado" eram indistinguíveis no log — só o
    // texto do erro, nunca o corpo (que aqui não existe: é uma exceção de
    // rede, não uma resposta do MP).
    console.error(
      "mercadopago: busca de orders do pedido falhou (rede/timeout) — distinto de 'nada encontrado'",
      { pedidoId: args.pedidoId, erro: String(_err) },
    );
    return { ok: false };
  }

  if (!resposta.ok) {
    console.error("mercadopago: busca de orders do pedido recusou", resposta.status);
    return { ok: false };
  }

  let json: unknown;
  try {
    json = await resposta.json();
  } catch (_err) {
    console.error("mercadopago: busca de orders 2xx com corpo ilegível", resposta.status);
    return { ok: false };
  }

  const corpo = json && typeof json === "object" ? json as Record<string, unknown> : null;
  const lista = Array.isArray(corpo?.data)
    ? corpo.data
    : Array.isArray(corpo?.results)
      ? corpo.results
      : Array.isArray(corpo?.elements)
        ? corpo.elements
        : Array.isArray(json)
          ? json
          : null;
  if (!lista) {
    console.error("mercadopago: busca de orders com corpo sem lista reconhecível (data/results/elements)");
    return { ok: false };
  }

  // Completude (02/10/2026) — ver o comentário grande da função. Sobre a lista
  // CRUA: o refiltro por `external_reference`, abaixo, só encolhe o que já veio.
  if (!listaDaBuscaEstaCompleta(lista.length, corpo?.paging)) {
    console.error(
      "mercadopago: busca de orders com lista INCOMPLETA (paging.total maior que a lista, ou página cheia sem paging) — tratada como indecisão, nunca como lista completa",
      { recebidas: lista.length, total: totalDoPaging(corpo?.paging) },
    );
    return { ok: false };
  }

  return {
    ok: true,
    orders: lista.filter((o): o is Record<string, unknown> => {
      if (!o || typeof o !== "object") return false;
      // B2: nunca confia cegamente no filtro do lado do servidor.
      return String((o as Record<string, unknown>).external_reference ?? "") === args.pedidoId;
    }),
  };
}

/**
 * Os três status NÃO-terminais documentados da Orders API — a order ainda
 * pode virar aprovada, recusada, cancelada ou expirada. `mapearStatusOrder`
 * já traduz os três (com o `status_detail` certo) para 'aguardando' — esta
 * lista existe porque `resolverSentinela`, abaixo, precisa decidir "ainda
 * viva" SEM o `status_detail` (a busca de orders pode não devolver o mesmo
 * nível de detalhe que `GET /v1/orders/{id}` devolve — UNVERIFIED, mesma
 * ressalva de `buscarOrdersDoPedido`), só pelo `status` da RAIZ.
 */
const STATUS_ORDER_VIVOS = new Set(["created", "processing", "action_required"]);

/**
 * Os status TERMINAIS, documentados, em que a Orders API garante que NENHUM
 * dinheiro novo pode ser capturado por aquela order — o oposto de
 * `STATUS_ORDER_VIVOS`. `resolverSentinela`, abaixo, só libera quando TODA
 * order de cartão encontrada está aqui — nunca por eliminação (um status que
 * este arquivo não conhece NUNCA conta como morto: pode ser uma variação de
 * `processed` que este comentário não previu, e liberar às cegas reabriria
 * exatamente o buraco que este Ponto fecha).
 */
const STATUS_ORDER_MORTOS = new Set(["failed", "canceled", "cancelled", "expired", "refunded", "charged_back"]);

/**
 * A data de CRIAÇÃO da order, em milissegundos — campo raiz `date_created`
 * (nome documentado pela Payments API clássica, já lido por este repositório
 * em `refund.date_created`, `_shared/estorno.ts`) ou `created_date` (grafia
 * alternativa cogitada para a Orders API — UNVERIFIED, mesma ressalva de
 * `buscarOrdersDoPedido`). Sem nenhum dos dois campos, ou com um valor que
 * `Date.parse` não entende, devolve `null` — nunca uma data inventada:
 * `resolverSentinela`, abaixo, trata `null` como "não dá para confiar",
 * nunca libera a vaga por causa desta order.
 */
function dataDeCriacaoDaOrderMs(order: Record<string, unknown>): number | null {
  const bruto = typeof order.date_created === "string"
    ? order.date_created
    : typeof order.created_date === "string"
      ? order.created_date
      : null;
  if (bruto === null) return null;
  const ms = Date.parse(bruto);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Decide o que fazer com um SENTINELA a partir das orders devolvidas por
 * `buscarOrdersDoPedido` (Ponto 1, 4ª revisão de risco, 26/09/2026; B1, 5ª
 * revisão, 26/09/2026) — filtra para CARTÃO (`orderEhDeCartao`; a busca por
 * `external_reference` também devolve o PIX do mesmo pedido, que não
 * interessa aqui) e decide:
 *
 *   - alguma `status === "processed"` OU ainda VIVA (`STATUS_ORDER_VIVOS`,
 *     acima) → `{ acao: "gravar", order }` — grava o id de verdade na vaga
 *     e deixa a reconsulta por id (`GET /v1/orders/{id}` →
 *     `mapearStatusOrder`, o caminho que já existe nos ramos (a)/(d)/(f) de
 *     `criar-pagamento/index.ts`) decidir o desfecho fino. Achado do
 *     comentário "Adopt only on a fully known state" (6ª rodada, achados de
 *     risco): `processed` sozinho já foi tratado como ADOÇÃO direta — mas
 *     `processed:partially_refunded`, por exemplo, é `processed` na raiz e
 *     NÃO é dinheiro limpo. Decidir por `status` sozinho aqui só para
 *     escolher QUAL order rastrear nunca foi o problema; o problema era
 *     pular direto para "aprovado" sem o PAR completo. Agora só um caminho
 *     decide aprovação: a reconsulta por id, que já exige o par exato;
 *   - TODAS reconhecidamente mortas (`STATUS_ORDER_MORTOS`, acima) → só
 *     `{ acao: "liberar" }` se pelo menos uma delas tiver `date_created`
 *     (ou `created_date`) legível e criada DEPOIS do limite inferior, com
 *     margem PARA A FRENTE (`> limiteInferiorMs + MARGEM_LIBERAR_APOS_
 *     LIMITE_MS` — BLOQUEIO da 7ª revisão de risco, 26/09/2026: a margem
 *     era PARA TRÁS antes disso, e a order da tentativa ANTERIOR — a que
 *     causou a liberação que fixa `limiteInferiorMs` — nasce sempre
 *     SEGUNDOS ANTES desse instante, nunca depois; uma margem para trás a
 *     incluía quase sempre, o oposto do que B1 promete). Fecha B1 (5ª
 *     revisão de risco, 26/09/2026, cenário Q3): uma lista PARCIALMENTE
 *     indexada pode conter só a order MORTA de uma tentativa ANTERIOR (já
 *     resolvida, "todas mortas" bate por essa lista incompleta) enquanto a
 *     order da tentativa ATUAL (ainda viva no MP) não apareceu ainda por
 *     atraso de indexação — soltar aqui libera a vaga com a cobrança da
 *     tentativa atual ainda em aberto, e o PIX criado por cima vira uma
 *     SEGUNDA cobrança quando ela aprovar depois. `limiteInferiorMs === null`
 *     (sentinela sem o sufixo novo, ou sem sentinela — `resolverSentinela`
 *     não deveria ser chamado sem um, mas por segurança) NUNCA libera: sem
 *     limite conhecido, não dá para confiar que a lista cobre a tentativa
 *     atual;
 *   - qualquer outra combinação (alguma order com `status` que este arquivo
 *     não reconhece nem como capturado/vivo nem como morto) →
 *     `{ acao: "gravar", order }` com a PRIMEIRA delas: nunca libera sobre
 *     um status desconhecido, e o par cru chega ao cliente pelo mesmo
 *     caminho "par desconhecido" que uma reconsulta normal já devolve.
 *
 * Lista VAZIA (nenhuma order de CARTÃO encontrada) devolve `null` — NUNCA
 * `{ acao: "liberar" }`: "nada encontrado ainda" (atraso de indexação, por
 * exemplo) não é o mesmo fato que "encontrei e está morta". Quem chama trata
 * `null` exatamente como uma busca que falhou — nunca libera às cegas. O
 * mesmo vale quando "todas mortas" bate mas nenhuma está dentro da janela.
 */
export function resolverSentinela(
  orders: Record<string, unknown>[],
  limiteInferiorMs: number | null,
): { acao: "gravar"; order: Record<string, unknown> } | { acao: "liberar" } | null {
  const cartao = orders.filter((o) => orderEhDeCartao(o));
  if (cartao.length === 0) return null;
  const aprovada = cartao.find((o) => String(o.status ?? "") === "processed");
  const viva = aprovada ?? cartao.find((o) => STATUS_ORDER_VIVOS.has(String(o.status ?? "")));
  if (viva) return { acao: "gravar", order: viva };
  const todasMortas = cartao.every((o) => STATUS_ORDER_MORTOS.has(String(o.status ?? "")));
  if (!todasMortas) return { acao: "gravar", order: cartao[0] };
  if (limiteInferiorMs === null) return null;
  // BLOQUEIO (7ª revisão de risco, 26/09/2026): margem PARA A FRENTE — ver
  // `MARGEM_LIBERAR_APOS_LIMITE_MS`, acima, para o motivo de NUNCA subtrair
  // aqui.
  const algumaDentroDaJanela = cartao.some((o) => {
    const criadaEm = dataDeCriacaoDaOrderMs(o);
    return criadaEm !== null && criadaEm > limiteInferiorMs + MARGEM_LIBERAR_APOS_LIMITE_MS;
  });
  return algumaDentroDaJanela ? { acao: "liberar" } : null;
}

/**
 * Achado 2 da revisão do PR: `typeof valor === "string" ? valor : null`
 * transforma um id NUMÉRICO em `null` — indistinguível de ausência. O
 * caminho clássico (`interpretarRespostaDePagamento`, acima) já resolve o
 * mesmo problema com `String(json.id)`; divergir os dois é a doença do #53
 * (mesma regra escrita em dois lugares) se repetindo dentro do MESMO
 * arquivo. `String()` sozinho transformaria ausência em `"undefined"` ou
 * `"null"` — por isso a normalização checa `null`/`undefined` primeiro e só
 * então converte.
 */
function normalizarId(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  return String(valor);
}

/**
 * `extrairQrCode` — o QR do PIX não está mais na raiz da resposta (era
 * `point_of_interaction.transaction_data.qr_code` no clássico). Medido na
 * resposta real de `/v1/orders`:
 *
 *   order.transactions.payments[0].payment_method.qr_code        → copia-e-cola
 *   order.transactions.payments[0].payment_method.qr_code_base64 → imagem
 *   order.id                                                     → id da order
 *   order.transactions.payments[0].id                            → id do pagamento
 *
 * Distingue AUSÊNCIA de ERRO, porque este repositório já reprovou correção
 * por mascarar falha como vazio (#33):
 *   - `order` ilegível (null/undefined/não-objeto) → devolve `null`. Isto é
 *     ERRO: quem chama recebeu algo que não devia.
 *   - `order` válida mas sem o caminho até o QR (ex.: order que ainda não
 *     processou o pagamento) → devolve um objeto com os campos ausentes
 *     como `null`. Isto é AUSÊNCIA, não erro: a Task 2 decide o que fazer.
 *
 * QUAL DOS DOIS IDS VIRA `gateway_payment_id` (Achado 3 da revisão do PR):
 * é o `orderId`, não o `paymentId`. A Orders API não expõe um endpoint de
 * reconsulta por id de pagamento — a documentação do MP (checkout-api-orders
 * /notifications) diz que a forma de obter o estado atualizado é `GET
 * /v1/orders/{id}`, pelo id da ORDER. É exatamente o papel que
 * `gateway_payment_id` já cumpre no caminho clássico: o valor que
 * `criar-pagamento` grava na criação E que `reconciliar-pagamentos`
 * reusa para reconsultar (`consultarPagamento({ paymentId:
 * candidato.gateway_payment_id })`, GET /v1/payments/{id}) — no clássico os
 * dois coincidem porque `payment` é o único recurso. Na Orders API quem
 * sobrevive e se reconsulta é a `order`; o `paymentId` (id de uma tentativa
 * de pagamento dentro dela) não tem endpoint de reconsulta próprio
 * documentado. Escolher `paymentId` aqui reproduziria o Achado 3: id que
 * não bate com o que a reconciliação sabe reconsultar vira 'divergente' na
 * `confirmar_pagamento` (20260808000000_confirmar_pagamento.sql:53-57) PARA
 * SEMPRE. As Tasks 2-4 (não desta tarefa) precisam confirmar isso contra o
 * corpo real do webhook antes de gravar `gateway_payment_id` em produção.
 */
export function extrairQrCode(
  order: Record<string, unknown> | null | undefined,
): {
  orderId: string | null;
  paymentId: string | null;
  qrCode: string | null;
  qrCodeBase64: string | null;
  // Tarefa 2 (CHECKOUT-070): `criar-pagamento` já devolve `ticketUrl` ao
  // front (contrato declarado em useOrders.ts:1028). A doc oficial mostra
  // este campo no MESMO objeto do QR (transactions.payments[0].payment_
  // method.ticket_url — URL com instruções para o comprador), então a
  // extração acompanha o QR em vez de virar um lugar novo para procurar.
  ticketUrl: string | null;
} | null {
  if (!order || typeof order !== "object") return null;

  const transacoes = order.transactions as Record<string, unknown> | undefined;
  const pagamentos = transacoes?.payments as unknown[] | undefined;
  const pagamento = pagamentos?.[0] as Record<string, unknown> | undefined;
  const metodo = pagamento?.payment_method as Record<string, unknown> | undefined;

  return {
    orderId: normalizarId(order.id),
    paymentId: normalizarId(pagamento?.id),
    qrCode: typeof metodo?.qr_code === "string" ? metodo.qr_code : null,
    qrCodeBase64: typeof metodo?.qr_code_base64 === "string" ? metodo.qr_code_base64 : null,
    ticketUrl: typeof metodo?.ticket_url === "string" ? metodo.ticket_url : null,
  };
}

/**
 * `extrairDataExpiracaoOrder` — o vencimento ABSOLUTO que o MP carimbou na
 * order, usado para REALINHAR `expires_at` do pedido com o vencimento real
 * do QR (decisão do dono, 14/08/2026).
 *
 * O PROBLEMA QUE ISTO RESOLVE: a reserva de estoque nasce com `expires_at =
 * criação do PEDIDO + 30 min`; o QR do PIX vale 30 min a partir da criação
 * da COBRANÇA, que acontece DEPOIS — se o cliente demora escolhendo, o QR
 * fica pagável bem depois de o pg_cron já ter devolvido o estoque, e o
 * cliente paga um produto que já pode ter sido vendido para outra pessoa.
 * `date_of_expiration` é o vencimento que o MP DE FATO aplicou ao
 * pagamento — fonte da verdade, ao contrário de um `now() + 30 min`
 * calculado no relógio desta function, que diverge do relógio do MP.
 *
 * FUNÇÃO IRMÃ de `extrairQrCode`, não uma extensão dele: `date_of_expiration`
 * mora um nível ACIMA de `payment_method` — é campo do PAGAMENTO, não do
 * método (`order.transactions.payments[0].date_of_expiration`, medido na
 * resposta real de `/v1/orders` em 14/08/2026, ao lado de `expiration_time`
 * que `montarCorpoPixOrders` já manda). Estender `extrairQrCode` obrigaria
 * TODO chamador dele (inclusive os que só querem o QR) a carregar um campo
 * que não pediu, e quebraria os testes existentes que comparam o objeto
 * inteiro por igualdade (`mercadopago_test.ts`) sem ganhar nada em troca —
 * quem decide o que fazer com a data (a janela sã, o teto de segurança
 * contra o default de 24h do MP) é o CHAMADOR (`criar-pagamento/index.ts`),
 * não este arquivo compartilhado.
 *
 * Mesma regra de `typeof` que `extrairQrCode` já usa: ausência (campo
 * faltando, `order` sem `transactions`) e tipo errado (não é string)
 * devolvem `null` do mesmo jeito — nunca um palpite.
 */
export function extrairDataExpiracaoOrder(
  order: Record<string, unknown> | null | undefined,
): string | null {
  if (!order || typeof order !== "object") return null;

  const transacoes = order.transactions as Record<string, unknown> | undefined;
  const pagamentos = transacoes?.payments as unknown[] | undefined;
  const pagamento = pagamentos?.[0] as Record<string, unknown> | undefined;

  return typeof pagamento?.date_of_expiration === "string"
    ? pagamento.date_of_expiration
    : null;
}

// Tolerância da conferência de valor (laudo caça-bugs 31/08, achado A3) —
// a MESMA da criação de pedido: `create_marketplace_order_v23/v24` conferem
// o total enviado pelo front a ±R$ 0,05. Abaixo disso é arredondamento de
// centavo; acima é divergência de dinheiro. Compartilhada porque a conferência
// vale nas DUAS portas de confirmação: webhook-mercadopago E
// reconciliar-pagamentos (regra em um lugar só — lição #53).
export const TOLERANCIA_DE_VALOR = 0.05;

/**
 * Valor aprovado na grafia da Orders API (laudo 31/08, achado A3). MEDIDO
 * contra a API real em 14/08/2026 (`:252-253`, bloco de montarCorpoPix):
 * `total_amount` e `transactions.payments[0].amount` são STRING com duas
 * casas ("50.00"), não número. `Number("50.00")` é 50 — mas `Number(null)`
 * é 0, e 0 aqui seria pedido de graça: só converte campo PRESENTE (string
 * ou number); ausente vira `undefined`, que a conferência trata como "não
 * deu para conferir", nunca como valor zero.
 */
export function extrairValorDaOrder(order: Record<string, unknown>): number | undefined {
  const brutoRaiz = order.total_amount;
  if (typeof brutoRaiz === "string" || typeof brutoRaiz === "number") {
    const valor = Number(brutoRaiz);
    if (Number.isFinite(valor)) return valor;
  }
  const transactions = order.transactions as Record<string, unknown> | undefined;
  const primeiro = (transactions?.payments as Array<Record<string, unknown>> | undefined)?.[0];
  const brutoPagamento = primeiro?.amount;
  if (typeof brutoPagamento === "string" || typeof brutoPagamento === "number") {
    const valor = Number(brutoPagamento);
    if (Number.isFinite(valor)) return valor;
  }
  return undefined;
}

type ResultadoPagamento =
  | {
      ok: true;
      id: string;
      status: string;
      // Adicionado na Task 4 (Fase 3): a webhook-mercadopago precisa saber A
      // QUAL PEDIDO a confirmação pertence, e o corpo do webhook não serve
      // para isso — qualquer um pode forjar um POST. A resposta do MP, do
      // outro lado, veio autenticada pelo token do gateway. A criação grava
      // este mesmo valor (`external_reference`, montado pelos construtores de
      // corpo acima); aqui é onde ele volta.
      externalReference?: string;
      // Valor cobrado, na grafia da resposta clássica do MP
      // (`transaction_amount`). A webhook-mercadopago e a
      // reconciliar-pagamentos usam para conferir o valor aprovado contra o
      // total do pedido (laudo caça-bugs 31/08, achado A3). Opcional DE
      // PROPÓSITO: ausente quando o corpo não trouxe número — quem consome
      // trata ausência como "não deu para conferir", NUNCA como 0 (zero
      // aqui seria pedido de graça).
      valor?: number;
      qrCode?: string;
      qrCodeBase64?: string;
      ticketUrl?: string;
      // ADITIVO (item (b) do brief da T5, 08/09/2026): o JSON cru da
      // resposta, para a rota `payment` do webhook ler `refunds[]`/
      // `transaction_amount_refunded`/`status_detail` SEM um segundo GET —
      // os campos já tipados acima (`status`, `valor`...) continuam
      // existindo e não mudam; `corpo` é só o objeto por trás deles.
      corpo?: Record<string, unknown>;
    }
  | { ok: false; erro: string; status: number };

/**
 * `consultarPagamento` — reconsulta uma cobrança JÁ criada (CHECKOUT-050).
 *
 * O navegador mobile descarta a aba enquanto o cliente vai ao app do banco
 * pagar; ao voltar, a tela remonta e precisa do MESMO QR — sem criar uma
 * segunda cobrança. (Dizia aqui que o QR "só existe na resposta da CRIAÇÃO";
 * nunca foi medido neste endpoint, e no equivalente da Orders API a medição
 * de 14/08/2026 provou o contrário — ver `consultarOrder` acima.) Por isso é GET,
 * sem corpo e SEM `X-Idempotency-Key`: não é escrita, então não tem o que
 * proteger de duplicar.
 *
 * Devolve `ResultadoPagamento` e obedece às regras de sempre: nunca
 * rejeita, a leitura do corpo fica dentro do try, e o corpo do erro do MP
 * vai só para o log.
 */
export async function consultarPagamento(args: {
  token: string;
  paymentId: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  // P-4 (laudo 01/09): ver criarOrder.
  tempoLimiteMs?: number;
}): Promise<ResultadoPagamento> {
  const f = args.fetchImpl ?? fetch;
  const base = args.baseUrl ?? BASE_URL_PADRAO;

  let resposta: Response;
  try {
    resposta = await fetchComTempo(
      f,
      `${base}/v1/payments/${args.paymentId}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${args.token}` },
      },
      args.tempoLimiteMs,
    );
  } catch (_err) {
    return { ok: false, erro: "Falha ao falar com o gateway.", status: 0 };
  }

  return interpretarRespostaDePagamento(resposta, "Não foi possível consultar a cobrança.");
}

/**
 * Leitura da resposta CLÁSSICA (`/v1/payments`). Nasceu como miolo comum de
 * `criarPagamento` e `consultarPagamento`; desde a Fase 3.5 (26/09/2026) a
 * criação clássica não existe mais (o cartão foi para a Orders API) e o
 * único chamador é `consultarPagamento` — a leitura continua separada para
 * não misturar requisição e interpretação, igual à `interpretarRespostaDeOrder`.
 */
async function interpretarRespostaDePagamento(
  resposta: Response,
  mensagemDeFalha: string,
): Promise<ResultadoPagamento> {
  if (!resposta.ok) {
    // O corpo do erro do MP vai para o log da função, NUNCA para o cliente:
    // ele carrega detalhe de credencial e de conta.
    const detalhe = await resposta.text().catch(() => "");
    console.error("mercadopago: recusou", resposta.status, detalhe);
    return { ok: false, erro: mensagemDeFalha, status: resposta.status };
  }

  // A leitura do corpo mora no MESMO try que trata resposta ilegível: um
  // 2xx com corpo HTML, vazio ou "null" faria json() rejeitar, e a rejeição
  // escaparia esta função inteira. Quem chama `consultarPagamento` não tem
  // try/catch externo em volta — nenhum caminho aqui pode rejeitar.
  let json: Record<string, unknown> | null;
  try {
    json = await resposta.json();
  } catch (_err) {
    console.error("mercadopago: resposta 2xx com corpo ilegível", resposta.status);
    return { ok: false, erro: "Resposta inválida do gateway.", status: resposta.status };
  }

  if (json?.id === undefined || json?.id === null) {
    // "undefined" nunca pode virar gateway_payment_id: a coluna tem índice
    // UNIQUE parcial, e a segunda ocorrência estoura 23505.
    console.error("mercadopago: resposta 2xx sem id", resposta.status, JSON.stringify(json));
    return { ok: false, erro: "Resposta inválida do gateway.", status: resposta.status };
  }

  const dados =
    (json.point_of_interaction as Record<string, unknown> | undefined)
      ?.transaction_data as Record<string, unknown> | undefined ?? {};

  return {
    ok: true,
    // A coluna gateway_payment_id é text e o MP devolve número.
    id: String(json.id),
    status: String(json.status),
    externalReference:
      typeof json.external_reference === "string" ? json.external_reference : undefined,
    // Só número conta como valor: string do MP viria com casas ("50.00")
    // na Orders API, mas o clássico traz número; qualquer outra coisa
    // (string, null, ausente) vira undefined — "não deu para conferir",
    // nunca 0. Ver o comentário do campo no tipo `ResultadoPagamento`.
    valor:
      typeof json.transaction_amount === "number" ? json.transaction_amount : undefined,
    qrCode: dados.qr_code as string | undefined,
    qrCodeBase64: dados.qr_code_base64 as string | undefined,
    ticketUrl: dados.ticket_url as string | undefined,
    corpo: json,
  };
}

/**
 * Um manifesto candidato de assinatura: o texto exato que vira HMAC, e o
 * rótulo que identifica de onde saiu o `data.id` e em qual grafia — é esse
 * rótulo que a chamadora (`webhook-mercadopago`) loga para provar, por
 * inversão, qual candidato casou (ou nenhum) quando o MP reenviar.
 */
export type CandidatoManifesto = { rotulo: string; manifesto: string };

/**
 * Os dois campos que o `x-signature` do MP carrega (`ts=<epoch>,v1=<hex>`):
 * separa por vírgula, parte no primeiro `=`, o valor é o resto. Devolve
 * `null` (não string vazia) para campo ausente.
 *
 * ÚNICA regra de parse do repositório (mp-10): até esta extração,
 * `webhook-mercadopago/index.ts` tinha uma CÓPIA deste laço (para a porta
 * barata que recusa sem tocar o banco) e `avaliarAssinatura`, logo abaixo,
 * tinha outra — duas grafias que podiam divergir em silêncio e fariam a
 * porta barata recusar (ou aceitar) notificação que a validação de verdade
 * decidiria diferente. Exportada para quem mais precisar dos dois campos
 * (hoje só o próprio webhook, em três lugares: a recusa barata, o log de
 * entrada e o log de falha).
 */
export function camposDaAssinatura(
  xSignature: string | null,
): { ts: string | null; v1: string | null } {
  let ts = "";
  let v1 = "";
  for (const parte of xSignature?.split(",") ?? []) {
    const [chave, ...resto] = parte.split("=");
    const valor = resto.join("=").trim();
    if (chave?.trim() === "ts") ts = valor;
    if (chave?.trim() === "v1") v1 = valor;
  }
  return { ts: ts || null, v1: v1 || null };
}

/**
 * Monta os manifestos candidatos da assinatura, já DEDUPLICADOS pelo TEXTO
 * do manifesto — não só pelo `dataId`: um id numérico (ex.: "999") tem a
 * mesma forma em maiúsculas e minúsculas, então "corpo-original" e
 * "corpo-minusculo" produziriam o MESMO manifesto, e aqui sai só um.
 *
 * As DUAS grafias saem sempre do `data.id` do CORPO — nunca da query string
 * (removida em 16/08/2026, achado BLOQUEANTE de revisão: a query é
 * controlada pelo mesmo atacante que controla o corpo, e todo o
 * processamento downstream — rota, consulta ao MP, RPC — usa o id do CORPO;
 * aceitar a query como fonte de manifesto autenticava um campo e usava
 * outro). A `Map` por manifesto garante um HMAC por STRING única — nunca
 * dois cálculos para o mesmo texto.
 *
 * Extraída como função pura e síncrona (sem HMAC aqui dentro) para o teste
 * de deduplicação não depender de `crypto.subtle` nem de `await`.
 */
export function construirCandidatosManifesto(args: {
  dataId: string;
  xRequestId: string | null;
  ts: string;
}): CandidatoManifesto[] {
  const { xRequestId, ts } = args;
  const montar = (id: string): string =>
    xRequestId ? `id:${id};request-id:${xRequestId};ts:${ts};` : `id:${id};ts:${ts};`;

  const brutos: CandidatoManifesto[] = [
    { rotulo: "corpo-original", manifesto: montar(args.dataId) },
    { rotulo: "corpo-minusculo", manifesto: montar(args.dataId.toLowerCase()) },
  ];

  const vistos = new Set<string>();
  const candidatos: CandidatoManifesto[] = [];
  for (const candidato of brutos) {
    if (vistos.has(candidato.manifesto)) continue;
    vistos.add(candidato.manifesto);
    candidatos.push(candidato);
  }
  return candidatos;
}

/**
 * Valida o x-signature do webhook do Mercado Pago, e devolve o diagnóstico
 * completo (não só o booleano) para quem chama poder logar.
 *
 * E' a UNICA autenticacao que a webhook-mercadopago tem: ela roda com
 * verify_jwt = false porque o MP nao manda JWT. Sem isto, quem descobrir a URL
 * forja um "aprovado" e leva produto de graca.
 *
 * Formato confirmado na documentacao do MP (context7, 09/08/2026): o header
 * vem como `ts=<epoch>,v1=<hex>`, o manifesto e
 * `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` — com o segmento
 * request-id OMITIDO quando o header nao veio, igual ao SDK oficial — e o
 * hash e HMAC-SHA256 do manifesto, comparado ao `v1` em hex.
 *
 * POR QUE DUAS GRAFIAS, E NÃO UMA (medido em produção 16/08/2026 — um PIX de
 * R$ 1,00 pago às 18:12 UTC ficou "aguardando" para sempre porque as duas
 * fontes abaixo se contradizem e este código confiava só numa):
 *
 *   - A DOC OFICIAL (checkout-api-orders/notifications, pt-BR/es-MX/en)
 *     manda passar `data.id` para minúsculas antes do manifesto, com nota
 *     explícita para ULID de Order. Ela TAMBÉM erra a unidade do `ts`
 *     (diz milissegundos; o MP manda segundos — issue #458 do
 *     mercadopago/sdk-nodejs, confirmada).
 *   - O SDK OFICIAL (Node) nasceu com `.toLowerCase()` (PR #423, maio/2026)
 *     e teve essa linha REMOVIDA no PR #439, de um contribuidor externo,
 *     aberto nos 7 SDKs em 34 segundos — a "evidência" do PR foi assinar
 *     com a regra nova e verificar com a regra nova (raciocínio circular),
 *     e o diff mexeu no helper de teste (`computeHash`) junto com a
 *     implementação. ZERO evidência de tráfego real; um comentário anterior
 *     desta função afirmava o contrário ("o SDK ganha porque foi corrigido
 *     por observação de tráfego real") e essa afirmação foi verificada e é
 *     FALSA.
 *
 * Com `data.id` numérico as duas regras produzem HMAC IDÊNTICO — por isso o
 * simulador do painel do MP nunca detectou a divergência — e só divergem
 * para o ULID ("ORD…") da Orders API, exatamente o caso que quebrou em
 * produção. Aceitar as duas grafias em vez de apostar em qualquer uma
 * custa ZERO em segurança: os dois candidatos exigem o MESMO
 * `MP_WEBHOOK_SECRET`, e quem amarra o pedido não é o `data.id` — é o
 * `external_reference` que volta da consulta AUTENTICADA ao MP (invariante
 * nº 1, documentada em `webhook-mercadopago/index.ts:16-24`).
 *
 * NÃO inclui o `data.id` da QUERY STRING (removido em 16/08/2026, achado
 * BLOQUEANTE de revisão). A doc do MP monta o manifesto sobre o valor da
 * query, não do corpo, mas a query é um campo que o ATACANTE também
 * controla — e todo o processamento downstream (rota, consulta ao MP, RPC
 * `confirmar_pagamento`) usa o `data.id` do CORPO, nunca o da query. Aceitar
 * a query como fonte extra de candidato permitia satisfazer a assinatura com
 * um id e processar outro: a assinatura tem de amarrar EXATAMENTE o id que o
 * handler vai usar, senão ela autentica um campo e o código usa outro — a
 * prova disso é que a suíte de teste tinha um caso desenhado para barrar
 * corpo adulterado e ele continuava verde porque não passava id pela query.
 *
 * Pura e com `agora` injetavel para o teste nao depender do relogio.
 */
export async function avaliarAssinatura(args: {
  xSignature: string | null;
  xRequestId: string | null;
  dataId: string;
  segredo: string;
  agora?: number;
  toleranciaSegundos?: number;
}): Promise<{
  valido: boolean;
  candidatoCasou: string | null;
  candidatos: string[];
}> {
  const { xSignature, xRequestId, dataId, segredo } = args;
  const agora = args.agora ?? Date.now();
  // 300s É O DEFAULT DO PARÂMETRO, NÃO O QUE RODA EM PRODUÇÃO: o único
  // chamador de produção (webhook-mercadopago/index.ts) passa
  // Number.POSITIVE_INFINITY de propósito — o commit 398ae08 desligou a
  // janela aqui. O MP reenvia sem limite documentado (não para depois da
  // 3ª tentativa, só estende o intervalo), então nenhuma janela finita é
  // segura: uma cadeia longa de reenvios ultrapassa qualquer valor
  // escolhido, e o ÚLTIMO reenvio vira 401 permanente. Quem autentica aqui
  // é o HMAC, não o relógio — replayar um header velho só produz uma
  // consulta NOVA ao MP (ver `consultarPagamento`), e a decisão sai do
  // estado ATUAL, não do que veio no header. A janela continua existindo
  // como parâmetro para quem quiser um chamador diferente (ex.: teste que
  // queira provar a expiração em si).
  const tolerancia = args.toleranciaSegundos ?? 300;

  const semCandidatos = { valido: false, candidatoCasou: null, candidatos: [] };

  if (!xSignature || !segredo || !dataId) return semCandidatos;

  // `camposDaAssinatura` (acima): a MESMA regra de parse que a porta barata
  // do webhook usa para recusar sem tocar o banco — duas grafias divergentes
  // fariam essa porta e esta validação discordar sobre o que é um header
  // "sem forma" (mp-10).
  const { ts: tsOuNulo, v1: v1OuNulo } = camposDaAssinatura(xSignature);
  const ts = tsOuNulo ?? "";
  const v1 = v1OuNulo ?? "";
  if (!ts || !v1) return semCandidatos;

  // `ts` fora da janela: só importa para um chamador que passe uma
  // `toleranciaSegundos` finita — a webhook-mercadopago, o único chamador de
  // produção, desliga isto (ver comentário acima de `tolerancia`).
  const tsNumero = Number(ts);
  if (!Number.isFinite(tsNumero)) return semCandidatos;
  const idadeSegundos = Math.abs(agora / 1000 - tsNumero);
  if (idadeSegundos > tolerancia) return semCandidatos;

  const candidatosManifesto = construirCandidatosManifesto({
    dataId,
    xRequestId,
    ts,
  });

  const chave = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(segredo),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  // Cada candidato calcula o HMAC e compara em tempo constante, e o LAÇO
  // INTEIRO roda sem early-return: nada de `.some()`/`.find()` parando no
  // primeiro acerto, porque isso faria o tempo total depender de QUAL
  // candidato bateu — o mesmo vazamento que a comparação char-a-char abaixo
  // já evita dentro de cada candidato. `casou`/`rotuloCasou` só GUARDAM o
  // resultado; não interrompem o laço.
  let casou = false;
  let rotuloCasou: string | null = null;
  // Só os RÓTULOS dos candidatos tentados — sem hash nem prefixo dele. Um
  // prefixo de 16 hex por candidato, junto com o resto do manifesto (id,
  // request-id, ts, todos previsíveis), monta um oráculo de verificação
  // offline do `MP_WEBHOOK_SECRET` (achado de revisão, 16/08/2026):
  // inviável na prática pela entropia do segredo, mas sem motivo para expor
  // e sem plano de remoção. O rótulo sozinho já entrega o diagnóstico que
  // importa ("tentamos corpo-original e corpo-minusculo, nenhum casou").
  const diagnostico: string[] = [];

  for (const candidato of candidatosManifesto) {
    const assinado = await crypto.subtle.sign(
      "HMAC",
      chave,
      new TextEncoder().encode(candidato.manifesto),
    );
    const hex = Array.from(new Uint8Array(assinado))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    diagnostico.push(candidato.rotulo);

    // Comparacao de tempo constante: `===` em string vaza, pelo tempo de
    // resposta, quantos caracteres do prefixo o atacante ja acertou. O
    // comprimento diferente já responde `false` sem entrar no laço — não é
    // segredo, é o mesmo hex.length de sempre (SHA-256 = 64 chars).
    let bateuEste = hex.length === v1.length;
    if (bateuEste) {
      let diferenca = 0;
      for (let i = 0; i < hex.length; i++) {
        diferenca |= hex.charCodeAt(i) ^ v1.charCodeAt(i);
      }
      bateuEste = diferenca === 0;
    }

    if (bateuEste && !casou) {
      casou = true;
      rotuloCasou = candidato.rotulo;
    }
  }

  return { valido: casou, candidatoCasou: rotuloCasou, candidatos: diagnostico };
}

/**
 * Fachada booleana de `avaliarAssinatura`, para quem só precisa do
 * sim/não (é o contrato que os testes de `mercadopago_assinatura_test.ts`
 * já exercitam). `webhook-mercadopago` usa `avaliarAssinatura` diretamente,
 * porque precisa do diagnóstico para logar.
 */
export async function validarAssinatura(args: {
  xSignature: string | null;
  xRequestId: string | null;
  dataId: string;
  segredo: string;
  agora?: number;
  toleranciaSegundos?: number;
}): Promise<boolean> {
  const resultado = await avaliarAssinatura(args);
  return resultado.valido;
}
