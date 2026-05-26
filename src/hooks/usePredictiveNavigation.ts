import { useEffect } from 'react';
import { usePrefetchOnHover } from './usePrefetchOnHover';

/**
 * usePredictiveNavigation
 * Camada 2 da v21.0 ZENITH.
 * Otimizado para SPA: Pré-carrega os chunks dos componentes React em vez
 * de tentar pré-renderizar documentos HTML inexistentes.
 */
export function usePredictiveNavigation(currentView: string) {
    const { prefetchView } = usePrefetchOnHover();

    useEffect(() => {
        let predictions: string[] = [];

        if (currentView === 'home') {
            predictions = ['cart', 'favorites'];
        } else if (currentView === 'product-detail') {
            predictions = ['cart'];
        } else if (currentView === 'cart') {
            predictions = ['checkout'];
        }

        if (predictions.length > 0) {
            // Pequeno delay para não competir com recursos vitais da rota atual
            const timer = setTimeout(() => {
                predictions.forEach(view => {
                    prefetchView(view);
                });
            }, 2000);
            return () => clearTimeout(timer);
        }
    }, [currentView, prefetchView]);

    return { updateSpeculationRules: () => {} };
}

