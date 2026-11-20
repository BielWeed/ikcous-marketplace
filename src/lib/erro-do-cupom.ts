import { mensagemDeErroDeSessaoDoPainel } from "@/lib/erro-de-sessao-do-painel";

export const AVISO_CODIGO_DO_CUPOM_REPETIDO =
  "Já existe um cupom com esse código.";

/**
 * Laudo 0109 (A4): a recusa de código duplicado chegava como mensagem
 * genérica ("Erro ao criar/atualizar cupom") — no cenário do A4 o lojista
 * via DOIS toasts genéricos empilhados e nenhum dizia o motivo real; trocar
 * o código para "destravar" criava um segundo cupom com o antigo vivo.
 *
 * A constraint é a `coupons_code_key` (baseline). O PostgREST devolve
 * `code: "23505"` (unique_violation) — o `message` varia entre versões e
 * proxies, o código e o nome da constraint não.
 */
export function mensagemDeErroDoCupom(
  error: unknown,
  mensagemPadrao: string,
): string {
  const erroDeSessao = mensagemDeErroDeSessaoDoPainel(error);
  if (erroDeSessao) return erroDeSessao;
  const err = error as { code?: string; message?: string } | null;
  const mensagem = String(err?.message ?? "");
  if (
    err?.code === "23505" ||
    mensagem.includes("coupons_code_key") ||
    mensagem.includes("coupons_code_upper_uidx")
  ) {
    return AVISO_CODIGO_DO_CUPOM_REPETIDO;
  }
  return mensagemPadrao;
}
