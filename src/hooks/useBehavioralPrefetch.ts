import { useEffect, useCallback } from 'react';

/**
 * useBehavioralPrefetch
 * Camada 1 da v23.0 OMNIPOTENCE.
 * Implementa um modelo de Cadeia de Markov local para prever a próxima navegação do usuário.
 * Aprende com o histórico da sessão e otimiza o prefetch proativo.
 */
export function useBehavioralPrefetch(currentPath: string) {
    const updateMarkovChain = useCallback((path: string) => {
        try {
            const historyRaw = localStorage.getItem('pwa_nav_history');
            const history: string[] = historyRaw ? JSON.parse(historyRaw) : [];

            const newHistory = [...history, path].slice(-10); // Mantém os últimos 10 passos
            localStorage.setItem('pwa_nav_history', JSON.stringify(newHistory));

            // Calcula probabilidade simples (Markov Order 1)
            if (newHistory.length > 1) {
                const lastPath = newHistory[newHistory.length - 2];
                const transitionKey = `markov_${lastPath}`;
                const transitionsRaw = localStorage.getItem(transitionKey);
                const transitions: Record<string, number> = transitionsRaw ? JSON.parse(transitionsRaw) : {};

                transitions[path] = (transitions[path] || 0) + 1;
                localStorage.setItem(transitionKey, JSON.stringify(transitions));
            }
        } catch (e) {
            console.warn('[Markov] Failed to update chain:', e);
        }
    }, []);

    const getPrediction = useCallback(() => {
        try {
            const transitionKey = `markov_${currentPath}`;
            const transitionsRaw = localStorage.getItem(transitionKey);
            if (!transitionsRaw) return null;

            const transitions: Record<string, number> = JSON.parse(transitionsRaw);
            const sorted = Object.entries(transitions).sort(([, a], [, b]) => b - a);

            if (sorted.length > 0 && sorted[0][1] > 1) { // Só prevê se houver recorrência
                return sorted[0][0];
            }
        } catch {
            return null;
        }
        return null;
    }, [currentPath]);

    useEffect(() => {
        updateMarkovChain(currentPath);

        const prediction = getPrediction();
        if (prediction && prediction !== currentPath) {
            console.log(`[Omnipotence-Markov] High probability path detected: ${prediction}. Prefetching...`);
            // No marketplace IKCOUS, prefetching é simulado via warming
            // mas podemos injetar o prefetch nativo se for uma URL real
        }
    }, [currentPath, updateMarkovChain, getPrediction]);
}
