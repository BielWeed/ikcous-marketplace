import { pedidoSemValorAPagar } from "@/lib/forma-de-pagamento";
import { supabase } from "@/lib/supabase";
import type { RecebimentoPorMarcar } from "@/utils/avisos-do-lojista";

/**
 * "Recebimento por marcar" — pedido ENTREGUE, pago na entrega ou na retirada
 * (não pelo site), em que a lojista ainda não marcou o recebimento. É o pedido
 * que ela respondeu "Ainda não" para "Recebeu o pagamento?" (ou nunca
 * respondeu): o `payment_status` fica em branco, e enquanto isso o servidor
 * RECUSA o pedido de devolução ou troca da cliente ("Este pedido não tem
 * pagamento a devolver", `devolucao_elegibilidade` / `solicitar_devolucao`).
 * Marcar o recebimento é o ato que destrava a cliente — por isso o aviso conta
 * no sino.
 *
 * UMA regra só, lida pela lista de Notificações (`useAvisosDoLojista`) e pela
 * bolinha do sino (`AdminLayout`): duas contagens diferentes para a mesma
 * pergunta seria pior que nenhuma.
 *
 * "Pago pelo site" é `payment_method = 'online'` — a MESMA definição de
 * `podeRegistrarPagamento` (`paymentMethod !== "online"`), de
 * `OrderDetail.tsx` (a pergunta "Recebeu o pagamento?") e da RPC
 * `registrar_pagamento_recebido`. `payment_method` nulo conta como NA ENTREGA:
 * o mapper (`mappers.ts`) lê nulo como `"cash"`.
 */

/**
 * A janela do sino é o PRAZO DE DEVOLUÇÃO da loja (15/10/2026): a cliente só
 * consegue pedir devolução depois que a lojista marca o recebimento, então o
 * aviso tem de durar enquanto a cliente ainda pode pedir. Com a janela antiga
 * (30 dias fixos), nos dias 31 a 90 a cliente tentava devolver, o servidor
 * recusava e o sino já tinha esquecido o pedido. Sem janela nenhuma, todo
 * pedido antigo nunca marcado ficaria na lista para sempre e o sino nunca
 * zeraria.
 *
 * `JANELA_DE_RECEBIMENTO_DIAS` (90) é o PADRÃO COMERCIAL da loja (o prazo que
 * a política de devolução nasce com), usado como valor default de
 * `inicioDaJanelaDeRecebimento`. O prazo da loja entra pelo segundo argumento
 * dela. Já quando a leitura da política FALHA (ou ainda não carregou) o
 * fallback é `JANELA_DE_RECEBIMENTO_SEM_CONFIGURACAO_DIAS` (365): o banco
 * permite prazo de até 365 dias, e com 90 de fallback uma falha de rede
 * esconderia do sino o pedido de uma loja com prazo de 180 ou 365 que ainda
 * está no prazo da cliente. O erro do fallback tem de ser só para o lado do
 * excesso: pode trazer aviso antigo a mais, nunca esconder pedido no prazo.
 *
 * A data é `updated_at` (a coluna que a tela já lê), e é só uma APROXIMAÇÃO
 * da data da entrega, com duas ressalvas honestas:
 *   - O servidor (`devolucao__entregue_em`) usa a linha `new_status =
 *     'delivered'` de `marketplace_order_history`. `updated_at` anda com
 *     qualquer edição do pedido (marcar o recebimento, desfazer, cancelar) e
 *     um update em massa futuro renovaria a data de todos de uma vez, trazendo
 *     de volta para a lista pedido entregue há muito tempo. O pedido com o
 *     recebimento marcado não tem mais pagamento em branco e sai da lista;
 *     desfazer a marcação o devolve à lista, com a data renovada.
 *   - A janela é o MAIOR prazo de devolução da loja (defeito, arrependimento
 *     e, se aceita troca, troca; 365 dias se a leitura falhar, ver
 *     `inicioDaJanelaDoSino`), medido a partir de `updated_at`
 *     e não da entrega: um pedido mexido depois da entrega parece mais novo do
 *     que é, e o prazo da cliente (contado da entrega) pode acabar antes de o
 *     aviso sumir. É uma ajuda para a lojista, não a garantia do prazo da
 *     cliente.
 */
export const JANELA_DE_RECEBIMENTO_DIAS = 90;

/**
 * O fallback quando a política de devolução não pôde ser lida: o MAIOR prazo
 * que o banco aceita (365). Separado do padrão comercial (90) de propósito —
 * ver o comentário acima.
 */
export const JANELA_DE_RECEBIMENTO_SEM_CONFIGURACAO_DIAS = 365;

/** Teto da lista do sino: a tela é "o que falta fazer", não um relatório. */
export const TETO_DE_RECEBIMENTOS = 100;

/** O `.or(...)` do PostgREST de "não é pago pelo site" (`null` ou diferente de online). */
export const FILTRO_POSTGREST_PAGAMENTO_NA_ENTREGA =
  "payment_method.is.null,payment_method.neq.online";

/**
 * O ISO do começo da janela: o INÍCIO do dia de São Paulo que fica `dias` dias
 * de calendário antes de hoje. É a semântica do servidor
 * (`devolucao_elegibilidade`, 20261175000000): `v_dias = hoje(SP) - dia da
 * entrega(SP)` e a devolução vale enquanto `v_dias <= prazo` — ou seja, o dia
 * limite vale o dia INTEIRO, não 24 h × N contadas do instante de agora.
 * `agora` é injetável para o teste. O -03:00 é fixo de propósito: o Brasil
 * não tem horário de verão desde 2019, e o prazo (no máximo 365 dias) nunca
 * olha para antes disso.
 */
