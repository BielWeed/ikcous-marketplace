/**
 * Link de e-mail (recuperação de senha) que volta COM ERRO no endereço.
 *
 * Quando o link está vencido ou já foi usado (o Outlook/Hotmail costuma gastar
 * o link ao "conferir" a mensagem), o servidor de autenticação do Supabase
 * devolve a pessoa ao app com o erro no fim do endereço — no hash
 * (`#error=access_denied&error_code=otp_expired&...`) ou, em alguns caminhos,
 * na query — e o `?type=recovery` CONTINUA lá. Quem olha só o `type` abre a
 * tela "Nova Senha", que sem sessão nunca funciona.
 *
 * Este módulo só LÊ e LIMPA o endereço; a decisão do que mostrar é do
 * AuthContext/AuthView.
 */

const CHAVES_DE_ERRO = ["error", "error_code", "error_description"] as const;

function paramsDoHash(hash: string): URLSearchParams {
  return new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
}

/** O endereço traz `error_code` (no hash ou na query)? */
export function enderecoTrazErroDeLink(search: string, hash: string): boolean {
  return (
    new URLSearchParams(search).has("error_code") ||
    paramsDoHash(hash).has("error_code")
  );
}

/**
 * Endereço sem os parâmetros de erro e sem o `type` de recuperação — o que
 * `history.replaceState` deve receber depois que o aviso foi usado. Devolve
 * `caminho + query + hash`, igual ao que o resto do app passa ao replaceState.
 */
export function enderecoSemOErroDoLink(url: URL): string {
  const query = new URLSearchParams(url.search);
  query.delete("type");
  for (const chave of CHAVES_DE_ERRO) query.delete(chave);

  const hash = paramsDoHash(url.hash);
  for (const chave of CHAVES_DE_ERRO) hash.delete(chave);
  hash.delete("type");

  const q = query.toString();
  const h = hash.toString();
  return `${url.pathname}${q ? `?${q}` : ""}${h ? `#${h}` : ""}`;
}
