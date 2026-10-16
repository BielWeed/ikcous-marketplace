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
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

    const cancelTimer = () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const resetTransform = () => {
      mainEl.style.transform = "";
      mainEl.classList.remove("swipe-back-transition");
      mainEl.removeEventListener("transitionend", resetTransform);
    };

    const handleTouchCancel = () => {
      if (!isSwipingRef.current) return;
      isSwipingRef.current = false;
      startXRef.current = null;
      startYRef.current = null;
      mainEl.classList.add("swipe-back-transition");
      mainEl.style.transform = "translate3d(0, 0, 0)";
      mainEl.addEventListener("transitionend", resetTransform);
    };

    const handleTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      // Swipe back starting strictly from the left edge (clientX < 30px)
      if (touch.clientX < 30) {
        cancelTimer();
        resetTransform();
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

        timerRef.current = setTimeout(() => {
          // Register the reset before onBack, which may unmount this hook.
          timerRef.current = setTimeout(() => {
            timerRef.current = null;
            resetTransform();
          }, 300);
          onBack();
        }, 150);
      } else {
        // Cancel gesture and bounce back to normal
        mainEl.classList.add("swipe-back-transition");
        mainEl.style.transform = "translate3d(0, 0, 0)";

        mainEl.addEventListener("transitionend", resetTransform);
      }
    };

    mainEl.addEventListener("touchstart", handleTouchStart, { passive: false });
    mainEl.addEventListener("touchmove", handleTouchMove, { passive: false });
    mainEl.addEventListener("touchend", handleTouchEnd);
    mainEl.addEventListener("touchcancel", handleTouchCancel);

    return () => {
      mainEl.removeEventListener("touchstart", handleTouchStart);
      mainEl.removeEventListener("touchmove", handleTouchMove);
      mainEl.removeEventListener("touchend", handleTouchEnd);
      mainEl.removeEventListener("touchcancel", handleTouchCancel);
      cancelTimer();
      resetTransform();
      isSwipingRef.current = false;
      startXRef.current = null;
      startYRef.current = null;
    };
  }, [active, onBack, mainRef]);
}
