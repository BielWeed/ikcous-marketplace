import { useState, useEffect } from 'react';

/**
 * useOnlineStatus - Hook para detectar reativamente se a conexão com a internet caiu.
 * Combina o estado do navegador com pings periódicos reais ao Supabase para resiliência.
 */
export function useOnlineStatus() {
  const [isOffline, setIsOffline] = useState(() => typeof navigator !== 'undefined' ? !navigator.onLine : false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    let isMounted = true;
    let checkInterval: any = null;

    const verifyConnection = async () => {
      if (!navigator.onLine) {
        if (isMounted) setIsOffline(true);
        return;
      }

      try {
        const url = import.meta.env.VITE_SUPABASE_URL;
        const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
        if (!url) {
          if (isMounted) setIsOffline(false);
          return;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3500);

        const res = await fetch(`${url}/rest/v1/banners?select=id&limit=1`, {
          method: 'GET',
          headers: {
            'apikey': anonKey,
            'Authorization': `Bearer ${anonKey}`
          },
          cache: 'no-store',
          signal: controller.signal
        });

        clearTimeout(timeoutId);
        if (isMounted) {
          // Se o servidor respondeu (inclusive com 401/403/404), a conexão está ativa!
          // Apenas consideramos offline em caso de erros de gateway (502, 503, 504) ou se cair no catch (falha de rede/DNS)
          const isGatewayError = res.status >= 502 && res.status <= 504;
          setIsOffline(isGatewayError);
        }
      } catch {
        if (isMounted) {
          setIsOffline(true);
        }
      }
    };

    const handleOnline = () => {
      verifyConnection();
    };

    const handleOffline = () => {
      if (isMounted) setIsOffline(true);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Initial check
    verifyConnection();

    // Heartbeat every 15s when page is active
    checkInterval = setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        verifyConnection();
      }
    }, 15000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        verifyConnection();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isMounted = false;
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (checkInterval) clearInterval(checkInterval);
    };
  }, []);

  return isOffline;
}
