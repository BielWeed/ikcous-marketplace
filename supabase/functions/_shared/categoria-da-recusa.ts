/**
 * CATEGORIA da recusa do cartão (16/10/2026) — o campo `categoriaDaRecusa` que
 * `criar-pagamento` acrescenta, ao lado de `motivoRecusa`, na resposta de uma
 * recusa.
 *
 * POR QUE EXISTE. A resposta só levava a frase (`motivoRecusa`) e, para todo
 * `status_detail` que o mapa de frases (`MOTIVOS_DE_RECUSA`,
 * `_shared/mercadopago.ts`) não conhece — os da família `cc_rejected_*`, por
 * exemplo —, a frase genérica. A tela perdia a distinção que muda o que o
 * cliente faz: "confira os dados do cartão" (digitou errado), "sem limite"
 * (troque de cartão ou de forma), "o banco pediu autorização" (ligar para ele),
 * "o banco pediu confirmação" (a autenticação não terminou).
 *
 * CONTRATO. Conjunto FECHADO e opcional (o front antigo ignora o campo):
 *   - "dados_do_cartao":        bad_filled_*, invalid_card_token
 *   - "sem_limite":             insufficient_amount, card_insufficient_amount,
 *                               amount_limit_exceeded
 *   - "banco_pediu_autorizacao": required_call_for_authorize, call_for_authorize
 *   - "banco_pediu_confirmacao": 3ds_challenge_expired, 3ds_challenge,
 *                               3ds_challenge_failed
 *   - "outra":                  TODO o resto — high_risk, other_reason,
 *                               blacklist, rejected_by_issuer, card_disabled,
 *                               max_attempts_exceeded, duplicated_payment,
 *                               invalid_installments, lixo e ausente.
 * O `status_detail` aceita o prefixo `cc_rejected_` ou não (o MP manda as duas
 * formas conforme a rota). NUNCA volta o código cru nem a palavra "antifraude"
 * — recusa por risco é "outra", igual a qualquer motivo que a tela não precise
 * distinguir: dizer ao cliente que o antifraude o barrou ensina a contorná-lo.
 *
 * Funções PURAS, sem rede nem banco.
 */

export type CategoriaDaRecusa =
  | "dados_do_cartao"
  | "sem_limite"
  | "banco_pediu_autorizacao"
  | "banco_pediu_confirmacao"
  | "outra";

/** O conjunto fechado, para quem precisa listar ou validar. */
export const CATEGORIAS_DA_RECUSA: readonly CategoriaDaRecusa[] = [
  "dados_do_cartao",
  "sem_limite",
  "banco_pediu_autorizacao",
  "banco_pediu_confirmacao",
  "outra",
];

const PREFIXO_CC_REJECTED = "cc_rejected_";

// `Set`, não objeto literal indexado: o detalhe vem do MP (dado de fora) e
// indexar objeto por ele é o `security/detect-object-injection` da catraca.
const SEM_LIMITE = new Set(["insufficient_amount", "card_insufficient_amount", "amount_limit_exceeded"]);
const BANCO_PEDIU_AUTORIZACAO = new Set(["required_call_for_authorize", "call_for_authorize"]);
const BANCO_PEDIU_CONFIRMACAO = new Set(["3ds_challenge_expired", "3ds_challenge", "3ds_challenge_failed"]);
const PREFIXO_DADOS_DO_CARTAO = "bad_filled_";

/**
 * A categoria de UM `status_detail`. Qualquer coisa que não seja uma string do
 * mapa (nulo, número, objeto, vazio, desconhecido) é "outra".
 */
