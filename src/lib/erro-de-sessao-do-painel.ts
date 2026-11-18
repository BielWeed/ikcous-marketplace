/** Mesma orientação já usada ao salvar produtos; não afirma que houve gravação. */
export const MENSAGEM_SESSAO_OU_PERMISSAO =
  "Sua sessão expirou ou você não tem permissão para salvar. Saia da conta, entre de novo e tente outra vez.";

export function mensagemDeErroDeSessaoDoPainel(error: unknown): string | null {
  const erro = error as {
    code?: unknown;
    message?: unknown;
    status?: unknown;
  } | null;
  if (
    erro?.code === "42501" ||
    erro?.code === "PGRST301" ||
    erro?.code === "PGRST303" ||
    erro?.status === 401 ||
    (typeof erro?.message === "string" && /JWT expired/i.test(erro.message))
  ) {
    return MENSAGEM_SESSAO_OU_PERMISSAO;
  }
  return null;
}
