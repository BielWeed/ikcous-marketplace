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
  const err = error as { code?: string; message?: string } | null;
  if (
    err?.code === "23505" ||
    String(err?.message ?? "").includes("coupons_code_key")
  ) {
    return "Já existe um cupom com este código.";
  }
  return mensagemPadrao;
}
