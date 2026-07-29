import { useEffect, useState } from "react";

export interface Diagnostics {
  isOffline: boolean;
  latency: number;
  quality: "excellent" | "good" | "slow" | "offline";
}

/**
 * useConnectionDiagnostics - Hook para obter dados detalhados da qualidade de conexão.
 * Mede latência (RTT) real contra a API do Supabase e retorna métricas detalhadas.
 */
export function useConnectionDiagnostics() {
  const [diagnostics, setDiagnostics] = useState<Diagnostics>({
    isOffline: typeof navigator !== "undefined" ? !navigator.onLine : false,
    latency: 0,
    quality:
      typeof navigator !== "undefined" && navigator.onLine
        ? "excellent"
        : "offline",
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    let isMounted = true;
    let checkInterval: any = null;
    let isChecking = false;

    const verifyConnection = async (isRetry = false) => {
      if (isChecking) return;
      isChecking = true;

      if (!navigator.onLine) {
        if (isMounted) {
          setDiagnostics({
            isOffline: true,
            latency: 0,
            quality: "offline",
          });
        }
        isChecking = false;
        return;
      }

      try {
        const url = import.meta.env.VITE_SUPABASE_URL;
        const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
        if (!url) {
          if (isMounted) {
            setDiagnostics({
              isOffline: false,
              latency: 0,
              quality: "excellent",
            });
          }
          isChecking = false;
          return;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3500);

        const startTime = Date.now();
        const res = await fetch(`${url}/rest/v1/banners?select=id&limit=1`, {
          method: "GET",
          headers: {
            apikey: anonKey,
            Authorization: `Bearer ${anonKey}`,
          },
          cache: "no-store",
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        const latency = Date.now() - startTime;

        if (isMounted) {
          const isGatewayError = res.status >= 502 && res.status <= 504;
          const isOffline = isGatewayError;

          let quality: "excellent" | "good" | "slow" | "offline" = "excellent";
          if (isOffline) {
            quality = "offline";
          } else if (latency > 350) {
            quality = "slow";
          } else if (latency > 150) {
            quality = "good";
          }

          setDiagnostics({
            isOffline,
            latency,
            quality,
          });
        }
      } catch {
        if (isMounted) {
          if (!isRetry) {
            isChecking = false;
            setTimeout(() => {
              if (isMounted) verifyConnection(true);
            }, 1500);
            return;
          }
          setDiagnostics({
            isOffline: true,
            latency: 0,
            quality: "offline",
          });
        }
      } finally {
        isChecking = false;
      }
    };

    const handleOnline = () => {
      verifyConnection();
    };

    const handleOffline = () => {
      if (isMounted) {
        setDiagnostics({
          isOffline: true,
          latency: 0,
          quality: "offline",
        });
      }
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Initial check
    verifyConnection();

    // Heartbeat every 15s when page is active
    checkInterval = setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine) {
        verifyConnection();
      }
    }, 15000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        verifyConnection();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      isMounted = false;
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (checkInterval) clearInterval(checkInterval);
    };
  }, []);

  return diagnostics;
}

/**
 * useOnlineStatus - Hook legado para detectar reativamente se a conexão caiu.
 * Mantido para compatibilidade total com os componentes existentes.
 */
export function useOnlineStatus() {
  const { isOffline } = useConnectionDiagnostics();
  return isOffline;
}
