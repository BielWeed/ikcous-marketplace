import { useCallback } from "react";
import { flushSync } from "react-dom";

/**
 * useViewTransition v18.1
 * View Transitions API — smooth animations between PWA "pages" with direction support.
 * Falls back to immediate execution if not supported.
 *
 * Usage:
 *   const { navigate } = useViewTransition();
 *   navigate(() => setCurrentView('cart'), 'forward');
 */
export const isViewTransitionSupported = (() => {
  if (typeof document === "undefined" || !("startViewTransition" in document)) {
    return false;
  }
  return true;
})();

/**
 * Remove `view-transition-name` dos elementos cujo nome troca de dono entre
 * as duas telas — hoje, apenas IMAGENS ("product-image": o card da grade
 * cede o nome para a foto principal da página de produto; na volta, é a
 * foto principal que o cede de volta).
 *
 * ⚠️ O seletor já foi `'img, [style*="view-transition-name"]'` e isso era o
 * pisca da barra inferior (relato do Gabriel, 02/09: abrir produto ou
 * login/cadastro fazia a BottomNav sumir por um instante — só nessas telas,
 * onde a transição "forward" roda). O seletor pegava a BottomNav
 * ("bottom-nav"), o Header ("app-header") e os painéis do admin, que são
 * ESTRUTURA persistente: precisam do nome nos DOIS lados da transição para
 * o navegador animar um morph estável. Com o nome removido do estado novo,
 * o par old/new "bottom-nav" quebrava e o snapshot velho da barra era
 * animado como elemento que saiu de cena — fade-out e reaparição no fim.
 * Estrutura persistente nunca é alcançada aqui; e imagens sem nome não
 * interessam (não têm o que remover).
 */
export function limparNomesDeTransicao(
  documento: Document,
  direction?: "forward" | "back" | "none",
): void {
  documento.querySelectorAll<HTMLElement>("img").forEach((el) => {
    if (direction === "forward") {
      if (!el.classList.contains("main-product-image")) {
        el.style.removeProperty("view-transition-name");
      }
    } else if (direction === "back") {
      if (el.classList.contains("main-product-image")) {
        el.style.removeProperty("view-transition-name");
      }
    } else {
      el.style.removeProperty("view-transition-name");
    }
  });
}

export function useViewTransition() {
  const isSupported = isViewTransitionSupported;

  const navigate = useCallback(
    (
      updateFn: () => void,
      direction?: "forward" | "back" | "none",
      onFinished?: () => void,
    ) => {
      if (!isSupported) {
        updateFn();
        onFinished?.();
        return null;
      }

      // Apply view-specific direction class to documentElement
      const docEl = document.documentElement;
      if (direction && direction !== "none") {
        docEl.classList.remove(
          "view-transition-forward",
          "view-transition-back",
        );
        docEl.classList.add(`view-transition-${direction}`);
      }

      const transition = (
        document as Document & {
          startViewTransition: (cb: () => void) => {
            ready: Promise<void>;
            finished?: Promise<void>;
            skip?: () => void;
          };
        }
      ).startViewTransition(() => {
        flushSync(() => {
          updateFn();
          limparNomesDeTransicao(document, direction);
        });
      });

      // Catch promise rejections to prevent uncaught "AbortError: Transition was skipped"
      if (transition) {
        transition.ready?.catch(() => {});
        transition.finished
          ?.then(() => {
            docEl.classList.remove(
              "view-transition-forward",
              "view-transition-back",
            );
            limparNomesDeTransicao(document, direction);
            onFinished?.();
          })
          .catch(() => {
            docEl.classList.remove(
              "view-transition-forward",
              "view-transition-back",
            );
            limparNomesDeTransicao(document, direction);
            onFinished?.();
          });
      }
      return transition;
    },
    [isSupported],
  );

  return { navigate, isSupported };
}
