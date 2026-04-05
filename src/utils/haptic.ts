/**
 * Utilitário para feedback háptico (vibração) no navegador.
 * Focado em melhorar a sensação de interação premium no mobile.
 */

export const haptic = {
    /**
     * Vibração leve e curta para cliques normais ou seleção.
     */
    light: () => {
        if ('vibrate' in navigator) {
            navigator.vibrate(10);
        }
    },

    /**
     * Vibração média para ações significativas (adicionar ao carrinho).
     */
    medium: () => {
        if ('vibrate' in navigator) {
            navigator.vibrate(20);
        }
    },

    /**
     * Vibração forte para ações críticas ou erros.
     */
    heavy: () => {
        if ('vibrate' in navigator) {
            navigator.vibrate([30, 50, 30]);
        }
    },

    /**
     * Padrão de sucesso (duas vibrações rápidas).
     */
    success: () => {
        if ('vibrate' in navigator) {
            navigator.vibrate([20, 30, 20]);
        }
    },

    /**
     * Padrão de erro (vibração longa seguido de pausa e vibração curta).
     */
    error: () => {
        if ('vibrate' in navigator) {
            navigator.vibrate([100, 50, 100]);
        }
    }
};
