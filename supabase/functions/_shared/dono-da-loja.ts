/**
 * O DONO DA LOJA, visto pelas edge functions (24/11/2026).
 *
 * Decisão de produto: só o DONO troca para onde o dinheiro e o e-mail da loja
 * vão — as chaves do Mercado Pago (`credenciais-mercado-pago`) e o Gmail que
 * envia os e-mails de login e recuperação (`credenciais-email`). Um
 * administrador NOMEADO cuida do dia a dia, mas, se pudesse trocar o token do
 * Mercado Pago, desviaria as vendas para a conta dele; se pudesse cadastrar o
 * próprio Gmail, receberia o link de troca de senha e o link mágico e tomaria
 * a conta do dono ou de qualquer cliente.
 *
 * A fonte é a MESMA do banco (`public.dono_da_loja`, migration 20261383):
 * no máximo UMA linha por loja, escrita só pelo postgres. A leitura aqui é com
 * a chave de serviço (a tabela concede SELECT a `service_role`).
 *
 * As três respostas possíveis de `conferirDono` (e o que cada uma faz):
 *   - "pode": o chamador é o dono, OU a loja ainda não tem dono cadastrado
 *     (tabela vazia). Sem dono não pode existir nomeado (só o dono nomeia), e
 *     recusar todo mundo trancaria a loja fora das próprias chaves: segue
 *     como era antes desta regra.
 *   - "so_o_dono": há dono e não é quem chamou.
 *   - "indisponivel": NÃO foi possível ler a tabela (erro de banco, tabela
 *     ausente porque a migration 20261383 não foi aplicada nesta loja, forma
 *     de resposta inesperada). Quem chama RECUSA: falha de leitura nunca
 *     libera — liberar por falha deixaria o nomeado trocar a chave sempre que
 *     o banco engasgasse.
 *
 * Quem usa: `credenciais-email` e `credenciais-mercado-pago`, só nas ações que
 * MUDAM o destino. Não duplique esta regra: chame-a.
 */

export type PermissaoDoDono = "pode" | "so_o_dono" | "indisponivel";

/** Costura de teste: devolve o uid do dono, `null` (tabela vazia) ou LANÇA. */
export type LeitorDoDono = () => Promise<string | null>;

/**
 * Lê o dono no banco. `null` = tabela vazia (loja sem dono cadastrado).
 * Qualquer outra coisa que não seja "zero linhas" ou "uma linha com user_id"
 * LANÇA: o chamador trata como indisponível, nunca como "sem dono".
 */
export async function lerDonoDaLoja(supabase: any): Promise<string | null> {
  const { data, error } = await supabase.from("dono_da_loja").select("user_id");
  if (error) throw new Error("dono_ilegivel");
  if (!Array.isArray(data)) throw new Error("dono_ilegivel");
  if (data.length === 0) return null;
  // A chave da tabela impede duas linhas; se aparecerem, algo está fora do
  // desenho e a única resposta segura é não decidir.
  if (data.length > 1) throw new Error("dono_ambiguo");
  const id = data[0]?.user_id;
  if (typeof id !== "string" || id.trim() === "") {
    throw new Error("dono_ilegivel");
  }
  return id;
}

/**
 * `uid` é o admin de AGORA (já confirmado por `adminAtualDaSessao`). A
 * comparação ignora caixa (uuid).
 */
export async function conferirDono(
  uid: string,
  lerDono: LeitorDoDono,
  rotulo: string,
): Promise<PermissaoDoDono> {
  let donoId: string | null;
  try {
    donoId = await lerDono();
  } catch (erro) {
    // Só o nome da falha, nunca a mensagem do banco (pode carregar a linha).
    const nome = erro instanceof Error &&
        (erro.message === "dono_ilegivel" || erro.message === "dono_ambiguo")
      ? erro.message
      : "inesperada";
    console.error(`${rotulo} não consegui ler o dono da loja (${nome})`);
    return "indisponivel";
  }
  if (donoId === null) return "pode";
  // Só `null` significa "sem dono"; qualquer outra coisa que não seja um id
  // (leitor injetado torto, `undefined`) é falha de leitura, não liberação.
  if (typeof donoId !== "string" || donoId === "") return "indisponivel";
  return donoId.toLowerCase() === uid.toLowerCase() ? "pode" : "so_o_dono";
}
