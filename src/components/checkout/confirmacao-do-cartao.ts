/**
 * CONFIRMAÇÃO DO CARTÃO SEM FIM (03/10/2026, pedido do dono) — a tela
 * "Confirmando com o banco…" (depois do desafio 3DS) e a "em análise" só
 * saíam quando o CheckoutView via o pedido `pago` no BANCO (realtime +
 * verificação periódica). Nada ali pergunta ao Mercado Pago: sem webhook
 * válido (notificação de teste recusada por assinatura, webhook atrasado),
 * a decisão do banco só chegava pela reconciliação de 10 em 10 minutos — e
 * a verificação periódica do pai para no teto de 60 min, pula toda leitura
 * com a aba escondida e nem roda sem sessão. Medido num pedido de teste
 * real de 03/10/2026: o servidor já tinha soltado a vaga e expirado o
 * pedido, e a tela continuava girando.
 *
 * Agora a própria tela do cartão pergunta à edge com a CONSULTA SEM
 * COBRANÇA (`criarPagamento({ orderId, metodo: "verificar" })` — só GET no
 * Mercado Pago e a RPC de liberação por prova; NUNCA POST de cobrança nem
 * cancelamento), numa cadência curta e LIMITADA. Este arquivo é só a
 * tradução da resposta — puro, sem relógio e sem rede, para ser testado
 * campo a campo. Quem decide "pago" continua sendo o servidor: a tela nunca
 * escreve status e nunca conclui aprovação sozinha.
 */

/**
 * Esperas antes de cada consulta automática, a partir do fim do desafio (ou
 * da entrada em "em análise"). A primeira é curta (o banco costuma decidir em
 * segundos depois do 3DS); depois espaça. A soma (~2 min de consultas, fora
 * o tempo de cada uma) fica abaixo dos 3 min em que "em análise" passa a
 * oferecer o PIX. Com a aba escondida a consulta ESPERA a aba voltar (não
 * gasta tentativa): o fluxo dominante no celular é abrir o app do banco e
 * voltar.
 */
export const ESPERAS_DA_CONFIRMACAO_MS: readonly number[] = [
  3_000, 5_000, 8_000, 12_000, 15_000, 20_000, 30_000, 30_000,
];

/**
 * "Verificar de novo" depois que a cadência automática terminou: cada toque
 * abre uma rodada curta (consulta já e mais duas). No máximo
 * `RODADAS_MANUAIS_DA_CONFIRMACAO` por tentativa — o mesmo teto de toques da
 * verificação da retomada (`VerificacaoDoPagamento`).
 */
export const ESPERAS_DA_RODADA_MANUAL_MS: readonly number[] = [
  0, 10_000, 20_000,
];
export const RODADAS_MANUAIS_DA_CONFIRMACAO = 5;

/**
 * Voltar para a aba depois que a cadência parou abre uma rodada curta
 * sozinha (o cliente foi ao app do banco e voltou) — no máximo esta
 * quantidade por tentativa, e no máximo uma a cada 30 s. Somando tudo, uma
 * tentativa consulta no máximo 8 + 3 x (5 + 3) = 32 vezes, e nunca duas ao
 * mesmo tempo.
 */
export const RETOMADAS_PELA_ABA_DA_CONFIRMACAO = 3;

/**
 * Teto local de UMA consulta (a edge faz leitura + GET no MP). Estourou, a
 * consulta conta como "sem resposta" e a cadência segue — perguntar de novo
 * é seguro porque a consulta não cobra. O teto é só da TELA: a chamada não é
 * abortada, e a próxima consulta espera ela terminar (nunca duas pendentes).
 */
export const TEMPO_LIMITE_DA_CONSULTA_DO_CARTAO_MS = 35_000;

/**
 * Pagamento aprovado pelo banco, pedido ainda não confirmado no nosso
 * banco: depois disto, a tela avisa que pode levar alguns minutos (a
 * confirmação vem da criação — o POST aprovado confirma em segundo plano pela
 * prova do GET —, do webhook ou da reconciliação) e mostra "Ver meus pedidos".
 */
export const ESPERA_ANTES_DO_AVISO_DO_APROVADO_MS = 60_000;

/**
 * O que a tela faz com uma resposta.
 * - `aprovado`: o servidor disse `pago` (o banco aprovou ou o pedido já foi
 *   confirmado). Tela de aprovado, sem PIX e sem outro cartão.
 * - `em-analise`: a order existe e o banco ainda decide (`processing`).
 * - `aguardando-banco`: o desafio 3DS ainda está aberto no Mercado Pago —
 *   o banco não decidiu. Continua consultando.
 * - `encerrada`: a vaga foi solta POR PROVA (o banco recusou ou o 3DS
 *   expirou) — "não foi concluído", com outro cartão/PIX. A tela NÃO decide
 *   prazo pelo relógio do aparelho (ressalva B2 da revisão de risco: relógio
 *   adiantado transformava recusa em "prazo acabou"); se o prazo já passou,
 *   quem diz é o servidor — o 409 terminal da próxima chamada, ou a regra
 *   L1 do CheckoutView, que lê o pedido no banco.
 * - `indefinida`: a resposta não fala da tentativa desta tela (outra
 *   order na vaga, PIX na vaga, sentinela) — para de consultar sem afirmar
 *   nada.
 * - `sem-resposta`: corpo ilegível/desconhecido — conta como consulta sem
 *   resposta e a cadência segue.
 */
