import type { PoliticaDevolucao } from "@/types/devolucao";

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
 * O ISO do começo da janela, a partir de `agora` (injetável para o teste) e do
 * prazo em dias (o da loja; sem ele, o padrão de 90).
 */
export function inicioDaJanelaDeRecebimento(
  agora: number = Date.now(),
  dias: number = JANELA_DE_RECEBIMENTO_DIAS,
): string {
  return new Date(agora - dias * 24 * 3600 * 1000).toISOString();
}

type PrazosDaPolitica = Pick<
  PoliticaDevolucao,
  | "prazo_arrependimento_dias"
  | "prazo_troca_dias"
  | "prazo_vicio_dias"
  | "aceita_troca"
>;

const prazoValido = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n > 0;

/**
 * Quantos dias o sino olha para trás, dado o que a loja configurou: o MAIOR
 * prazo em que a cliente ainda pode pedir (desistir da compra, trocar — se a
 * loja aceita troca — ou reclamar de defeito; `devolucao_elegibilidade`
 * aceita o pedido se qualquer um dos três está no prazo). Sem configuração, ou
 * com número que não presta, usa 90: o aviso nunca encolhe por falha de leitura.
 */
export function janelaDeRecebimentoDias(
  politica: PrazosDaPolitica | null | undefined,
): number {
  if (!politica) return JANELA_DE_RECEBIMENTO_DIAS;
  const prazos = [
    politica.prazo_vicio_dias,
    politica.prazo_arrependimento_dias,
    politica.aceita_troca ? politica.prazo_troca_dias : 0,
  ].filter(prazoValido);
  return prazos.length > 0 ? Math.max(...prazos) : JANELA_DE_RECEBIMENTO_DIAS;
}
