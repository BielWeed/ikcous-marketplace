import { useState } from "react";

// Memória da última visita da home (frente cls-ressalva1-0409, desenho da
// memória: laudo 6ab5s4 + posição #476 + contrato do hub).
//
// O que é: três booleanos — tinha banner de topo? tinha ofertas? tinha
// destaques? — gravados quando os dados vivos da última visita chegaram, e
// lidos NO PRIMEIRO RENDER da visita seguinte para reservar exatamente o
// espaço que vai ser usado: esqueleto do banner só quando a última visita
// tinha banner; esqueleto de ofertas/destaques só quando a última visita
// tinha conteúdo nessas seções. Primeira visita (sem memória) = aposta de
// hoje (develop): esqueleto de banner e das seções ativas.
//
// POR QUE localStorage E NÃO DataVault: a reserva tem de ser decidida ANTES
// do primeiro paint. O DataVault é IndexedDB assíncrona — resolve milis-
// segundos depois do primeiro render; o esqueleto nasceria com a aposta
// errada e a troca tardia seria um layout-shift novo (o defeito que a
// memória existe para matar). localStorage é síncrono: o primeiro render
// já sabe. A gravação (best-effort, sem throw) acontece no HomeView quando
// dados e banners da visita atual resolveram.
export interface MemoriaDaHome {
  temBanner: boolean;
  temOfertas: boolean;
  temBestsellers: boolean;
  gravadoEm: number;
}

const CHAVE = "ikcous_home_memoria";

function parseMemoria(bruto: string | null): MemoriaDaHome | null {
  if (!bruto) return null;
  try {
    const memo = JSON.parse(bruto);
    if (
      typeof memo?.temBanner !== "boolean" ||
      typeof memo?.temOfertas !== "boolean" ||
      typeof memo?.temBestsellers !== "boolean"
    ) {
      return null;
    }
    return {
      temBanner: memo.temBanner,
      temOfertas: memo.temOfertas,
      temBestsellers: memo.temBestsellers,
      gravadoEm: Number(memo.gravadoEm) || 0,
    };
  } catch {
    return null;
  }
}

/** Snapshot da última visita, ou null quando não há memória (1ª visita). */
export function lerMemoriaDaHome(): MemoriaDaHome | null {
  try {
    return parseMemoria(window.localStorage.getItem(CHAVE));
  } catch {
    return null;
  }
}

/** Grava o snapshot da visita atual (best-effort: quota/modo privado não propagam erro). */
export function gravarMemoriaDaHome(
  memoria: Omit<MemoriaDaHome, "gravadoEm">,
): void {
  try {
    window.localStorage.setItem(
      CHAVE,
      JSON.stringify({ ...memoria, gravadoEm: Date.now() }),
    );
  } catch {
    // memória é otimização: sem ela a home cai na aposta da 1ª visita
  }
}

/**
 * A memória da última visita, lida UMA vez por mount (initializer do
 * useState) — síncrona, disponível no primeiro render, sem efeito de rede.
 */
export function useMemoriaDaHome(): MemoriaDaHome | null {
  const [memoria] = useState(lerMemoriaDaHome);
  return memoria;
}