export function categoriaDoStatusDetail(statusDetail: unknown): CategoriaDaRecusa {
  if (typeof statusDetail !== "string") return "outra";
  // O prefixo sai UMA vez: "cc_rejected_cc_rejected_x" não é um código do MP.
  const detalhe = statusDetail.startsWith(PREFIXO_CC_REJECTED)
    ? statusDetail.slice(PREFIXO_CC_REJECTED.length)
    : statusDetail;
  if (detalhe === "invalid_card_token") return "dados_do_cartao";
  // `bad_filled_` sozinho (sem o que vem depois) não é um código do MP.
  if (detalhe.startsWith(PREFIXO_DADOS_DO_CARTAO) && detalhe.length > PREFIXO_DADOS_DO_CARTAO.length) {
    return "dados_do_cartao";
  }
  if (SEM_LIMITE.has(detalhe)) return "sem_limite";
  if (BANCO_PEDIU_AUTORIZACAO.has(detalhe)) return "banco_pediu_autorizacao";
  if (BANCO_PEDIU_CONFIRMACAO.has(detalhe)) return "banco_pediu_confirmacao";
  return "outra";
}

/** O `status_detail` genérico que a raiz repete quando o motivo está no pagamento. */
const DETALHE_GENERICO = "failed";

function detalheDecisivo(valor: unknown): string | null {
  return typeof valor === "string" && valor.length > 0 && valor !== DETALHE_GENERICO ? valor : null;
}

/**
 * A categoria de uma ORDER recusada. O motivo mora no `status_detail` do
 * PAGAMENTO (`transactions.payments[0]` — a raiz costuma dizer só "failed");
 * sem um detalhe específico ali, vale o da raiz. Um detalhe específico no
 * pagamento DECIDE, mesmo que caia em "outra": o motivo de risco nunca é
 * revertido por outro campo.
 */
export function categoriaDaRecusaDaOrder(order: unknown): CategoriaDaRecusa {
  if (!order || typeof order !== "object") return "outra";
  const o = order as Record<string, unknown>;
  const transacoes = o.transactions && typeof o.transactions === "object"
    ? o.transactions as Record<string, unknown>
    : undefined;
  const pagamentos = Array.isArray(transacoes?.payments) ? transacoes.payments as unknown[] : [];
  const primeiro = pagamentos[0] && typeof pagamentos[0] === "object"
    ? pagamentos[0] as Record<string, unknown>
    : undefined;
  const decisivo = detalheDecisivo(primeiro?.status_detail) ?? detalheDecisivo(o.status_detail);
  return categoriaDoStatusDetail(decisivo);
}

/**
 * A categoria a partir do CORPO DE ERRO de uma criação recusada (HTTP 402). A
 * order recusada vem em `data`; sem detalhe específico lá, o motivo pode vir em
 * `errors[].details[]`, no formato "<id do pagamento>: <status_detail>" (a mesma
 * leitura defensiva de `motivoDaRecusaDoErro`). O que não casar é "outra".
 */
export function categoriaDaRecusaDoErro(corpoDoErro: unknown): CategoriaDaRecusa {
  if (!corpoDoErro || typeof corpoDoErro !== "object") return "outra";
  const corpo = corpoDoErro as Record<string, unknown>;
  if (corpo.data && typeof corpo.data === "object") {
    const data = corpo.data as Record<string, unknown>;
    const pagamentos = (data.transactions as Record<string, unknown> | undefined)?.payments;
    const primeiro = Array.isArray(pagamentos) ? pagamentos[0] as Record<string, unknown> | null | undefined : undefined;
    // Detalhe específico em `data`: decide, sem olhar `errors[]`.
    if (detalheDecisivo(primeiro?.status_detail) !== null || detalheDecisivo(data.status_detail) !== null) {
      return categoriaDaRecusaDaOrder(data);
    }
  }
  const erros = Array.isArray(corpo.errors) ? corpo.errors : [];
  for (const erro of erros) {
    const detalhes = (erro as Record<string, unknown> | null)?.details;
    if (!Array.isArray(detalhes)) continue;
    for (const detalhe of detalhes) {
      if (typeof detalhe !== "string") continue;
      const sufixo = detalhe.slice(detalhe.lastIndexOf(":") + 1).trim();
      const categoria = categoriaDoStatusDetail(sufixo);
      if (categoria !== "outra") return categoria;
    }
  }
  return "outra";
}
