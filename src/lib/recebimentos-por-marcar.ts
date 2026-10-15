import { supabase } from "@/lib/supabase";

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
 * `JANELA_DE_RECEBIMENTO_DIAS` (90) é o PADRÃO: vale quando a configuração da
 * loja ainda não carregou ou falhou — o aviso precisa SOBRAR, nunca sumir. O
 * prazo da loja entra por `janelaDeRecebimentoDias` e vira o segundo
 * argumento de `inicioDaJanelaDeRecebimento`.
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
 *   - A janela é o prazo de devolução da loja (90 dias por padrão,
 *     `politica_devolucao.prazo_vicio_dias`), medido a partir de `updated_at`
 *     e não da entrega: um pedido mexido depois da entrega parece mais novo do
 *     que é, e o prazo da cliente (contado da entrega) pode acabar antes de o
 *     aviso sumir. É uma ajuda para a lojista, não a garantia do prazo da
 *     cliente.
 */
export const JANELA_DE_RECEBIMENTO_DIAS = 90;

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
 * número torto ou rede caída viram 90 dias — o aviso precisa SOBRAR, e ler a
 * configuração não é uma fonte de aviso (a falha dela não acende o "não
 * consegui conferir" do sino).
 */
export async function inicioDaJanelaDoSino(): Promise<string> {
  let dias = JANELA_DE_RECEBIMENTO_DIAS;
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
    // Sem configuração: o padrão (90) — o aviso sobra, nunca some.
  }
  return inicioDaJanelaDeRecebimento(Date.now(), dias);
}
