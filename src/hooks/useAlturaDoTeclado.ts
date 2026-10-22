import { useEffect, useState } from "react";

/** Abaixo disto é barra do navegador, não teclado. */
const ALTURA_MINIMA_DE_TECLADO = 80;
/** Tolerância para considerar que não há pinch-zoom. */
const TOLERANCIA_DE_ZOOM = 0.05;

export type EstadoDoTeclado = {
  /** Quanto o teclado ocupa embaixo, em px (0 = fechado). */
  readonly altura: number;
  /** Altura da área realmente visível (0 quando não há teclado). */
  readonly alturaVisivel: number;
};

const SEM_TECLADO: EstadoDoTeclado = { altura: 0, alturaVisivel: 0 };

function campoDeTextoFocado(): boolean {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return false;
  return (
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT" ||
    el.isContentEditable
  );
}

/**
 * Estado do teclado virtual.
 *
 * No Android/PWA o teclado NÃO redimensiona a página: ele se sobrepõe. Só o
 * `visualViewport` enxerga a área realmente visível, então a conta é
 * `innerHeight - altura visível - deslocamento do topo`. Só vale como teclado
 * com um campo de texto focado e sem pinch-zoom (zoom também encolhe o
 * `visualViewport` e não é teclado).
 */
export function lerEstadoDoTeclado(): EstadoDoTeclado {
  if (typeof window === "undefined" || !window.visualViewport) {
    return SEM_TECLADO;
  }
  const vv = window.visualViewport;
  if (!campoDeTextoFocado()) return SEM_TECLADO;
  if (Math.abs((vv.scale ?? 1) - 1) >= TOLERANCIA_DE_ZOOM) return SEM_TECLADO;
  const altura = Math.round(
    Math.max(0, window.innerHeight - vv.height - vv.offsetTop),
  );
  if (altura < ALTURA_MINIMA_DE_TECLADO) return SEM_TECLADO;
  return { altura, alturaVisivel: Math.round(vv.height) };
}

export function useAlturaDoTeclado(): EstadoDoTeclado {
  const [estado, setEstado] = useState<EstadoDoTeclado>(SEM_TECLADO);
  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;
    const vv = window.visualViewport;
    let quadro: number | null = null;
    const atualizar = () => {
      if (quadro !== null) return;
      quadro = window.requestAnimationFrame(() => {
        quadro = null;
        const novo = lerEstadoDoTeclado();
        setEstado((atual) =>
          atual.altura === novo.altura &&
          atual.alturaVisivel === novo.alturaVisivel
            ? atual
            : novo,
        );
      });
    };
    atualizar();
    vv.addEventListener("resize", atualizar);
    vv.addEventListener("scroll", atualizar);
    document.addEventListener("focusin", atualizar);
    document.addEventListener("focusout", atualizar);
    return () => {
      vv.removeEventListener("resize", atualizar);
      vv.removeEventListener("scroll", atualizar);
      document.removeEventListener("focusin", atualizar);
      document.removeEventListener("focusout", atualizar);
      if (quadro !== null) window.cancelAnimationFrame(quadro);
    };
  }, []);
  return estado;
}
