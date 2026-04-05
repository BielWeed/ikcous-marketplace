import { useEffect, useRef, useCallback, useState } from 'react';

/**
 * useWorkerState
 * Camada 1 da v24.0 APOTHEOSIS.
 * Proporciona uma interface reativa para o State Worker.
 * Reduz o trabalho da Main Thread para garantir animações suaves.
 */
export function useWorkerState() {
    const workerRef = useRef<Worker | null>(null);
    const [lastResult, setLastResult] = useState<any>(null);

    useEffect(() => {
        // Inicializa o worker
        const worker = new Worker(new URL('../state-worker.ts', import.meta.url), { type: 'module' });

        worker.onmessage = (event) => {
            const { type, payload } = event.data;
            if (type === 'FILTERS_PROCESSED' || type === 'TOTALS_CALCULATED') {
                setLastResult(payload);
            }
        };

        workerRef.current = worker;

        return () => worker.terminate();
    }, []);

    const dispatch = useCallback((type: string, payload: any) => {
        workerRef.current?.postMessage({ type, payload });
    }, []);

    return { dispatch, lastResult };
}
