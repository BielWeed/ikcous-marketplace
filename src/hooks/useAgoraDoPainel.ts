import { useSyncExternalStore } from "react";

// Todos os cartões compartilham o mesmo pulso, inclusive os memorizados.
// Sem consumidores ou com a aba escondida, não há intervalo rodando.
let agora = 0;
let intervalo: ReturnType<typeof setInterval> | undefined;
const ouvintes = new Set<() => void>();

function atualizar() {
  agora = Date.now();
  for (const ouvir of ouvintes) ouvir();
}

function acompanharVisibilidade() {
  clearInterval(intervalo);
  intervalo = undefined;
  if (document.visibilityState !== "visible") return;
  atualizar();
  intervalo = setInterval(atualizar, 60_000);
}

function assinar(ouvir: () => void) {
  ouvintes.add(ouvir);
  if (ouvintes.size === 1) {
    document.addEventListener("visibilitychange", acompanharVisibilidade);
    acompanharVisibilidade();
  }
  return () => {
    ouvintes.delete(ouvir);
    if (ouvintes.size !== 0) return;
    clearInterval(intervalo);
    intervalo = undefined;
    document.removeEventListener("visibilitychange", acompanharVisibilidade);
  };
}

const ler = () => {
  if (ouvintes.size === 0) agora = Date.now();
  return agora;
};
const lerNoServidor = () => 0;

export function useAgoraDoPainel() {
  return useSyncExternalStore(assinar, ler, lerNoServidor);
}
