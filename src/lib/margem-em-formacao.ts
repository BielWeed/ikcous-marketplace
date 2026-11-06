import type { IntervaloDeDatas } from "@/types/financeiro";

/** Até este dia do mês (inclusive), prejuízo estimado ainda não vira margem. */
export const ULTIMO_DIA_DA_MARGEM_EM_FORMACAO = 15;

/**
 * "Margem em formação": o lucro do mês já desconta as despesas do mês INTEIRO,
 * mas a receita só vai até hoje. Com lucro negativo na primeira metade do mês, o
 * percentual compara um mês cheio de contas com poucos dias de vendas (R$ 200
 * contra −R$ 2.900 dá −1.450%). Aí a margem ainda não diz nada.
 *
 * Vale quando o percentual é negativo, o período COMEÇA no mês corrente (é o
 * mês parcial que distorce; "Este ano" ou 30 dias carregam meses fechados e o
 * prejuízo deles é real) e o dia de hoje (`YYYY-MM-DD`, calendário de São
 * Paulo) é até o último dia da formação. Percentual nulo, zero, positivo ou
 * fora do domínio nunca está em formação.
 */
export function margemEmFormacao(
  percentual: number | null,
  dia: string,
  intervalo: IntervaloDeDatas | null,
): boolean {
  if (percentual === null || !Number.isFinite(percentual) || percentual >= 0) {
    return false;
  }
  if (!intervalo) return false;
  const mes = dia.slice(0, 7);
  return (
    intervalo.inicio.slice(0, 7) === mes &&
    intervalo.fim.slice(0, 7) >= mes &&
    Number(dia.slice(8, 10)) <= ULTIMO_DIA_DA_MARGEM_EM_FORMACAO
  );
}
