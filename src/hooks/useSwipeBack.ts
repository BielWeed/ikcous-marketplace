import { useEffect, useRef } from "react";

interface UseSwipeBackProps {
  readonly onBack: () => void;
  readonly active: boolean;
  readonly mainRef: React.RefObject<HTMLElement | null>;
}

export function useSwipeBack({ onBack, active, mainRef }: UseSwipeBackProps) {
  const startXRef = useRef<number | null>(null);
  const startYRef = useRef<number | null>(null);
  const isSwipingRef = useRef<boolean>(false);

  useEffect(() => {
    if (!active) {
      if (mainRef.current) {
        mainRef.current.style.transform = "";
        mainRef.current.classList.remove("swipe-back-transition");
      }
      return;
    }

    const mainEl = mainRef.current;
    if (!mainEl) return;

    const handleTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      // Swipe back starting strictly from the left edge (clientX < 30px)
      if (touch.clientX < 30) {
        startXRef.current = touch.clientX;
        startYRef.current = touch.clientY;
        isSwipingRef.current = true;
        mainEl.classList.remove("swipe-back-transition");
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (
        !isSwipingRef.current ||
        startXRef.current === null ||
        startYRef.current === null
      )
        return;

      const touch = e.touches[0];
      const deltaX = touch.clientX - startXRef.current;
      const deltaY = Math.abs(touch.clientY - startYRef.current);

      // If scrolling vertically, cancel swipe back to maintain native vertical scroll smoothness
      if (deltaY > deltaX && deltaX < 20) {
        handleTouchEnd();
        return;
      }

      if (deltaX > 0) {
        if (e.cancelable) {
          e.preventDefault();
        }
        mainEl.style.transform = `translate3d(${deltaX}px, 0, 0)`;
      }
    };

    const handleTouchEnd = () => {
      if (!isSwipingRef.current || startXRef.current === null) return;

      isSwipingRef.current = false;
      const currentTransform = mainEl.style.transform;
      const match = currentTransform.match(/translate3d\(([\d.]+)px/);
      const deltaX = match ? Number.parseFloat(match[1]) : 0;

      startXRef.current = null;
      startYRef.current = null;

      const threshold = window.innerWidth * 0.25;

      if (deltaX > threshold) {
        // Trigger back action and animate slide-out
        mainEl.classList.add("swipe-back-transition");
        mainEl.style.transform = "translate3d(100%, 0, 0)";

        setTimeout(() => {
          onBack();
          setTimeout(() => {
            mainEl.style.transform = "";
            mainEl.classList.remove("swipe-back-transition");
          }, 300);
        }, 150);
      } else {
        // Cancel gesture and bounce back to normal
        mainEl.classList.add("swipe-back-transition");
        mainEl.style.transform = "translate3d(0, 0, 0)";

        const resetTransform = () => {
          mainEl.style.transform = "";
          mainEl.classList.remove("swipe-back-transition");
          mainEl.removeEventListener("transitionend", resetTransform);
        };
        mainEl.addEventListener("transitionend", resetTransform);
      }
    };

    mainEl.addEventListener("touchstart", handleTouchStart, { passive: false });
    mainEl.addEventListener("touchmove", handleTouchMove, { passive: false });
    mainEl.addEventListener("touchend", handleTouchEnd);
    mainEl.addEventListener("touchcancel", handleTouchEnd);

    return () => {
      mainEl.removeEventListener("touchstart", handleTouchStart);
      mainEl.removeEventListener("touchmove", handleTouchMove);
      mainEl.removeEventListener("touchend", handleTouchEnd);
      mainEl.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [active, onBack, mainRef]);
}
