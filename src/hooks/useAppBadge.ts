import { useCallback, useRef } from "react";

/**
 * useAppBadge v17.0
 * App Badge API — exibe contagem no ícone do app instalado.
 * Funciona em Chrome/Edge/Samsung browser com PWA instalada.
 * Hoje o sincronizador do App.tsx alimenta APENAS com a contagem do
 * carrinho (notificações não lidas e updates não entram no badge).
 */
export function useAppBadge() {
  const currentBadgeRef = useRef<number>(0);
  const isSupported = "setAppBadge" in navigator;

  const setBadge = useCallback(
    async (count: number) => {
      if (!isSupported) return;
      try {
        if (count <= 0) {
          await (
            navigator as Navigator & { clearAppBadge?: () => Promise<void> }
          ).clearAppBadge?.();
          currentBadgeRef.current = 0;
        } else {
          await (
            navigator as Navigator & {
              setAppBadge?: (n: number) => Promise<void>;
            }
          ).setAppBadge?.(count);
          currentBadgeRef.current = count;
        }
      } catch {
        /* Not available in this context */
      }
    },
    [isSupported],
  );

  const clearBadge = useCallback(async () => {
    if (!isSupported) return;
    try {
      await (
        navigator as Navigator & { clearAppBadge?: () => Promise<void> }
      ).clearAppBadge?.();
      currentBadgeRef.current = 0;
    } catch {
      /* silent */
    }
  }, [isSupported]);

  // Clear badge removed to allow persistence of cart count

  return {
    setBadge,
    clearBadge,
    isSupported,
    getCurrentBadge: () => currentBadgeRef.current,
  };
}
