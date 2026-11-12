import { useEffect, useRef } from "react";

/** Uma volta pode gerar três eventos. Só uma leitura silenciosa, a cada 30 s. */
export function useRevalidarAoVoltar(
  active: boolean,
  reler: () => unknown,
  podeReler: () => boolean,
) {
  const atual = useRef({ reler, podeReler });
  atual.current = { reler, podeReler };
  const ultimaVolta = useRef(Date.now());

  useEffect(() => {
    if (!active) return;
    let emVoo = false;
    const aoVoltar = async () => {
      if (
        document.visibilityState !== "visible" ||
        emVoo ||
        Date.now() - ultimaVolta.current < 30_000 ||
        !atual.current.podeReler()
      )
        return;
      ultimaVolta.current = Date.now();
      emVoo = true;
      try {
        await atual.current.reler();
      } finally {
        emVoo = false;
      }
    };
    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener("focus", aoVoltar);
    window.addEventListener("pageshow", aoVoltar);
    return () => {
      document.removeEventListener("visibilitychange", aoVoltar);
      window.removeEventListener("focus", aoVoltar);
      window.removeEventListener("pageshow", aoVoltar);
    };
  }, [active]);
}
