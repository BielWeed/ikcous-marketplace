import { useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { ThermodynamicSamplingEngine, type ThermodynamicState } from '@/lib/thermodynamicSampling';

export function useLiquidIntelligence() {
    const [loading, setLoading] = useState(false);
    const engineRef = useRef<ThermodynamicSamplingEngine | null>(null);

    // Initialize Thermodynamic Sampling Engine
    if (!engineRef.current) {
        engineRef.current = new ThermodynamicSamplingEngine({
            initialTemperature: 15.0, // High exploration
            finalTemperature: 0.05, // Precise exploitation
            coolingRate: 0.93, // Gradual cooling
            iterations: 150 // More iterations for better convergence
        });
    }

    /**
     * Compute optimal stock thresholds using Thermodynamic Sampling
     * Based on p-bit architecture and energy minimization
     */
    async function computeOptimalThresholds() {
        setLoading(true);
        try {
            // 1. Fetch optimized optimization data via RPC
            // This returns ID, Name, CurrentMin, and Velocity (90d daily average)
            const { data: optimizationData, error } = await (supabase.rpc as any)('get_product_optimization_data');

            if (error) throw error;

            // 2. Prepare products for thermodynamic optimization (rename keys to match engine expectation)
            const productsForOptimization = (optimizationData as any[]).map(prod => ({
                id: prod.id,
                name: prod.name,
                currentMin: prod.current_min,
                velocity: Number(prod.velocity)
            }));

            // 5. Run Thermodynamic Sampling (Annealing)
            const optimizedStates: ThermodynamicState[] = engineRef.current!.optimize(productsForOptimization);

            // 6. Format results for UI (merge velocity back from original products)
            const adjustments = optimizedStates.map(state => {
                const originalProduct = productsForOptimization.find(p => p.id === state.productId);
                return {
                    id: state.productId,
                    nome: state.productName,
                    old_min: state.currentMin,
                    new_min: state.proposedMin,
                    velocity: originalProduct?.velocity.toFixed(4) || '0.0000',
                    energy: state.energy.toFixed(3),
                    probability: state.probability.toFixed(3),
                    surprise: state.energy > 50 ? 'HIGH' : state.energy > 20 ? 'MEDIUM' : 'LOW'
                };
            });

            return adjustments;
        } catch (error) {
            console.error('[Thermodynamic-Sampling] Optimization Error:', error);
            return [];
        } finally {
            setLoading(false);
        }
    }

    return {
        computeOptimalThresholds,
        loading,
        engine: engineRef.current
    };
}
