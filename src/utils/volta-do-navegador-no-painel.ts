import type { View } from "@/types";
import { paiDaTelaDoAdmin } from "@/utils/pai-da-tela-do-admin";

/**
 * Para onde o Voltar do NAVEGADOR (evento `popstate`) leva quem está numa
 * tela do painel, quando o histórico apontaria para fora dele.
 *
 * Antes, o `App.tsx` guardava uma lista própria de sub-telas e uma cadeia
 * if/else com os pais; as duas divergiam do botão Voltar do `AdminLayout`
 * sem ninguém ver. Agora há UM pai por tela — `paiDaTelaDoAdmin` — e esta
 * função só faz a pergunta, sem origem e sem detalhe de pedido (o navegador
 * não sabe nenhum dos dois).
 *
 * Devolve `null` quando a tela é raiz de aba (ou não é do painel): não há
 * pai dentro do painel, e o navegador segue o caminho dele. O pai "profile"
 * de `paiDaTelaDoAdmin` é justamente o `default` de "não sei", não um
 * destino de verdade — por isso vira `null` aqui.
 */
export function destinoDoPopstate(view: View): View | null {
  const pai = paiDaTelaDoAdmin(view, null, false);
  return pai === "profile" ? null : pai;
}
