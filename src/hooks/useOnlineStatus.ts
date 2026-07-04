import { useState, useEffect } from 'react';

/**
 * useOnlineStatus - Hook para detectar reativamente se a conexão com a internet caiu.
 * Utilizado para desabilitar mutações críticas no Painel Admin quando offline.
 */
export function useOnlineStatus() {
  const [isOffline, setIsOffline] = useState(() => typeof navigator !== 'undefined' ? !navigator.onLine : false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOffline;
}
