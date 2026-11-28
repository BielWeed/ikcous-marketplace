import { sessaoAindaEhDoDono } from "@/lib/sessao-ainda-e-do-dono";

/**
 * LISTA VAZIA DA CONTA SÓ VALE COM A SESSÃO DA DONA (caça 28/11/2026).
 *
 * A cliente volta ao app depois de horas e a renovação do token falha uns
 * segundos (rede voltando). O supabase-js 2.117 guarda essa falha por 60 s;
 * nessa janela `getSession()` devolve `session: null` com um erro de rede, SEM
 * SIGNED_OUT (o app segue mostrando a cliente logada), e as consultas saem com
 * a chave ANÔNIMA. A RLS então devolve a lista VAZIA -- que não é "a conta não
 * tem pedido/endereço/favorito".
 *
 * Quem lê uma lista da conta (pedidos, endereços, favoritos) chama isto quando
 * o banco devolveu `[]`: com a sessão ainda da dona, o vazio é a verdade; sem
 * ela (ou sem conseguir ler a sessão), lança `LeituraSemSessaoDaDona` e a
 * leitura segue o caminho de FALHA dela: a lista e a cópia do aparelho ficam
 * como estavam e nada é marcado como "lido e confirmado". Lista com itens não
 * precisa de conferência: a chave anônima não enxerga linha nenhuma da conta.
 */
export class LeituraSemSessaoDaDona extends Error {
  constructor() {
    super("A leitura voltou vazia sem a sessão da dona da conta.");
    this.name = "LeituraSemSessaoDaDona";
  }
}

export function ehLeituraSemSessaoDaDona(
  erro: unknown,
): erro is LeituraSemSessaoDaDona {
  return erro instanceof LeituraSemSessaoDaDona;
}

export async function confirmarListaVaziaDaConta(dona: string): Promise<void> {
  if (!(await sessaoAindaEhDoDono(dona))) throw new LeituraSemSessaoDaDona();
}
