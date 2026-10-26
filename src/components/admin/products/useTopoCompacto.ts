import { useEffect, useRef, useState } from "react";

/**
 * O topo do formulário de produto encolhe quando a lojista rola: fica só o
 * título, o anel "N/5" e a ajuda.
 *
 * Como mede: o topo é `sticky`; uma marca de altura zero fica logo ANTES dele,
 * no fluxo. Com a página no alto as duas estão no mesmo ponto; quando o topo
 * já colou e o conteúdo continua subindo, a marca vai ficando para cima e a
 * distância entre as duas é "quanto já rolou além do ponto em que o topo cola".
 * Medir assim não depende de qual contêiner rola (a janela ou o painel).
 *
 * Histerese: entra acima de {@link ENTRA_PX} e só sai abaixo de {@link SAI_PX}.
 * Sem a folga o estado piscaria na fronteira, e o topo muda de aparência (não
 * de altura) a cada troca.
 */
export const ENTRA_PX = 24;
export const SAI_PX = 8;

export function useTopoCompacto() {
  const marca = useRef<HTMLDivElement>(null);
  const topo = useRef<HTMLElement>(null);
  const [compacto, setCompacto] = useState(false);

  useEffect(() => {
    let quadro = 0;
    let atual = false;

    const medir = () => {
      quadro = 0;
      const a = marca.current;
      const b = topo.current;
      if (!a || !b) return;
      const rolado =
        b.getBoundingClientRect().top - a.getBoundingClientRect().top;
      const proximo = atual ? rolado > SAI_PX : rolado > ENTRA_PX;
      if (proximo !== atual) {
        atual = proximo;
        setCompacto(proximo);
      }
    };

    // `scroll` não borbulha: no `document`, com captura, pega a rolagem de
    // qualquer contêiner. Passivo: nunca segura a rolagem.
    const agendar = () => {
      if (quadro !== 0) return;
      quadro =
        typeof requestAnimationFrame === "function"
          ? requestAnimationFrame(medir)
          : window.setTimeout(medir, 16);
    };

    document.addEventListener("scroll", agendar, {
      capture: true,
      passive: true,
    });
    window.addEventListener("resize", agendar, { passive: true });
    medir();

    return () => {
      document.removeEventListener("scroll", agendar, { capture: true });
      window.removeEventListener("resize", agendar);
      if (quadro !== 0) {
        if (typeof cancelAnimationFrame === "function") {
          cancelAnimationFrame(quadro);
        } else {
          clearTimeout(quadro);
        }
      }
    };
  }, []);

  return { marca, topo, compacto };
}
