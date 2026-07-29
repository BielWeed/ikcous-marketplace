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

      const cleanupTransitionNames = () => {
        document
          .querySelectorAll<HTMLElement>('img, [style*="view-transition-name"]')
          .forEach((el) => {
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
      };

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
          cleanupTransitionNames();
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
            cleanupTransitionNames();
            onFinished?.();
          })
          .catch(() => {
            docEl.classList.remove(
              "view-transition-forward",
              "view-transition-back",
            );
            cleanupTransitionNames();
            onFinished?.();
          });
      }
      return transition;
    },
    [isSupported],
  );

  return { navigate, isSupported };
}
