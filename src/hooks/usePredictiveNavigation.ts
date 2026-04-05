import { useEffect, useCallback } from 'react';

/**
 * usePredictiveNavigation
 * Camada 2 da v21.0 ZENITH.
 * Gerencia dinamicamente as Speculation Rules do navegador.
 * Antecipa rotas críticas baseadas em interações de alta probabilidade.
 */
export function usePredictiveNavigation() {
    const updateSpeculationRules = useCallback((urls: string[]) => {
        // Verifica suporte à API Speculation Rules
        if (!HTMLScriptElement.supports?.('speculationrules')) return;

        // Remove regra anterior se existir
        const existing = document.getElementById('dynamic-speculation-rules');
        if (existing) existing.remove();

        const specScript = document.createElement('script');
        specScript.id = 'dynamic-speculation-rules';
        specScript.type = 'speculationrules';

        const rules = {
            prerender: [
                {
                    source: 'list',
                    urls: urls,
                    eagerness: 'conservative' // Prerender agressivo apenas em idle
                }
            ],
            prefetch: [
                {
                    source: 'list',
                    urls: urls,
                    requires: ['anonymous-client-ip-when-cross-origin']
                }
            ]
        };
        specScript.textContent = JSON.stringify(rules);
        document.head.appendChild(specScript);
    }, []);

    // Exemplo de predição: Se o usuário estiver no carrinho, pre-renderizar o checkout.
    // Se estiver na Home, pre-renderizar favoritos ou categorias populares.
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const view = params.get('view');

        let predictions: string[] = [];

        if (!view) {
            predictions = ['/cart', '/favorites'];
        } else if (view === 'product') {
            predictions = ['/cart'];
        } else if (view === 'cart') {
            predictions = ['/checkout'];
        }

        if (predictions.length > 0) {
            // Pequeno delay para não competir com recursos vitais da rota atual
            const timer = setTimeout(() => updateSpeculationRules(predictions), 2000);
            return () => clearTimeout(timer);
        }
    }, [updateSpeculationRules]);

    return { updateSpeculationRules };
}
