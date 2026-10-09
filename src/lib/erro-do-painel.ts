/**
 * Erro amigável ÚNICO do painel.
 *
 * Tom: "o que aconteceu + o que fazer", em frase de pessoa — sem código,
 * tabela, função, "Supabase" ou "migration". O erro bruto não passa por aqui:
 * quem chama o registra no console e mostra só a frase devolvida.
 *
 * Pura: sem hook, sem Supabase, sem `import.meta.env`.
 */

/** Termos de infraestrutura que a lojista nunca deve ler. */
const JARGAO_DE_INFRA = /relation|function|supabase|migration/i;

const FRASE_NAO_ATIVADO =
  "Estes números ainda não foram ativados no banco da loja. Assim que a atualização for aplicada, eles aparecem aqui.";
const FRASE_SEM_PERMISSAO =
  "Sem permissão para ver estes números. Confirme que você entrou com a conta de administradora da loja.";
const FRASE_SEM_CONEXAO = "Sem conexão — confira a internet e tente de novo.";

function comoTexto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

/**
 * Frase que a lojista lê quando uma chamada do painel falha. Só nomeia a
 * causa quando o erro a distingue sem dúvida; o resto cai na frase genérica.
 *
 * Exceção mantida: o SQLSTATE 22023 é o que a própria RPC levanta com texto
 * em português escrito para a lojista (contrato do estorno manual em
 * `AdminOrdersView.tsx`) e passa direto — salvo se o texto vier com jargão de
 * infraestrutura, caso em que vira a frase genérica.
 */
export function mensagemDeErroDoPainel(
  erro: unknown,
  acao = "concluir",
): string {
  const sinal =
    typeof erro === "object" && erro !== null && !Array.isArray(erro)
      ? (erro as Record<string, unknown>)
      : {};
  const codigo = comoTexto(sinal.code);
  const texto = comoTexto(sinal.message);

  // PGRST202 (PostgREST) / 42883 (Postgres): a função não existe — a
  // migration deste painel ainda não foi aplicada no banco da loja.
  if (codigo === "PGRST202" || codigo === "42883") return FRASE_NAO_ATIVADO;
  if (codigo === "42501" || /permission denied/i.test(texto)) {
    return FRASE_SEM_PERMISSAO;
  }
  if (
    /failed to fetch|networkerror|fetch failed|load failed|network request failed/i.test(
      texto,
    )
  ) {
    return FRASE_SEM_CONEXAO;
  }
  if (codigo === "22023" && texto !== "" && !JARGAO_DE_INFRA.test(texto)) {
    return texto;
  }
  return `Não foi possível ${acao} agora. Tente de novo em instantes.`;
}
