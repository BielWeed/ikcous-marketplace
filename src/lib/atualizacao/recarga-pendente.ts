/**
 * RECARGA PENDENTE — o VETO LOCAL de cada aba (atualização única e
 * obrigatória, 16/10/2026).
 *
 * O vite-plugin-pwa 2.0.0, quando o service worker novo assume o controle,
 * recarrega TODAS as abas por conta própria (ouvinte `controlling`) — a menos
 * que o app passe `onNeedReload`, que SUBSTITUI esse reload. O useUpdateCheck
 * passa `marcarRecargaPendente` ali: a aba é avisada de que o SW assumiu e só
 * ANOTA o pedido. Quem decide quando recarregar é o PWAUpdateGate, no modo
 * "so-recarregar": mesma regra de momento seguro (nunca no meio de pagamento,
 * venda, formulário sujo, operação sensível), no próximo ponto de parada.
 *
 * É esta peça que faz a segurança dos dados NÃO depender de resposta de outras
 * abas: cada aba veta o próprio reload.
 *
 * Limite conhecido: aba que roda um build ANTERIOR a esta proteção (na
 * primeira transição) ainda recarrega pelo caminho antigo, sem veto.
 */
import { useSyncExternalStore } from "react";

import {
  gravaMotivoDeRecarga,
  gravaOrigemDeAtualizacao,
} from "@/lib/motivo-de-recarga";

let pendente = false;
const ouvintes = new Set<() => void>();

function avisar(): void {
  for (const ouvinte of [...ouvintes]) {
    try {
      ouvinte();
    } catch {
      // Um ouvinte com defeito não impede os outros.
    }
  }
}

/** O service worker novo assumiu: esta aba precisa recarregar quando for
 * seguro. Idempotente. Assinatura sem argumentos de propósito — é entregue
 * direto como `onNeedReload` do plugin. */
export function marcarRecargaPendente(): void {
  if (pendente) return;
  pendente = true;
  avisar();
}

export function haRecargaPendente(): boolean {
  return pendente;
}

/** Só para teste e para o caso de a aba decidir não recarregar mais. */
export function limparRecargaPendente(): void {
  if (!pendente) return;
  pendente = false;
  avisar();
}

function assinar(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

export function useRecargaPendente(): boolean {
  return useSyncExternalStore(assinar, haRecargaPendente, haRecargaPendente);
}

/** Recarrega esta aba depois de o SW novo ter assumido. Grava a SUA origem
 * (cada aba prova a troca no próprio boot, como no apply normal) e o motivo
 * nominal — o controllerchange que gerou o `onNeedReload` é a evidência de
 * atualização; o boot ainda reconfere o build que chegou. */
export function recarregarAposAssumir(versaoAtual: string): void {
  gravaOrigemDeAtualizacao(versaoAtual);
  gravaMotivoDeRecarga("atualizacao-aplicada");
  window.location.reload();
}
