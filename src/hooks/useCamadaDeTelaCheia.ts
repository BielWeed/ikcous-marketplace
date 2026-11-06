import { useEffect, useRef } from "react";

const FOCAVEIS =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Comportamento de diálogo para camadas de tela cheia feitas com
 * `createPortal` cru (editor de foto, simulador "Ver app"): o foco entra na
 * camada ao abrir e volta ao botão que abriu ao fechar, o Esc fecha, e o Tab
 * fica preso dentro dela (sem andar pela tela escondida atrás).
 *
 * Devolve o `ref` do elemento raiz da camada (que deve levar `tabIndex={-1}`,
 * `role="dialog"`, `aria-modal` e um nome). `podeFechar=false` (envio em
 * andamento) engole o Esc sem fechar; `ativa=false` desliga tudo (camada
 * fechada). O Esc é tratado no `document` com
 * `stopPropagation`, então ouvintes de `window` da tela de baixo (que fechariam
 * a tela inteira) não o veem.
 */
export function useCamadaDeTelaCheia<T extends HTMLElement>(
  aoFechar: () => void,
  podeFechar = true,
  ativa = true,
) {
  const raiz = useRef<T>(null);
  const ultimo = useRef({ aoFechar, podeFechar });
  useEffect(() => {
    ultimo.current = { aoFechar, podeFechar };
  });

  useEffect(() => {
    if (!ativa) return;
    const quemAbriu = document.activeElement;
    raiz.current?.focus({ preventScroll: true });

    const aoTeclar = (e: KeyboardEvent) => {
      // Um componente de dentro (ex.: Radix) que já tratou a tecla ganha.
      if (e.defaultPrevented) return;
      const camada = raiz.current;
      if (!camada) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (ultimo.current.podeFechar) ultimo.current.aoFechar();
        return;
      }
      if (e.key !== "Tab") return;
      const lista = [...camada.querySelectorAll<HTMLElement>(FOCAVEIS)];
      const primeiro = lista[0];
      const final = lista[lista.length - 1];
      const atual = document.activeElement;
      if (!primeiro || !final) {
        e.preventDefault();
        camada.focus({ preventScroll: true });
      } else if (!camada.contains(atual) || atual === camada) {
        e.preventDefault();
        (e.shiftKey ? final : primeiro).focus();
      } else if (e.shiftKey && atual === primeiro) {
        e.preventDefault();
        final.focus();
      } else if (!e.shiftKey && atual === final) {
        e.preventDefault();
        primeiro.focus();
      }
    };
    document.addEventListener("keydown", aoTeclar);
    return () => {
      document.removeEventListener("keydown", aoTeclar);
      if (quemAbriu instanceof HTMLElement && quemAbriu.isConnected) {
        quemAbriu.focus({ preventScroll: true });
      }
    };
  }, [ativa]);

  return raiz;
}