export function inicioDaJanelaDeRecebimento(
  agora: number = Date.now(),
  dias: number = JANELA_DE_RECEBIMENTO_DIAS,
): string {
  return `${new Date(agora - dias * 86_400_000).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" })}T00:00:00-03:00`;
}

/**
 * O começo da janela do sino, já com o prazo da loja: o MAIOR
 * prazo que a loja configurou em `politica_devolucao` (linha única): defeito
 * (`prazo_vicio_dias`), arrependimento e, se aceita troca, `prazo_troca_dias`. NUNCA
 * lança e nunca devolve menos que o padrão por falha: erro, linha ausente,
 * número torto ou rede caída viram 365 dias (o teto do banco) — o aviso precisa SOBRAR, e ler a
 * configuração não é uma fonte de aviso (a falha dela não acende o "não
 * consegui conferir" do sino).
 */
export async function inicioDaJanelaDoSino(): Promise<string> {
  let dias = JANELA_DE_RECEBIMENTO_SEM_CONFIGURACAO_DIAS;
  try {
    const { data } = await supabase
      .from("politica_devolucao")
      .select(
        "prazo_vicio_dias,prazo_troca_dias,prazo_arrependimento_dias,aceita_troca",
      )
      .eq("id", 1)
      .maybeSingle();
    // O MAIOR prazo que o servidor ainda aceita: defeito, arrependimento e,
    // se a loja aceita troca, o da troca (até 365, pode passar o de defeito).
    const vicio = Number(data?.prazo_vicio_dias) || 0;
    if (vicio > 0) {
      const troca = data?.aceita_troca ? Number(data.prazo_troca_dias) || 0 : 0;
      dias = Math.max(
        vicio,
        troca,
        Number(data?.prazo_arrependimento_dias) || 0,
      );
    }
  } catch {
    // Sem configuração: 365 (o teto do banco) — o aviso sobra, nunca some.
  }
  return inicioDaJanelaDeRecebimento(Date.now(), dias);
}

function consultaDeRecebimentos<Colunas extends string>(
  desde: string,
  colunas: Colunas,
  opcoes?: { count: "exact"; head?: boolean },
) {
  return supabase
    .from("marketplace_orders")
    .select(colunas, opcoes)
    .eq("status", "delivered")
    .or(FILTRO_POSTGREST_PAGAMENTO_NA_ENTREGA)
    .is("payment_status", null)
    .gte("updated_at", desde);
}

const COLUNAS_DOS_VALORES = "total, subtotal, discount, shipping";

function recebimentoSemValorAPagar(pedido: {
  total: number;
  subtotal: number;
  discount: number | null;
  shipping: number | null;
}): boolean {
  // A ficha lê desconto/frete nulos como zero (mapOrderFromDB).
  return pedidoSemValorAPagar({
    total: pedido.total,
    subtotal: pedido.subtotal,
    discount: pedido.discount ?? 0,
    shipping: pedido.shipping ?? 0,
  });
}

export async function buscarRecebimentosPorMarcar(): Promise<{
  recebimentos: RecebimentoPorMarcar[];
  truncou: boolean;
}> {
  const desde = await inicioDaJanelaDoSino();
  const recebimentos: RecebimentoPorMarcar[] = [];
  let lidos = 0;
  let totalDeCandidatos: number | null = null;

  do {
    const consulta = consultaDeRecebimentos(
      desde,
      `id, customer_name, updated_at, ${COLUNAS_DOS_VALORES}`,
      lidos === 0 ? { count: "exact" } : undefined,
    )
      .order("updated_at", { ascending: false })
      .order("id", { ascending: true });
    const { data, count, error } = await (lidos === 0
      ? consulta.limit(TETO_DE_RECEBIMENTOS)
      : consulta.range(lidos, lidos + TETO_DE_RECEBIMENTOS - 1));

    if (error) throw error;
    if (!data?.length) break;
    if (lidos === 0) totalDeCandidatos = count;
    lidos += data.length;
    for (const pedido of data) {
      if (recebimentoSemValorAPagar(pedido)) continue;
      // Só sinaliza corte se encontrou mais um aviso real, não só um brinde.
      if (recebimentos.length === TETO_DE_RECEBIMENTOS) {
        return { recebimentos, truncou: true };
      }
      recebimentos.push(pedido);
    }
  } while (totalDeCandidatos !== null && lidos < totalDeCandidatos);

  return { recebimentos, truncou: false };
}

export async function contarRecebimentosPorMarcar(): Promise<number> {
  const desde = await inicioDaJanelaDoSino();
  const { count, error } = await consultaDeRecebimentos(desde, "id", {
    count: "exact",
    head: true,
  });
  if (error) throw error;
  if (count === null) throw new Error("Contagem de recebimentos indisponível");
  if (count === 0) return 0;

  // O banco grava total em centavos (numeric(10,2)). Só as linhas cujo total
  // é zero precisam da conferência; não transfere os demais pedidos ao sino.
  let brindes = 0;
  let lidos = 0;
  while (lidos < count) {
    const candidatos = await consultaDeRecebimentos(desde, COLUNAS_DOS_VALORES)
      .eq("total", 0)
      .order("id", { ascending: true })
      .range(lidos, lidos + TETO_DE_RECEBIMENTOS - 1);
    if (candidatos.error) throw candidatos.error;
    if (!candidatos.data)
      throw new Error("Leitura de recebimentos indisponível");

    for (const pedido of candidatos.data) {
      if (recebimentoSemValorAPagar(pedido)) brindes++;
    }
    lidos += candidatos.data.length;
    if (candidatos.data.length < TETO_DE_RECEBIMENTOS) break;
  }
  // Uma alteração entre as leituras não pode produzir crachá negativo.
  return Math.max(0, count - brindes);
}
