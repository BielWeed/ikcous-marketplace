// O caixa está aberto AGORA? Para o aviso de caixa fechado do balcão (sócio,
// 27/11/2026). São as MESMAS RPCs e os mesmos leitores da aba Caixa do
// Financeiro (`useCaixaAtual`/`useHistoricoDoCaixa` em useFinanceiro.ts), lidos
// no instante em que a lojista escolhe Dinheiro — outro aparelho pode ter
// aberto o caixa depois de a tela carregar.
//
// Módulo próprio, fora de `useFinanceiro.ts`, de propósito: importar o hook do
// Financeiro no balcão separava o hook num pedaço compartilhado e estourava o
// teto de tamanho do painel em 301 B (medido no build de teste, 27/11/2026).
// Aqui só entram `@/lib/financeiro` (que o balcão já carrega) e o cliente.

import {
  ErroDePrazoFinanceiro,
  parseCaixaAtual,
  parseCaixaHistorico,
} from "@/lib/financeiro";
import {
  PRAZO_DA_CONSULTA_DO_PAINEL_MS,
  aguardarComPrazo,
} from "@/lib/prazo-da-requisicao";
import { supabase } from "@/lib/supabase";
import type { SituacaoDoCaixa } from "@/types/financeiro";

/**
 * O histórico (só a sessão mais nova) separa a loja que nunca usou o caixa
 * (`nunca_aberto`, nada a avisar) da que já usou e está `fechado`. Erro ou
 * prazo estourado rejeita; quem chama decide ficar calado. É só leitura.
 */
export async function consultarSituacaoDoCaixa(): Promise<SituacaoDoCaixa> {
  const [atual, historico] = await aguardarComPrazo(
    Promise.all([
      supabase.rpc("fin_caixa_atual"),
      supabase.rpc("fin_caixa_historico", { p_limite: 1 }),
    ]),
    PRAZO_DA_CONSULTA_DO_PAINEL_MS,
    () =>
      new ErroDePrazoFinanceiro(
        "A internet demorou demais para conferir o caixa.",
      ),
  );
  if (atual.error) throw atual.error;
  if (historico.error) throw historico.error;
  if (parseCaixaAtual(atual.data)) return "aberto";
  return parseCaixaHistorico(historico.data).length > 0
    ? "fechado"
    : "nunca_aberto";
}
