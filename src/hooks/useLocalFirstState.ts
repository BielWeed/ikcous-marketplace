import { useEffect, useState, useCallback } from 'react';

/**
 * useLocalFirstState
 * Camada 3 da v22.0 SINGULARITY.
 * Sincroniza o estado da UI diretamente com o armazenamento persistente (Local-First).
 * Garante que o usuário nunca perca sua posição ou dados de formulário durante um PWA Update.
 */
export function useLocalFirstState<T>(key: string, initialValue: T) {
    // Carrega do storage no init
    const [state, setState] = useState<T>(() => {
        try {
            const saved = localStorage.getItem(`zenith_state_${key}`);
            return saved ? JSON.parse(saved) : initialValue;
        } catch {
            return initialValue;
        }
    });

    const updateState = useCallback((newValue: T | ((prev: T) => T)) => {
        setState(prev => {
            const resolvedValue = newValue instanceof Function ? newValue(prev) : newValue;

            // Persistência em background (microtask)
            queueMicrotask(() => {
                try {
                    localStorage.setItem(`zenith_state_${key}`, JSON.stringify(resolvedValue));
                } catch (e) {
                    console.warn('[LocalFirst] Storage quota exceeded or blocked.');
                }
            });

            return resolvedValue;
        });
    }, [key]);

    // Sincronização multi-aba
    useEffect(() => {
        const handleStorage = (e: StorageEvent) => {
            if (e.key === `zenith_state_${key}` && e.newValue) {
                setState(JSON.parse(e.newValue));
            }
        };
        window.addEventListener('storage', handleStorage);
        return () => window.removeEventListener('storage', handleStorage);
    }, [key]);

    return [state, updateState] as const;
}
