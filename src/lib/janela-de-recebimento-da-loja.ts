/**
 * Lê, no banco, quantos dias o sino de "recebimentos por marcar" deve olhar
 * para trás (o prazo de devolução da loja). A conta mora em
 * `@/lib/recebimentos-por-marcar` (`janelaDeRecebimentoDias`); aqui só a
 * leitura de `politica_devolucao`, a mesma que a tela de Políticas e a página
 * de trocas já fazem (linha única `id = 1`, colunas sem `updated_by`).
 *
 * NUNCA lança e nunca devolve menos que o padrão por falha: erro do banco,
 * linha ausente, resposta torta ou rede caída viram 90 dias. O aviso precisa
 * SOBRAR; ler a configuração não é uma fonte de aviso, então a falha dela não
 * acende o "não consegui conferir" do sino.
 */
import { COLUNAS_DA_POLITICA, lerPolitica } from "@/lib/devolucao";
import {
  JANELA_DE_RECEBIMENTO_DIAS,
  janelaDeRecebimentoDias,
} from "@/lib/recebimentos-por-marcar";
import { supabase } from "@/lib/supabase";

export async function lerJanelaDeRecebimentoDias(): Promise<number> {
  try {
    const { data, error } = await supabase
      .from("politica_devolucao")
      .select(COLUNAS_DA_POLITICA)
      .eq("id", 1)
      .maybeSingle();
    if (error || !data) return JANELA_DE_RECEBIMENTO_DIAS;
    return janelaDeRecebimentoDias(lerPolitica(data));
  } catch {
    return JANELA_DE_RECEBIMENTO_DIAS;
  }
}
