import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

// Central cache for scroll positions across views
const scrollCache: Record<string, number> = {};

export function useScrollRestoration(
  key: string,
  active: boolean,
  shouldRestore = true,
) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const hasRestoredRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  const saveScroll = useCallback(() => {
    if (elementRef.current) {
      const container =
        elementRef.current.closest(".admin-scroll-container") ||
        document.querySelector(".active-scroll-container") ||
        document.querySelector("main");
      if (container) {
        scrollCache[key] = container.scrollTop;
      }
    }
  }, [key]);

  const resetRestored = useCallback(() => {
    hasRestoredRef.current = false;
  }, []);

  // Abertura "do zero" (atalho que zera filtros): leva ao topo, esquece a
  // posição guardada e cancela a reaplicação agendada pelo efeito abaixo,
  // senão ela devolveria a rolagem antiga no quadro seguinte.
  const reiniciarScroll = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    Reflect.deleteProperty(scrollCache, key);
    const container =
      elementRef.current?.closest(".admin-scroll-container") ||
      document.querySelector(".active-scroll-container") ||
      document.querySelector("main");
    if (container) container.scrollTop = 0;
  }, [key]);

  useLayoutEffect(() => {
    if (!active) {
      saveScroll();
      hasRestoredRef.current = false;
      return;
    }

    if (!shouldRestore) return;

    const savedPos = scrollCache[key] || 0;
    if (savedPos > 0 && !hasRestoredRef.current) {
      const container =
        elementRef.current?.closest(".admin-scroll-container") ||
        document.querySelector(".active-scroll-container") ||
        document.querySelector("main");
      if (container) {
        hasRestoredRef.current = true;
        container.scrollTop = savedPos;

        const raf = requestAnimationFrame(() => {
          rafRef.current = null;
          if (container) {
            container.scrollTop = savedPos;
          }
        });
        rafRef.current = raf;
        return () => cancelAnimationFrame(raf);
      }
    }
  }, [active, key, shouldRestore, saveScroll]);

  // Save scroll on unmount
  useEffect(() => {
    const currentElement = elementRef.current;
    return () => {
      if (currentElement) {
        const container =
          currentElement.closest(".admin-scroll-container") ||
          document.querySelector(".active-scroll-container") ||
          document.querySelector("main");
        if (container) {
          scrollCache[key] = container.scrollTop;
        }
      }
    };
  }, [key]);

  return { ref: elementRef, saveScroll, resetRestored, reiniciarScroll };
}
