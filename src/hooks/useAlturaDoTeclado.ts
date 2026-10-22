import { useEffect, useState } from "react";

/** Abaixo disto é barra do navegador, não teclado. */
const ALTURA_MINIMA_DE_TECLADO = 80;

/**
 * Quanto o teclado virtual ocupa embaixo da tela, em px (0 = fechado).
 *
 * No Android/PWA o teclado NÃO redimensiona a página: ele se sobrepõe. Só o
 * `visualViewport` enxerga a área realmente visível, então a conta é
 * `innerHeight - altura visível - deslocamento do topo`.
 */
export function lerAlturaDoTeclado(): number {
  if (typeof window === "undefined" || !window.visualViewport) return 0;
  const vv = window.visualViewport;
  const ocupada = Math.round(
    Math.max(0, window.innerHeight - vv.height - vv.offsetTop),
  );
  return ocupada < ALTURA_MINIMA_DE_TECLADO ? 0 : ocupada;
}

export function useAlturaDoTeclado(): number {
  const [altura, setAltura] = useState(0);
  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;
    const vv = window.visualViewport;
    let quadro: number | null = null;
    const atualizar = () => {
      if (quadro !== null) return;
      quadro = window.requestAnimationFrame(() => {
        quadro = null;
        setAltura(lerAlturaDoTeclado());
      });
    };
    atualizar();
    vv.addEventListener("resize", atualizar);
    vv.addEventListener("scroll", atualizar);
    return () => {
      vv.removeEventListener("resize", atualizar);
      vv.removeEventListener("scroll", atualizar);
      if (quadro !== null) window.cancelAnimationFrame(quadro);
    };
  }, []);
  return altura;
}
