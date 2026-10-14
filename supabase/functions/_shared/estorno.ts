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
 *
 * INVARIANTE DA CONFIRMAÇÃO POR CONSULTA (brief P0 de 08/09/2026, pré-
 * requisito da T5/T6; laudo `20260908-laudo-opus-pr440-t4-reconciliacao-
 * rodada2.md`, achado 1): um refund do MP credita UMA linha do ledger, e é a
 * linha do MESMO valor que ainda não o reivindicou — nunca "qualquer refund
 * processed/approved do pedido" (ver `decidirConclusaoPelaConsulta`).
 */

import {
  BASE_URL_PADRAO,
  consultarOrder,
  fetchComTempo,
  idEhClassico,
  resumoSemDadoPessoal,
} from "./mercadopago.ts";

export type LinhaEstorno = {
  id: string;
  order_id: string;
  amount: number;
  status: "solicitado" | "em_processamento" | "concluido" | "falhou" | "recusado";
  mp_refund_id: string | null;
  tentativas: number;
  // R1 (revisão Opus de 14d77a5b; colunas da 20261196000000). Opcionais:
  // ausentes = linha LEGADA (o critério antigo vale) — o lado seguro.
  /** Último POST autorizado por `autorizar_post_do_estorno`; presente = incerta. */
  post_autorizado_em?: string | null;
  /** true = nasceu depois da 20261196000000; NULL/ausente = legado. */
  criada_sob_autorizacao?: boolean | null;
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
  | {
    tipo: "em_processamento";
    mp_refund_id: string | null;
    mp_status: string;
    diagnostico?: DiagnosticoDoPost;
  }
  // Definitivo: não tentar de novo com esta linha (novo pedido = nova linha).
  | { tipo: "falhou"; motivo: string; codigo: string; diagnostico?: DiagnosticoDoPost }
  // Guarda recusou ANTES de qualquer chamada ao MP: nada foi gasto.
  | { tipo: "recusado"; motivo: string }
  // 429/5xx/rede/resposta não reconhecida: o cron re-tenta com a MESMA chave.
  | { tipo: "tentar_depois"; motivo: string; retryAfterS?: number; diagnostico?: DiagnosticoDoPost };

/**
 * O que o POST de refund de UMA linha deixou para o diagnóstico (tabela
 * `order_refund_diagnostico`, só servidor — migration 20261225000000). Só existe
 * quando um POST SAIU; guarda recusada, autorização indisponível e consulta não
 * têm diagnóstico (nada foi enviado para ficar incerto).
 *
 *   * `mpCodigo`: o código do MP (`errors[]`/`cause[]`/`error_messages[]`/`code`),
 *     ou `http_NNN` quando a resposta não traz nenhum, ou null sem resposta.
 *   * `postIncerto`: o POST pode ter chegado ao MP sem uma resposta que PROVE o
 *     contrário (rede, timeout, 5xx, 429, 423, 401/403, 2xx não reconhecido, corpo
 *     ilegível, código fora das listas) ou o MP disse que há dinheiro em
 *     movimento. É o carimbo que nunca se apaga: linha carimbada nunca recebe
 *     chave nova (só ADOÇÃO do reembolso que o MP já fez, ou "por fora").
 *   * `transitorio`: o MP respondeu, com um código da lista fechada
 *     `CODIGOS_NADA_SAIU`, que NÃO devolveu nada (sem saldo / ainda não liberado).
 *     Conta para o limite `LIMITE_DE_FALHAS_TRANSITORIAS`.
 */
export type DiagnosticoDoPost = {
  mpCodigo: string | null;
  postIncerto: boolean;
  transitorio: boolean;
};

/**
 * A AUTORIZAÇÃO IMEDIATAMENTE ANTES DO POST (Lote A, 04/10/2026 — achado
 * causal do 01765261). O chamador lê o pedido, marca a linha e chama o
 * executor; entre essa leitura e o POST há o GET da transação da order (e,
 * em qualquer caminho, o tempo da própria fila). Um refund feito no painel
 * do MP e registrado pelo webhook nesse meio-tempo
 * (`registrar_estorno_externo_do_mp`) mudava o saldo sem o executor ver.
 *
 * `autorizarAntesDoPost` pergunta ao BANCO — RPC
 * `autorizar_post_do_estorno` (20261196000000): linha e pedido travados
 * (ordem global linha -> pedido), saldo relido — se o POST de X desta linha
 * ainda cabe:
 *   * `autorizado` — devolve o pedido RELIDO; o executor ainda roda a guarda
 *     de entrada sobre ele (pagamento, prazo, saldo) antes do POST.
 *   * `nao_cabe` — nada sai. Linha INCERTA (`linhaPodeJaTerChegadoAoMp`):
 *     fica em_processamento (o cron consulta o MP antes de qualquer
 *     repetição) — uma tentativa ANTERIOR pode ter chegado ao MP sem
 *     confirmação, e liberar a reserva sem prova é o caminho do dinheiro
 *     sair duas vezes. Linha NÃO incerta: `recusado` (nenhum POST saiu; R1
 *     da revisão Opus de 14d77a5b — antes ela ficava reservada para sempre).
 *   * `linha_mudou` — outro executor concluiu/recusou a linha no meio.
 *   * `indisponivel` — o banco não respondeu ou respondeu algo ilegível.
 * Falha FECHADA: sem a autorização (ausente, erro, ilegível) nenhum POST
 * sai — mesma régua de `consultarTransacaoDaOrder` ausente.
 *
 * O que isto NÃO garante: atomicidade com o Mercado Pago. Entre a resposta
 * do banco e o POST ainda há uma janela (curta: nenhuma espera de rede no
 * meio além do próprio POST); quem decide o saldo em última instância é o
 * MP, que recusa refund acima do que resta (`refund_amount_exceeds`/4296).
 */
export type AutorizacaoDoPost =
  | { decisao: "autorizado"; pedido: PedidoParaEstorno }
  | { decisao: "nao_cabe"; disponivel: number | null }
  | { decisao: "linha_mudou"; status: string | null }
  | { decisao: "indisponivel" };

/** Texto leigo gravado em `ultimo_erro` quando o saldo mudou antes do POST. */
export const MOTIVO_SALDO_MUDOU_ANTES_DO_POST =
  "o saldo do pedido mudou enquanto a devolução era preparada (outra devolução já foi registrada pelo Mercado Pago) — nada foi enviado; confira o pedido no painel do Mercado Pago";

/** Texto leigo do `recusado` quando o banco diz que o POST não cabe mais e a
 * linha nunca teve POST (R1). */
export const MOTIVO_SALDO_NAO_COBRE_MAIS =
  "o saldo do pedido não cobre mais esta devolução (outra devolução já foi registrada pelo Mercado Pago) — nada foi enviado e o valor reservado foi liberado; confira o pedido no painel do Mercado Pago";

/**
 * Sufixo do motivo quando a guarda de entrada recusaria uma linha INCERTA
 * (ver `linhaPodeJaTerChegadoAoMp`): nada é enviado e a reserva fica.
 */
export const MOTIVO_LINHA_INCERTA =
  "uma tentativa anterior desta devolução pode já ter chegado ao Mercado Pago — nada novo foi enviado e o valor segue reservado até o Mercado Pago confirmar ou negar";

/**
 * A linha pode JÁ ter chegado ao MP? (Lote A, 04/10/2026 — achado do
 * coordenador em 1a823e3f; critério refeito no R1 da revisão Opus de
 * 14d77a5b, colunas da 20261196000000.) CRITÉRIO EXATO — incerta se:
 *   * `post_autorizado_em` presente — `autorizar_post_do_estorno` autorizou
 *     um POST desta linha (todo POST do executor passa por ela antes);
 *   * `mp_refund_id` presente (não vazio) — o MP já devolveu um id para ela;
 *   * LEGADO: `criada_sob_autorizacao` diferente de true (linha anterior à
 *     migration, ou campo ausente) E `tentativas > 1` — o executor antigo
 *     não carimbava, e toda MARCA (tentativas + 1) antecedia um POST
 *     possível; a linha que chega com tentativas 1 nunca foi marcada antes.
 * Linha nascida depois da migration (true) NÃO é incerta só por
 * `tentativas > 1`: tentativas sobe também em passagem que parou ANTES do
 * POST (nao_cabe, GET da transação falhou, autorização indisponível), e
 * contar isso como "pode ter saído" deixava a reserva presa para sempre.
 * Resíduos no cabeçalho da 20261196000000 (POST real que o MP nunca
 * processou; janela entre migration e edges novas).
 */
export function linhaPodeJaTerChegadoAoMp(linha: LinhaEstorno): boolean {
  if (typeof linha.post_autorizado_em === "string" && linha.post_autorizado_em !== "") {
    return true;
  }
  if (typeof linha.mp_refund_id === "string" && linha.mp_refund_id !== "") return true;
  return linha.criada_sob_autorizacao !== true && Number(linha.tentativas ?? 0) > 1;
}

type ChamarRpc = (
  nome: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: unknown }>;

function numeroFinito(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function pedidoDaAutorizacao(bruto: unknown): PedidoParaEstorno | null {
  if (!bruto || typeof bruto !== "object") return null;
  const p = bruto as Record<string, unknown>;
  const total = numeroFinito(p.total);
  const estornado = numeroFinito(p.valor_estornado ?? 0);
  if (
    typeof p.id !== "string" || typeof p.gateway_payment_id !== "string" ||
    total === null || estornado === null || typeof p.status !== "string"
  ) {
    return null;
  }
  return {
    id: p.id,
    gateway_payment_id: p.gateway_payment_id,
    total,
    valor_estornado: estornado,
    payment_status: typeof p.payment_status === "string" ? p.payment_status : null,
    paid_at: typeof p.paid_at === "string" ? p.paid_at : null,
    status: p.status,
  };
}

/**
 * A autorização pelo banco, para os chamadores que têm um cliente Supabase
 * (edge `estornar-pagamento` e cron `reconciliar-pagamentos`): UMA leitura
 * da resposta da RPC, dois chamadores. Nunca lança.
 */
export function autorizacaoPeloBanco(
  rpc: ChamarRpc,
): (linha: LinhaEstorno) => Promise<AutorizacaoDoPost> {
  return async (linha) => {
    let resposta: { data: unknown; error: unknown };
    try {
      resposta = await rpc("autorizar_post_do_estorno", {
        p_refund_id: linha.id,
        p_valor: linha.amount,
      });
    } catch (err) {
      console.error("estorno: autorizar_post_do_estorno lançou", nomeDoErro(err));
      return { decisao: "indisponivel" };
    }
    if (resposta.error) {
      console.error("estorno: autorizar_post_do_estorno falhou", resposta.error);
      return { decisao: "indisponivel" };
    }
    const d = resposta.data && typeof resposta.data === "object"
      ? resposta.data as Record<string, unknown>
      : null;
    if (d?.decisao === "autorizado") {
      const pedido = pedidoDaAutorizacao(d.pedido);
      return pedido ? { decisao: "autorizado", pedido } : { decisao: "indisponivel" };
    }
    if (d?.decisao === "nao_cabe") {
      return { decisao: "nao_cabe", disponivel: numeroFinito(d.disponivel) };
    }
    if (d?.decisao === "linha_mudou") {
      return { decisao: "linha_mudou", status: typeof d.status === "string" ? d.status : null };
    }
    console.error("estorno: autorizar_post_do_estorno devolveu forma desconhecida");
    return { decisao: "indisponivel" };
  };
}

/**
 * Grava o diagnóstico do POST ANTES de a linha ser tocada (RPC
 * `registrar_diagnostico_do_estorno`, 20261225000000: UPSERT atômico, só
 * servidor) e devolve o que a linha tem AGORA (contador de falhas "nada saiu" e
 * carimbo de incerteza acumulados). Uma nova tentativa se a primeira falhar.
 * Resposta que não tem a forma esperada conta como gravação que falhou — nunca
 * se chuta "sem carimbo". Nunca lança.
 */
async function gravarDiagnostico(
  rpc: ChamarRpc,
  refundId: string,
  d: DiagnosticoDoPost,
): Promise<{ transitorios: number; postIncerto: boolean } | null> {
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    try {
      const resposta = await rpc("registrar_diagnostico_do_estorno", {
        p_refund_id: refundId,
        p_mp_codigo: d.mpCodigo,
        p_post_incerto: d.postIncerto,
        p_transitorio: d.transitorio,
      });
      const dados = resposta.data && typeof resposta.data === "object"
        ? resposta.data as Record<string, unknown>
        : null;
      const transitorios = numeroFinito(dados?.transitorios);
      if (!resposta.error && transitorios !== null && typeof dados?.post_incerto === "boolean") {
        return { transitorios, postIncerto: dados.post_incerto };
      }
      console.error("estorno: registrar_diagnostico_do_estorno falhou ou veio ilegível", resposta.error ?? "forma desconhecida");
    } catch (err) {
      console.error("estorno: registrar_diagnostico_do_estorno lançou", nomeDoErro(err));
    }
  }
  return null;
}

/**
 * D4 (14/10/2026): o ÚNICO ponto em que o servidor decide o que o diagnóstico de
 * um POST faz com o resultado — edge do clique e cron chamam esta função, uma
 * decisão, dois chamadores.
 *   * resultado sem diagnóstico (nada foi enviado, concluído, recusado): igual;
 *   * o diagnóstico é gravado ANTES de qualquer `falhou`: se a gravação falha, a
 *     linha NÃO vira `falhou` (sem carimbo gravado, "falhou" seria lido como
 *     "nada saiu" pelo banco) — fica `tentar_depois`;
 *   * `tentar_depois` "nada saiu" na `LIMITE_DE_FALHAS_TRANSITORIAS`-ésima vez
 *     SEM carimbo de incerteza vira `falhou` (as saídas — reemitir com prova ou
 *     "por fora" — ficam abertas no banco). Com carimbo, fica em consulta para
 *     sempre e NUNCA recebe chave nova.
 */
export async function aplicarDiagnosticoDoPost(
  rpc: ChamarRpc,
  refundId: string,
  resultado: ResultadoEstorno,
): Promise<ResultadoEstorno> {
  if (resultado.tipo === "concluido" || resultado.tipo === "recusado") return resultado;
  const d = resultado.diagnostico;
  if (!d) return resultado;
  const gravado = await gravarDiagnostico(rpc, refundId, d);
  if (!gravado) {
    return resultado.tipo === "falhou"
      ? { tipo: "tentar_depois", motivo: MOTIVO_SEM_DIAGNOSTICO, diagnostico: d }
      : resultado;
  }
  if (
    resultado.tipo === "tentar_depois" && d.transitorio && !gravado.postIncerto &&
    gravado.transitorios >= LIMITE_DE_FALHAS_TRANSITORIAS
  ) {
    return {
      tipo: "falhou",
      motivo: MOTIVO_NAO_LIBERADA_NO_LIMITE,
      codigo: d.mpCodigo ?? "nada_saiu",
      diagnostico: d,
    };
  }
  return resultado;
}

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
 * TODOS os códigos de erro do corpo, nas TRÊS grafias que as APIs do MP usam:
 * Payments clássica (`cause[].code`, número), Orders API (`errors[].code`, o
 * que o resto do repo lê em `mercadopago.ts`) e Orders refund
 * (`error_messages[].code`, nome), mais o `code` de topo. Tolerante de
 * propósito — a taxonomia exata de cada endpoint não é contrato estável; o NOME
 * do código é. Ordem: a de `cause`, `errors`, `error_messages`, `code`.
 */
function acharCodigos(corpo: unknown): string[] {
  if (!corpo || typeof corpo !== "object") return [];
  const c = corpo as Record<string, unknown>;
  const deLista = (lista: unknown): string[] => {
    if (!Array.isArray(lista)) return [];
    const codigos: string[] = [];
    for (const item of lista) {
      const code = (item as Record<string, unknown> | null)?.code;
      if (typeof code === "string" || typeof code === "number") {
        codigos.push(String(code));
      }
    }
    return codigos;
  };
  const doTopo = typeof c.code === "string" || typeof c.code === "number" ? [String(c.code)] : [];
  return [...deLista(c.cause), ...deLista(c.errors), ...deLista(c.error_messages), ...doTopo];
}

/** O primeiro código do corpo — o que as tabelas fechadas de interpretação leem. */
function acharCodigo(corpo: unknown): string | null {
  return acharCodigos(corpo)[0] ?? null;
}

/**
 * Códigos do MP que PROVAM que nada saiu: o MP recusou o refund por falta de
 * saldo na conta ou porque o pagamento ainda não foi liberado. LISTA FECHADA — a
 * migration 20261225000000 só aceita estes dois como prova de "sem POST"
 * (`v_sem_post`); qualquer outro código, e todo código desconhecido, é INCERTO.
 * Os nomes vêm do contrato do banco: não constam da documentação pública do MP
 * (medido em 14/10/2026) e nunca foram vistos na API real. Se o MP usar outro
 * nome, nada passa a ser "nada saiu" por engano: o resultado é só mais linhas
 * incertas (o lado seguro), nunca menos.
 */
const CODIGOS_NADA_SAIU = new Set([
  "insufficient_money_for_refund",
  "order_payment_not_yet_enabled_for_refund",
]);

/**
 * Códigos do MP que dizem que há dinheiro EM MOVIMENTO (um refund em curso ou
 * movimentações pendentes). A linha continua `em_processamento`: nunca vira
 * `falhou` por causa deles e não gasta o limite de falhas "nada saiu".
 * `idempotency_key_already_used` fica de fora de propósito: ele manda CONSULTAR
 * (`CODIGOS_QUE_EXIGEM_CONFIRMACAO`) e, se a consulta não fechar, vira
 * `tentar_depois`, nunca `falhou` (a chave existe no MP).
 */
const CODIGOS_EM_ANDAMENTO = new Set([
  "refund_in_progress",
  "order_refund_already_in_process",
  "movement_operations_pending",
]);

export type ClasseDoErroDoMp = "nada_saiu" | "em_andamento" | "desconhecido";

/**
 * "Nada saiu" só se TODOS os códigos da resposta estão na lista fechada (e há
 * pelo menos um); "em andamento" se QUALQUER um está (dinheiro em movimento
 * vence); o resto — inclusive resposta sem código — é desconhecido = INCERTO.
 */
function classificarCodigosDoMp(codigos: string[]): ClasseDoErroDoMp {
  if (codigos.some((c) => CODIGOS_EM_ANDAMENTO.has(c))) return "em_andamento";
  if (codigos.length > 0 && codigos.every((c) => CODIGOS_NADA_SAIU.has(c))) return "nada_saiu";
  return "desconhecido";
}

/**
 * Textos que vão para `order_refunds.ultimo_erro` — coluna que a CLIENTE lê (a
 * política `order_refunds_cliente_le` devolve a linha inteira). Nada de saldo,
 * de conta do lojista nem de código do MP: o motivo interno mora só em
 * `order_refund_diagnostico`.
 */
export const MOTIVO_AINDA_NAO_LIBERADA =
  "o Mercado Pago ainda não liberou esta devolução; a loja confere de novo em instantes";
export const MOTIVO_NAO_LIBERADA_NO_LIMITE =
  "o Mercado Pago não liberou esta devolução depois de várias tentativas; a loja vai resolver";
export const MOTIVO_SEM_DIAGNOSTICO =
  "não consegui registrar o que o Mercado Pago respondeu; a loja confere de novo em instantes";

/** Quantas respostas "nada saiu" seguidas (sem nenhuma incerteza) esgotam a linha. */
export const LIMITE_DE_FALHAS_TRANSITORIAS = 5;

/** R9: o que do erro de parse pode ir ao log — o NOME (`SyntaxError`),
 * nunca a mensagem (o V8 cola nela o começo do corpo recebido). */
function nomeDoErro(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
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
 * Id do REFUND na resposta do POST de refund da Orders API — NUNCA o id do
 * topo, que é o da ORDER. Contrato confirmado na doc primária (reference
 * orders online-payments refund/post, 29/09/2026): o id do refund mora em
 * `transactions.refunds[].id`; a coluna `order_refunds.mp_refund_id` exige
 * exatamente isso ("id do refund ... gravado só quando existe de verdade",
 * migration 2026110000000), e a travessia P0 (um refund credita UMA linha,
 * via `idsJaReivindicados`) só casa com o id DE VERDADE.
 *
 * SELEÇÃO (achado MÉDIO da revisão de 29/09): só são candidatos refunds com
 * id E com o VALOR desta linha (`emCentavos(amount)`), quando o valor é
 * legível — a resposta do parcial acumula os refunds ANTIGOS da order, e
 * reivindicar o id de um refund alheio degrada o P0 do mesmo jeito que o id
 * da order. Entre candidatos, o MAIS RECENTE por `date_created` (o
 * recém-criado); sem data, perde o desempate (mesma regra de
 * `refundQueCobreALinha`). Nenhum candidato do valor certo: string vazia —
 * quem esclarece é a CONSULTA (GET), como sempre; o id da order nunca.
 *
 * `idsJaReivindicados` (Lote A, 04/10/2026, A6): ids que OUTRAS linhas do
 * pedido já têm saem dos candidatos ANTES do desempate. Dois parciais de
 * MESMO valor davam o MESMO "mais recente" às duas linhas; com o índice
 * único (order_id, mp_refund_id) da migration 20261192000000, o
 * `concluir_estorno` da segunda estouraria 23505 (o COALESCE grava o id) e a
 * linha ficaria presa em 500 — e sem o índice, um refund creditava DUAS
 * linhas (o P0 quebrado pelo POST, não pela consulta).
 */
/**
 * B1 (revisão Opus de 14d77a5b, 04/10/2026): a resposta traz ALGUM refund,
 * com id, do valor desta linha — reivindicado ou não. Quando há e todos já
 * são de outras linhas, `refundDaLinhaNaResposta` devolve null, e isso NÃO
 * pode virar "concluido sem id": o refund do valor da linha existe, só que
 * já está creditado a outra linha (o webhook pode ter casado o refund DESTA
 * chave com outra linha do mesmo valor). Concluir sem id grava
 * concluir_estorno(linha, NULL), que soma sem a guarda do índice único
 * (order_id, mp_refund_id) — a devolução sai em dobro no ledger.
 */
function respostaTemRefundDoValorDaLinha(
  c: Record<string, unknown>,
  linha: LinhaEstorno,
): boolean {
  const centavosDaLinha = emCentavos(linha.amount);
  return refundsDaOrder(c).some((r) => {
    const temId = (typeof r.id === "string" && r.id !== "") || typeof r.id === "number";
    const valor = Number(r.amount);
    return temId && Number.isFinite(valor) && emCentavos(valor) === centavosDaLinha;
  });
}

function refundDaLinhaNaResposta(
  c: Record<string, unknown>,
  linha: LinhaEstorno,
  idsJaReivindicados: string[] = [],
): Record<string, unknown> | null {
    const centavosDaLinha = emCentavos(linha.amount);
    const reivindicados = new Set(idsJaReivindicados);
    const comId = refundsDaOrder(c).filter((r) =>
        ((typeof r.id === "string" && r.id !== "") || typeof r.id === "number") &&
        !reivindicados.has(String(r.id))
    );
    const doValorDaLinha = comId.filter((r) => {
        const valor = Number(r.amount);
        return Number.isFinite(valor) &&
            emCentavos(valor) === centavosDaLinha;
    });
    const candidatos = doValorDaLinha.length > 0 ? doValorDaLinha : [];
    if (candidatos.length === 0) return null;
    let melhor = candidatos[0];
    let melhorData = dataCreatedMs(melhor);
    for (const refund of candidatos.slice(1)) {
        const data = dataCreatedMs(refund);
        if (data > melhorData) {
            melhor = refund;
            melhorData = data;
        }
    }
    return melhor;
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

  // 423 resource_locked (doc primária da idempotência, conferida 29/09): lock
  // TRANSITÓRIO da order — webhook, cron e edge disputam a mesma cobrança, e
  // o MP pede 'retry after some time'. Matar a linha aqui seria executar de
  // novo um POST que é IDEMPOTENTE pela chave da própria linha — repetir é
  // seguro por contrato (achado MÉDIO da revisão de 29/09; antes caía no
  // default e virava 'falhou' definitivo sem retry em lugar nenhum).
  if (status === 423) {
    return {
      tipo: "tentar_depois",
      motivo: "a cobrança está temporariamente em outra operação no Mercado Pago",
      retryAfterS: 30,
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
  idsJaReivindicados: string[] = [],
): ResultadoEstorno {
  const c = comoObjeto(corpo);
  const codigo = acharCodigo(corpo);

  switch (codigo) {
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
      // P1 da revisão independente (29/09/2026): o topo da order vira
      // refunded/partially_refunded ANTES de o refund DESTA linha terminar —
      // o retorno do POST pode nascer 'processing'. Concluir exige o
      // TERMINAL do refund da linha (`processed`, STATUS_REFUND_CONCLUIDO);
      // não-terminal deixa a linha em_processamento COM o id gravado (o
      // cron/webhook esclarece pela consulta, que já é terminais-estrita).
      // Sem candidato legível do valor da linha: contrato do E14 original —
      // concluido com id vazio, quem preenche é a consulta (GET).
      const refundDaLinha = refundDaLinhaNaResposta(c, linha, idsJaReivindicados);
      if (refundDaLinha === null && respostaTemRefundDoValorDaLinha(c, linha)) {
        // B1: o refund do valor da linha está na resposta, mas já é de
        // OUTRA linha — a consulta (GET), que passa pelo índice único,
        // decide. Nunca "concluido sem id" aqui (ver a função acima).
        return {
          tipo: "tentar_depois",
          motivo: "o Mercado Pago devolveu um reembolso que já está registrado em outra devolução deste pedido — vou conferir pela consulta",
        };
      }
      if (
        refundDaLinha !== null &&
        String(refundDaLinha.status ?? "") !== STATUS_REFUND_CONCLUIDO
      ) {
        return {
          tipo: "em_processamento",
          mp_refund_id: idComoString(refundDaLinha.id),
          // Status do REFUND da linha (ex. 'processing'), não do topo da
          // order — rotular linha pendente com 'refunded' parecia terminal
          // (achado BAIXA da revisão, 29/09; campo só para diagnóstico/T6).
          mp_status: String(refundDaLinha.status ?? ""),
        };
      }
      return {
        tipo: "concluido",
        // Id do REFUND (transactions.refunds[].id), nunca o id do topo da
        // order — ver refundDaLinhaNaResposta acima (E14b/E14c, 29/09/2026).
        mp_refund_id: refundDaLinha !== null
          ? idComoString(refundDaLinha.id)
          : "",
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

  // 423 resource_locked — mesmo tratamento do interpretarPayments: lock
  // transitório, POST idempotente pela chave da linha, repetir é seguro
  // (achado MÉDIO da revisão de 29/09; antes virava 'falhou' definitivo).
  if (status === 423) {
    return {
      tipo: "tentar_depois",
      motivo: "a cobrança está temporariamente em outra operação no Mercado Pago",
      retryAfterS: 30,
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
  // Lote A (A6): ids que OUTRAS linhas do pedido já têm — ver
  // `refundDaLinhaNaResposta`. Opcional: sem a lista, o contrato de antes.
  idsJaReivindicados: string[] = [],
): ResultadoEstorno {
  // Código NOMEADO tem prioridade sobre o status HTTP (mesma regra de
  // `interpretarOrders`), nas duas APIs: dinheiro em movimento continua
  // `em_processamento`; "nada saiu" (lista fechada) fica para a próxima tentativa
  // com a mesma chave. Texto leigo e neutro — ver `MOTIVO_AINDA_NAO_LIBERADA`.
  if (status >= 400) {
    const codigos = acharCodigos(corpo);
    const classe = classificarCodigosDoMp(codigos);
    if (classe === "em_andamento") {
      return {
        tipo: "em_processamento",
        mp_refund_id: null,
        mp_status: codigos.find((c) => CODIGOS_EM_ANDAMENTO.has(c)) ?? "",
      };
    }
    if (classe === "nada_saiu") {
      return { tipo: "tentar_depois", motivo: MOTIVO_AINDA_NAO_LIBERADA };
    }
  }
  if (idEhClassico(pedido.gateway_payment_id)) {
    return interpretarPayments(status, corpo, linha);
  }
  return interpretarOrders(status, corpo, linha, idsJaReivindicados);
}

/** Os códigos cujo veredito final depende de uma CONSULTA (GET). */
const CODIGOS_QUE_EXIGEM_CONFIRMACAO = new Set([
  "4296",
  "order_already_refunded",
  "idempotency_key_already_used",
]);

/**
 * EXPORTADA (item 4 do brief P0 de 08/09/2026): a T5 (webhook) precisa listar
 * os refunds `processed` NÃO reivindicados do pedido para registrar estorno
 * feito fora do app — sem reimplementar a travessia de `transactions[]`.
 */
export function refundsDaOrder(
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

/**
 * D1 (laudo BLOQUEIA-1, rodada 2 do PR #440): o terminal de SUCESSO de um
 * refund da Orders API é `"processed"` — o mesmo valor que
 * `STATUS_DE_PAGAMENTO_APROVADO` usa para pagamento aprovado. O exemplo
 * oficial do endpoint de refund da Orders API traz um refund com `"status":
 * "processing"`: sem este filtro, `somarRefundsDaOrder` somava QUALQUER
 * status (`processing`, `rejected`, `cancelled`) como se já tivesse saído —
 * o cenário do BLOQUEIA-1 (cliente sem o dinheiro, `payment_status` vira
 * `estornado` mesmo assim). Falha fechada: a lista exata de status
 * terminais é trabalho da T8 (sandbox); até lá, qualquer coisa que não seja
 * `"processed"` (inclusive status ausente ou ilegível) não conta — na
 * dúvida, "ainda não".
 */
const STATUS_REFUND_CONCLUIDO = "processed";

function somarRefundsDaOrder(order: Record<string, unknown>): number | null {
  const refunds = refundsDaOrder(order).filter(
    (r) => r.status === STATUS_REFUND_CONCLUIDO,
  );
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
 * Terminal de sucesso de um refund INDIVIDUAL da Payments API clássica
 * (`corpo.refunds[].status`) — item 3 do brief P0 (08/09/2026, pré-requisito
 * da T5/T6). A Payments de cartão está DESLIGADA hoje (Restrição Global veda
 * `fetch` real em teste): esta grafia NUNCA foi medida contra a API real —
 * a T8 (sandbox) decide se troca.
 */
const STATUS_REFUND_APROVADO_PAYMENTS = "approved";

/**
 * M-A do laudo (PR #438 rodada 2): a lista de refunds é do PEDIDO inteiro —
 * pode haver mais de um refund com o MESMO valor (duas linhas do mesmo
 * pedido, ou uma repetição). Correção: desempata pelo `date_created` mais
 * RECENTE entre os candidatos com o mesmo valor.
 *
 * D1/achado 1 (laudo rodada 2 do PR #440, 08/09/2026): candidato tem de ter
 * o status TERMINAL exigido (`processed` nas Orders, `approved` nas
 * Payments) — nunca "qualquer um do mesmo valor". A versão anterior
 * preferia `processed` mas caía para "qualquer status" quando nenhum
 * processado batia o valor; essa fuga é exatamente o bug do achado 1 (um
 * refund `processing`/`rejected` de OUTRA linha podia emprestar o id). Sem
 * candidato do status terminal e do valor exato → `null`: a linha NÃO
 * conclui, nunca um id emprestado.
 *
 * `idsJaReivindicados` exclui os refunds que OUTRAS linhas de
 * `order_refunds` do mesmo pedido já gravaram como seu `mp_refund_id` — o
 * mesmo refund não credita duas linhas.
 */
function refundQueCobreALinha(
  refunds: Array<Record<string, unknown>>,
  linha: LinhaEstorno,
  statusTerminal: string,
  idsJaReivindicados: string[],
): Record<string, unknown> | null {
  const centavosDaLinha = emCentavos(linha.amount);
  const reivindicados = new Set(idsJaReivindicados);
  const candidatos = refunds.filter((r) => {
    if (r.status !== statusTerminal) return false;
    const valor = Number(r.amount);
    if (!Number.isFinite(valor) || emCentavos(valor) !== centavosDaLinha) {
      return false;
    }
    if (r.id === undefined || r.id === null) return false;
    return !reivindicados.has(idComoString(r.id));
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
  return melhor;
}

/**
 * Motivos definitivos ("falhou"), nomeados e exportados (ANOTADO do laudo
 * #447 rodada 2, resolvido na rodada 3, 08/09/2026): usados nos DOIS ramos
 * de `decidirConclusaoPelaConsulta` — o texto mora só aqui e no docstring da
 * função; cada ramo apenas cita o nome da constante (antes, o mesmo
 * comentário do AC-2 aparecia três vezes).
 */
export const MOTIVO_NAO_COBRE =
  "a cobrança já foi devolvida no Mercado Pago, mas o valor confirmado não cobre esta devolução";
export const MOTIVO_DEVOLVIDO_POR_FORA_EM_PARCELAS =
  "o Mercado Pago informa que este valor já foi devolvido por fora do app, em parcelas diferentes desta devolução; ela não é mais necessária";
/**
 * AC2-a (laudo #447 rodada 2, resolvido na rodada 3): quando a soma LIVRE
 * (já sem o que outras linhas do MESMO pedido reivindicaram) NÃO cobre esta
 * linha e existe pelo menos uma outra linha com `mp_refund_id` já gravado —
 * cenário G2 do laudo — a insuficiência não prova falha nenhuma: pode ser o
 * refund PRÓPRIO desta linha ainda em andamento (status não-terminal, ex.
 * `processing`/`in_process`). O app não sabe a origem; texto conservador,
 * sem afirmar nem dispensar (nunca "não cobre", que soaria mais definitivo
 * do que a evidência sustenta).
 */
export const MOTIVO_NAO_COBRE_CONSERVADOR =
  "não cobre esta devolução; confira no painel do MP";

/**
 * Soma dos refunds do status TERMINAL informado, excluindo os que OUTRAS
 * linhas já reivindicaram (`idsJaReivindicados`) — é esta soma, nunca a
 * soma bruta (`somarRefundsDaOrder`, que mistura o dinheiro de TODAS as
 * linhas do pedido), que prova saída de caixa PARA ESTA linha (AC2-a).
 * `null` só quando nenhum refund do status terminal aparece (C3: "não
 * sei"); soma livre ZERO é resultado válido — todo terminal já reivindicado
 * por outra linha é exatamente o cenário G2.
 */
function somarLivres(
  refunds: Array<Record<string, unknown>>,
  statusTerminal: string,
  idsJaReivindicados: string[],
): number | null {
  const terminais = refunds.filter((r) => r.status === statusTerminal);
  if (terminais.length === 0) return null;
  const reivindicados = new Set(idsJaReivindicados);
  let soma = 0;
  for (const r of terminais) {
    if (
      r.id !== undefined && r.id !== null &&
      reivindicados.has(idComoString(r.id))
    ) {
      continue;
    }
    const v = Number(r.amount);
    if (!Number.isFinite(v)) return null;
    soma += v;
  }
  return soma;
}

/**
 * O motivo quando NENHUM refund bate o valor exato desta linha (`candidato
 * === null`) — AC2-a. Com ids já reivindicados por outras linhas, SEMPRE o
 * texto conservador (`MOTIVO_NAO_COBRE_CONSERVADOR`, ver seu docstring:
 * G1/G2); sem eles, a soma LIVRE decide entre "já saiu por fora"
 * (`MOTIVO_DEVOLVIDO_POR_FORA_EM_PARCELAS`) e "ainda não cobre"
 * (`MOTIVO_NAO_COBRE`) — exatamente o que V1/E41 já prova.
 */
function motivoSemCandidato(
  idsJaReivindicados: string[],
  somaLivre: number | null,
  centavosDaLinha: number,
  temPreVeredito: boolean,
): ResultadoEstorno {
  const somaLivreCobre = somaLivre !== null &&
    emCentavos(somaLivre) >= centavosDaLinha;
  if (somaLivreCobre) {
    // A soma LIVRE (já sem o que outras linhas reivindicaram) cobre o que
    // ESTA linha precisa — confiança de que o dinheiro saiu por fora do
    // app, mesmo havendo outras linhas no pedido (o que sobrou já
    // descontou o delas).
    return insuficiente(temPreVeredito, MOTIVO_DEVOLVIDO_POR_FORA_EM_PARCELAS);
  }
  if (idsJaReivindicados.length > 0) {
    // Soma livre NÃO cobre e existem outras linhas com id já gravado
    // (G2): a insuficiência pode ser só o refund PRÓPRIO ainda em
    // andamento — texto conservador, nunca "não cobre".
    return insuficiente(temPreVeredito, MOTIVO_NAO_COBRE_CONSERVADOR);
  }
  return insuficiente(temPreVeredito, MOTIVO_NAO_COBRE);
}

/**
 * Decisão pura sobre o corpo JÁ consultado (GET) — sem I/O. EXPORTADA (item 4
 * do brief P0, 08/09/2026): a T5 (webhook) reutiliza esta função sobre o
 * objeto que ELA já buscou, sem um segundo GET — uma decisão, dois
 * chamadores, o mesmo princípio do I1 do laudo do #438.
 *
 * INVARIANTE (achado 1, laudo rodada 2 do PR #440, 08/09/2026): um refund do
 * MP credita UMA linha do ledger, e é a linha do MESMO valor que ainda não o
 * reivindicou — nunca "qualquer refund processed/approved do pedido". Com
 * duas linhas pendentes no mesmo pedido, a versão antiga (soma acumulada sem
 * amarrar o id ao valor da linha) dava uma por devolvida com o dinheiro da
 * outra (experimento do laudo: ledger 10 contra 30 num pedido de R$30).
 *
 * Rota Orders — conclui SE E SOMENTE SE (a) existe refund `processed` do
 * MESMO valor desta linha, ainda não reivindicado (`refundQueCobreALinha`);
 * (b) a soma BRUTA dos `processed` continua cobrindo `valor_estornado +
 * linha.amount` (guarda contra ledger que diz mais do que o MP mostra —
 * contradição não conclui, E37). Faltando qualquer uma → `insuficiente`.
 * Nenhum refund `processed` aparece ainda → `tentar_depois` incondicional
 * (C3: "não sei" nunca é prova de falha).
 *
 * AC2-a (rodada 3, resolve o achado da rodada 2): quando (a) não achou
 * candidato, a soma que decide o motivo NÃO é mais a soma bruta comparada
 * com `valor_estornado + linha.amount` (isso mistura o dinheiro de TODAS as
 * linhas do pedido) — é a soma LIVRE (`somarLivres`, exclui
 * `idsJaReivindicados`) comparada só com `linha.amount`, o que ESTA linha
 * precisa (ver `motivoSemCandidato`). Soma livre cobrindo é "por fora em
 * parcelas" (mesmo havendo outras linhas — o que sobrou já descontou o
 * delas); soma livre NÃO cobrindo com ids já reivindicados por outra linha
 * (G2) é o texto conservador, nunca "não cobre" (a insuficiência pode ser
 * só o refund PRÓPRIO ainda em andamento); sem ids reivindicados, "não
 * cobre" continua o texto — igual à rodada 2. Quem registra as parcelas
 * reais no ledger é o webhook (T5, linhas `sistema`); `falhou` aqui libera
 * o saldo reservado sem gerar um POST novo. Mesma distinção no ramo
 * Payments com `refunds[]`.
 *
 * Rota Payments — se o corpo trouxer `refunds[]` com objetos, MESMA regra
 * por refund, terminal `approved`; sem `refunds[]` materializado (ausente ou
 * vazio), FALLBACK até a T8: acumulado clássico
 * (`transaction_amount_refunded`), `mp_refund_id` sempre `null` (nunca o id
 * do pagamento — M-A). O fallback NUNCA discrimina por linha (AC-4) — é a
 * única saída possível sem a lista de refunds, e nunca foi medido contra a
 * API real.
 *
 * ALTERNATIVA B DO I-A (laudo do PR #438 rodada 2): `temPreVeredito` decide
 * o desfecho de "não cobre" — com pré-veredito definitivo do MP
 * (4296/`order_already_refunded`) é `falhou`; sem ele (caminho direto que a
 * T4 usa para `em_processamento`) é `tentar_depois`.
 */
export function decidirConclusaoPelaConsulta(args: {
  corpo: Record<string, unknown>;
  ehPayments: boolean;
  linha: LinhaEstorno;
  pedido: PedidoParaEstorno;
  idsJaReivindicados?: string[];
  temPreVeredito: boolean;
}): ResultadoEstorno {
  const { corpo, ehPayments, linha, pedido, temPreVeredito } = args;
  const idsJaReivindicados = args.idsJaReivindicados ?? [];
  const precisoEmCentavos = emCentavos(pedido.valor_estornado) +
    emCentavos(linha.amount);
  const centavosDaLinha = emCentavos(linha.amount);

  if (ehPayments) {
    // C3: campo presente e legível decide; AUSENTE ou EM BRANCO é "não sei"
    // → depois. `Number(null)` seria 0 (falso "nada devolvido") e
    // `Number("")` também é 0 (ANOTADO do laudo #447 rodada 2) — por isso a
    // checagem de tipo E de conteúdo em branco ANTES da conversão.
    const bruto = corpo.transaction_amount_refunded;
    const devolvido = typeof bruto === "number"
      ? bruto
      : typeof bruto === "string" && bruto.trim() !== ""
      ? Number(bruto)
      : NaN;

    const refundsBrutos = Array.isArray(corpo.refunds)
      ? corpo.refunds.filter((r) => r && typeof r === "object") as Array<
        Record<string, unknown>
      >
      : [];

    if (refundsBrutos.length > 0) {
      const candidato = refundQueCobreALinha(
        refundsBrutos,
        linha,
        STATUS_REFUND_APROVADO_PAYMENTS,
        idsJaReivindicados,
      );
      // AC-1 (laudo #447 rodada 2): campo ausente/ilegível é "não sei" —
      // NUNCA prova de falha, mesmo com um candidato do valor exato já
      // achado (AC1-a, rodada 3: testado também com candidato AUSENTE).
      if (!Number.isFinite(devolvido)) {
        return {
          tipo: "tentar_depois",
          motivo: "não consegui confirmar o estorno com o Mercado Pago agora",
        };
      }
      if (candidato === null) {
        // AC2-a (docstring acima): soma LIVRE de refundsBrutos.
        return motivoSemCandidato(
          idsJaReivindicados,
          somarLivres(
            refundsBrutos,
            STATUS_REFUND_APROVADO_PAYMENTS,
            idsJaReivindicados,
          ),
          centavosDaLinha,
          temPreVeredito,
        );
      }
      // Guarda (b), AC2-b: o acumulado do MP ainda não cobre — contradição
      // não conclui, mesmo com candidato do valor certo (gêmeo do E37).
      if (emCentavos(devolvido) < precisoEmCentavos) {
        return insuficiente(temPreVeredito, MOTIVO_NAO_COBRE);
      }
      return {
        tipo: "concluido",
        mp_refund_id: idComoString(candidato.id),
        mp_status: idComoString(corpo.status),
        mp_status_detail: detailOuNull(corpo),
        valor: linha.amount,
      };
    }

    // FALLBACK até a T8 (item 3 do brief): sem `refunds[]` materializado
    // (ausente ou vazio), acumulado clássico (C1/I2 do laudo do #438) —
    // `mp_refund_id` sempre `null`, nunca o id do pagamento (M-A).
    if (!Number.isFinite(devolvido)) {
      return {
        tipo: "tentar_depois",
        motivo: "não consegui confirmar o estorno com o Mercado Pago agora",
      };
    }
    if (emCentavos(devolvido) >= precisoEmCentavos) {
      return {
        tipo: "concluido",
        mp_refund_id: null,
        mp_status: idComoString(corpo.status),
        mp_status_detail: detailOuNull(corpo),
        valor: linha.amount,
      };
    }
    return insuficiente(temPreVeredito, MOTIVO_NAO_COBRE);
  }

  // Rota Orders — achado 1 do laudo do PR #440 (pré-requisito da T5/T6).
  const soma = somarRefundsDaOrder(corpo);
  if (soma === null) {
    // C3: order `refunded` sem NENHUM refund `processed` materializado
    // (consistência eventual do MP) não é prova de NADA — "não sei" vira
    // depois, não falhou, independente de pré-veredito.
    return {
      tipo: "tentar_depois",
      motivo: "não consegui confirmar o estorno com o Mercado Pago agora",
    };
  }
  const refundsProcessed = refundsDaOrder(corpo).filter(
    (r) => r.status === STATUS_REFUND_CONCLUIDO,
  );
  const candidato = refundQueCobreALinha(
    refundsProcessed,
    linha,
    STATUS_REFUND_CONCLUIDO,
    idsJaReivindicados,
  );
  if (candidato === null) {
    // AC2-a (docstring acima): soma LIVRE dos refunds processed.
    return motivoSemCandidato(
      idsJaReivindicados,
      somarLivres(refundsProcessed, STATUS_REFUND_CONCLUIDO, idsJaReivindicados),
      centavosDaLinha,
      temPreVeredito,
    );
  }
  // Guarda (b, E37): o ledger diz mais do que a SOMA BRUTA dos processed
  // mostra — contradição não conclui, mesmo com candidato do valor certo.
  if (emCentavos(soma) < precisoEmCentavos) {
    return insuficiente(temPreVeredito, MOTIVO_NAO_COBRE);
  }
  return {
    tipo: "concluido",
    mp_refund_id: idComoString(candidato.id),
    mp_status: idComoString(corpo.status),
    mp_status_detail: detailOuNull(corpo),
    valor: linha.amount,
  };
}

/**
 * O GET que decide os casos "já feito": o MP disse 4296 /
 * order_already_refunded / idempotency_key_already_used e só a consulta do
 * objeto prova se o valor desta linha está coberto. Faz o GET e delega a
 * decisão pura a `decidirConclusaoPelaConsulta` — uma decisão, dois
 * chamadores (item 4 do brief P0).
 *
 * EXPORTADA (I1 do laudo, PR #438): a T4 (cron) chama esta função DIRETO
 * para linhas `em_processamento` — conclui SEM POST. Uma decisão, dois
 * chamadores; reimplementá-la lá seria o segundo produtor de `concluido`
 * que esta frente existe para não ter.
 *
 * `idsJaReivindicados` (item 1 do brief P0, 08/09/2026): os `mp_refund_id`
 * das OUTRAS linhas de `order_refunds` do mesmo pedido que já têm id
 * gravado — quem chama lê do banco e passa; esta função é pura quanto a
 * banco (só o GET ao MP).
 *
 * INVARIANTE I-B (laudo do PR #438 rodada 2): `pedido.valor_estornado` tem
 * de ser lido FRESCO, imediatamente antes desta chamada; snapshot velho
 * conclui sem dinheiro sair. Quem chama por item, dentro de um laço (T4),
 * releia o pedido a cada iteração — nunca um SELECT único antes do laço.
 */
export async function confirmarPorConsulta(args: {
  buscar: typeof fetch;
  token: string;
  linha: LinhaEstorno;
  pedido: PedidoParaEstorno;
  codigo?: string;
  idsJaReivindicados?: string[];
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
    // R9: só o NOME do erro — a mensagem do erro de parse do V8 cola o começo
    // do corpo (`Unexpected token 'J', "Josefina A"...`), que é do pagador.
    console.error("estorno: confirmação com corpo ilegível", nomeDoErro(err));
    return {
      tipo: "tentar_depois",
      motivo: "resposta ilegível ao confirmar o estorno",
    };
  }

  return decidirConclusaoPelaConsulta({
    corpo,
    ehPayments,
    linha,
    pedido,
    idsJaReivindicados: args.idsJaReivindicados,
    temPreVeredito,
  });
}

/**
 * A resposta da consulta "o MP já devolveu este dinheiro?" — TRÊS respostas, e
 * só as duas primeiras chegam ao banco (`reemitir_reembolso_da_devolucao`).
 * `indeterminado` NUNCA vira `nao_achou`: quem não sabe não cria chave nova.
 */
export type ConsultaDoReembolso =
  | { resultado: "achou"; mp_refund_id: string; mp_status: "processed" | "approved"; valor: number }
  | { resultado: "nao_achou" }
  | { resultado: "indeterminado"; motivo: string };

/** Status de refund que provam que o refund MORREU (nada saiu por ele). Só estes. */
const STATUS_REFUND_MORTO = new Set(["rejected", "cancelled", "canceled", "failed"]);

/**
 * D2 (14/10/2026): consulta o MP (GET, nunca POST) e responde se existe um
 * reembolso do VALOR desta linha que nenhuma outra linha do pedido reivindicou.
 *   * `achou` — exatamente um candidato terminal (`processed`/`approved`) do
 *     valor, de ninguém, e NENHUM outro reembolso sem explicação;
 *   * `nao_achou` — SÓ com GET 200 de corpo legível que parece uma cobrança paga
 *     e nenhum reembolso vivo sem dono (os mortos e os que o ledger já
 *     reivindicou não contam);
 *   * `indeterminado` — todo o resto: GET falhou, rede, corpo ilegível, forma
 *     estranha, reembolso em andamento, reembolso de outro valor (a devolução
 *     do painel em parcelas: o dinheiro saiu e ninguém o explica).
 * `idsJaReivindicados` = `mp_refund_id` das OUTRAS linhas do pedido.
 */
export async function consultarReembolsoDoPedido(args: {
  buscar: typeof fetch;
  token: string;
  pedido: PedidoParaEstorno;
  valor: number;
  idsJaReivindicados: string[];
}): Promise<ConsultaDoReembolso> {
  const { buscar, token, pedido } = args;
  const indeterminado = (motivo: string): ConsultaDoReembolso => ({ resultado: "indeterminado", motivo });
  const ehPayments = idEhClassico(pedido.gateway_payment_id);
  const url = `${BASE_URL_PADRAO}/v1/${ehPayments ? "payments" : "orders"}/${pedido.gateway_payment_id}`;

  let corpo: Record<string, unknown>;
  try {
    const resposta = await buscar(url, { method: "GET", headers: { Authorization: `Bearer ${token}` } });
    if (resposta.status !== 200) {
      console.error("estorno: consulta do reembolso recusada", resposta.status);
      return indeterminado("o Mercado Pago não respondeu a consulta");
    }
    const bruto: unknown = await resposta.json();
    if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return indeterminado("resposta ilegível");
    corpo = bruto as Record<string, unknown>;
  } catch (err) {
    console.error("estorno: consulta do reembolso falhou", nomeDoErro(err));
    return indeterminado("falha ao consultar o Mercado Pago");
  }

  const centavosDaLinha = emCentavos(args.valor);
  const reivindicados = new Set(args.idsJaReivindicados);
  let refunds: Array<Record<string, unknown>>;
  let statusTerminal: string;
  if (ehPayments) {
    statusTerminal = STATUS_REFUND_APROVADO_PAYMENTS;
    refunds = Array.isArray(corpo.refunds)
      ? corpo.refunds.filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
      : [];
    // O acumulado do MP tem de bater com a soma dos aprovados que a lista mostra:
    // senão há dinheiro fora da lista (ou a lista é incompleta) e não se sabe.
    const acumulado = numeroFinito(corpo.transaction_amount_refunded);
    const visiveis = refunds
      .filter((r) => r.status === statusTerminal)
      .reduce((soma, r) => soma + emCentavos(Number(r.amount)), 0);
    if (acumulado === null || !Number.isFinite(visiveis) || emCentavos(acumulado) !== visiveis) {
      return indeterminado("o total devolvido não bate com a lista de reembolsos");
    }
  } else {
    statusTerminal = STATUS_REFUND_CONCLUIDO;
    const pagamentos = comoObjeto(corpo.transactions).payments;
    if (!Array.isArray(pagamentos) || pagamentos.length === 0) {
      return indeterminado("a cobrança não parece uma cobrança paga");
    }
    refunds = refundsDaOrder(corpo);
    const dizReembolsada = corpo.status === "refunded" || corpo.status_detail === "partially_refunded";
    if (dizReembolsada && !refunds.some((r) => r.status === statusTerminal)) {
      return indeterminado("a cobrança consta como devolvida, mas nenhum reembolso aparece");
    }
  }

  // O que NINGUÉM explica: reembolso vivo que nenhuma linha do pedido reivindicou.
  const semDono = refunds.filter((r) => {
    const id = idComoString(r.id);
    return !(id !== "" && reivindicados.has(id)) && !STATUS_REFUND_MORTO.has(String(r.status ?? ""));
  });
  const candidato = refundQueCobreALinha(semDono, { amount: args.valor } as LinhaEstorno, statusTerminal, []);
  const inexplicados = semDono.filter((r) => {
    const doValor = r.status === statusTerminal && emCentavos(Number(r.amount)) === centavosDaLinha &&
      r.id !== undefined && r.id !== null;
    return !doValor;
  });
  if (inexplicados.length > 0) return indeterminado("há reembolso do pedido que não é desta devolução");
  if (!candidato) return { resultado: "nao_achou" };
  return {
    resultado: "achou",
    mp_refund_id: idComoString(candidato.id),
    mp_status: ehPayments ? "approved" : "processed",
    valor: args.valor,
  };
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
  // N1 (3ª/4ª revisão de risco, 26/09/2026): a order consultada aqui pode
  // ser de CARTÃO (payer com e-mail e CPF do titular) — `corpoNoLog: false`
  // troca o corpo cru por um resumo sem dado pessoal no log de erro, mesma
  // proteção que os outros pontos do cartão já usam.
  const resultado = await consultarOrder({
    token: args.token,
    orderId: args.orderId,
    fetchImpl: args.buscar,
    corpoNoLog: false,
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
  idsJaReivindicados?: string[];
  /** Ver `AutorizacaoDoPost`. Ausente = nenhum POST (falha fechada). */
  autorizarAntesDoPost?: (linha: LinhaEstorno) => Promise<AutorizacaoDoPost>;
}): Promise<ResultadoEstorno> {
  const { linha, pedido, token } = args;
  const buscar: typeof fetch = args.buscar ??
    ((input: RequestInfo | URL, init?: RequestInit) =>
      fetchComTempo(fetch, typeof input === "string" ? input : String(input), init));

  const guarda = guardaAntesDeChamar(linha, pedido, new Date());
  if (!guarda.ok) {
    // Linha INCERTA (ver `linhaPodeJaTerChegadoAoMp`): a guarda sobre o
    // retrato NUNCA a termina. `recusado` libera a reserva, e um POST
    // anterior desta linha pode ter chegado ao MP — saldo insuficiente aqui
    // é exatamente o caso em que outra devolução entrou depois dele. Nada é
    // enviado; a reserva fica até a consulta ao MP (o caminho que já existe
    // no cron) achar o refund (conclui) ou o MP dar veredito negativo. Vale
    // para toda recusa da guarda: pedido já 'estornado' é saldo zero por
    // outro nome, e o prazo de 180 dias não apaga um POST que já saiu.
    if (linhaPodeJaTerChegadoAoMp(linha)) {
      console.error(
        "estorno: a guarda recusaria uma linha que pode já ter chegado ao MP — nada enviado, reserva preservada",
        linha.id,
        guarda.motivo,
      );
      return { tipo: "tentar_depois", motivo: `${guarda.motivo}; ${MOTIVO_LINHA_INCERTA}` };
    }
    return { tipo: "recusado", motivo: guarda.motivo };
  }

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

  // A AUTORIZAÇÃO, por último antes do POST — DEPOIS do GET da transação
  // (é durante ele que o saldo pode mudar). Ver `AutorizacaoDoPost`.
  if (!args.autorizarAntesDoPost) {
    console.error("estorno: executor chamado sem autorizarAntesDoPost — nenhum POST", linha.id);
    return {
      tipo: "tentar_depois",
      motivo: "não consegui reconferir o saldo do pedido antes de devolver",
    };
  }
  let autorizacao: AutorizacaoDoPost;
  try {
    autorizacao = await args.autorizarAntesDoPost(linha);
  } catch (err) {
    console.error("estorno: a autorização antes do POST lançou", nomeDoErro(err));
    autorizacao = { decisao: "indisponivel" };
  }
  if (autorizacao.decisao === "nao_cabe") {
    if (!linhaPodeJaTerChegadoAoMp(linha)) {
      // R1: nenhum POST desta linha saiu (nem carimbo, nem id do MP, nem
      // legado com marca anterior) — recusar é seguro e libera a reserva. A
      // escrita terminal dos chamadores exige post_autorizado_em IS NULL: se
      // outro executor autorizou no meio, 0 linhas e nada é sobrescrito.
      console.error(
        "estorno: o saldo relido não cobre mais este POST e a linha nunca teve POST — recusada",
        linha.id,
        linha.amount,
        autorizacao.disponivel,
      );
      return { tipo: "recusado", motivo: MOTIVO_SALDO_NAO_COBRE_MAIS };
    }
    console.error(
      "estorno: o saldo relido não cobre mais este POST — nada enviado, linha incerta preservada em_processamento",
      linha.id,
      linha.amount,
      autorizacao.disponivel,
    );
    return { tipo: "tentar_depois", motivo: `${MOTIVO_SALDO_MUDOU_ANTES_DO_POST}; ${MOTIVO_LINHA_INCERTA}` };
  }
  if (autorizacao.decisao === "linha_mudou") {
    return {
      tipo: "tentar_depois",
      motivo: "a devolução mudou de estado enquanto era preparada — nada foi enviado",
    };
  }
  if (autorizacao.decisao !== "autorizado") {
    return {
      tipo: "tentar_depois",
      motivo: "não consegui reconferir o saldo do pedido antes de devolver",
    };
  }
  const pedidoRelido = autorizacao.pedido;
  const guardaRelida = guardaAntesDeChamar(linha, pedidoRelido, new Date());
  if (!guardaRelida.ok) {
    // O pedido RELIDO já não aceita este POST (estornado por outro caminho,
    // saldo menor). Nunca terminal no último instante — ver AutorizacaoDoPost.
    console.error(
      "estorno: a guarda sobre o pedido relido recusou — nada enviado, linha preservada em_processamento",
      linha.id,
      guardaRelida.motivo,
    );
    return { tipo: "tentar_depois", motivo: MOTIVO_SALDO_MUDOU_ANTES_DO_POST };
  }

  const req = montarRequisicao(linha, pedidoRelido, transacaoDaOrder ?? undefined);
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
      // Pode ter saído e a resposta se perdido: INCERTO (nunca "nada saiu").
      diagnostico: { mpCodigo: null, postIncerto: true, transitorio: false },
    };
  }

  let corpo: unknown = null;
  try {
    corpo = await resposta.json();
  } catch (err) {
    console.error("estorno: resposta com corpo ilegível", resposta.status, nomeDoErro(err));
    corpo = null;
  }
  if (!resposta.ok) {
    // M2: o erro do MP vai para o log da função (padrão da casa), nunca para
    // o texto do lojista — e sem ele o POST reprovado some. R9 (Lote A,
    // 04/10/2026): só o RESUMO (status, códigos, caminho do campo) — o corpo
    // cru traz o pagador (e-mail, CPF, nome) e a frase da recusa ecoa o
    // valor. A decisão (`interpretarResposta`, abaixo) continua lendo o corpo
    // inteiro: a idempotência e o veredito não mudam.
    console.error(
      "estorno: mercado pago recusou o POST",
      resposta.status,
      resumoSemDadoPessoal(corpo),
    );
  }

  // O pedido RELIDO na autorização (B1, de passagem): é o mesmo POST que
  // acabou de sair com ele.
  let resultado = interpretarResposta(
    resposta.status,
    corpo,
    linha,
    pedidoRelido,
    args.idsJaReivindicados ?? [],
  );

  // O Retry-After mora no header da resposta, que o interpretar (puro) não
  // vê: o executor enriquece o `tentar_depois` do 429 com o prazo (E13).
  if (resultado.tipo === "tentar_depois" && resposta.status === 429) {
    const bruto = resposta.headers?.get?.("Retry-After");
    const segundos = bruto === null ? NaN : Number(bruto);
    if (Number.isFinite(segundos) && segundos > 0) {
      resultado = { ...resultado, retryAfterS: segundos };
    }
  }

  const diagnostico = diagnosticoDoPost(resposta.status, resposta.ok, corpo, resultado);
  if (
    resultado.tipo === "falhou" &&
    CODIGOS_QUE_EXIGEM_CONFIRMACAO.has(resultado.codigo)
  ) {
    // I1 do laudo: a MESMA decisão que a T4 chama direto (sem POST) para
    // linhas `em_processamento` — uma função, dois chamadores.
    // D5 (14/10/2026): `idempotency_key_already_used` diz que ESTA chave já
    // foi usada no MP — o refund existe ou está nascendo. Sem pré-veredito
    // (`codigo` ausente) a consulta que não fecha é `tentar_depois`, nunca
    // `falhou`: `falhou` solta o saldo reservado e a chave "usada" ficaria sem
    // dono. `order_already_refunded` continua com veredito (o MP afirmou).
    return comDiagnostico(
      await confirmarPorConsulta({
        buscar,
        token,
        linha,
        pedido: pedidoRelido,
        codigo: resultado.codigo === "idempotency_key_already_used" ? undefined : resultado.codigo,
        idsJaReivindicados: args.idsJaReivindicados,
      }),
      diagnostico,
    );
  }
  return comDiagnostico(resultado, diagnostico);
}

/**
 * O diagnóstico que o POST deixa (ver `DiagnosticoDoPost`). Resposta 2xx
 * reconhecida (`concluido`/`em_processamento`) não deixa nada. 2xx NÃO
 * reconhecida é incerta. Erro HTTP: só os códigos da lista fechada
 * `CODIGOS_NADA_SAIU` (todos eles) provam que nada saiu; todo o resto — 401/403,
 * 423, 429, 5xx, corpo ilegível, código desconhecido, "em andamento" — carimba.
 */
function diagnosticoDoPost(
  status: number,
  ok: boolean,
  corpo: unknown,
  resultado: ResultadoEstorno,
): DiagnosticoDoPost | undefined {
  const codigos = acharCodigos(corpo);
  const mpCodigo = codigos[0] ?? `http_${status}`;
  if (ok) {
    return resultado.tipo === "tentar_depois"
      ? { mpCodigo, postIncerto: true, transitorio: false }
      : undefined;
  }
  if (classificarCodigosDoMp(codigos) === "nada_saiu") {
    return { mpCodigo, postIncerto: false, transitorio: true };
  }
  return { mpCodigo, postIncerto: true, transitorio: false };
}

function comDiagnostico(
  resultado: ResultadoEstorno,
  diagnostico: DiagnosticoDoPost | undefined,
): ResultadoEstorno {
  if (!diagnostico) return resultado;
  if (
    resultado.tipo === "falhou" || resultado.tipo === "tentar_depois" ||
    resultado.tipo === "em_processamento"
  ) {
    return { ...resultado, diagnostico };
  }
  return resultado;
}
