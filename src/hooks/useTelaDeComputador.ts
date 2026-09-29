// Gancho ÚNICO de largura da casca do cliente (Onda 0 do app-cliente-desktop,
// F1.1, contrato C1). >=1024px vira "computador": nav do topo, rodapé,
// grades de site. Abaixo disso, tudo continua idêntico ao celular de hoje.
//
// POR QUE `useSyncExternalStore` E NÃO `useState` + `useEffect` (o padrão do
// `useMediaQuery` legado, `src/hooks/useMediaQuery.ts`): o efeito só roda
// DEPOIS do primeiro paint, então uma peça de desktop nasceria com a
// classe/posição de celular e pularia um instante depois. `getSnapshot` do
// `useSyncExternalStore` é chamado durante o PRÓPRIO render, então o valor
// certo já está lá na primeira pintura -- mesma garantia que `useTelaLarga()`
// (`src/hooks/useFinanceiro.ts`) já dá para o painel.
//
// POR QUE ARQUIVO PRÓPRIO, E NÃO REUSAR `useTelaLarga`: importar de
// `useFinanceiro.ts` arrastaria um módulo do painel para o lado da cliente do
// portão de tamanho (`scripts/portaoDividido.ts`) -- a fronteira segue o
// grafo real do Rollup a partir das entradas, e este hook é importado
// ESTATICAMENTE pelo `App.tsx` do cliente.
//
// R8 (spec §4.1): este é o ÚNICO lugar do app que lê `matchMedia` com
// min-width/max-width fora do painel admin. `desktop-um-so-leitor-de-
// largura.test.ts` garante que nenhuma tela ou componente da cliente burle
// isso lendo `matchMedia`/`useMediaQuery` por conta própria.
import { useSyncExternalStore } from "react";

export const CONSULTA_TELA_DE_COMPUTADOR = "(min-width: 1024px)";

/**
 * Leitura síncrona, fora de React (ex.: `cartAnimation.ts`, que decide o
 * alvo do voo do carrinho antes de qualquer render). Sem `matchMedia` no
 * ambiente (SSR, teste sem stub) devolve `false` -- nunca lança.
 */
export function ehTelaDeComputador(): boolean {
  return (
    typeof globalThis.matchMedia === "function" &&
    globalThis.matchMedia(CONSULTA_TELA_DE_COMPUTADOR).matches
  );
}

function assinar(notificarMudanca: () => void): () => void {
  if (typeof globalThis.matchMedia !== "function") {
    return () => {};
  }

  const consulta = globalThis.matchMedia(CONSULTA_TELA_DE_COMPUTADOR);
  // Stub de teste (ou navegador antigo) pode não ter `addEventListener` --
  // o encadeamento opcional evita que a montagem quebre por isso.
  consulta.addEventListener?.("change", notificarMudanca);
  return () => consulta.removeEventListener?.("change", notificarMudanca);
}

function ler(): boolean {
  return ehTelaDeComputador();
}

function lerNoServidor(): boolean {
  return false;
}

/**
 * `>= 1024px`? O valor já vem certo no primeiro render (nada de flash nem
 * salto de layout). Sem `matchMedia` = celular (`false`).
 */
export function useTelaDeComputador(): boolean {
  return useSyncExternalStore(assinar, ler, lerNoServidor);
}