export type DesfechoDaConsultaDoCartao =
  | { readonly tipo: "aprovado" }
  | { readonly tipo: "em-analise"; readonly paymentId: string }
  | { readonly tipo: "aguardando-banco" }
  | { readonly tipo: "encerrada" }
  | { readonly tipo: "indefinida" }
  | { readonly tipo: "sem-resposta" };

/** O que a tela faz com um erro da consulta. */
export type DesfechoDoErroDaConsulta =
  | { readonly tipo: "terminal"; readonly mensagem: string }
  | { readonly tipo: "sem-resposta" };

function textoNaoVazio(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() !== "" ? valor.trim() : null;
}

/**
 * Traduz o 200 do `verificar`. O corpo é DESCONHECIDO — campo a campo, e
 * toda dúvida cai num desfecho que não promete nada.
 *
 * `cerca` é o token de cerca desta tentativa (o `paymentId` que o servidor
 * gravou na vaga antes de responder ao cartão), ou `null` quando a resposta
 * do cartão não trouxe um. Ele decide quando a resposta fala DESTA
 * tentativa:
 * - `encerrada` só com token: sem ele não há prova de que a
 *   vaga solta era a desta tela (mesma regra do C6 no CheckoutView);
 * - `em-analise`/`aguardando-banco` com OUTRA order na vaga (outra aba
 *   começou outra tentativa) vira `indefinida` — esta tela não fala dela.
 * `aprovado` não depende do token: pedido pago é pedido pago.
 */
export function desfechoDaConsultaDoCartao(
  resposta: unknown,
  { cerca }: { cerca: string | null },
): DesfechoDaConsultaDoCartao {
  if (typeof resposta !== "object" || resposta === null) {
    return { tipo: "sem-resposta" };
  }
  const r = resposta as Record<string, unknown>;
  const paymentId = textoNaoVazio(r.paymentId);
  const outraOrderNaVaga =
    cerca !== null && paymentId !== null && paymentId !== cerca;
  switch (r.verificacao) {
    case "pago":
      return { tipo: "aprovado" };
    case "em_analise":
      if (paymentId === null) return { tipo: "sem-resposta" };
      return outraOrderNaVaga
        ? { tipo: "indefinida" }
        : { tipo: "em-analise", paymentId };
    case "desafio3ds":
      if (paymentId === null) return { tipo: "sem-resposta" };
      return outraOrderNaVaga
        ? { tipo: "indefinida" }
        : { tipo: "aguardando-banco" };
    case "recusado":
    case "livre":
      if (cerca === null) return { tipo: "indefinida" };
      return { tipo: "encerrada" };
    case "pix":
    case "sem_registro":
      return { tipo: "indefinida" };
    default:
      return { tipo: "sem-resposta" };
  }
}

const MENSAGEM_TERMINAL_PADRAO = "Este pedido não pode ser pago agora.";

/**
 * Erro da consulta: terminal só quando fala do PEDIDO — `terminal: true`
 * literal E status 409 (não espera mais pagamento, cancelado, prazo
 * acabado) ou 404 (não encontrado; a edge responde 404 também para quem não
 * é o dono, inclusive sessão que caiu). Achado M1 da revisão de risco: a
 * edge também marca `terminal: true` no 503 "Pagamento indisponível." (sem
 * credencial do Mercado Pago agora — inclusive falha passageira de leitura
 * do cadastro), que NÃO diz nada sobre o pedido. Todo o resto — rede, 503,
 * tempo limite, status ausente — é "sem resposta": a consulta não cobra,
 * então a cadência pergunta de novo e termina, no pior caso, no estado
 * incerto explícito (nunca numa afirmação falsa).
 */
export function desfechoDoErroDaConsulta(
  erro: unknown,
): DesfechoDoErroDaConsulta {
  const e = erro as {
    terminal?: unknown;
    message?: unknown;
    httpStatus?: unknown;
  } | null;
  const falaDoPedido = e?.httpStatus === 409 || e?.httpStatus === 404;
  if (e?.terminal === true && falaDoPedido) {
    return {
      tipo: "terminal",
      mensagem: textoNaoVazio(e.message) ?? MENSAGEM_TERMINAL_PADRAO,
    };
  }
  return { tipo: "sem-resposta" };
}
