import { useSyncExternalStore } from "react";

/**
 * Há uma folha ou diálogo MODAL aberto agora? Serve para o que fica fixo por
 * cima da tela (convite de notificações) sair do caminho em vez de cobrir o
 * rodapé da folha -- sem lista de telas para manter.
 *
 * O sinal é o que o Radix já grava no <body> quando um modal trava a rolagem
 * (`data-scroll-locked`, de react-remove-scroll): vale para toda folha e
 * diálogo da casa (`Sheet`, `Dialog`, `AlertDialog`) e some sozinho ao fechar.
 * Um diálogo próprio com `aria-modal="true"` direto no <body> também conta.
 * Só se observa o próprio <body> (atributos e filhos diretos, onde os portais
 * entram), nunca a árvore inteira.
 */
function lerCamada(): boolean {
  if (typeof document === "undefined") return false;
  const corpo = document.body;
  return (
    corpo.hasAttribute("data-scroll-locked") ||
    corpo.querySelector(':scope > [role="dialog"][aria-modal="true"]') !== null
  );
}

function assinar(aoMudar: () => void): () => void {
  if (typeof MutationObserver === "undefined") return () => {};
  const observador = new MutationObserver(aoMudar);
  observador.observe(document.body, {
    attributes: true,
    attributeFilter: ["data-scroll-locked"],
    childList: true,
  });
  return () => observador.disconnect();
}

export function useHaCamadaAberta(): boolean {
  return useSyncExternalStore(assinar, lerCamada, () => false);
}
