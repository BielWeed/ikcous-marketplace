import { useState, useCallback, useEffect } from 'react';

/**
 * useTemporalFold
 * Camada 1 da v27.0 UNBOUND.
 * Implementa um sistema de estados especulativos e multi-realidade.
 * Mantém três timelines: 'Local' (imediato), 'Peer' (p2p swarm) e 'Consensus' (confirmado).
 */
export function useTemporalFold(initialState: any) {
    const [reality, setReality] = useState({
        local: initialState,
        peer: initialState,
        consensus: initialState
    });

    const fold = useCallback((update: any, type: 'local' | 'peer' | 'consensus' | 'all') => {
        setReality(prev => {
            if (type === 'all') {
                const newState = { ...prev.consensus, ...update };
                return { local: newState, peer: newState, consensus: newState };
            }
            const next = { ...prev, [type]: { ...prev[type], ...update } };
            return next;
        });
    }, []);

    // Sync with initialState changes to prevent zumbie reality
    useEffect(() => {
        setTimeout(() => {
            setReality(prev => {
                const currentConsensus = JSON.stringify(prev.consensus);
                const nextInitial = JSON.stringify(initialState);

                // If the incoming state matches our current consensus, don't reset
                // This prevents loops where hook state update causes parent re-render 
                // which sends a new object reference for the same data.
                if (currentConsensus === nextInitial) return prev;

                console.log('[Temporal-Fold] 🌀 Resyncing reality with new initial state.');
                return {
                    local: initialState,
                    peer: initialState,
                    consensus: initialState
                };
            });
        }, 0);
    }, [initialState]);

    const getActiveState = () => reality.local;

    useEffect(() => {
        const interval = setInterval(() => {
            if (JSON.stringify(reality.local) !== JSON.stringify(reality.consensus)) {
                console.log('[Temporal-Fold] ⚠️ Drift detected between LOCAL and CONSENSUS reality. Folding to merge timelines.');
                // Silenced noisy warning, using trace for debugging only if needed
                setTimeout(() => setReality(prev => ({ ...prev, local: prev.consensus })), 0);
            }
        }, 10000); // Relaxed to 10s for stability
        return () => clearInterval(interval);
    }, [reality.local, reality.consensus]);

    return { state: getActiveState(), fold };
}
