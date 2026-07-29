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
          if (container) {
            container.scrollTop = savedPos;
          }
        });
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

  return { ref: elementRef, saveScroll, resetRestored };
}
