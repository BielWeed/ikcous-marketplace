import type { View } from "@/types";

/**
 * A memória de "de onde a pessoa veio" do `AdminLayout` — a ORIGEM que
 * `paiDaTelaDoAdmin` usa para decidir para onde o Voltar leva.
 *
 * Antes, a origem era "a tela anterior", gravada a CADA troca de tela,
 * inclusive a troca feita pelo próprio Voltar. Resultado: Avisar clientes >
 * sino > Notificações > Voltar (volta a Avisar clientes, que passa a ter
 * origem = Notificações) > Voltar (vai a Notificações, que passa a ter origem
 * = Avisar clientes) > ... um laço sem saída (achado do dono no celular,
 * 22/10/2026). O mesmo laço existia, latente, em qualquer tela que use origem
 * (Atendimento > sino > Voltar).
 *
 * Aqui a origem sai de uma TRILHA (as telas por onde a pessoa foi passando,
 * da mais antiga à atual). Regra única: se a nova tela é a ANTERIOR da trilha,
 * a pessoa VOLTOU — a atual sai da trilha, nada é gravado. Qualquer outra
 * tela é avanço e entra no fim. Isso vale igual para o botão do topo e para o
 * Voltar do celular, porque a regra olha só a troca de tela, não quem a
 * provocou — e garante que cada Voltar encolhe a trilha, então seguir a
 * origem sempre termina.
 *
 * Puras e sem estado: o `AdminLayout` guarda a trilha.
 */

/** Teto de telas lembradas — uma sessão longa não faz a trilha crescer sem fim. */
export const TAMANHO_MAXIMO_DA_TRILHA = 30;

/**
 * Trilha depois de a pessoa chegar a `novaView`. Devolve a MESMA referência
 * quando nada muda (a tela atual repetida), para quem compara não renderizar
 * à toa.
 */
export function avancarTrilha(
  trilha: readonly View[],
  novaView: View,
): readonly View[] {
  if (trilha.at(-1) === novaView) {
    return trilha;
  }
  // Voltou para a tela anterior: desfaz a entrada, não grava origem nova.
  if (trilha.at(-2) === novaView) {
    return trilha.slice(0, -1);
  }
  const maisUma = [...trilha, novaView];
  return maisUma.length > TAMANHO_MAXIMO_DA_TRILHA
    ? maisUma.slice(maisUma.length - TAMANHO_MAXIMO_DA_TRILHA)
    : maisUma;
}

/** A tela de onde a pessoa veio até a atual, ou `null` se não há. */
export function origemDaTrilha(trilha: readonly View[]): View | null {
  return trilha.at(-2) ?? null;
}
