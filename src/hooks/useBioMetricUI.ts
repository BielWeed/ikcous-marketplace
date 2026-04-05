import { useEffect, useRef, useState } from 'react';

/**
 * useBioMetricUI
 * Camada 3 da v25.0 OMEGA.
 * Monitora a velocidade de clique e scroll para ajustar o "feel" da UI.
 * Reduz latência de animações para usuários rápidos (power users).
 */
export function useBioMetricUI() {
    const lastInteractionTime = useRef<number | null>(null);
    const interactionGaps = useRef<number[]>([]);
    const [uiPulse, setUiPulse] = useState<'calm' | 'active' | 'frenetic'>('calm');

    useEffect(() => {
        lastInteractionTime.current = Date.now();
    }, []);

    useEffect(() => {
        const handleInteraction = () => {
            const now = Date.now();
            if (lastInteractionTime.current === null) {
                lastInteractionTime.current = now;
                return;
            }
            const gap = now - lastInteractionTime.current;
            lastInteractionTime.current = now;

            if (gap > 10 && gap < 2000) {
                interactionGaps.current = [...interactionGaps.current.slice(-10), gap];

                const avgGap = interactionGaps.current.reduce((a, b) => a + b, 0) / interactionGaps.current.length;

                if (avgGap < 300) setUiPulse('frenetic');
                else if (avgGap < 800) setUiPulse('active');
                else setUiPulse('calm');
            }
        };

        window.addEventListener('mousedown', handleInteraction);
        window.addEventListener('touchstart', handleInteraction);
        window.addEventListener('wheel', handleInteraction);

        return () => {
            window.removeEventListener('mousedown', handleInteraction);
            window.removeEventListener('touchstart', handleInteraction);
            window.removeEventListener('wheel', handleInteraction);
        };
    }, []);

    useEffect(() => {
        // Aplana a latência visual no CSS via variáveis globais
        const durations = {
            calm: '0.4s',
            active: '0.2s',
            frenetic: '0.1s'
        };

        document.documentElement.style.setProperty('--bio-transition-duration', durations[uiPulse]);
        console.log(`[Bio-Feedback] UI Pulse shifted to: ${uiPulse}`);
    }, [uiPulse]);

    return { uiPulse };
}
