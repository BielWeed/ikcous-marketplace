import { pagamentoOnlineLigado } from "@/lib/flags";
import { useSyncExternalStore } from "react";

/**
 * O pagamento pelo app COMO O CHECKOUT O CONHECE (caça 28/11/2026).
 *
 * `pagamentoOnlineLigado()` é o retrato síncrono da ficha injetada no BOOT da
 * página, e a ficha não se relê. A lojista pode desligar o pagamento pelo app
 * (`store_config.pagamento_online`) com o checkout aberto: a RPC recusa o
 * pedido "online" com "Esta forma de pagamento não está disponível nesta
 * loja. Escolha outra." — e, lendo só o boot, a tela continuava oferecendo o
 * PIX pelo app, a cliente o escolhia de novo e recebia a mesma recusa.
 *
 * Esta recusa, para o método "online", é o SERVIDOR dizendo o estado gravado
 * (`forma_de_pagamento_aceita('online')` só lê `pagamento_online`). Quem a
 * recebe a publica aqui, e daí até o fim da página o pagamento pelo app conta
 * como desligado — inclusive se a cliente sair do checkout e voltar. Só
 * desliga: religar continua sendo a ficha do próximo carregamento, a mesma
 * régua de antes. Não há leitura nova no servidor.
 *
 * Irmão de `pagamento-pelo-app-no-painel.ts` (o eco do PAINEL); este é o da
 * vitrine, separado para a vitrine não importar módulo do painel.
 *
 * Estado do módulo = estado da SESSÃO (uma página, uma loja).
 */
let recusadoPelaLoja = false;
const ouvintes = new Set<() => void>();

export function pagamentoPeloAppNaSessao(): boolean {
  return !recusadoPelaLoja && pagamentoOnlineLigado();
}

/** A RPC recusou o pedido "online" porque a loja desligou o pagamento pelo app. */
export function marcarPagamentoPeloAppRecusado(): void {
  if (recusadoPelaLoja) return;
  recusadoPelaLoja = true;
  for (const ouvinte of ouvintes) ouvinte();
}

/** Só para teste: volta a palavra ao retrato do boot. */
export function esquecerRecusaDoPagamentoPeloApp(): void {
  recusadoPelaLoja = false;
  for (const ouvinte of ouvintes) ouvinte();
}

function assinar(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

/** O pagamento pelo app vale nesta sessão? Re-renderiza quando a recusa chega. */
export function usePagamentoPeloAppNaSessao(): boolean {
  return useSyncExternalStore(
    assinar,
    pagamentoPeloAppNaSessao,
    pagamentoPeloAppNaSessao,
  );
}
